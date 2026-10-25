import {TSHIRT_PLAN_SIZES,STAFF_CATEGORIES,currentTshirtTerm,buildTshirtProcurementPlan,tshirtPlanCsv} from "./tshirt-procurement-plan.mjs?v=20261026-term-plan-r2";
const $=id=>document.getElementById(id);
const term=currentTshirtTerm();
let data=null,plan=null,loading=false,canVerifyFinance=false,links=[],extraBySize={},revision=0;
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function call(path,options={}){
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
 try{
  const r=await fetch("/api/"+path,{credentials:"same-origin",cache:"no-store",...options,signal:controller.signal,headers:{"Content-Type":"application/json",...(window.uniformEventAuthHeaders?.()||{})}});
  const body=await r.json().catch(()=>({}));if(!r.ok)throw Error(body.error||"HTTP "+r.status);return body;
 }finally{clearTimeout(timeout)}
}
function exportEnabled(value){$("exportTshirtPlan").disabled=!value;$("exportTshirtSupplierPlan").disabled=!value}
function draw(){
 if(!data)return;
 try{plan=buildTshirtProcurementPlan({...data,schoolYear:Number($("tshirtPlanYear").value),semester:Number($("tshirtPlanSemester").value),extraBySize})}catch(e){$("tshirtPlanStatus").textContent=e.message;exportEnabled(false);return}
 const p=plan,metrics=[["學生首次公費",p.firstUnits],["學生自費加購",p.studentExtraUnits],["幹部／志工需求",p.staffUnits],["本期需求合計",p.totalUnits],["已採購／已交付",p.coveredUnits],["尚需採購（已知尺寸）",p.needUnits??"待盤點"]];
 $("tshirtPlanMetrics").innerHTML=metrics.map(([name,value])=>`<div class="procurement-metric"><span>${name}</span><strong>${value}${typeof value==="number"?" 件":""}</strong></div>`).join("");
 $("tshirtPlanPeriod").textContent=`${p.term.label}｜加購申請期間 ${p.term.start} 起至 ${p.term.end} 前；跨期未結案併入。首次需求依目前在團名冊（儲備團 ${p.reserveCount} 位）。`;
 $("tshirtPlanStatus").textContent=p.canFinalize?"尺寸、需求與款項資料已齊，請核對下方採購件數與 10 件門檻。":"目前為採購規劃，仍有資料待補齊；CSV 會一併列出待辦。";
 $("tshirtPlanWarnings").innerHTML=p.warnings.length?`<ul>${p.warnings.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`:"";
 const count=v=>v===null?"待盤點":v;
 $("tshirtPlanSizeRows").innerHTML=p.sizes.map(x=>`<tr><th scope="row">${x.size}</th><td data-label="首次公費">${x.first+x.cadreFirst}</td><td data-label="自費加購">${x.studentExtra+x.cadreExtra+x.volunteerExtra}</td><td data-label="需求合計">${x.total}</td><td data-label="已採購／交付">${x.covered}</td><td data-label="可用庫存">${count(x.available)}</td><td data-label="備貨待到貨">${x.incoming}</td><td data-label="尚需採購"><strong>${count(x.need)}</strong></td><td data-label="另加備貨"><input type="number" min="0" max="100" step="1" inputmode="numeric" value="${x.extra}" data-plan-extra="${x.size}" aria-label="${x.size} 尺寸另加備貨件數"></td><td data-label="規劃採購"><strong>${count(x.order)}</strong></td></tr>`).join("");
 const units=p.orderUnits;
 $("tshirtPlanOrderTotal").textContent=units===null?"規劃採購：待庫存盤點後計算。":`規劃採購 ${units} 件（已知尺寸尚缺 ${p.needUnits} ＋另加備貨 ${p.extraUnits}）。`+(units===0?"目前已知尺寸無需新購。":units<10?`距離最低採購 10 件，尚差 ${10-units} 件；可於各尺寸填寫另加備貨。`:"已達最低採購 10 件。")+(p.unknownUnits?`另有 ${p.unknownUnits} 件待填尺寸，尚未計入採購尺碼。`:"");
 $("tshirtPlanDetailCount").textContent=`查看需求明細與待辦（${p.rows.length} 筆）`;
 $("tshirtPlanDetailRows").innerHTML=p.rows.map(x=>`<tr><td data-label="姓名">${esc(x.person)}</td><td data-label="類別">${esc(x.category)}</td><td data-label="尺寸">${esc(x.size||"待填寫")}</td><td data-label="件數">${x.quantity}</td><td data-label="進度">${esc(x.status)}</td><td data-label="備註">${esc(x.note)}</td></tr>`).join("")||'<tr><td colspan="6">此學期沒有需求</td></tr>';
 $("tshirtPlanLoanNote").textContent=`志工借用／送洗中 ${p.loans.length} 件另列於完整 CSV，不增加新購需求。學生退團或停用的申請 ${p.excludedRequests} 筆不列入；幹部／志工已登記的需求仍依實際處理進度追蹤。`;
 exportEnabled(true);drawStaff();
}
async function load(){
 if(loading)return;loading=true;const token=++revision;exportEnabled(false);data=null;plan=null;
 $("tshirtPlanStatus").textContent="正在整合學生、首次領用、加購、幹部／志工需求與正式庫存…";
 $("tshirtPlanMetrics").replaceChildren();$("tshirtPlanSizeRows").replaceChildren();$("tshirtPlanWarnings").replaceChildren();$("tshirtPlanDetailRows").replaceChildren();$("tshirtPlanOrderTotal").textContent="";
 const paths=["student-master","uniform-events/tshirt-historical-size","uniform-events/requests","uniform-events/inventory","uniform-events/parent-loans?view=procurement","uniform-events/parent-loans","student-parent-links"];
 const results=await Promise.allSettled(paths.map(path=>call(path)));
 try{
  if(token!==revision)return;
  const failed=results.findIndex(r=>r.status==="rejected");if(failed>=0)throw Error(`${["學生名冊","首次領用紀錄","家長加購申請","庫存","幹部／志工需求","領用／借還紀錄","家長綁定"][failed]}：${results[failed].reason.message}`);
  const values=results.map(x=>x.value),items=x=>Array.isArray(x)?x:x.items;
  if(values.some(x=>!Array.isArray(items(x))))throw Error("資料格式不完整，請重新整理");
  data={students:items(values[0]),history:items(values[1]),requests:items(values[2]),stock:items(values[3]),staffDemands:items(values[4]),parentLoans:items(values[5])};
  canVerifyFinance=values[4].canVerifyFinance===true;links=items(values[6]);drawParents();draw();
 }catch(e){$("tshirtPlanStatus").textContent="採購總表讀取失敗："+e.message+"。請重新整理；資料未齊前不提供採購數字與匯出。";$("tshirtStaffRecords").replaceChildren();exportEnabled(false)}
 finally{loading=false}
}
function drawParents(){
 const select=$("tshirtDemandParent"),before=select.value,students=new Map(data.students.filter(x=>String(x.status||"active").toLowerCase()==="active").map(x=>[String(x.studentId||x.id),x]));
 select.replaceChildren(new Option("請選擇家長（依學生綁定）",""));
 links=links.filter(x=>students.has(String(x.studentId))&&x.parentEmail);
 links.forEach((x,i)=>select.add(new Option(`${x.parentName||"家長"} · ${students.get(String(x.studentId)).studentName||students.get(String(x.studentId)).name||x.studentId}（${x.parentEmail}）`,String(i))));
 if([...select.options].some(x=>x.value===before))select.value=before;
}
function staffStatus(x){return x.status==="APPROVED"?(x.category==="CADRE_FIRST"?"首次公費待採購":x.paymentStatus==="VERIFIED"?"已核帳，待採購":"待財務核帳"):({ORDERED:"已採購待到貨",ARRIVED:"已到貨",FULFILLED:"已處理完成",CANCELLED:"已取消"})[x.status]||x.status}
function drawStaff(){
 const body=$("tshirtStaffRecords");body.replaceChildren();
 const list=data.staffDemands.filter(x=>Number(x.schoolYear)===plan.term.schoolYear&&Number(x.semester)===plan.term.semester||["APPROVED","ORDERED","ARRIVED"].includes(x.status)&&Number(x.schoolYear)*2+Number(x.semester)<plan.term.schoolYear*2+plan.term.semester);
 if(!list.length){body.textContent="尚未登記幹部／志工採購需求；有需求時請展開上方登記。";return}
 for(const x of list.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))){
  const card=document.createElement("details");card.className="tshirt-demand-record";
  const title=document.createElement("summary");title.textContent=`${x.parentName}｜${STAFF_CATEGORIES[x.category]}｜${x.size} × ${x.quantity} 件｜${staffStatus(x)}`;card.append(title);
  const desc=document.createElement("p");desc.textContent=`${x.schoolYear} 學年度${x.semester===1?"上":"下"}學期｜應繳 NT$${x.amount}｜${x.note||"未填備註"}`;card.append(desc);
  if(x.category!=="CADRE_FIRST"&&x.status==="APPROVED"&&x.paymentStatus!=="VERIFIED"){
   if(canVerifyFinance){
    const form=document.createElement("form");form.className="tshirt-demand-finance";
    form.innerHTML='<h4>財務確認實際入帳</h4><label>入帳日期<input name="date" type="date" required></label><label>實際金額<input name="amount" type="number" min="1" step="1" required></label><label>匯款末五碼<input name="lastFive" inputmode="numeric" pattern="[0-9]{5}" maxlength="5" required></label><label>核帳說明<input name="note" maxlength="300" required></label><button type="submit">確認此筆已入帳</button>';
    form.addEventListener("submit",async e=>{e.preventDefault();if(!confirm(`確認已核對 ${x.parentName} 的實際入帳 NT$${x.amount}？`))return;await saveChange(x,{action:"VERIFY_DEMAND_PAYMENT",bankPostedDate:form.elements.date.value,paidAmount:Number(form.elements.amount.value),lastFive:form.elements.lastFive.value,note:form.elements.note.value},form.querySelector("button"))});card.append(form);
   }else{const hint=document.createElement("p");hint.textContent="請具財務權限人員展開此筆需求，核對實際入帳。";card.append(hint)}
  }
  const next={APPROVED:x.category==="CADRE_FIRST"||x.paymentStatus==="VERIFIED"?[["ORDERED","標記已採購"],["CANCELLED","取消需求"]]:[["CANCELLED","取消需求"]],ORDERED:[["ARRIVED","標記已到貨"]],ARRIVED:[["FULFILLED","確認需求已處理完成"]]}[x.status]||[];
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
for(const id of ["tshirtPlanYear","tshirtPlanSemester"])$(id).addEventListener("change",()=>{extraBySize={};draw()});
$("tshirtPlanSizeRows").addEventListener("change",e=>{
 const size=e.target.dataset.planExtra;if(!size)return;
 const n=Number(e.target.value);if(!Number.isSafeInteger(n)||n<0||n>100){e.target.setCustomValidity("請填 0–100 的整數");e.target.reportValidity();exportEnabled(false);return}
 e.target.setCustomValidity("");extraBySize[size]=n;draw();
});
for(const [id,supplierOnly] of [["exportTshirtPlan",false],["exportTshirtSupplierPlan",true]])$(id).addEventListener("click",()=>{
 if(!plan)return;
 const csv=tshirtPlanCsv(plan,{supplierOnly}),url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
 const a=document.createElement("a");a.href=url;a.download=`團T_${plan.term.schoolYear}_${plan.term.semester===1?"上":"下"}學期_${supplierOnly?"廠商尺碼表":"採購總表與明細"}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
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
window.addEventListener("uniformAdminAuth",e=>{if(!e.detail?.authenticated){revision++;data=null;plan=null;exportEnabled(false)}});
