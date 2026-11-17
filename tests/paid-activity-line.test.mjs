import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const source=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const run=(path,globals,expression="")=>runInNewContext(
  source(path).replace(/^import .*;$/gm,"").replace(/^export /gm,"")+"\n"+expression,globals
);
const now=Date.parse("2026-11-17T09:00:00Z"), stamp=new Date(now).toISOString();
const dinner={module:"yearEndDinner",id:"d1",title:"期末聚餐",enabled:true,paymentOpen:true,feeStatus:"PUBLISHED",firstAdultFee:800,targetGroups:"C"};
const trip={module:"fieldTrip",id:"trip",title:"校際交流",enabled:true,studentFee:200,targetGroups:"A"};
const collection={...trip,collectionOpen:true,paymentOpen:true,feeStatus:"PUBLISHED",closeAt:"2026-11-17T08:00:00Z"};
const studentA={studentId:"1",groupName:"A 團"},studentB={studentId:"2",groupName:"B"},studentC={studentId:"3",groupName:"儲備團"};
const user="U"+"a".repeat(32),bot="U"+"b".repeat(32);
function fixture(){
  const calls=[],registrations=[];
  const scope={
    console,process:{env:{LAB_ENVIRONMENT:"functional-uat"}},URL,createHash,
    workflowLineEnabled:()=>true,workflowLineRetryKey:(...values)=>values.join("/"),
    resolveTenantLineChannel:async school=>{assert.equal(school,"school-a");return {loginConfigured:true,botUserId:bot,accessToken:"test",appOrigin:"https://school.test"}},
    lineAudienceStudents:async()=>[studentA,studentB,studentC],
    resolveLineAudience:async(school,botId,{roles,groups,students})=>{
      assert.equal(school,"school-a");assert.equal(botId,bot);assert.equal(roles.join(),"parent");assert.equal(groups.length,0);
      calls.push(["students",Array.from(students,student=>student.studentId)]);
      return {targets:[user],unbound:1};
    },
    TableClient:{fromConnectionString:(_,name)=>({async *listEntities({queryOptions}){
      assert.equal(name,"TenantFamilyEventRegistration");
      assert.equal(queryOptions.filter,"PartitionKey eq 'school-a'");
      for(const entry of registrations)yield {payload:JSON.stringify(entry)};
    }})},
    getTenantLineRecipient:async (school,email,botId)=>{
      assert.equal(school,"school-a");assert.equal(botId,bot);calls.push(["recipient",email]);return {lineUserId:user};
    },
    lineApi:async(path,options)=>calls.push([path,options])
  };
  const {paidActivityNotificationKind,notifyPaidActivityOpened}=run("api/src/lib/paidActivityLine.js",scope,"({paidActivityNotificationKind,notifyPaidActivityOpened})");
  return {calls,registrations,paidActivityNotificationKind,notifyPaidActivityOpened};
}

test("paid activities notify when opened or when second-stage payment opens",()=>{
  const {paidActivityNotificationKind:kind}=fixture();
  assert.equal(kind({...dinner,enabled:false},dinner,now),"registration");
  assert.equal(kind(dinner,{...dinner,title:"修正活動名稱"},now),null);
  assert.equal(kind(null,{...dinner,module:"calendarActivity"},now),null);
  assert.equal(kind(null,{...dinner,firstAdultFee:0},now),null);
  assert.equal(kind(null,{...dinner,paymentOpen:false},now),null);
  assert.equal(kind(null,trip,now),"registration");
  assert.equal(kind(trip,collection,now),"payment");
  assert.equal(kind(collection,collection,now),null);
});

test("activity announcement targets only the configured group and provides the school's sign-in link",async()=>{
  const {calls,notifyPaidActivityOpened:notify}=fixture();
  assert.equal((await notify("school-a",dinner,stamp,"registration")).accepted,1);
  assert.deepEqual(calls[0],["students",["3"]]);
  const [path,{body}]=calls[1];
  assert.equal(path,"/v2/bot/message/multicast");
  assert.deepEqual(Array.from(body.to),[user]);
  const message=body.messages[0].text;
  assert.match(message,/期末聚餐[\s\S]+繳|期末聚餐[\s\S]+匯款/);
  const link=new URL(message.split("\n").at(-1));
  assert.equal(link.searchParams.get("schoolId"),"school-a");
  assert.equal(link.searchParams.get("paidActivity"),"yearEndDinner:d1");
});

test("second-stage collection only notifies unpaid families registered for this trip",async()=>{
  const {calls,registrations,notifyPaidActivityOpened:notify}=fixture();
  const unpaid={kind:"fieldTrip",activityId:"trip",registrationStatus:"REGISTERED",paymentStatus:"NOT_OPEN",parentEmail:"parent@example.test"};
  registrations.push(unpaid,{...unpaid,paymentStatus:"VERIFIED",parentEmail:"paid@example.test"},
    {...unpaid,activityId:"other",parentEmail:"other@example.test"},
    {...unpaid,registrationStatus:"CANCELLED",parentEmail:"cancelled@example.test"});
  await notify("school-a",collection,stamp,"payment");
  assert.deepEqual(calls[0],["recipient","parent@example.test"]);
  assert.equal(calls.length,2);
  assert.match(calls[1][1].body.messages[0].text,/已開放已報名家庭繳款/);
});

test("paid activity link resumes only for an authorized parent of the intended school",async()=>{
  const text=source("app/app-v3.js");
  const storage=new Map(),redirects=[];
  const context={state:{},URLSearchParams,sessionStorage:{
    setItem:(key,value)=>storage.set(key,value),getItem:key=>storage.get(key),removeItem:key=>storage.delete(key)
  },location:{search:"?schoolId=school-a&paidActivity=yearEndDinner%3Ad1",replace:url=>redirects.push(url)}};
  const rules=runInNewContext(text.slice(text.indexOf("const paidActivityEntryKey"),text.indexOf("async function boot()"))+
    "\n({paidActivityEntry,choosePaidActivityContext,openPaidActivity})",context);
  const entry=rules.paidActivityEntry();
  rules.choosePaidActivityContext(entry);
  assert.equal(storage.get("role_context"),"parent");
  context.location.search="?line_session=school-a";
  assert.equal(rules.paidActivityEntry().activity,entry.activity);
  assert.equal(rules.openPaidActivity(entry,{role:"admin",schoolId:"school-a"}),false);
  assert.equal(rules.openPaidActivity(entry,{role:"parent",schoolId:"school-b"}),false);
  assert.equal(rules.openPaidActivity(entry,{role:"parent",schoolId:"school-a"}),true);
  assert.equal(redirects[0],"/parent-uniform-events.html?view=events&activity=yearEndDinner%3Ad1");
});
