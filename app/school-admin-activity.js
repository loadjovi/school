(()=>{
  if(typeof state==="undefined")return;
  const dateInTaipei=(offset=0)=>{const d=new Date(Date.now()+8*3600000+offset*86400000);return d.toISOString().slice(0,10)};
  const audit=state.schoolAdminActivity={from:dateInTaipei(-30),to:dateInTaipei(),items:[],loaded:false,loading:false,error:"",open:false,type:"all",query:"",truncated:false};
  const labels={admin_login:"登入學校後台",section_correction:"修正歷史分部課點名",student_master_create:"新增學生主檔",student_master_update:"修改學生主檔",schedule_exception:"異動上課日期",schedule_import:"匯入／更新課表",calendar_event_create:"新增活動",calendar_event_update:"修改活動",calendar_event_delete:"刪除活動"};
  const status={present:"出席",late:"遲到",leave:"請假",absent:"缺席"};
  const fmt=v=>{try{return new Intl.DateTimeFormat("zh-TW",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(v))}catch{return v||"—"}};
  async function markEntry(){
    if(state.me?.role!=="admin")return;
    const key=`school-admin-audit:${state.me.schoolId||""}:${state.me.email||""}`;
    try{if(sessionStorage.getItem(key))return;await api("/api/school-admin-activity",{method:"POST"});sessionStorage.setItem(key,"1")}
    catch(e){console.warn("admin entry audit failed",e?.message||e)}
  }
  async function load(){
    if(audit.loading||state.me?.role!=="admin")return;
    audit.loading=true;audit.error="";mount();
    try{const d=await api(`/api/school-admin-activity?from=${encodeURIComponent(audit.from)}&to=${encodeURIComponent(audit.to)}`);audit.items=d.items||[];audit.truncated=!!d.truncated;audit.loaded=true}
    catch(e){audit.error=e.message||String(e)}
    audit.loading=false;mount();
  }
  window.toggleSchoolAdminActivity=()=>{audit.open=!audit.open;mount();if(audit.open&&!audit.loaded)load()};
  window.searchSchoolAdminActivity=()=>{const from=document.getElementById("schoolAuditFrom")?.value,to=document.getElementById("schoolAuditTo")?.value;if(!from||!to||from>to){toast("請確認查詢日期");return}audit.from=from;audit.to=to;audit.loaded=false;load()};
  window.filterSchoolAdminActivity=()=>{audit.type=document.getElementById("schoolAuditType")?.value||"all";audit.query=document.getElementById("schoolAuditQuery")?.value.trim().toLowerCase()||"";mount()};
  function content(){
    const filter=audit.items.filter(x=>(audit.type==="all"||x.type===audit.type)&&(!audit.query||[x.actor,x.studentName,x.studentId,x.reason,x.title,x.courseName,x.eventDate,x.classDate,x.eventId].some(v=>String(v||"").toLowerCase().includes(audit.query))));
    const summary=x=>{if(x.type==="section_correction")return `上課日期：${x.classDate||"—"}｜${x.groupName||""}團 ${x.section||""}｜學生：${x.studentName||x.studentId||"—"}｜狀態：${status[x.fromStatus]||x.fromStatus||"—"} → ${status[x.toStatus]||x.toStatus||"—"}｜原因：${x.reason||"—"}`;if(x.type.startsWith("student_master"))return `學生：${x.studentName||"—"}（${x.studentId||"—"}）｜${x.reason||""}`;if(x.type==="schedule_exception")return `課程：${x.courseName||"—"}｜原上課日期：${x.classDate||"—"}｜調整至：${x.after?.newDate||"—"} ${x.after?.newStartTime||""}～${x.after?.newEndTime||""}｜原因：${x.after?.reason||"—"}`;if(x.type==="schedule_import")return `方式：${x.mode||"—"}｜${x.count||0} 筆課程`;if(x.type.startsWith("calendar_event"))return `活動：${x.title||"—"}｜日期：${x.eventDate||"—"}｜動作：${x.action||"—"}`;return ""};
    const rows=filter.map(x=>`<div class="item" style="display:block"><b>${esc(labels[x.type]||x.type)}</b><small>${esc(fmt(x.at))}｜操作人：${esc(x.actor||"—")}</small>${summary(x)?`<small>${esc(summary(x))}</small>`:""}${x.before||x.after?`<details><summary>查看異動前後</summary><small>異動前：${esc(JSON.stringify(x.before||null))}<br>異動後：${esc(JSON.stringify(x.after||null))}</small></details>`:""}</div>`).join("");
    return `<div class="notice">記錄學校管理員登入、點名修正、學生主檔、課表與活動異動。時間為台灣時間；舊修正紀錄也會從原始點名歷史載入。</div><div class="row2"><div><label>操作日期起</label><input id="schoolAuditFrom" type="date" value="${esc(audit.from)}"></div><div><label>操作日期迄</label><input id="schoolAuditTo" type="date" value="${esc(audit.to)}"></div></div><button class="secondary" onclick="searchSchoolAdminActivity()">查詢紀錄</button>${audit.error?`<div class="error">${esc(audit.error)}</div>`:audit.loading?`<div class="notice">正在讀取操作紀錄…</div>`:`<div><div class="row2"><div><label>紀錄類型</label><select id="schoolAuditType" onchange="filterSchoolAdminActivity()"><option value="all" ${audit.type==="all"?"selected":""}>全部</option><option value="admin_login" ${audit.type==="admin_login"?"selected":""}>後台登入</option><option value="section_correction" ${audit.type==="section_correction"?"selected":""}>點名修正</option>${Object.entries(labels).filter(([key])=>!["admin_login","section_correction"].includes(key)).map(([key,label])=>`<option value="${key}" ${audit.type===key?"selected":""}>${label}</option>`).join("")}</select></div><div><label>操作人／學生／活動／日期</label><input id="schoolAuditQuery" value="${esc(audit.query)}" placeholder="輸入關鍵字" onchange="filterSchoolAdminActivity()"></div></div><div class="notice">符合 ${filter.length} 筆${audit.truncated?"（最多顯示最近 500 筆，請縮短日期）":""}</div>${rows||`<div class="notice">此條件沒有紀錄。</div>`}</div>`}`;
  }
  function mount(){
    if(state.me?.role!=="admin"||state.page!=="admin")return;
    const host=document.getElementById("schoolAccessAudit")||document.querySelector(".main");if(!host)return;
    let root=document.getElementById("schoolAdminActivity");if(!root){root=document.createElement("div");root.id="schoolAdminActivity";host.insertAdjacentElement("afterend",root)}
    root.innerHTML=`<div class="card"><div class="section-title"><h2>🛡️ 學校後台操作紀錄</h2><button class="secondary" style="width:auto;margin:0" onclick="toggleSchoolAdminActivity()">${audit.open?"收合":"開啟查詢"}</button></div>${audit.open?content():"<small>查詢管理員登入、學生、課程及活動異動紀錄。</small>"}</div>`;
  }
  const baseRender=render;render=function(){const r=baseRender();if(state.me?.role==="admin"&&state.page==="admin")setTimeout(mount,0);return r};
  markEntry();if(state.me?.role==="admin"&&state.page==="admin")setTimeout(mount,0);
})();
