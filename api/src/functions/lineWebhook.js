import {app} from "@azure/functions";
import {randomInt} from "node:crypto";
import {getTenantContext,json} from "../lib/auth.js";
import {defaultTenantId,tenantIdValue} from "../lib/storage.js";
import {resolveTenantLineChannel,lineTargetMatchesChannel,tenantWebhookPath} from "../lib/lineTenantConfig.js";
import {
  bindLineNotificationTarget,clearLineNotificationTarget,createLineBindingRequest,findLineBindingRequest,
  getLineNotificationTarget,getSystemSettings,recordLineTest,saveLineNotificationMode
} from "../lib/settings.js";
import {
  getLineGroupSummary,lineBindingCodeHash,lineNotificationModeLabel,normalizeLineNotificationMode,
  parseLineBindingCommand,pushLineMessage,replyLineMessage,verifyLineSignature
} from "../lib/lineMessaging.mjs";

function lineSettingsResponse(settings,request,channel,extra={}){
  return {
    ...settings,
    lineServiceConfigured:channel.configured,
    lineChannelSecretConfigured:channel.hasSecret,
    lineAccessTokenConfigured:channel.hasToken,
    lineNotificationModeLabel:lineNotificationModeLabel(settings.lineNotificationMode),
    webhookUrl:new URL(tenantWebhookPath(channel),request.url).toString(),
    ...extra
  };
}

async function handleLineWebhook(request,schoolId,legacyRoute){
    if(!schoolId||tenantIdValue(schoolId)!==schoolId)return json({error:"Not found"},404);
    const channel=await resolveTenantLineChannel(schoolId);
    if(!channel.configured||legacyRoute!==channel.legacy)return json({error:"LINE webhook is not configured"},503);
    const {channelSecret:secret,accessToken,botUserId}=channel;
    const options={accessToken};
    const rawBody=Buffer.from(await request.arrayBuffer());
    if(!verifyLineSignature(rawBody,request.headers.get("x-line-signature"),secret))return json({error:"Invalid signature"},401);
    let payload;
    try{payload=JSON.parse(rawBody.toString("utf8"))}catch{return json({error:"Invalid JSON"},400)}
    if(botUserId&&payload?.destination!==botUserId)return json({error:"Invalid destination"},401);
    const events=Array.isArray(payload?.events)?payload.events:[];
    for(const event of events){
      try{
        if(event?.type!=="message"||event?.message?.type!=="text")continue;
        const code=parseLineBindingCommand(event.message.text);
        if(!code)continue;
        const replyToken=String(event.replyToken||"");
        const groupId=event.source?.type==="group"?String(event.source.groupId||""):"";
        if(!groupId){await replyLineMessage(replyToken,"請在要接收通知的 LINE 群組內輸入綁定指令。",options);continue}
        const requestRow=await findLineBindingRequest(schoolId,lineBindingCodeHash(code,secret),botUserId);
        if(!requestRow){await replyLineMessage(replyToken,"綁定碼不正確或已逾時，請回到平台「更多 → 平台設定」重新產生。",options);continue}
        const absence=requestRow.purpose==="absence";
        const group=await getLineGroupSummary(groupId,options),label=String(group?.groupName||(absence?"學生缺席通知群組":"LINE 幹部群組"));
        const saved=await bindLineNotificationTarget({schoolId,targetId:groupId,targetType:"group",targetLabel:label,requestRow,botUserId});
        if(!saved)continue;
        const detail=absence?"規則：只有學生新標記為缺席才會即時通知；請假、遲到與重複儲存不通知。":`模式：${lineNotificationModeLabel(saved.lineNotificationMode)}`;
        await replyLineMessage(replyToken,`✅ 已完成${absence?"學生缺席即時":"後台待辦"}通知綁定\n群組：${label}\n${detail}\n\n可回到平台按「發送測試通知」確認。`,options);
      }catch(error){console.error("LINE webhook event processing failed",error?.message||String(error))}
    }
    return json({ok:true});
}

app.http("lineWebhook",{
  methods:["POST"],authLevel:"anonymous",route:"line/webhook",
  handler:request=>handleLineWebhook(request,defaultTenantId(),true)
});

app.http("tenantLineWebhook",{
  methods:["POST"],authLevel:"anonymous",route:"line/webhook/{schoolId}",
  handler:request=>handleLineWebhook(request,request.params.schoolId,false)
});

app.http("lineNotificationSettings",{
  methods:["GET","PATCH","POST"],authLevel:"anonymous",route:"line/settings",
  handler:async request=>{
    const context=await getTenantContext(request);if(context.error)return context.error;
    const {access,schoolId}=context;
    if(access.role!=="admin")return json({error:"Forbidden"},403);
    try{
      const channel=await resolveTenantLineChannel(schoolId);
      if(request.method==="PATCH"){
        const body=await request.json(),mode=String(body?.lineNotificationMode||"");
        if(normalizeLineNotificationMode(mode)!==mode)return json({error:"通知模式不正確"},400);
        const saved=await saveLineNotificationMode({schoolId,mode,updatedBy:access.email});
        return json(lineSettingsResponse(saved,request,channel));
      }
      if(request.method==="POST"){
        const body=await request.json(),action=String(body?.action||"");
        if(action==="create_binding_code"){
          if(!channel.configured)return json({error:"請先啟用該校的 LINE 官方帳號"},409);
          const code=String(randomInt(100000,1000000)),expiresAt=new Date(Date.now()+15*60*1000).toISOString();
          await createLineBindingRequest({schoolId,codeHash:lineBindingCodeHash(code,channel.channelSecret),botUserId:channel.botUserId,expiresAt,updatedBy:access.email});
          const settings=await getSystemSettings(schoolId);
          return json(lineSettingsResponse(settings,request,channel,{bindingCode:code,bindingCodeExpiresAt:expiresAt}));
        }
        if(action==="create_absence_binding_code"){
          if(!channel.configured)return json({error:"請先啟用該校的 LINE 官方帳號"},409);
          const code=String(randomInt(100000,1000000)),expiresAt=new Date(Date.now()+15*60*1000).toISOString();
          await createLineBindingRequest({schoolId,codeHash:lineBindingCodeHash(code,channel.channelSecret),botUserId:channel.botUserId,expiresAt,purpose:"absence",updatedBy:access.email});
          const settings=await getSystemSettings(schoolId);
          return json(lineSettingsResponse(settings,request,channel,{absenceBindingCode:code,absenceBindingCodeExpiresAt:expiresAt}));
        }
        if(action==="test"){
          if(!channel.configured)return json({error:"LINE Messaging API 尚未完成設定"},409);
          const target=await getLineNotificationTarget(schoolId);
          if(!lineTargetMatchesChannel(target,channel))return json({error:"請先綁定 LINE 幹部群組"},409);
          const sentAt=new Intl.DateTimeFormat("zh-TW",{timeZone:"Asia/Taipei",dateStyle:"medium",timeStyle:"short"}).format(new Date());
          await pushLineMessage(target.targetId,`✅ ${context.tenant.systemName||context.tenant.schoolName||"學校平台"} LINE 通知測試成功\n時間：${sentAt}\n模式：${lineNotificationModeLabel(target.mode)}\n\n之後後台待辦會依設定模式發送到本群組。`,channel);
          await recordLineTest({schoolId,updatedBy:access.email});
          const settings=await getSystemSettings(schoolId);
          return json(lineSettingsResponse(settings,request,channel,{testSent:true}));
        }
        if(action==="test_absence"){
          if(!channel.configured)return json({error:"LINE Messaging API 尚未完成設定"},409);
          const target=await getLineNotificationTarget(schoolId,"absence");
          if(!lineTargetMatchesChannel(target,channel))return json({error:"請先綁定學生缺席通知群組"},409);
          const sentAt=new Intl.DateTimeFormat("zh-TW",{timeZone:"Asia/Taipei",dateStyle:"medium",timeStyle:"short"}).format(new Date());
          await pushLineMessage(target.targetId,`✅ 學生缺席即時通知群組測試成功\n時間：${sentAt}\n\n之後只有學生被新標記為「缺席」時會通知本群組；請假、遲到與重複儲存不通知。`,channel);
          await recordLineTest({schoolId,purpose:"absence",updatedBy:access.email});
          const settings=await getSystemSettings(schoolId);
          return json(lineSettingsResponse(settings,request,channel,{absenceTestSent:true}));
        }
        if(action==="unbind"){
          const settings=await clearLineNotificationTarget({schoolId,updatedBy:access.email});
          return json(lineSettingsResponse(settings,request,channel));
        }
        if(action==="unbind_absence"){
          const settings=await clearLineNotificationTarget({schoolId,purpose:"absence",updatedBy:access.email});
          return json(lineSettingsResponse(settings,request,channel));
        }
        return json({error:"不支援的操作"},400);
      }
      return json(lineSettingsResponse(await getSystemSettings(schoolId),request,channel));
    }catch(error){console.error("LINE settings failed",error?.message||String(error));return json({error:"LINE 通知設定處理失敗"},500)}
  }
});
