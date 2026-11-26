import test from "node:test";
import assert from "node:assert/strict";
import {createHash,randomBytes,randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const stripped=path=>read(path).replace(/^import\s+[\s\S]*?;\r?\n/gm,"").replace(/^export /gm,"");
const plain=value=>JSON.parse(JSON.stringify(value));
const school="school-a",otherSchool="school-b",email="teacher@example.test",sub="verified-google-sub";
const bot="U"+"a".repeat(32),user="U"+"b".repeat(32),otherBot="U"+"c".repeat(32);
const linkedAt="2026-11-25T00:00:00.000Z",friendAt=Date.parse("2026-11-26T06:20:00Z");
const hash=value=>createHash("sha256").update(value).digest("hex");
const key={email:value=>"email-"+hash(value),google:value=>"google-"+hash(value),line:(b,u)=>"line-"+hash(b+":"+u),friend:(b,u)=>"friend-"+hash(b+":"+u)};
const missing=()=>Object.assign(Error("missing"),{statusCode:404});

function fixture(){
  const rows=new Map(),reads=[],network=[],writes=[],channelReads=[];
  const state={channel:{schoolId:school,configured:true,loginConfigured:true,acceptsLegacy:true,botUserId:bot,accessToken:"SECRET-ACCESS-TOKEN",loginSecret:"SECRET-LOGIN",appOrigin:"https://school-a.example.test"},role:"admin",failRead:"",channelError:false};
  const storedKey=(partition,row)=>partition+"|"+row;
  const seed=(partition,row,value)=>rows.set(storedKey(partition,row),{partitionKey:partition,rowKey:row,...value});
  const lookup=(partition,row)=>rows.get(storedKey(partition,row));
  const db={
    async getEntity(partition,row){reads.push({partition,row});if(state.failRead===row)throw Error("private storage exception token=SECRET");const value=lookup(partition,row);if(!value)throw missing();return {...value};},
    async *listEntities({queryOptions:{filter}}){
      reads.push({filter});if(state.failRead==="list")throw Error("private storage exception token=SECRET");
      const fields={PartitionKey:"partitionKey",RowKey:"rowKey"};
      const checks=[...filter.matchAll(/([a-zA-Z]+) eq '((?:''|[^'])*)'/g)].map(([,field,value])=>[fields[field]||field,value.replaceAll("''", "'")]);
      for(const value of rows.values())if(checks.every(([field,expected])=>value[field]===expected))yield {...value};
    },
    async createTable(){writes.push("createTable");throw Error("status lookup must not create tables");},
    async createEntity(){writes.push("create");throw Error("status lookup must not create rows");},
    async updateEntity(){writes.push("update");throw Error("status lookup must not update rows");},
    async submitTransaction(){writes.push("transaction");throw Error("status lookup must not mutate bindings");}
  };
  const common={createHash,randomBytes,randomUUID,URL,process:{env:{LAB_ENVIRONMENT:"production",STORAGE_CONNECTION_STRING:"isolated"}},
    tenantSchoolPartition:id=>id,defaultTenantId:()=>school,
    TableClient:{fromConnectionString:(_connection,name)=>{assert.equal(name,"TenantLineIdentity","admin status must not probe legacy tables");return db;}},
    lineApi:async(...args)=>{network.push(args);throw Error("admin read must not call the LINE API");},
    console:{warn(){},error(){}}};
  const accounts=runInNewContext(stripped("api/src/lib/tenantLineAccounts.js")+";({lineHash,getTenantLineAccount,getTenantGoogleLink,getTenantLineDeliveryRecipient,getTenantLineFriendship})",common);
  const resolveTenantLineChannel=async(id,options)=>{channelReads.push(id);assert.equal(options?.allowLegacyBotLookup,false);if(state.channelError)throw Error("private channel error token=SECRET");assert.equal(id,school);return state.channel;};
  const statuses=runInNewContext(stripped("api/src/lib/teacherLineBindingStatus.js")+";teacherLineBindingStatuses",{...common,...accounts,resolveTenantLineChannel});
  function bind({parent=email,linkedEmail=email,googleSub=sub,userId=user,botId=bot,partition=school}={}){
    const value={partitionKey:partition,botUserId:botId,lineUserId:userId,parentEmail:parent,googleSub,googleEmail:linkedEmail,displayName:"綁定的老師 <script>",linkedAt};
    seed(partition,key.google(googleSub),value);seed(partition,key.line(botId,userId),value);seed(partition,key.email(parent),value);
    return value;
  }
  function friend(value=true){seed(school,key.friend(bot,user),{botUserId:bot,friend:value,checkedAt:friendAt});}
  const get=async address=>(await statuses(school,[address||email])).get(String(address||email).trim().toLowerCase());
  function api(){
    const handlers={},queries=[],teacherRows=[{rowKey:email,teacherName:"老師甲",status:"active"}];
    const ctx={...common,...accounts,resolveTenantLineChannel,teacherLineBindingStatuses:statuses,
      app:{http:(name,route)=>handlers[name]=route.handler},json:(data,status=200)=>({data,status}),
      getTenantContext:async()=>({schoolId:school,access:{role:state.role,email:"admin@example.test"}}),
      listTeacherDirectory:async id=>{queries.push(["teachers",id]);return teacherRows;},
      listActivityRange:async(_type,id)=>{queries.push(["lessons",id]);return [];},listStudentMaster:async(_status,id)=>{queries.push(["students",id]);return [];},
      getTeacherProfile:async(_email,id)=>{queries.push(["profile",id]);return null;},isPrivateOnlyTeacher:()=>false,
      privateLessonFollowupResponse:async()=>({data:{followup:true},status:200}),
      saveTeacherDirectory:async()=>{writes.push("teacherDirectory");throw Error("GET cannot write teachers");},
      saveTeacherProfile:async()=>{writes.push("teacherProfile");throw Error("GET cannot write profiles");}};
    runInNewContext(stripped("api/src/functions/teacherDirectory.js"),ctx);
    const get=query=>handlers.teacherDirectory({method:"GET",query:new URLSearchParams(query||{schoolId:otherSchool})});
    return {get,queries,teacherRows};
  }
  return {state,rows,reads,network,writes,channelReads,accounts,statuses,seed,lookup,bind,friend,get,api};
}

test("admin status verifies current Gmail, LINE and canonical email indexes without exposing credentials",async()=>{
  const h=fixture();h.bind();h.friend();const result=await h.get();
  assert.equal(result.status,"paired");assert.equal(result.displayName,"綁定的老師 <script>");assert.equal(result.linkedAt,linkedAt);
  assert.equal(result.friendStatus,"friend");assert.equal(result.friendCheckedAt,new Date(friendAt).toISOString());assert.ok(Number.isFinite(Date.parse(result.checkedAt)));
  assert.deepEqual(Object.keys(result).sort(),["checkedAt","displayName","friendCheckedAt","friendStatus","linkedAt","status"].sort());
  assert.doesNotMatch(JSON.stringify(result),new RegExp([sub,user,bot,"SECRET","googleSub","lineUserId","accessToken","loginSecret"].join("|")));
  assert.deepEqual(h.writes,[]);assert.deepEqual(h.network,[]);assert.deepEqual(h.channelReads,[school]);
});

test("LINE-first canonical identity remains paired for the same current Gmail across roles",async()=>{
  const h=fixture(),native="line-00000000-0000-4000-8000-000000000001@line.invalid";h.bind({parent:native});
  assert.equal(h.lookup(school,key.email(email)),undefined,"fixture exercises missing Gmail email index");
  const result=await h.get();assert.equal(result.status,"paired");assert.equal(result.displayName,"綁定的老師 <script>");
  assert.equal(result.friendStatus,"unknown");assert.equal(result.friendCheckedAt,null);
  assert.deepEqual(h.writes,[]);assert.deepEqual(h.network,[]);
});

test("cached friendship is independent of the verified Gmail and LINE pairing",async t=>{
  for(const scenario of ["not_friend","unknown","unavailable"])await t.test(scenario,async()=>{
    const h=fixture();h.bind();
    if(scenario==="not_friend")h.friend(false);
    if(scenario==="unavailable")h.state.failRead=key.friend(bot,user);
    const result=await h.get();assert.equal(result.status,"paired");assert.equal(result.friendStatus,scenario);
    assert.equal(result.friendCheckedAt,scenario==="not_friend"?new Date(friendAt).toISOString():null);
    assert.deepEqual(h.network,[]);assert.deepEqual(h.writes,[]);
  });
});

test("missing, unpaired, stale and conflicting identities never display a verified teacher pairing",async t=>{
  const cases=[
    ["no binding",h=>{}],
    ["LINE without Gmail",h=>h.seed(school,key.email(email),{parentEmail:email,botUserId:bot,lineUserId:user,displayName:"unverified"})],
    ["missing Google index",h=>{h.bind();h.rows.delete(school+"|"+key.google(sub));}],
    ["Google unlink marker",h=>{h.bind();h.seed(school,key.google(sub),{googleSub:sub,googleEmail:email,parentEmail:email});}],
    ["missing LINE identity",h=>{h.bind();h.rows.delete(school+"|"+key.line(bot,user));}],
    ["wrong LINE Google sub",h=>{h.bind();h.seed(school,key.line(bot,user),{...h.lookup(school,key.line(bot,user)),googleSub:"different-sub"});}],
    ["wrong Gmail",h=>h.bind({linkedEmail:"other@example.test"})],
    ["wrong Google bot",h=>{h.bind();h.seed(school,key.google(sub),{...h.lookup(school,key.google(sub)),botUserId:otherBot});}],
    ["wrong canonical email index",h=>{const native="line-00000000-0000-4000-8000-000000000001@line.invalid";h.bind({parent:native});h.seed(school,key.email(native),{...h.lookup(school,key.email(native)),lineUserId:"U"+"d".repeat(32)});}],
    ["foreign school evidence",h=>h.bind({partition:otherSchool})],
    ["foreign scope on same partition",h=>{h.bind();h.seed(school,key.line(bot,user),{...h.lookup(school,key.line(bot,user)),schoolId:otherSchool});}],
    ["legacy delivery field",h=>{h.bind();h.seed(school,key.email(email),{...h.lookup(school,key.email(email)),deliveryOnly:true});}]
  ];
  for(const [name,mutate] of cases)await t.test(name,async()=>{
    const h=fixture();mutate(h);const result=await h.get();
    assert.ok(["unpaired","needs_confirmation"].includes(result.status),name+" must not claim paired");
    assert.equal(result.displayName,"");assert.equal(result.linkedAt,null);assert.equal(result.friendStatus,"unknown");assert.equal(result.friendCheckedAt,null);
    assert.deepEqual(h.writes,[]);assert.deepEqual(h.network,[]);
  });
});

test("channel and storage errors remain unknown instead of misreporting teachers as unbound",async t=>{
  for(const kind of ["channel","email","google","line","canonical"])await t.test(kind,async()=>{
    const h=fixture();h.bind();
    if(kind==="channel")h.state.channelError=true;
    else h.state.failRead=kind==="google"?key.google(sub):kind==="line"?key.line(bot,user):key.email(email);
    const result=await h.get();assert.equal(result.status,"unavailable");assert.equal(result.displayName,"");
    assert.doesNotMatch(JSON.stringify(result),/SECRET|private|token=/);assert.deepEqual(h.network,[]);assert.deepEqual(h.writes,[]);
  });
});

test("unconfigured school does not query or mutate teacher LINE accounts",async()=>{
  const h=fixture();h.bind();h.state.channel.loginConfigured=false;
  const result=await h.get();assert.equal(result.status,"not_configured");assert.equal(h.reads.length,0);
  assert.deepEqual(h.network,[]);assert.deepEqual(h.writes,[]);
});

test("one channel lookup serves a deduplicated normalized teacher list",async()=>{
  const h=fixture();h.bind();const map=await h.statuses(school,[email," TEACHER@EXAMPLE.TEST ","other@example.test"]);
  assert.equal(map.size,2);assert.equal(map.get(email).status,"paired");assert.equal(map.get("other@example.test").status,"unpaired");
  assert.deepEqual(h.channelReads,[school]);assert.deepEqual(h.network,[]);assert.deepEqual(h.writes,[]);
});

test("untrusted display timestamps cannot manufacture recent binding or friendship evidence",async()=>{
  const h=fixture();h.bind();h.friend();
  h.seed(school,key.line(bot,user),{...h.lookup(school,key.line(bot,user)),linkedAt:"invalid timestamp"});
  h.seed(school,key.friend(bot,user),{botUserId:bot,friend:true,checkedAt:"invalid timestamp"});
  const result=await h.get();assert.equal(result.status,"paired");assert.equal(result.linkedAt,null);
  assert.equal(result.friendStatus,"unknown");assert.equal(result.friendCheckedAt,null);
  assert.deepEqual(h.network,[]);assert.deepEqual(h.writes,[]);
});

test("the directory caps concurrent per-teacher lookups while resolving the school channel only once",async()=>{
  let active=0,maximum=0,channelReads=0;
  const helper=runInNewContext(stripped("api/src/lib/teacherLineBindingStatus.js")+";teacherLineBindingStatuses",{
    tenantSchoolPartition:id=>id,lineHash:hash,
    resolveTenantLineChannel:async(id,options)=>{assert.equal(id,school);assert.equal(options?.allowLegacyBotLookup,false);channelReads++;return {schoolId:school,loginConfigured:true,botUserId:bot,acceptsLegacy:true};},
    getTenantLineDeliveryRecipient:async(id,address,channel)=>{
      assert.equal(id,school);assert.equal(channel.acceptsLegacy,false);active++;maximum=Math.max(maximum,active);
      await new Promise(setImmediate);active--;return null;
    }
  });
  const emails=Array.from({length:23},(_,i)=>"teacher"+i+"@example.test"),result=await helper(school,emails);
  assert.equal(result.size,23);assert.equal(channelReads,1);assert.equal(active,0);
  assert.ok(maximum>1&&maximum<=8,"lookups should parallelize in bounded batches");
  assert.ok([...result.values()].every(value=>value.status==="unpaired"));
});

test("the admin-only teacher directory returns safe current-school pairing status without changing teaching settings",async()=>{
  const h=fixture();h.bind();h.friend();const api=h.api(),response=await api.get();
  assert.equal(response.status,200);assert.equal(response.headers["Cache-Control"],"no-store");assert.equal(response.data.items[0].lineBinding.status,"paired");
  assert.equal(response.data.items[0].email,email);assert.equal(response.data.items[0].status,"active");assert.equal(response.data.items[0].privateOnly,false);
  assert.ok(api.queries.every(([,id])=>id===school));assert.ok(h.channelReads.every(id=>id===school));
  assert.deepEqual(h.network,[]);assert.deepEqual(h.writes,[]);
  assert.doesNotMatch(JSON.stringify(response.data.items[0].lineBinding),/googleSub|lineUserId|accessToken|SECRET/);
});

test("non-admin roles cannot retrieve binding metadata or trigger lookup",async()=>{
  for(const role of ["parent","teacher","privateTeacher","school","unassigned"]){
    const h=fixture();h.bind();h.state.role=role;const api=h.api(),response=await api.get();
    assert.equal(response.status,403);assert.equal(api.queries.length,0);assert.equal(h.channelReads.length,0);assert.equal(h.reads.length,0);
    assert.deepEqual(h.writes,[]);assert.deepEqual(h.network,[]);
  }
});

test("private followup remains its existing readonly route without unnecessary binding lookup",async()=>{
  const h=fixture();h.bind();const api=h.api(),response=await api.get({view:"private-followup"});
  assert.deepEqual(plain(response.data),{followup:true});assert.equal(h.channelReads.length,0);assert.equal(h.reads.length,0);assert.equal(api.queries.length,0);
});

test("legacy channel resolution can stay entirely local while preserving the default bot-info verification",async()=>{
  const network=[],writes=[],reads=[];
  const mutation=async()=>{writes.push("write");throw Error("channel resolution cannot write");};
  const db={
    async getEntity(partition,row){reads.push({partition,row});throw missing();},
    createTable:mutation,createEntity:mutation,updateEntity:mutation,upsertEntity:mutation,deleteEntity:mutation,submitTransaction:mutation
  };
  const resolve=runInNewContext(stripped("api/src/lib/lineTenantConfig.js")+";resolveTenantLineChannel",{
    createHash,URL,tenantSchoolPartition:id=>id,defaultTenantId:()=>school,
    getTenantDirectory:async id=>{assert.equal(id,school);return {schoolId:school,status:"active"};},
    process:{env:{STORAGE_CONNECTION_STRING:"isolated",LINE_CHANNEL_SECRET:"SECRET-LEGACY",LINE_CHANNEL_ACCESS_TOKEN:"SECRET-TOKEN",LINE_APP_ORIGIN:"https://school-a.example.test"}},
    TableClient:{fromConnectionString:(_connection,name)=>{assert.equal(name,"TenantLineChannelConfig");return db;}},
    lineApi:async(path,options)=>{network.push({path,options});return {userId:bot};}
  });
  const local=await resolve(school,{allowLegacyBotLookup:false});
  assert.equal(local.legacy,true);assert.equal(local.configured,true);assert.equal(local.botUserId,"");assert.equal(local.loginConfigured,false);
  assert.deepEqual(network,[]);assert.deepEqual(writes,[]);
  const verified=await resolve(school);
  assert.equal(verified.botUserId,bot);assert.equal(verified.acceptsLegacy,true);
  assert.equal(network.length,1);assert.equal(network[0].path,"/v2/bot/info");assert.equal(network[0].options.method,"GET");assert.equal(network[0].options.accessToken,"SECRET-TOKEN");
  assert.deepEqual(writes,[]);assert.deepEqual(reads,[{partition:"line",row:"school-"+school},{partition:"line",row:"school-"+school}]);
});
