import { OAuth2Client } from "google-auth-library";
import { getMappedStudentsByEmail, listStudentMaster } from "./storage.js";

const googleClient = new OAuth2Client();

export function parseJsonEnv(name, fallback={}){
  try{return JSON.parse(process.env[name]||JSON.stringify(fallback))}catch{return fallback}
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
    return {
      sub:p.sub,
      email:String(p.email).trim().toLowerCase(),
      displayName:p.name||p.email,
      picture:p.picture||null
    };
  }catch(err){
    console.error("Google ID token verification failed:",err?.message||String(err));
    return null;
  }
}

export async function verifyGoogle(request){
  return verifyGoogleToken(googleToken(request));
}

function normalizeSectionAssignments(entry){
  if(!entry)return [];
  if(Array.isArray(entry.assignments))return entry.assignments.map(x=>({groupName:String(x.groupName||x.group||"").trim(),section:String(x.section||"").trim()})).filter(x=>x.section);
  const section=String(entry.section||"").trim();
  if(!section)return [];
  const groups=Array.isArray(entry.groups)?entry.groups:[entry.groupName||entry.group].filter(Boolean);
  if(groups.length)return groups.map(g=>({groupName:String(g).trim(),section}));
  return [{groupName:"",section}];
}

function normalizeEnsembleGroups(entry){
  if(!entry)return [];
  const raw=Array.isArray(entry)?entry:(Array.isArray(entry.groups)?entry.groups:[entry.groupName||entry.group].filter(Boolean));
  return [...new Set(raw.map(x=>String(x).trim()).filter(Boolean))];
}

function normalizePrivateStudentIds(entry){
  if(!entry)return [];
  const list=Array.isArray(entry)?entry:(Array.isArray(entry.students)?entry.students:(Array.isArray(entry.studentIds)?entry.studentIds:[]));
  return [...new Set(list.map(x=>typeof x==="string"?x:x?.studentId).filter(Boolean).map(String))];
}

function viewMaster(e){
  return {studentId:e.rowKey,name:e.studentName,grade:e.grade,groupName:e.groupName,instrument:e.instrument,section:e.section||"待確認",schoolYear:e.schoolYear||"",status:e.status||"active",source:"studentMaster"};
}

export async function getAccess(request){
  const identity=await verifyGoogle(request);
  if(!identity)return {authenticated:false};
  const email=identity.email;
  const parentMap=parseJsonEnv("STUDENT_MAP_JSON",{});
  const sectionMap=parseJsonEnv("SECTION_TEACHER_MAP_JSON",{});
  const ensembleMap=parseJsonEnv("ENSEMBLE_TEACHER_MAP_JSON",{});
  const privateMap=parseJsonEnv("PRIVATE_TEACHER_MAP_JSON",{});
  const admins=String(process.env.ADMIN_EMAILS||"").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);

  if(admins.includes(email))return {authenticated:true,...identity,role:"admin",capabilities:{admin:true,section:true,ensemble:true,private:true}};

  const sectionAssignments=normalizeSectionAssignments(sectionMap[email]);
  const ensembleGroups=normalizeEnsembleGroups(ensembleMap[email]);
  const privateStudentIds=normalizePrivateStudentIds(privateMap[email]);
  const capabilities={section:sectionAssignments.length>0,ensemble:ensembleGroups.length>0,private:privateStudentIds.length>0};

  if(capabilities.section||capabilities.ensemble||capabilities.private){
    const masters=await listStudentMaster("active");
    const byId=new Map();
    for(const m of masters){
      const v=viewMaster(m);
      const sectionMatch=sectionAssignments.some(a=>(!a.groupName||a.groupName===v.groupName)&&a.section===v.section);
      const ensembleMatch=ensembleGroups.includes(v.groupName);
      const privateMatch=privateStudentIds.includes(v.studentId);
      if(sectionMatch||ensembleMatch||privateMatch)byId.set(v.studentId,v);
    }
    const legacyPrivate=privateMap[email];
    const legacyList=Array.isArray(legacyPrivate)?legacyPrivate:(legacyPrivate?.students||[]);
    for(const s of legacyList){if(typeof s==="object"&&s?.studentId&&!byId.has(String(s.studentId)))byId.set(String(s.studentId),s)}
    const role=capabilities.section?"sectionTeacher":capabilities.private?"privateTeacher":"ensembleTeacher";
    return {authenticated:true,...identity,role,capabilities,sectionAssignments,assignments:sectionAssignments,ensembleGroups,privateStudentIds,students:[...byId.values()]};
  }

  if(parentMap[email])return {authenticated:true,...identity,role:"parent",students:parentMap[email]};

  const dynamicStudents=await getMappedStudentsByEmail(email);
  if(dynamicStudents.length)return {authenticated:true,...identity,role:"parent",students:dynamicStudents};

  return {authenticated:true,...identity,role:"unassigned",capabilities:{}};
}

export function json(body,status=200){
  return {status,jsonBody:body,headers:{"Content-Type":"application/json; charset=utf-8"}};
}

export function allowedStudentIds(access){
  if(access.role==="admin")return null;
  const list=access.students||[];
  return list.map(x=>typeof x==="string"?x:x.studentId);
}

export function ensureStudentAccess(access,studentId){
  if(access.role==="admin")return true;
  const ids=allowedStudentIds(access)||[];
  return ids.includes(studentId);
}

export function ensureSectionAccess(access,student){
  if(access.role==="admin")return true;
  if(!access.capabilities?.section)return false;
  return (access.sectionAssignments||[]).some(a=>(!a.groupName||a.groupName===student.groupName)&&a.section===(student.section||"待確認"));
}

export function ensureEnsembleAccess(access,student){
  if(access.role==="admin")return true;
  if(!access.capabilities?.ensemble)return false;
  return (access.ensembleGroups||[]).includes(student.groupName);
}

export function ensurePrivateAccess(access,studentId){
  if(access.role==="admin")return true;
  if(!access.capabilities?.private)return false;
  return (access.privateStudentIds||[]).includes(String(studentId));
}
