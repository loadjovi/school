import { app } from "@azure/functions";
import { getAccess, json } from "../lib/auth.js";
import { touchTeacherLastLogin } from "../lib/storage.js";
app.http("me",{methods:["GET"],authLevel:"anonymous",route:"me",handler:async(request)=>{
  const a=await getAccess(request);
  if(!a.authenticated)return json({error:"Unauthorized"},401);
  if(["teacher","sectionTeacher","privateTeacher"].includes(a.role)){
    try{await touchTeacherLastLogin(a.email)}catch(e){console.warn("teacher last login update failed",e)}
  }
  return json({email:a.email,displayName:a.displayName,role:a.role,section:a.section||null,picture:a.picture||null,schoolId:a.schoolId||null,schoolName:a.schoolName||"",systemName:a.systemName||"",memberships:a.memberships||[],capabilities:a.capabilities||{},assignments:a.sectionAssignments||a.assignments||[],ensembleGroups:a.ensembleGroups||[],comprehensiveEnabled:a.comprehensiveEnabled===true,privateStudentIds:a.privateStudentIds||[]});
}});
