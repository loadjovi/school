import {createHash,createHmac,timingSafeEqual} from "node:crypto";

export const LAB_LINE_ASSERTION_PREFIX="lab-line-assertion.";

function assertionKey(secret){
  const value=String(secret||"").trim();
  if(value.length<20)throw Error("LAB LINE assertion signing key unavailable");
  return createHash("sha256").update("functional-uat-line-api-assertion\0").update(value).digest();
}

export function createLabLineApiAssertion({sessionId,expiresAt,secret}={}){
  const sid=String(sessionId||""),expires=Date.parse(String(expiresAt||""));
  if(!/^[a-f0-9]{64}$/.test(sid)||!Number.isFinite(expires))throw Error("LAB LINE assertion payload invalid");
  const payload=Buffer.from(JSON.stringify({v:1,iss:"functional-uat-line",sid,exp:Math.floor(expires/1000)})).toString("base64url");
  const signature=createHmac("sha256",assertionKey(secret)).update(payload).digest("base64url");
  return payload+"."+signature;
}

export function verifyLabLineApiAssertion({token,secret,now=Date.now()}={}){
  const parts=String(token||"").split(".");
  if(parts.length!==2||!/^[A-Za-z0-9_-]{20,800}$/.test(parts[0])||!/^[A-Za-z0-9_-]{43}$/.test(parts[1]))return null;
  const expected=createHmac("sha256",assertionKey(secret)).update(parts[0]).digest();
  let supplied;
  try{supplied=Buffer.from(parts[1],"base64url")}catch{return null}
  if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return null;
  let payload;
  try{payload=JSON.parse(Buffer.from(parts[0],"base64url").toString("utf8"))}catch{return null}
  if(payload?.v!==1||payload?.iss!=="functional-uat-line"||!/^[a-f0-9]{64}$/.test(String(payload?.sid||""))||!Number.isSafeInteger(payload?.exp)||payload.exp*1000<=Number(now))return null;
  return {sessionId:String(payload.sid),expiresAt:payload.exp*1000};
}
