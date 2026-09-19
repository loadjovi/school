import { app } from "@azure/functions";
import { getAccess, json, parseJsonEnv } from "../lib/auth.js";
import { touchTeacherLastLogin, listTenantRolesByEmail, getTenantDirectory, getTeacherDirectory, getMappedStudentsByEmail, defaultTenantId } from "../lib/storage.js";
app.http("me",{methods:["GET"],authLevel:"anonymous",route:"me",handler:async(request)=>{
  const a=await getAccess(request);
  if(!a.authenticated)return json({error:"Unauthorized"},401);

  const contexts=[];
  const seen=new Set();
  const addContext=x=>{
    const key=String(x.key||"");
    if(!key||seen.has(key))return;
    seen.add(key);contexts.push(x);
  };

  let tenantRoles=[];
  try{tenantRoles=await listTenantRolesByEmail(a.email,"active")}catch(e){console.warn("context tenant role lookup failed",e)}
  if(tenantRoles.some(x=>x.role==="globalAdmin")||a.capabilities?.globalAdmin===true){
    addContext({key:"global",type:"global",role:"globalAdmin",label:"Global 管理中心",icon:"🌐",schoolId:null,schoolName:"",status:"active"});
  }

  for(const r of tenantRoles.filter(x=>x.role==="schoolAdmin"&&x.schoolId&&x.schoolId!=="*")){
    const t=await getTenantDirectory(r.schoolId);
    addContext({
      key:"schoolAdmin:"+r.schoolId,
      type:"schoolAdmin",role:"schoolAdmin",label:(t?.schoolName||r.schoolId)+"｜學校管理員",icon:"🏫",
      schoolId:r.schoolId,schoolName:String(t?.schoolName||r.schoolId),status:String(t?.status||"setup")
    });
  }

  const defaultId=defaultTenantId();
  const defaultTenant=await getTenantDirectory(defaultId);
  try{
    const teacher=await getTeacherDirectory(a.email);
    if(teacher?.status==="active"){
      addContext({key:"teacher:"+defaultId,type:"teacher",role:"teacher",label:(defaultTenant?.schoolName||"聖心小學")+"｜老師",icon:"🎻",schoolId:defaultId,schoolName:String(defaultTenant?.schoolName||"聖心小學"),status:String(defaultTenant?.status||"active")});
    }
  }catch(e){console.warn("teacher context lookup failed",e)}

  try{
    const staticMap=parseJsonEnv("STUDENT_MAP_JSON",{});
    const staticParent=!!staticMap[String(a.email||"").toLowerCase()];
    const dynamic=staticParent?[]:await getMappedStudentsByEmail(a.email);
    if(staticParent||dynamic.length){
      addContext({key:"parent:"+defaultId,type:"parent",role:"parent",label:(defaultTenant?.schoolName||"聖心小學")+"｜家長",icon:"👨‍👩‍👧",schoolId:defaultId,schoolName:String(defaultTenant?.schoolName||"聖心小學"),status:String(defaultTenant?.status||"active")});
    }
  }catch(e){console.warn("parent context lookup failed",e)}

  const requestedType=String(request.headers.get("x-role-context")||"").trim();
  const requestedSchoolId=String(request.headers.get("x-school-id")||"").trim().toLowerCase();
  const teacherRoles=["teacher","sectionTeacher","ensembleTeacher","comprehensiveTeacher","privateTeacher"];
  if(teacherRoles.includes(a.role)&&(requestedType==="teacher"||(!requestedType&&contexts.length===1))){
    try{await touchTeacherLastLogin(a.email)}catch(e){console.warn("teacher last login update failed",e)}
  }

  let activeContextKey="";
  if(requestedType==="global")activeContextKey="global";
  else if(requestedType&&requestedSchoolId)activeContextKey=requestedType+":"+requestedSchoolId;
  else if(a.role==="globalAdmin")activeContextKey="global";
  else if(a.role==="admin"&&a.schoolId)activeContextKey="schoolAdmin:"+a.schoolId;
  else if(["teacher","sectionTeacher","ensembleTeacher","comprehensiveTeacher","privateTeacher"].includes(a.role)&&a.schoolId)activeContextKey="teacher:"+a.schoolId;
  else if(a.role==="parent"&&a.schoolId)activeContextKey="parent:"+a.schoolId;

  return json({
    identityId:a.sub||"",email:a.email,displayName:a.displayName,role:a.role,section:a.section||null,picture:a.picture||null,
    schoolId:a.schoolId||null,schoolName:a.schoolName||"",systemName:a.systemName||"",
    memberships:a.memberships||[],capabilities:a.capabilities||{},
    assignments:a.sectionAssignments||a.assignments||[],ensembleGroups:a.ensembleGroups||[],
    comprehensiveEnabled:a.comprehensiveEnabled===true,privateStudentIds:a.privateStudentIds||[],
    contexts,activeContextKey
  });
}});
