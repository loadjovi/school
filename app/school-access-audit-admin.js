(()=>{
  if(typeof state==="undefined")return;
  state.schoolAccessAudit=state.schoolAccessAudit||{loaded:false,loading:false,stats:[],error:""};
  const fmt=v=>{if(!v)return "尚無紀錄";try{return new Intl.DateTimeFormat("zh-TW",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(v))}catch{return v}};
  async function loadAudit(force=false){
    if(state.me?.role!=="admin"||state.schoolAccessAudit.loading)return;
    if(state.schoolAccessAudit.loaded&&!force)return;
    state.schoolAccessAudit.loading=true;state.schoolAccessAudit.error="";
    try{const d=await api("/api/school-access");state.schoolAccessAudit.stats=d.accessStats||[];state.schoolAccessAudit.loaded=true}catch(e){state.schoolAccessAudit.error=e.message||String(e)}
    state.schoolAccessAudit.loading=false;mountAudit();
  }
  function rows(){const a=state.schoolAccessAudit.stats||[];if(!a.length)return `<div class="notice">尚未設定校方查詢 Gmail，或目前尚無使用紀錄。</div>`;return a.map(x=>`<div class="item" style="display:block"><div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(x.email)}</b><span class="badge ${x.lastLoginAt?"ok":"warn"}">${x.lastLoginAt?"已使用":"未使用"}</span></div><small style="display:block;margin-top:6px">最近登入：<b>${esc(fmt(x.lastLoginAt))}</b><br>最近查看出缺勤：<b>${esc(fmt(x.lastAttendanceViewAt))}</b><br>${esc(x.month||"")} 登入：<b>${x.monthlyLoginCount||0} 次</b>｜查看出缺勤：<b>${x.monthlyAttendanceViewCount||0} 次</b></small>${(x.monthlyLogins||[]).length?`<details style="margin-top:8px"><summary>查看本月登入時間</summary><div class="notice" style="margin-top:6px">${x.monthlyLogins.map(t=>esc(fmt(t))).join("<br>")}</div></details>`:""}</div>`).join("")}
  function html(){const s=state.schoolAccessAudit;if(s.error)return `<div class="card"><h2>📊 校方系統使用月報</h2><div class="error">讀取失敗：${esc(s.error)}</div></div>`;if(s.loading&&!s.loaded)return `<div class="card"><h2>📊 校方系統使用月報</h2><div class="notice">正在讀取使用紀錄…</div></div>`;return `<div class="card"><div class="section-title"><h2>📊 校方系統使用月報</h2><button class="secondary" style="margin:0;width:auto" onclick="refreshSchoolAccessAudit()">重新整理</button></div><div class="notice">登入紀錄代表校方帳號成功進入系統；「查看出缺勤」代表該帳號實際讀取過出缺勤查詢資料，可用來區分只有登入與實際使用。</div>${rows()}</div>`}
  function mountAudit(){if(state.me?.role!=="admin"||state.page!=="admin")return;const host=document.getElementById("schoolAccessAdmin")||document.querySelector(".main");if(!host)return;let root=document.getElementById("schoolAccessAudit");if(!root){root=document.createElement("div");root.id="schoolAccessAudit";host.insertAdjacentElement("afterend",root)}root.innerHTML=html()}
  window.refreshSchoolAccessAudit=async()=>{state.schoolAccessAudit.loaded=false;await loadAudit(true)};
  const baseRender=render;render=function(){const r=baseRender();if(state.me?.role==="admin"&&state.page==="admin")setTimeout(()=>{mountAudit();loadAudit()},0);return r};
  if(state.me?.role==="admin")setTimeout(()=>loadAudit(),0);
})();
