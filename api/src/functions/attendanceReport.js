import { app } from "@azure/functions";
import { getTenantContext, getStudentAliasInfo, json } from "../lib/auth.js";
import { ensureTenantTables, listActivityRange, activityStudentId, listStudentMaster, getTeacherDirectory, getTeacherProfile, listUserStudentMappings } from "../lib/storage.js";
import { getSystemSettings, saveSystemSettings } from "../lib/settings.js";
import { resolveSchoolCourses } from "./schoolSchedule.js";

function clean(v,max=80){return String(v||"").trim().slice(0,max)}
function monthRange(month){
  const m=/^\d{4}-\d{2}$/.test(month)?month:new Date().toISOString().slice(0,7);
  return {month:m,start:`${m}-01`,end:`${m}-31`};
}
function studentView(e){
  return {studentId:e.rowKey,name:e.studentName,grade:e.grade,groupName:e.groupName,instrument:e.instrument,section:e.section||"待確認",schoolYear:e.schoolYear||"",status:e.status||"active"};
}
async function canonicalReportStudentId(studentId,cache,schoolId){
  const raw=String(studentId||"");
  if(cache.has(raw))return cache.get(raw);
  try{const info=await getStudentAliasInfo(raw,schoolId),canonical=String(info.canonicalStudentId||raw);cache.set(raw,canonical);return canonical}catch{cache.set(raw,raw);return raw}
}
async function listRange(key,start,end,allowedIds,schoolId,canonicalCache){
  const latest=new Map();
  for(const e of await listActivityRange(key,schoolId,start,end)){
    const studentId=await canonicalReportStudentId(activityStudentId(e),canonicalCache,schoolId);
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
  if(!["present","late","leave","absent","cancelled"].includes(status))return;
  if(status in bucket)bucket[status]++;
  if(status!=="cancelled")bucket.total++;
  if(status==="present"||status==="late")bucket.attended++;
}

app.http("attendanceReport",{
  methods:["GET"],authLevel:"anonymous",route:"attendance-report",
  handler:async(request)=>{
    const context=await getTenantContext(request);if(context.error)return context.error;
    const {access:a,schoolId}=context;
    if(a.temporaryAssignment)return json({error:"短期代課僅可查看指定課堂的點名資料"},403);
    const isTeacher=!!a.capabilities?.teacherSettings;
    if(a.role!=="admin"&&!isTeacher)return json({error:"Forbidden"},403);
    const {month,start,end}=monthRange(clean(request.query.get("month"),12));
    await ensureTenantTables();

    let students;
    if(a.role==="admin"){
      students=(await listStudentMaster("active",schoolId)).map(studentView);
    }else{
      const map=new Map((a.students||[]).filter(x=>x?.studentId).map(x=>[String(x.studentId),{
        studentId:String(x.studentId),name:x.name,grade:x.grade,groupName:x.groupName,instrument:x.instrument,section:x.section||"待確認",schoolYear:x.schoolYear||"",status:x.status||"active"
      }]));
      const profile=await getTeacherProfile(a.email,schoolId);
      if(profile?.comprehensiveEnabled===true){
        for(const s of (await listStudentMaster("active",schoolId)).map(studentView))map.set(String(s.studentId),s);
      }
      students=[...map.values()];
    }
    const byId=new Map(students.map(s=>[String(s.studentId),s]));
    const allowedIds=new Set(byId.keys());
    const canonicalCache=new Map();
    const [sectionRows,ensembleRows,comprehensiveRows,privateRows]=await Promise.all([
      listRange("section",start,end,allowedIds,schoolId,canonicalCache),
      listRange("ensemble",start,end,allowedIds,schoolId,canonicalCache),
      listRange("comprehensive",start,end,allowedIds,schoolId,canonicalCache),
      listRange("privateLesson",start,end,allowedIds,schoolId,canonicalCache)
    ]);
    const records=[...sectionRows,...ensembleRows,...comprehensiveRows,...privateRows]
      .filter(r=>["present","late","leave","absent","cancelled"].includes(r.status))
      .sort((a,b)=>String(b.eventDate).localeCompare(String(a.eventDate))||String(b.createdAt).localeCompare(String(a.createdAt)));
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
async function notificationSettingsResponse(request,a,schoolId){
  if(request.method==="PATCH"){
    const body=await request.json();
    if(typeof body.emailNotificationsEnabled!=="boolean")return json({error:"emailNotificationsEnabled 必須為布林值"},400);
    const saved=await saveSystemSettings({emailNotificationsEnabled:body.emailNotificationsEnabled,updatedBy:a.email,schoolId});
    return json({...saved,emailServiceConfigured:emailConfigured(),effectiveEmailEnabled:saved.emailNotificationsEnabled&&emailConfigured()});
  }
  const settings=await getSystemSettings(schoolId);
  return json({...settings,emailServiceConfigured:emailConfigured(),effectiveEmailEnabled:settings.emailNotificationsEnabled&&emailConfigured()});
}
async function canonicalDailyId(id,students,cache,schoolId){
  const key=String(id||"");
  if(students.has(key))return key;
  if(cache.has(key))return cache.get(key);
  try{const a=await getStudentAliasInfo(key,schoolId);const c=String(a.canonicalStudentId||key);cache.set(key,c);return c}catch{cache.set(key,key);return key}
}
async function dailyTeacherName(email,cache,schoolId){
  const key=String(email||"").trim().toLowerCase();
  if(!key)return "";
  if(cache.has(key))return cache.get(key);
  try{const d=await getTeacherDirectory(key,schoolId);const name=String(d?.teacherName||"").trim()||key;cache.set(key,name);return name}catch{cache.set(key,key);return key}
}
async function collectDaily(key,date,schoolId){
  const latest=new Map();
  for(const e of await listActivityRange(key,schoolId,"","",date)){
    const rawStudentId=activityStudentId(e);
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
    const context=await getTenantContext(request);if(context.error)return context.error;
    const {access:a,schoolId}=context;
    if(a.role!=="admin")return json({error:"Forbidden"},403);

    if(String(request.query.get("mode")||"")==="settings")return notificationSettingsResponse(request,a,schoolId);

    if(request.method!=="GET")return json({error:"Method not allowed"},405);
    const date=clean(request.query.get("date")||taipeiDate(),20);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return json({error:"日期格式不正確"},400);
    await ensureTenantTables();

    const masters=await listStudentMaster("",schoolId);
    const students=new Map(masters.map(e=>[String(e.rowKey),studentView(e)]));
    const canonicalCache=new Map(),teacherCache=new Map();

    const currentParentBindings=new Map();
    for(const m of await listUserStudentMappings("active",schoolId)){
      const canonicalId=await canonicalDailyId(m.studentId,students,canonicalCache,schoolId);
      if(!currentParentBindings.has(canonicalId))currentParentBindings.set(canonicalId,[]);
      const rows=currentParentBindings.get(canonicalId);
      const email=String(m.parentEmail||"").trim().toLowerCase();
      if(email&&!rows.some(x=>x.parentEmail===email))rows.push({
        parentEmail:email,parentName:String(m.parentName||""),relationship:String(m.relationship||"家長")
      });
    }
    const [sectionRows,ensembleRows,comprehensiveRows,privateRows,scheduleCourses]=await Promise.all([
      collectDaily("section",date,schoolId),
      collectDaily("ensemble",date,schoolId),
      collectDaily("comprehensive",date,schoolId),
      collectDaily("privateLesson",date,schoolId),
      resolveSchoolCourses(schoolId,date)
    ]);
    const activeMasters=masters.filter(e=>String(e.status||"active")!=="inactive");
    const normGroup=v=>String(v||"").trim().replace(/團$/,"");
    const targetGroups=v=>String(v||"").split(",").map(normGroup).filter(Boolean);
    const matchesSchedule=(row,s)=>{
      if(String(row.classType||"")!==String(s.courseType||""))return false;
      const groups=targetGroups(s.groupName);
      if(groups.length&&!groups.includes(normGroup(row.groupName)))return false;
      if(s.courseType==="section"&&String(s.section||"").trim()&&String(row.section||"").trim()!==String(s.section||"").trim())return false;
      return true;
    };
    const groupSchedules=(scheduleCourses||[]).filter(s=>["section","ensemble","comprehensive"].includes(String(s.courseType||"")));
    const blockedSchedules=groupSchedules.filter(s=>["cancelled","rescheduled"].includes(String(s.effectiveStatus||"active")));
    const isBlockedRow=row=>blockedSchedules.some(s=>matchesSchedule(row,s));
    const effectiveSectionRows=sectionRows.filter(x=>!isBlockedRow(x));
    const effectiveEnsembleRows=ensembleRows.filter(x=>!isBlockedRow(x));
    const effectiveComprehensiveRows=comprehensiveRows.filter(x=>!isBlockedRow(x));
    const allDailyRows=[...effectiveSectionRows,...effectiveEnsembleRows,...effectiveComprehensiveRows,...privateRows];
    const attendedCount=rows=>rows.filter(x=>x.status==="present"||x.status==="late").length;
    const statusCount=(rows,status)=>rows.filter(x=>x.status===status).length;
    const courseSummary=[];
    const pushCourse=(key,label,groups,expected,rows,time="",meta={})=>{
      const attended=attendedCount(rows);
      courseSummary.push({
        key,label,groups,time,expected,attended,
        leave:statusCount(rows,"leave"),absent:statusCount(rows,"absent"),late:statusCount(rows,"late"),
        recorded:rows.filter(x=>x.status!=="cancelled").length,
        attendanceRate:expected?Math.round(attended/expected*1000)/10:null,
        scheduleStatus:String(meta.scheduleStatus||"active"),
        reason:String(meta.reason||""),
        newDate:String(meta.newDate||""),
        newStartTime:String(meta.newStartTime||""),
        newEndTime:String(meta.newEndTime||"")
      });
    };
    const typeRows={section:effectiveSectionRows,ensemble:effectiveEnsembleRows,comprehensive:effectiveComprehensiveRows};
    const defaultLabel={section:"分部課",ensemble:"合奏課",comprehensive:"綜合課"};
    const represented=new Set();
    for(const s of groupSchedules){
      const groups=targetGroups(s.groupName);
      const blocked=["cancelled","rescheduled"].includes(String(s.effectiveStatus||"active"));
      const rows=(typeRows[s.courseType]||[]).filter(x=>matchesSchedule(x,s));
      const expectedStudents=activeMasters.filter(m=>{
        if(groups.length&&groups[0]!=="ALL"&&!groups.includes(normGroup(m.groupName)))return false;
        if(s.courseType==="section"&&String(s.section||"").trim()&&String(m.section||"").trim()!==String(s.section||"").trim())return false;
        return true;
      });
      const time=[String(s.startTime||""),String(s.endTime||"")].filter(Boolean).join("–");
      const ex=s.exception||{};
      const label=String(s.courseName||"").trim()||([groups.join("、"),defaultLabel[s.courseType]].filter(Boolean).join("團 ")||defaultLabel[s.courseType]);
      const key=String(s.scheduleId||[s.courseType,s.groupName,s.section].join("|"));
      represented.add(key);
      pushCourse(key,label,groups,blocked?0:expectedStudents.length,blocked?[]:rows,time,{
        scheduleStatus:String(s.effectiveStatus||"active"),
        reason:String(ex.reason||""),
        newDate:String(ex.newDate||""),
        newStartTime:String(ex.newStartTime||""),
        newEndTime:String(ex.newEndTime||"")
      });
    }
    // 若有未排在固定課表內、但老師實際完成的補課／臨時課程，仍保留在行政彙整。
    for(const [type,rows] of Object.entries(typeRows)){
      const byCourse=new Map();
      for(const r of rows){
        if(groupSchedules.some(s=>String(s.effectiveStatus||"active")==="active"&&matchesSchedule(r,s)))continue;
        const key=[type,normGroup(r.groupName),String(r.section||"")].join("|");
        if(!byCourse.has(key))byCourse.set(key,[]);
        byCourse.get(key).push(r);
      }
      for(const [key,rows2] of byCourse){
        const first=rows2[0]||{},groups=first.groupName?[normGroup(first.groupName)]:[];
        const label=["臨時／補課",groups.length?groups.join("、")+"團":"",defaultLabel[type],type==="section"&&first.section?first.section:""].filter(Boolean).join("｜");
        pushCourse("actual|"+key,label,groups,rows2.filter(x=>x.status!=="cancelled").length,rows2,"依實際點名",{scheduleStatus:"actual"});
      }
    }
    if(privateRows.length){
      const attendancePrivateRows=privateRows.filter(x=>["present","late","leave","absent","cancelled"].includes(x.status));
      const expected=attendancePrivateRows.filter(x=>x.status!=="cancelled").length;
      pushCourse("private","個別課",[],expected,attendancePrivateRows,"依個別課流程",{scheduleStatus:"actual"});
    }
    const privateLessonDetails=[];
    for(const r of privateRows){
      if(String(r.status||"")==="cancelled")continue;
      const studentId=await canonicalDailyId(r.rawStudentId,students,canonicalCache,schoolId);
      const s=students.get(String(studentId))||{studentId,name:`學生 ${studentId}`,grade:"",groupName:"",section:"",instrument:""};
      privateLessonDetails.push({
        lessonId:r.rowKey||"",
        studentId,
        name:s.name,
        grade:s.grade,
        groupName:s.groupName,
        instrument:s.instrument,
        status:r.status,
        teacherName:await dailyTeacherName(r.teacher,teacherCache,schoolId),
        teacherEmail:r.teacher,
        startTime:r.startTime||"",
        endTime:r.endTime||"",
        minutes:Number(r.minutes||0),
        lessonContent:r.lessonContent||"",
        parentConfirmation:r.parentConfirmation||"",
        teacherRating:Number(r.teacherRating||0),
        teacherReview:r.teacherReview||"",
        currentParentBindings:currentParentBindings.get(String(studentId))||[],
        currentParentEmailCount:(currentParentBindings.get(String(studentId))||[]).length,
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
    const privateDuplicateCounts=new Map();
    for(const p of privateLessonDetails){
      const k=[String(p.studentId||""),String(p.teacherEmail||"").trim().toLowerCase()].join("|");
      privateDuplicateCounts.set(k,(privateDuplicateCounts.get(k)||0)+1);
    }
    for(const p of privateLessonDetails){
      const k=[String(p.studentId||""),String(p.teacherEmail||"").trim().toLowerCase()].join("|");
      p.duplicateSameDay=(privateDuplicateCounts.get(k)||0)>1;
      p.duplicateCount=privateDuplicateCounts.get(k)||1;
    }

    const attendanceRows=allDailyRows.filter(x=>["present","late","leave","absent","cancelled"].includes(x.status));
    const attendanceCounts={
      expected:attendanceRows.filter(x=>x.status!=="cancelled").length,
      attended:attendanceRows.filter(x=>x.status==="present"||x.status==="late").length,
      present:attendanceRows.filter(x=>x.status==="present").length,
      late:attendanceRows.filter(x=>x.status==="late").length,
      leave:attendanceRows.filter(x=>x.status==="leave").length,
      absent:attendanceRows.filter(x=>x.status==="absent").length,
      cancelled:attendanceRows.filter(x=>x.status==="cancelled").length
    };
    attendanceCounts.attendanceRate=attendanceCounts.expected?Math.round(attendanceCounts.attended/attendanceCounts.expected*1000)/10:null;
    const raw=allDailyRows.filter(x=>["leave","absent"].includes(x.status));
    const latest=new Map();
    for(const r of raw){
      const studentId=await canonicalDailyId(r.rawStudentId,students,canonicalCache,schoolId),row={...r,studentId};
      const k=[studentId,row.eventDate,row.classType,row.groupName,row.section].join("|");
      const old=latest.get(k),stamp=`${row.createdAt}|${row.rowKey}`,oldStamp=old?`${old.createdAt}|${old.rowKey}`:"";
      if(!old||stamp>=oldStamp)latest.set(k,row);
    }

    const items=[];
    for(const r of latest.values()){
      const s=students.get(String(r.studentId))||{studentId:r.studentId,name:`學生 ${r.studentId}`,grade:"",groupName:r.groupName,section:r.section||"待確認",instrument:""};
      items.push({date:r.eventDate,classType:r.classType,studentId:r.studentId,name:s.name,grade:s.grade,groupName:r.groupName||s.groupName,section:r.classType==="ensemble"?"四分部合班":r.section||s.section||"待確認",instrument:s.instrument,status:r.status,teacherName:await dailyTeacherName(r.teacher,teacherCache,schoolId),teacherEmail:r.teacher});
    }
    items.sort((x,y)=>String(x.classType).localeCompare(String(y.classType))||String(x.groupName).localeCompare(String(y.groupName),"zh-Hant")||String(x.section).localeCompare(String(y.section),"zh-Hant")||String(x.name).localeCompare(String(y.name),"zh-Hant"));
    return json({date,scope:"00:00-23:59",items,attendanceCounts,courseSummary,privateLessonDetails,counts:{total:items.length,leave:items.filter(x=>x.status==="leave").length,absent:items.filter(x=>x.status==="absent").length,section:items.filter(x=>x.classType==="section").length,ensemble:items.filter(x=>x.classType==="ensemble").length,comprehensive:items.filter(x=>x.classType==="comprehensive").length,private:items.filter(x=>x.classType==="private").length}});
  }
});

// Compatibility route for clients that still have an older cached admin frontend.
app.http("adminSettingsCompat",{
  methods:["GET","PATCH"],authLevel:"anonymous",route:"admin-settings",
  handler:async(request)=>{
    const context=await getTenantContext(request);if(context.error)return context.error;
    const {access:a,schoolId}=context;
    if(a.role!=="admin")return json({error:"Forbidden"},403);
    return notificationSettingsResponse(request,a,schoolId);
  }
});
