import { app } from "@azure/functions";
import { getTenantContext, ensureStudentAccess, getStudentIdAliases, json } from "../lib/auth.js";
import { listByStudent, getStudentMaster, semesterLabel, activityStudentId } from "../lib/storage.js";

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
  if(!["present","late","leave","absent","cancelled"].includes(status))return;
  if(status in bucket)bucket[status]++;
  if(status!=="cancelled")bucket.total++;
  if(status==="present"||status==="late")bucket.attended++;
}
function finish(bucket){bucket.rate=bucket.total?Math.round(bucket.attended/bucket.total*1000)/10:null;return bucket}
function round2(v){return Math.round(Number(v||0)*100)/100}
function monthKeys(start,end){
  const out=[];let y=Number(start.slice(0,4)),m=Number(start.slice(5,7)),ey=Number(end.slice(0,4)),em=Number(end.slice(5,7));
  while(y<ey||(y===ey&&m<=em)){out.push(`${y}-${String(m).padStart(2,"0")}`);m++;if(m>12){m=1;y++}}
  return out;
}
function monthTargetDays(month,start,end,targetDays){
  const first=`${month}-01`,last=`${month}-${String(new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).getDate()).padStart(2,"0")}`;
  const from=start>first?start:first,to=end<last?end:last;
  if(from>to)return 0;
  const days=Math.floor((new Date(to+"T12:00:00Z")-new Date(from+"T12:00:00Z"))/86400000)+1;
  return Math.min(Math.max(0,days),Math.max(1,targetDays));
}
async function practiceDatesForAliases(aliases,start,end,schoolId){
  const sets=await Promise.all(aliases.map(id=>listByStudent("practice",id,start,end,schoolId))),dates=new Set();
  for(const row of sets.flat()){const d=String(row.eventDate||"").slice(0,10);if(d>=start&&d<=end)dates.add(d)}
  return dates;
}
function classTypeFor(key,row){
  if(key==="section")return "section";
  if(key==="ensemble")return "ensemble";
  if(key==="comprehensive")return "comprehensive";
  return String(row.classType||"privateLesson");
}
async function recordsForAliases(key,aliases,start,end,schoolId){
  const sets=await Promise.all(aliases.map(id=>listByStudent(key,id,start,end,schoolId)));
  const latest=new Map();
  for(const row of sets.flat()){
    const r={
      studentId:activityStudentId(row),eventDate:String(row.eventDate||""),classType:classTypeFor(key,row),
      groupName:String(row.groupName||""),section:String(row.section||""),status:String(row.status||""),minutes:Number(row.minutes||0),
      teacher:String(row.teacher||""),createdAt:String(row.createdAt||""),rowKey:String(row.rowKey||""),sessionId:String(row.sessionId||"")
    };
    const dedupe=key==="privateLesson"
      ?[r.eventDate,r.classType,r.sessionId||r.rowKey].join("|")
      :[r.eventDate,r.classType,r.groupName,r.section].join("|");
    const old=latest.get(dedupe),stamp=`${r.createdAt}|${r.rowKey}`,oldStamp=old?`${old.createdAt}|${old.rowKey}`:"";
    if(!old||stamp>=oldStamp)latest.set(dedupe,r);
  }
  return [...latest.values()];
}

app.http("parentSemesterAttendance",{
  methods:["GET"],authLevel:"anonymous",route:"parent-semester-attendance",
  handler:async request=>{
    const context=await getTenantContext(request);if(context.error)return context.error;
    const {access,schoolId}=context;
    if(access.role!=="parent"&&access.role!=="admin")return json({error:"Forbidden"},403);
    const studentId=String(request.query.get("studentId")||"").trim();
    if(!studentId||!ensureStudentAccess(access,studentId))return json({error:"Forbidden"},403);

    const master=await getStudentMaster(studentId,schoolId);
    const fallback=currentRocTerm();
    const schoolYear=String(request.query.get("schoolYear")||master?.schoolYear||fallback.schoolYear).trim();
    const semester=String(request.query.get("semester")||master?.semester||fallback.semester).trim();
    const range=termRange(schoolYear,semester);
    if(!range)return json({error:"學年度或學期格式不正確"},400);
    const today=taipeiDate(),end=today<range.end?today:range.end;
    const aliases=await getStudentIdAliases(studentId,schoolId);
    const scoringStartRaw=String(process.env.PRACTICE_SCORING_START_DATE||"2026-10-01").trim();
    const scoringStart=/^\d{4}-\d{2}-\d{2}$/.test(scoringStartRaw)&&scoringStartRaw>range.start?scoringStartRaw:range.start;
    const practiceEnd=end<scoringStart?scoringStart:end;
    const [sectionRows,ensembleRows,comprehensiveRows,privateRows,practiceDates]=await Promise.all([
      recordsForAliases("section",aliases,range.start,end,schoolId),
      recordsForAliases("ensemble",aliases,range.start,end,schoolId),
      recordsForAliases("comprehensive",aliases,range.start,end,schoolId),
      recordsForAliases("privateLesson",aliases,range.start,end,schoolId),
      end>=scoringStart?practiceDatesForAliases(aliases,scoringStart,end,schoolId):Promise.resolve(new Set())
    ]);
    const records=[...sectionRows,...ensembleRows,...comprehensiveRows,...privateRows.filter(r=>["present","late","leave","absent","cancelled"].includes(r.status))]
      .sort((a,b)=>String(b.eventDate).localeCompare(String(a.eventDate))||String(b.createdAt).localeCompare(String(a.createdAt)));
    const stats={section:blank(),ensemble:blank(),comprehensive:blank(),privateLesson:blank(),overall:blank()};
    for(const r of records){
      const key=r.classType==="ensemble"?"ensemble":r.classType==="comprehensive"?"comprehensive":r.classType==="private"||r.classType==="privateLesson"?"privateLesson":"section";
      addStat(stats[key],r.status);addStat(stats.overall,r.status);
    }
    Object.values(stats).forEach(finish);
    const monthlyTarget=Math.max(1,Number(process.env.PRACTICE_TARGET_DAYS||30));
    const practiceTargetDays=end>=scoringStart?monthKeys(scoringStart,end).reduce((n,m)=>n+monthTargetDays(m,scoringStart,end,monthlyTarget),0):0;
    const practiceDays=practiceDates.size;
    const practiceScore=practiceTargetDays?round2(Math.min(practiceDays/practiceTargetDays,1)*10):0;
    const sectionScore=stats.section.total?round2((stats.section.attended/stats.section.total)*5):0;
    const privateBonus=stats.privateLesson.total?round2((stats.privateLesson.attended/stats.privateLesson.total)*5):0;
    const finalScore=round2(Math.min(20,practiceScore+sectionScore+privateBonus));
    return json({
      studentId,schoolYear,semester,semesterName:semesterLabel(semester)||`${semester}學期`,
      start:range.start,end,termEnd:range.end,asOf:today,
      student:master?{name:String(master.studentName||""),grade:String(master.grade||""),groupName:String(master.groupName||""),section:String(master.section||"待確認"),instrument:String(master.instrument||"")}:null,
      stats,records,
      semesterScore:{
        max:20,
        practice:{score:practiceScore,max:10,days:practiceDays,targetDays:practiceTargetDays,start:scoringStart,end},
        sectionAttendance:{score:sectionScore,max:5,attended:stats.section.attended,total:stats.section.total,rate:stats.section.rate},
        privateLessonBonus:{score:privateBonus,max:5,attended:stats.privateLesson.attended,total:stats.privateLesson.total,rate:stats.privateLesson.rate,optional:true},
        total:finalScore
      }
    });
  }
});
