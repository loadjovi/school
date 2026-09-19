import { app } from "@azure/functions";
import { getTenantContext, parseJsonEnv, json } from "../lib/auth.js";
import { listAllMappedStudents, defaultTenantId } from "../lib/storage.js";

function staticStudents(){
  const parentMap=parseJsonEnv("STUDENT_MAP_JSON",{});
  const sectionMap=parseJsonEnv("SECTION_TEACHER_MAP_JSON",{});
  const privateMap=parseJsonEnv("PRIVATE_TEACHER_MAP_JSON",{});
  const m=new Map();
  for(const map of [parentMap,sectionMap,privateMap])for(const v of Object.values(map)){
    const list=Array.isArray(v)?v:(v.students||[]);
    for(const s of list){if(typeof s==="object"&&s.studentId)m.set(s.studentId,s)}
  }
  return [...m.values()];
}

app.http("students",{
  methods:["GET"],
  authLevel:"anonymous",
  route:"students",
  handler:async(request)=>{
    const context=await getTenantContext(request,{allowUnassigned:true});if(context.error)return context.error;
    const {access:a,schoolId}=context;
    if(a.role==="admin"){
      const m=new Map();
      if(schoolId===defaultTenantId())for(const s of staticStudents())m.set(s.studentId,s);
      for(const s of await listAllMappedStudents(schoolId))m.set(s.studentId,s);
      return json([...m.values()]);
    }
    if(a.role==="unassigned")return json([]);
    return json(a.students||[]);
  }
});
