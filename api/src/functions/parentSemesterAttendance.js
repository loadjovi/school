import { app } from "@azure/functions";
import { getTenantContext, ensureStudentAccess, getStudentIdAliases, json } from "../lib/auth.js";
import { listByStudent, getStudentMaster, semesterLabel, activityStudentId, ensureTenantTables, table, tenantStudentPartition } from "../lib/storage.js";

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
function scoreMonths(schoolYear,semester){
  const roc=safeInt(schoolYear),greg=roc+1911;
  if(String(semester)==="1")return [10,11,12].map(m=>`${greg}-${String(m).padStart(2,"0")}`);
  return [2,3,4,5].map(m=>`${greg+1}-${String(m).padStart(2,"0")}`);
}
function monthDays(month){const [y,m]=String(month).split("-").map(Number);return new Date(y,m,0).getDate()}
function round2(v){return Math.round(Number(v||0)*100)/100}
function average(values){const xs=values.filter(v=>v!=null&&Number.isFinite(Number(v))).map(Number);return xs.length?round2(xs.reduce((a,b)=>a+b,0)/xs.length):null}
async function practiceForAliases(aliases,start,end,schoolId){
  const sets=await Promise.all(aliases.map(id=>listByStudent("practice",id,start,end,schoolId)));
  const latest=new Map();
  for(const row of sets.flat()){
    const key=[activityStudentId(row),String(row.rowKey||"")].join("|");
    const old=latest.get(key),stamp=`${String(row.createdAt||"")}|${String(row.rowKey||"")}`,oldStamp=old?`${String(old.createdAt||"")}|${String(old.rowKey||"")}`:"";
    if(!old||stamp>=oldStamp)latest.set(key,row);
  }
  return [...latest.values()];
}
async function monthlyEvaluationsForAliases(aliases,schoolId){
  const rows=[],seen=new Set();
  for(const id of aliases){
    const partition=tenantStudentPartition(schoolId,id);
    for await(const e of table("tenantPracticeMonthlyEvaluation").listEntities({queryOptions:{filter:`PartitionKey eq '${String(partition).replaceAll("'","''")}'`}})){
      const key=`${e.partitionKey}|${e.rowKey}`;if(seen.has(key))continue;seen.add(key);
      rows.push({month:String(e.evaluationMonth||""),rating:Number(e.rating||0),teacherEmail:String(e.teacherEmail||"")});
    }
  }
  return rows;
}
async function learningEvaluationsForAliases(aliases,schoolId){
  const rows=[],seen=new Set();
  for(const id of aliases){
    const partition=tenantStudentPartition(schoolId,id);
    for await(const e of table("tenantLearningMonthlyEvaluation").listEntities({queryOptions:{filter:`PartitionKey eq '${String(partition).replaceAll("'","''")}'`}})){
      const key=`${e.partitionKey}|${e.rowKey}`;if(seen.has(key))continue;seen.add(key);
      rows.push({
        month:String(e.evaluationMonth||""),
        attitude:Number(e.attitude||0),preparation:Number(e.preparation||0),progress:Number(e.progress||0),teamwork:Number(e.teamwork||0),
        score5:Number(e.score5||0),teacherEmail:String(e.teacherEmail||"")
      });
    }
  }
  return rows;
}
function blank(){return {present:0,late:0,leave:0,absent:0,cancelled:0,total:0,attended:0,rate:null}}
function addStat(bucket,status){
  if(!["present","late","leave","absent","cancelled"].includes(status))return;
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
    await ensureTenantTables();
    const [sectionRows,ensembleRows,comprehensiveRows,privateRows,practiceRows,monthlyEvaluations,learningEvaluations]=await Promise.all([
      recordsForAliases("section",aliases,range.start,end,schoolId),
      recordsForAliases("ensemble",aliases,range.start,end,schoolId),
      recordsForAliases("comprehensive",aliases,range.start,end,schoolId),
      recordsForAliases("privateLesson",aliases,range.start,end,schoolId),
      practiceForAliases(aliases,range.start,end,schoolId),
      monthlyEvaluationsForAliases(aliases,schoolId),
      learningEvaluationsForAliases(aliases,schoolId)
    ]);
    const records=[...sectionRows,...ensembleRows,...comprehensiveRows,...privateRows.filter(r=>["present","late","leave","absent","cancelled"].includes(r.status))]
      .sort((a,b)=>String(b.eventDate).localeCompare(String(a.eventDate))||String(b.createdAt).localeCompare(String(a.createdAt)));
    const stats={section:blank(),ensemble:blank(),comprehensive:blank(),privateLesson:blank(),overall:blank()};
    for(const r of records){
      const key=r.classType==="ensemble"?"ensemble":r.classType==="comprehensive"?"comprehensive":r.classType==="private"||r.classType==="privateLesson"?"privateLesson":"section";
      addStat(stats[key],r.status);addStat(stats.overall,r.status);
    }
    Object.values(stats).forEach(finish);

    // 正式學期成績：自主練習 10%＋日常團體課出勤 5%＋學習參與與進步 5%。
    // 上學期 9 月為試營運，不納入正式平均；個別課只作升等參考／學習佐證，不直接計分。
    const months=scoreMonths(schoolYear,semester),currentMonth=today.slice(0,7);
    const qualifiedMinutes=Number(process.env.PRACTICE_QUALIFIED_MINUTES||15);
    const practiceTargetDays=Number(process.env.PRACTICE_TARGET_DAYS||30);
    const monthlyScores=months.map(month=>{
      const future=month>currentMonth;
      const p=practiceRows.filter(x=>String(x.eventDate||"").startsWith(month));
      const qualifiedDays=new Set(p.filter(x=>x.qualified===true||Number(x.minutes||0)>=qualifiedMinutes).map(x=>String(x.eventDate||""))).size;
      const days=monthDays(month),elapsed=month===currentMonth?Number(today.slice(8,10)):days;
      const targetDays=Math.max(1,Math.min(practiceTargetDays,elapsed));
      const practicePoints=round2(Math.min(qualifiedDays/targetDays,1)*7);
      const evalRows=monthlyEvaluations.filter(x=>x.month===month&&x.rating>=1&&x.rating<=5);
      const teacherAverage=evalRows.length?round2(evalRows.reduce((n,x)=>n+x.rating,0)/evalRows.length):null;
      const teacherPoints=teacherAverage==null?null:round2(teacherAverage/5*3);
      const practiceScore10=future||teacherPoints==null?null:round2(practicePoints+teacherPoints);

      // 核准請假與停課不列入出勤分母；遲到仍計入到課；缺席才影響分數。
      const groupRows=[...sectionRows,...ensembleRows,...comprehensiveRows].filter(x=>String(x.eventDate||"").startsWith(month)&&x.status!=="cancelled");
      const attendanceEligible=groupRows.filter(x=>x.status!=="leave");
      const attendanceTotal=attendanceEligible.length;
      const attendancePresent=attendanceEligible.filter(x=>x.status==="present"||x.status==="late").length;
      const attendanceLeave=groupRows.filter(x=>x.status==="leave").length;
      const attendanceAbsent=groupRows.filter(x=>x.status==="absent").length;
      const attendanceScore5=future||!attendanceTotal?null:round2(Math.min(attendancePresent/attendanceTotal,1)*5);

      const learnRows=learningEvaluations.filter(x=>x.month===month&&x.score5>0);
      const learningScore5=future||!learnRows.length?null:round2(learnRows.reduce((n,x)=>n+x.score5,0)/learnRows.length);
      const avgCriterion=key=>learnRows.length?round2(learnRows.reduce((n,x)=>n+Number(x[key]||0),0)/learnRows.length):null;

      const monthPrivate=privateRows.filter(x=>String(x.eventDate||"").startsWith(month));
      const privateCompleted=monthPrivate.filter(x=>["present","late"].includes(String(x.status||""))).length;
      const privateCancelled=monthPrivate.filter(x=>String(x.status||"")==="cancelled").length;

      const total20=practiceScore10==null||attendanceScore5==null||learningScore5==null?null:round2(practiceScore10+attendanceScore5+learningScore5);
      return {
        month,future,status:future?"future":month===currentMonth?"provisional":"final",
        practice:{qualifiedDays,targetDays,practicePoints,teacherAverage,teacherCount:evalRows.length,teacherPoints,score10:practiceScore10},
        attendance:{present:attendancePresent,total:attendanceTotal,leave:attendanceLeave,absent:attendanceAbsent,rate:attendanceTotal?round2(attendancePresent/attendanceTotal*100):null,score5:attendanceScore5},
        learning:{score5:learningScore5,teacherCount:learnRows.length,average:{attitude:avgCriterion("attitude"),preparation:avgCriterion("preparation"),progress:avgCriterion("progress"),teamwork:avgCriterion("teamwork")}},
        privateLesson:{completed:privateCompleted,cancelled:privateCancelled,score5:null,referenceOnly:true},
        total20
      };
    });
    const activeMonths=monthlyScores.filter(x=>!x.future);
    const lastScoreMonth=months[months.length-1],lastScoreDate=`${lastScoreMonth}-${String(monthDays(lastScoreMonth)).padStart(2,"0")}`;
    const finalStatus=today>=lastScoreDate;
    const practiceValues=activeMonths.map(x=>x.practice.score10).filter(v=>v!=null);
    const attendanceValues=activeMonths.map(x=>x.attendance.score5).filter(v=>v!=null);
    const learningValues=activeMonths.map(x=>x.learning.score5).filter(v=>v!=null);
    const semesterScore={
      practice10:average(practiceValues),
      attendance5:average(attendanceValues),
      learning5:average(learningValues),
      privateLesson5:null,
      total20:null,
      monthsPlanned:months.length,
      monthsElapsed:activeMonths.length,
      practiceMonths:practiceValues.length,
      attendanceMonths:attendanceValues.length,
      learningMonths:learningValues.length,
      status:finalStatus?"final":"provisional",
      complete:!finalStatus||(practiceValues.length===months.length&&attendanceValues.length===months.length&&learningValues.length===months.length)
    };
    if(semesterScore.practice10!=null&&semesterScore.attendance5!=null&&semesterScore.learning5!=null&&semesterScore.complete){
      semesterScore.total20=round2(semesterScore.practice10+semesterScore.attendance5+semesterScore.learning5);
    }
    return json({
      studentId,schoolYear,semester,semesterName:semesterLabel(semester)||`${semester}學期`,
      start:range.start,end,termEnd:range.end,asOf:today,
      student:master?{name:String(master.studentName||""),grade:String(master.grade||""),groupName:String(master.groupName||""),section:String(master.section||"待確認"),instrument:String(master.instrument||"")}:null,
      scorePolicy:{practiceWeight:10,attendanceWeight:5,learningWeight:5,privateLessonWeight:0,totalWeight:20,months,trialMonth:String(semester)==="1"?`${safeInt(schoolYear)+1911}-09`:"",attendanceLeaveExcluded:true,privateLessonReferenceOnly:true,learningWeights:{attitude:1,preparation:1,progress:2,teamwork:1}},
      monthlyScores,semesterScore,
      stats,records
    });
  }
});
