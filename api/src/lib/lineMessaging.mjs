import {createHash,createHmac,timingSafeEqual} from "node:crypto";

export const LINE_NOTIFICATION_MODES=Object.freeze({
  important_and_daily:"重要即時＋每日摘要",
  instant_only:"只有即時",
  daily_only:"只有每日摘要",
  off:"關閉"
});

export function normalizeLineNotificationMode(value){
  const mode=String(value||"").trim();
  return Object.hasOwn(LINE_NOTIFICATION_MODES,mode)?mode:"important_and_daily";
}

export function lineNotificationModeLabel(value){
  return LINE_NOTIFICATION_MODES[normalizeLineNotificationMode(value)];
}

export function verifyLineSignature(rawBody,signature,channelSecret){
  const secret=String(channelSecret||"");
  const provided=String(signature||"").trim();
  if(!secret||!provided)return false;
  const body=Buffer.isBuffer(rawBody)?rawBody:Buffer.from(rawBody||"");
  const expected=createHmac("sha256",secret).update(body).digest();
  let actual;
  try{actual=Buffer.from(provided,"base64")}catch{return false}
  return actual.length===expected.length&&timingSafeEqual(actual,expected);
}

export function lineBindingCodeHash(code,channelSecret){
  const normalized=String(code||"").replace(/\D/g,"");
  const secret=String(channelSecret||"");
  if(!/^\d{6}$/.test(normalized)||!secret)return "";
  return createHash("sha256").update(`${secret}:${normalized}`).digest("hex");
}

export function parseLineBindingCommand(text){
  const match=String(text||"").trim().match(/^#?綁定通知[\s　:：-]*(\d{6})$/u);
  return match?match[1]:"";
}

function lineToken(){return String(process.env.LINE_CHANNEL_ACCESS_TOKEN||"").trim()}

async function lineApi(path,{method="POST",body}={}){
  const token=lineToken();
  if(!token)throw new Error("LINE_CHANNEL_ACCESS_TOKEN 未設定");
  const response=await fetch(`https://api.line.me${path}`,{
    method,
    headers:{Authorization:`Bearer ${token}`,...(body?{"Content-Type":"application/json"}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),
    signal:AbortSignal.timeout(10000)
  });
  const responseText=await response.text();
  if(!response.ok)throw new Error(`LINE Messaging API 回應 ${response.status}`);
  if(!responseText)return {};
  try{return JSON.parse(responseText)}catch{return {}}
}

export async function replyLineMessage(replyToken,text){
  const token=String(replyToken||"").trim();
  if(!token)return {skipped:true};
  return lineApi("/v2/bot/message/reply",{body:{replyToken:token,messages:[{type:"text",text:String(text||"").slice(0,5000)}]}});
}

export async function pushLineMessage(to,text){
  const target=String(to||"").trim();
  if(!target)throw new Error("LINE 通知群組尚未綁定");
  return lineApi("/v2/bot/message/push",{body:{to:target,messages:[{type:"text",text:String(text||"").slice(0,5000)}]}});
}

export async function getLineGroupSummary(groupId){
  const id=String(groupId||"").trim();
  if(!id)return null;
  try{return await lineApi(`/v2/bot/group/${encodeURIComponent(id)}/summary`,{method:"GET"})}catch{return null}
}
