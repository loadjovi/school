const $=id=>document.getElementById(id);
const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"})[char]);
const money=value=>Number.isSafeInteger(Number(value))?`NT$ ${Number(value).toLocaleString("zh-TW")}`:"待確認";
const dateTime=value=>value?new Date(value).toLocaleString("zh-TW",{timeZone:"Asia/Taipei"}):"—";
const projectLabels={TEAM_T:"團 T",YEAR_END_DINNER:"期末聚餐"},projectStatuses={DRAFT:"草稿",OPEN:"開放繳費",CLOSED:"已結束"},paymentStatuses={AWAITING_TRANSFER:"待匯款",REPORTED_UNVERIFIED:"已回報，待核帳",VERIFIED:"已確認入帳",NOT_REQUIRED:"無須繳費",SOURCE_MISSING:"來源資料遺失"};
const state={me:null,projects:[],templates:[],activities:[],line:null,bindingCode:"",busy:false};

function headers(){
  const token=sessionStorage.getItem("google_id_token")||"",school=sessionStorage.getItem("school_context_id")||"",role=sessionStorage.getItem("role_context")||"";
  return {"Content-Type":"application/json",...(token&&token!=="cookie-session"?{"X-Google-ID-Token":token}:{}),...(school?{"X-School-Id":school}:{}),...(role?{"X-Role-Context":role}:{})};
}
async function api(path,options={}){
  const response=await fetch(`/api/${path}`,{...options,credentials:"same-origin",cache:"no-store",headers:{...headers(),...(options.headers||{})}}),data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||`HTTP ${response.status}`);return data;
}
function showStatus(message,type=""){$("status").textContent=message;$('status').className=`notice ${type}`.trim()}
function statusClass(status){return status==="REPORTED_UNVERIFIED"?"reported":status==="VERIFIED"?"":"closed"}

function renderLineBinding(){
  if(state.me?.role!=="parent"){$("lineBinding").innerHTML="";return}
  const line=state.line||{},configured=line.configured===true,bound=line.bound===true;
  if(bound){
    $("lineBinding").innerHTML=`<div class="card"><h2>🔔 LINE 個人通知已開啟</h2><div class="notice"><b>✅ ${esc(line.lineDisplayName||"已完成綁定")}</b><br><span class="muted">綁定時間：${esc(dateTime(line.boundAt))}</span></div><p>您已完成 LINE 通知身分綁定。本階段可接收團 T、期末餐費與匯款核帳結果；後續將逐步整合弦樂團課程、活動及其他重要提醒。個人資訊只會私訊本人，不會公開在群組。</p><div class="actions"><button class="secondary" data-action="unbind-line">關閉 LINE 個人通知</button></div></div>`;return;
  }
  const code=state.bindingCode?`<div class="notice"><p>請於 15 分鐘內，在 LINE 官方帳號的<b>一對一聊天室</b>輸入：</p><div class="code">${esc(state.bindingCode)}</div><p style="text-align:center"><code>#綁定帳號 ${esc(state.bindingCode)}</code></p><div class="actions"><button class="secondary" data-action="copy-code">複製綁定指令</button>${line.officialAccountUrl?`<a class="button" target="_blank" rel="noopener" href="${esc(line.officialAccountUrl)}">開啟 LINE 官方帳號</a>`:""}</div></div>`:"";
  $("lineBinding").innerHTML=`<div class="card"><h2>🔔 開啟 LINE 個人通知</h2><div class="steps"><span>1 登入平台</span><span>2 取得一次性碼</span><span>3 私訊官方帳號</span></div><p>完成綁定後，系統可透過 LINE 私訊提供弦樂團課程、活動與重要提醒。本階段先提供團 T、期末餐費及匯款核帳通知，後續再逐步擴充。綁定碼不可貼到群組，也不要轉傳給他人。</p>${configured?`<button data-action="create-line-code">${state.bindingCode?"重新產生綁定碼":"開始綁定 LINE 通知"}</button>${code}`:`<div class="notice warn">LINE 通知服務尚未完成設定，請聯絡系統管理員。</div>`}</div>`;
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
  const details=charge.paymentStatus==="REPORTED_UNVERIFIED"?`<div class="notice warn">回報 ${esc(money(report.amount))}｜匯款日 ${esc(report.transferDate||"—")}｜帳號末五碼 <b>${esc(report.lastFive||"—")}</b>｜回報時間 ${esc(dateTime(report.reportedAt))}</div>`:"";
  const forms=charge.paymentStatus==="REPORTED_UNVERIFIED"&&state.me.capabilities?.financeVerifier===true?`<div class="row"><form class="verify-form" data-project="${esc(project.id)}" data-charge="${esc(charge.id)}" data-amount="${esc(charge.amount)}"><label>銀行實際入帳日</label><input name="bankPostedAt" type="date" required><label>核帳備註</label><textarea name="note" maxlength="300" required placeholder="例如：已核對銀行入帳明細"></textarea><button type="submit">確認已入帳</button></form><form class="correction-form" data-project="${esc(project.id)}" data-charge="${esc(charge.id)}"><label>要求補正原因</label><textarea name="reason" maxlength="300" required placeholder="例如：查無此金額，請重新確認日期與末五碼"></textarea><button type="submit" class="warn-action">退回家長補正</button></form></div>`:"";
  return `<div class="charge"><div class="charge-head"><strong>${esc(charge.parentEmail||"家長帳號待確認")}<br><span class="muted">${esc(charge.studentIds?.join("、")||charge.studentId||"—")}</span></strong><span class="status ${statusClass(charge.paymentStatus)}">${esc(status)}</span></div><p>應繳：<b>${esc(money(charge.amount))}</b>｜來源：${charge.sourceType==="uniform"?"團 T":"期末聚餐"}</p>${details}${forms}</div>`;
}

function adminProject(project){
  const s=project.summary||{},finance=state.me.capabilities?.financeVerifier===true;
  const buttons=[`<button class="secondary" data-action="sync" data-id="${esc(project.id)}">同步收費對象</button>`];
  if(project.status==="DRAFT")buttons.push(`<button data-action="open" data-id="${esc(project.id)}" ${finance?"":"disabled"}>開放繳費</button>`);
  if(project.status==="OPEN")buttons.push(`<button class="warn-action" data-action="close" data-id="${esc(project.id)}">結束專案</button>`);
  if(project.status==="CLOSED")buttons.push(`<button data-action="reopen" data-id="${esc(project.id)}" ${finance?"":"disabled"}>重新開放</button>`);
  return `<article class="card project" data-status="${esc(project.status)}"><div class="charge-head"><div><h2>${esc(project.title)}</h2><span class="muted">${esc(projectLabels[project.kind]||project.kind)}｜期限 ${esc(project.dueDate)}</span></div><span class="status ${project.status==="CLOSED"?"closed":""}">${esc(projectStatuses[project.status]||project.status)}</span></div><div class="grid"><div class="metric"><b>${s.total||0}</b><span>收費對象</span></div><div class="metric"><b>${s.awaiting||0}</b><span>待匯款</span></div><div class="metric"><b>${s.reported||0}</b><span>待核帳</span></div><div class="metric"><b>${s.verified||0}</b><span>已核帳</span></div></div><p>應收 ${esc(money(s.amount||0))}｜已確認 ${esc(money(s.verifiedAmount||0))}</p>${s.missingSource?`<div class="notice error">有 ${s.missingSource} 筆原始資料遺失，請先檢查。</div>`:""}${bankHtml(project)}<div class="actions">${buttons.join("")}</div><details ${s.reported?"open":""}><summary><b>查看 ${project.charges.length} 筆明細</b></summary>${project.charges.length?project.charges.map(charge=>financeCharge(project,charge)).join(""):`<div class="notice">尚無收費對象，請按「同步收費對象」。</div>`}</details></article>`;
}

function renderProjects(){
  if(!state.projects.length){$("projects").innerHTML=`<div class="card"><h2>${state.me?.role==="admin"?"目前沒有收費專案":"目前沒有需要處理的費用"}</h2><p class="muted">${state.me?.role==="admin"?"請先建立草稿，再同步團 T 或期末聚餐的既有資料。":"目前沒有需要您繳費或回報的項目；仍可先完成 LINE 通知綁定，方便日後接收弦樂團的重要資訊。"}</p></div>`;return}
  $("projects").innerHTML=`<h2>${state.me?.role==="admin"?"收費專案與核帳":"家庭費用資訊"}</h2>${state.projects.map(project=>state.me.role==="admin"?adminProject(project):parentProject(project)).join("")}`;
  document.querySelectorAll(".transfer-form").forEach(form=>form.addEventListener("submit",reportTransfer));
  document.querySelectorAll(".verify-form").forEach(form=>form.addEventListener("submit",verifyTransfer));
  document.querySelectorAll(".correction-form").forEach(form=>form.addEventListener("submit",requestCorrection));
}

async function createProject(event){
  event.preventDefault();const form=new FormData(event.currentTarget),body=Object.fromEntries(form.entries());
  if(body.kind!=="YEAR_END_DINNER")delete body.activityId;
  if(!confirm(`建立「${body.title}」收費專案草稿？建立後請同步收費對象，再由財務人員開放。`))return;
  try{showStatus("正在建立收費專案…");await api("fee-collections/projects",{method:"POST",body:JSON.stringify(body)});event.currentTarget.reset();await loadProjects();showStatus("收費專案草稿已建立。") }catch(error){showStatus(error.message,"error")}
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
  try{showStatus("正在完成核帳…");await api("fee-collections/transfers",{method:"PATCH",body:JSON.stringify({projectId:form.dataset.project,chargeId:form.dataset.charge,action:"VERIFY",amount,bankPostedAt:values.get("bankPostedAt"),note:values.get("note")})});await loadProjects();showStatus("核帳完成，原團 T／聚餐紀錄已同步更新。") }catch(error){showStatus(error.message,"error")}
}

async function requestCorrection(event){
  event.preventDefault();const form=event.currentTarget,reason=new FormData(form).get("reason");
  if(!confirm("確定退回家長補正？原匯款回報會保留於稽核歷程。"))return;
  try{showStatus("正在退回補正…");await api("fee-collections/transfers",{method:"PATCH",body:JSON.stringify({projectId:form.dataset.project,chargeId:form.dataset.charge,action:"REQUEST_CORRECTION",reason})});await loadProjects();showStatus("已退回補正；若家長已綁定 LINE，系統會私訊通知。") }catch(error){showStatus(error.message,"error")}
}

async function loadProjects(){const data=await api("fee-collections/projects");state.projects=data.items||[];state.activities=data.dinnerActivities||state.activities;renderProjects()}
async function load(){
  try{
    state.me=await api("me");if(!["admin","parent"].includes(state.me.role))throw new Error("請切換至家長或學校管理員身分。");
    $("roleTitle").textContent=state.me.role==="admin"?"收費專案與匯款核帳":"LINE 通知與家長服務";
    $("roleIntro").textContent=state.me.role==="admin"?"建立團 T／期末聚餐收費專案，同步既有需求並由指定財務人員核帳。":"先完成個人 LINE 通知綁定，方便後續整合弦樂團課程、活動與重要提醒；本階段也可查看本人家庭的團 T、期末餐費與匯款核帳進度。";
    if(state.me.role==="admin"){
      const [templates,projects]=await Promise.all([api("uniform-events/payment-account-templates"),api("fee-collections/projects")]);state.templates=templates.items||[];state.projects=projects.items||[];state.activities=projects.dinnerActivities||[];
    }else{
      const [line,projects]=await Promise.all([api("line/account-binding"),api("fee-collections/projects")]);state.line=line;state.projects=projects.items||[];
    }
    renderLineBinding();renderAdminCreate();renderProjects();showStatus(state.me.role==="admin"?`已載入 ${state.projects.length} 個收費專案。`:state.projects.length?`目前有 ${state.projects.length} 個與您家庭相關的費用項目。`:"目前沒有需要您處理的費用項目。");
  }catch(error){showStatus(error.message,"error");$("projects").innerHTML=""}
}

document.addEventListener("click",async event=>{
  const target=event.target.closest("[data-action]");if(!target)return;const action=target.dataset.action;
  if(action==="sync")return mutateProject(target.dataset.id,"SYNC_SOURCE");
  if(action==="open")return mutateProject(target.dataset.id,"OPEN");
  if(action==="close")return mutateProject(target.dataset.id,"CLOSE");
  if(action==="reopen")return mutateProject(target.dataset.id,"REOPEN");
  if(action==="create-line-code")try{showStatus("正在產生一次性綁定碼…");const result=await api("line/account-binding",{method:"POST",body:"{}"});state.bindingCode=result.bindingCode||"";state.line={...(state.line||{}),...result,configured:true};renderLineBinding();showStatus("綁定碼已產生，請在 15 分鐘內私訊 LINE 官方帳號。") }catch(error){showStatus(error.message,"error")}
  if(action==="copy-code"){const command=`#綁定帳號 ${state.bindingCode}`;try{await navigator.clipboard.writeText(command);showStatus("綁定指令已複製。") }catch{showStatus(`請手動複製：${command}`,"warn")}}
  if(action==="unbind-line"&&confirm("確定解除個人 LINE 綁定？之後將不再收到個人核帳通知。"))try{await api("line/account-binding",{method:"DELETE"});state.bindingCode="";state.line={...(state.line||{}),bound:false,lineDisplayName:"",boundAt:""};renderLineBinding();showStatus("已解除個人 LINE 綁定。") }catch(error){showStatus(error.message,"error")}
});

load();
