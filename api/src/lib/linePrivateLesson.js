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

export async function notifyPrivateLessonLine(schoolId,{recipients,entity,eventType,format}){
  if(!workflowLineEnabled()||!recipients.length)return "disabled";
  try{
    const channel=await resolveTenantLineChannel(schoolId);
    if(!channel.loginConfigured||!channel.botUserId)return "not_configured";
    const text=(process.env.LAB_ENVIRONMENT==="functional-uat"?"【LAB】\n":"")+format(channel.appOrigin);
    const eventId=["private",entity.rowKey,eventType,entity.updatedAt].join(":");
    const seen=new Set();
    const accounts=await Promise.all(recipients.map(email=>getTenantLineRecipient(schoolId,email,channel.botUserId)));
    const tasks=accounts.flatMap((account,index)=>{
      if(!account?.lineUserId||seen.has(account.lineUserId))return [];
      const userId=account.lineUserId;
      seen.add(userId);
      return [(async()=>{
        const canReview=eventType==="completed"&&entity.completedAt&&Date.now()<Date.parse(entity.completedAt)+reviewLifetime;
        const code=canReview?await reserveReview(channel,entity,recipients[index],userId):"";
        const review=code?`\n\n可直接在聊天室回覆評鑑，請將星數改為 1～5，並填寫給老師的想法。\n#個課評鑑 ${code} 5 請填寫您的想法`:"";
        await pushLineMessage(userId,text+review,{accessToken:channel.accessToken,retryKey:workflowLineRetryKey(schoolId,eventId,userId)});
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
  if(!match)return "請依課後通知中的格式，填寫評鑑代碼、1～5 星與給老師的想法。";
  if(!userId)return "請在學校官方帳號的一對一聊天室填寫評鑑。";
  if(!workflowLineEnabled())return "此環境尚未開啟 LINE 評鑑。";
  const {schoolId,botUserId}=channel;
  const validation=validateParentLessonReview(match[2],match[3]);
  if(validation.error||validation.review==="請填寫您的想法")return "請填寫您要給老師的文字回饋。";
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
    if(lesson.completedAt!==record.completedAt||!["teacher_completed","present","late"].includes(lesson.status))return expired;
    if(lesson.teacherRatedAt)return "這堂個課已收到評鑑，可在平台查看。";
    const timestamp=new Date().toISOString();
    await lessons.updateEntity({partitionKey,rowKey:record.lessonId,teacherRating:validation.rating,
      teacherReview:validation.review,teacherRatedAt:timestamp,teacherRatedBy:record.email},"Merge",{etag:lesson.etag});
    return `已記錄 ${lesson.eventDate} 個課的 ${validation.rating} 星與文字回饋。您可以在平台查看評鑑結果。`;
  }catch(error){
    if(error.statusCode===404)return expired;
    if(error.statusCode===412)return "個課資料剛更新。請重新送出評鑑，系統會核對最新狀態。";
    console.warn("Private lesson LINE review could not be saved",{schoolId,status:error?.status||error?.statusCode});
    return "評鑑暫時無法送出，請稍後重試。";
  }
}
