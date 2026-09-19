import { app } from "@azure/functions";
import { getTenantContext, ensureStudentAccess, getStudentIdAliases, json } from "../lib/auth.js";
import { listByStudent, getStudentMaster, activityStudentId } from "../lib/storage.js";
function taipeiDate(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())}
function latestForDate(rows,date){return [...(rows||[])].filter(x=>String(x.eventDate||"").slice(0,10)===date).sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")))[0]||null}
function todayCoursesFor(student,date,sectionRows,ensembleRows,comprehensiveRows){
  const groupRaw=String(student?.groupName||""),group=groupRaw==="C"?"儲備":groupRaw;
  const weekday=new Date(date+"T12:00:00+08:00").getDay();
  const comprehensiveDates=new Set(["2026-09-18","2026-10-02","2026-10-16","2026-10-30","2026-11-20","2026-11-27","2026-12-04"]);
  const courses=[];
  const add=(key,label,time,rows)=>{const r=latestForDate(rows,date);courses.push({key,label,time,status:r?String(r.status||""):"",recorded:!!r})};
  if(group==="A"&&(weekday===1||weekday===3))add("section","A團分部課","依分部課時段",sectionRows);
  if(group==="B"&&(weekday===2||weekday===4))add("section","B團分部課","依分部課時段",sectionRows);
  if(group==="儲備"&&weekday===5&&date>="2026-10-02")add("section","儲備團分部課","每週五｜10/2 起",sectionRows);
  if(["A","B"].includes(group)&&weekday===2)add("ensemble","A、B團合奏課","12:30–13:20",ensembleRows);
  if(["A","B","儲備"].includes(group)&&comprehensiveDates.has(date))add("comprehensive","弦樂團體課（綜合課）","08:45–10:15",comprehensiveRows);
  return courses;
}
async function rowsForAliases(key,aliases,start,end,schoolId){
  const sets=await Promise.all(aliases.map(id=>listByStudent(key,id,start,end,schoolId))),latest=new Map();
  for(const row of sets.flat()){
    const studentId=activityStudentId(row),classType=String(row.classType||key),sessionId=String(row.sessionId||"");
    const dedupe=key==="practice"
      ?[studentId,String(row.rowKey||"")].join("|")
      :key==="privateLesson"
        ?[studentId,String(row.eventDate||""),classType,sessionId||String(row.rowKey||"")].join("|")
        :[String(row.eventDate||""),classType,String(row.groupName||""),String(row.section||"")].join("|");
    const old=latest.get(dedupe),stamp=`${String(row.createdAt||"")}|${String(row.rowKey||"")}`,oldStamp=old?`${String(old.createdAt||"")}|${String(old.rowKey||"")}`:"";
    if(!old||stamp>=oldStamp)latest.set(dedupe,row);
  }
  return [...latest.values()];
}
app.http("summary",{methods:["GET"],authLevel:"anonymous",route:"summary",handler:async(request)=>{
  const context=await getTenantContext(request);if(context.error)return context.error;
  const {access:a,schoolId}=context;
  const studentId=request.query.get("studentId"),month=request.query.get("month")||new Date().toISOString().slice(0,7);
  if(!studentId||!ensureStudentAccess(a,studentId))return json({error:"Forbidden"},403);
  const start=`${month}-01`,end=`${month}-31`,aliases=await getStudentIdAliases(studentId,schoolId),today=taipeiDate();
  const [p,s,e,c,i]=await Promise.all([
    rowsForAliases("practice",aliases,start,end,schoolId),
    rowsForAliases("section",aliases,start,end,schoolId),
    rowsForAliases("ensemble",aliases,start,end,schoolId),
    rowsForAliases("comprehensive",aliases,start,end,schoolId),
    rowsForAliases("privateLesson",aliases,start,end,schoolId)
  ]);
  const qualifiedMinutes=Number(process.env.PRACTICE_QUALIFIED_MINUTES||15);
  const qualifiedDays=new Set(p.filter(x=>x.qualified===true||Number(x.minutes||0)>=qualifiedMinutes).map(x=>x.eventDate)).size;
  const practiceMinutes=p.reduce((n,x)=>n+Number(x.minutes||0),0);
  const targetDays=Number(process.env.PRACTICE_TARGET_DAYS||30);
  const sectionEffective=s.filter(x=>!["cancelled"].includes(x.status));
  const ensembleEffective=e.filter(x=>!["cancelled"].includes(x.status));
  const comprehensiveEffective=c.filter(x=>!["cancelled"].includes(x.status));
  // 預約、老師已完課待家長確認與爭議中的資料都不是正式出勤；家長確認後才會轉為 present／late。
  const privateEffective=i.filter(x=>["present","late","leave","absent"].includes(String(x.status||"")));
  const sectionPresent=sectionEffective.filter(x=>["present","late"].includes(x.status)).length;
  const ensemblePresent=ensembleEffective.filter(x=>["present","late"].includes(x.status)).length;
  const comprehensivePresent=comprehensiveEffective.filter(x=>["present","late"].includes(x.status)).length;
  const privatePresent=privateEffective.filter(x=>["present","late"].includes(x.status)).length;
  const master=await getStudentMaster(studentId,schoolId);
  const todayCourses=todayCoursesFor(master,today,s,e,c);
  return json({
    month,practiceQualifiedDays:qualifiedDays,practiceMinutes,practiceRate:Math.min(qualifiedDays/Math.max(targetDays,1),1),
    sectionPresent,sectionTotal:sectionEffective.length,
    ensemblePresent,ensembleTotal:ensembleEffective.length,
    comprehensivePresent,comprehensiveTotal:comprehensiveEffective.length,
    privatePresent,privateTotal:privateEffective.length,
    today,todayCourses,
    weightedScore:null
  });
}});
