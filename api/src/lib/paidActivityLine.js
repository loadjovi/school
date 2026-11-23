import {TableClient} from "@azure/data-tables";
import {getTenantLineDeliveryRecipient} from "./tenantLineAccounts.js";
import {lineAudienceStudents,resolveLineAudience} from "./lineAudience.js";
import {workflowLineEnabled,workflowLineRetryKey} from "./lineAdminTodoNotification.mjs";
import {resolveTenantLineChannel} from "./lineTenantConfig.js";
import {lineApi} from "./lineMessaging.mjs";
import {lineFirstLabEnabled,deliverLabNotice,labNoticeUrl} from "./labNoticeDelivery.mjs";
import {familyPaymentInfo,paymentNoticeKey} from "./paymentNoticeRules.mjs";

const groupCode = value => {
  const group = String(value || "").trim().replace(/團$/, "").trim().toUpperCase();
  return group === "儲備" || group === "預備" ? "C" : group;
};
const targetGroups = activity => String(activity.targetGroups || "ALL").split(",").map(groupCode);
export function activityAllowsGroup(activity, group) {
  const target = targetGroups(activity);
  return target.includes("ALL") || target.includes(groupCode(group));
}

export function isPaidActivityOpen(activity, now = Date.now()) {
  if (!activity?.enabled || (activity.closeAt && Date.parse(activity.closeAt) <= now)) return false;
  if (activity.module === "yearEndDinner") {
    return activity.paymentOpen === true && activity.feeStatus === "PUBLISHED" &&
      [activity.firstAdultFee,activity.extraAdultFee,activity.extraChildFee].some(fee => fee > 0);
  }
  return activity.module === "fieldTrip" &&
    [activity.studentFee,activity.firstAdultFee,activity.extraAdultFee,activity.extraChildFee].some(fee => fee > 0);
}

export const collectingTrip = activity => activity?.module === "fieldTrip" && activity.enabled &&
  activity.collectionOpen === true && activity.paymentOpen === true && activity.feeStatus === "PUBLISHED" &&
  [activity.studentFee,activity.firstAdultFee,activity.extraAdultFee,activity.extraChildFee].some(fee => fee > 0);

async function registeredPaymentAudience(schoolId, channel, activityId) {
  const client = TableClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING,"TenantFamilyEventRegistration");
  const emails = new Set(),registrations=new Map();
  try {
    for await (const row of client.listEntities({queryOptions:{filter:`PartitionKey eq '${schoolId.replaceAll("'","''")}'`}})) {
      const item = JSON.parse(row.payload || "{}");
      if (item.kind === "fieldTrip" && item.activityId === activityId && item.registrationStatus === "REGISTERED" &&
          ["NOT_OPEN","AWAITING_TRANSFER"].includes(item.paymentStatus) && item.parentEmail){emails.add(item.parentEmail);registrations.set(item.parentEmail,{...item,id:row.rowKey})}
    }
  } catch (error) {
    if (error.statusCode !== 404) throw error;
  }
  const trusted=channel.schoolId===schoolId&&channel.botUserId&&(channel.configured===true||channel.loginConfigured===true);
  const accounts = await Promise.all([...emails].map(email=>trusted?getTenantLineDeliveryRecipient(schoolId,email,channel):null));
  return {
    targets:[...new Set(accounts.map(account=>account?.lineUserId).filter(id=>/^U[0-9a-f]{32}$/i.test(id||"")))].sort(),
    unbound:accounts.filter(account=>!account?.lineUserId).length,
    contacts:[...emails].map((email,index)=>({email,userId:accounts[index]?.lineUserId||"",registration:registrations.get(email)}))
  };
}

async function activityParentAudience(schoolId, botUserId, activity) {
  const students = (await lineAudienceStudents(schoolId))
    .filter(student=>activityAllowsGroup(activity,student.groupName));
  return resolveLineAudience(schoolId,botUserId,{students,roles:["parent"],groups:[]});
}

export async function notifyPaidActivityOpened(schoolId, activity, openedAt, kind) {
  if (activity.openAt && Date.parse(activity.openAt) > Date.now()) return {status:"scheduled"};
  if (!workflowLineEnabled()) return {status:"disabled"};
  try {
    const channel = await resolveTenantLineChannel(schoolId);
    const lineFirst=typeof lineFirstLabEnabled==="function"&&lineFirstLabEnabled();
    if ((!channel.loginConfigured || !channel.botUserId)&&!lineFirst) return {status:"disabled"};
    const payment = kind === "payment";
    const audience = payment
      ? await registeredPaymentAudience(schoolId,channel,activity.id)
      : await activityParentAudience(schoolId,channel.botUserId,activity);
    const counts = {accepted:0,failed:0,unbound:audience.unbound,deliveryMode:"push"};
    if (!audience.targets.length&&!lineFirst) return {...counts,status:"no_recipients"};
    const appUrl=channel.appOrigin||labNoticeUrl(schoolId);if(!appUrl)return {status:"not_configured"};
    const url = new URL(appUrl);
    url.searchParams.set("schoolId", schoolId);
    url.searchParams.set("paidActivity", activity.module + ":" + activity.id);
    const format = new Intl.DateTimeFormat("zh-TW", {timeZone:"Asia/Taipei",dateStyle:"short",timeStyle:"short",hour12:false});
    const dinner = activity.module === "yearEndDinner";
    const text = [
      process.env.LAB_ENVIRONMENT === "functional-uat" ? "【LAB｜付費活動】" : "【付費活動】",
      activity.title,
      payment ? "已開放已報名家庭繳款。" : "已開放報名。",
      !payment && activity.closeAt ? "報名截止 " + format.format(new Date(activity.closeAt)) : "",
      payment ? "請到平台核對應繳金額，依指示匯款並回報。" : dinner ? "請到平台查看活動與費用，決定是否參加。若參加，請依平台指示匯款並回報。"
        : "請到平台查看活動與費用，決定是否報名，再依平台的收款進度繳款。",
      url.toString()
    ].filter(Boolean).join("\n");
    if(lineFirst){
      if(!payment){
        const result=await deliverLabNotice({schoolId,eventId:["activity",activity.module,activity.id,kind,openedAt].join(":"),recipients:(audience.contacts||[]).map(contact=>contact.email),subject:activity.title,text});
        return {...counts,accepted:result.lineAcceptedCount,emailAccepted:result.mailAcceptedCount,failed:result.failedCount+(result.status==="unconfirmed"?1:0),status:result.status==="sent"?"accepted":result.status};
      }
      let emailAccepted=0,accepted=0,failed=0;
      for(const contact of audience.contacts||[]){
        const amount=payment?familyPaymentInfo(activity,contact.registration).amount:null;
        if(payment&&!(amount>0))continue;
        const eventId=payment?"payment:"+paymentNoticeKey({category:"family",sourceId:contact.registration.id,recipient:contact.email.toLowerCase(),version:String(amount)}):["activity",activity.module,activity.id,kind,openedAt].join(":");
        const result=await deliverLabNotice({schoolId,eventId,recipients:[contact.email],subject:activity.title,text});
        accepted+=result.lineAcceptedCount;emailAccepted+=result.mailAcceptedCount;failed+=result.failedCount+(result.status==="unconfirmed"?1:0);
      }
      return {...counts,accepted,emailAccepted,failed,status:failed?(accepted+emailAccepted?"partial":"failed"):accepted+emailAccepted?"accepted":"no_recipients"};
    }
    // Match individual lesson/payment notifications. Multicast silently omits
    // non-friends even when they recently chatted with this school's account.
    const targets = [...new Set(audience.targets)];
    for (let index = 0; index < targets.length; index += 10) {
      await Promise.all(targets.slice(index,index + 10).map(async userId=>{
        const options = {
          accessToken:channel.accessToken,
          retryKey:workflowLineRetryKey(schoolId, [activity.module,activity.id,kind,openedAt].join(":"), userId),
          body:{to:userId,messages:[{type:"text",text}]}
        };
        try {
          await lineApi("/v2/bot/message/push",options).catch(error => {
            if (error.status && error.status < 500) throw error;
            return lineApi("/v2/bot/message/push",options);
          });
          counts.accepted++;
        } catch (error) {
          counts.failed++;
          console.warn("Paid activity LINE recipient failed", {schoolId,status:error?.status});
        }
      }));
    }
    const status = counts.failed ? (counts.accepted ? "partial" : "failed") : "accepted";
    return {...counts,status};
  } catch (error) {
    console.warn("Paid activity LINE invitation failed", {schoolId,status:error?.status||error?.statusCode});
    return {status:"failed"};
  }
}
