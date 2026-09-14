import { app } from "@azure/functions";
import { getAccess, ensureStudentAccess, getStudentIdAliases, json } from "../lib/auth.js";
import { listByStudent } from "../lib/storage.js";
app.http("summary",{methods:["GET"],authLevel:"anonymous",route:"summary",handler:async(request)=>{
  const a=await getAccess(request);if(!a.authenticated)return json({error:"Unauthorized"},401);
  const studentId=request.query.get("studentId"),month=request.query.get("month")||new Date().toISOString().slice(0,7);
  if(!studentId||!ensureStudentAccess(a,studentId))return json({error:"Forbidden"},403);
  const start=`${month}-01`,end=`${month}-31`,aliases=await getStudentIdAliases(studentId);
  const [practiceSets,s,e,i]=await Promise.all([
    Promise.all(aliases.map(id=>listByStudent("practice",id,start,end))),
    listByStudent("section",studentId,start,end),
    listByStudent("ensemble",studentId,start,end),
    listByStudent("privateLesson",studentId,start,end)
  ]);
  const p=practiceSets.flat();
  const qualifiedMinutes=Number(process.env.PRACTICE_QUALIFIED_MINUTES||15);
  const qualifiedDays=new Set(p.filter(x=>x.qualified===true||Number(x.minutes||0)>=qualifiedMinutes).map(x=>x.eventDate)).size;
  const practiceMinutes=p.reduce((n,x)=>n+Number(x.minutes||0),0);
  const targetDays=Number(process.env.PRACTICE_TARGET_DAYS||30);
  const sectionEffective=s.filter(x=>!["cancelled"].includes(x.status));
  const ensembleEffective=e.filter(x=>!["cancelled"].includes(x.status));
  const privateEffective=i.filter(x=>!["cancelled"].includes(x.status));
  const sectionPresent=sectionEffective.filter(x=>["present","late"].includes(x.status)).length;
  const ensemblePresent=ensembleEffective.filter(x=>["present","late"].includes(x.status)).length;
  const privatePresent=privateEffective.filter(x=>["present","late"].includes(x.status)).length;
  return json({
    month,practiceQualifiedDays:qualifiedDays,practiceMinutes,practiceRate:Math.min(qualifiedDays/Math.max(targetDays,1),1),
    sectionPresent,sectionTotal:sectionEffective.length,
    ensemblePresent,ensembleTotal:ensembleEffective.length,
    privatePresent,privateTotal:privateEffective.length,
    weightedScore:null
  });
}});
