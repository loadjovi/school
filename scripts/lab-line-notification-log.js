// Generated into the isolated Functional UAT LAB frontend only.
const root=document.getElementById("labLineNotificationLog");
const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"})[char]);
const dateTime=value=>value?new Date(value).toLocaleString("zh-TW",{timeZone:"Asia/Taipei"}):"—";
const labels={CREATED:"已建立",SENDING:"發送中",ACCEPTED:"LINE API 已接受",FAILED:"發送失敗",UNKNOWN:"狀態未知"};

function headers(){
  const token=sessionStorage.getItem("google_id_token")||"",school=sessionStorage.getItem("school_context_id")||"",role=sessionStorage.getItem("role_context")||"";
  return {"Content-Type":"application/json",...(token&&token!=="cookie-session"?{"X-Google-ID-Token":token}:{}),...(school?{"X-School-Id":school}:{}),...(role?{"X-Role-Context":role}:{})};
}

async function api(path){
  const response=await fetch(`/api/${path}`,{credentials:"same-origin",cache:"no-store",headers:headers()});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||`HTTP ${response.status}`);
  return data;
}

function record(item){
  const status=labels[item.status]||item.status||"—";
  return `<details class="card project"><summary><b>${esc(status)}</b>｜${esc(dateTime(item.createdAt))}</summary>
    <div class="charge"><p><b>通知類型：</b>${esc(item.notificationType||"—")}<br>
    <b>家長：</b>${esc(item.recipientParent||"—")}｜<b>LINE：</b>${esc(item.lineUserIdMasked||"—")}<br>
    <b>來源：</b>${esc(item.source||"—")}｜<b>LAB：</b>${item.isLab===true?"是":"否"}<br>
    <b>LINE HTTP：</b>${esc(item.lineApiHttpStatus??"—")}｜<b>錯誤代碼：</b>${esc(item.errorCode||"—")}<br>
    <b>Request ID：</b><code>${esc(item.requestId||"—")}</code>${item.lineRequestId?`<br><b>LINE Request ID：</b><code>${esc(item.lineRequestId)}</code>`:""}<br>
    <b>最後更新：</b>${esc(dateTime(item.updatedAt))}</p></div>
  </details>`;
}

function render(data){
  const items=Array.isArray(data.items)?data.items:[];
  root.innerHTML=`<div class="card"><div class="charge-head"><div><h2>🧪 LAB LINE 發送紀錄</h2><p class="muted">僅顯示遮罩後的家長與 LINE 識別資料，最多 100 筆。</p></div><button type="button" class="secondary" data-lab-line-log-refresh>重新整理</button></div>
    <div class="notice warn">${esc(data.note||"LINE API 已接受不代表家長已讀或實際送達。")}</div>
    ${items.length?items.map(record).join(""):'<div class="notice">目前沒有 LAB LINE 發送紀錄。</div>'}</div>`;
  root.querySelector("[data-lab-line-log-refresh]")?.addEventListener("click",loadLog);
}

async function loadLog(){
  try{
    root.innerHTML='<div class="notice">正在讀取 LAB LINE 發送紀錄…</div>';
    render(await api("line/lab-notification-log"));
  }catch(error){root.innerHTML=`<div class="notice error">${esc(error.message)}</div>`}
}

async function start(){
  if(!root)return;
  try{
    const me=await api("me");
    if(me.role!=="admin"||me.capabilities?.tenantAdmin!==true){root.remove();return}
    await loadLog();
  }catch{root.remove()}
}

start();
