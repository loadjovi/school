(()=>{
  if(!document.getElementById("globalTenantStyles")){
    const style=document.createElement("style");style.id="globalTenantStyles";
    style.textContent=".global-manage-btn{border:0;border-radius:12px;padding:10px 14px;background:var(--green);color:#fff;font-weight:900;box-shadow:0 2px 6px rgba(0,0,0,.08)}.global-manage-btn:hover{filter:brightness(.95)}.global-danger-btn{border:1px solid var(--bad);border-radius:12px;padding:9px 11px;background:#fff7f7;color:var(--bad);font-weight:900}.global-danger-btn:hover{background:#fee2e2}.global-action-hint{display:block;font-size:11px;color:var(--muted);margin-top:4px}";
    document.head.appendChild(style);
  }
  state.globalTenant=state.globalTenant||{loaded:false,loading:false,dashboard:null,tenants:[],admins:[],selectedSchoolId:"",error:""};
  const canGlobal=()=>state.me?.role==="admin"&&state.me?.capabilities?.globalAdmin===true;
  const st={active:"🟢 啟用",setup:"🟡 建置中",inactive:"⚪ 停用"};

  async function loadAdmins(sid){
    state.globalTenant.selectedSchoolId=String(sid||"");
    if(!sid){state.globalTenant.admins=[];return}
    const d=await api("/api/tenant-admins?schoolId="+encodeURIComponent(sid));
    state.globalTenant.admins=d.items||[];
  }
  async function loadGlobal(force){
    if(!canGlobal()||state.globalTenant.loading)return;
    if(state.globalTenant.loaded&&!force)return;
    state.globalTenant.loading=true;state.globalTenant.error="";draw();
    try{
      const r=await Promise.all([api("/api/global-dashboard"),api("/api/tenant-directory")]);
      state.globalTenant.dashboard=r[0];state.globalTenant.tenants=r[1].items||[];state.globalTenant.loaded=true;
      if(!state.globalTenant.selectedSchoolId)state.globalTenant.selectedSchoolId=r[1].defaultSchoolId||state.globalTenant.tenants[0]?.schoolId||"";
      if(state.globalTenant.selectedSchoolId)await loadAdmins(state.globalTenant.selectedSchoolId);
    }catch(e){state.globalTenant.error=e.message||String(e)}
    state.globalTenant.loading=false;draw();
  }
  function schoolCard(x){
    const mode=x.dataMode==="legacy-default"?"既有聖心資料｜今日已有 "+Number(x.todayAttendanceRecords||0)+" 筆上課／點名紀錄":"Phase 2 前維持資料隔離建置，不會開放看到聖心既有資料。";
    return '<div class="card"><div class="student"><div><b style="font-size:17px">🏫 '+esc(x.schoolName)+'</b><div class="muted">'+esc(x.schoolId)+'｜'+esc(st[x.status]||x.status)+'</div></div><button class="global-manage-btn" style="margin:0" onclick="selectGlobalSchool(\''+esc(x.schoolId)+'\')">⚙️ 管理學校</button></div>'+
      '<div class="grid" style="margin-top:10px"><div class="kpi"><b>'+Number(x.studentCount||0)+'</b><span>學生</span></div><div class="kpi"><b>'+Number(x.teacherCount||0)+'</b><span>老師</span></div><div class="kpi"><b>'+Number(x.parentAccountCount||0)+'</b><span>家長帳號</span></div><div class="kpi"><b>'+Number(x.schoolAdminCount||0)+'</b><span>學校管理員</span></div></div><div class="notice" style="margin-top:10px"><small>'+esc(mode)+'</small></div></div>';
  }
  function adminBox(){
    const sid=state.globalTenant.selectedSchoolId,t=(state.globalTenant.tenants||[]).find(x=>String(x.schoolId)===String(sid));if(!sid||!t)return "";
    const rows=(state.globalTenant.admins||[]).filter(x=>x.status==="active");
    const list=rows.length?rows.map(x=>'<div class="item"><div><b>'+esc(x.email)+'</b><small>School Admin<span class="global-action-hint">移除權限不會刪除帳號或學校資料</span></small></div><button class="global-danger-btn" style="margin:0" onclick="revokeSchoolAdmin(\''+esc(sid)+'\',\''+esc(x.email)+'\')">🗑️ 移除權限</button></div>').join(""):'<div class="notice" style="margin-top:10px">尚未指定學校管理員。</div>';
    return '<div class="card"><h2>🔐 '+esc(t.schoolName)+'｜學校管理員</h2><div class="notice">Global Admin 可以指定此校後台管理員。新學校目前維持「建置中」，Phase 2 Tenant 資料隔離完成後才會開放營運後台。</div>'+list+'<label>新增管理員 Google Email</label><input id="globalAdminEmail" type="email" placeholder="admin@example.com"><button class="primary" onclick="grantSchoolAdmin(\''+esc(sid)+'\')">＋ 指定 School Admin</button></div>';
  }
  function createBox(){
    return '<div class="card"><h2>➕ 新增學校 Tenant</h2><div class="notice">Phase 1 新增學校會先以「建置中」建立，只建立 Tenant 與管理員權限，不會直接接觸聖心學生資料。</div><label>schoolId</label><input id="newTenantId" placeholder="例：xinsheng-elementary"><label>學校名稱</label><input id="newTenantName" placeholder="例：新生國小"><div class="row2"><div><label>簡稱</label><input id="newTenantShort" placeholder="新生"></div><div><label>系統名稱</label><input id="newTenantSystem" placeholder="新生國小弦樂團"></div></div><button class="primary" onclick="createSchoolTenant()">建立學校 Tenant</button></div>';
  }
  function page(){
    const s=state.globalTenant,d=s.dashboard;
    if(s.loading&&!d)return '<div class="card"><h2>🌐 Global 管理中心</h2><div class="notice">正在讀取多租戶平台資料…</div></div>';
    if(s.error)return '<div class="card"><h2>🌐 Global 管理中心</h2><div class="error">'+esc(s.error)+'</div><button class="secondary" onclick="reloadGlobalTenant()">重新讀取</button></div>';
    if(!d)return '<div class="card"><h2>🌐 Global 管理中心</h2><div class="notice">尚未載入。</div></div>';
    return '<div class="card hero"><button class="secondary" style="margin:0 0 10px" onclick="go(\'admin\')">← 返回學校後台</button><h2>🌐 Global 管理中心</h2><div class="notice"><b>Multi-Tenant Phase 1</b><br>'+esc(d.notice||"")+'</div><div class="grid" style="margin-top:12px"><div class="kpi"><b>'+Number(d.schoolCount||0)+'</b><span>學校</span></div><div class="kpi"><b>'+Number(d.totals?.students||0)+'</b><span>學生</span></div><div class="kpi"><b>'+Number(d.totals?.teachers||0)+'</b><span>老師</span></div><div class="kpi"><b>'+Number(d.totals?.todayAttendanceRecords||0)+'</b><span>今日紀錄</span></div></div></div><div class="card"><h2>🏫 學校清單</h2></div>'+(d.schools||[]).map(schoolCard).join("")+adminBox()+createBox();
  }
  function draw(){if(state.page==="global"&&canGlobal()){const a=document.getElementById("app");if(a)a.innerHTML=shell(page())}}
  window.openGlobalTenant=async function(){if(!canGlobal())return;state.page="global";draw();await loadGlobal(true)};
  window.reloadGlobalTenant=async function(){state.globalTenant.loaded=false;await loadGlobal(true)};
  window.selectGlobalSchool=async function(sid){try{await loadAdmins(sid);draw()}catch(e){toast("❌ "+e.message)}};
  window.createSchoolTenant=async function(){
    const body={schoolId:document.getElementById("newTenantId")?.value,schoolName:document.getElementById("newTenantName")?.value,shortName:document.getElementById("newTenantShort")?.value,systemName:document.getElementById("newTenantSystem")?.value};
    if(!body.schoolId||!body.schoolName){toast("請填寫 schoolId 與學校名稱");return}
    try{await api("/api/tenant-directory",{method:"POST",body:JSON.stringify(body)});toast("✅ 學校 Tenant 已建立為建置中");state.globalTenant.loaded=false;await loadGlobal(true)}catch(e){toast("❌ "+e.message)}
  };
  window.grantSchoolAdmin=async function(sid){
    const email=document.getElementById("globalAdminEmail")?.value.trim();if(!email){toast("請輸入管理員 Email");return}
    try{await api("/api/tenant-admins",{method:"PATCH",body:JSON.stringify({schoolId:sid,email,action:"grant"})});toast("✅ 已指定 School Admin");await loadAdmins(sid);draw()}catch(e){toast("❌ "+e.message)}
  };
  window.revokeSchoolAdmin=async function(sid,email){
    if(!confirm("確定移除 "+email+" 的 School Admin 權限？"))return;
    try{await api("/api/tenant-admins",{method:"PATCH",body:JSON.stringify({schoolId:sid,email,action:"revoke"})});toast("✅ 已移除 School Admin");await loadAdmins(sid);draw()}catch(e){toast("❌ "+e.message)}
  };
  function mountEntry(){
    if(!canGlobal()||state.page!=="admin")return;const main=document.querySelector(".main");if(!main)return;
    let root=document.getElementById("globalTenantEntry");if(!root){root=document.createElement("div");root.id="globalTenantEntry";main.prepend(root)}
    root.innerHTML='<div class="card"><h2>🌐 Global 多校管理</h2><div class="notice">目前聖心小學為第一個 Tenant。可先建立其他學校與指定 School Admin；新學校在 Phase 2 資料隔離完成前維持建置中。</div><button class="primary" onclick="openGlobalTenant()">進入 Global 管理中心</button></div>';
  }
  const bg=go;go=async function(p){if(p==="global"&&canGlobal()){await openGlobalTenant();return}return bg(p)};
  const br=render;render=function(){if(state.page==="global"&&canGlobal()){draw();return}const r=br();if(canGlobal()&&state.page==="admin")setTimeout(mountEntry,0);return r};
  const bh=typeof home==="function"?home:null;
  if(bh)home=function(){if(state.me?.role==="tenantPending")return '<div class="card hero"><h2>🏫 '+esc(state.me.schoolName||"學校")+'｜系統建置中</h2><div class="notice">您的 School Admin 權限已建立，但此學校尚未完成多租戶資料隔離，因此暫不開放營運後台。這項保護可避免看到其他學校資料。</div></div>';return bh()};
  if(canGlobal()&&state.page==="admin")setTimeout(mountEntry,0);
})();