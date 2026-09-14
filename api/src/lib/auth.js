import { OAuth2Client } from "google-auth-library";
import { getMappedStudentsByEmail } from "./storage.js";

const googleClient = new OAuth2Client();

export function parseJsonEnv(name, fallback={}){
  try{return JSON.parse(process.env[name]||JSON.stringify(fallback))}catch{return fallback}
}

function googleToken(request){
  const custom=String(request.headers.get("x-google-id-token")||"").trim();
  if(custom)return custom;
  const auth=String(request.headers.get("authorization")||"");
  if(!auth.toLowerCase().startsWith("bearer "))return "";
  return auth.slice(7).trim();
}

export async function verifyGoogle(request){
  const token=googleToken(request);
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

export async function getAccess(request){
  const identity=await verifyGoogle(request);
  if(!identity)return {authenticated:false};
  const email=identity.email;
  const parentMap=parseJsonEnv("STUDENT_MAP_JSON",{});
  const sectionMap=parseJsonEnv("SECTION_TEACHER_MAP_JSON",{});
  const privateMap=parseJsonEnv("PRIVATE_TEACHER_MAP_JSON",{});
  const admins=String(process.env.ADMIN_EMAILS||"").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);

  if(admins.includes(email))return {authenticated:true,...identity,role:"admin"};
  if(sectionMap[email])return {authenticated:true,...identity,role:"sectionTeacher",...sectionMap[email]};
  if(privateMap[email])return {authenticated:true,...identity,role:"privateTeacher",...privateMap[email]};
  if(parentMap[email])return {authenticated:true,...identity,role:"parent",students:parentMap[email]};

  const dynamicStudents=await getMappedStudentsByEmail(email);
  if(dynamicStudents.length)return {authenticated:true,...identity,role:"parent",students:dynamicStudents};

  return {authenticated:true,...identity,role:"unassigned"};
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
