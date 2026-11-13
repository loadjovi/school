// Pure, dependency-free safety rules shared by the generated Functional UAT LAB
// endpoint and its negative/concurrency tests. This file is copied into the
// isolated LAB API at build time; Production does not import or serve it.

export const LAB_LINE_RATE_LIMIT_MS=60_000;
export const LAB_LINE_NOTIFICATION_STATES=Object.freeze({
  CREATED:"CREATED",
  SENDING:"SENDING",
  ACCEPTED:"ACCEPTED",
  FAILED:"FAILED",
  UNKNOWN:"UNKNOWN"
});

export function normalizeEmail(value){
  return String(value||"").trim().toLowerCase();
}

export function normalizeLineUserId(value){
  return String(value||"").trim();
}

export function isLineUserId(value){
  return /^U[0-9a-f]{32}$/i.test(normalizeLineUserId(value));
}

export function validateLabRecipient({email,allowedEmail,allowedLineUserId,binding,tokenConfigured}={}){
  const actualEmail=normalizeEmail(email),expectedEmail=normalizeEmail(allowedEmail);
  const expectedId=normalizeLineUserId(allowedLineUserId);
  if(!expectedEmail||actualEmail!==expectedEmail)return {ok:false,httpStatus:403,code:"NOT_ALLOWLISTED"};
  if(!isLineUserId(expectedId)||tokenConfigured!==true)return {ok:false,httpStatus:503,code:"CONFIGURATION_INVALID"};
  if(binding?.bound!==true||!normalizeLineUserId(binding?.lineUserId))return {ok:false,httpStatus:403,code:"NOT_BOUND"};
  if(normalizeLineUserId(binding.lineUserId)!==expectedId)return {ok:false,httpStatus:403,code:"TARGET_MISMATCH"};
  return {ok:true,httpStatus:200,code:"OK",email:actualEmail,lineUserId:expectedId};
}

export function maskEmail(value){
  const email=normalizeEmail(value),at=email.indexOf("@");
  if(at<=0)return "***";
  const local=email.slice(0,at),domain=email.slice(at+1);
  return `${local.slice(0,1)}***@${domain||"***"}`;
}

export function maskLineUserId(value){
  const id=normalizeLineUserId(value);
  if(!id)return "***";
  return `${id.slice(0,1)}***${id.slice(-4)}`;
}

export function labSingleTestMessage(){
  return [
    "🎻【LAB 測試通知】",
    "聖心弦樂成長平台 LINE 單人通知驗證。",
    "此訊息僅發送至指定測試家長，不代表正式活動通知。"
  ].join("\n");
}

function conflict(error){
  const status=Number(error?.statusCode||error?.status||0);
  return status===409||status===412;
}

/**
 * Atomically reserves a rolling-window send slot through a tiny storage adapter.
 * `create` must fail with 409 when the key already exists; `replace` must use
 * the supplied ETag and fail with 412 when another request won the race.
 */
export async function reserveRollingWindow({read,create,replace,key,now=Date.now(),windowMs=LAB_LINE_RATE_LIMIT_MS}={}){
  if(typeof read!=="function"||typeof create!=="function"||typeof replace!=="function")throw new TypeError("rate-limit storage adapter is incomplete");
  if(!String(key||"")||!Number.isFinite(Number(now))||!Number.isFinite(Number(windowMs))||Number(windowMs)<=0)throw new TypeError("rate-limit parameters are invalid");
  const timestamp=Number(now),window=Number(windowMs),prior=await read(key);
  const last=Number(prior?.sentAt||0);
  if(Number.isFinite(last)&&last>0&&timestamp-last<window){
    return {ok:false,code:"RATE_LIMITED",retryAfterMs:Math.max(1,window-(timestamp-last))};
  }
  if(!prior){
    try{await create({key,sentAt:timestamp})}
    catch(error){if(conflict(error))return {ok:false,code:"CONCURRENT_REQUEST",retryAfterMs:window};throw error}
    return {ok:true,code:"RESERVED",sentAt:timestamp};
  }
  try{await replace({key,sentAt:timestamp,etag:prior.etag})}
  catch(error){if(conflict(error))return {ok:false,code:"CONCURRENT_REQUEST",retryAfterMs:window};throw error}
  return {ok:true,code:"RESERVED",sentAt:timestamp};
}

export function classifyLinePushResult({httpStatus,error}={}){
  if(error)return {state:LAB_LINE_NOTIFICATION_STATES.UNKNOWN,errorCode:"LINE_NETWORK_OR_TIMEOUT"};
  const status=Number(httpStatus||0);
  if(status>=200&&status<300)return {state:LAB_LINE_NOTIFICATION_STATES.ACCEPTED,errorCode:""};
  if(status>0)return {state:LAB_LINE_NOTIFICATION_STATES.FAILED,errorCode:`LINE_HTTP_${status}`};
  return {state:LAB_LINE_NOTIFICATION_STATES.UNKNOWN,errorCode:"LINE_RESULT_MISSING"};
}
