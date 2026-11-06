import {app} from "@azure/functions";
import {randomInt} from "node:crypto";
import {getTenantContext,json} from "../lib/auth.js";
import {
  bindLineNotificationTarget,clearLineNotificationTarget,createLineBindingRequest,findLineBindingRequest,
  getLineNotificationTarget,getSystemSettings,recordLineTest,saveLineNotificationMode
} from "../lib/settings.js";
import {
  getLineGroupSummary,lineBindingCodeHash,lineNotificationModeLabel,normalizeLineNotificationMode,
  parseLineBindingCommand,pushLineMessage,replyLineMessage,verifyLineSignature
} from "../lib/lineMessaging.mjs";

const lineSecret=()=>String(process.env.LINE_CHANNEL_SECRET||"").trim();
const lineToken=()=>String(process.env.LINE_CHANNEL_ACCESS_TOKEN||"").trim();
const serviceConfigured=()=>!!(lineSecret()&&lineToken());

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
        const code=parseLineBindingCommand(event.message.text);
        if(!code)continue;
        const replyToken=String(event.replyToken||"");
        const groupId=String(event.source?.groupId||"");
        if(!groupId){await replyLineMessage(replyToken,"請在要接收後台待辦的 LINE 幹部群組內輸入綁定指令。");continue}
        const requestRow=await findLineBindingRequest(lineBindingCodeHash(code,secret));
        if(!requestRow){await replyLineMessage(replyToken,"綁定碼不正確或已逾時，請回到平台「更多 → 平台設定」重新產生。");continue}
        const group=await getLineGroupSummary(groupId),label=String(group?.groupName||"LINE 幹部群組");
        const saved=await bindLineNotificationTarget({schoolId:requestRow.schoolId,targetId:groupId,targetType:"group",targetLabel:label});
        await replyLineMessage(replyToken,`✅ 已完成後台待辦通知綁定\n群組：${label}\n模式：${lineNotificationModeLabel(saved.lineNotificationMode)}\n\n可回到平台按「發送測試通知」確認。`);
      }catch(error){console.error("LINE webhook event processing failed",error?.message||String(error))}
    }
    return json({ok:true});
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
        if(action==="unbind"){
          const settings=await clearLineNotificationTarget({schoolId,updatedBy:access.email});
          return json(lineSettingsResponse(settings,request));
        }
        return json({error:"不支援的操作"},400);
      }
      return json(lineSettingsResponse(await getSystemSettings(schoolId),request));
    }catch(error){console.error("LINE settings failed",error?.message||String(error));return json({error:"LINE 通知設定處理失敗"},500)}
  }
});
