
export function getPrincipal(request){
  const raw=request.headers.get("x-ms-client-principal");
  if(!raw)return null;
  try{return JSON.parse(Buffer.from(raw,"base64").toString("utf8"))}catch{return null}
}
export function getEmail(principal){
  return String(principal?.userDetails||"").trim().toLowerCase();
}
export function parseJsonEnv(name, fallback={}){
  try{return JSON.parse(process.env[name]||JSON.stringify(fallback))}catch{return fallback}
}
export function getAccess(request){
  const principal=getPrincipal(request);
  if(!principal)return {authenticated:false};
  const email=getEmail(principal);
  const parentMap=parseJsonEnv("STUDENT_MAP_JSON",{});
  const sectionMap=parseJsonEnv("SECTION_TEACHER_MAP_JSON",{});
  const privateMap=parseJsonEnv("PRIVATE_TEACHER_MAP_JSON",{});
  const admins=String(process.env.ADMIN_EMAILS||"").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
  if(admins.includes(email)) return {authenticated:true,email,role:"admin",displayName:principal.userDetails};
  if(sectionMap[email]) return {authenticated:true,email,role:"sectionTeacher",displayName:principal.userDetails,...sectionMap[email]};
  if(privateMap[email]) return {authenticated:true,email,role:"privateTeacher",displayName:principal.userDetails,...privateMap[email]};
  if(parentMap[email]) return {authenticated:true,email,role:"parent",displayName:principal.userDetails,students:parentMap[email]};
  return {authenticated:true,email,role:"unassigned",displayName:principal.userDetails};
}
export function json(body,status=200){return {status,jsonBody:body,headers:{"Content-Type":"application/json; charset=utf-8"}}}
export function allowedStudentIds(access){
  if(access.role==="admin") return null;
  const list=access.students||[];
  return list.map(x=>typeof x==="string"?x:x.studentId);
}
export function ensureStudentAccess(access, studentId){
  if(access.role==="admin")return true;
  const ids=allowedStudentIds(access)||[];
  return ids.includes(studentId);
}
