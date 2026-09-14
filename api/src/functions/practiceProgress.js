import { app } from "@azure/functions";
import { getAccess, getStudentAliasInfo, json } from "../lib/auth.js";
import { ensureTables, table, listStudentMaster } from "../lib/storage.js";

function clean(v,max=20){return String(v||"").trim().slice(0,max)}
function monthRange(raw){
  const month=/^\d{4}-\d{2}$/.test(raw)?raw:new Date().toISOString().slice(0,7);
  return {month,start:`${month}-01`,end:`${month}-31`};
}
function viewStudent(x){
  return {
    studentId:String(x.studentId||x.rowKey||""),
    name:String(x.name||x.studentName||""),
    grade:String(x.grade||""),
    groupName:String(x.groupName||""),
    section:String(x.section||"待確認"),
    instrument:String(x.instrument||"待確認")
  };
}
function viewPractice(r,qualifiedMinutes){
  const minutes=Number(r.minutes||0);
  return {
    practiceDate:String(r.eventDate||""),
    startTime:String(r.startTime||""),
    endTime:String(r.endTime||""),
    minutes,
    qualified:r.qualified===true||minutes>=qualifiedMinutes,
    practiceContent:String(r.practiceContent||""),
    focus:String(r.focus||""),
    createdAt:String(r.createdAt||"")
  };
}
async function listMonthPractice(start,end){
  await ensureTables();
  const filter=`eventDate ge '${String(start).replaceAll("'","''")}' and eventDate le '${String(end).replaceAll("'","''")}'`;
  const items=[];
  for await (const e of table("practice").listEntities({queryOptions:{filter}}))items.push(e);
  return items;
}

app.http("practiceProgress",{
  methods:["GET"],authLevel:"anonymous",route:"practice-progress",
  handler:async(request)=>{
    const a=await getAccess(request);
    if(!a.authenticated)return json({error:"Unauthorized"},401);
    const isTeacher=!!a.capabilities?.teacherSettings;
    if(a.role!=="admin"&&!isTeacher)return json({error:"Forbidden"},403);

    const {month,start,end}=monthRange(clean(request.query.get("month"),12));
    const qualifiedMinutes=Math.max(1,Number(process.env.PRACTICE_QUALIFIED_MINUTES||15));
    const targetDays=Math.max(1,Number(process.env.PRACTICE_TARGET_DAYS||30));

    let students=[];
    if(a.role==="admin")students=(await listStudentMaster("active")).map(viewStudent);
    else students=(a.students||[]).filter(x=>x?.studentId).map(viewStudent);

    const seen=new Set();
    students=students.filter(s=>s.studentId&&!seen.has(s.studentId)&&(seen.add(s.studentId),true));

    // Read this month's PracticeLog once. Besides matching Student ID aliases, we can
    // safely recover orphaned historical rows by createdBy when that parent Gmail maps
    // to exactly one canonical student.
    const monthRows=await listMonthPractice(start,end);

    const items=await Promise.all(students.map(async s=>{
      const aliasInfo=await getStudentAliasInfo(s.studentId);
      const aliasSet=new Set(aliasInfo.aliases.map(String));
      const parentSet=new Set(aliasInfo.safeParentEmails.map(x=>String(x).toLowerCase()));
      const unique=new Map();
      let matchedByIdCount=0,matchedByParentCount=0;
      for(const r of monthRows){
        const partition=String(r.partitionKey||"");
        const creator=String(r.createdBy||"").trim().toLowerCase();
        const byId=aliasSet.has(partition);
        const byParent=!byId&&creator&&parentSet.has(creator);
        if(!byId&&!byParent)continue;
        const key=`${partition}|${String(r.rowKey||"")}`;
        if(!unique.has(key)){
          unique.set(key,r);
          if(byId)matchedByIdCount++;else if(byParent)matchedByParentCount++;
        }
      }
      const rows=[...unique.values()];
      const records=rows.map(r=>viewPractice(r,qualifiedMinutes)).sort((a,b)=>
        String(b.practiceDate).localeCompare(String(a.practiceDate))||String(b.createdAt).localeCompare(String(a.createdAt))
      );
      const qualifiedDates=new Set(records.filter(r=>r.qualified).map(r=>r.practiceDate).filter(Boolean));
      const activeDates=new Set(records.map(r=>r.practiceDate).filter(Boolean));
      const totalMinutes=records.reduce((n,r)=>n+r.minutes,0);
      const qualifiedDays=qualifiedDates.size;
      const rate=Math.min(qualifiedDays/targetDays,1);
      const score10=Math.round(rate*100)/10;
      return {
        ...s,
        activeDays:activeDates.size,
        qualifiedDays,
        totalMinutes,
        averageMinutes:activeDates.size?Math.round(totalMinutes/activeDates.size):0,
        targetDays,
        qualifiedMinutes,
        practiceRate:rate,
        practiceRatePercent:Math.round(rate*1000)/10,
        practiceScore10:score10,
        lastPracticeDate:records[0]?.practiceDate||"",
        recent:records.slice(0,8),
        records,
        sourceMatchCount:records.length,
        matchedByIdCount,
        matchedByParentCount
      };
    }));

    items.sort((a,b)=>a.practiceRate-b.practiceRate||String(a.groupName).localeCompare(String(b.groupName),"zh-Hant")||String(a.section).localeCompare(String(b.section),"zh-Hant")||String(a.name).localeCompare(String(b.name),"zh-Hant"));
    return json({month,qualifiedMinutes,targetDays,scoreWeight:10,items});
  }
});
