import { app } from "@azure/functions";
import { getAccess, ensureStudentAccess, getStudentIdAliases, json } from "../lib/auth.js";
import { listByStudent, getStudentMaster, semesterLabel } from "../lib/storage.js";

function safeInt(v){const n=Number.parseInt(String(v||""),10);return Number.isFinite(n)?n:0}
function taipeiDate(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())}
function currentRocTerm(){
  const now=new Date();
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Taipei",year:"numeric",month:"numeric"}).formatToParts(now);
  const y=Number(parts.find(x=>x.type==="year")?.value||new Date().getFullYear());
  const m=Number(parts.find(x=>x.type==="month")?.value||new Date().getMonth()+1);
  if(m>=8)return {schoolYear:String(y-1911),semester:"1"};
  return {schoolYear:String(y-1912),semester:"2"};
}
function termRange(schoolYear,semester){
  const roc=safeInt(schoolYear),greg=roc+1911,s=String(semester||"");
  if(!roc||!["1","2"].includes(s))return null;
  if(s==="1")return {start:`${greg}-08-01`,end:`${greg+1}-01-31`};
  return {start:`${greg+1}-02-01`,end:`${greg+1}-07-31`};
}
function blank(){return {present:0,late:0,leave:0,absent:0,cancelled:0,total:0,attended:0,rate:null}}
function addStat(bucket,status){
  if(status in bucket)bucket[status]++;
  if(status!=="cancelled")bucket.total++;
  if(status==="present"||status==="late")bucket.attended++;
}
function finish(bucket){bucket.rate=bucket.total?Math.round(bucket.attended/bucket.total*1000)/10:null;return bucket}
function classTypeFor(key,row){
  if(key==="section")return "section";
  if(key==="ensemble")return "ensemble";
  if(key==="comprehensive")return "comprehensive";
  return String(row.classType||"privateLesson");
}
async function recordsForAliases(key,aliases,start,end){
  const sets=await Promise.all(aliases.map(id=>listByStudent(key,id,start,end)));
  const latest=new Map();
  for(const row of sets.flat()){
    const r={
      studentId:String(row.partitionKey||""),eventDate:String(row.eventDate||""),classType:classTypeFor(key,row),
      groupName:String(row.groupName||""),section:String(row.section||""),status:String(row.status||""),minutes:Number(row.minutes||0),
      teacher:String(row.teacher||""),createdAt:String(row.createdAt||""),rowKey:String(row.rowKey||"")
    };
    const dedupe=[r.eventDate,r.classType,r.groupName,r.section].join("|");
    const old=latest.get(dedupe),stamp=`${r.createdAt}|${r.rowKey}`,oldStamp=old?`${old.createdAt}|${old.rowKey}`:"";
    if(!old||stamp>=oldStamp)latest.set(dedupe,r);
  }
  return [...latest.values()];
}

app.http("parentSemesterAttendance",{
  methods:["GET"],authLevel:"anonymous",route:"parent-semester-attendance",
  handler:async request=>{
    const access=await getAccess(request);
    if(!access.authenticated)return json({error:"Unauthorized"},401);
    if(access.role!=="parent"&&access.role!=="admin")return json({error:"Forbidden"},403);
    const studentId=String(request.query.get("studentId")||"").trim();
    if(!studentId||!ensureStudentAccess(access,studentId))return json({error:"Forbidden"},403);

    const master=await getStudentMaster(studentId);
    const fallback=currentRocTerm();
    const schoolYear=String(request.query.get("schoolYear")||master?.schoolYear||fallback.schoolYear).trim();
    const semester=String(request.query.get("semester")||master?.semester||fallback.semester).trim();
    const range=termRange(schoolYear,semester);
    if(!range)return json({error:"學年度或學期格式不正確"},400);
    const today=taipeiDate(),end=today<range.end?today:range.end;
    const aliases=await getStudentIdAliases(studentId);
    const [sectionRows,ensembleRows,comprehensiveRows,privateRows]=await Promise.all([
      recordsForAliases("section",aliases,range.start,end),
      recordsForAliases("ensemble",aliases,range.start,end),
      recordsForAliases("comprehensive",aliases,range.start,end),
      recordsForAliases("privateLesson",aliases,range.start,end)
    ]);
    const records=[...sectionRows,...ensembleRows,...comprehensiveRows,...privateRows]
      .sort((a,b)=>String(b.eventDate).localeCompare(String(a.eventDate))||String(b.createdAt).localeCompare(String(a.createdAt)));
    const stats={section:blank(),ensemble:blank(),comprehensive:blank(),privateLesson:blank(),overall:blank()};
    for(const r of records){
      const key=r.classType==="ensemble"?"ensemble":r.classType==="comprehensive"?"comprehensive":r.classType==="private"||r.classType==="privateLesson"?"privateLesson":"section";
      addStat(stats[key],r.status);addStat(stats.overall,r.status);
    }
    Object.values(stats).forEach(finish);
    return json({
      studentId,schoolYear,semester,semesterName:semesterLabel(semester)||`${semester}學期`,
      start:range.start,end,termEnd:range.end,asOf:today,
      student:master?{name:String(master.studentName||""),grade:String(master.grade||""),groupName:String(master.groupName||""),section:String(master.section||"待確認"),instrument:String(master.instrument||"")}:null,
      stats,records
    });
  }
});
