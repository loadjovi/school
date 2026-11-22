import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {randomUUID,createHash} from "node:crypto";
import * as rules from "../api/src/lib/paymentResolutionRules.mjs";
import {familyPaymentInfo,uniformNeedsPayment} from "../api/src/lib/paymentNoticeRules.mjs";
import {financeRecipients} from "../api/src/lib/financeNoticeRules.mjs";
import {updateStaffDemand} from "../api/src/lib/tshirtStaffDemandRules.mjs";
import {buildTshirtProcurementPlan,TSHIRT_PLAN_SIZES} from "../app/tshirt-procurement-plan.mjs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const strip=s=>s.replace(/^import .*;\n/gm,"").replace(/^export /gm,"");
const uid="11111111-1111-4111-a111-111111111111",owner="parent@example.test",school="school-a";
const uniform={kind:"regularUniform",status:"APPROVED",acquisition:"PURCHASE",amount:400,studentId:"990101",parentEmail:owner,size:"S",quantity:1,paymentStatus:"REPORTED_UNVERIFIED",transferReport:{amount:400,lastFive:"12345",transferDate:"2026-11-21",reportedAt:"2026-11-21T10:00:00Z"}};
const parent={role:"parent",email:owner,students:["990101"]},finance={role:"admin",email:"finance@example.test",capabilities:{financeVerifier:true}};
const evidence={receivedAmount:300,bankPostedAt:"2026-11-21",note:"銀行查核已收 300",reason:"應繳 400，銀行實收 300"};
function harness(){
 const stores=new Map(),notices=[],pushes=[];let version=0,conflict=false,auditFails=false,enabled=true,line=true;
 const db=name=>{if(!stores.has(name))stores.set(name,new Map());const rows=stores.get(name);return {
  createTable:async()=>{},getEntity:async(p,r)=>{const row=rows.get(p+"|"+r);if(!row)throw Object.assign(Error("missing"),{statusCode:404});return structuredClone(row)},
  createEntity:async row=>{if(name==="TenantUniformEventAudit"&&auditFails)throw Error("audit index unavailable");if(rows.has(row.partitionKey+"|"+row.rowKey))throw Object.assign(Error("exists"),{statusCode:409});rows.set(row.partitionKey+"|"+row.rowKey,{...structuredClone(row),etag:"v"+(++version)})},
  upsertEntity:async row=>{rows.set(row.partitionKey+"|"+row.rowKey,{...structuredClone(row),etag:"v"+(++version)})},
  updateEntity:async(row,mode,options)=>{const key=row.partitionKey+"|"+row.rowKey,old=rows.get(key);if(conflict||options?.etag!==old?.etag)throw Object.assign(Error("conflict"),{statusCode:412});rows.set(key,{...structuredClone(row),etag:"v"+(++version)})},
  listEntities:async function*(options){const partition=options.queryOptions.filter.match(/PartitionKey eq '([^']+)'/)[1];for(const row of rows.values())if(row.partitionKey===partition)yield structuredClone(row)}
 }};
 const tableNames={uniform:"TenantUniformEventRequest",family:"TenantFamilyEventRegistration",staff:"TenantTshirtStaffDemand"};
 const api=runInNewContext(strip(read("api/src/lib/paymentResolution.js"))+";({applyPaymentResolution,listPaymentResolutions,receivePaymentRefundRequest})",{
  ...rules,safeAllocateTshirtAvailableStock:async()=>({status:"procurement_required"}),paymentResolutionEnabled:()=>enabled,createHash,randomUUID,URL,process:{env:{STORAGE_CONNECTION_STRING:"test-storage"}},TableClient:{fromConnectionString:(_c,name)=>db(name)},
  ensureStudentAccess:(access,id)=>access.role==="admin"||access.students?.includes(String(id)),getStudentAliasInfo:async id=>({canonicalStudentId:id}),getStudentMaster:async id=>({studentName:"學生 "+id}),
  getMappedStudentsByEmail:async email=>email===owner?[{studentId:"990101"}]:[],familyPaymentInfo,financeRecipients,
  listTenantAdmins:async()=>[{role:"schoolAdmin",status:"active",email:finance.email},{role:"schoolAdmin",status:"active",email:"ordinary@example.test"}],financeAssignments:async()=>[{email:finance.email,status:"active"}],
  labNoticeUrl:s=>"https://lab.example.test/?schoolId="+s,resolveTenantLineChannel:async s=>({schoolId:s,loginConfigured:true,botUserId:"bot-"+s,accessToken:"test-token"}),
  getTenantLineRecipient:async(s,email,bot)=>line&&email===owner?{lineUserId:"U"+"a".repeat(32)}:null,pushLineMessage:async(user,text,options)=>{pushes.push({user,text,options})},
  deliverLabNotice:async notice=>{notices.push(notice);if(notice.lineSender)await notice.lineSender(notice.recipients[0]);return {status:"sent",channel:"line",lineAcceptedCount:notice.recipients.length,mailAcceptedCount:0}},labNoticeLineResult:r=>({status:r.status==="sent"?"accepted":r.status}),
 });
 const put=async(type,item,id=uid,s=school)=>db(tableNames[type]).upsertEntity({partitionKey:s,rowKey:id,payload:JSON.stringify(item),updatedAt:"2026-11-21T10:00:00Z"});
 const current=async(type="uniform",id=uid,s=school)=>{const r=await db(tableNames[type]).getEntity(s,id);return {...JSON.parse(r.payload),id:r.rowKey,etag:r.etag}};
 const apply=async(action,values={},access=finance,type="uniform",id=uid,s=school)=>{const row=await current(type,id,s);return api.applyPaymentResolution(s,access,{sourceType:type,id,action,requestId:randomUUID(),etag:row.etag,revision:row.paymentResolution?.revision,...values})};
 return {...api,put,current,apply,notices,pushes,stores,setConflict:x=>{conflict=x},setAuditFails:x=>{auditFails=x},setEnabled:x=>{enabled=x},setBound:x=>{line=x}};
}
test("a discrepancy uses confirmed bank receipts, freezes the expected amount and keeps the original report",async()=>{
 const h=harness();await h.put("uniform",uniform);const {note,...messageOnly}=evidence;await h.apply("REQUEST_ADJUSTMENT",messageOnly);const item=await h.current();
 assert.equal(item.paymentStatus,"ADJUSTMENT_REQUIRED");assert.equal(item.paymentResolution.balance,100);assert.equal(item.transferReport.amount,400);assert.equal(item.paymentResolution.receivedAmount,300);assert.equal(item.status,"APPROVED");assert.equal(uniformNeedsPayment(item),false);
 assert.match(h.pushes[0].text,/學生 990101[\s\S]*待補差額：NT\$ 100/);assert.equal(h.pushes[0].options.quickReply.items[0].action.label,"申請退費並取消");assert.deepEqual([...h.notices[0].recipients],[owner]);
 assert.equal(item.paymentResolution.note,messageOnly.reason);assert.equal(item.paymentResolutionEvents[0].note,messageOnly.reason);assert.ok(h.pushes[0].text.includes(messageOnly.reason));
});
test("reporting a supplement never verifies payment; only finance confirming the cumulative total restores the workflow",async()=>{
 const h=harness();await h.put("uniform",uniform);await h.apply("REQUEST_ADJUSTMENT",evidence);
 await h.apply("REPORT_SUPPLEMENT",{amount:100,lastFive:"55555",transferDate:"2026-11-21"},parent);let item=await h.current();
 assert.equal(await h.notices[0].stillDue(),false);assert.equal(await h.notices.at(-1).stillDue(),true);
 assert.equal(item.paymentStatus,"SUPPLEMENT_REPORTED");assert.equal(item.paymentResolution.receivedAmount,300);assert.deepEqual([...h.notices.at(-1).recipients],[finance.email]);
 await assert.rejects(()=>h.apply("VERIFY_ADJUSTMENT",{receivedAmount:100,bankPostedAt:"2026-11-21",note:"只填單筆"}),/累計實收/);
 await h.apply("VERIFY_ADJUSTMENT",{receivedAmount:400,bankPostedAt:"2026-11-21",note:"兩筆銀行明細已核對"});item=await h.current();assert.equal(item.paymentStatus,"VERIFIED");assert.equal(item.paymentResolution.balance,0);assert.equal(item.paymentResolutionEvents.length,3);assert.equal(item.transferReport.lastFive,"12345");
});
test("another partial bank receipt creates a new remaining balance without erasing earlier supplement reports",async()=>{
 const h=harness();await h.put("uniform",uniform);await h.apply("REQUEST_ADJUSTMENT",evidence);await h.apply("REPORT_SUPPLEMENT",{amount:100,lastFive:"55555",transferDate:"2026-11-21"},parent);
 await h.apply("REQUEST_ADJUSTMENT",{...evidence,receivedAmount:350,reason:"第二筆實收 50，尚差 50"});assert.equal((await h.current()).paymentResolution.balance,50);
 await h.apply("REPORT_SUPPLEMENT",{amount:50,lastFive:"66666",transferDate:"2026-11-22"},parent);
 const reports=(await h.current()).paymentResolutionEvents.filter(x=>x.action==="REPORT_SUPPLEMENT");assert.deepEqual(reports.map(x=>x.supplement.amount),[100,50]);
});
test("only assigned finance can request adjustments, and only the original payer can reply",async()=>{
 const h=harness();await h.put("uniform",uniform);
 for(const actor of [parent,{role:"admin",email:"ordinary@example.test",capabilities:{}}])await assert.rejects(()=>h.apply("REQUEST_ADJUSTMENT",evidence,actor),e=>e.status===403);
 await h.apply("REQUEST_ADJUSTMENT",evidence);
 await assert.rejects(()=>h.apply("REQUEST_REFUND",{reason:"退費"},{...parent,email:"other-parent@example.test"}),e=>e.status===403);
 await h.apply("REQUEST_REFUND",{reason:"無法接受差額"},{...parent,email:"bound-gmail@example.test",parentAlias:owner});assert.equal((await h.current()).paymentStatus,"REFUND_REQUESTED");
});
test("invalid amounts, dates, notes and incorrect supplement values never mutate the source",async()=>{
 const h=harness();await h.put("uniform",uniform);
 for(const values of [{receivedAmount:-1},{receivedAmount:1.1},{receivedAmount:400},{bankPostedAt:"2026-02-31"},{reason:""}])await assert.rejects(()=>h.apply("REQUEST_ADJUSTMENT",{...evidence,...values}));
 assert.equal((await h.current()).paymentStatus,"REPORTED_UNVERIFIED");assert.equal(h.notices.length,0);
 await h.apply("REQUEST_ADJUSTMENT",evidence);await assert.rejects(()=>h.apply("REPORT_SUPPLEMENT",{amount:400,lastFive:"55555",transferDate:"2026-11-21"},parent),/待補差額/);
});
test("refund requests pause the application; recording an executed full refund is required before cancellation",async()=>{
 const h=harness();await h.put("uniform",uniform);await h.apply("REQUEST_ADJUSTMENT",evidence);await h.apply("REQUEST_REFUND",{reason:"不再購買"},parent);
 assert.equal((await h.current()).status,"APPROVED");
 const refund={receivedAmount:300,refundAmount:300,refundDate:"2026-11-22",note:"已查核退款",reference:"TEST-REFUND-1",refundExecuted:true};
 await assert.rejects(()=>h.apply("COMPLETE_REFUND",refund),/退款帳戶/);
 await h.apply("UPDATE_REFUND_ACCOUNT",{bankCode:"807",accountNumber:"123456789012",accountHolder:"測試家長"},parent);
 await assert.rejects(()=>h.apply("COMPLETE_REFUND",{...refund,refundExecuted:false}),/先完成銀行退款/);
 await assert.rejects(()=>h.apply("COMPLETE_REFUND",{...refund,refundAmount:299}),/正確退款金額/);
 await h.apply("COMPLETE_REFUND",refund);const item=await h.current();assert.equal(item.status,"CANCELLED");assert.equal(item.paymentStatus,"REFUNDED");assert.equal(item.paymentResolution.refund.amount,300);assert.equal(item.paymentResolutionEvents.length,4);
 await assert.rejects(()=>h.apply("REQUEST_ADJUSTMENT",evidence),/結案或作廢/);
});
test("refund accounting includes later supplements and cannot be recorded twice on a retried request",async()=>{
 const h=harness();await h.put("uniform",uniform);await h.apply("REQUEST_ADJUSTMENT",evidence);await h.apply("REPORT_SUPPLEMENT",{amount:100,lastFive:"55555",transferDate:"2026-11-21"},parent);await h.apply("REQUEST_REFUND",{reason:"取消",bankCode:"807",accountNumber:"123456789012",accountHolder:"測試家長"},parent);
 const old=await h.current(),input={sourceType:"uniform",id:uid,requestId:randomUUID(),revision:old.paymentResolution.revision,action:"COMPLETE_REFUND",receivedAmount:400,refundAmount:400,refundDate:"2026-11-22",note:"含補款共退款 400",reference:"TEST-REFUND-2",refundExecuted:true};
 await h.applyPaymentResolution(school,finance,input);const count=h.notices.length,history=(await h.current()).paymentResolutionEvents.length;
 const again=await h.applyPaymentResolution(school,finance,input);assert.equal(again.alreadyApplied,true);assert.equal(h.notices.length,count);assert.equal((await h.current()).paymentResolutionEvents.length,history);assert.equal((await h.current()).paymentResolution.refund.amount,400);
});
test("family activities and staff T-shirts use the same hold and refund rules",async()=>{
 for(const type of ["family","staff"]){const h=harness(),family={...uniform,kind:"fieldTrip",activityId:"trip",registrationStatus:"REGISTERED",studentIds:["990101"],transferReport:{...uniform.transferReport,expectedAmount:400}},staff={...uniform,category:"CADRE_EXTRA",paymentStatus:"AWAITING_TRANSFER"};await h.put(type,type==="family"?family:staff);await h.apply("REQUEST_ADJUSTMENT",evidence,finance,type);let item=await h.current(type);assert.equal(item.paymentStatus,"ADJUSTMENT_REQUIRED");
  if(type==="staff")assert.throws(()=>updateStaffDemand(item,{action:"VERIFY_DEMAND_PAYMENT"},{finance:true,actor:finance.email,at:"now"}),/差額流程/);
  await h.apply("REQUEST_REFUND",{reason:"取消",bankCode:"807",accountNumber:"123456789012",accountHolder:"測試家長"},parent,type);await h.apply("COMPLETE_REFUND",{receivedAmount:300,refundAmount:300,refundDate:"2026-11-22",reference:"TEST",note:"已退款",refundExecuted:true},finance,type);item=await h.current(type);assert.equal(type==="family"?item.registrationStatus:item.status,"CANCELLED");
 }
});
test("overpayments cannot be cleared by entering a lower received total; excess must be refunded explicitly",async()=>{
 const h=harness();await h.put("uniform",uniform);await h.apply("REQUEST_ADJUSTMENT",{...evidence,receivedAmount:500});
 await assert.rejects(()=>h.apply("VERIFY_ADJUSTMENT",{receivedAmount:400,bankPostedAt:"2026-11-21",note:"忽略溢繳"}),/溢繳/);
 await assert.rejects(()=>h.apply("REFUND_EXCESS",{receivedAmount:500,refundAmount:50,refundDate:"2026-11-22",reference:"TEST",note:"少退",refundExecuted:true}),/正確退款金額/);
 await h.apply("REFUND_EXCESS",{receivedAmount:500,refundAmount:100,refundDate:"2026-11-22",reference:"TEST",note:"已退溢繳",refundExecuted:true});assert.equal((await h.current()).paymentStatus,"VERIFIED");assert.equal((await h.current()).status,"APPROVED");
});
test("school boundaries, owner filtering and the named LAB feature gate are enforced",async()=>{
 const h=harness();await h.put("uniform",uniform);await h.apply("REQUEST_ADJUSTMENT",evidence);
 await assert.rejects(()=>h.applyPaymentResolution("school-b",finance,{sourceType:"uniform",id:uid,requestId:randomUUID(),action:"REQUEST_ADJUSTMENT"}),e=>e.status===404);
 assert.equal((await h.listPaymentResolutions(school,{...parent,email:"other@example.test"})).length,0);assert.equal((await h.listPaymentResolutions(school,parent)).length,1);
 await assert.rejects(()=>h.listPaymentResolutions(school,{role:"admin",email:"ordinary@example.test"}),e=>e.status===403);h.setEnabled(false);await assert.rejects(()=>h.listPaymentResolutions(school,finance),e=>e.status===404);
});
test("stale revisions and concurrent writes do not overwrite another decision or send notices",async()=>{
 const h=harness();await h.put("uniform",uniform);await h.apply("REQUEST_ADJUSTMENT",evidence);const count=h.notices.length;
 await assert.rejects(()=>h.apply("REQUEST_REFUND",{reason:"取消",revision:"stale"},parent),e=>e.status===409);h.setConflict(true);await assert.rejects(()=>h.apply("REQUEST_REFUND",{reason:"取消"},parent),e=>e.status===409);assert.equal(h.notices.length,count);assert.equal((await h.current()).paymentStatus,"ADJUSTMENT_REQUIRED");
});
test("the atomic source keeps an audit trail even when the auxiliary audit index is unavailable",async()=>{
 const h=harness();await h.put("uniform",uniform);h.setAuditFails(true);const result=await h.apply("REQUEST_ADJUSTMENT",evidence);assert.equal(result.auditSaved,false);assert.equal((await h.current()).paymentResolutionEvents[0].reason,evidence.reason);
});
test("LINE refund quick replies verify user, school bot, current binding and owner before queuing one finance task",async()=>{
 const h=harness();await h.put("uniform",uniform);await h.apply("REQUEST_ADJUSTMENT",evidence);const command=h.pushes[0].options.quickReply.items[0].action.text,channel={schoolId:school,botUserId:"bot-"+school},user="U"+"a".repeat(32);
 assert.match(await h.receivePaymentRefundRequest(channel,"U"+"b".repeat(32),command),/失效/);assert.match(await h.receivePaymentRefundRequest({...channel,botUserId:"another-bot"},user,command),/失效/);assert.match(await h.receivePaymentRefundRequest(channel,"",command),/一對一/);
 assert.equal((await h.current()).paymentStatus,"ADJUSTMENT_REQUIRED");assert.match(await h.receivePaymentRefundRequest(channel,user,command),/已收到退費申請/);assert.equal((await h.current()).paymentStatus,"REFUND_REQUESTED");assert.deepEqual([...h.notices.at(-1).recipients],[finance.email]);
 const count=h.notices.length;await h.receivePaymentRefundRequest(channel,user,command);assert.equal(h.notices.length,count);h.setBound(false);assert.match(await h.receivePaymentRefundRequest(channel,user,command),/綁定已變更/);
});
test("original verification, amount changes and staff procurement cannot bypass an active resolution",()=>{
 for(const path of ["api/src/functions/uniformTransferReport.js","api/src/functions/familyEventRegistration.js","api/src/functions/uniformEventRequests.js"])assert.match(read(path),/paymentOnHold\((?:old|before)\)/);
 const staff={category:"CADRE_EXTRA",status:"APPROVED",amount:400,paymentStatus:"REFUND_REQUESTED",paymentResolution:{expectedAmount:400}};assert.throws(()=>updateStaffDemand(staff,{action:"UPDATE_DEMAND_STATUS",status:"ORDERED",note:"採購"},{finance:true,actor:"admin",at:"now"}),/尚未結案/);
 const model=runInNewContext(read("app/uniform-payment-state.js")+";window.uniformPaymentState",{window:{}});const held={...uniform,paymentStatus:"ADJUSTMENT_REQUIRED",paymentResolution:{balance:100}};assert.equal(model.due(held),false);assert.equal(model.alerts([held]).held.length,1);assert.match(model.stage(held).title,/流程暫停/);
 assert.equal(model.held({...held,canResolvePayment:false}),false);assert.equal(model.alerts([{...held,canResolvePayment:false}]).due.length,0);
});
test("refunded applications remain in history but no longer inflate the receivable total",()=>{
 const source=read("api/src/functions/feeCollections.js"),part=source.slice(source.indexOf("function projectSummary("),source.indexOf("async function projectView("));
 const summarize=runInNewContext(part+";projectSummary",{PAYMENT_STATUSES:{AWAITING_TRANSFER:"AWAITING_TRANSFER",REPORTED_UNVERIFIED:"REPORTED_UNVERIFIED",VERIFIED:"VERIFIED"}});
 const totals=summarize([{amount:400,paymentStatus:"REFUNDED"},{amount:600,paymentStatus:"VERIFIED"}]);assert.equal(totals.total,2);assert.equal(totals.refunded,1);assert.equal(totals.amount,600);assert.equal(totals.verifiedAmount,600);
});

class Element{
 constructor(tag){this.tagName=tag;this.children=[];this.handlers={};this.textContent="";this.value="";this.checked=false;this.hidden=false}
 append(...items){this.children.push(...items)}replaceChildren(...items){this.children=[...items]}setAttribute(name,value){this[name]=value}addEventListener(name,fn){this.handlers[name]=fn}
}
const descendants=el=>[el,...el.children.flatMap(child=>descendants(child))];
const allText=el=>[el.textContent,...el.children.map(allText)].join(" ");
function uiHarness(){const window={},head=new Element("head"),confirmations=[];let confirmed=true;
 runInNewContext(read("app/payment-resolution.js"),{window,document:{documentElement:{hasAttribute:()=>true},head,createElement:tag=>new Element(tag)},crypto:{randomUUID},confirm:message=>{confirmations.push(message);return confirmed},FormData:class{constructor(form){this.form=form}entries(){return descendants(this.form).filter(el=>el.name&&(el.type!=="checkbox"||el.checked)).map(el=>[el.name,el.value])[Symbol.iterator]()}}});
 return {ui:window.paymentResolutionUI,confirmations,setConfirmed:v=>{confirmed=v}};
}
function fill(form,values){for(const [name,value] of Object.entries(values)){const input=descendants(form).find(el=>el.name===name);assert.ok(input,name);if(input.type==="checkbox")input.checked=value;else input.value=String(value)}}
test("the real finance control sends a discrepancy action once and shows Email fallback without auto-verifying",async()=>{
 const h=uiHarness(),host=new Element("section"),calls=[];let release,refreshed=0;
 h.ui.financeControls(host,{...uniform,id:uid,etag:"version"},"uniform",async(path,options)=>{calls.push({path,body:JSON.parse(options.body)});return new Promise(resolve=>{release=resolve})},async()=>{refreshed++});
 const form=descendants(host).find(el=>el.tagName==="form"),{note,...messageOnly}=evidence;fill(form,messageOnly);const event={preventDefault(){}};
 assert.equal(descendants(form).filter(el=>el.tagName==="textarea").length,1);assert.equal(descendants(form).some(el=>el.name==="note"),false);
 const first=form.handlers.submit(event);await form.handlers.submit(event);assert.equal(calls.length,1);assert.equal(calls[0].body.action,"REQUEST_ADJUSTMENT");assert.equal(calls[0].body.receivedAmount,300);assert.equal(calls[0].body.etag,"version");
 assert.equal(calls[0].body.reason,messageOnly.reason);assert.equal(calls[0].body.note,undefined);
 release({notification:{status:"email_sent"}});await first;assert.equal(refreshed,1);assert.match(allText(form),/備援 Email 已受理/);assert.match(h.confirmations[0],/原申請會暫停/);
});
test("the real parent panel shows only the difference and submits refund details only after confirmation",async()=>{
 const h=uiHarness(),host=new Element("section"),calls=[],item={...uniform,id:uid,sourceType:"uniform",title:"團 T",paymentStatus:"ADJUSTMENT_REQUIRED",paymentResolution:{revision:"case-version",expectedAmount:400,receivedAmount:300,balance:100,reason:"<img>差額"},paymentAccount:{bankName:"測試銀行",bankCode:"807",accountHolder:"LAB",accountNumber:"12345678"}};
 const api=async(path,options)=>{if(!options)return {items:[item]};calls.push(JSON.parse(options.body));return {notification:{status:"accepted"}}};
 await h.ui.loadParent(host,api);assert.match(allText(host),/尚待補繳：NT\$ 100/);assert.equal(descendants(host).some(el=>el.tagName==="img"),false);
 const forms=descendants(host).filter(el=>el.tagName==="form"),refund=forms[1];fill(refund,{reason:"不再購買",bankCode:"807",accountNumber:"123456789012",accountHolder:"測試家長"});
 h.setConfirmed(false);await refund.handlers.submit({preventDefault(){}});assert.equal(calls.length,0);
 h.setConfirmed(true);await refund.handlers.submit({preventDefault(){}});assert.equal(calls.length,1);assert.equal(calls[0].action,"REQUEST_REFUND");assert.equal(calls[0].revision,"case-version");assert.equal(calls[0].accountNumber,"123456789012");assert.match(h.confirmations.at(-1),/財務完成退款後/);
});
test("dedicated finance reload after second verification exposes the paid request to the existing procurement plan without another approval",async()=>{
 const h=harness();await h.put("uniform",{...uniform,createdAt:"2026-11-21T10:00:00Z"});await h.apply("REQUEST_ADJUSTMENT",evidence);await h.apply("REPORT_SUPPLEMENT",{amount:100,lastFive:"55555",transferDate:"2026-11-22"},parent);
 const stale=await h.current();await h.apply("VERIFY_ADJUSTMENT",{receivedAmount:400,bankPostedAt:"2026-11-22",note:"補款已到帳"});
 const verified=await h.current(),source=read("app/uniform-event-admin.js"),events=[],elements=new Map();let renderedPlan,renderedStage,historyStatus;
 const el=id=>{if(!elements.has(id))elements.set(id,new Element("div"));return elements.get(id)};
 const snippet=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
 const scope={cachedRequests:[stale],cachedFamilyRegistrations:[],cachedStaffFinanceItems:[],activeAdminTab:"regularUniform",hasFinanceAccess:true,adminAuthenticated:true,financeWorkspace:true,uniformStudentNames:new Map(),
  document:{createElement:tag=>new Element(tag)},el,window:{paymentResolutionUI:{enabled:()=>true},dispatchEvent:event=>events.push(event.type)},CustomEvent:class{constructor(type){this.type=type}},
  api:async path=>({items:path==="uniform-events/requests"?[verified]:[]}),staffFinancePending:()=>[],financeCard:()=>new Element("div"),showFinancePending(){},refreshFamilyStatistics(){},renderUniformRequestAlerts(){},
  renderResolutionFinanceHistory(uniform){historyStatus=uniform.items[0].paymentStatus},renderModuleRequests(){renderedStage=scope.approvedStage(scope.cachedRequests[0]);renderedPlan=buildTshirtProcurementPlan({schoolYear:115,semester:1,students:[{studentId:"990101",studentName:"測試學生",groupName:"A",status:"active"}],history:[{studentId:"990101",historicalIssued:true}],requests:scope.cachedRequests,stock:TSHIRT_PLAN_SIZES.map(size=>({key:"regular:"+size,onHand:0,reserved:0,unavailable:0}))})}
 };
 runInNewContext(snippet("function syncFinanceViews(","function staffFinancePending(")+snippet("const approvedStage=","\n")+"\n"+snippet("async function loadInlineFinance()","\nel(\"inlineFinanceReview\").addEventListener")+";this.reload=loadInlineFinance;this.approvedStage=approvedStage",scope);
 await scope.reload();assert.equal(scope.cachedRequests[0].paymentStatus,"VERIFIED");assert.equal(renderedStage,undefined,"finance does not render hidden operational panels");scope.renderModuleRequests();assert.equal(renderedStage,"ready");assert.equal(renderedPlan.waitingUnits,0);assert.equal(renderedPlan.needUnits,1);assert.equal(renderedPlan.rows[0].ready,true);assert.equal(historyStatus,"VERIFIED");assert.deepEqual(events,["uniformRequestsLoaded"]);
 await scope.reload();assert.equal(events.length,1,"unchanged finance reads must not reload procurement again");
});
