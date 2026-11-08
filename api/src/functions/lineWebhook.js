import {app} from "@azure/functions";
import {randomInt} from "node:crypto";
import {getTenantContext,json} from "../lib/auth.js";
import {
  bindLineNotificationTarget,clearLineNotificationTarget,createLineBindingRequest,findLineBindingRequest,
  getLineNotificationTarget,getSystemSettings,recordLineTest,saveLineNotificationMode
} from "../lib/settings.js";
import {
  getLineGroupSummary,lineBindingCodeHash,lineNotificationModeLabel,normalizeLineNotificationMode,
  getLineUserProfile,parseLineAccountBindingCommand,parseLineBindingCommand,pushLineMessage,replyLineMessage,verifyLineSignature
} from "../lib/lineMessaging.mjs";
import {
  bindLineAccount,createLineAccountBindingRequest,findLineAccountBindingRequest,
  getLineAccountBinding,unbindLineAccount
} from "../lib/lineAccountBinding.js";

const lineSecret=()=>String(process.env.LINE_CHANNEL_SECRET||"").trim();
const lineToken=()=>String(process.env.LINE_CHANNEL_ACCESS_TOKEN||"").trim();
const serviceConfigured=()=>!!(lineSecret()&&lineToken());
const officialAccountUrl=()=>{
  const url=String(process.env.LINE_OFFICIAL_ACCOUNT_URL||"").trim();
  return /^https:\/\/(?:line\.me\/R\/ti\/p\/@[A-Za-z0-9._-]+|lin\.ee\/[A-Za-z0-9_-]+)$/.test(url)?url:"";
};

function lineSettingsResponse(settings,request,extra={}){
  return {
    ...settings,
    lineServiceConfigured:serviceConfigured(),
    lineChannelSecretConfigured:!!lineSecret(),
    lineAccessTokenConfigured:!!lineToken(),
    lineNotificationModeLabel:lineNotificationModeLabel(settings.lineNotificationMode),
    webhookUrl:new URL("/api/line/webhook",request.url).toString(),
    ...extra
  };
}

app.http("lineWebhook",{
  methods:["POST"],authLevel:"anonymous",route:"line/webhook",
  handler:async request=>{
    const secret=lineSecret();
    if(!secret)return json({error:"LINE webhook is not configured"},503);
    const rawBody=Buffer.from(await request.arrayBuffer());
    if(!verifyLineSignature(rawBody,request.headers.get("x-line-signature"),secret))return json({error:"Invalid signature"},401);
    let payload;
    try{payload=JSON.parse(rawBody.toString("utf8"))}catch{return json({error:"Invalid JSON"},400)}
    const events=Array.isArray(payload?.events)?payload.events:[];
    for(const event of events){
      try{
        if(event?.type!=="message"||event?.message?.type!=="text")continue;
        const accountCode=parseLineAccountBindingCommand(event.message.text);
        if(accountCode){
          const replyToken=String(event.replyToken||""),lineUserId=String(event.source?.userId||"");
          if(event.source?.type!=="user"||!lineUserId){await replyLineMessage(replyToken,"請在聖心弦樂成長平台 LINE 官方帳號的一對一聊天室輸入帳號綁定指令，請勿貼在群組中。");continue}
          const codeHash=lineBindingCodeHash(accountCode,secret),requestRow=await findLineAccountBindingRequest(codeHash);
          if(!requestRow){await replyLineMessage(replyToken,"帳號綁定碼不正確或已逾時，請回到平台「收費與匯款」重新產生。");continue}
          const profile=await getLineUserProfile(lineUserId),result=await bindLineAccount({codeHash,lineUserId,lineDisplayName:profile?.displayName||""});
          if(!result.ok){await replyLineMessage(replyToken,result.reason==="already_bound"?"此 LINE 帳號已綁定同校的其他家長帳號，請先聯絡幹部協助確認。":"帳號綁定碼已使用或逾時，請回到平台重新產生。");continue}
          await replyLineMessage(replyToken,`✅ LINE 帳號綁定完成\n平台帳號：${result.parentEmail}\n\n之後只會私訊與您家庭相關的繳費狀態，不會在群組公開個人付款資料。`);
          continue;
        }
        const code=parseLineBindingCommand(event.message.text);
        if(!code)continue;
        const replyToken=String(event.replyToken||"");
        const groupId=String(event.source?.groupId||"");
        if(!groupId){await replyLineMessage(replyToken,"請在要接收通知的 LINE 群組內輸入綁定指令。");continue}
        const requestRow=await findLineBindingRequest(lineBindingCodeHash(code,secret));
        if(!requestRow){await replyLineMessage(replyToken,"綁定碼不正確或已逾時，請回到平台「更多 → 平台設定」重新產生。");continue}
        const absence=requestRow.purpose==="absence";
        const group=await getLineGroupSummary(groupId),label=String(group?.groupName||(absence?"學生缺席通知群組":"LINE 幹部群組"));
        const saved=await bindLineNotificationTarget({schoolId:requestRow.schoolId,targetId:groupId,targetType:"group",targetLabel:label,purpose:requestRow.purpose});
        const detail=absence?"規則：只有學生新標記為缺席才會即時通知；請假、遲到與重複儲存不通知。":`模式：${lineNotificationModeLabel(saved.lineNotificationMode)}`;
        await replyLineMessage(replyToken,`✅ 已完成${absence?"學生缺席即時":"後台待辦"}通知綁定\n群組：${label}\n${detail}\n\n可回到平台按「發送測試通知」確認。`);
      }catch(error){console.error("LINE webhook event processing failed",error?.message||String(error))}
    }
    return json({ok:true});
  }
});

app.http("lineAccountBinding",{
  methods:["GET","POST","DELETE"],authLevel:"anonymous",route:"line/account-binding",
  handler:async request=>{
    const context=await getTenantContext(request);if(context.error)return context.error;
    const {access,schoolId}=context;
    if(access.role!=="parent")return json({error:"僅家長帳號可綁定個人 LINE"},403);
    try{
      if(request.method==="GET"){
        const binding=await getLineAccountBinding(schoolId,access.email);
        return json({configured:serviceConfigured(),bound:!!binding,lineDisplayName:binding?.lineDisplayName||"",boundAt:binding?.boundAt||"",officialAccountUrl:officialAccountUrl()});
      }
      if(request.method==="DELETE"){
        await unbindLineAccount(schoolId,access.email);
        return json({bound:false});
      }
      if(!serviceConfigured())return json({error:"LINE Messaging API 尚未完成設定"},409);
      const code=String(randomInt(100000,1000000)),expiresAt=new Date(Date.now()+15*60*1000).toISOString();
      await createLineAccountBindingRequest({schoolId,email:access.email,codeHash:lineBindingCodeHash(code,lineSecret()),expiresAt});
      return json({bound:false,bindingCode:code,bindingCodeExpiresAt:expiresAt,officialAccountUrl:officialAccountUrl()});
    }catch(error){console.error("LINE account binding failed",error?.message||String(error));return json({error:"LINE 帳號綁定處理失敗"},500)}
  }
});

app.http("lineNotificationSettings",{
  methods:["GET","PATCH","POST"],authLevel:"anonymous",route:"line/settings",
  handler:async request=>{
    const context=await getTenantContext(request);if(context.error)return context.error;
    const {access,schoolId}=context;
    if(access.role!=="admin")return json({error:"Forbidden"},403);
    try{
      if(request.method==="PATCH"){
        const body=await request.json(),mode=String(body?.lineNotificationMode||"");
        if(normalizeLineNotificationMode(mode)!==mode)return json({error:"通知模式不正確"},400);
        const saved=await saveLineNotificationMode({schoolId,mode,updatedBy:access.email});
        return json(lineSettingsResponse(saved,request));
      }
      if(request.method==="POST"){
        const body=await request.json(),action=String(body?.action||"");
        if(action==="create_binding_code"){
          if(!serviceConfigured())return json({error:"請先在 Azure 設定 LINE_CHANNEL_SECRET 與 LINE_CHANNEL_ACCESS_TOKEN"},409);
          const code=String(randomInt(100000,1000000)),expiresAt=new Date(Date.now()+15*60*1000).toISOString();
          await createLineBindingRequest({schoolId,codeHash:lineBindingCodeHash(code,lineSecret()),expiresAt,updatedBy:access.email});
          const settings=await getSystemSettings(schoolId);
          return json(lineSettingsResponse(settings,request,{bindingCode:code,bindingCodeExpiresAt:expiresAt}));
        }
        if(action==="create_absence_binding_code"){
          if(!serviceConfigured())return json({error:"請先在 Azure 設定 LINE_CHANNEL_SECRET 與 LINE_CHANNEL_ACCESS_TOKEN"},409);
          const code=String(randomInt(100000,1000000)),expiresAt=new Date(Date.now()+15*60*1000).toISOString();
          await createLineBindingRequest({schoolId,codeHash:lineBindingCodeHash(code,lineSecret()),expiresAt,purpose:"absence",updatedBy:access.email});
          const settings=await getSystemSettings(schoolId);
          return json(lineSettingsResponse(settings,request,{absenceBindingCode:code,absenceBindingCodeExpiresAt:expiresAt}));
        }
        if(action==="test"){
          if(!serviceConfigured())return json({error:"LINE Messaging API 尚未完成設定"},409);
          const target=await getLineNotificationTarget(schoolId);
          if(!target.targetId)return json({error:"請先綁定 LINE 幹部群組"},409);
          const sentAt=new Intl.DateTimeFormat("zh-TW",{timeZone:"Asia/Taipei",dateStyle:"medium",timeStyle:"short"}).format(new Date());
          await pushLineMessage(target.targetId,`✅ 聖心弦樂成長平台 LINE 通知測試成功\n時間：${sentAt}\n模式：${lineNotificationModeLabel(target.mode)}\n\n之後後台待辦會依設定模式發送到本群組。`);
          await recordLineTest({schoolId,updatedBy:access.email});
          const settings=await getSystemSettings(schoolId);
          return json(lineSettingsResponse(settings,request,{testSent:true}));
        }
        if(action==="test_absence"){
          if(!serviceConfigured())return json({error:"LINE Messaging API 尚未完成設定"},409);
          const target=await getLineNotificationTarget(schoolId,"absence");
          if(!target.targetId)return json({error:"請先綁定學生缺席通知群組"},409);
          const sentAt=new Intl.DateTimeFormat("zh-TW",{timeZone:"Asia/Taipei",dateStyle:"medium",timeStyle:"short"}).format(new Date());
          await pushLineMessage(target.targetId,`✅ 學生缺席即時通知群組測試成功\n時間：${sentAt}\n\n之後只有學生被新標記為「缺席」時會通知本群組；請假、遲到與重複儲存不通知。`);
          await recordLineTest({schoolId,purpose:"absence",updatedBy:access.email});
          const settings=await getSystemSettings(schoolId);
          return json(lineSettingsResponse(settings,request,{absenceTestSent:true}));
        }
        if(action==="unbind"){
          const settings=await clearLineNotificationTarget({schoolId,updatedBy:access.email});
          return json(lineSettingsResponse(settings,request));
        }
        if(action==="unbind_absence"){
          const settings=await clearLineNotificationTarget({schoolId,purpose:"absence",updatedBy:access.email});
          return json(lineSettingsResponse(settings,request));
        }
        return json({error:"不支援的操作"},400);
      }
      return json(lineSettingsResponse(await getSystemSettings(schoolId),request));
    }catch(error){console.error("LINE settings failed",error?.message||String(error));return json({error:"LINE 通知設定處理失敗"},500)}
  }
});
