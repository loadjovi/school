import { app } from "@azure/functions";
import { getAccess, getStudentAliasInfo, json } from "../lib/auth.js";
import { ensureTables, table, listStudentMaster, getTeacherDirectory, getTeacherProfile } from "../lib/storage.js";
import { getSystemSettings, saveSystemSettings } from "../lib/settings.js";

function clean(v,max=80){return String(v||"").trim().slice(0,max)}
function monthRange(month){
  const m=/^\d{4}-\d{2}$/.test(month)?month:new Date().toISOString().slice(0,7);
  return {month:m,start:`${m}-01`,end:`${m}-31`};
}
function studentView(e){
  return {studentId:e.rowKey,name:e.studentName,grade:e.grade,groupName:e.groupName,instrument:e.instrument,section:e.section||"待確認",schoolYear:e.schoolYear||"",status:e.status||"active"};
}
async function listRange(key,start,end,allowedIds){
  const latest=new Map();
  const filter=`eventDate ge '${start}' and eventDate le '${end}'`;
  for await (const e of table(key).listEntities({queryOptions:{filter}})){
    const studentId=String(e.partitionKey);
    if(allowedIds&&!allowedIds.has(studentId))continue;
    const row={
      studentId,
      eventDate:String(e.eventDate||""),
      classType:String(e.classType||key),
      groupName:String(e.groupName||""),
      section:String(e.section||""),
      status:String(e.status||""),
      minutes:Number(e.minutes||0),
      teacher:String(e.teacher||""),
      createdAt:String(e.createdAt||""),
      rowKey:String(e.rowKey||""),
      sessionId:String(e.sessionId||"")
    };
    const privateSessionKey=row.sessionId||[row.studentId,row.eventDate,String(e.startTime||""),String(e.endTime||""),String(e.teacher||"").trim().toLowerCase()].join("|");
    const dedupeKey=key==="privateLesson"
      ?[row.studentId,row.eventDate,row.classType,privateSessionKey].join("|")
      :[row.studentId,row.eventDate,row.classType,row.groupName,row.section].join("|");
    const old=latest.get(dedupeKey);
    const stamp=`${row.createdAt}|${row.rowKey}`,oldStamp=old?`${old.createdAt}|${old.rowKey}`:"";
    if(!old||stamp>=oldStamp)latest.set(dedupeKey,row);
  }
  return [...latest.values()];
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
      const map=new Map((a.students||[]).filter(x=>x?.studentId).map(x=>[String(x.studentId),{
        studentId:String(x.studentId),name:x.name,grade:x.grade,groupName:x.groupName,instrument:x.instrument,section:x.section||"待確認",schoolYear:x.schoolYear||"",status:x.status||"active"
      }]));
      const profile=await getTeacherProfile(a.email);
      if(profile?.comprehensiveEnabled===true){
        for(const s of (await listStudentMaster("active")).map(studentView))map.set(String(s.studentId),s);
      }
      students=[...map.values()];
    }
    const byId=new Map(students.map(s=>[String(s.studentId),s]));
    const allowedIds=new Set(byId.keys());
    const [sectionRows,ensembleRows,comprehensiveRows,privateRows]=await Promise.all([
      listRange("section",start,end,allowedIds),
      listRange("ensemble",start,end,allowedIds),
      listRange("comprehensive",start,end,allowedIds),
      listRange("privateLesson",start,end,allowedIds)
    ]);
    const records=[...sectionRows,...ensembleRows,...comprehensiveRows,...privateRows].sort((a,b)=>String(b.eventDate).localeCompare(String(a.eventDate))||String(b.createdAt).localeCompare(String(a.createdAt)));
    const agg=new Map();
    for(const s of students)agg.set(String(s.studentId),{...s,sectionStats:blank(),ensembleStats:blank(),comprehensiveStats:blank(),privateStats:blank(),overall:blank()});
    for(const r of records){
      const x=agg.get(String(r.studentId));if(!x)continue;
      const key=r.classType==="ensemble"?"ensembleStats":r.classType==="comprehensive"?"comprehensiveStats":r.classType==="private"||r.classType==="privateLesson"?"privateStats":"sectionStats";
      add(x[key],r.status);add(x.overall,r.status);
    }
    const items=[...agg.values()].map(x=>({...x,attendanceRate:x.overall.total?Math.round(x.overall.attended/x.overall.total*1000)/10:null})).sort((a,b)=>String(a.groupName).localeCompare(String(b.groupName),"zh-Hant")||String(a.section).localeCompare(String(b.section),"zh-Hant")||String(a.name).localeCompare(String(b.name),"zh-Hant"));
    return json({month,start,end,items,records});
  }
});

function taipeiDate(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())}
function emailConfigured(){return !!(String(process.env.ACS_EMAIL_CONNECTION_STRING||"").trim()&&String(process.env.ACS_EMAIL_SENDER||"").trim())}
async function notificationSettingsResponse(request,a){
  if(request.method==="PATCH"){
    const body=await request.json();
    if(typeof body.emailNotificationsEnabled!=="boolean")return json({error:"emailNotificationsEnabled 必須為布林值"},400);
    const saved=await saveSystemSettings({emailNotificationsEnabled:body.emailNotificationsEnabled,updatedBy:a.email});
    return json({...saved,emailServiceConfigured:emailConfigured(),effectiveEmailEnabled:saved.emailNotificationsEnabled&&emailConfigured()});
  }
  const settings=await getSystemSettings();
  return json({...settings,emailServiceConfigured:emailConfigured(),effectiveEmailEnabled:settings.emailNotificationsEnabled&&emailConfigured()});
}
async function canonicalDailyId(id,students,cache){
  const key=String(id||"");
  if(students.has(key))return key;
  if(cache.has(key))return cache.get(key);
  try{const a=await getStudentAliasInfo(key);const c=String(a.canonicalStudentId||key);cache.set(key,c);return c}catch{cache.set(key,key);return key}
}
async function dailyTeacherName(email,cache){
  const key=String(email||"").trim().toLowerCase();
  if(!key)return "";
  if(cache.has(key))return cache.get(key);
  try{const d=await getTeacherDirectory(key);const name=String(d?.teacherName||"").trim()||key;cache.set(key,name);return name}catch{cache.set(key,key);return key}
}
async function collectDaily(key,date){
  const latest=new Map();
  for await (const e of table(key).listEntities({queryOptions:{filter:`eventDate eq '${date.replaceAll("'","''")}'`}})){
    const rawStudentId=String(e.partitionKey||"");
    const classType=key==="ensemble"?"ensemble":key==="comprehensive"?"comprehensive":key==="privateLesson"?"private":"section";
    const row={rawStudentId,eventDate:String(e.eventDate||date),classType,groupName:String(e.groupName||""),section:String(e.section||""),status:String(e.status||""),teacher:String(e.teacher||""),teacherName:String(e.teacherName||""),startTime:String(e.startTime||""),endTime:String(e.endTime||""),minutes:Number(e.minutes||0),lessonContent:String(e.lessonContent||""),parentConfirmation:String(e.parentConfirmation||""),teacherRating:Number(e.teacherRating||0),teacherReview:String(e.teacherReview||""),emailNotificationStatus:String(e.emailNotificationStatus||""),emailNotificationAt:String(e.emailNotificationAt||""),emailNotificationRecipients:Number(e.emailNotificationRecipients||0),emailNotificationSentCount:Number(e.emailNotificationSentCount||0),emailNotificationFailedCount:Number(e.emailNotificationFailedCount||0),emailNotificationResendCount:Number(e.emailNotificationResendCount||0),emailNotificationLastResentAt:String(e.emailNotificationLastResentAt||""),emailNotificationLastResentBy:String(e.emailNotificationLastResentBy||""),createdAt:String(e.createdAt||""),rowKey:String(e.rowKey||""),sessionId:String(e.sessionId||"")};
    const privateSessionKey=row.sessionId||[rawStudentId,row.eventDate,row.startTime,row.endTime,row.teacher.trim().toLowerCase()].join("|");
    const d=key==="privateLesson"
      ?[rawStudentId,row.eventDate,row.classType,privateSessionKey].join("|")
      :[rawStudentId,row.eventDate,row.classType,row.groupName,row.section].join("|");
    const old=latest.get(d),stamp=`${row.createdAt}|${row.rowKey}`,oldStamp=old?`${old.createdAt}|${old.rowKey}`:"";
    if(!old||stamp>=oldStamp)latest.set(d,row);
  }
  return [...latest.values()];
}

app.http("dailyFollowup",{
  methods:["GET","PATCH"],authLevel:"anonymous",route:"daily-followup",
  handler:async(request)=>{
    const a=await getAccess(request);
    if(!a.authenticated)return json({error:"Unauthorized"},401);
    if(a.role!=="admin")return json({error:"Forbidden"},403);

    if(String(request.query.get("mode")||"")==="settings")return notificationSettingsResponse(request,a);

    if(request.method!=="GET")return json({error:"Method not allowed"},405);
    const date=clean(request.query.get("date")||taipeiDate(),20);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return json({error:"日期格式不正確"},400);
    await ensureTables();

    const masters=await listStudentMaster();
    const students=new Map(masters.map(e=>[String(e.rowKey),studentView(e)]));
    const canonicalCache=new Map(),teacherCache=new Map();
    const [sectionRows,ensembleRows,comprehensiveRows,privateRows]=await Promise.all([collectDaily("section",date),collectDaily("ensemble",date),collectDaily("comprehensive",date),collectDaily("privateLesson",date)]);
    const allDailyRows=[...sectionRows,...ensembleRows,...comprehensiveRows,...privateRows];
    const activeMasters=masters.filter(e=>String(e.status||"active")!=="inactive");
    const activeByGroup=g=>activeMasters.filter(e=>String(e.groupName||"")===g).length;
    const attendedCount=rows=>rows.filter(x=>x.status==="present"||x.status==="late").length;
    const statusCount=(rows,status)=>rows.filter(x=>x.status===status).length;
    const weekday=new Date(date+"T12:00:00Z").getUTCDay();
    const comprehensiveDates=new Set(["2026-09-18","2026-10-02","2026-10-16","2026-10-30","2026-11-20","2026-11-27","2026-12-04"]);
    const courseSummary=[];
    const pushCourse=(key,label,groups,expected,rows,time="")=>{
      const attended=attendedCount(rows);
      courseSummary.push({key,label,groups,time,expected,attended,leave:statusCount(rows,"leave"),absent:statusCount(rows,"absent"),late:statusCount(rows,"late"),recorded:rows.filter(x=>x.status!=="cancelled").length,attendanceRate:expected?Math.round(attended/expected*1000)/10:null});
    };
    if(weekday===1||weekday===3){
      const rows=sectionRows.filter(x=>String(x.groupName)==="A");
      pushCourse("section-A","A團分部課",["A"],activeByGroup("A"),rows,"每週一、週三");
    }
    if(weekday===2||weekday===4){
      const rows=sectionRows.filter(x=>String(x.groupName)==="B");
      pushCourse("section-B","B團分部課",["B"],activeByGroup("B"),rows,"每週二、週四");
    }
    const reserveSectionStart="2026-10-02";
    if(weekday===5&&date>=reserveSectionStart){
      const rows=sectionRows.filter(x=>String(x.groupName)==="儲備");
      pushCourse("section-reserve","儲備團分部課",["儲備"],activeByGroup("儲備"),rows,"每週五｜10/2 起");
    }
    if(weekday===2){
      const rows=ensembleRows.filter(x=>["A","B"].includes(String(x.groupName)));
      pushCourse("ensemble-AB","A、B團合奏課",["A","B"],activeByGroup("A")+activeByGroup("B"),rows,"12:30–13:20");
    }
    if(comprehensiveDates.has(date)){
      const rows=comprehensiveRows.filter(x=>["A","B","儲備"].includes(String(x.groupName)));
      pushCourse("comprehensive","弦樂團體課（綜合課）",["A","B","儲備"],activeByGroup("A")+activeByGroup("B")+activeByGroup("儲備"),rows,"08:45–10:15");
    }
    if(privateRows.length){
      const expected=privateRows.filter(x=>x.status!=="cancelled").length;
      pushCourse("private","個別課",[],expected,privateRows,"依個別課紀錄");
    }
    const privateLessonDetails=[];
    for(const r of privateRows){
      const studentId=await canonicalDailyId(r.rawStudentId,students,canonicalCache);
      const s=students.get(String(studentId))||{studentId,name:`學生 ${studentId}`,grade:"",groupName:"",section:"",instrument:""};
      privateLessonDetails.push({
        lessonId:r.rowKey||"",
        studentId,
        name:s.name,
        grade:s.grade,
        groupName:s.groupName,
        instrument:s.instrument,
        status:r.status,
        teacherName:await dailyTeacherName(r.teacher,teacherCache),
        teacherEmail:r.teacher,
        startTime:r.startTime||"",
        endTime:r.endTime||"",
        minutes:Number(r.minutes||0),
        lessonContent:r.lessonContent||"",
        parentConfirmation:r.parentConfirmation||"",
        teacherRating:Number(r.teacherRating||0),
        teacherReview:r.teacherReview||"",
        emailNotificationStatus:r.emailNotificationStatus||"",
        emailNotificationAt:r.emailNotificationAt||"",
        emailNotificationRecipients:Number(r.emailNotificationRecipients||0),
        emailNotificationSentCount:Number(r.emailNotificationSentCount||0),
        emailNotificationFailedCount:Number(r.emailNotificationFailedCount||0),
        emailNotificationResendCount:Number(r.emailNotificationResendCount||0),
        emailNotificationLastResentAt:r.emailNotificationLastResentAt||"",
        emailNotificationLastResentBy:r.emailNotificationLastResentBy||""
      });
    }
    privateLessonDetails.sort((a,b)=>String(a.startTime||"").localeCompare(String(b.startTime||""))||String(a.name||"").localeCompare(String(b.name||""),"zh-Hant"));

    const attendanceCounts={
      expected:allDailyRows.filter(x=>x.status!=="cancelled").length,
      attended:allDailyRows.filter(x=>x.status==="present"||x.status==="late").length,
      present:allDailyRows.filter(x=>x.status==="present").length,
      late:allDailyRows.filter(x=>x.status==="late").length,
      leave:allDailyRows.filter(x=>x.status==="leave").length,
      absent:allDailyRows.filter(x=>x.status==="absent").length,
      cancelled:allDailyRows.filter(x=>x.status==="cancelled").length
    };
    attendanceCounts.attendanceRate=attendanceCounts.expected?Math.round(attendanceCounts.attended/attendanceCounts.expected*1000)/10:null;
    const raw=allDailyRows.filter(x=>["leave","absent"].includes(x.status));
    const latest=new Map();
    for(const r of raw){
      const studentId=await canonicalDailyId(r.rawStudentId,students,canonicalCache),row={...r,studentId};
      const k=[studentId,row.eventDate,row.classType,row.groupName,row.section].join("|");
      const old=latest.get(k),stamp=`${row.createdAt}|${row.rowKey}`,oldStamp=old?`${old.createdAt}|${old.rowKey}`:"";
      if(!old||stamp>=oldStamp)latest.set(k,row);
    }

    const items=[];
    for(const r of latest.values()){
      const s=students.get(String(r.studentId))||{studentId:r.studentId,name:`學生 ${r.studentId}`,grade:"",groupName:r.groupName,section:r.section||"待確認",instrument:""};
      items.push({date:r.eventDate,classType:r.classType,studentId:r.studentId,name:s.name,grade:s.grade,groupName:r.groupName||s.groupName,section:r.classType==="ensemble"?"四分部合班":r.section||s.section||"待確認",instrument:s.instrument,status:r.status,teacherName:await dailyTeacherName(r.teacher,teacherCache),teacherEmail:r.teacher});
    }
    items.sort((x,y)=>String(x.classType).localeCompare(String(y.classType))||String(x.groupName).localeCompare(String(y.groupName),"zh-Hant")||String(x.section).localeCompare(String(y.section),"zh-Hant")||String(x.name).localeCompare(String(y.name),"zh-Hant"));
    return json({date,scope:"00:00-23:59",items,attendanceCounts,courseSummary,privateLessonDetails,counts:{total:items.length,leave:items.filter(x=>x.status==="leave").length,absent:items.filter(x=>x.status==="absent").length,section:items.filter(x=>x.classType==="section").length,ensemble:items.filter(x=>x.classType==="ensemble").length,comprehensive:items.filter(x=>x.classType==="comprehensive").length,private:items.filter(x=>x.classType==="private").length}});
  }
});

// Compatibility route for clients that still have an older cached admin frontend.
app.http("adminSettingsCompat",{
  methods:["GET","PATCH"],authLevel:"anonymous",route:"admin-settings",
  handler:async(request)=>{
    const a=await getAccess(request);
    if(!a.authenticated)return json({error:"Unauthorized"},401);
    if(a.role!=="admin")return json({error:"Forbidden"},403);
    return notificationSettingsResponse(request,a);
  }
});