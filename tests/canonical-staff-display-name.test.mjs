import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {teacherCourseAccess} from "../api/src/lib/teacherAccountType.js";

const source=readFileSync(new URL("../api/src/lib/auth.js",import.meta.url),"utf8")
  .replace(/^import\s+[\s\S]*?;\r?\n/gm,"").replace(/^export /gm,"");
const email="staff@example.test",sub="verified-google-sub";
const role=(schoolId="school-a")=>({role:"schoolAdmin",schoolId,status:"active"});

function fixture({provider="google",roles=[role()],directory,lookupError=false,verifiedLink=true}={}){
  const reads=[],warnings=[];
  const rows=new Map(directory||[["school-a",{status:"active",teacherName:"陳宣文"}],["school-b",{status:"active",teacherName:"另一校名冊姓名"}]]);
  const account={googleSub:sub,googleEmail:email,parentEmail:"family@example.test",lineUserId:"line-user",botUserId:"school-a-bot",displayName:"LINE 原始名稱"};
  const payload={sub,email,email_verified:true,name:"Google 原始名稱",picture:"https://picture.example.test/avatar"};
  const context={createHash,teacherCourseAccess,console:{warn:(...args)=>warnings.push(args),error(){}},
    process:{env:{GOOGLE_CLIENT_ID:"expected-audience"}},
    OAuth2Client:class{async verifyIdToken({idToken,audience}){assert.equal(idToken,"verified-token");assert.equal(audience,"expected-audience");return {getPayload:()=>payload}}},
    tenantIdValue:value=>String(value||"").trim().toLowerCase(),defaultTenantId:()=>"school-a",
    ensureDefaultTenant:async()=>({rowKey:"school-a",schoolName:"甲校",status:"active"}),ensureBootstrapGlobalAdmin:async()=>{},
    listTenantRolesByEmail:async(value,status)=>{assert.equal(value,email);assert.equal(status,"active");return roles},
    getTenantDirectory:async school=>["school-a","school-b"].includes(school)?{rowKey:school,status:"active",schoolName:school==="school-a"?"甲校":"乙校"}:null,
    getTeacherDirectory:async(value,school)=>{reads.push({email:value,school});assert.equal(value,email);if(lookupError)throw Error("directory unavailable");return rows.get(school)||null},
    getTeacherProfile:async()=>({ensembleGroups:JSON.stringify(["A"])}),listStudentMaster:async()=>[],listUserStudentMappings:async()=>[],activeTeacherSupport:async()=>null,
    getMappedStudentsByEmail:async()=>[{studentId:"student-a",name:"學生"}],
    financeAssigned:async(school,value)=>{assert.ok(["school-a","school-b"].includes(school));assert.equal(value,email);return true},
    tenantLineSession:async()=>({schoolId:"school-a",account}),
    resolveTenantLineChannel:async()=>({loginConfigured:true,botUserId:"school-a-bot"}),
    getTenantGoogleLink:async(school,id)=>{assert.equal(id,sub);return provider==="line"?(verifiedLink?{...account}:null):null},
    tenantLineParentStudents:async()=>[{studentId:"student-a",name:"學生"}]
  };
  const api=runInNewContext(source+";({getAccess})",context);
  const request=(school="school-a",selectedRole="schoolAdmin")=>({headers:new Headers({
    ...(school?{"X-School-Id":school}:{}),...(selectedRole?{"X-Role-Context":selectedRole}:{}),
    ...(provider==="google"?{"X-Google-ID-Token":"verified-token"}:{})
  })});
  return {reads,warnings,rows,payload,account,check:(school="school-a",selectedRole="schoolAdmin",includeContexts=false)=>api.getAccess(request(school,selectedRole),{includeContexts})};
}

test("Google school administrators use their selected school's teacher name without changing their identity or privileges",async()=>{
  for(const global of [false,true]){
    const roles=[role(),role("school-b"),...(global?[{role:"globalAdmin",schoolId:"*",status:"active"}]:[])],h=fixture({roles});
    for(const [school,expected] of [["school-a","陳宣文"],["school-b","另一校名冊姓名"]]){
      const access=await h.check(school);
      assert.equal(access.displayName,expected);assert.equal(access.schoolId,school);assert.equal(access.role,"admin");
      assert.equal(access.email,email);assert.equal(access.sub,sub);assert.equal(access.picture,h.payload.picture);
      assert.equal(access.capabilities.admin,true);assert.equal(access.capabilities.financeVerifier,true);
      assert.equal(access.capabilities.ensemble,undefined);assert.equal(access.capabilities.teacherSettings,undefined);
      assert.equal(access.capabilities.identityGlobalAdmin,global?true:undefined);
    }
    assert.deepEqual(h.reads,[{email,school:"school-a"},{email,school:"school-b"}]);
  }
});

test("default Google admin and explicit teacher contexts use the same active local directory name",async()=>{
  const h=fixture({directory:[["school-a",{status:"active",teacherName:"  陳宣文  "}]]});
  const admin=await h.check("",""),teacher=await h.check("school-a","teacher");
  assert.equal(admin.displayName,"陳宣文");assert.equal(admin.role,"admin");
  assert.equal(teacher.displayName,"陳宣文");assert.equal(teacher.role,"ensembleTeacher");assert.equal(teacher.capabilities.ensemble,true);
  assert.equal(teacher.capabilities.financeVerifier,undefined);assert.equal(teacher.email,email);
});

test("Google global and parent contexts keep the provider name instead of borrowing a school's staff name",async()=>{
  const h=fixture({roles:[role(),{role:"globalAdmin",schoolId:"*",status:"active"}]});
  const global=await h.check("","global");assert.equal(global.role,"globalAdmin");assert.equal(global.displayName,"Google 原始名稱");assert.equal(h.reads.length,0);
  const parent=await h.check("school-a","parent");assert.equal(parent.role,"parent");assert.equal(parent.displayName,"Google 原始名稱");
  assert.equal(parent.capabilities.financeVerifier,undefined);assert.equal(parent.email,email);
});

test("missing, inactive, or blank local directory names fall back without taking another school's name",async()=>{
  for(const local of [null,{status:"inactive",teacherName:"停用老師"},{status:"active",teacherName:"   "}]){
    const h=fixture({directory:[["school-a",local],["school-b",{status:"active",teacherName:"外校同帳號姓名"}]]});
    const access=await h.check();assert.equal(access.displayName,"Google 原始名稱");assert.equal(access.role,"admin");
    assert.deepEqual(h.reads,[{email,school:"school-a"}]);
  }
});

test("a failed name-only lookup cannot deny otherwise authorized Google or LINE administrators",async()=>{
  for(const provider of ["google","line"]){
    const h=fixture({provider,lookupError:true}),access=await h.check();
    assert.equal(access.role,"admin");assert.equal(access.email,email);assert.equal(access.capabilities.financeVerifier,true);
    assert.equal(access.displayName,provider==="google"?"Google 原始名稱":"LINE 原始名稱");assert.equal(h.warnings.length,1);
  }
});

test("verified LINE admin operations resolve the current school roster name even without optional teacher contexts",async()=>{
  for(const includeContexts of [false,true]){
    const h=fixture({provider:"line"}),access=await h.check("school-a","schoolAdmin",includeContexts);
    assert.equal(access.authProvider,"line");assert.equal(access.displayName,"陳宣文");assert.equal(access.role,"admin");
    assert.equal(access.email,email);assert.equal(access.contactEmail,email);assert.equal(access.capabilities.financeVerifier,true);
    assert.equal(access.capabilities.ensemble,undefined);assert.equal(access.activeContextKey,"schoolAdmin:school-a");
    assert.equal(h.reads.length,1,"optional teacher context must reuse the same directory read");assert.deepEqual(h.reads[0],{email,school:"school-a"});
  }
});

test("LINE teacher context uses the same name while its parent context retains the LINE display name",async()=>{
  const h=fixture({provider:"line"});
  const teacher=await h.check("school-a","teacher",true),parent=await h.check("school-a","parent",true);
  assert.equal(teacher.displayName,"陳宣文");assert.equal(teacher.role,"ensembleTeacher");assert.equal(teacher.capabilities.ensemble,true);
  assert.equal(parent.displayName,"LINE 原始名稱");assert.equal(parent.role,"parent");assert.equal(parent.capabilities.admin,undefined);
});

test("unverified LINE Gmail claims and cross-school requests cannot use the school directory name or acquire admin access",async()=>{
  const h=fixture({provider:"line",verifiedLink:false});
  const denied=await h.check();assert.equal(denied.role,"contextDenied");assert.equal(denied.displayName,"LINE 原始名稱");assert.equal(h.reads.length,0);
  const crossSchool=await h.check("school-b");assert.equal(crossSchool.role,"contextDenied");assert.equal(h.reads.length,0);
});

test("valid repeated characters are kept exactly as entered in the same school's teacher directory",async()=>{
  const h=fixture({directory:[["school-a",{status:"active",teacherName:"林文文"}]]});
  assert.equal((await h.check()).displayName,"林文文");
});
