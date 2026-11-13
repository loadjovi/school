import test from "node:test";
import assert from "node:assert/strict";
import {createLabLineApiAssertion,verifyLabLineApiAssertion} from "../scripts/lab-line-api-assertion.mjs";

const secret="functional-uat-only-secret-123456789";
const sessionId="a".repeat(64);
const now=Date.parse("2026-11-13T01:00:00Z");
const expiresAt="2026-11-13T02:00:00Z";

test("signed LAB LINE assertion verifies without exposing parent identity",()=>{
  const token=createLabLineApiAssertion({sessionId,expiresAt,secret});
  const result=verifyLabLineApiAssertion({token,secret,now});
  assert.deepEqual(result,{sessionId,expiresAt:Date.parse(expiresAt)});
  assert.equal(token.includes("@"),false);
  assert.equal(token.includes("U123"),false);
});

test("tampered, expired, and wrong-secret assertions fail closed",()=>{
  const token=createLabLineApiAssertion({sessionId,expiresAt,secret});
  const [payload,signature]=token.split(".");
  assert.equal(verifyLabLineApiAssertion({token:payload+"x."+signature,secret,now}),null);
  assert.equal(verifyLabLineApiAssertion({token,secret:"another-functional-uat-secret-123",now}),null);
  assert.equal(verifyLabLineApiAssertion({token,secret,now:Date.parse(expiresAt)}),null);
});

test("invalid session identifiers and weak secrets are rejected",()=>{
  assert.throws(()=>createLabLineApiAssertion({sessionId:"not-a-session",expiresAt,secret}),/payload invalid/);
  assert.throws(()=>createLabLineApiAssertion({sessionId,expiresAt,secret:"short"}),/signing key unavailable/);
});
