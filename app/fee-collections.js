import {createLineAccountPanel} from "./line-account-panel.js?v=20261124-auto-role-menus";
import "./payment-resolution.js?v=20261122-single-parent-message";
const accountOnly=document.documentElement.hasAttribute("data-line-account");
const legacyLineEntry=!accountOnly&&(location.hash==="#lineBinding"||new URLSearchParams(location.search).has("line_link")||new URLSearchParams(location.search).has("line_error"));
if(legacyLineEntry)location.replace("/line-account.html"+location.search+"#lineBinding");
const $=id=>document.getElementById(id);
const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"})[char]);
const money=value=>Number.isSafeInteger(Number(value))?`NT$ ${Number(value).toLocaleString("zh-TW")}`:"待確認";
const dateTime=value=>value?new Date(value).toLocaleString("zh-TW",{timeZone:"Asia/Taipei"}):"—";
const projectLabels={TEAM_T:"團 T",YEAR_END_DINNER:"期末聚餐"},projectStatuses={DRAFT:"草稿",OPEN:"開放繳費",CLOSED:"已結束"},paymentStatuses={ADJUSTMENT_REQUIRED:"待補差額，流程暫停",SUPPLEMENT_REPORTED:"已補款，待核帳",REFUND_REQUESTED:"待財務退款",REFUNDED:"已退款作廢",AWAITING_TRANSFER:"待匯款",REPORTED_UNVERIFIED:"已回報，待核帳",VERIFIED:"已確認入帳",NOT_REQUIRED:"無須繳費",SOURCE_MISSING:"來源資料遺失"};
const state={me:null,projects:[],templates:[],activities:[],line:null,busy:false};

function headers(){
  const token=sessionStorage.getItem("google_id_token")||"",school=sessionStorage.getItem("school_context_id")||"",role=sessionStorage.getItem("role_context")||"";
  return {"Content-Type":"application/json",...(token&&token!=="cookie-session"?{"X-Google-ID-Token":token}:{}),...(school?{"X-School-Id":school}:{}),...(role?{"X-Role-Context":role}:{})};
}
async function api(path,options={}){
  const response=await fetch(`/api/${path}`,{...options,credentials:"same-origin",cache:"no-store",headers:{...headers(),...(options.headers||{})}}),data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||`HTTP ${response.status}`);return data;
}
function showStatus(message,type=""){$("status").textContent=message;$("status").hidden=!message;$('status').className=`notice ${type}`.trim()}
function statusClass(status){return status==="REPORTED_UNVERIFIED"?"reported":status==="VERIFIED"?"":"closed"}

let lineAccountPanel,accountEntryVersion=0;
function accountEntryScope(){return ['school_context_id','role_context','google_id_token'].map(key=>sessionStorage.getItem(key)||'').join('|')}
async function loadLineBinding(params){
  if(!accountOnly)return null;
  lineAccountPanel?.destroy();
  lineAccountPanel=createLineAccountPanel({host:$("lineBinding"),api:(path,options)=>api(path.replace(/^\/api\//,""),options),me:state.me});
  return lineAccountPanel.load(params);
}

function renderAdminCreate(){
  if(state.me?.role!=="admin"){$("adminCreate").innerHTML="";return}
  const accounts=state.templates.filter(item=>item.active===true),activities=state.activities;
  $("adminCreate").innerHTML=`<div class="card"><h2>＋ 建立收費專案</h2><div class="steps"><span>1 建立草稿</span><span>2 同步收費對象</span><span>3 財務開放繳費</span></div><form id="projectForm"><div class="row"><div><label>專案類型</label><select name="kind" id="projectKind"><option value="TEAM_T">團 T</option><option value="YEAR_END_DINNER">期末聚餐</option></select></div><div><label>專案名稱</label><input name="title" maxlength="100" placeholder="例如：115 學年度第二次團 T 加購" required></div></div><div class="row"><div><label>繳費期限</label><input name="dueDate" type="date" required></div><div><label>收款帳戶</label><select name="accountTemplateId" required><option value="">請選擇</option>${accounts.map(item=>`<option value="${esc(item.id)}">${esc(item.label)}｜${esc(item.bankName)} ${esc(item.accountNumber.slice(-4))}</option>`).join("")}</select></div></div><div id="activityField" class="hidden"><label>對應期末聚餐活動</label><select name="activityId"><option value="">請選擇活動</option>${activities.map(item=>`<option value="${esc(item.activityId)}">${esc(item.title)}</option>`).join("")}</select></div><label>家長繳費說明</label><textarea name="instructions" maxlength="1000" placeholder="例如：請於期限內完成匯款，並回填帳號末五碼。"></textarea><div class="actions"><button type="submit" ${accounts.length?"":"disabled"}>建立草稿</button></div>${accounts.length?"":`<div class="notice warn">目前沒有啟用中的收款帳戶，請先至「團服與活動 → 匯款帳戶」建立。</div>`}</form></div>`;
  const kind=$("projectKind"),toggle=()=>{$("activityField").classList.toggle("hidden",kind.value!=="YEAR_END_DINNER")};kind.addEventListener("change",toggle);toggle();
  $("projectForm").addEventListener("submit",createProject);
}

function bankHtml(project){
  const bank=project.bankAccount;if(!bank)return `<div class="notice muted">專案尚未開放，收款帳戶不顯示。</div>`;
  return `<div class="bank"><b>收款帳戶</b><br>${esc(bank.bankName)}（${esc(bank.bankCode)}）｜戶名 ${esc(bank.accountHolder)}<br>帳號：<b>${esc(bank.accountNumber)}</b></div>`;
}

function parentCharge(project,charge){
  const status=paymentStatuses[charge.paymentStatus]||charge.paymentStatus,correction=charge.correctionReason?`<div class="notice warn"><b>需重新回報：</b>${esc(charge.correctionReason)}</div>`:"";
  let action="";
  if(charge.canReport)action=`<form class="transfer-form" data-project="${esc(project.id)}" data-charge="${esc(charge.id)}" data-amount="${esc(charge.amount)}"><div class="row"><div><label>匯款日期</label><input name="transferDate" type="date" required></div><div><label>匯出帳號末五碼</label><input name="lastFive" inputmode="numeric" pattern="[0-9]{5}" maxlength="5" placeholder="12345" required></div></div><label>本次應繳金額</label><input value="${esc(money(charge.amount))}" readonly><div class="actions"><button type="submit">確認已匯款並送出</button></div></form>`;
  if(charge.paymentStatus==="REPORTED_UNVERIFIED")action=`<div class="notice warn">已於 ${esc(dateTime(charge.transferReport?.reportedAt))} 回報 ${esc(money(charge.transferReport?.amount))}，末五碼 ${esc(charge.transferReport?.lastFive||"—")}。請勿重複匯款。</div>`;
  if(charge.paymentStatus==="VERIFIED")action=`<div class="notice">✅ 財務已於 ${esc(dateTime(charge.verifiedAt))} 完成核帳。</div>`;
  return `<div class="charge"><div class="charge-head"><strong>${charge.studentIds?.length?`學生 ${esc(charge.studentIds.join("、"))}`:`學生 ${esc(charge.studentId||"—")}`}</strong><span class="status ${statusClass(charge.paymentStatus)}">${esc(status)}</span></div><p>應繳：<b>${esc(money(charge.amount))}</b></p>${correction}${action}</div>`;
}

function parentProject(project){
  return `<article class="card project" data-status="${esc(project.status)}"><div class="charge-head"><div><h2>${esc(project.title)}</h2><span class="muted">${esc(projectLabels[project.kind]||project.kind)}｜期限 ${esc(project.dueDate)}</span></div><span class="status ${project.status==="CLOSED"?"closed":""}">${esc(projectStatuses[project.status]||project.status)}</span></div>${project.instructions?`<div class="notice">${esc(project.instructions)}</div>`:""}${bankHtml(project)}<h3>我的應繳項目</h3>${project.charges.map(charge=>parentCharge(project,charge)).join("")}</article>`;
}

function financeCharge(project,charge){
  const status=paymentStatuses[charge.paymentStatus]||charge.paymentStatus,report=charge.transferReport||{};
  const retry=charge.canRetryNotice?`<button class="secondary" data-action="retry-notice" data-project="${esc(project.id)}" data-charge="${esc(charge.id)}">重試 LINE 通知</button>`:"";
  const details=charge.paymentStatus==="REPORTED_UNVERIFIED"?`<div class="notice warn">回報 ${esc(money(report.amount))}｜匯款日 ${esc(report.transferDate||"—")}｜帳號末五碼 <b>${esc(report.lastFive||"—")}</b>｜回報時間 ${esc(dateTime(report.reportedAt))}</div>`:"";
  const forms=charge.paymentStatus==="REPORTED_UNVERIFIED"&&state.me.capabilities?.financeVerifier===true?`<div class="row"><form class="verify-form" data-project="${esc(project.id)}" data-charge="${esc(charge.id)}" data-amount="${esc(charge.amount)}"><label>銀行實際入帳日</label><input name="bankPostedAt" type="date" required><label>核帳備註</label><textarea name="note" maxlength="300" required placeholder="例如：已核對銀行入帳明細"></textarea><button type="submit">確認已入帳</button></form><form class="correction-form" data-project="${esc(project.id)}" data-charge="${esc(charge.id)}"><label>要求補正原因</label><textarea name="reason" maxlength="300" required placeholder="例如：查無此金額，請重新確認日期與末五碼"></textarea><button type="submit" class="warn-action">退回家長補正</button></form></div>`:"";
  return `<div class="charge" data-resolution-source="${esc(charge.sourceId)}"><div class="charge-head"><strong>${esc(charge.parentEmail||"家長帳號待確認")}<br><span class="muted">${esc(charge.studentIds?.join("、")||charge.studentId||"—")}</span></strong><span class="status ${statusClass(charge.paymentStatus)}">${esc(status)}</span></div><p>應繳：<b>${esc(money(charge.amount))}</b>｜來源：${charge.sourceType==="uniform"?"團 T":"期末聚餐"}</p>${details}${forms}${retry}</div>`;
}

function adminProject(project){
  const s=project.summary||{},finance=state.me.capabilities?.financeVerifier===true;
  const buttons=[`<button class="secondary" data-action="sync" data-id="${esc(project.id)}">同步收費對象</button>`];
  if(project.status==="DRAFT")buttons.push(`<button data-action="open" data-id="${esc(project.id)}" ${finance?"":"disabled"}>開放繳費</button>`);
  if(project.status==="OPEN")buttons.push(`<button class="warn-action" data-action="close" data-id="${esc(project.id)}" ${finance?"":"disabled"}>結束專案</button>`);
  if(project.status==="CLOSED")buttons.push(`<button data-action="reopen" data-id="${esc(project.id)}" ${finance?"":"disabled"}>重新開放</button>`);
  return `<article class="card project" data-status="${esc(project.status)}"><div class="charge-head"><div><h2>${esc(project.title)}</h2><span class="muted">${esc(projectLabels[project.kind]||project.kind)}｜期限 ${esc(project.dueDate)}</span></div><span class="status ${project.status==="CLOSED"?"closed":""}">${esc(projectStatuses[project.status]||project.status)}</span></div><div class="grid"><div class="metric"><b>${s.total||0}</b><span>收費對象</span></div><div class="metric"><b>${s.awaiting||0}</b><span>待匯款</span></div><div class="metric"><b>${s.reported||0}</b><span>待核帳</span></div><div class="metric"><b>${s.verified||0}</b><span>已核帳</span></div></div><p>應收 ${esc(money(s.amount||0))}｜已確認 ${esc(money(s.verifiedAmount||0))}</p>${s.missingSource?`<div class="notice error">有 ${s.missingSource} 筆原始資料遺失，請先檢查。</div>`:""}${bankHtml(project)}<div class="actions">${buttons.join("")}</div><details ${s.reported?"open":""}><summary><b>查看 ${project.charges.length} 筆明細</b></summary>${project.charges.length?project.charges.map(charge=>financeCharge(project,charge)).join(""):`<div class="notice">尚無收費對象，請按「同步收費對象」。</div>`}</details></article>`;
}

function renderProjects(){
  renderPaymentResolutionTasks();
  if(!state.projects.length){$("projects").innerHTML=`<div class="card"><h2>${state.me?.role==="admin"?"目前沒有收費專案":"目前沒有需要處理的費用"}</h2><p class="muted">${state.me?.role==="admin"?"請先建立草稿，再同步團 T 或期末聚餐的既有資料。":"目前沒有需要您繳費或回報的項目；仍可先完成 LINE 通知綁定，方便日後接收弦樂團的重要資訊。"}</p></div>`;return}
  $("projects").innerHTML=`<h2>${state.me?.role==="admin"?"收費專案與核帳":"家庭費用資訊"}</h2>${state.projects.map(project=>state.me.role==="admin"?adminProject(project):parentProject(project)).join("")}`;
  document.querySelectorAll(".transfer-form").forEach(form=>form.addEventListener("submit",reportTransfer));
  document.querySelectorAll(".verify-form").forEach(form=>form.addEventListener("submit",verifyTransfer));
  document.querySelectorAll(".correction-form").forEach(form=>form.addEventListener("submit",requestCorrection));
  if(window.paymentResolutionUI.enabled()&&state.me.capabilities?.financeVerifier)for(const project of state.projects)for(const charge of project.charges||[]){if(charge.paymentStatus!=="REPORTED_UNVERIFIED")continue;const host=[...document.querySelectorAll("[data-resolution-source]")].find(el=>el.dataset.resolutionSource===charge.sourceId);if(host)window.paymentResolutionUI.financeControls(host,{...charge,id:charge.sourceId},charge.sourceType,api,loadProjects)}
}


async function renderPaymentResolutionTasks(){
 if(accountOnly||!window.paymentResolutionUI.enabled())return;
 let host=document.getElementById("paymentResolutionTasks");if(!host){host=document.createElement("section");host.id="paymentResolutionTasks";host.className="card";$("projects").before(host)}
 if(state.me.role==="parent")return window.paymentResolutionUI.loadParent(host,api,loadProjects);
 if(state.me.capabilities?.financeVerifier!==true){host.hidden=true;return}
 try{const {items=[]}=await api("uniform-events/payment-resolution");host.replaceChildren();host.hidden=!items.length;if(!items.length)return;const title=document.createElement("h2");title.textContent="補款與退費";host.append(title);for(const item of items){const card=document.createElement("section"),label=document.createElement("h3");label.textContent=(item.title||"款項處理")+"｜"+item.parentEmail;card.append(label);window.paymentResolutionUI.financeControls(card,item,item.sourceType,api,loadProjects);host.append(card)}}catch(error){host.textContent="補款與退費進度無法讀取："+error.message}
}

async function createProject(event){
  event.preventDefault();const form=event.currentTarget,body=Object.fromEntries(new FormData(form).entries());
  if(body.kind!=="YEAR_END_DINNER")delete body.activityId;
  if(!confirm(`建立「${body.title}」收費專案草稿？建立後請同步收費對象，再由財務人員開放。`))return;
  try{showStatus("正在建立收費專案…");await api("fee-collections/projects",{method:"POST",body:JSON.stringify(body)});form.reset();await loadProjects();showStatus("收費專案草稿已建立。") }catch(error){showStatus(error.message,"error")}
}

async function mutateProject(id,action){
  const messages={SYNC_SOURCE:"同步既有團 T／聚餐資料",OPEN:"開放家長查看帳戶並回報匯款",CLOSE:"結束本次收費",REOPEN:"重新開放本次收費"};
  if(!confirm(`確定要${messages[action]}？`))return;
  try{showStatus("處理中…");const result=await api("fee-collections/projects",{method:"PATCH",body:JSON.stringify({id,action})});await loadProjects();showStatus(action==="SYNC_SOURCE"?`同步完成：${result.sync?.synced||0} 筆。`:"專案狀態已更新。") }catch(error){showStatus(error.message,"error")}
}

async function reportTransfer(event){
  event.preventDefault();const form=event.currentTarget,values=new FormData(form),amount=Number(form.dataset.amount);
  if(!confirm(`確認已匯款 ${money(amount)}，並送出資料供財務核帳？`))return;
  try{showStatus("正在送出匯款回報…");await api("fee-collections/transfers",{method:"POST",body:JSON.stringify({projectId:form.dataset.project,chargeId:form.dataset.charge,amount,lastFive:values.get("lastFive"),transferDate:values.get("transferDate")})});await loadProjects();showStatus("已收到匯款回報，請等待財務核帳。") }catch(error){showStatus(error.message,"error")}
}

async function verifyTransfer(event){
  event.preventDefault();const form=event.currentTarget,values=new FormData(form),amount=Number(form.dataset.amount);
  if(!confirm("已逐一比對銀行實際入帳日期、金額與末五碼，確認入帳？"))return;
  try{showStatus("正在完成核帳…");const {lineNotification}=await api("fee-collections/transfers",{method:"PATCH",body:JSON.stringify({projectId:form.dataset.project,chargeId:form.dataset.charge,action:"VERIFY",amount,bankPostedAt:values.get("bankPostedAt"),note:values.get("note")})});await loadProjects();
    const labels={accepted:"LINE 已受理家長通知。",email_sent:"LINE 未受理，備援 Email 已受理。",mixed_sent:"通知已分別由 LINE 與備援 Email 受理。",email_not_configured:"LINE 未受理，Email 寄信服務尚未設定。",email_missing:"LINE 未受理，家長尚無可收信的 Email。",not_bound:"家長尚無此校 LINE 綁定，請家長至平台查看。",disabled:"此校尚未開啟家長入帳 LINE 通知。"};
    showStatus("已確認入帳。"+(labels[lineNotification?.status]||"家長 LINE 通知尚未確認送出。")) }catch(error){showStatus(error.message,"error")}
}

async function requestCorrection(event){
  event.preventDefault();const form=event.currentTarget,reason=new FormData(form).get("reason");
  if(!confirm("確定退回家長補正？原匯款回報會保留於稽核歷程。"))return;
  try{showStatus("正在退回補正…");await api("fee-collections/transfers",{method:"PATCH",body:JSON.stringify({projectId:form.dataset.project,chargeId:form.dataset.charge,action:"REQUEST_CORRECTION",reason})});await loadProjects();showStatus("已退回補正。") }catch(error){showStatus(error.message,"error")}
}

async function loadProjects(){const data=await api("fee-collections/projects");state.projects=data.items||[];state.activities=data.dinnerActivities||state.activities;renderProjects()}
async function load(){
  const version=accountOnly?++accountEntryVersion:0,scope=accountOnly?accountEntryScope():'';
  const current=()=>!accountOnly||version===accountEntryVersion&&scope===accountEntryScope();
  try{
    const me=await api("me");if(!current())return;state.me=me;
    if(!["admin","parent","unassigned","teacher","sectionTeacher","ensembleTeacher","comprehensiveTeacher","privateTeacher"].includes(state.me.role))throw new Error("請切換至此校已授權的身分。");
    $("siteName").textContent=state.me.systemName||state.me.schoolName||"學校平台";
    $("roleTitle").textContent=accountOnly?"LINE 通知設定":state.me.role==="admin"?"收費專案與匯款核帳":"繳費與核帳紀錄";
    $("roleIntro").textContent=state.me.schoolName||"";
    const billing=!accountOnly&&state.me.capabilities?.feeCollections===true&&state.me.role!=="unassigned";
    const [templates,projects]=await Promise.all([
      billing&&state.me.role==="admin"?api("uniform-events/payment-account-templates"):null,
      billing?api("fee-collections/projects"):null
    ]);
    if(!current())return;
    state.templates=templates?.items||[];state.projects=projects?.items||[];
    state.activities=projects?.dinnerActivities||[];
    if(accountOnly){
      const line=await loadLineBinding(new URLSearchParams(location.search));
      if(!current())return;state.line=line;
    }
    if(!current())return;
    if(billing){renderAdminCreate();renderProjects()}
    else if($("projects"))$("projects").textContent="";
    const params=new URLSearchParams(location.search);
    const lineError=params.get("line_error");
    const message=lineError==="conflict"?"這個 Gmail 或 LINE 已有其他綁定，請聯絡學校管理員核對。":lineError?"LINE 授權未完成，請從本頁重新授權。":"";
    if(accountOnly)showStatus("");else showStatus(message||(params.get("line_link")==="confirm"?(state.line?.pendingLink?"請核對 Gmail 與 LINE 名稱，再確認綁定。":"綁定確認已逾時，請重新開始。"):billing?`已載入 ${state.projects.length} 個收費專案。`:""),message?"error":"");
    if(params.has("line_link")||lineError)history.replaceState({},"",location.pathname);
  }catch(error){if(current()){showStatus(error.message,"error");if($("projects"))$("projects").innerHTML=""}}
}

document.addEventListener("click",async event=>{
  const target=event.target.closest("[data-action]");if(!target)return;const action=target.dataset.action;
  if(action==="sync")return mutateProject(target.dataset.id,"SYNC_SOURCE");
  if(action==="open")return mutateProject(target.dataset.id,"OPEN");
  if(action==="close")return mutateProject(target.dataset.id,"CLOSE");
  if(action==="reopen")return mutateProject(target.dataset.id,"REOPEN");
  target.disabled=true;
  try{
    if(action==="retry-notice"){
      const {lineNotification}=await api("fee-collections/transfers",{method:"PATCH",body:JSON.stringify({
        projectId:target.dataset.project,chargeId:target.dataset.charge,action:"RETRY_LINE_NOTICE"
      })});
      const labels={accepted:"LINE 已受理通知。",email_sent:"LINE 未受理，備援 Email 已受理。",mixed_sent:"通知已分別由 LINE 與備援 Email 受理。",email_not_configured:"LINE 未受理，Email 寄信服務尚未設定。",email_missing:"LINE 未受理，家長尚無可收信的 Email。",pending:"尚未確認 LINE 受理，可稍後重試。",not_bound:"家長尚未綁定此校 LINE。",
        disabled:"此校未啟用 LINE 收費通知。",target_changed:"家長已變更綁定，原通知無法重送。",ineligible:"通知已超過重試期限。"};
      showStatus(labels[lineNotification?.status]||"無法送出通知。");
    }
  }catch(error){showStatus(error.message,"error")}
  finally{target.disabled=false}

});

if(accountOnly){
 window.addEventListener?.('pagehide',()=>{accountEntryVersion++;lineAccountPanel?.destroy();lineAccountPanel=null;state.line=null});
 window.addEventListener?.('pageshow',event=>{if(event.persisted)void load()});
}
if(!legacyLineEntry)load();
