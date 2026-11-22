import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
const source=readFileSync(new URL("../app/uniform-event-admin.js",import.meta.url),"utf8");
const controller=source.slice(source.indexOf("function showRequestUpdateFeedback("),source.indexOf("let uniformBankTemplates="));
const renderer=source.slice(source.indexOf("function table("),source.indexOf("function csv("));
const pending={id:"order-one",kind:"regularUniform",studentId:"student-one",size:"S",quantity:1,status:"PENDING",amount:null,etag:"e1"};
const approved={...pending,status:"APPROVED",amount:400,paymentStatus:"AWAITING_TRANSFER",etag:"e2"};
function harness({account=true,finance=true,patchError=null,persist=true,readError=false,price=400,lineStatus="accepted"}={}){
 let stored={...pending},bankTab=false;const select={value:"APPROVED"},handlers={},confirmations=[],nodes={status:{textContent:""},requests:{innerHTML:"",addEventListener:(type,fn)=>{handlers[type]=fn},querySelector:()=>select},uniformBankKind:{value:""},uniformBankForm:{elements:{kind:{value:""}}},uniformBankSettings:{open:false,scrollIntoView(){this.scrolled=true}}},calls=[];
 const scope={cachedRequests:[{...stored}],visibleModuleRequests:[{...stored}],pendingRequestIds:new Set(),requestUpdateFeedback:new Map(),issueErrors:new Map(),cachedStock:[],hasFinanceAccess:finance,window:{},console,confirm:text=>{confirmations.push(text);return true},
  document:{querySelector:()=>({click(){bankTab=true}})},loadUniformBank:async()=>{},el:id=>nodes[id],esc:value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])),
  api:async(path,options)=>{
   calls.push({path,options});
   if(path.includes("uniform-payment-account"))return {item:account?{templateId:"bank-one"}:null};
   if(options?.method==="PATCH"){
    const body=JSON.parse(options.body),paymentLineNotification={status:lineStatus,retryAllowed:lineStatus!=="accepted"};
    if(body.action==="SEND_PAYMENT_LINE"){stored={...stored,paymentLineNotification};scope.cachedRequests=[{...stored}];return {item:{...stored},paymentLineNotification}}
    if(persist)stored={...approved,amount:price,paymentLineNotification};
    if(patchError)throw patchError;
    return {item:{...approved},notificationStatus:"disabled",paymentLineNotification};
   }
   if(readError)throw Error("讀回逾時");return {items:[{...stored}]};
  },
  renderModuleRequests(){scope.table("requests",scope.cachedRequests.map(row=>({...row,processing:scope.pendingRequestIds.has(row.id),kind:"團 T"})),[["status","狀態"]],true)},
  load:async()=>{scope.renderModuleRequests()}
 };
 runInNewContext(renderer+controller+";this.ui={checkUniformApprovalAccount,updateUniformRequest};",scope);
 const click=source.slice(source.indexOf('el("requests").addEventListener("click",async e=>{'),source.indexOf('el("inventoryForm").onsubmit='));
 runInNewContext(click,scope);
 return {scope,nodes,calls,confirmations,bankTab:()=>bankTab,click:target=>handlers.click({target:target||{dataset:{update:"0"},closest:()=>null}}),setApproved:()=>{stored={...approved};scope.cachedRequests=[{...stored}];scope.visibleModuleRequests=[{...stored}];scope.renderModuleRequests()},setAccount:value=>{account=value},stored:()=>stored,update:()=>scope.ui.updateUniformRequest(pending,{status:"APPROVED"},{expectedStatus:"APPROVED"})};
}
test("the real approval button checks prerequisites, confirms the action and persists the intended request",async()=>{
 const h=harness({account:false});await h.click();assert.equal(h.confirmations.length,0);assert.equal(h.calls.filter(call=>call.options?.method==="PATCH").length,0);
 h.setAccount(true);await h.click();assert.match(h.confirmations[0],/確認核准這筆申請，並開放家長匯款/);
 const mutations=h.calls.filter(call=>call.options?.method==="PATCH");assert.equal(mutations.length,1);
 assert.deepEqual(JSON.parse(mutations[0].options.body),{id:pending.id,etag:"e1",status:"APPROVED",reason:""});assert.equal(h.stored().status,"APPROVED");
 assert.match(h.nodes.requests.innerHTML,/已核准，待家長匯款 NT\$ 400/);
});
test("a missing collection account blocks approval before mutation and explains the next step beside the request",async()=>{
 const h=harness({account:false});assert.equal(await h.scope.ui.checkUniformApprovalAccount(pending),false);
 assert.equal(h.calls.length,1);assert.equal(h.stored().status,"PENDING");assert.equal(h.scope.pendingRequestIds.size,0);
 assert.match(h.nodes.requests.innerHTML,/role='alert'.*尚未核准/);assert.match(h.nodes.requests.innerHTML,/data-request-bank='regularUniform'/);
 h.setAccount(true);assert.equal(await h.scope.ui.checkUniformApprovalAccount(pending),true);assert.equal(await h.update(),true);
 assert.equal(h.scope.cachedRequests[0].status,"APPROVED");assert.equal(h.scope.cachedRequests[0].etag,"e2");
 assert.match(h.nodes.requests.innerHTML,/已核准，待家長匯款 NT\$ 400/);assert.doesNotMatch(h.nodes.requests.innerHTML,/data-request-bank|尚未核准/);
 assert.equal(h.calls.filter(call=>call.options?.method==="PATCH").length,1);
});
test("non-finance administrators see a finance instruction rather than an inaccessible settings shortcut",async()=>{
 const h=harness({account:false,finance:false});await h.scope.ui.checkUniformApprovalAccount(pending);
 assert.match(h.nodes.requests.innerHTML,/請由本校財務人員設定/);assert.doesNotMatch(h.nodes.requests.innerHTML,/data-request-bank/);
});
test("the account shortcut opens the finance tab for this uniform kind without binding an account automatically",async()=>{
 const h=harness({account:false});await h.scope.ui.checkUniformApprovalAccount(pending);
 const button={dataset:{requestBank:"regularUniform"}};await h.click({closest:selector=>selector==="button[data-request-bank]"?button:null});
 assert.equal(h.bankTab(),true);assert.equal(h.nodes.uniformBankKind.value,"regularUniform");assert.equal(h.nodes.uniformBankForm.elements.kind.value,"regularUniform");
 assert.equal(h.nodes.uniformBankSettings.open,true);assert.equal(h.nodes.uniformBankSettings.scrolled,true);assert.equal(h.stored().status,"PENDING");
 assert.equal(h.calls.filter(call=>call.options?.method==="PATCH"||call.options?.method==="POST").length,0);
});
test("an HTTP success response cannot complete approval while authoritative state is still pending",async()=>{
 const h=harness({persist:false});assert.equal(await h.update(),false);
 assert.equal(h.scope.cachedRequests[0].status,"PENDING");assert.match(h.nodes.requests.innerHTML,/更新未完成：重新查詢的申請狀態不符/);
 assert.doesNotMatch(h.nodes.requests.innerHTML,/已核准，待家長匯款/);
});
test("an invalid approved amount cannot be reported as a completed payable approval",async()=>{
 const h=harness({price:0});assert.equal(await h.update(),false);assert.match(h.nodes.requests.innerHTML,/更新未完成/);
});
test("a response timeout after persistence uses read-back without replaying the mutation or notifications",async()=>{
 const h=harness({patchError:Error("API 等待逾時")});assert.equal(await h.update(),true);
 assert.equal(h.calls.filter(call=>call.options?.method==="PATCH").length,1);
 assert.match(h.nodes.requests.innerHTML,/已核准，待家長匯款 NT\$ 400/);assert.match(h.nodes.requests.innerHTML,/通知結果待確認/);
});
test("a collection account removed during approval produces an actionable inline error",async()=>{
 const error=Object.assign(Error("請先設定此團服的收款帳戶，再核准申請"),{code:"UNIFORM_PAYMENT_ACCOUNT_REQUIRED"});
 const h=harness({persist:false,patchError:error});assert.equal(await h.update(),false);
 assert.match(h.nodes.requests.innerHTML,/更新未完成：請先設定/);assert.match(h.nodes.requests.innerHTML,/data-request-bank='regularUniform'/);
 assert.equal(h.stored().status,"PENDING");
});
test("a read-back failure remains unconfirmed and never claims completion",async()=>{
 const h=harness({readError:true});assert.equal(await h.update(),false);
 assert.match(h.nodes.requests.innerHTML,/異動結果待確認.*暫勿重複送出/);assert.doesNotMatch(h.nodes.requests.innerHTML,/已核准，待家長匯款/);
 assert.equal(h.scope.pendingRequestIds.size,0);
});
test("feedback is escaped, scoped to its own request and retained across redraws",()=>{
 const h=harness();h.scope.cachedRequests.push({...pending,id:"order-two"});
 h.scope.requestUpdateFeedback.set(pending.id,{text:"更新未完成：<錯誤>",error:true});h.scope.renderModuleRequests();
 assert.equal((h.nodes.requests.innerHTML.match(/request-update-feedback/g)||[]).length,1);
 assert.match(h.nodes.requests.innerHTML,/&lt;錯誤&gt;/);assert.doesNotMatch(h.nodes.requests.innerHTML,/<錯誤>/);
 h.scope.renderModuleRequests();assert.match(h.nodes.requests.innerHTML,/更新未完成/);
});
test("public uniform approval does not require a collection account",async()=>{
 const h=harness({account:false});assert.equal(await h.scope.ui.checkUniformApprovalAccount({...pending,kind:"competitionUniform",acquisition:"PUBLIC"}),true);assert.equal(h.calls.length,0);
});
test("an already-approved request exposes a LINE resend action and does not need another approval",async()=>{
 const h=harness();h.setApproved();assert.match(h.nodes.requests.innerHTML,/data-payment-line='0'>補送繳款 LINE 通知/);
 const button={dataset:{paymentLine:"0"}};await h.click({closest:selector=>selector==="button[data-payment-line]"?button:null});
 const changes=h.calls.filter(call=>call.options?.method==="PATCH");assert.equal(changes.length,1);
 assert.deepEqual(JSON.parse(changes[0].options.body),{action:"SEND_PAYMENT_LINE",id:pending.id,etag:"e2"});
 assert.equal(h.stored().status,"APPROVED");assert.equal(h.stored().amount,400);
 assert.match(h.nodes.requests.innerHTML,/LINE 已受理繳款通知（實際收件待確認）/);assert.doesNotMatch(h.nodes.requests.innerHTML,/data-payment-line|LINE 已送達/);
});
test("approval displays the actual LINE outcome independently of disabled LAB email",async()=>{
 const h=harness({lineStatus:"not_bound"});await h.update();
 assert.match(h.nodes.requests.innerHTML,/已核准，待家長匯款 NT\$ 400/);assert.match(h.nodes.requests.innerHTML,/LAB 未對外寄送 Email/);
 assert.match(h.nodes.requests.innerHTML,/原申請人尚未綁定本校 LINE/);assert.doesNotMatch(h.nodes.requests.innerHTML,/LINE 已受理|LINE 已送達/);
});


test("paid shirt requests point to the master procurement view while existing stock and actual issuance keep their own actions",()=>{
 const h=harness();h.setApproved();let row=h.scope.cachedRequests[0];row.paymentStatus="VERIFIED";h.scope.renderModuleRequests();
 assert.match(h.nodes.requests.innerHTML,/data-master-order/);assert.doesNotMatch(h.nodes.requests.innerHTML,/data-record-order/);
 h.scope.cachedStock=[{key:"regular:S",onHand:2,reserved:0,unavailable:0}];h.scope.renderModuleRequests();assert.match(h.nodes.requests.innerHTML,/data-ready-stock/);
 row.purchaseOrderId="po";row.purchaseOrderNumber="T-1151-EXAMPLE";row.status="ORDERED";h.scope.renderModuleRequests();
 assert.match(h.nodes.requests.innerHTML,/T-1151-EXAMPLE/);assert.doesNotMatch(h.nodes.requests.innerHTML,/data-receive=|data-record-order=|data-cancel=|data-procurement=/);
 row.status="READY_FOR_PICKUP";row.received=true;h.scope.renderModuleRequests();assert.match(h.nodes.requests.innerHTML,/data-issue=/);
});
