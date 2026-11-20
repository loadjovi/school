import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const source=readFileSync(new URL("../api/src/functions/me.js",import.meta.url),"utf8").replace(/^import .*;\n/gm,"");
const child={studentId:"student1",name:"孩子甲",grade:"四年級",groupName:"A",instrument:"中提琴",section:"中提",schoolYear:"115",semester:"1",studentIdAliases:["student1","old-id"]};
function harness({authProvider="line",role="parent",schoolId="school-a",authenticated=true}={}){
 let handler,accessReads=0;
 const access={authenticated,authProvider,role,schoolId,sub:"verified-sub",email:"parent@example.invalid",contactEmail:"parent@example.invalid",students:[child]};
 runInNewContext(source,{
  app:{http:(_,entry)=>{handler=entry.handler}},json:(data,status=200)=>({data,status}),
  getAccess:async()=>{accessReads++;return access},tenantFeeEnabled:()=>false,
  saveUserIdentity:async()=>{},listTenantRolesByEmail:async()=>[],parseJsonEnv:()=>({}),defaultTenantId:()=>"sacred-heart",listTenantDirectory:async()=>[],
  resolveTenantLineChannel:async()=>({loginConfigured:true}),recordTeacherLogin:async()=>({created:false}),console
 });
 return {get:query=>handler({query:new URLSearchParams(query),headers:{get:()=>""}}),get accessReads(){return accessReads}};
}

test("Google and LINE login can reuse complete child profiles from the same authorized access check",async()=>{
 for(const authProvider of ["google","line"]){
  const h=harness({authProvider}),response=await h.get("includeStudentProfiles=1&schoolId=other-school&studentId=unrelated-child");
  assert.equal(response.status,200);assert.equal(h.accessReads,1);
  assert.deepEqual(response.data.studentProfiles,[child]);
  assert.equal(response.data.studentProfiles[0].grade,"四年級");assert.deepEqual(response.data.studentProfiles[0].studentIdAliases,["student1","old-id"]);
 }
});

test("the optional login payload does not expose child profiles to non-parent roles or schoolless access",async()=>{
 for(const role of ["teacher","privateTeacher","admin","globalAdmin"]){
  const response=await harness({role}).get("includeStudentProfiles=1");assert.equal(response.data.studentProfiles,undefined);
 }
 assert.equal((await harness({schoolId:""}).get("includeStudentProfiles=1")).data.studentProfiles,undefined);
 assert.equal((await harness({authenticated:false}).get("includeStudentProfiles=1")).status,401);
 assert.equal((await harness().get("")).data.studentProfiles,undefined);
});
