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
  const logic=run("api/src/lib/paidActivityLine.js",scope,"({isPaidActivityOpen,collectingTrip,notifyPaidActivityOpened})");
  const schedule=run("api/src/lib/paidActivitySchedule.js",{...logic},"({paidActivitySchedule,dispatchPaidActivityNotices})");
  return {calls,registrations,...logic,...schedule};
}

test("paid activity schedule follows the opening time, including staged collection",()=>{
  const {paidActivitySchedule:schedule}=fixture();
  const nextOpening=new Date(now+60000).toISOString();
  const futureDinner={...dinner,openAt:nextOpening};
  const make=(beforeRow,previous,next)=>schedule({updatedAt:stamp},beforeRow,previous,next,now);
  const scheduled=make(null,null,futureDinner);
  const scheduledNotices=JSON.parse(scheduled.paidLineNotices);
  assert.equal(scheduled.paidLineDueAt,nextOpening);
  assert.equal(scheduledNotices.registration.state,"queued");
  assert.equal(make(scheduled,futureDinner,{...futureDinner,title:"更新名稱"}).paidLineNotices,scheduled.paidLineNotices);
  const delayed={...futureDinner,openAt:new Date(now+120000).toISOString()};
  assert.equal(make(scheduled,futureDinner,delayed).paidLineDueAt,delayed.openAt);
  assert.equal(make(scheduled,futureDinner,{...futureDinner,enabled:false}).paidLineDueAt,"");
  assert.equal(make(null,null,{...dinner,module:"calendarActivity"}).paidLineDueAt,"");
  assert.equal(make(null,null,{...dinner,firstAdultFee:0}).paidLineDueAt,"");
  assert.equal(make(null,null,{...dinner,paymentOpen:false}).paidLineDueAt,"");
  assert.equal(make(null,null,trip).paidLineDueAt,stamp);
  assert.equal(JSON.parse(make(null,trip,collection).paidLineNotices).payment.state,"queued");
  const futureTrip={...trip,openAt:nextOpening};
  const futureCollection={...collection,openAt:nextOpening,closeAt:new Date(now+180000).toISOString()};
  const both=make(null,futureTrip,futureCollection);
  assert.equal(JSON.parse(both.paidLineNotices).payment.at,nextOpening);
});

test("provider is never called before either kind of notification opens",async()=>{
  const {calls,notifyPaidActivityOpened:notify}=fixture();
  const openAt=new Date(Date.now()+60000).toISOString();
  assert.equal((await notify("school-a",{...dinner,openAt},stamp,"registration")).status,"scheduled");
  assert.equal((await notify("school-a",{...collection,openAt},stamp,"payment")).status,"scheduled");
  assert.equal(calls.length,0);
});

test("due notice dispatch claims an activity once and only inside the opened window",async()=>{
  const {paidActivitySchedule:schedule,dispatchPaidActivityNotices:dispatch,calls}=fixture();
  const now=Date.now(), openAt=new Date(now+1000).toISOString();
  const activity={...dinner,openAt}, data={partitionKey:"school-a",rowKey:"yearEndDinner:d1",
    updatedAt:new Date(now).toISOString(),payload:JSON.stringify(activity)};
  let row={...schedule(data,null,null,activity,now),etag:"1"};
  const table={
    async getEntity(){return {...row}},
    async updateEntity(next,mode,{etag}){
      if(etag!==row.etag)throw Object.assign(new Error("changed"),{statusCode:412});
      row={...next,etag:String(Number(etag)+1)};
    }
  };
  const snapshot={...row};
  await dispatch(table,snapshot,now);
  assert.equal(calls.length,0);
  // Use an opening already reached for the live-time check inside dispatch.
  const opened={...activity,openAt:new Date(now-1000).toISOString()};
  row={...schedule({...data,payload:JSON.stringify(opened)},null,null,opened,now),etag:"2"};
  await Promise.all([dispatch(table,{...row},now),dispatch(table,{...row},now)]);
  assert.equal(calls.filter(([path])=>path.startsWith("/v2/")).length,1);
  assert.equal(row.paidLineDueAt,"");
  const saved=JSON.parse(row.paidLineNotices).registration;
  assert.equal(saved.result.accepted,1);assert.equal(saved.result.failed,0);assert.equal(saved.result.unbound,1);
  assert.equal(saved.result.deliveryMode,"push");assert.ok(Number.isFinite(Date.parse(saved.lastAttemptAt)));
});

test("activity announcement targets only the configured group and provides the school's sign-in link",async()=>{
  const {calls,notifyPaidActivityOpened:notify}=fixture();
  assert.equal((await notify("school-a",dinner,stamp,"registration")).accepted,1);
  assert.deepEqual(calls[0],["students",["3"]]);
  const [path,{body}]=calls[1];
  assert.equal(path,"/v2/bot/message/push");
  assert.equal(body.to,user);
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

test("parents can read all fee rates before choosing attendance or opening the form",()=>{
  const file=source("app/parent-uniform-events.js");
  const rates=runInNewContext(file.slice(file.indexOf("const activityCurrency="),file.indexOf("function activityPaymentLabel"))+
    "\n({appendActivityRates})",{element:(tag,text)=>node(tag,text)});
  function node(tag,text){return {tag,text,children:[],append(...children){this.children.push(...children)}}}
  const card=node("article");
  rates.appendActivityRates(card,{...dinner,extraAdultFee:1000,extraChildFee:400});
  const fees=card.children[0];
  assert.equal(fees.children[0].text,"活動費用");
  assert.deepEqual(fees.children[1].children.map(child=>child.text),
    ["弦樂團學生","免收費","首位陪同者","NT$ 800／位","第二位起陪同者","NT$ 1,000／位","6 歲以下兒童（非團員）","NT$ 400／位"]);
  const preview=node("article");
  rates.appendActivityRates(preview,{...trip,firstAdultFee:100,extraAdultFee:80,extraChildFee:0,feeStatus:"DRAFT"});
  assert.equal(preview.children[0].children[0].text,"活動費用（預估）");
  assert.match(file,/appendActivityRates\(card,item\);[\s\S]+我要報名此活動/);
});
