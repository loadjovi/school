import test from "node:test";
import assert from "node:assert/strict";
import {
  labLineInternalParentEmail,
  normalizeLabLineUserId,
  resolveLabLineParentIdentity,
  safeLabLineDisplayName
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
