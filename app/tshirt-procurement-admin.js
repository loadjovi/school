import "./payment-resolution.js?v=20261122-single-parent-message";
import {TSHIRT_PLAN_SIZES,STAFF_CATEGORIES,currentTshirtTerm,buildTshirtProcurementPlan,tshirtPlanCsv,tshirtPurchaseOrderCsv,tshirtOrderCandidates} from "./tshirt-procurement-plan.mjs?v=20261122-active-history";
const $=id=>document.getElementById(id);
const term=currentTshirtTerm();
let data=null,plan=null,loading=false,reloadRequested=false,links=[],extraBySize={},revision=0,canCreateOrder=false,purchaseOrderRequestKey="";
let activePlanFilter="";
const planFilters={first:"學生首次公費",extra:"學生自費加購",staff:"幹部／志工需求",total:"處理中需求合計",covered:"已採購／待發放",need:"尚需採購（已知尺寸）"};
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function call(path,options={}){
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),options.method==="POST"?90000:20000);
 try{
  const r=await fetch("/api/"+path,{credentials:"same-origin",cache:"no-store",...options,signal:controller.signal,headers:{"Content-Type":"application/json",...(window.uniformEventAuthHeaders?.()||{})}});
  const body=await r.json().catch(()=>({}));if(!r.ok)throw Error(body.error||"HTTP "+r.status);return body;
 }finally{clearTimeout(timeout)}
}
function exportEnabled(value){$("exportTshirtPlan").disabled=!value;$("exportTshirtSupplierPlan").disabled=!value;if(!value)$("confirmTshirtPurchaseOrder").disabled=true}
const displayTime=value=>value?new Intl.DateTimeFormat("zh-TW",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(value)):"—";
function downloadOrder(order){
 const csv=tshirtPurchaseOrderCsv(order),url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"})),a=document.createElement("a");
 a.href=url;a.download=`${order.orderNumber}_廠商訂購表.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
const orderLabels={ORDERED:"待到貨",RECEIVING:"驗收待完成",RECEIVED:"已整單到貨／入庫",CANCELLED:"已取消"};
const openOrders=new Set(),pendingOrderIds=new Set(),orderReceiptDrafts=new Map();
let creatingOrder=false;
function orderFeedback(result){return result.syncPending?"採購單已儲存，部分需求或通知待同步，請按「重新同步需求／通知」。":"採購單、需求與庫存已同步。"}
async function orderAction(order,payload,button,message){
 if(pendingOrderIds.has(order.id))return;pendingOrderIds.add(order.id);
 button.disabled=true;message.textContent="處理中，請稍候…";
 try{
  const result=await call("uniform-events/tshirt-purchase-orders",{method:"POST",body:JSON.stringify({id:order.id,etag:order.etag,...payload})});
  $("tshirtPurchaseOrderFeedback").textContent=orderFeedback(result);if(["RECEIVE","CANCEL"].includes(payload.action))orderReceiptDrafts.delete(order.id);window.dispatchEvent(new CustomEvent("tshirtPurchaseOrdersChanged"));await load();
 }catch(error){message.textContent="結果待確認："+error.message+"。請重新讀取同張採購單核對，不需另建新單。";button.disabled=false}finally{pendingOrderIds.delete(order.id)}
}
function drawOrders(){
 const host=$("tshirtPurchaseOrders"),orders=(data?.purchaseOrders||[]).filter(x=>Number(x.schoolYear)===plan.term.schoolYear&&Number(x.semester)===plan.term.semester);host.replaceChildren();
 if(!orders.length){host.textContent="本學期尚未建立採購單。";return}
 for(const order of orders){
  const card=document.createElement("details");card.className="tshirt-purchase-order";card.open=openOrders.has(order.id);card.addEventListener("toggle",()=>{if(card.open)openOrders.add(order.id);else openOrders.delete(order.id)});
  const summary=document.createElement("summary");summary.textContent=`${order.orderNumber}｜${orderLabels[order.status]||order.status}｜${order.totalQuantity} 件｜${displayTime(order.createdAt)}`;card.append(summary);
  const detail=document.createElement("p");detail.textContent=(order.items||[]).map(x=>`${x.size} × ${x.quantity}`).join("、")+(order.pendingUnknownUnits?`；另有 ${order.pendingUnknownUnits} 件待填尺寸，未列入此單`:"");card.append(detail);
  const linked=document.createElement("p");linked.textContent=`已整合 ${(order.links||[]).length} 筆需求；其餘為首次公費或備貨庫存。`;card.append(linked);
  if(order.links?.length){const list=document.createElement("details"),title=document.createElement("summary");title.textContent="查看本單需求";list.append(title);for(const link of order.links){const row=document.createElement("p");row.textContent=`${link.name}｜${link.type==="REQUEST"?"家長加購":"幹部／志工"}｜${link.size} × ${link.quantity}`+(link.legacyReceipt?"｜先前已入庫，僅整合紀錄":"");list.append(row)}card.append(list)}
  const exportButton=document.createElement("button");exportButton.type="button";exportButton.textContent="匯出廠商訂購表 CSV";exportButton.addEventListener("click",()=>downloadOrder(order));card.append(exportButton);
  const message=document.createElement("p");message.setAttribute("role","status");
  if(order.status==="ORDERED"){
   const candidates=tshirtOrderCandidates(data,order,{legacy:true});
   if(candidates.length){
    const section=document.createElement("details"),title=document.createElement("summary"),form=document.createElement("form"),hint=document.createElement("p"),checks=[];
    section.className="tshirt-order-link";title.textContent="整合待採購／舊申請";hint.textContent="僅勾選屬於這張採購單的需求。已到貨申請請先核對同一批貨；確認後不會重複入庫。";section.append(title,hint);
    for(const x of candidates){const label=document.createElement("label"),check=document.createElement("input"),text=document.createElement("span");check.type="checkbox";check.checked=x.selected;text.textContent=`${x.name}｜${x.parts.map(p=>p.size+" × "+p.quantity).join("、")}`+(x.includeReceived?"｜已到貨／領取，核對後才勾選":x.status==="ORDERED"?"｜舊個別採購":"｜待採購");label.append(check,text);form.append(label);checks.push([check,x])}
    const save=document.createElement("button");save.type="submit";save.textContent="確認納入這張採購單";form.append(save);form.addEventListener("submit",async e=>{e.preventDefault();const selected=checks.filter(([check])=>check.checked).map(([,x])=>({type:x.type,id:x.id,etag:x.etag,includeReceived:x.includeReceived}));if(!selected.length){message.textContent="請先勾選需求。";return}if(!confirm("確認這些需求屬於 "+order.orderNumber+"？先前已入庫件數將抵扣本單入庫數量。"))return;await orderAction(order,{action:"LINK",links:selected},save,message)});section.append(form);card.append(section);
   }
  }
  if(["ORDERED","RECEIVING"].includes(order.status)){
   const form=document.createElement("form"),date=document.createElement("input"),note=document.createElement("textarea"),save=document.createElement("button");form.className="tshirt-order-receive";
   const draft=orderReceiptDrafts.get(order.id);date.type="date";date.required=true;date.value=draft?.date||new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());note.required=true;note.maxLength=300;note.rows=2;note.value=draft?.note||"";
   const saveDraft=()=>{openOrders.add(order.id);orderReceiptDrafts.set(order.id,{date:date.value,note:note.value})};form.addEventListener("input",saveDraft);form.addEventListener("change",saveDraft);
   for(const [name,input] of [["整單到貨日期",date],["驗收備註",note]]){const label=document.createElement("label");label.textContent=name;label.append(input);form.append(label)}
   save.type="submit";save.textContent="確認整單到貨並入庫";form.append(save);
   form.addEventListener("submit",async e=>{e.preventDefault();if(!date.value||!note.value.trim())return;if(!confirm(`確認 ${order.orderNumber} 全部 ${order.totalQuantity} 件已到貨？將統一入庫、開放已整合家長領取並通知；先前已入庫的件數不重複增加。`))return;for(const control of [date,note,save])control.disabled=true;await orderAction(order,{action:"RECEIVE",receivedDate:date.value,note:note.value.trim()},save,message);for(const control of [date,note,save])control.disabled=false});card.append(form);
  }
  if(order.status==="RECEIVED"){const receipt=document.createElement("p");receipt.textContent=`到貨 ${order.receivedDate}｜本單 ${order.totalQuantity} 件：本次入庫 ${order.addedQuantity} 件、先前已入庫 ${order.creditedQuantity} 件。`;card.append(receipt)}
  if(order.syncPending){const sync=document.createElement("button");sync.type="button";sync.textContent="重新同步需求／通知";sync.addEventListener("click",()=>orderAction(order,{action:"SYNC"},sync,message));card.append(sync)}
  if(order.status==="ORDERED"&&!(order.links||[]).some(x=>x.legacyReceipt)){
   const cancel=document.createElement("button");cancel.type="button";cancel.className="secondary";cancel.textContent="取消這張採購單";cancel.addEventListener("click",async()=>{const reason=prompt(`取消 ${order.orderNumber}：請填寫原因`);if(!reason?.trim()||!confirm("確認取消整張採購單？家長需求會回到待採購。"))return;await orderAction(order,{action:"CANCEL",reason:reason.trim()},cancel,message)});card.append(cancel);
  }
  if(order.status==="CANCELLED"&&order.cancelReason){const cancelled=document.createElement("p");cancelled.textContent=`取消原因：${order.cancelReason}`;card.append(cancelled)}
  card.append(message);host.append(card);
 }
}
function drawPlanMetrics(){
 const p=plan,metrics=[["first",p.firstUnits],["extra",p.studentExtraUnits],["staff",p.staffUnits],["total",p.totalUnits],["covered",p.coveredUnits],["need",p.needUnits??"待盤點"]];
 $("tshirtPlanMetrics").innerHTML=metrics.map(([key,value])=>`<button type="button" class="procurement-metric tshirt-plan-metric" data-plan-filter="${key}" aria-pressed="${activePlanFilter===key}" aria-controls="tshirtPlanDetails" aria-label="${planFilters[key]} ${value}${typeof value==="number"?" 件":""}，查看明細"><span>${planFilters[key]}</span><strong>${value}${typeof value==="number"?" 件":""}</strong><small>查看明細 ›</small></button>`).join("");
}
function drawPlanDetails(){
 if(!plan)return;
 const need=activePlanFilter==="need",name=planFilters[activePlanFilter]||"全部處理中需求";
 const rows=plan.rows.filter(row=>activePlanFilter==="first"?row.type==="STUDENT_FIRST":activePlanFilter==="extra"?row.type==="STUDENT_EXTRA":activePlanFilter==="staff"?Object.hasOwn(STAFF_CATEGORIES,row.type):activePlanFilter==="covered"?row.covered:true);
 $("tshirtPlanPeopleTable").hidden=need;$("tshirtPlanNeedTable").hidden=!need;
 $("tshirtPlanClearFilter").hidden=!activePlanFilter;
 if(need){
  const sizes=plan.sizes.filter(row=>row.need===null||row.need>0),count=value=>value===null?"待盤點":value;
  $("tshirtPlanDetailCount").textContent=name+"｜"+(plan.needUnits===null?"待盤點":plan.needUnits+" 件");
  $("tshirtPlanFilterSummary").textContent=plan.needUnits===null?"部分尺寸尚未盤點，請先核對庫存。":plan.needUnits===0?"目前已知尺寸的需求已有庫存或已下單數量可供應，無須新增採購。":"依各尺寸扣除可用庫存與已下單備貨後，顯示尚缺件數。";
  $("tshirtPlanNeedRows").innerHTML=sizes.map(row=>`<tr><th scope="row">${row.size}</th><td data-label="需求合計">${row.total}</td><td data-label="已採購／待發放">${row.covered}</td><td data-label="待審／付款／核帳">${row.waiting}</td><td data-label="可用庫存">${count(row.available)}</td><td data-label="備貨待到貨">${row.incoming}</td><td data-label="尚需採購"><strong>${count(row.need)}</strong></td></tr>`).join("")||'<tr><td colspan="7">目前無需新增採購</td></tr>';
 }else{
  const quantity=rows.reduce((sum,row)=>sum+row.quantity,0);
  $("tshirtPlanDetailCount").textContent=activePlanFilter?`${name}｜${quantity} 件（${rows.length} 筆）`:`查看需求明細與待辦（${rows.length} 筆）`;
  $("tshirtPlanFilterSummary").textContent=`${name}：${quantity} 件，共 ${rows.length} 筆。`;
  $("tshirtPlanDetailRows").innerHTML=rows.map(row=>`<tr><td data-label="姓名">${esc(row.person)}</td><td data-label="類別">${esc(row.category)}</td><td data-label="尺寸">${esc(row.size||"待填寫")}</td><td data-label="件數">${row.quantity}</td><td data-label="進度">${esc(row.status)}</td><td data-label="備註">${esc(row.note)}</td></tr>`).join("")||'<tr><td colspan="6">目前沒有符合此篩選的需求</td></tr>';
 }
}
function drawCompletedHistory(){
 const rows=plan.completedRows||[],quantity=rows.reduce((sum,row)=>sum+row.quantity,0);
 $("tshirtPlanCompletedCount").textContent=`已完成發放（歷史紀錄）｜${quantity} 件（${rows.length} 筆）`;
 $("tshirtPlanCompletedSummary").textContent="已完成的資料保留於此，供查詢過去領取紀錄。";
 $("tshirtPlanCompletedRows").innerHTML=rows.map(row=>`<tr><td data-label="姓名">${esc(row.person)}</td><td data-label="類別">${esc(row.category)}</td><td data-label="尺寸">${esc(row.size||"待核對")}</td><td data-label="件數">${row.quantity}</td><td data-label="進度">${esc(row.status)}</td><td data-label="完成日期">${esc(Number.isFinite(Date.parse(row.completedAt))?displayTime(row.completedAt):"日期未登錄")}</td><td data-label="備註">${esc(row.note)}</td></tr>`).join("")||'<tr><td colspan="7">此學期尚無完成發放紀錄</td></tr>';
}
function selectPlanFilter(key){
 if(!plan||key&&!Object.hasOwn(planFilters,key))return;
 activePlanFilter=key;drawPlanMetrics();drawPlanDetails();
 $("tshirtPlanDetails").open=true;
 if(key)$("tshirtPlanDetails").scrollIntoView({block:"start",behavior:"smooth"});
}
function draw(){
 if(!data)return;
 try{plan=buildTshirtProcurementPlan({...data,schoolYear:Number($("tshirtPlanYear").value),semester:Number($("tshirtPlanSemester").value),extraBySize})}catch(e){plan=null;$("tshirtPlanStatus").textContent=e.message;$("tshirtPlanMetrics").replaceChildren();$("tshirtPlanDetailRows").replaceChildren();$("tshirtPlanNeedRows").replaceChildren();$("tshirtPlanClearFilter").hidden=true;$("tshirtPlanDetailCount").textContent="需求明細暫停顯示";$("tshirtPlanCompletedRows").replaceChildren();$("tshirtPlanCompletedCount").textContent="歷史紀錄暫停顯示";$("tshirtPlanFilterSummary").textContent=e.message;exportEnabled(false);return}
 const p=plan;drawPlanMetrics();
 $("tshirtPlanPeriod").textContent=`${p.term.label}｜加購申請期間 ${p.term.start} 起至 ${p.term.end} 前；跨期未結案併入。首次需求依目前在團名冊（儲備團 ${p.reserveCount} 位）。`;
 const knownSizesReady=!p.missingStock.length&&!p.warnings.some(x=>/尚未分配尺碼/.test(x));
 $("tshirtPlanStatus").textContent=p.canFinalize?"尺寸、需求與款項資料已齊，請核對下方採購件數與 10 件門檻。":knownSizesReady&&p.unknownUnits?"已知尺寸的需求可先建立採購單；待填尺寸需求會明確排除，補齊後再另行處理。":knownSizesReady&&p.waitingUnits?"已核帳與公費需求已自動列入採購。待審核、匯款或核帳的需求會另列。":"目前為採購規劃，仍有資料待補齊；CSV 會一併列出待辦。";
 $("tshirtPlanWarnings").innerHTML=p.warnings.length?`<ul>${p.warnings.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`:"";
 const count=v=>v===null?"待盤點":v;
 $("tshirtPlanSizeRows").innerHTML=p.sizes.map(x=>`<tr><th scope="row">${x.size}</th><td data-label="首次公費">${x.first+x.cadreFirst}</td><td data-label="自費加購">${x.studentExtra+x.cadreExtra+x.volunteerExtra}</td><td data-label="需求合計">${x.total}</td><td data-label="已採購／待發放">${x.covered}</td><td data-label="可用庫存">${count(x.available)}</td><td data-label="備貨待到貨">${x.incoming}</td><td data-label="尚需採購"><strong>${count(x.need)}</strong></td><td data-label="另加備貨"><input type="number" min="0" max="100" step="1" inputmode="numeric" value="${x.extra}" data-plan-extra="${x.size}" aria-label="${x.size} 尺寸另加備貨件數"></td><td data-label="規劃採購"><strong>${count(x.order)}</strong></td></tr>`).join("");
 const units=p.orderUnits;
 $("tshirtPlanOrderTotal").textContent=units===null?"規劃採購：待庫存盤點後計算。":`規劃採購 ${units} 件（已知尺寸尚缺 ${p.needUnits} ＋另加備貨 ${p.extraUnits}）。`+(units===0?"目前已知尺寸無需新購。":units<10?`距離最低採購 10 件，尚差 ${10-units} 件；可於各尺寸填寫另加備貨。`:"已達最低採購 10 件。")+(p.unknownUnits?`另有 ${p.unknownUnits} 件待填尺寸，尚未計入採購尺碼。`:"");
 canCreateOrder=Number.isSafeInteger(units)&&units>=10&&knownSizesReady;
 const create=$("confirmTshirtPurchaseOrder");create.disabled=!canCreateOrder;create.title=canCreateOrder?"建立採購單並將尺碼列入已下單待到貨":units===0?"目前沒有需要採購的數量":units!==null&&units<10?"尚未達最低採購 10 件":"請先完成庫存或已採購尺碼資料";
 $("tshirtPurchaseOrderHint").textContent=canCreateOrder?(p.unknownUnits?`可建立目前已知的 ${units} 件；尚有 ${p.unknownUnits} 件待填尺寸，本次不會列入。`:`可將目前 ${units} 件正式轉為採購單。`):create.title;
 drawPlanDetails();drawCompletedHistory();
 $("tshirtPlanLoanNote").textContent=`志工借用／送洗中 ${p.loans.length} 件另列於完整 CSV，不增加新購需求。學生退團或停用的申請 ${p.excludedRequests} 筆不列入；幹部／志工已領取或已處理完成者不列入本表與採購 CSV；領用歷史仍可至「幹部／志工」查詢，自費加購另計。`;
 exportEnabled(true);create.disabled=!canCreateOrder;drawStaff();drawOrders();
}
async function load(){
 if(loading){reloadRequested=true;return}loading=true;const token=++revision;exportEnabled(false);data=null;plan=null;
 $("tshirtPlanStatus").textContent="正在整合學生、首次領用、加購、幹部／志工需求與正式庫存…";
 $("tshirtPlanMetrics").replaceChildren();$("tshirtPlanSizeRows").replaceChildren();$("tshirtPlanWarnings").replaceChildren();$("tshirtPlanDetailRows").replaceChildren();$("tshirtPurchaseOrders").replaceChildren();$("tshirtPlanOrderTotal").textContent="";canCreateOrder=false;
 $("tshirtPlanNeedRows").replaceChildren();$("tshirtPlanClearFilter").hidden=true;$("tshirtPlanFilterSummary").textContent="正在讀取明細…";$("tshirtPlanDetailCount").textContent="正在讀取需求明細…";
 $("tshirtPlanCompletedRows").replaceChildren();$("tshirtPlanCompletedCount").textContent="已完成發放（歷史紀錄）｜讀取中…";
 const paths=["student-master","uniform-events/tshirt-historical-size","uniform-events/requests","uniform-events/inventory","uniform-events/parent-loans?view=procurement","uniform-events/parent-loans","uniform-events/tshirt-purchase-orders","student-parent-links"];
 const results=await Promise.allSettled(paths.map(path=>call(path)));
 try{
  if(token!==revision)return;
  const failed=results.findIndex(r=>r.status==="rejected");if(failed>=0)throw Error(`${["學生名冊","首次領用紀錄","家長加購申請","庫存","幹部／志工需求","領用／借還紀錄","採購單紀錄","家長綁定"][failed]}：${results[failed].reason.message}`);
  const values=results.map(x=>x.value),items=x=>Array.isArray(x)?x:x.items;
  if(values.some(x=>!Array.isArray(items(x))))throw Error("資料格式不完整，請重新整理");
  data={students:items(values[0]),history:items(values[1]),requests:items(values[2]),stock:items(values[3]),staffDemands:items(values[4]),parentLoans:items(values[5]),purchaseOrders:items(values[6])};
  window.dispatchEvent(new CustomEvent("tshirtStaffDemandsLoaded",{detail:{items:data.staffDemands}}));
  links=items(values[7]);drawParents();draw();
 }catch(e){$("tshirtPlanStatus").textContent="採購總表讀取失敗："+e.message+"。請重新整理；資料未齊前不提供採購數字與匯出。";$("tshirtPlanFilterSummary").textContent="明細讀取失敗，請重新整理。";$("tshirtPlanDetailCount").textContent="需求明細讀取失敗";$("tshirtPlanCompletedCount").textContent="已完成發放（歷史紀錄）｜讀取失敗";$("tshirtPlanCompletedSummary").textContent="請重新整理後查詢。";$("tshirtStaffRecords").replaceChildren();exportEnabled(false)}
 finally{loading=false;if(reloadRequested){reloadRequested=false;await load()}}
}
function drawParents(){
 const select=$("tshirtDemandParent"),before=select.value,students=new Map(data.students.filter(x=>String(x.status||"active").toLowerCase()==="active").map(x=>[String(x.studentId||x.id),x]));
 select.replaceChildren(new Option("請選擇家長（依學生綁定）",""));
 links=links.filter(x=>students.has(String(x.studentId))&&x.parentEmail);
 links.forEach((x,i)=>select.add(new Option(`${x.parentName||"家長"} · ${students.get(String(x.studentId)).studentName||students.get(String(x.studentId)).name||x.studentId}（${x.parentEmail}）`,String(i))));
 if([...select.options].some(x=>x.value===before))select.value=before;
}
function staffStatus(x){if(x.paymentResolution&&window.paymentResolutionUI?.labels[x.paymentStatus])return window.paymentResolutionUI.labels[x.paymentStatus];return x.status==="APPROVED"?(x.category==="CADRE_FIRST"?"首次公費待採購":x.paymentStatus==="VERIFIED"?"已核帳，待採購":"待財務核帳"):({ORDERED:"已採購待到貨",ARRIVED:"已到貨",FULFILLED:"已處理完成",CANCELLED:"已取消"})[x.status]||x.status}
function drawStaff(){
 const body=$("tshirtStaffRecords");body.replaceChildren();
 const list=data.staffDemands.filter(x=>Number(x.schoolYear)===plan.term.schoolYear&&Number(x.semester)===plan.term.semester||["APPROVED","ORDERED","ARRIVED"].includes(x.status)&&Number(x.schoolYear)*2+Number(x.semester)<plan.term.schoolYear*2+plan.term.semester);
 if(!list.length){body.textContent="尚未登記幹部／志工採購需求；有需求時請展開上方登記。";return}
 for(const x of list.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))){
  const card=document.createElement("details");card.className="tshirt-demand-record";
  const title=document.createElement("summary");title.textContent=`${x.parentName}｜${STAFF_CATEGORIES[x.category]}｜${x.size} × ${x.quantity} 件｜${staffStatus(x)}`;card.append(title);
  const desc=document.createElement("p");desc.textContent=`${x.schoolYear} 學年度${x.semester===1?"上":"下"}學期｜應繳 NT$${x.amount}｜${x.note||"未填備註"}`;card.append(desc);
  const resolutionHeld=Boolean(x.paymentResolution)&&["ADJUSTMENT_REQUIRED","SUPPLEMENT_REPORTED","REFUND_REQUESTED","REFUNDED"].includes(x.paymentStatus);
  if(x.category!=="CADRE_FIRST"&&x.status==="APPROVED"&&x.paymentStatus!=="VERIFIED"){
   const hint=document.createElement("p");hint.textContent=resolutionHeld?"款項處理中，請由財務核帳區完成後再採購。":"待財務核帳，完成後會自動納入採購。";card.append(hint);
  }
  const next=resolutionHeld?[]:{APPROVED:x.purchaseOrderId?[]:[["CANCELLED","取消需求"]],ORDERED:[],ARRIVED:[["FULFILLED","確認需求已處理完成"]]}[x.status]||[];
  for(const [status,label] of next){const button=document.createElement("button");button.type="button";button.textContent=label;button.addEventListener("click",async()=>{
   const note=prompt(label+"：請填寫實際處理說明（這裡只更新需求進度；驗收、庫存與發放請依原流程另行登記）。");if(!note?.trim())return;
   await saveChange(x,{action:"UPDATE_DEMAND_STATUS",status,note:note.trim()},button);
  });card.append(button)}
  body.append(card);
 }
}
async function saveChange(record,payload,button){
 button.disabled=true;try{await call("uniform-events/parent-loans",{method:"POST",body:JSON.stringify({...payload,id:record.id,etag:record.etag})});await load()}catch(e){alert("需求更新失敗："+e.message);button.disabled=false}
}
$("tshirtPlanYear").value=term.schoolYear;$("tshirtPlanSemester").value=term.semester;
$("tshirtPlanReload").addEventListener("click",load);
for(const id of ["tshirtPlanYear","tshirtPlanSemester"])$(id).addEventListener("change",()=>{extraBySize={};purchaseOrderRequestKey="";activePlanFilter="";$("tshirtPlanCompleted").open=false;draw()});
$("tshirtPlanMetrics").addEventListener("click",event=>{const button=event.target.closest?.("[data-plan-filter]");if(button)selectPlanFilter(button.dataset.planFilter)});
$("tshirtPlanClearFilter").addEventListener("click",()=>selectPlanFilter(""));
$("tshirtPlanSizeRows").addEventListener("change",e=>{
 const size=e.target.dataset.planExtra;if(!size)return;
 const n=Number(e.target.value);if(!Number.isSafeInteger(n)||n<0||n>100){e.target.setCustomValidity("請填 0–100 的整數");e.target.reportValidity();exportEnabled(false);return}
 e.target.setCustomValidity("");extraBySize[size]=n;purchaseOrderRequestKey="";draw();
});
for(const [id,supplierOnly] of [["exportTshirtPlan",false],["exportTshirtSupplierPlan",true]])$(id).addEventListener("click",()=>{
 if(!plan)return;
 const csv=tshirtPlanCsv(plan,{supplierOnly}),url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
 const a=document.createElement("a");a.href=url;a.download=`團T_${plan.term.schoolYear}_${plan.term.semester===1?"上":"下"}學期_${supplierOnly?"廠商尺碼表":"採購總表與明細"}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
$("confirmTshirtPurchaseOrder").addEventListener("click",async()=>{
 if(!plan||!canCreateOrder||creatingOrder)return;
 const items=plan.sizes.filter(x=>Number.isSafeInteger(x.order)&&x.order>0).map(x=>({size:x.size,quantity:x.order}));
 const breakdown=items.map(x=>`${x.size} × ${x.quantity}`).join("、"),pending=plan.unknownUnits?`\n\n注意：另有 ${plan.unknownUnits} 件待填尺寸，本採購單暫不包含這些待填尺寸需求。`:"";
 if(!confirm(`確認將目前規劃轉成正式採購單？\n\n${breakdown}\n合計 ${plan.orderUnits} 件。${pending}\n\n建立後會列入「備貨待到貨」，避免重複下單。`))return;
 creatingOrder=true;const button=$("confirmTshirtPurchaseOrder");button.disabled=true;$("tshirtPurchaseOrderFeedback").textContent="正在建立採購單…";
 try{
  purchaseOrderRequestKey||=crypto.randomUUID();
  const result=await call("uniform-events/tshirt-purchase-orders",{method:"POST",body:JSON.stringify({action:"CREATE",requestKey:purchaseOrderRequestKey,schoolYear:plan.term.schoolYear,semester:plan.term.semester,items,links:tshirtOrderCandidates(data,{schoolYear:plan.term.schoolYear,semester:plan.term.semester,items}).map(x=>({type:x.type,id:x.id,etag:x.etag})),pendingUnknownUnits:plan.unknownUnits,acknowledgePendingSize:plan.unknownUnits>0,needUnits:plan.needUnits,extraUnits:plan.extraUnits,note:"由團 T 採購總表確認建立"})});
  $("tshirtPurchaseOrderFeedback").textContent=`已建立 ${result.item.orderNumber}，共 ${result.item.totalQuantity} 件，納入 ${result.item.links?.length||0} 筆需求。${orderFeedback(result)}`;extraBySize={};purchaseOrderRequestKey="";openOrders.add(result.item.id);window.dispatchEvent(new CustomEvent("tshirtPurchaseOrdersChanged"));await load();
 }catch(error){$("tshirtPurchaseOrderFeedback").textContent="建立採購單失敗："+error.message;button.disabled=false}finally{creatingOrder=false}
});
$("tshirtDemandCategory").addEventListener("change",()=>{const free=$("tshirtDemandCategory").value==="CADRE_FIRST";$("tshirtDemandQuantity").max=free?1:20;if(free)$("tshirtDemandQuantity").value=1});
$("tshirtStaffDemandForm").addEventListener("submit",async e=>{
 e.preventDefault();const link=links[Number($("tshirtDemandParent").value)];
 if(!data||$("tshirtDemandParent").value===""||!link){$("tshirtDemandFeedback").textContent="請選擇已綁定的家長";return}
 const button=e.target.querySelector('button[type="submit"]');button.disabled=true;
 try{
  const category=$("tshirtDemandCategory").value,previous=data.staffDemands.find(x=>x.category==="CADRE_FIRST"&&x.parentEmail===String(link.parentEmail).toLowerCase());
  await call("uniform-events/parent-loans",{method:"POST",body:JSON.stringify({action:"ADD_DEMAND",parentEmail:link.parentEmail,parentName:$("tshirtDemandName").value.trim()||link.parentName||"",studentId:link.studentId,category,size:$("tshirtDemandSize").value,quantity:Number($("tshirtDemandQuantity").value),schoolYear:Number($("tshirtPlanYear").value),semester:Number($("tshirtPlanSemester").value),note:$("tshirtDemandNote").value.trim(),etag:previous?.status==="CANCELLED"?previous.etag:undefined})});
  $("tshirtDemandFeedback").textContent="已儲存並納入本學期採購需求。自費需求請由財務人員核帳。";await load();
 }catch(error){$("tshirtDemandFeedback").textContent="登記失敗："+error.message}finally{button.disabled=false}
});
$("tshirtDemandParent").addEventListener("change",()=>{$("tshirtDemandName").value=links[Number($("tshirtDemandParent").value)]?.parentName||""});
document.querySelectorAll('[data-tshirt-view="procurement"]').forEach(b=>b.addEventListener("click",load));
document.querySelector('[data-tshirt-view="reports"]')?.addEventListener("click",()=>{$("tshirtPlanReportHint").hidden=false});
$("openTshirtPlanFromReports")?.addEventListener("click",()=>document.querySelector('[data-tshirt-view="procurement"]').click());
$("openStaffTshirtDemand")?.addEventListener("click",()=>{document.querySelector('[data-tshirt-view="procurement"]').click();$("tshirtStaffDemandEntry").open=true;$("tshirtStaffDemandEntry").scrollIntoView({block:"start",behavior:"smooth"})});
window.addEventListener("uniformRequestsLoaded",()=>{if(!$("tshirtProcurementPanel").hidden)load()});
window.addEventListener("uniformInventoryLoaded",()=>{if(!$("tshirtProcurementPanel").hidden)load()});
window.addEventListener("uniformAdminAuth",e=>{if(!e.detail?.authenticated){revision++;data=null;plan=null;activePlanFilter="";$("tshirtPlanMetrics").replaceChildren();$("tshirtPlanDetailRows").replaceChildren();$("tshirtPlanNeedRows").replaceChildren();$("tshirtPlanClearFilter").hidden=true;$("tshirtPlanFilterSummary").textContent="請先完成管理員登入。";$("tshirtPlanDetailCount").textContent="請先完成管理員登入";$("tshirtPlanCompletedRows").replaceChildren();$("tshirtPlanCompletedCount").textContent="請先完成管理員登入";exportEnabled(false)}});

window.addEventListener("tshirtParentLoansChanged",()=>load());
