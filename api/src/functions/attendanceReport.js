import { app } from "@azure/functions";
import { getAccess, json } from "../lib/auth.js";
import { ensureTables, table, listStudentMaster } from "../lib/storage.js";

function clean(v,max=80){return String(v||"").trim().slice(0,max)}
function monthRange(month){
  const m=/^\d{4}-\d{2}$/.test(month)?month:new Date().toISOString().slice(0,7);
  return {month:m,start:`${m}-01`,end:`${m}-31`};
}
function studentView(e){
  return {studentId:e.rowKey,name:e.studentName,grade:e.grade,groupName:e.groupName,instrument:e.instrument,section:e.section||"待確認",schoolYear:e.schoolYear||"",status:e.status||"active"};
}
async function listRange(key,start,end,allowedIds){
  const rows=[];
  const filter=`eventDate ge '${start}' and eventDate le '${end}'`;
  for await (const e of table(key).listEntities({queryOptions:{filter}})){
    if(allowedIds&&!allowedIds.has(String(e.partitionKey)))continue;
    rows.push({
      studentId:String(e.partitionKey),
      eventDate:String(e.eventDate||""),
      classType:String(e.classType||key),
      groupName:String(e.groupName||""),
      section:String(e.section||""),
      status:String(e.status||""),
      minutes:Number(e.minutes||0),
      teacher:String(e.teacher||""),
      createdAt:String(e.createdAt||"")
    });
  }
  return rows;
}
function blank(){return {present:0,late:0,leave:0,absent:0,cancelled:0,total:0,attended:0}}
function add(bucket,status){
  if(status in bucket)bucket[status]++;
  if(status!=="cancelled")bucket.total++;
  if(status==="present"||status==="late")bucket.attended++;
}

app.http("attendanceReport",{
  methods:["GET"],authLevel:"anonymous",route:"attendance-report",
  handler:async(request)=>{
    const a=await getAccess(request);
    if(!a.authenticated)return json({error:"Unauthorized"},401);
    const isTeacher=!!a.capabilities?.teacherSettings;
    if(a.role!=="admin"&&!isTeacher)return json({error:"Forbidden"},403);
    const {month,start,end}=monthRange(clean(request.query.get("month"),12));
    await ensureTables();

    let students;
    if(a.role==="admin"){
      students=(await listStudentMaster("active")).map(studentView);
    }else{
      students=(a.students||[]).filter(x=>x?.studentId).map(x=>({
        studentId:String(x.studentId),name:x.name,grade:x.grade,groupName:x.groupName,instrument:x.instrument,section:x.section||"待確認",schoolYear:x.schoolYear||"",status:x.status||"active"
      }));
    }
    const byId=new Map(students.map(s=>[String(s.studentId),s]));
    const allowedIds=new Set(byId.keys());
    const [sectionRows,ensembleRows,privateRows]=await Promise.all([
      listRange("section",start,end,allowedIds),
      listRange("ensemble",start,end,allowedIds),
      listRange("privateLesson",start,end,allowedIds)
    ]);
    const records=[...sectionRows,...ensembleRows,...privateRows].sort((a,b)=>String(b.eventDate).localeCompare(String(a.eventDate))||String(b.createdAt).localeCompare(String(a.createdAt)));
    const agg=new Map();
    for(const s of students)agg.set(String(s.studentId),{...s,sectionStats:blank(),ensembleStats:blank(),privateStats:blank(),overall:blank()});
    for(const r of records){
      const x=agg.get(String(r.studentId));if(!x)continue;
      const key=r.classType==="ensemble"?"ensembleStats":r.classType==="private"||r.classType==="privateLesson"?"privateStats":"sectionStats";
      add(x[key],r.status);add(x.overall,r.status);
    }
    const items=[...agg.values()].map(x=>({...x,attendanceRate:x.overall.total?Math.round(x.overall.attended/x.overall.total*1000)/10:null})).sort((a,b)=>String(a.groupName).localeCompare(String(b.groupName),"zh-Hant")||String(a.section).localeCompare(String(b.section),"zh-Hant")||String(a.name).localeCompare(String(b.name),"zh-Hant"));
    return json({month,start,end,items,records});
  }
});
