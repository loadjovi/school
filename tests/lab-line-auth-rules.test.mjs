import test from "node:test";
import assert from "node:assert/strict";
import {
  isLabSyntheticParentEmail,
  labParentIdentityPair,
  labLineInternalParentEmail,
  normalizeLabLineUserId,
  normalizeVerifiedGmail,
  resolveLabLineParentIdentity,
  safeLabLineDisplayName,
  validateLabParentIdentityPair
} from "../scripts/lab-line-auth-rules.mjs";

const lineId="U0123456789abcdef0123456789abcdef";

test("LINE user ID must match the verified Messaging API subject format",()=>{
  assert.equal(normalizeLabLineUserId(lineId),lineId);
  assert.equal(normalizeLabLineUserId("U123"),"");
  assert.equal(normalizeLabLineUserId("not-line"),"");
});

test("new LINE-only parent receives a stable opaque LAB identity",()=>{
  const first=labLineInternalParentEmail(lineId),second=labLineInternalParentEmail(lineId);
  assert.equal(first,second);
  assert.match(first,/^line\.[0-9a-f]{32}@lab\.invalid$/);
  assert.equal(first.includes(lineId),false);
  const resolved=resolveLabLineParentIdentity(lineId,[]);
  assert.deepEqual(resolved,{ok:true,code:"OK",parentEmail:first,linkedExisting:false});
});

test("an existing Gmail-linked LINE identity reuses the parent identity",()=>{
  const resolved=resolveLabLineParentIdentity(lineId,[
    {schoolId:"school-a",parentEmail:"Parent@Example.com"},
    {schoolId:"school-b",parentEmail:"parent@example.com"}
  ]);
  assert.deepEqual(resolved,{ok:true,code:"OK",parentEmail:"parent@example.com",linkedExisting:true});
});

test("conflicting existing parent identities fail closed",()=>{
  const resolved=resolveLabLineParentIdentity(lineId,[
    {parentEmail:"one@example.com"},{parentEmail:"two@example.com"}
  ]);
  assert.equal(resolved.ok,false);
  assert.equal(resolved.code,"IDENTITY_CONFLICT");
  assert.equal(resolved.parentEmail,"");
});

test("LINE display name is bounded and control characters are removed",()=>{
  assert.equal(safeLabLineDisplayName(" Roy\nLin "),"RoyLin");
  assert.equal(safeLabLineDisplayName(""),"LINE 家長");
  assert.equal(safeLabLineDisplayName("a".repeat(150)).length,100);
});

test("verified Gmail and synthetic LINE-only identities stay distinct",()=>{
  const synthetic=labLineInternalParentEmail(lineId);
  assert.equal(isLabSyntheticParentEmail(synthetic),true);
  assert.equal(normalizeVerifiedGmail(synthetic),"");
  assert.equal(normalizeVerifiedGmail(" Parent@Example.com "),"parent@example.com");
  assert.equal(normalizeVerifiedGmail("not-an-email"),"");
});

test("a LINE and Gmail pair has deterministic non-secret storage keys",()=>{
  const first=labParentIdentityPair(lineId,"parent@example.com"),second=labParentIdentityPair(lineId,"PARENT@example.com");
  assert.deepEqual(first,second);
  assert.match(first.lineRowKey,/^line_[0-9a-f]{48}$/);
  assert.match(first.gmailRowKey,/^gmail_[0-9a-f]{48}$/);
  assert.equal(first.lineRowKey.includes(lineId),false);
});

test("the same verified Gmail and LINE pair is accepted",()=>{
  const pair=labParentIdentityPair(lineId,"parent@example.com");
  const result=validateLabParentIdentityPair({
    lineUserId:lineId,gmailEmail:"parent@example.com",
    lineLink:{parentEmail:"parent@example.com"},gmailLink:{lineUserIdHash:pair.lineUserIdHash},
    lineBindings:[{parentEmail:"parent@example.com"}],gmailBindings:[{lineUserId:lineId}]
  });
  assert.equal(result.ok,true);
  assert.equal(result.code,"OK");
});

test("a LINE identity already linked to another Gmail fails closed",()=>{
  const result=validateLabParentIdentityPair({lineUserId:lineId,gmailEmail:"new@example.com",lineLink:{parentEmail:"old@example.com"}});
  assert.equal(result.ok,false);
  assert.equal(result.code,"LINE_ALREADY_LINKED");
});

test("a Gmail already linked to another LINE identity fails closed",()=>{
  const pair=labParentIdentityPair("Uffffffffffffffffffffffffffffffff","parent@example.com");
  const result=validateLabParentIdentityPair({lineUserId:lineId,gmailEmail:"parent@example.com",gmailLink:{lineUserIdHash:pair.lineUserIdHash}});
  assert.equal(result.ok,false);
  assert.equal(result.code,"GMAIL_ALREADY_LINKED");
});

test("legacy bindings cannot silently merge two different parents",()=>{
  const lineConflict=validateLabParentIdentityPair({lineUserId:lineId,gmailEmail:"parent@example.com",lineBindings:[{parentEmail:"other@example.com"}]});
  assert.equal(lineConflict.code,"LINE_BINDING_CONFLICT");
  const gmailConflict=validateLabParentIdentityPair({lineUserId:lineId,gmailEmail:"parent@example.com",gmailBindings:[{lineUserId:"Uffffffffffffffffffffffffffffffff"}]});
  assert.equal(gmailConflict.code,"GMAIL_BINDING_CONFLICT");
});
