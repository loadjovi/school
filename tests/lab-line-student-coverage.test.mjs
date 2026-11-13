import test from "node:test";
import assert from "node:assert/strict";
import {buildLabLineStudentCoverage,maskParentEmail,parentCoverageKey} from "../scripts/lab-line-student-coverage-model.mjs";

const students=[
  {studentId:"110001",studentName:"測試甲同學",status:"active"},
  {studentId:"110002",studentName:"測試乙同學",status:"active"},
  {studentId:"110003",studentName:"測試丙同學",status:"active"},
  {studentId:"110004",studentName:"測試丁同學",status:"active"},
  {studentId:"OLD001",studentName:"已離團同學",status:"inactive"}
];

test("siblings share one unique parent while both students receive coverage",()=>{
  const email="family@example.com";
  const result=buildLabLineStudentCoverage({
    schoolId:"school-lab",students,
    parentLinks:[
      {studentId:"110001",parentEmail:email,parentName:"測試家長",relationship:"母親",status:"active"},
      {studentId:"110002",parentEmail:email,parentName:"測試家長",relationship:"母親",status:"active"}
    ],
    bindingsByEmail:new Map([[email,{bound:true,friendStatus:"friend",lineDisplayName:"LINE 測試家長",boundAt:"2026-11-12T01:02:03.000Z"}]])
  });
  assert.equal(result.summary.activeStudents,4);
  assert.equal(result.summary.uniqueParentAccounts,1);
  assert.equal(result.summary.uniqueBoundParents,1);
  assert.equal(result.summary.boundStudents,2);
  assert.equal(result.summary.notifiableStudents,2);
});

test("bound and friend status remain separate",()=>{
  const result=buildLabLineStudentCoverage({
    schoolId:"school-lab",students:[students[0]],
    parentLinks:[
      {studentId:"110001",parentEmail:"first@example.com",status:"active"},
      {studentId:"110001",parentEmail:"second@example.com",status:"active"}
    ],
    bindingsByEmail:new Map([
      ["first@example.com",{bound:true,friendStatus:"unknown"}],
      ["second@example.com",{bound:false}]
    ])
  });
  assert.equal(result.items[0].status,"BOUND_UNKNOWN");
  assert.equal(result.items[0].lineBoundParentCount,1);
  assert.equal(result.items[0].notifiableParentCount,0);
  assert.equal(result.summary.friendStatusPendingStudents,1);
});

test("a bound parent who is not an official-account friend is not counted as notifiable",()=>{
  const result=buildLabLineStudentCoverage({
    schoolId:"school-lab",students:[students[0]],
    parentLinks:[{studentId:"110001",parentEmail:"blocked@example.com",status:"active"}],
    bindingsByEmail:new Map([["blocked@example.com",{bound:true,friendStatus:"not_friend"}]])
  });
  assert.equal(result.items[0].status,"BOUND_NOT_FRIEND");
  assert.equal(result.summary.boundStudents,1);
  assert.equal(result.summary.notifiableStudents,0);
  assert.equal(result.summary.notFriendStudents,1);
});

test("unbound, no-parent and inactive students are handled deterministically",()=>{
  const result=buildLabLineStudentCoverage({
    schoolId:"school-lab",students,
    parentLinks:[
      {studentId:"110003",parentEmail:"unbound@example.com",status:"active"},
      {studentId:"OLD001",parentEmail:"old@example.com",status:"active"}
    ]
  });
  assert.equal(result.items.find(item=>item.studentId==="110003").status,"UNBOUND");
  assert.equal(result.items.find(item=>item.studentId==="110004").status,"NO_PARENT");
  assert.equal(result.items.some(item=>item.studentId==="OLD001"),false);
  assert.equal(result.summary.noParentStudents,3);
});

test("admin read model masks parent identity and never exposes LINE target",()=>{
  const email="roy.parent@example.com";
  const result=buildLabLineStudentCoverage({
    schoolId:"school-lab",students:[students[0]],
    parentLinks:[{studentId:"110001",parentEmail:email,status:"active"}],
    bindingsByEmail:new Map([[email,{bound:true,friendStatus:"friend",lineUserId:"U1234567890SECRET",lineDisplayName:"Roy"}]])
  });
  const serialized=JSON.stringify(result);
  assert.equal(maskParentEmail(email),"r***@example.com");
  assert.match(parentCoverageKey("school-lab",email),/^[0-9a-f]{24}$/);
  assert.equal(serialized.includes(email),false);
  assert.equal(serialized.includes("U1234567890SECRET"),false);
  assert.equal(serialized.includes("parentKey"),false);
  assert.equal(result.items[0].parents[0].parentEmailMasked,"r***@example.com");
});
