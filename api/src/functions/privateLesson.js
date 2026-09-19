import { app } from "@azure/functions";
import { getAccess, ensurePrivateAccess, ensureStudentAccess, getStudentAliasInfo, json } from "../lib/auth.js";
import { ensureTables, table, rowKey, listByStudent, getTeacherDirectory, listUserStudentMappings, getStudentMaster } from "../lib/storage.js";
import { sendPrivateLessonParentEmail } from "../lib/email.js";
import { getSystemSettings } from "../lib/settings.js";

const allowedStatuses=new Set(["present","late","leave","absent","cancelled"]);
function clean(v,max=300){return String(v||"").trim().slice(0,max)}
function minutesBetween(start,end){
  const [sh,sm]=String(start||"").split(":").map(Number),[eh,em]=String(end||"").split(":").map(Number);
  if([sh,sm,eh,em].some(Number.isNaN))return -1;
  let m=(eh*60+em)-(sh*60+sm);if(m<0)m+=1440;return m;
}
function publicAppUrl(request){
  const explicit=clean(process.env.APP_PUBLIC_URL||process.env.SWA_PUBLIC_URL||"",1000);
  const candidates=[explicit,clean(request.headers.get("origin"),1000),clean(request.headers.get("referer"),1000)];
  const forwardedHost=clean(request.headers.get("x-forwarded-host"),500);
  const forwardedProto=clean(request.headers.get("x-forwarded-proto"),20)||"https";
  if(forwardedHost)candidates.push(`${forwardedProto}://${forwardedHost}`);
  for(const raw of candidates){
    if(!raw||raw==="null")continue;
    try{
      const u=new URL(raw);
      const host=String(u.hostname||"").toLowerCase();
      if(!["http:","https:"].includes(u.protocol))continue;
      if(host.endsWith(".azurewebsites.net"))continue;
      return u.origin+"/";
    }catch{}
  }
  return "";
}
function view(e,teacherNameOverride=""){
  return {
    lessonId:String(e.rowKey||""),studentId:String(e.partitionKey||""),lessonDate:String(e.eventDate||""),
    startTime:String(e.startTime||""),endTime:String(e.endTime||""),minutes:Number(e.minutes||0),status:String(e.status||"present"),
    lessonContent:String(e.lessonContent||""),teacher:String(e.teacher||""),teacherName:String(teacherNameOverride||e.teacherName||e.teacher||""),
    parentConfirmation:String(e.parentConfirmation||(["present","late"].includes(String(e.status||""))?"pending":"not_required")),
    parentConfirmedAt:String(e.parentConfirmedAt||""),parentConfirmedBy:String(e.parentConfirmedBy||""),parentNote:String(e.parentNote||""),
    teacherRating:Number(e.teacherRating||0),teacherReview:String(e.teacherReview||""),teacherRatedAt:String(e.teacherRatedAt||""),teacherRatedBy:String(e.teacherRatedBy||""),
    emailNotificationStatus:String(e.emailNotificationStatus||""),emailNotificationAt:String(e.emailNotificationAt||""),emailNotificationRecipients:Number(e.emailNotificationRecipients||0),emailNotificationSentCount:Number(e.emailNotificationSentCount||0),emailNotificationFailedCount:Number(e.emailNotificationFailedCount||0),
    emailNotificationResendCount:Number(e.emailNotificationResendCount||0),emailNotificationLastResentAt:String(e.emailNotificationLastResentAt||""),emailNotificationLastResentBy:String(e.emailNotificationLastResentBy||""),
    createdAt:String(e.createdAt||"")
  };
}
async function resolvedTeacherName(email,fallback=""){
  const key=String(email||"").trim().toLowerCase();
  if(!key)return clean(fallback,120);
  try{
    const d=await getTeacherDirectory(key);
    const name=clean(d?.teacherName,120);
    if(name)return name;
  }catch(e){console.warn("Unable to resolve teacher directory name:",e?.message||String(e))}
  const stored=clean(fallback,120);
  if(stored&&stored.toLowerCase()!==key)return stored;
  return "個別課老師";
}
async function rowsForStudent(studentId,start,end){
  const alias=await getStudentAliasInfo(studentId),ids=[...new Set(alias.aliases?.length?alias.aliases:[studentId])];
  const rows=(await Promise.all(ids.map(id=>listByStudent("privateLesson",id,start,end)))).flat();
  const unique=new Map();for(const r of rows)unique.set(`${r.partitionKey}|${r.rowKey}`,r);
  return [...unique.values()];
}
async function findLesson(studentId,lessonId){
  const alias=await getStudentAliasInfo(studentId),ids=[...new Set(alias.aliases?.length?alias.aliases:[studentId])];
  for(const id of ids){
    try{return await table("privateLesson").getEntity(String(id),String(lessonId))}
    catch(e){if(e.statusCode!==404)throw e}
  }
  return null;
}
async function parentEmailsForStudent(canonicalStudentId){
  const mappings=await listUserStudentMappings("active"),emails=new Set();
  for(const m of mappings){
    if(!m.parentEmail||!m.studentId)continue;
    try{
      const alias=await getStudentAliasInfo(m.studentId);
      const canonical=String(alias.canonicalStudentId||m.studentId);
      if(canonical===String(canonicalStudentId))emails.add(String(m.parentEmail).trim().toLowerCase());
    }catch(e){
      if(String(m.studentId)===String(canonicalStudentId))emails.add(String(m.parentEmail).trim().toLowerCase());
    }
  }
  return [...emails].filter(Boolean);
}

app.http("privateLesson",{
  methods:["GET","POST","PATCH"],authLevel:"anonymous",route:"private-lesson",
  handler:async(request)=>{
    const a=await getAccess(request);if(!a.authenticated)return json({error:"Unauthorized"},401);
    await ensureTables();

    if(request.method==="GET"){
      const requested=clean(request.query.get("studentId"),120),month=clean(request.query.get("month"),12);
      const start=/^\d{4}-\d{2}$/.test(month)?`${month}-01`:null,end=/^\d{4}-\d{2}$/.test(month)?`${month}-31`:null;
      let ids=[];
      if(requested){
        if(a.role==="admin")ids=[requested];
        else if(a.role==="parent"){
          if(!ensureStudentAccess(a,requested))return json({error:"Forbidden"},403);ids=[requested];
        }else if(a.capabilities?.private){
          if(!ensurePrivateAccess(a,requested))return json({error:"此老師未綁定該學生的個別課權限"},403);ids=[requested];
        }else return json({error:"Forbidden"},403);
      }else if(a.role==="parent")ids=(a.students||[]).map(x=>String(x.studentId||"")).filter(Boolean);
      else if(a.capabilities?.private)ids=[...new Set((a.privateStudentIds||[]).map(String).filter(Boolean))];
      else return json({error:"請指定 studentId"},400);

      const rows=[];
      for(const id of ids){
        for(const r of await rowsForStudent(id,start,end)){
          if(a.capabilities?.private&&a.role!=="admin"&&String(r.teacher||"").toLowerCase()!==String(a.email||"").toLowerCase())continue;
          rows.push(r);
        }
      }
      const nameCache=new Map();
      const records=[];
      for(const r of rows){
        const teacherEmail=String(r.teacher||"").trim().toLowerCase();
        if(!nameCache.has(teacherEmail))nameCache.set(teacherEmail,await resolvedTeacherName(teacherEmail,r.teacherName));
        records.push(view(r,nameCache.get(teacherEmail)));
      }
      records.sort((x,y)=>String(y.lessonDate).localeCompare(String(x.lessonDate))||String(y.createdAt).localeCompare(String(x.createdAt)));
      return json({items:records.slice(0,100),pendingCount:records.filter(x=>x.parentConfirmation==="pending").length});
    }

    if(request.method==="PATCH"){
      const body=await request.json(),studentId=clean(body.studentId,120),lessonId=clean(body.lessonId,180),action=clean(body.action,30).toLowerCase();
      if(!studentId||!lessonId)return json({error:"缺少 studentId 或 lessonId"},400);
      const entity=await findLesson(studentId,lessonId);if(!entity)return json({error:"找不到個別課紀錄"},404);

      if(action==="resend_email"){
        if(!(a.role==="admin"||a.capabilities?.private))return json({error:"只有管理員或個別課老師可以重寄確認 Email"},403);
        if(a.role!=="admin"){
          if(!ensurePrivateAccess(a,studentId))return json({error:"此老師未綁定該學生的個別課權限"},403);
          if(String(entity.teacher||"").toLowerCase()!==String(a.email||"").toLowerCase())return json({error:"只能重寄自己建立的個別課通知"},403);
        }
        if(String(entity.parentConfirmation||"")!=="pending")return json({error:"家長已完成確認或此筆不需確認，無法重寄"},409);

        let emailNotification={status:"failed",recipientCount:0,sentCount:0,failedCount:0};
        try{
          const settings=await getSystemSettings();
          if(!settings.emailNotificationsEnabled){
            emailNotification={status:"disabled",recipientCount:0,sentCount:0,failedCount:0};
          }else{
            const alias=await getStudentAliasInfo(studentId),canonicalStudentId=alias.canonicalStudentId||studentId;
            const recipients=await parentEmailsForStudent(canonicalStudentId);
            const master=await getStudentMaster(canonicalStudentId);
            const studentName=clean(master?.studentName||"學生",80);
            const teacherName=await resolvedTeacherName(entity.teacher,entity.teacherName);
            const confirmUrl=publicAppUrl(request);
            if(!confirmUrl)console.warn("Unable to resolve public app URL for private lesson resend email; set APP_PUBLIC_URL in Azure environment variables.");
            emailNotification=await sendPrivateLessonParentEmail({
              recipients,studentName,teacherName,
              lessonDate:String(entity.eventDate||""),startTime:String(entity.startTime||""),endTime:String(entity.endTime||""),
              minutes:Number(entity.minutes||0),lessonContent:String(entity.lessonContent||""),confirmUrl
            });
          }
        }catch(e){
          console.error("Private lesson parent email resend failed:",e);
          emailNotification={status:"failed",recipientCount:0,sentCount:0,failedCount:1,error:clean(e?.message||e,300)};
        }

        const now=new Date().toISOString();
        entity.emailNotificationStatus=emailNotification.status;
        entity.emailNotificationAt=now;
        entity.emailNotificationRecipients=Number(emailNotification.recipientCount||0);
        entity.emailNotificationSentCount=Number(emailNotification.sentCount||0);
        entity.emailNotificationFailedCount=Number(emailNotification.failedCount||0);
        entity.emailNotificationResendCount=Number(entity.emailNotificationResendCount||0)+1;
        entity.emailNotificationLastResentAt=now;
        entity.emailNotificationLastResentBy=a.email;
        entity.updatedAt=now;
        await table("privateLesson").updateEntity(entity,"Merge");
        const teacherName=await resolvedTeacherName(entity.teacher,entity.teacherName);
        return json({ok:true,item:view(entity,teacherName),emailNotification:{
          status:emailNotification.status,recipientCount:Number(emailNotification.recipientCount||0),
          sentCount:Number(emailNotification.sentCount||0),failedCount:Number(emailNotification.failedCount||0),
          resendCount:Number(entity.emailNotificationResendCount||0)
        }});
      }

      if(a.role!=="parent")return json({error:"只有家長可以確認個別課完成狀態"},403);
      if(!ensureStudentAccess(a,studentId))return json({error:"Forbidden"},403);
      if(!["confirmed","issue"].includes(action))return json({error:"action 必須是 confirmed、issue 或 resend_email"},400);
      if(String(entity.parentConfirmation||"")==="not_required")return json({error:"此筆紀錄不需要家長確認"},409);
      const now=new Date().toISOString();
      entity.parentConfirmation=action;
      entity.parentConfirmedAt=now;
      entity.parentConfirmedBy=a.email;
      entity.parentNote=clean(body.note,500);
      if(action==="confirmed"){
        const rating=Number(body.teacherRating||0),review=clean(body.teacherReview,800);
        if(rating&&(!Number.isInteger(rating)||rating<1||rating>5))return json({error:"老師評價必須為 1～5 顆星"},400);
        if(review&&!rating)return json({error:"若要留下老師教學評論，請先選擇 1～5 顆星"},400);
        entity.teacherRating=rating||0;
        entity.teacherReview=review;
        entity.teacherRatedAt=(rating||entity.teacherReview)?now:"";
        entity.teacherRatedBy=(rating||entity.teacherReview)?a.email:"";
      }
      await table("privateLesson").updateEntity(entity,"Merge");
      const teacherName=await resolvedTeacherName(entity.teacher,entity.teacherName);
      return json({ok:true,item:view(entity,teacherName)});
    }

    if(!(a.role==="admin"||a.capabilities?.private))return json({error:"Forbidden"},403);
    const body=await request.json(),studentId=clean(body.studentId,120);
    if(!studentId||!ensurePrivateAccess(a,studentId))return json({error:"此老師未綁定該學生的個別課權限"},403);
    const lessonDate=clean(body.lessonDate,20),status=clean(body.status||"present",20),startTime=clean(body.startTime,10),endTime=clean(body.endTime,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(lessonDate))return json({error:"上課日期不正確"},400);
    if(!allowedStatuses.has(status))return json({error:"個別課狀態不正確"},400);
    let minutes=startTime&&endTime?minutesBetween(startTime,endTime):Number(body.minutes||0);
    if(!Number.isFinite(minutes)||minutes<0||minutes>240)return json({error:"個別課時間不合法"},400);
    if(["present","late"].includes(status)&&minutes<=0)return json({error:"請填寫正確的上課時間"},400);
    const alias=await getStudentAliasInfo(studentId),canonicalStudentId=alias.canonicalStudentId||studentId;
    const now=new Date().toISOString(),confirmation=["present","late"].includes(status)?"pending":"not_required";
    const teacherName=await resolvedTeacherName(a.email,a.displayName||a.email);
    const teacherKey=String(a.email||"").trim().toLowerCase();
    const sessionId=[canonicalStudentId,lessonDate,startTime,endTime,teacherKey].join("|");

    // Same student + same date/time + same teacher is one teaching session.
    // Prevent accidental duplicate creates while still allowing multiple lessons on the same day at different times.
    const sameDay=await rowsForStudent(canonicalStudentId,lessonDate,lessonDate);
    const duplicate=sameDay.find(r=>
      String(r.status||"")!=="cancelled"&&
      String(r.teacher||"").trim().toLowerCase()===teacherKey&&
      String(r.startTime||"")===startTime&&String(r.endTime||"")===endTime
    );
    if(duplicate)return json({error:"這位學生在相同日期、時間與老師下已存在個別課紀錄，請勿重複建立"},409);

    const lessonId=rowKey("i");
    const entity={
      partitionKey:canonicalStudentId,rowKey:lessonId,sessionId,eventDate:lessonDate,startTime,endTime,status,minutes,
      lessonContent:clean(body.lessonContent,500),teacher:a.email,teacherName,
      parentConfirmation:confirmation,parentConfirmedAt:"",parentConfirmedBy:"",parentNote:"",
      teacherRating:0,teacherReview:"",teacherRatedAt:"",teacherRatedBy:"",
      createdAt:now,updatedAt:now,
      emailNotificationStatus:confirmation==="pending"?"pending":"not_required",emailNotificationAt:"",emailNotificationRecipients:0,emailNotificationSentCount:0,emailNotificationFailedCount:0,
      emailNotificationResendCount:0,emailNotificationLastResentAt:"",emailNotificationLastResentBy:""
    };
    await table("privateLesson").createEntity(entity);

    let emailNotification={status:"not_required",recipientCount:0,sentCount:0,failedCount:0};
    if(confirmation==="pending"){
      try{
        const settings=await getSystemSettings();
        if(!settings.emailNotificationsEnabled){
          emailNotification={status:"disabled",recipientCount:0,sentCount:0,failedCount:0};
        }else{
          const recipients=await parentEmailsForStudent(canonicalStudentId);
          const master=await getStudentMaster(canonicalStudentId);
          const studentName=clean(master?.studentName||body.studentName||"學生",80);
          const confirmUrl=publicAppUrl(request);
          if(!confirmUrl)console.warn("Unable to resolve public app URL for private lesson email; set APP_PUBLIC_URL in Azure environment variables.");
          emailNotification=await sendPrivateLessonParentEmail({
            recipients,studentName,teacherName,lessonDate,startTime,endTime,minutes,
            lessonContent:entity.lessonContent,confirmUrl
          });
        }
      }catch(e){
        console.error("Private lesson parent email failed:",e);
        emailNotification={status:"failed",recipientCount:0,sentCount:0,failedCount:1,error:clean(e?.message||e,300)};
      }
      entity.emailNotificationStatus=emailNotification.status;
      entity.emailNotificationAt=new Date().toISOString();
      entity.emailNotificationRecipients=Number(emailNotification.recipientCount||0);
      entity.emailNotificationSentCount=Number(emailNotification.sentCount||0);
      entity.emailNotificationFailedCount=Number(emailNotification.failedCount||0);
      await table("privateLesson").updateEntity(entity,"Merge");
    }
    return json({
      ok:true,item:view(entity,teacherName),
      emailNotification:{status:emailNotification.status,recipientCount:Number(emailNotification.recipientCount||0),sentCount:Number(emailNotification.sentCount||0),failedCount:Number(emailNotification.failedCount||0)}
    },201);
  }
});
