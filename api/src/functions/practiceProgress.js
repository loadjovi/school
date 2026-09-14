import { app } from "@azure/functions";
import { getAccess, json } from "../lib/auth.js";
import { listByStudent, listStudentMaster } from "../lib/storage.js";

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
    if(a.role==="admin"){
      students=(await listStudentMaster("active")).map(viewStudent);
    }else{
      students=(a.students||[]).filter(x=>x?.studentId).map(viewStudent);
    }

    const seen=new Set();
    students=students.filter(s=>s.studentId&&!seen.has(s.studentId)&&(seen.add(s.studentId),true));

    const items=await Promise.all(students.map(async s=>{
      const rows=await listByStudent("practice",s.studentId,start,end);
      const qualifiedDates=new Set(rows.filter(r=>r.qualified===true||Number(r.minutes||0)>=qualifiedMinutes).map(r=>String(r.eventDate||"")));
      const activeDates=new Set(rows.map(r=>String(r.eventDate||"")).filter(Boolean));
      const totalMinutes=rows.reduce((n,r)=>n+Number(r.minutes||0),0);
      const sorted=rows.slice().sort((a,b)=>String(b.eventDate||"").localeCompare(String(a.eventDate||""))||String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
      const recent=sorted.slice(0,8).map(r=>({
        practiceDate:String(r.eventDate||""),
        minutes:Number(r.minutes||0),
        qualified:r.qualified===true||Number(r.minutes||0)>=qualifiedMinutes,
        practiceContent:String(r.practiceContent||""),
        focus:String(r.focus||"")
      }));
      const qualifiedDays=qualifiedDates.size;
      const rate=Math.min(qualifiedDays/targetDays,1);
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
        lastPracticeDate:sorted[0]?.eventDate||"",
        recent
      };
    }));

    items.sort((a,b)=>a.practiceRate-b.practiceRate||String(a.groupName).localeCompare(String(b.groupName),"zh-Hant")||String(a.section).localeCompare(String(b.section),"zh-Hant")||String(a.name).localeCompare(String(b.name),"zh-Hant"));
    return json({month,qualifiedMinutes,targetDays,items});
  }
});
