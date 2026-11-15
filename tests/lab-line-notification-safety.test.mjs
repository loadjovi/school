import test from "node:test";
import assert from "node:assert/strict";
import {
  LAB_LINE_NOTIFICATION_STATES,
  classifyLinePushResult,
  labSingleTestMessage,
  maskEmail,
  maskLineUserId,
  reserveRollingWindow,
  validateLabRecipient
} from "../scripts/lab-line-notification-safety.mjs";

const allowedEmail="roy@example.test";
const allowedId="U0123456789abcdef0123456789abcdef";
const binding={bound:true,lineUserId:allowedId};

test("only the exact allowlisted parent and bound LINE target pass",()=>{
  assert.equal(validateLabRecipient({email:" ROY@example.test ",allowedEmail,allowedLineUserId:allowedId,binding,tokenConfigured:true}).ok,true);
  assert.deepEqual(validateLabRecipient({email:"other@example.test",allowedEmail,allowedLineUserId:allowedId,binding,tokenConfigured:true}),{ok:false,httpStatus:403,code:"NOT_ALLOWLISTED"});
});

test("missing binding and mismatched LINE target fail closed",()=>{
  assert.equal(validateLabRecipient({email:allowedEmail,allowedEmail,allowedLineUserId:allowedId,binding:null,tokenConfigured:true}).code,"NOT_BOUND");
  assert.equal(validateLabRecipient({email:allowedEmail,allowedEmail,allowedLineUserId:allowedId,binding:{bound:true,lineUserId:"Uffffffffffffffffffffffffffffffff"},tokenConfigured:true}).code,"TARGET_MISMATCH");
});

test("invalid target or missing server token is configuration failure",()=>{
  assert.equal(validateLabRecipient({email:allowedEmail,allowedEmail,allowedLineUserId:"not-a-line-id",binding,tokenConfigured:true}).code,"CONFIGURATION_INVALID");
  assert.equal(validateLabRecipient({email:allowedEmail,allowedEmail,allowedLineUserId:allowedId,binding,tokenConfigured:false}).code,"CONFIGURATION_INVALID");
});

function atomicStore(initial=null){
  let row=initial?{...initial}:null,version=Number(initial?.version||0);
  const pause=()=>new Promise(resolve=>setImmediate(resolve));
  return {
    read:async()=>{await pause();return row?{...row}:null},
    create:async({sentAt})=>{await pause();if(row){const error=Error("conflict");error.statusCode=409;throw error}version+=1;row={sentAt,etag:String(version),version}},
    replace:async({sentAt,etag})=>{await pause();if(!row||row.etag!==etag){const error=Error("etag conflict");error.statusCode=412;throw error}version+=1;row={sentAt,etag:String(version),version}},
    value:()=>row?{...row}:null
  };
}

test("rolling 60-second window blocks until the full interval expires",async()=>{
  const store=atomicStore({sentAt:1_000,etag:"1",version:1});
  const blocked=await reserveRollingWindow({...store,key:"parent",now:60_999});
  assert.equal(blocked.ok,false);
  assert.equal(blocked.retryAfterMs,1);
  const allowed=await reserveRollingWindow({...store,key:"parent",now:61_000});
  assert.equal(allowed.ok,true);
});

test("parallel first-send requests produce exactly one reservation",async()=>{
  const store=atomicStore();
  const results=await Promise.all(Array.from({length:12},()=>reserveRollingWindow({...store,key:"parent",now:100_000})));
  assert.equal(results.filter(result=>result.ok).length,1);
  assert.equal(results.filter(result=>!result.ok&&result.code==="CONCURRENT_REQUEST").length,11);
});

test("parallel expired-slot requests produce exactly one ETag winner",async()=>{
  const store=atomicStore({sentAt:1_000,etag:"1",version:1});
  const results=await Promise.all(Array.from({length:12},()=>reserveRollingWindow({...store,key:"parent",now:100_000})));
  assert.equal(results.filter(result=>result.ok).length,1);
  assert.equal(results.filter(result=>!result.ok&&result.code==="CONCURRENT_REQUEST").length,11);
});

test("LINE outcomes distinguish accepted, rejected, and unknown",()=>{
  assert.deepEqual(classifyLinePushResult({httpStatus:200}),{state:LAB_LINE_NOTIFICATION_STATES.ACCEPTED,errorCode:""});
  assert.deepEqual(classifyLinePushResult({httpStatus:429}),{state:LAB_LINE_NOTIFICATION_STATES.FAILED,errorCode:"LINE_HTTP_429"});
  assert.deepEqual(classifyLinePushResult({error:new Error("timeout")}),{state:LAB_LINE_NOTIFICATION_STATES.UNKNOWN,errorCode:"LINE_NETWORK_OR_TIMEOUT"});
});

test("audit identifiers are masked and the fixed message uses real newlines",()=>{
  assert.equal(maskEmail(allowedEmail),"r***@example.test");
  assert.equal(maskLineUserId(allowedId),"U***cdef");
  const message=labSingleTestMessage();
  assert.equal(message.split("\n").length,3);
  assert.equal(message.includes("\\n"),false);
});
