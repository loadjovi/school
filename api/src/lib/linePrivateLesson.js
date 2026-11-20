import {createHmac} from "node:crypto";
import {TableClient} from "@azure/data-tables";
import {getStudentAliasInfo} from "./auth.js";
import {ensureTenantTables,getMappedStudentsByEmail,table,tenantStudentPartition} from "./storage.js";
import {workflowLineEnabled,workflowLineRetryKey} from "./lineAdminTodoNotification.mjs";
import {resolveTenantLineChannel} from "./lineTenantConfig.js";
import {getTenantLineRecipient} from "./tenantLineAccounts.js";
import {pushLineMessage} from "./lineMessaging.mjs";
import {validateParentLessonReview} from "./privateLessonReview.mjs";

const reviewLifetime=7*24*60*60*1000;
function reviewQuickReply(code){
  return {items:[1,2,3,4,5].map(rating=>({type:"action",action:{type:"postback",label:`${rating} 星 ${"★".repeat(rating)}`,
    data:`lesson-review:${code}:${rating}`,inputOption:"openKeyboard",fillInText:`#個課評鑑 ${code} ${rating} `}}))};
}
function reviewInstructions(code,expiresAt){
  const deadline=new Date(expiresAt).toLocaleString("zh-TW",{timeZone:"Asia/Taipei",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
  return `\n\n──────────\n⭐ 評鑑並確認完課\n點 1～5 星 → 加上評語 → 傳送，即確認完成上課。\n\n未見按鈕？複製下行，修改星數與評語，保留代碼：\n#個課評鑑 ${code} 5 請填寫您的想法\n\n請用家長自己的 LINE 回覆。\n截止：${deadline}（台灣時間）`;
}
function reviewFormatHint(text){
  const code=String(text||"").match(/^#個課評鑑\s+([a-f\d]{14})(?:\s|$)/iu)?.[1]?.toUpperCase();
  return `請用家長自己的 LINE，在本官方帳號的一對一聊天室回覆「指令＋代碼＋星數＋實際評語」。\n星數需填數字 1～5，並在同一則訊息中寫下評語。\n\n${code?`#個課評鑑 ${code} 5 請填寫您的想法`:"請複製完課通知中，以「#個課評鑑」開頭的那一整行。"}\n\n保留指令與代碼，把「請填寫您的想法」換成您的實際評語後，再按傳送。`;
}
const lessonKey=entity=>[entity.partitionKey,entity.rowKey];
const scope=(schoolId,botUserId)=>`${schoolId}|${botUserId}`;
let store;
async function reviewTable(create=false){
  store ||= TableClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING,"TenantLineLessonReview");
  if(create)await store.createTable().catch(error=>{if(error.statusCode!==409)throw error});
  return store;
}

async function reserveReview(channel,entity,email,userId){
  const key=createHmac("sha256",channel.channelSecret)
    .update(JSON.stringify([...lessonKey(entity),entity.completedAt,email,userId])).digest("hex").slice(0,14).toUpperCase();
  const db=await reviewTable(true);
  const row={partitionKey:scope(channel.schoolId,channel.botUserId),rowKey:key,
    studentId:String(entity.studentId),lessonId:entity.rowKey,completedAt:entity.completedAt,
    email,userId,expiresAt:Date.parse(entity.completedAt)+reviewLifetime};
  try{await db.createEntity(row)}catch(error){
    if(error.statusCode!==409)throw error;
    const existing=await db.getEntity(row.partitionKey,key);
    if(existing.userId!==userId||existing.lessonId!==row.lessonId||existing.email!==email||existing.completedAt!==row.completedAt)throw error;
  }
  return key;
}

export async function notifyPrivateLessonLine(schoolId,{recipients,entity,eventType,format,deliveryId=""}){
  if(!workflowLineEnabled()||!recipients.length)return "disabled";
  try{
    const channel=await resolveTenantLineChannel(schoolId);
    if(!channel.loginConfigured||!channel.botUserId)return "not_configured";
    const text=(process.env.LAB_ENVIRONMENT==="functional-uat"?"【LAB】\n":"")+format(channel.appOrigin);
    const eventId=["private",entity.rowKey,eventType,entity.updatedAt,...(deliveryId?[deliveryId]:[])].join(":");
    const seen=new Set();
    const accounts=await Promise.all(recipients.map(email=>getTenantLineRecipient(schoolId,email,channel.botUserId)));
    const tasks=accounts.flatMap((account,index)=>{
      if(!account?.lineUserId||seen.has(account.lineUserId))return [];
      const userId=account.lineUserId;
      seen.add(userId);
      return [(async()=>{
        const canReview=eventType==="completed"&&entity.completedAt&&Date.now()<Date.parse(entity.completedAt)+reviewLifetime;
        const code=canReview?await reserveReview(channel,entity,recipients[index],userId):"";
        const review=code?reviewInstructions(code,Date.parse(entity.completedAt)+reviewLifetime):"";
        await pushLineMessage(userId,text+review,{accessToken:channel.accessToken,retryKey:workflowLineRetryKey(schoolId,eventId,userId),...(code?{quickReply:reviewQuickReply(code)}:{})});
      })()];
    });
    if(!tasks.length)return "not_bound";
    const results=await Promise.allSettled(tasks),accepted=results.filter(result=>result.status==="fulfilled").length;
    return accepted===tasks.length?"accepted":accepted?"partial":"failed";
  }catch(error){
    console.warn("Private lesson LINE notification failed",{schoolId,status:error?.status||error?.statusCode});
    return "failed";
  }
}

export async function receivePrivateLessonReview(channel,userId,text){
  if(!/^#個課評鑑(?:\s|$)/u.test(text))return null;
  const match=text.match(/^#個課評鑑\s+([a-f\d]{14})\s+([1-5])\s+([\s\S]+)$/iu);
  if(!match)return reviewFormatHint(text);
  if(!userId)return "請在學校官方帳號的一對一聊天室填寫評鑑。";
  if(!workflowLineEnabled())return "此環境尚未開啟 LINE 評鑑。";
  const {schoolId,botUserId}=channel;
  const validation=validateParentLessonReview(match[2],match[3]);
  if(validation.error||validation.review==="請填寫您的想法")return reviewFormatHint(text);
  const expired="評鑑代碼已失效，請由平台的個課紀錄查看。";
  try{
    const db=await reviewTable(),record=await db.getEntity(scope(schoolId,botUserId),match[1].toUpperCase());
    if(record.userId!==userId||Date.now()>=record.expiresAt)return expired;
    const currentAccount=await getTenantLineRecipient(schoolId,record.email,botUserId);
    if(currentAccount?.lineUserId!==userId)return expired;
    const mappings=await getMappedStudentsByEmail(record.email,schoolId);
    const canonical=await Promise.all(mappings.map(row=>getStudentAliasInfo(row.studentId,schoolId)));
    if(!canonical.some(info=>String(info.canonicalStudentId)===record.studentId))return expired;
    await ensureTenantTables();
    const lessons=table("tenantPrivateLesson");
    const partitionKey=tenantStudentPartition(schoolId,record.studentId);
    const lesson=await lessons.getEntity(partitionKey,record.lessonId);
    if(lesson.completedAt!==record.completedAt||lesson.parentConfirmation==="issue"||!["teacher_completed","present","late"].includes(lesson.status))return expired;
    if(lesson.teacherRatedAt&&!(lesson.parentConfirmation==="pending"&&lesson.teacherRatedBy===record.email&&Number(lesson.teacherRating)===validation.rating&&lesson.teacherReview===validation.review))return "這堂個課已收到評鑑，可在平台查看。";
    const timestamp=new Date().toISOString();
    const attendance=["present","late"].includes(lesson.actualAttendanceStatus)?lesson.actualAttendanceStatus:["present","late"].includes(lesson.status)?lesson.status:"present";
    const patch={partitionKey,rowKey:record.lessonId};
    if(!lesson.teacherRatedAt)Object.assign(patch,{teacherRating:validation.rating,
      teacherReview:validation.review,teacherRatedAt:timestamp,teacherRatedBy:record.email});
    if(lesson.parentConfirmation!=="confirmed")Object.assign(patch,{status:attendance,actualAttendanceStatus:attendance,
      parentConfirmation:"confirmed",parentConfirmedAt:timestamp,parentConfirmedBy:record.email,parentConfirmedVia:"line",
      parentNote:"",finalizedAt:timestamp});
    patch.updatedAt=timestamp;
    await lessons.updateEntity(patch,"Merge",{etag:lesson.etag});
    return `✅ 已確認 ${lesson.eventDate} 個課完成上課，並已記錄 ${validation.rating} 星與文字回饋。\n教學星級：${"★".repeat(validation.rating)}（${validation.rating}/5）\n您的評語：${validation.review}\n\n本堂個課已結案，星級與評語已同步平台，不需再到網頁確認。家長網頁約 30 秒更新，也可點「重新整理」。`;
  }catch(error){
    if(error.statusCode===404)return expired;
    if(error.statusCode===412)return "個課資料剛更新。請重新送出評鑑，系統會核對最新狀態。";
    console.warn("Private lesson LINE review could not be saved",{schoolId,status:error?.status||error?.statusCode});
    return "評鑑暫時無法送出，請稍後重試。";
  }
}
