import { OAuth2Client } from "google-auth-library";
import { getMappedStudentsByEmail, listStudentMaster, getTeacherProfile, getTeacherDirectory } from "./storage.js";

const googleClient = new OAuth2Client();

export function parseJsonEnv(name, fallback={}){
  try{return JSON.parse(process.env[name]||JSON.stringify(fallback))}catch{return fallback}
}

function parseJsonValue(raw,fallback=[]){
  try{return JSON.parse(String(raw||""))}catch{return fallback}
}

function cookieValue(request,name){
  const raw=String(request.headers.get("cookie")||"");
  for(const part of raw.split(";")){
    const i=part.indexOf("=");
    if(i<0)continue;
    if(part.slice(0,i).trim()===name)return decodeURIComponent(part.slice(i+1).trim());
  }
  return "";
}

function googleToken(request){
  const session=cookieValue(request,"orchestra_google_id_token");
  if(session)return session;
  const custom=String(request.headers.get("x-google-id-token")||"").trim();
  if(custom&&custom!=="cookie-session")return custom;
  const auth=String(request.headers.get("authorization")||"");
  if(!auth.toLowerCase().startsWith("bearer "))return "";
  return auth.slice(7).trim();
}

export async function verifyGoogleToken(token){
  const audience=String(process.env.GOOGLE_CLIENT_ID||"").trim();
  if(!token||!audience)return null;
  try{
    const ticket=await googleClient.verifyIdToken({idToken:token,audience});
    const p=ticket.getPayload();
    if(!p?.email||p.email_verified!==true)return null;
    return {sub:p.sub,email:String(p.email).trim().toLowerCase(),displayName:p.name||p.email,picture:p.picture||null};
  }catch(err){
    console.error("Google ID token verification failed:",err?.message||String(err));
    return null;
  }
}

export async function verifyGoogle(request){return verifyGoogleToken(googleToken(request))}

function normalizeProfile(profile){
  const sectionAssignments=(parseJsonValue(profile?.sectionAssignments,[])||[]).map(x=>({groupName:String(x?.groupName||"").trim(),section:String(x?.section||"").trim()})).filter(x=>x.groupName&&x.section);
  const ensembleGroups=[...new Set((parseJsonValue(profile?.ensembleGroups,[])||[]).map(String).filter(x=>["A","B"].includes(x)))];
  const privateStudentIds=[...new Set((parseJsonValue(profile?.privateStudentIds,[])||[]).map(String).filter(Boolean))];
  return {sectionAssignments,ensembleGroups,privateStudentIds};
}

function viewMaster(e){
  return {studentId:e.rowKey,name:e.studentName,grade:e.grade,groupName:e.groupName,instrument:e.instrument,section:e.section||"待確認",schoolYear:e.schoolYear||"",status:e.status||"active",source:"studentMaster"};
}

export async function getAccess(request){
  const identity=await verifyGoogle(request);
  if(!identity)return {authenticated:false};
  const email=identity.email;
  const parentMap=parseJsonEnv("STUDENT_MAP_JSON",{});
  const admins=String(process.env.ADMIN_EMAILS||"").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);

  if(admins.includes(email))return {authenticated:true,...identity,role:"admin",capabilities:{admin:true}};

  // Teacher authorization now comes ONLY from the backend TeacherDirectory.
  // Legacy SECTION_TEACHER_MAP_JSON / ENSEMBLE_TEACHER_MAP_JSON /
  // PRIVATE_TEACHER_MAP_JSON / TEACHER_EMAILS are intentionally ignored.
  const directory=await getTeacherDirectory(email);
  if(directory?.status==="active"){
    const profile=await getTeacherProfile(email);
    const {sectionAssignments,ensembleGroups,privateStudentIds}=normalizeProfile(profile);
    const capabilities={
      section:sectionAssignments.length>0,
      ensemble:ensembleGroups.length>0,
      private:privateStudentIds.length>0,
      teacherSettings:true
    };
    const masters=await listStudentMaster("active");
    const byId=new Map();
    for(const m of masters){
      const v=viewMaster(m);
      const sectionMatch=sectionAssignments.some(a=>a.groupName===v.groupName&&a.section===v.section);
      const ensembleMatch=ensembleGroups.includes(v.groupName);
      const privateMatch=privateStudentIds.includes(v.studentId);
      if(sectionMatch||ensembleMatch||privateMatch)byId.set(v.studentId,v);
    }
    const role=capabilities.section?"sectionTeacher":capabilities.ensemble?"ensembleTeacher":capabilities.private?"privateTeacher":"teacher";
    return {
      authenticated:true,...identity,
      displayName:directory.teacherName||identity.displayName,
      role,capabilities,
      sectionAssignments,assignments:sectionAssignments,
      ensembleGroups,privateStudentIds,students:[...byId.values()]
    };
  }

  if(parentMap[email])return {authenticated:true,...identity,role:"parent",students:parentMap[email]};
  const dynamicStudents=await getMappedStudentsByEmail(email);
  if(dynamicStudents.length)return {authenticated:true,...identity,role:"parent",students:dynamicStudents};
  return {authenticated:true,...identity,role:"unassigned",capabilities:{}};
}

export function json(body,status=200){return {status,jsonBody:body,headers:{"Content-Type":"application/json; charset=utf-8"}}}

export function allowedStudentIds(access){
  if(access.role==="admin")return null;
  return (access.students||[]).map(x=>typeof x==="string"?x:x.studentId);
}

export function ensureStudentAccess(access,studentId){
  if(access.role==="admin")return true;
  return (allowedStudentIds(access)||[]).includes(studentId);
}

export function ensureSectionAccess(access,student){
  if(access.role==="admin")return true;
  if(!access.capabilities?.section)return false;
  return (access.sectionAssignments||[]).some(a=>a.groupName===student.groupName&&a.section===(student.section||"待確認"));
}

export function ensureEnsembleAccess(access,student){
  if(access.role==="admin")return true;
  return !!access.capabilities?.ensemble&&(access.ensembleGroups||[]).includes(student.groupName);
}

export function ensurePrivateAccess(access,studentId){
  if(access.role==="admin")return true;
  return !!access.capabilities?.private&&(access.privateStudentIds||[]).includes(String(studentId));
}
