import { app } from "@azure/functions";
import { getTenantContext, ensurePrivateAccess, ensureStudentAccess, getStudentAliasInfo, json } from "../lib/auth.js";
import {
  ensureTenantTables,table,rowKey,listByStudent,getTeacherDirectory,listUserStudentMappings,getStudentMaster,getTenantDirectory,
  tenantStudentPartition,activityStudentId
} from "../lib/storage.js";
import { formatPrivateLessonNotice,sendPrivateLessonWorkflowEmail } from "../lib/email.js";
import { getSystemSettings } from "../lib/settings.js";
import {notifyPrivateLessonLine} from "../lib/linePrivateLesson.js";
import {lineFirstLabEnabled} from "../lib/labNoticeDelivery.mjs";
import {validateParentLessonReview} from "../lib/privateLessonReview.mjs";
import {normalizeWeeklyGoals,readWeeklyGoals,isPublishedLesson} from "../lib/musicLearningGoals.mjs";

const attendanceStatuses=new Set(["present","late","leave","absent"]);
const teacherCompletionStatuses=new Set(["scheduled","completion_issue"]);
function clean(v,max=300){return String(v??"").trim().slice(0,max)}
function validTime(v){return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v||""))}
function timeMinutes(v){if(!validTime(v))return -1;const [h,m]=String(v).split(":").map(Number);return h*60+m}
function minutesBetween(start,end){const a=timeMinutes(start),b=timeMinutes(end);return a>=0&&b>a?b-a:-1}
function safeTimeZone(value){const zone=clean(value,80)||"Asia/Taipei";try{new Intl.DateTimeFormat("en",{timeZone:zone}).format();return zone}catch{return "Asia/Taipei"}}
function zonedClock(timeZone="Asia/Taipei"){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:safeTimeZone(timeZone),year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date());
  const part=type=>parts.find(x=>x.type===type)?.value||"";
  return {date:`${part("year")}-${part("month")}-${part("day")}`,time:`${part("hour")}:${part("minute")}`};
}
function workflowStatus(e){
  const status=String(e?.status||""),confirmation=String(e?.parentConfirmation||"");
  if(status==="cancelled")return "cancelled";
  if(status==="scheduled")return "scheduled";
  if(status==="completion_issue"||confirmation==="issue")return "issue";
  if(status==="teacher_completed"||(confirmation==="pending"&&["present","late"].includes(status)))return "awaiting_parent";
  if(confirmation==="confirmed"&&["present","late"].includes(status))return "completed";
  if(attendanceStatuses.has(status))return "completed";
  return status||"scheduled";
}
function publicAppUrl(request){
  const explicit=clean(process.env.APP_PUBLIC_URL||process.env.SWA_PUBLIC_URL||"",1000);
  const candidates=[explicit,clean(request.headers.get("origin"),1000),clean(request.headers.get("referer"),1000)];
  const forwardedHost=clean(request.headers.get("x-forwarded-host"),500),forwardedProto=clean(request.headers.get("x-forwarded-proto"),20)||"https";
  if(forwardedHost)candidates.push(`${forwardedProto}://${forwardedHost}`);
  for(const raw of candidates){
    if(!raw||raw==="null")continue;
    try{
      const u=new URL(raw),host=String(u.hostname||"").toLowerCase();
      if(!["http:","https:"].includes(u.protocol)||host.endsWith(".azurewebsites.net"))continue;
      return u.origin+"/";
    }catch{}
  }
  return "";
}
function view(e,teacherNameOverride=""){
  const status=String(e.status||"scheduled");
  return {
    lessonId:String(e.rowKey||""),studentId:activityStudentId(e),lessonDate:String(e.eventDate||""),
    startTime:String(e.startTime||""),endTime:String(e.endTime||""),minutes:Number(e.minutes||0),status,
    workflowStatus:workflowStatus(e),actualAttendanceStatus:status==="cancelled"?"":String(e.actualAttendanceStatus||(["present","late"].includes(status)?status:"present")),
    lessonContent:String(e.lessonContent||""),weeklyPracticeGoals:readWeeklyGoals(e.weeklyPracticeGoalsJson),teacher:String(e.teacher||""),teacherName:String(teacherNameOverride||e.teacherName||e.teacher||""),
    parentConfirmation:String(e.parentConfirmation||(["present","late"].includes(status)?"pending":"not_required")),
    parentConfirmedAt:String(e.parentConfirmedAt||""),parentConfirmedBy:String(e.parentConfirmedBy||""),parentConfirmedVia:String(e.parentConfirmedVia||""),parentNote:String(e.parentNote||""),
    teacherRating:Number(e.teacherRating||0),teacherReview:String(e.teacherReview||""),teacherRatedAt:String(e.teacherRatedAt||""),teacherRatedBy:String(e.teacherRatedBy||""),
    studentPerformanceRating:Number(e.studentPerformanceRating||0),studentPerformanceRatedAt:String(e.studentPerformanceRatedAt||""),studentPerformanceRatedBy:String(e.studentPerformanceRatedBy||""),
    emailNotificationType:String(e.emailNotificationType||""),emailNotificationStatus:String(e.emailNotificationStatus||""),emailNotificationAt:String(e.emailNotificationAt||""),
    emailNotificationRecipients:Number(e.emailNotificationRecipients||0),emailNotificationAcceptedCount:Number(e.emailNotificationAcceptedCount||0),emailNotificationSentCount:Number(e.emailNotificationSentCount||0),emailNotificationFailedCount:Number(e.emailNotificationFailedCount||0),
    emailNotificationResendCount:Number(e.emailNotificationResendCount||0),emailNotificationLastResentAt:String(e.emailNotificationLastResentAt||""),emailNotificationLastResentBy:String(e.emailNotificationLastResentBy||""),
    lineNotificationStatus:String(e.lineNotificationStatus||""),lineNotificationAt:String(e.lineNotificationAt||""),
    lineNotificationResendCount:Number(e.lineNotificationResendCount||0),lineNotificationLastResentAt:String(e.lineNotificationLastResentAt||""),
    scheduledAt:String(e.scheduledAt||e.createdAt||""),scheduledBy:String(e.scheduledBy||e.teacher||""),
    rescheduledAt:String(e.rescheduledAt||""),rescheduledBy:String(e.rescheduledBy||""),rescheduleCount:Number(e.rescheduleCount||0),
    completedAt:String(e.completedAt||""),completedBy:String(e.completedBy||""),
    cancelledAt:String(e.cancelledAt||""),cancelledBy:String(e.cancelledBy||""),cancelReason:String(e.cancelReason||""),
    createdAt:String(e.createdAt||""),updatedAt:String(e.updatedAt||"")
  };
}
async function resolvedTeacherName(email,fallback="",schoolId=""){
  const key=String(email||"").trim().toLowerCase();
  if(!key)return clean(fallback,120);
  try{const d=await getTeacherDirectory(key,schoolId),name=clean(d?.teacherName,120);if(name)return name}catch(e){console.warn("Unable to resolve teacher directory name:",e?.message||String(e))}
  const stored=clean(fallback,120);if(stored&&stored.toLowerCase()!==key)return stored;
  return "個別課老師";
}
async function rowsForStudent(studentId,start,end,schoolId){
  const alias=await getStudentAliasInfo(studentId,schoolId),ids=[...new Set(alias.aliases?.length?alias.aliases:[studentId])];
  const rows=(await Promise.all(ids.map(id=>listByStudent("privateLesson",id,start,end,schoolId)))).flat(),unique=new Map();
  for(const r of rows)unique.set(`${r.partitionKey}|${r.rowKey}`,r);
  return [...unique.values()];
}
async function findLesson(studentId,lessonId,schoolId){
  const alias=await getStudentAliasInfo(studentId,schoolId),ids=[...new Set(alias.aliases?.length?alias.aliases:[studentId])];
  for(const id of ids){
    try{return await table("tenantPrivateLesson").getEntity(tenantStudentPartition(schoolId,id),String(lessonId))}
    catch(e){if(e.statusCode!==404)throw e}
  }
  return null;
}
async function saveLessonVersion(entity){
  const {etag,...data}=entity;
  try{await table("tenantPrivateLesson").updateEntity(data,"Merge",{etag});return true}
  catch(error){if(error.statusCode===412)return false;throw error}
}
async function parentEmailsForStudent(canonicalStudentId,schoolId){
  const mappings=await listUserStudentMappings("active",schoolId),emails=new Set();
  for(const m of mappings){
    if(!m.parentEmail||!m.studentId)continue;
    try{
      const alias=await getStudentAliasInfo(m.studentId,schoolId),canonical=String(alias.canonicalStudentId||m.studentId);
      if(canonical===String(canonicalStudentId))emails.add(String(m.parentEmail).trim().toLowerCase());
    }catch{if(String(m.studentId)===String(canonicalStudentId))emails.add(String(m.parentEmail).trim().toLowerCase())}
  }
  return [...emails].filter(Boolean);
}
function scheduleError(lessonDate,startTime,endTime,clock,{requireFutureStart=false}={}){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(lessonDate))return "上課日期不正確";
  const minutes=minutesBetween(startTime,endTime);
  if(minutes<=0||minutes>240)return "請填寫正確的開始與結束時間（最長 240 分鐘）";
  if(lessonDate<clock.date)return "不能預約或改期到過去日期";
  if(requireFutureStart&&lessonDate===clock.date&&timeMinutes(startTime)<=timeMinutes(clock.time))return "預約開始時間必須晚於現在";
  return "";
}
function lessonEnded(entity,clock){
  const date=String(entity.eventDate||""),end=String(entity.endTime||"");
  return date<clock.date||(date===clock.date&&validTime(end)&&timeMinutes(clock.time)>=timeMinutes(end));
}
function canChangeSchedule(entity,clock){const date=String(entity.eventDate||""),start=String(entity.startTime||"");return workflowStatus(entity)==="scheduled"&&(clock.date<date||clock.date===date&&start&&clock.time<start)}
async function duplicateFor(studentId,teacherEmail,lessonDate,schoolId,excludeLessonId=""){
  const key=String(teacherEmail||"").trim().toLowerCase(),rows=await rowsForStudent(studentId,lessonDate,lessonDate,schoolId);
  return rows.find(r=>String(r.rowKey||"")!==String(excludeLessonId||"")&&String(r.status||"")!=="cancelled"&&String(r.teacher||"").trim().toLowerCase()===key)||null;
}
function appendScheduleHistory(entity,item){
  let history=[];try{const parsed=JSON.parse(String(entity.scheduleHistory||"[]"));if(Array.isArray(parsed))history=parsed}catch{}
  entity.scheduleHistory=JSON.stringify([...history.slice(-9),item]).slice(0,8000);
}
function applyNotification(entity,eventType,result,actorEmail,{resend=false}={}){
  const now=new Date().toISOString();
  entity.emailNotificationType=eventType;entity.emailNotificationStatus=String(result?.status||"failed");entity.emailNotificationAt=now;
  entity.emailNotificationRecipients=Number(result?.recipientCount||0);entity.emailNotificationAcceptedCount=Number(result?.acceptedCount||0);entity.emailNotificationSentCount=Number(result?.sentCount||result?.acceptedCount||0);entity.emailNotificationFailedCount=Number(result?.failedCount||0);
  if(resend){entity.emailNotificationResendCount=Number(entity.emailNotificationResendCount||0)+1;entity.emailNotificationLastResentAt=now;entity.emailNotificationLastResentBy=clean(actorEmail,320)}
  if(result?.lineStatus!==undefined){entity.lineNotificationStatus=String(result.lineStatus);entity.lineNotificationAt=now}
  entity.updatedAt=now;
}
async function persistNotificationAudit(entity,eventType,result,actorEmail,options={}){
  applyNotification(entity,eventType,result,actorEmail,options);
  const patch={
    partitionKey:entity.partitionKey,rowKey:entity.rowKey,
    emailNotificationType:entity.emailNotificationType,emailNotificationStatus:entity.emailNotificationStatus,emailNotificationAt:entity.emailNotificationAt,
    emailNotificationRecipients:entity.emailNotificationRecipients,emailNotificationAcceptedCount:entity.emailNotificationAcceptedCount,emailNotificationSentCount:entity.emailNotificationSentCount,emailNotificationFailedCount:entity.emailNotificationFailedCount,
    emailNotificationResendCount:entity.emailNotificationResendCount,emailNotificationLastResentAt:entity.emailNotificationLastResentAt,emailNotificationLastResentBy:entity.emailNotificationLastResentBy,
    updatedAt:entity.updatedAt,
    ...(result?.lineStatus!==undefined?{lineNotificationStatus:entity.lineNotificationStatus,lineNotificationAt:entity.lineNotificationAt}:{})
  };
  try{await table("tenantPrivateLesson").updateEntity(patch,"Merge");return true}
  catch(e){console.error(`Private lesson ${eventType} notification audit failed:`,e);return false}
}
async function notifyWorkflow({request,schoolId,schoolName,entity,studentName,teacherName,eventType,target="parents",actorEmail="",actorName="",previous={},notifyLine=true,notifyEmail=true,lineDeliveryId=""}){
  try{
    const settings=await getSystemSettings(schoolId);
    const recipients=[];
    if(target==="parents"||target==="both")recipients.push(...await parentEmailsForStudent(activityStudentId(entity),schoolId));
    if(target==="teacher"||target==="both")recipients.push(String(entity.teacher||"").trim().toLowerCase());
    const unique=[...new Set(recipients.filter(x=>x&&(target==="parents"||x!==String(actorEmail||"").trim().toLowerCase())))],appUrl=publicAppUrl(request);
    if(!appUrl)console.warn("Unable to resolve public app URL for private lesson email; set APP_PUBLIC_URL in Azure environment variables.");
    const notice={schoolId,
      recipients:unique,eventType,schoolName,studentName,teacherName,lessonDate:String(entity.eventDate||""),startTime:String(entity.startTime||""),endTime:String(entity.endTime||""),minutes:Number(entity.minutes||0),
      lessonContent:String(entity.lessonContent||""),weeklyPracticeGoals:eventType==="completed"?readWeeklyGoals(entity.weeklyPracticeGoalsJson):[],previousDate:String(previous.lessonDate||""),previousStartTime:String(previous.startTime||""),previousEndTime:String(previous.endTime||""),
      reason:String(eventType==="rescheduled"?entity.rescheduleReason||"":entity.cancelReason||""),note:String(entity.parentNote||""),actorName,appUrl
    };
    if(typeof lineFirstLabEnabled==="function"&&lineFirstLabEnabled()){
      const routed=await sendPrivateLessonWorkflowEmail({...notice,mailAllowed:notifyEmail&&settings.emailNotificationsEnabled===true,notificationId:["private",entity.rowKey,eventType,entity.updatedAt,lineDeliveryId].join(":"),
       lineSender:notifyLine?email=>notifyPrivateLessonLine(schoolId,{recipients:[email],entity,eventType,deliveryId:lineDeliveryId,format:origin=>formatPrivateLessonNotice({...notice,appUrl:origin}).plainText}):async()=>({status:"disabled"})});
      return {...routed,status:routed.status==="sent"?(routed.mailAcceptedCount?"accepted":"skipped_line_accepted"):routed.status,recipientCount:routed.results?.filter(r=>r.channel==="email").length||0,acceptedCount:routed.mailAcceptedCount||0};
    }
    const [mail,lineStatus]=await Promise.all([
      notifyEmail&&settings.emailNotificationsEnabled?sendPrivateLessonWorkflowEmail(notice):{status:"disabled",recipientCount:0,sentCount:0,failedCount:0},
      notifyLine?notifyPrivateLessonLine(schoolId,{
        recipients:unique,entity,eventType,deliveryId:lineDeliveryId,format:origin=>formatPrivateLessonNotice({...notice,appUrl:origin}).plainText
      }):undefined
    ]);
    return {...mail,lineStatus};
  }catch(e){console.error(`Private lesson ${eventType} email failed:`,e);return {status:"failed",recipientCount:0,sentCount:0,failedCount:1,error:clean(e?.message||e,300)}}
}
function emailResponse(result,entity){return {
  status:String(result?.status||entity.emailNotificationStatus||""),recipientCount:Number(result?.recipientCount??entity.emailNotificationRecipients??0),sentCount:Number(result?.sentCount??entity.emailNotificationSentCount??0),
  acceptedCount:Number(result?.acceptedCount??entity.emailNotificationAcceptedCount??0),failedCount:Number(result?.failedCount??entity.emailNotificationFailedCount??0),type:String(entity.emailNotificationType||""),resendCount:Number(entity.emailNotificationResendCount||0)
}}

app.http("privateLesson",{
  methods:["GET","POST","PATCH"],authLevel:"anonymous",route:"private-lesson",
  handler:async(request)=>{
    const context=await getTenantContext(request);if(context.error)return context.error;
    const {access:a,schoolId}=context;
    await ensureTenantTables();
    const tenant=await getTenantDirectory(schoolId),timeZone=safeTimeZone(tenant?.timezone),clock=zonedClock(timeZone),schoolName=clean(tenant?.systemName||tenant?.schoolName||a.schoolName||"弦樂團管理系統",120);

    if(request.method==="GET"){
      const requested=clean(request.query.get("studentId"),120),month=clean(request.query.get("month"),12);
      const start=/^\d{4}-\d{2}$/.test(month)?`${month}-01`:null,end=/^\d{4}-\d{2}$/.test(month)?`${month}-31`:null;
      let ids=[];
      if(requested){
        if(a.role==="admin")ids=[requested];
        else if(a.role==="parent"){if(!ensureStudentAccess(a,requested))return json({error:"Forbidden"},403);ids=[requested]}
        else if(a.capabilities?.private){if(!ensurePrivateAccess(a,requested))return json({error:"此老師未綁定該學生的個別課權限"},403);ids=[requested]}
        else return json({error:"Forbidden"},403);
      }else if(a.role==="parent")ids=(a.students||[]).map(x=>String(x.studentId||"")).filter(Boolean);
      else if(a.capabilities?.private)ids=[...new Set((a.privateStudentIds||[]).map(String).filter(Boolean))];
      else return json({error:"請指定 studentId"},400);

      const rows=[];
      for(const id of ids)for(const r of await rowsForStudent(id,start,end,schoolId)){
        if(a.capabilities?.private&&a.role!=="admin"&&String(r.teacher||"").toLowerCase()!==String(a.email||"").toLowerCase())continue;
        rows.push(r);
      }
      const nameCache=new Map(),records=[];
      for(const r of rows){
        const teacherEmail=String(r.teacher||"").trim().toLowerCase();
        if(!nameCache.has(teacherEmail))nameCache.set(teacherEmail,await resolvedTeacherName(teacherEmail,r.teacherName,schoolId));
        const item=view(r,nameCache.get(teacherEmail));
        // Original schedule changes are visible only to school administrators.
        if(a.role==="admin"){
          try{const changes=JSON.parse(String(r.scheduleHistory||"[]"));item.scheduleHistory=Array.isArray(changes)?changes.slice(-10):[]}catch{item.scheduleHistory=[]}
          item.rescheduleReason=String(r.rescheduleReason||"");
        }
        records.push(item);
      }
      records.sort((x,y)=>String(y.lessonDate).localeCompare(String(x.lessonDate))||String(y.startTime).localeCompare(String(x.startTime))||String(y.createdAt).localeCompare(String(x.createdAt)));
      return json({items:records.slice(0,150),pendingCount:records.filter(x=>x.workflowStatus==="awaiting_parent").length,scheduledCount:records.filter(x=>x.workflowStatus==="scheduled").length,today:clock.date,nowTime:clock.time,timeZone});
    }

    if(request.method==="PATCH"){
      const body=await request.json(),studentId=clean(body.studentId,120),lessonId=clean(body.lessonId,180),action=clean(body.action,40).toLowerCase();
      if(!studentId||!lessonId)return json({error:"缺少 studentId 或 lessonId"},400);
      const entity=await findLesson(studentId,lessonId,schoolId);if(!entity)return json({error:"找不到個別課紀錄"},404);
      const canonicalStudentId=activityStudentId(entity),master=await getStudentMaster(canonicalStudentId,schoolId),studentName=clean(master?.studentName||"學生",80),teacherName=await resolvedTeacherName(entity.teacher,entity.teacherName,schoolId);
      const isAdmin=a.role==="admin",isParent=a.role==="parent",isTeacher=!isAdmin&&!!a.capabilities?.private;
      if(isParent&&!ensureStudentAccess(a,studentId))return json({error:"Forbidden"},403);
      if(isTeacher){
        if(!ensurePrivateAccess(a,studentId))return json({error:"此老師未綁定該學生的個別課權限"},403);
        if(String(entity.teacher||"").toLowerCase()!==String(a.email||"").toLowerCase())return json({error:"只能異動自己建立的個別課預約"},403);
      }

      if(action==="reschedule_lesson"){
        if(!(isAdmin||isParent||isTeacher))return json({error:"只有此學生家長、個別課老師或管理員可以改期"},403);
        if(!isAdmin&&!canChangeSchedule(entity,clock))return json({error:"只有尚未到上課開始時間的預約可以改期"},409);
        if(isAdmin&&workflowStatus(entity)!=="scheduled")return json({error:"只有預約中的個別課可以改期"},409);
        const lessonDate=clean(body.lessonDate,20),startTime=clean(body.startTime,10),endTime=clean(body.endTime,10),error=scheduleError(lessonDate,startTime,endTime,clock,{requireFutureStart:true});
        if(error)return json({error},400);
        const duplicate=await duplicateFor(canonicalStudentId,entity.teacher,lessonDate,schoolId,lessonId);
        if(duplicate)return json({error:"這位學生在新日期已有同一位老師的個別課預約，請選擇其他日期"},409);
        const previous={lessonDate:String(entity.eventDate||""),startTime:String(entity.startTime||""),endTime:String(entity.endTime||"")};
        if(previous.lessonDate===lessonDate&&previous.startTime===startTime&&previous.endTime===endTime)return json({error:"新的日期與時間和原預約相同"},400);
        const now=new Date().toISOString();
        appendScheduleHistory(entity,{...previous,changedAt:now,changedBy:a.email,reason:clean(body.reason,300)});
        entity.eventDate=lessonDate;entity.startTime=startTime;entity.endTime=endTime;entity.minutes=minutesBetween(startTime,endTime);
        if(Object.hasOwn(body,"lessonContent"))entity.lessonContent=clean(body.lessonContent,500);
        entity.rescheduledAt=now;entity.rescheduledBy=a.email;entity.rescheduleReason=clean(body.reason,300);entity.rescheduleCount=Number(entity.rescheduleCount||0)+1;entity.updatedAt=now;
        if(!await saveLessonVersion(entity))return json({error:"個課紀錄已更新，請重新整理後再操作"},409);
        const target=isAdmin?"both":isParent?"teacher":"parents",result=await notifyWorkflow({request,schoolId,schoolName,entity,studentName,teacherName,eventType:"rescheduled",target,actorEmail:a.email,actorName:a.displayName||a.email,previous});
        const notificationAuditPersisted=await persistNotificationAudit(entity,"rescheduled",result,a.email);
        return json({ok:true,item:view(entity,teacherName),emailNotification:emailResponse(result,entity),notificationAuditPersisted});
      }

      if(action==="cancel_lesson"||action==="cancel_mistaken_booking"){
        const mistake=action==="cancel_mistaken_booking";
        if(mistake?!(isAdmin||isTeacher):!(isAdmin||isParent||isTeacher))return json({error:mistake?"只有個別課老師或管理員可以取消誤約":"只有此學生家長、個別課老師或管理員可以停課"},403);
        if(workflowStatus(entity)==="cancelled")return json({ok:true,item:view(entity,teacherName)});
        if(String(entity.parentConfirmation||"")==="confirmed")return json({error:"此筆個別課已完成家長確認，紀錄已鎖定"},409);
        if(mistake){
          if(workflowStatus(entity)!=="scheduled"||!lessonEnded(entity,clock))return json({error:"只有已到預約結束時間且尚未完課的個課可以取消誤約"},409);
          entity.actualAttendanceStatus="";
          entity.lessonContent="";
          entity.weeklyPracticeGoalsJson="[]";
        }else if(!isAdmin&&!canChangeSchedule(entity,clock))return json({error:"只有尚未到上課開始時間的預約可以停課"},409);
        const now=new Date().toISOString();
        entity.status="cancelled";entity.parentConfirmation="not_required";entity.cancelledAt=now;entity.cancelledBy=a.email;entity.cancelReason=mistake?"老師誤設個別課預約，該堂課已取消，請忽略先前的預約通知。":clean(body.reason||"個別課停課",300);entity.updatedAt=now;
        if(!await saveLessonVersion(entity))return json({error:"個課紀錄已更新，請重新整理後再操作"},409);
        const target=mistake?"parents":isAdmin?"both":isParent?"teacher":"parents",result=await notifyWorkflow({request,schoolId,schoolName,entity,studentName,teacherName,eventType:"cancelled",target,actorEmail:a.email,actorName:a.displayName||a.email});
        const notificationAuditPersisted=await persistNotificationAudit(entity,"cancelled",result,a.email);
        return json({ok:true,item:view(entity,teacherName),emailNotification:emailResponse(result,entity),notificationAuditPersisted});
      }

      if(action==="update_lesson_content"){
        if(!(isAdmin||isTeacher))return json({error:"只有個別課老師或管理員可以修改上課內容"},403);
        if(workflowStatus(entity)!=="scheduled")return json({error:"只有尚未完成的預約可以修改上課內容"},409);
        if(!isAdmin&&(String(entity.eventDate||"")>clock.date||(String(entity.eventDate||"")===clock.date&&String(entity.startTime||"")>clock.time)))return json({error:"須於個課開始後才能填寫；已過上課日期且尚未完課的紀錄可補登內容"},409);
        entity.lessonContent=clean(body.lessonContent,500);
        if(Object.hasOwn(body,"weeklyPracticeGoals")){const goals=normalizeWeeklyGoals(body.weeklyPracticeGoals);if(goals.error)return json({error:goals.error},400);entity.weeklyPracticeGoalsJson=JSON.stringify(goals.goals)}
        entity.updatedAt=new Date().toISOString();
        if(!await saveLessonVersion(entity))return json({error:"個課紀錄已更新，請重新整理後再操作"},409);
        return json({ok:true,item:view(entity,teacherName)});
      }

      if(action==="complete_lesson"){
        if(!(isAdmin||isTeacher))return json({error:"只有個別課老師或管理員可以登記完成上課"},403);
        if(String(entity.status||"")==="teacher_completed"&&String(entity.parentConfirmation||"")==="pending"){
          const recorded=String(entity.emailNotificationType||"")==="completed";
          return json({ok:true,alreadyCompleted:true,item:view(entity,teacherName),emailNotification:emailResponse(recorded?null:{status:"unknown"},entity)});
        }
        if(!teacherCompletionStatuses.has(String(entity.status||"")))return json({error:"這筆個別課目前不是可完成上課的預約狀態"},409);
        if(!lessonEnded(entity,clock))return json({error:`尚未到預約結束時間（${entity.eventDate} ${entity.endTime}），不能提前完成上課`},409);
        const attendanceStatus=clean(body.attendanceStatus||entity.actualAttendanceStatus||"present",20);
        if(!["present","late"].includes(attendanceStatus))return json({error:"完成上課狀態只能是出席或遲到"},400);
        const now=new Date().toISOString();
        entity.status="teacher_completed";entity.actualAttendanceStatus=attendanceStatus;entity.parentConfirmation="pending";entity.parentConfirmedAt="";entity.parentConfirmedBy="";entity.parentConfirmedVia="";entity.parentNote="";
        if(Object.hasOwn(body,"lessonContent"))entity.lessonContent=clean(body.lessonContent,500);
        if(Object.hasOwn(body,"weeklyPracticeGoals")){const goals=normalizeWeeklyGoals(body.weeklyPracticeGoals);if(goals.error)return json({error:goals.error},400);entity.weeklyPracticeGoalsJson=JSON.stringify(goals.goals)}
        entity.completedAt=now;entity.completedBy=a.email;entity.updatedAt=now;
        if(!await saveLessonVersion(entity))return json({error:"個課紀錄已更新，請重新整理後再操作"},409);
        const result=await notifyWorkflow({request,schoolId,schoolName,entity,studentName,teacherName,eventType:"completed",target:"parents",actorEmail:a.email,actorName:a.displayName||teacherName});
        const notificationAuditPersisted=await persistNotificationAudit(entity,"completed",result,a.email);
        return json({ok:true,item:view(entity,teacherName),emailNotification:emailResponse(result,entity),notificationAuditPersisted});
      }

      if(action==="update_weekly_practice_goals"){
        if(!(isAdmin||isTeacher))return json({error:"只有授權個課老師或管理員可維護本週練習建議"},403);
        if(!isPublishedLesson(entity))return json({error:"請先完成上課，才能更新已發布的練習建議"},409);
        const goals=normalizeWeeklyGoals(body.weeklyPracticeGoals);
        if(goals.error)return json({error:goals.error},400);
        entity.weeklyPracticeGoalsJson=JSON.stringify(goals.goals);
        entity.weeklyPracticeGoalsUpdatedBy=String(a.email||"");
        entity.weeklyPracticeGoalsUpdatedAt=new Date().toISOString();
        entity.updatedAt=entity.weeklyPracticeGoalsUpdatedAt;
        await table("tenantPrivateLesson").updateEntity({
          partitionKey:entity.partitionKey,rowKey:entity.rowKey,
          weeklyPracticeGoalsJson:entity.weeklyPracticeGoalsJson,
          weeklyPracticeGoalsUpdatedBy:entity.weeklyPracticeGoalsUpdatedBy,
          weeklyPracticeGoalsUpdatedAt:entity.weeklyPracticeGoalsUpdatedAt,
          updatedAt:entity.updatedAt
        },"Merge");
        return json({ok:true,item:view(entity,teacherName)});
      }

      if(action==="resend_line"){
        if(!(isAdmin||isTeacher))return json({error:"只有管理員或本堂個課老師可以重發完課 LINE"},403);
        if(workflowStatus(entity)!=="awaiting_parent")return json({error:"只有待家長確認的完課紀錄可重發 LINE"},409);
        const completed=Date.parse(entity.completedAt||"");
        if(!Number.isFinite(completed)||Date.now()>=completed+7*24*60*60*1000)return json({error:"本堂 LINE 評鑑期限已過，請由家長平台確認完課"},409);
        const now=new Date().toISOString(),last=Date.parse(entity.lineNotificationLastResentAt||"");
        if(Number.isFinite(last)&&Date.parse(now)-last<60000)return json({error:"剛剛已重發完課 LINE，請等 60 秒後再試"},429);
        const audit={partitionKey:entity.partitionKey,rowKey:entity.rowKey,lineNotificationStatus:"pending",lineNotificationAt:now,
          lineNotificationResendCount:Number(entity.lineNotificationResendCount||0)+1,lineNotificationLastResentAt:now,lineNotificationLastResentBy:a.email,updatedAt:now};
        try{await table("tenantPrivateLesson").updateEntity(audit,"Merge",{etag:entity.etag})}
        catch(error){if(error.statusCode===412)return json({error:"個課紀錄剛更新，請重新整理後再試"},409);throw error}
        Object.assign(entity,audit);
        const result=await notifyWorkflow({request,schoolId,schoolName,entity,studentName,teacherName,eventType:"completed",target:"parents",
          actorEmail:a.email,actorName:a.displayName||teacherName,notifyEmail:false,lineDeliveryId:`resend:${now}`});
        entity.lineNotificationStatus=String(result.lineStatus||"failed");
        let notificationAuditPersisted=true;
        try{if(typeof lineFirstLabEnabled==="function"&&lineFirstLabEnabled())notificationAuditPersisted=await persistNotificationAudit(entity,"completed",result,a.email);else await table("tenantPrivateLesson").updateEntity({partitionKey:entity.partitionKey,rowKey:entity.rowKey,lineNotificationStatus:entity.lineNotificationStatus},"Merge")}
        catch(error){notificationAuditPersisted=false;console.warn("Private lesson LINE resend audit failed",{schoolId,status:error?.statusCode})}
        return json({ok:true,item:view(entity,teacherName),lineNotification:{status:entity.lineNotificationStatus,resendCount:entity.lineNotificationResendCount},...(typeof lineFirstLabEnabled==="function"&&lineFirstLabEnabled()?{emailNotification:emailResponse(result,entity),notificationChannel:result.channel,mailAcceptedCount:result.mailAcceptedCount||0,lineAcceptedCount:result.lineAcceptedCount||0}:{}),notificationAuditPersisted});
      }

      if(action==="resend_email"){
        if(!(isAdmin||isTeacher))return json({error:"只有管理員或個別課老師可以重寄個別課 Email"},403);
        const workflow=workflowStatus(entity),eventType=workflow==="scheduled"?"scheduled":workflow==="awaiting_parent"?"completed":"";
        if(!eventType)return json({error:"這筆紀錄目前沒有可重寄的通知"},409);
        const result=await notifyWorkflow({request,schoolId,schoolName,entity,studentName,teacherName,eventType,target:"parents",actorEmail:"",actorName:a.displayName||teacherName,notifyLine:false});
        const notificationAuditPersisted=await persistNotificationAudit(entity,eventType,result,a.email,{resend:true});
        return json({ok:true,item:view(entity,teacherName),emailNotification:emailResponse(result,entity),notificationAuditPersisted});
      }

      if(!isParent)return json({error:"只有家長可以確認個別課完成狀態"},403);
      if(!["confirmed","issue"].includes(action))return json({error:"不支援的個別課操作"},400);
      if(workflowStatus(entity)!=="awaiting_parent")return json({error:"老師尚未送出完成上課，或此筆流程已結束"},409);
      const now=new Date().toISOString(),note=clean(body.note,500);
      if(action==="issue"&&!note)return json({error:"請填寫需要老師確認的問題"},400);
      entity.parentConfirmation=action;entity.parentConfirmedAt=now;entity.parentConfirmedBy=a.email;entity.parentConfirmedVia="web";entity.parentNote=note;
      if(action==="confirmed"){
        const validation=validateParentLessonReview(body.teacherRating,body.teacherReview);
        if(validation.error)return json({error:validation.error},400);
        const {rating,review}=validation;
        if(entity.teacherRatedAt&&(rating||review)&&(Number(entity.teacherRating)!==rating||String(entity.teacherReview||"")!==review))return json({error:"這堂個課已收到評鑑，請重新整理以查看已儲存的回饋"},409);
        entity.status=["present","late"].includes(String(entity.actualAttendanceStatus||""))?String(entity.actualAttendanceStatus):"present";
        if(!entity.teacherRatedAt&&(rating||review)){
          entity.teacherRating=rating;entity.teacherReview=review;entity.teacherRatedAt=now;entity.teacherRatedBy=a.email;
        }
        entity.finalizedAt=now;
      }else{
        entity.actualAttendanceStatus=["present","late"].includes(String(entity.actualAttendanceStatus||entity.status||""))?String(entity.actualAttendanceStatus||entity.status):"present";
        entity.status="completion_issue";
      }
      entity.updatedAt=now;
      try{await table("tenantPrivateLesson").updateEntity(entity,"Merge",{etag:entity.etag})}
      catch(error){if(error.statusCode===412)return json({error:"個課紀錄剛更新，請重新讀取後再確認"},409);throw error}
      const eventType=action==="confirmed"?"confirmed":"issue",result=await notifyWorkflow({request,schoolId,schoolName,entity,studentName,teacherName,eventType,target:"teacher",actorEmail:a.email,actorName:a.displayName||"家長"});
      const notificationAuditPersisted=await persistNotificationAudit(entity,eventType,result,a.email);
      return json({ok:true,item:view(entity,teacherName),emailNotification:emailResponse(result,entity),notificationAuditPersisted});
    }

    if(!(a.role==="admin"||a.capabilities?.private))return json({error:"Forbidden"},403);
    const body=await request.json(),studentId=clean(body.studentId,120);
    if(!studentId||(a.role!=="admin"&&!ensurePrivateAccess(a,studentId)))return json({error:"此老師未綁定該學生的個別課權限"},403);
    const lessonDate=clean(body.lessonDate,20),startTime=clean(body.startTime,10),endTime=clean(body.endTime,10),error=scheduleError(lessonDate,startTime,endTime,clock,{requireFutureStart:true});
    if(error)return json({error},400);
    const alias=await getStudentAliasInfo(studentId,schoolId),canonicalStudentId=alias.canonicalStudentId||studentId,master=await getStudentMaster(canonicalStudentId,schoolId);
    if(!master||String(master.status||"active")==="inactive")return json({error:"學生不存在或已停用"},404);
    const teacherName=await resolvedTeacherName(a.email,a.displayName||a.email,schoolId),teacherKey=String(a.email||"").trim().toLowerCase();
    const duplicate=await duplicateFor(canonicalStudentId,teacherKey,lessonDate,schoolId);
    if(duplicate){
      const oldTime=[String(duplicate.startTime||""),String(duplicate.endTime||"")].filter(Boolean).join("～");
      return json({error:`這位學生當天已有同一位老師的個別課${oldTime?`（${oldTime}）`:""}，請改期或先取消原預約。`,existingLessonId:String(duplicate.rowKey||""),existingStartTime:String(duplicate.startTime||""),existingEndTime:String(duplicate.endTime||"")},409);
    }
    const now=new Date().toISOString(),lessonId=rowKey("i"),minutes=minutesBetween(startTime,endTime),sessionId=[canonicalStudentId,lessonId].join("|");
    const entity={
      partitionKey:tenantStudentPartition(schoolId,canonicalStudentId),rowKey:lessonId,schoolId,studentId:canonicalStudentId,sessionId,eventDate:lessonDate,startTime,endTime,status:"scheduled",actualAttendanceStatus:"present",minutes,
      lessonContent:clean(body.lessonContent,500),teacher:a.email,teacherName,parentConfirmation:"not_required",parentConfirmedAt:"",parentConfirmedBy:"",parentNote:"",
      teacherRating:0,teacherReview:"",teacherRatedAt:"",teacherRatedBy:"",studentPerformanceRating:0,studentPerformanceRatedAt:"",studentPerformanceRatedBy:"",scheduledAt:now,scheduledBy:a.email,rescheduledAt:"",rescheduledBy:"",rescheduleReason:"",rescheduleCount:0,scheduleHistory:"[]",
      completedAt:"",completedBy:"",finalizedAt:"",createdAt:now,updatedAt:now,
      emailNotificationType:"scheduled",emailNotificationStatus:"pending",emailNotificationAt:"",emailNotificationRecipients:0,emailNotificationAcceptedCount:0,emailNotificationSentCount:0,emailNotificationFailedCount:0,
      emailNotificationResendCount:0,emailNotificationLastResentAt:"",emailNotificationLastResentBy:"",cancelledAt:"",cancelledBy:"",cancelReason:""
    };
    await table("tenantPrivateLesson").createEntity(entity);
    const studentName=clean(master?.studentName||body.studentName||"學生",80);
    const result=await notifyWorkflow({request,schoolId,schoolName,entity,studentName,teacherName,eventType:"scheduled",target:"parents",actorEmail:a.email,actorName:a.displayName||teacherName});
    const notificationAuditPersisted=await persistNotificationAudit(entity,"scheduled",result,a.email);
    return json({ok:true,item:view(entity,teacherName),emailNotification:emailResponse(result,entity),notificationAuditPersisted,lineNotification:{status:result.lineStatus||"failed"}},201);
  }
});
