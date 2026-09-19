(()=>{
  if(!document.getElementById("globalTenantStyles")){
    const style=document.createElement("style");style.id="globalTenantStyles";
    style.textContent=".global-manage-btn{border:0;border-radius:12px;padding:10px 14px;background:var(--green);color:#fff;font-weight:900;box-shadow:0 2px 6px rgba(0,0,0,.08)}.global-manage-btn:hover{filter:brightness(.95)}.global-danger-btn{border:1px solid var(--bad);border-radius:12px;padding:9px 11px;background:#fff7f7;color:var(--bad);font-weight:900}.global-danger-btn:hover{background:#fee2e2}.global-action-hint{display:block;font-size:11px;color:var(--muted);margin-top:4px}.global-school-card-open{border:2px solid var(--green);box-shadow:0 8px 20px rgba(0,0,0,.08)}.global-inline-admin{margin-top:14px;padding-top:14px;border-top:1px dashed var(--line)}.global-inline-admin h3{margin:0 0 8px;font-size:15px}";
    document.head.appendChild(style);
  }
  state.globalTenant=state.globalTenant||{loaded:false,loading:false,dashboard:null,tenants:[],admins:[],selectedSchoolId:"",regionFilter:"",error:""};
  const canGlobal=()=>state.me?.role==="admin"&&state.me?.capabilities?.globalAdmin===true;
  const st={active:"🟢 啟用",setup:"🟡 建置中",inactive:"⚪ 停用"};
  const cities=[
    ["keelung","基隆市"],["taipei","臺北市"],["new-taipei","新北市"],["taoyuan","桃園市"],["hsinchu-city","新竹市"],["hsinchu-county","新竹縣"],
    ["miaoli","苗栗縣"],["taichung","臺中市"],["changhua","彰化縣"],["nantou","南投縣"],["yunlin","雲林縣"],["chiayi-city","嘉義市"],["chiayi-county","嘉義縣"],
    ["tainan","臺南市"],["kaohsiung","高雄市"],["pingtung","屏東縣"],["yilan","宜蘭縣"],["hualien","花蓮縣"],["taitung","臺東縣"],["penghu","澎湖縣"],["kinmen","金門縣"],["lienchiang","連江縣"]
  ];
  const levels=[["elementary","國小"],["junior-high","國中"],["senior-high","高中"]];
  const slug=v=>String(v||"").trim().toLowerCase().replace(/[^a-z0-9-]/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"").slice(0,40);
  const cityName=code=>(cities.find(x=>x[0]===code)||[])[1]||code;
  const levelName=code=>(levels.find(x=>x[0]===code)||[])[1]||code;
  const schoolIdPreview=()=>{const s=slug(document.getElementById("newTenantSlug")?.value);if(!s)return "";return [document.getElementById("newTenantCity")?.value,s,document.getElementById("newTenantLevel")?.value].filter(Boolean).join("-")};


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
      if(state.globalTenant.selectedSchoolId)await loadAdmins(state.globalTenant.selectedSchoolId);
    }catch(e){state.globalTenant.error=e.message||String(e)}
    state.globalTenant.loading=false;draw();
  }
  function inlineAdminPanel(x){
    const sid=String(x.schoolId||"");
    if(String(state.globalTenant.selectedSchoolId||"")!==sid)return "";
    const rows=(state.globalTenant.admins||[]).filter(a=>a.status==="active");
    const list=rows.length?rows.map(a=>'<div class="item"><div><b>'+esc(a.email)+'</b><small>School Admin<span class="global-action-hint">移除權限不會刪除帳號或學校資料</span></small></div><button class="global-danger-btn" style="margin:0" onclick="revokeSchoolAdmin(\''+esc(sid)+'\',\''+esc(a.email)+'\')">🗑️ 移除權限</button></div>').join(""):'<div class="notice" style="margin-top:10px">尚未指定學校管理員。</div>';
    return '<div class="global-inline-admin"><h3>🔐 '+esc(x.schoolName)+'｜學校管理員</h3><div class="notice">此區只管理 <b>'+esc(x.schoolName)+'</b> 的後台管理員，不會影響其他學校。</div>'+list+'<label>新增此校管理員 Google Email</label><input id="globalAdminEmail_'+esc(sid)+'" type="email" placeholder="admin@example.com"><button class="primary" onclick="grantSchoolAdmin(\''+esc(sid)+'\')">＋ 指定 '+esc(x.schoolName)+' School Admin</button></div>';
  }
  function schoolCard(x){
    const mode=x.dataMode==="legacy-default"?"既有聖心資料｜今日已有 "+Number(x.todayAttendanceRecords||0)+" 筆上課／點名紀錄":"Phase 2 前維持資料隔離建置，不會開放看到聖心既有資料。";
    const region=[x.cityName||cityName(x.cityCode),x.schoolLevelName||levelName(x.schoolLevel)].filter(Boolean).join("｜");
    const opened=String(state.globalTenant.selectedSchoolId||"")===String(x.schoolId||"");
    const buttonText=opened?"▲ 收合管理":"⚙️ 管理學校";
    return '<div class="card '+(opened?"global-school-card-open":"")+'"><div class="student"><div><b style="font-size:17px">🏫 '+esc(x.schoolName)+'</b><div class="muted">'+(region?esc(region)+'｜':"")+esc(x.schoolId)+'｜'+esc(st[x.status]||x.status)+'</div></div><button class="global-manage-btn" style="margin:0" onclick="selectGlobalSchool(\''+esc(x.schoolId)+'\')">'+buttonText+'</button></div>'+
      '<div class="grid" style="margin-top:10px"><div class="kpi"><b>'+Number(x.studentCount||0)+'</b><span>學生</span></div><div class="kpi"><b>'+Number(x.teacherCount||0)+'</b><span>老師</span></div><div class="kpi"><b>'+Number(x.parentAccountCount||0)+'</b><span>家長帳號</span></div><div class="kpi"><b>'+Number(x.schoolAdminCount||0)+'</b><span>學校管理員</span></div></div><div class="notice" style="margin-top:10px"><b>📍 '+esc(region||"行政區未設定")+'</b><br><small>'+esc(mode)+'</small></div>'+inlineAdminPanel(x)+'</div>';
  }
  function createBox(){
    const cityOpts=cities.map(x=>'<option value="'+esc(x[0])+'" '+(x[0]==="keelung"?"selected":"")+'>'+esc(x[1])+'</option>').join("");
    const levelOpts=levels.map(x=>'<option value="'+esc(x[0])+'">'+esc(x[1])+'</option>').join("");
    return '<div class="card"><h2>➕ 新增學校 Tenant</h2><div class="notice">選擇縣市與學制後，只需要輸入英文校名識別碼。系統會自動產生唯一 schoolId，降低人工輸入錯誤。<br><br>例如：基隆市＋忠義＋國小 → <b>keelung-zhongyi-elementary</b></div>'+
      '<div class="row2"><div><label>縣市／行政區</label><select id="newTenantCity" onchange="updateTenantIdPreview()">'+cityOpts+'</select></div><div><label>學制</label><select id="newTenantLevel" onchange="updateTenantIdPreview()">'+levelOpts+'</select></div></div>'+
      '<label>英文校名識別碼</label><input id="newTenantSlug" placeholder="例：zhongyi" oninput="updateTenantIdPreview()"><div class="notice" style="margin-top:8px"><b>系統產生 schoolId</b><br><span id="newTenantIdPreview">請輸入英文校名識別碼</span></div>'+
      '<label>學校名稱</label><input id="newTenantName" placeholder="例：忠義國小"><div class="row2"><div><label>簡稱</label><input id="newTenantShort" placeholder="忠義"></div><div><label>系統名稱</label><input id="newTenantSystem" placeholder="忠義國小弦樂團"></div></div><button class="primary" onclick="createSchoolTenant()">建立學校 Tenant</button></div>';
  }
  function page(){
    const s=state.globalTenant,d=s.dashboard;
    if(s.loading&&!d)return '<div class="card"><h2>🌐 Global 管理中心</h2><div class="notice">正在讀取多租戶平台資料…</div></div>';
    if(s.error)return '<div class="card"><h2>🌐 Global 管理中心</h2><div class="error">'+esc(s.error)+'</div><button class="secondary" onclick="reloadGlobalTenant()">重新讀取</button></div>';
    if(!d)return '<div class="card"><h2>🌐 Global 管理中心</h2><div class="notice">尚未載入。</div></div>';
    const regionOptions=['<option value="">全部行政區</option>'].concat(cities.map(x=>'<option value="'+esc(x[0])+'" '+(state.globalTenant.regionFilter===x[0]?"selected":"")+'>'+esc(x[1])+'</option>')).join("");
    const schools=(d.schools||[]).filter(x=>!state.globalTenant.regionFilter||x.cityCode===state.globalTenant.regionFilter);
    return '<div class="card hero"><button class="secondary" style="margin:0 0 10px" onclick="go(\'admin\')">← 返回學校後台</button><h2>🌐 Global 管理中心</h2><div class="notice"><b>Multi-Tenant Phase 1</b><br>'+esc(d.notice||"")+'</div><div class="grid" style="margin-top:12px"><div class="kpi"><b>'+Number(d.schoolCount||0)+'</b><span>學校</span></div><div class="kpi"><b>'+Number(d.totals?.students||0)+'</b><span>學生</span></div><div class="kpi"><b>'+Number(d.totals?.teachers||0)+'</b><span>老師</span></div><div class="kpi"><b>'+Number(d.totals?.todayAttendanceRecords||0)+'</b><span>今日紀錄</span></div></div></div><div class="card"><h2>🏫 學校清單</h2><label>行政區篩選</label><select onchange="filterGlobalRegion(this.value)">'+regionOptions+'</select><div class="muted" style="margin-top:8px">目前顯示 '+schools.length+' / '+Number(d.schoolCount||0)+' 所學校</div></div>'+schools.map(schoolCard).join("")+createBox();
  }
  function draw(){if(state.page==="global"&&canGlobal()){const a=document.getElementById("app");if(a){a.innerHTML=shell(page());setTimeout(()=>window.updateTenantIdPreview?.(),0)}}}
  window.openGlobalTenant=async function(){if(!canGlobal())return;state.page="global";draw();await loadGlobal(true)};
  window.reloadGlobalTenant=async function(){state.globalTenant.loaded=false;await loadGlobal(true)};
  window.selectGlobalSchool=async function(sid){
    try{
      if(String(state.globalTenant.selectedSchoolId||"")===String(sid||"")){
        state.globalTenant.selectedSchoolId="";state.globalTenant.admins=[];draw();return;
      }
      await loadAdmins(sid);draw();
      setTimeout(()=>document.getElementById("globalAdminEmail_"+sid)?.scrollIntoView({behavior:"smooth",block:"nearest"}),50);
    }catch(e){toast("❌ "+e.message)}
  };
  window.updateTenantIdPreview=function(){
    const el=document.getElementById("newTenantIdPreview"),v=schoolIdPreview();if(el)el.textContent=v||"請輸入英文校名識別碼";
  };
  window.filterGlobalRegion=function(v){state.globalTenant.regionFilter=String(v||"");draw()};
  window.createSchoolTenant=async function(){
    const schoolSlug=slug(document.getElementById("newTenantSlug")?.value);
    const body={cityCode:document.getElementById("newTenantCity")?.value,schoolLevel:document.getElementById("newTenantLevel")?.value,schoolSlug,schoolName:document.getElementById("newTenantName")?.value,shortName:document.getElementById("newTenantShort")?.value,systemName:document.getElementById("newTenantSystem")?.value};
    if(!body.cityCode||!body.schoolLevel||!schoolSlug||!body.schoolName){toast("請選擇縣市、學制，並填寫英文校名識別碼與學校名稱");return}
    try{const d=await api("/api/tenant-directory",{method:"POST",body:JSON.stringify(body)});toast("✅ "+(d.item?.schoolId||"學校 Tenant")+" 已建立為建置中");state.globalTenant.loaded=false;await loadGlobal(true)}catch(e){toast("❌ "+e.message)}
  };
  window.grantSchoolAdmin=async function(sid){
    const email=document.getElementById("globalAdminEmail_"+sid)?.value.trim();if(!email){toast("請輸入此校管理員 Email");return}
    try{await api("/api/tenant-admins",{method:"PATCH",body:JSON.stringify({schoolId:sid,email,action:"grant"})});toast("✅ 已指定此校 School Admin");await loadGlobal(true)}catch(e){toast("❌ "+e.message)}
  };
  window.revokeSchoolAdmin=async function(sid,email){
    const school=(state.globalTenant.tenants||[]).find(x=>String(x.schoolId)===String(sid));
    if(!confirm("確定移除 "+email+" 在「"+(school?.schoolName||sid)+"」的 School Admin 權限？\n\n不會刪除帳號、學生或學校資料。"))return;
    try{await api("/api/tenant-admins",{method:"PATCH",body:JSON.stringify({schoolId:sid,email,action:"revoke"})});toast("✅ 已移除此校 School Admin 權限");await loadGlobal(true)}catch(e){toast("❌ "+e.message)}
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