import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");

test("new parent registration notifies active school administrators after persistence",()=>{
  const source=read("api/src/functions/studentRegistration.js");
  assert.match(source,/createEntity\(entity\)[\s\S]*notifyPendingParentRegistration\(\{schoolId,registrationId,studentName\}\)/);
  assert.match(source,/staffLineNotification/);
});

test("finance LINE reminders use finance assignment intersection and reported transfers only",()=>{
  const source=read("api/src/lib/labStaffLineNotifications.mjs");
  assert.match(source,/financeRecipients\(admins,assignments\)/);
  assert.match(source,/item\.stage==="reported"/);
  assert.match(source,/getLineAccountBinding\(schoolId,recipient,\{includeTarget:true\}\)/);
  assert.match(source,/parent-registration:/);
  assert.match(source,/finance-transfer:/);
});

test("notification delivery is deduplicated and cannot block the primary workflow",()=>{
  const module=read("api/src/lib/labStaffLineNotifications.mjs");
  const registration=read("api/src/functions/studentRegistration.js");
  const payments=read("api/src/lib/paymentNotifications.js");
  assert.match(module,/createEntity\(\{partitionKey:String\(schoolId\),rowKey:key/);
  assert.match(module,/if\(error\.statusCode!==409\)throw error/);
  assert.match(module,/return \{status:"failed",sent:0,failed:1\}/);
  assert.match(registration,/await notifyPendingParentRegistration/);
  assert.match(payments,/preview\?\{status:"preview",sent:0\}:await notifyFinanceTransferReports/);
});

test("a failed LAB delivery can be retried while sent notifications stay deduplicated",()=>{
  const module=read("api/src/lib/labStaffLineNotifications.mjs");
  assert.match(module,/if\(row\.status!=="FAILED"\)return false/);
  assert.match(module,/status:"SENDING"[\s\S]*\{etag:row\.etag\}/);
});
