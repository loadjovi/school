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

export async function lineApi(path,{method="POST",body,accessToken,retryKey,timeoutMs=10000}={}){
  const token=String(accessToken||"").trim();
  if(!token)throw new Error("LINE_CHANNEL_ACCESS_TOKEN 未設定");
  const response=await fetch(`https://api.line.me${path}`,{
    method,
    headers:{Authorization:`Bearer ${token}`,...(body?{"Content-Type":"application/json"}:{}),...(retryKey?{"X-Line-Retry-Key":retryKey}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),
    signal:AbortSignal.timeout(Number.isInteger(timeoutMs)&&timeoutMs>=500&&timeoutMs<=10000?timeoutMs:10000)
  });
  const responseText=await response.text();
  if(response.status===409&&retryKey&&response.headers.get("x-line-accepted-request-id"))return {accepted:true};
  if(!response.ok)throw Object.assign(new Error(`LINE Messaging API 回應 ${response.status}`),{status:response.status});
  if(!responseText)return {};
  try{return JSON.parse(responseText)}catch{return {}}
}

export function normalizeLineReplyMessage(value){
  if(value?.type!=="flex")return {type:"text",text:String(value||"").slice(0,5000)};
  const fallback={type:"text",text:String(value.fallbackText||value.altText||"請重新查詢目前資料。").slice(0,5000)};
  const contents=value.contents,bubbles=contents?.type==="bubble"?[contents]:contents?.type==="carousel"?contents.contents:null;
  if(!Array.isArray(bubbles)||!bubbles.length||bubbles.length>12||bubbles.some(bubble=>bubble?.type!=="bubble"||!bubble.body))return fallback;
  try{
    if(bubbles.some(bubble=>Buffer.byteLength(JSON.stringify(bubble),"utf8")>30000))return fallback;
    if(Buffer.byteLength(JSON.stringify(contents),"utf8")>48000)return fallback;
  }catch{return fallback}
  const altText=Array.from(String(value.altText||"").trim()).slice(0,400).join("");
  return altText?{type:"flex",altText,contents}:fallback;
}

export async function replyLineMessage(replyToken,text,{accessToken}={}){
  const token=String(replyToken||"").trim();
  if(!token)return {skipped:true};
  const message=normalizeLineReplyMessage(text);
  const send=value=>lineApi("/v2/bot/message/reply",{accessToken,body:{replyToken:token,messages:[value]}});
  try{return await send(message)}
  catch(error){
    // A rejected card may use its readable text fallback. Never retry an
    // unknown delivery outcome, which could already have consumed the token.
    if(message.type==="flex"&&error.status===400&&text.fallbackText)return send({type:"text",text:String(text.fallbackText).slice(0,5000)});
    throw error;
  }
}

export async function pushLineMessage(to,text,{accessToken,retryKey,quickReply}={}){
  const target=String(to||"").trim();
  if(!target)throw new Error("LINE 通知群組尚未綁定");
  const message=normalizeLineReplyMessage(text);
  const send=value=>lineApi("/v2/bot/message/push",{accessToken,retryKey,body:{to:target,messages:[{...value,...(quickReply?{quickReply}:{})}]}});
  try{return await send(message)}
  catch(error){
    // A definite payload rejection can use plain text with the same delivery
    // key. Unknown outcomes retain the existing no-resend behavior.
    if(message.type==="flex"&&error.status===400&&text.fallbackText)return send({type:"text",text:String(text.fallbackText).slice(0,5000)});
    throw error;
  }
}

export async function getLineGroupSummary(groupId,{accessToken}={}){
  const id=String(groupId||"").trim();
  if(!id)return null;
  try{return await lineApi(`/v2/bot/group/${encodeURIComponent(id)}/summary`,{method:"GET",accessToken})}catch{return null}
}
