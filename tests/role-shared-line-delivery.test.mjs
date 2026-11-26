import test from "node:test";
import assert from "node:assert/strict";
import {createHash,createHmac,randomBytes,randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {validateParentLessonReview} from "../api/src/lib/privateLessonReview.mjs";
import {buildPrivateLessonNoticeCard,buildPrivateReviewResponseCard} from "../api/src/lib/privateLessonLineCards.mjs";

const source=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8")
  .replace(/^import\s+[\s\S]*?;\r?\n/gm,"").replace(/^export /gm,"");
const plain=value=>JSON.parse(JSON.stringify(value));
const missing=()=>Object.assign(Error("missing"),{statusCode:404});
const school="sacred-heart",bot="U"+"a".repeat(32),user="U"+"b".repeat(32),child="112068";
const google={email:"same-parent@example.test",sub:"verified-google-sub",displayName:"同一位家長"};
const hash=value=>createHash("sha256").update(value).digest("hex");
const key={email:email=>"email-"+hash(email),google:sub=>"google-"+hash(sub),line:(botId,userId)=>"line-"+hash(botId+":"+userId)};

async function fixture(){
  const data=new Map(),writes=[],pushes=[],network=[],mappings=new Map();
  const storageKey=(table,partition,row)=>[table,partition,row].join("|");
  function client(table){return {
    async createTable(){},
    async getEntity(partition,row){const found=data.get(storageKey(table,partition,row));if(!found)throw missing();return {...found};},
    async createEntity(row){const id=storageKey(table,row.partitionKey,row.rowKey);if(data.has(id))throw Object.assign(Error("exists"),{statusCode:409});data.set(id,{...row,etag:"v1"});writes.push([table,"create",row.rowKey]);},
    async updateEntity(row,mode){const id=storageKey(table,row.partitionKey,row.rowKey),old=data.get(id);if(!old)throw missing();data.set(id,{...(mode==="Replace"?{}:old),...row,etag:"v2"});writes.push([table,"update",row.rowKey]);},
    async deleteEntity(partition,row){data.delete(storageKey(table,partition,row));writes.push([table,"delete",row]);},
    async submitTransaction(actions){for(const [operation,row,mode] of actions){
      if(operation==="create")await this.createEntity(row);
      else if(operation==="update"||operation==="upsert")await this.updateEntity(row,mode);
      else if(operation==="delete")await this.deleteEntity(row.partitionKey,row.rowKey);
      else throw Error("Unexpected transaction "+operation);
    }},
    async *listEntities({queryOptions={}}={}){
      const filter=queryOptions.filter||"",partition=filter.match(/PartitionKey eq '((?:[^']|'')*)'/)?.[1]?.replaceAll("''", "'"),email=filter.match(/googleEmail eq '((?:[^']|'')*)'/)?.[1]?.replaceAll("''", "'");
      for(const [id,row] of data){if(!id.startsWith(table+"|"))continue;if(partition&&row.partitionKey!==partition)continue;if(email&&row.googleEmail!==email)continue;yield {...row};}
    }
  }}
  const channel={schoolId:school,configured:true,loginConfigured:true,acceptsLegacy:true,botUserId:bot,channelSecret:"test-channel-secret",accessToken:"isolated-token",appOrigin:"https://school.example.test"};
  const master={partitionKey:school,rowKey:child,studentName:"正式學生",schoolId:school,status:"active"};
  const lesson={partitionKey:school+"|student|"+child,rowKey:"individual-lesson",schoolId:school,studentId:child,eventDate:"2026-11-24",startTime:"20:50",endTime:"21:50",minutes:60,
    teacher:"teacher@example.test",teacherName:"正式老師",completedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),status:"teacher_completed",parentConfirmation:"pending"};
  const common={createHash,createHmac,randomBytes,randomUUID,URL,URLSearchParams,
    process:{env:{STORAGE_CONNECTION_STRING:"isolated",LAB_ENVIRONMENT:"production"}},
    TableClient:{fromConnectionString:(_connection,name)=>client(name)},table:name=>client(name),
    defaultTenantId:()=>school,tenantSchoolPartition:id=>id,tenantParentPartition:(id,email)=>id+":"+email,tenantStudentPartition:(id,student)=>id+"|student|"+student,
    getMappedStudentsByEmail:async(email,id)=>id===school?(mappings.get(email)||[]):[],getRegistrationsByEmail:async()=>[],
    getStudentMaster:async(student,id)=>id===school&&student===child?{...master}:null,
    getStudentAliasInfo:async(student,id)=>({canonicalStudentId:student,aliases:id===school?[student]:[]}),
    ensureTenantTables:async()=>{},resolveTenantLineChannel:async()=>channel,
    lineApi:async(path)=>{network.push(path);throw Error("Modern shared binding must not read legacy bot/profile endpoints");},
    workflowLineEnabled:()=>true,workflowLineRetryKey:(...parts)=>hash(JSON.stringify(parts)),
    pushLineMessage:async(id,message,options)=>{pushes.push({id,message:plain(message),options:plain(options)});return {accepted:true};},
    validateParentLessonReview,buildPrivateLessonNoticeCard,buildPrivateReviewResponseCard,
    console:{warn(){},error(){}}
  };
  const accounts=runInNewContext(source("api/src/lib/tenantLineAccounts.js")+";({getOrCreateTenantLineAccount,linkTenantGoogle,getTenantGoogleLink,getTenantLineAccount,getTenantLineRecipient,getTenantLineDeliveryRecipient,getTenantLineFriendship,unlinkTenantGoogle})",common);
  const unpaired=await accounts.getOrCreateTenantLineAccount(school,bot,user,"已綁 LINE 的家長");
  mappings.set(unpaired.parentEmail,[{studentId:child}]);
  const linked=await accounts.linkTenantGoogle(school,unpaired,google);
  mappings.set(google.email,[{studentId:child}]);
  const mapRow={partitionKey:school+":"+google.email,rowKey:child,schoolId:school,parentEmail:google.email,studentId:child,status:"active",registrationId:"approved-registration"};
  data.set(storageKey("tenantUserStudentMap",mapRow.partitionKey,child),mapRow);
  data.set(storageKey("tenantRegistrations",school,"approved-registration"),{partitionKey:school,rowKey:"approved-registration",schoolId:school,parentEmail:google.email,studentId:child,status:"approved"});
  data.set(storageKey("tenantPrivateLesson",lesson.partitionKey,lesson.rowKey),lesson);
  const proof=runInNewContext(source("api/src/lib/parentLineApprovalNotice.js")+";({getApprovedParentStudent})",{...common,...accounts});
  const audience=runInNewContext(source("api/src/lib/lineAudience.js")+";({resolveLineAudience})",{...common,...accounts,...proof,
    listUserStudentMappings:async(status,id)=>id===school&&status==="active"?[{...mapRow}]:[],normalizeProfile:()=>({})});
  let reviewDelivery;
  const line=runInNewContext(source("api/src/lib/linePrivateLesson.js")+";({notifyPrivateLessonLine,receivePrivateLessonReview})",{...common,...accounts,
    getTenantLineDeliveryRecipient:(...args)=>reviewDelivery?reviewDelivery(...args):accounts.getTenantLineDeliveryRecipient(...args)});
  const handlers={};
  let role="admin";
  runInNewContext(source("api/src/functions/tenantLineLogin.js"),{...common,...accounts,
    app:{http:(name,options)=>handlers[name]=options.handler},
    getTenantContext:async()=>({schoolId:school,access:{role,email:google.email,authProvider:"google"}}),json:(jsonBody,status=200)=>({status,jsonBody}),
    verifyGoogle:async()=>google,readTenantLineLinkConfirmation:async()=>null,restoreLabGoogleLineLink:async(_id,_channel,_google,existing)=>existing,
  });
  async function ownAccount(nextRole){role=nextRole;return handlers.tenantLineAccount({method:"GET",headers:new Headers({origin:channel.appOrigin})});}
  const deliver=()=>accounts.getTenantLineDeliveryRecipient(school,google.email,channel);
  const setRow=(table,partition,row,value)=>data.set(storageKey(table,partition,row),{partitionKey:partition,rowKey:row,...value});
  const getRow=(table,partition,row)=>data.get(storageKey(table,partition,row));
  const notify=()=>line.notifyPrivateLessonLine(school,{recipients:[google.email],entity:lesson,eventType:"completed",notice:{schoolName:"測試學校",studentName:"正式學生",teacherName:"正式老師"},format:()=>"完課確認"});
  return {accounts,linked,channel,lesson,data,writes,pushes,network,mappings,proof,audience,line,deliver,notify,ownAccount,setRow,getRow,storageKey,mapRow,
    overrideReviewDelivery:resolver=>{reviewDelivery=resolver}};
}

test("one verified Gmail/LINE binding serves admin and parent delivery without creating another login index",async()=>{
  const h=await fixture();
  assert.match(h.linked.parentEmail,/@line\.invalid$/);assert.notEqual(h.linked.parentEmail,google.email);
  assert.equal(await h.accounts.getTenantLineRecipient(school,google.email,bot),null,"the strict authentication/index lookup stays unchanged");
  for(const role of ["admin","parent"]){const own=await h.ownAccount(role);assert.equal(own.status,200);assert.equal(own.jsonBody.bound,true);assert.equal(own.jsonBody.googleLinked,true);}
  const before=h.writes.length,recipient=await h.deliver();
  assert.equal(recipient.lineUserId,user);assert.equal(recipient.botUserId,bot);assert.equal(recipient.parentEmail,h.linked.parentEmail);assert.equal(recipient.verifiedGoogleEmail,google.email);
  assert.equal(h.writes.length,before,"delivery lookup must remain read-only");assert.deepEqual(h.network,[]);
  assert.equal(await h.accounts.getTenantLineRecipient(school,google.email,bot),null,"no shadow Gmail email index is written");
  assert.equal(await h.notify(),"accepted");assert.equal(h.pushes.length,1);assert.equal(h.pushes[0].id,user);
  assert.equal(h.pushes[0].message.type,"flex");assert.ok(h.pushes[0].options.quickReply);
});

test("an approved current Gmail candidate can use the verified bridge but current approval is still required",async()=>{
  const h=await fixture(),result=await h.audience.resolveLineAudience(school,bot,{roles:["parent"],groups:[],students:[{rowKey:child,groupName:"A"}]});
  assert.deepEqual([...result.targets],[user]);
  const revoked={...h.getRow("tenantRegistrations",school,"approved-registration"),status:"revoked"};h.setRow("tenantRegistrations",school,"approved-registration",revoked);
  const denied=await h.audience.resolveLineAudience(school,bot,{roles:["parent"],groups:[],students:[{rowKey:child,groupName:"A"}]});
  assert.equal(denied.targets.length,0);assert.equal(denied.contacts.length,0);
});

test("an approved historical email alias cannot forge verified Google delivery metadata",async()=>{
  const h=await fixture(),alias="historical-parent@example.test";
  Object.assign(h.mapRow,{parentEmail:alias,partitionKey:school+":"+alias,registrationId:"alias-registration"});
  h.setRow("tenantUserStudentMap",h.mapRow.partitionKey,child,h.mapRow);
  h.setRow("tenantRegistrations",school,"alias-registration",{schoolId:school,parentEmail:alias,studentId:child,status:"approved"});
  h.setRow("TenantLineIdentity",school,key.email(alias),{...h.linked,lookupEmail:alias,verifiedGoogleEmail:alias});
  const candidate=await h.accounts.getTenantLineDeliveryRecipient(school,alias,h.channel);
  assert.equal(candidate.lineUserId,user);assert.equal(candidate.verifiedGoogleEmail,undefined,"a stored marker is not trusted by the read-only delivery proof");
  const denied=await h.audience.resolveLineAudience(school,bot,{roles:["parent"],groups:[],students:[{rowKey:child,groupName:"A"}]});
  assert.equal(denied.targets.length,0);assert.equal(denied.contacts.length,0,"neither LINE nor Email fallback receives the stale alias");
});

test("the same signed LINE user can submit a review through the verified current Gmail bridge",async()=>{
  const h=await fixture();assert.equal(await h.notify(),"accepted");
  const reviews=[...h.data.entries()].filter(([key])=>key.startsWith("TenantLineLessonReview|"));assert.equal(reviews.length,1);
  const code=reviews[0][1].rowKey;
  const reply=await h.line.receivePrivateLessonReview(h.channel,user,"#個課評鑑 "+code+" 5 老師說明清楚，孩子知道練習方向");
  assert.match(reply,/完成|確認|收到/);
  const stored=h.getRow("tenantPrivateLesson",h.lesson.partitionKey,h.lesson.rowKey);assert.equal(stored.parentConfirmation,"confirmed");assert.equal(stored.teacherRating,5);
});

test("a review code cannot survive unlink, another LINE user, or delivery-only legacy compatibility",async t=>{
  for(const kind of ["unlink","wrong-user","delivery-only"])await t.test(kind,async()=>{
    const h=await fixture();assert.equal(await h.notify(),"accepted");
    const code=[...h.data.entries()].find(([key])=>key.startsWith("TenantLineLessonReview|"))[1].rowKey;
    if(kind==="unlink")await h.accounts.unlinkTenantGoogle(school,google.sub);
    if(kind==="delivery-only")h.overrideReviewDelivery(async()=>({...h.linked,deliveryOnly:true}));
    const before=h.writes.length,actor=kind==="wrong-user"?"U"+"e".repeat(32):user;
    const reply=await h.line.receivePrivateLessonReview(h.channel,actor,"#個課評鑑 "+code+" 5 老師說明清楚，孩子知道練習方向");
    assert.match(reply,/失效/);assert.equal(h.writes.length,before);
    assert.equal(h.getRow("tenantPrivateLesson",h.lesson.partitionKey,h.lesson.rowKey).parentConfirmation,"pending");
  });
});

test("explicit unlink markers and conflicting identity evidence block the bridge and never revive older delivery",async t=>{
  const cases=[
    ["Google unlink",async h=>h.accounts.unlinkTenantGoogle(school,google.sub)],
    ["Gmail email marker",async h=>h.setRow("TenantLineIdentity",school,key.email(google.email),{googleSub:google.sub,googleEmail:google.email,parentEmail:h.linked.parentEmail})],
    ["wrong bot",async h=>{h.channel.botUserId="U"+"c".repeat(32)}],
    ["foreign school channel",async h=>{h.channel.schoolId="other-school"}],
    ["LINE identity mismatch",async h=>{const row=h.getRow("TenantLineIdentity",school,key.line(bot,user));h.setRow("TenantLineIdentity",school,row.rowKey,{...row,googleSub:"another-google-sub"})}],
    ["canonical index mismatch",async h=>{const row=h.getRow("TenantLineIdentity",school,key.email(h.linked.parentEmail));h.setRow("TenantLineIdentity",school,row.rowKey,{...row,lineUserId:"U"+"d".repeat(32)})}],
    ["ambiguous Google indexes",async h=>h.setRow("TenantLineIdentity",school,key.google("other-sub"),{...h.linked,googleSub:"other-sub",googleEmail:google.email,lineUserId:"U"+"d".repeat(32)})],
    ["additional unlink marker",async h=>h.setRow("TenantLineIdentity",school,key.google("old-sub"),{googleSub:"old-sub",googleEmail:google.email,parentEmail:h.linked.parentEmail})]
  ];
  for(const [name,mutate] of cases)await t.test(name,async()=>{
    const h=await fixture();await mutate(h);const before=h.writes.length;assert.equal(await h.deliver(),null);assert.equal(h.writes.length,before);assert.deepEqual(h.network,[]);assert.equal(h.pushes.length,0);
  });
});
