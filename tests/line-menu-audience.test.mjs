import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const source=readFileSync(new URL("../api/src/lib/tenantLineMenu.js",import.meta.url),"utf8");
const userId="U"+"1".repeat(32),email="member@example.test",parentEmail="line-alias@example.test";
const parentMenuId="richmenu-"+"2".repeat(32),staffMenuId="richmenu-"+"3".repeat(32);
const resource="/v2/bot/user/"+userId+"/richmenu";
function fixture(){
 const account={lineUserId:userId,googleEmail:email,parentEmail},calls=[],reads=[],discoveries=[];
 const roster={roles:[],teacher:null,students:[],error:null,mappingError:null};
 const templates={parentAreas:4,staffAreas:6,parentDiscovery:parentMenuId,staffDiscovery:staffMenuId};
 let assignedMenuId="";
 const {refreshTenantLineMenu}=runInNewContext(source.replace(/^import\s+[\s\S]*?;\r?\n/gm,"").replace(/^export /gm,"")+";({refreshTenantLineMenu})",{
  process:{env:{}},defaultTenantId:()=>"sacred-heart",
  listTenantRolesByEmail:async(...args)=>{reads.push(["roles",...args]);if(roster.error)throw roster.error;return roster.roles},
  getTeacherDirectory:async(...args)=>{reads.push(["teacher",...args]);if(roster.error)throw roster.error;return roster.teacher},
  getMappedStudentsByEmail:async(...args)=>{reads.push(["students",...args]);if(roster.mappingError)throw roster.mappingError;return roster.students},
  discoverTenantLineRoleMenu:async(channel,audience)=>{discoveries.push({schoolId:channel.schoolId,audience});return audience==="staff"?templates.staffDiscovery:audience==="parent"?templates.parentDiscovery:""},
  lineApi:async(path,options)=>{
   calls.push({path,...options});
   if(path.startsWith("/v2/bot/richmenu/"))return {areas:Array.from({length:path.endsWith(parentMenuId)?templates.parentAreas:templates.staffAreas},()=>({}))};
   if(options.method==="GET")return {richMenuId:assignedMenuId};
   assignedMenuId=options.method==="DELETE"?"":path.split("/").at(-1);return {};
  },
 });
 const channel={configured:true,schoolId:"school-a",accessToken:"school-a-token",parentMenuId,staffMenuId};
 return {account,channel,roster,templates,calls,reads,discoveries,writes:()=>calls.filter(call=>call.method!=="GET"),sync:(candidate=account,options={})=>refreshTenantLineMenu(channel,candidate,userId,options)};
}

test("unbound or unapproved LINE users clear their personal menu and retain the platform's default three-button menu",async()=>{
 for(const candidate of [null,{lineUserId:userId},{lineUserId:userId,parentEmail:"unapproved@example.test"}]){
  const h=fixture();assert.equal(await h.sync(candidate),"default");
  assert.deepEqual(h.calls,[{path:resource,accessToken:"school-a-token",method:"DELETE"}]);
  assert.equal(h.discoveries.length,0);
 }
 const linked=fixture();assert.equal(await linked.sync(),"default");
 assert.deepEqual(linked.reads,[["roles",email,"active"],["teacher",email,"school-a"],["students",parentEmail,"school-a"]]);
 assert.equal(linked.calls[0].method,"DELETE");assert.equal(linked.discoveries.length,0);
});

test("an approved same-school parent mapping selects and verifies the four-button parent menu without creating access",async()=>{
 const h=fixture();h.roster.students=[{studentId:"student-a"}];
 const accountBefore=JSON.stringify(h.account),rosterBefore=JSON.stringify(h.roster);
 const result=await h.sync(h.account,{verify:true});assert.equal(result.audience,"parent");assert.equal(result.areaCount,4);
 assert.equal(h.calls.some(call=>call.path===resource+"/"+parentMenuId&&call.method===undefined),true);
 assert.deepEqual(h.reads,[["roles",email,"active"],["teacher",email,"school-a"],["students",parentEmail,"school-a"]]);
 assert.equal(JSON.stringify(h.account),accountBefore);assert.equal(JSON.stringify(h.roster),rosterBefore);
 const lineOnly=fixture();lineOnly.roster.students=[{studentId:"student-a"}];
 assert.equal(await lineOnly.sync({lineUserId:userId,parentEmail}),"parent");
 assert.deepEqual(lineOnly.reads,[["students",parentEmail,"school-a"]]);
});

test("the current school's Global assignments and active teacher roster automatically select staff six-buttons without parent approval",async()=>{
 for(const roster of [
  {roles:[{role:"schoolAdmin",schoolId:"school-a"}],teacher:null},
  {roles:[],teacher:{status:"active",schoolId:"school-a"}},
  {roles:[],teacher:{status:"active",schoolId:"school-a",privateOnly:true}},
 ]){
  const h=fixture();Object.assign(h.roster,roster);h.roster.mappingError=Error("Staff must not require parent mappings");
  const result=await h.sync(h.account,{verify:true});assert.equal(result.audience,"staff");assert.equal(result.areaCount,6);
  assert.equal(h.calls.some(call=>call.path===resource+"/"+staffMenuId&&call.method===undefined),true);
  assert.equal(h.reads.some(read=>read[0]==="students"),false);
  assert.deepEqual(Object.keys(h.account).sort(),["googleEmail","lineUserId","parentEmail"]);
 }
});

test("another school's staff grant, inactive teacher, or school observer stays default unless parent mapping is separately approved",async()=>{
 for(const roster of [
  {roles:[{role:"schoolAdmin",schoolId:"school-b"}],teacher:null},
  {roles:[{role:"school",schoolId:"school-a"}],teacher:null},
  {roles:[],teacher:{status:"inactive",schoolId:"school-a"}},
  {roles:[],teacher:{status:"active",schoolId:"school-b"}},
 ]){
  const h=fixture();Object.assign(h.roster,roster);assert.equal(await h.sync(),"default");assert.equal(h.calls[0].method,"DELETE");
  h.roster.students=[{studentId:"student-a"}];assert.equal(await h.sync(),"parent");assert.equal(h.calls.at(-1).path.endsWith(parentMenuId),true);
 }
});

test("revoked staff downgrade to an approved parent's four-buttons or otherwise return to the default three-buttons",async()=>{
 for(const source of ["admin","teacher"])for(const approved of [false,true]){
  const h=fixture();if(source==="admin")h.roster.roles=[{role:"schoolAdmin",schoolId:"school-a"}];else h.roster.teacher={status:"active",schoolId:"school-a"};
  if(approved)h.roster.students=[{studentId:"student-a"}];
  assert.equal(await h.sync(),"staff");h.roster.roles=[];h.roster.teacher={status:"inactive",schoolId:"school-a"};
  assert.equal(await h.sync(),approved?"parent":"default");
  assert.equal(h.writes()[0].path,resource+"/"+staffMenuId);
  if(approved)assert.equal(h.writes().at(-1).path,resource+"/"+parentMenuId);
  else assert.deepEqual(h.writes().at(-1),{path:resource,accessToken:"school-a-token",method:"DELETE"});
  const writes=h.calls.length;await assert.rejects(h.sync(h.account,{expectStaff:true}),/未判定為此校管理員或教師/);assert.equal(h.calls.length,writes);
 }
});

test("roster or parent-mapping read failures leave the existing menu untouched instead of assuming a default audience",async()=>{
 for(const failed of ["error","mappingError"]){
  const h=fixture();h.roster[failed]=Error("roster unavailable");await assert.rejects(h.sync(),/roster unavailable/);assert.equal(h.calls.length,0);
 }
});

test("template discovery is reserved for an approved parent or verified staff and never assigns the default visitor a role",async()=>{
 for(const audience of ["parent","staff"]){
  const h=fixture();h.channel.parentMenuId="";h.channel.staffMenuId="";
  if(audience==="staff")h.roster.roles=[{role:"schoolAdmin",schoolId:"school-a"}];else h.roster.students=[{studentId:"student-a"}];
  assert.equal(await h.sync(),audience);assert.deepEqual(h.discoveries,[{schoolId:"school-a",audience}]);
 }
 const visitor=fixture();visitor.channel.parentMenuId="";visitor.channel.staffMenuId="";
 assert.equal(await visitor.sync(null),"default");assert.equal(visitor.discoveries.length,0);assert.equal(visitor.calls[0].method,"DELETE");
});

test("configured or discovered role templates with the wrong button count are never assigned, even outside manual verification",async()=>{
 for(const audience of ["parent","staff"])for(const discovered of [false,true])for(const verify of [false,true]){
  const h=fixture();
  if(audience==="staff"){h.roster.roles=[{role:"schoolAdmin",schoolId:"school-a"}];h.templates.staffAreas=4;if(discovered)h.channel.staffMenuId="";}
  else{h.roster.students=[{studentId:"student-a"}];h.templates.parentAreas=6;if(discovered)h.channel.parentMenuId="";}
  await assert.rejects(h.sync(h.account,{verify}),/選單|版型|宮格/);
  assert.equal(h.calls.some(call=>call.path.startsWith("/v2/bot/richmenu/")&&call.method==="GET"),true);
  assert.equal(h.writes().some(call=>call.method!=="DELETE"),false);
 }
});

test("an approved parent without an available four-button template clears stale personal menus and reports unavailable",async()=>{
 for(const verify of [false,true]){
  const h=fixture();h.roster.roles=[{role:"schoolAdmin",schoolId:"school-a"}];assert.equal(await h.sync(),"staff");
  h.roster.roles=[];h.roster.students=[{studentId:"student-a"}];h.channel.parentMenuId="";h.templates.parentDiscovery="";
  const before=h.writes().length;
  if(verify)await assert.rejects(h.sync(h.account,{verify:true}),/家長|四宮格|版型/);
  else assert.equal(await h.sync(),"unavailable");
  assert.equal(h.writes().length,before+1);assert.deepEqual(h.writes().at(-1),{path:resource,accessToken:"school-a-token",method:"DELETE"});
  assert.deepEqual(h.discoveries,[{schoolId:"school-a",audience:"parent"}]);
 }
});
