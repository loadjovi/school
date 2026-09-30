(()=>{
  if(!document.getElementById("globalTenantStyles")){
    const style=document.createElement("style");style.id="globalTenantStyles";
    style.textContent=".global-manage-btn{border:0;border-radius:12px;padding:10px 14px;background:var(--green);color:#fff;font-weight:900;box-shadow:0 2px 6px rgba(0,0,0,.08)}.global-manage-btn:hover{filter:brightness(.95)}.global-danger-btn{border:1px solid var(--bad);border-radius:12px;padding:9px 11px;background:#fff7f7;color:var(--bad);font-weight:900}.global-danger-btn:hover{background:#fee2e2}.global-action-hint{display:block;font-size:11px;color:var(--muted);margin-top:4px}.global-school-card-open{border:2px solid var(--green);box-shadow:0 8px 20px rgba(0,0,0,.08)}.global-inline-admin{margin-top:14px;padding-top:14px;border-top:1px dashed var(--line)}.global-inline-admin h3{margin:0 0 8px;font-size:15px}.global-health-row{display:flex;gap:10px;align-items:flex-start;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--line)}.global-health-row:last-child{border-bottom:0}.global-health-pill{border-radius:999px;padding:4px 9px;font-size:12px;font-weight:900;white-space:nowrap}.global-health-healthy{background:#dcfce7;color:#166534}.global-health-warning{background:#fef3c7;color:#92400e}.global-health-critical{background:#fee2e2;color:#991b1b}.global-attendance-school{margin-top:10px;padding:12px;border:1px solid var(--line);border-radius:14px;background:#fff}.global-onboarding{border:2px solid #f59e0b;background:linear-gradient(180deg,#fffbeb,#fff)}.global-onboarding-check{display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--line)}.global-onboarding-check:last-child{border-bottom:0}.global-onboarding-check input{width:20px;height:20px;margin:1px 0 0;flex:0 0 auto}.global-onboarding-link{display:flex;gap:8px;align-items:center;margin-top:8px}.global-onboarding-link code{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:#f8fafc;border:1px solid var(--line);border-radius:10px;padding:9px;font-size:11px}.global-ops-breadcrumb{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:0 0 10px}.global-ops-breadcrumb button{width:auto;margin:0;padding:6px 9px;font-size:11px}.global-ops-school-card{margin-top:10px;padding:12px;border:1px solid var(--line);border-radius:14px;background:#fff}.global-ops-school-card:hover{border-color:#aebde4}.global-ops-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:7px;margin-top:10px}.global-ops-stat{padding:9px;border:1px solid #e1e6ef;border-radius:11px;background:#f8fafc}.global-ops-stat b{display:block;font-size:15px;color:#1f3f91}.global-ops-stat small{display:block;margin-top:3px;font-size:9px;color:var(--muted);line-height:1.35}.global-ops-course-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;margin-top:10px}.global-ops-course-card{padding:10px;border:1px solid #dfe5ed;border-radius:12px;background:#fff}.global-ops-course-card.is-unavailable{background:#fafafa;border-style:dashed}.global-ops-course-card b{display:block;font-size:12px;color:#172554}.global-ops-course-card strong{display:block;margin-top:7px;font-size:18px;color:#3155a4}.global-ops-course-card small{display:block;margin-top:3px;font-size:9px;color:var(--muted);line-height:1.4}.global-ops-teacher{margin-top:9px;padding:11px;border:1px solid #dde4ef;border-radius:12px;background:#fff}.global-ops-teacher-head{display:flex;align-items:flex-start;justify-content:space-between;gap:9px}.global-ops-teacher-head b{font-size:14px;color:#172554}.global-ops-teacher-hours{font-size:18px;font-weight:900;color:#3155a4;white-space:nowrap}.global-ops-teacher-breakdown{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:5px;margin-top:8px}.global-ops-teacher-breakdown span{padding:6px;border-radius:8px;background:#f8fafc;font-size:9px;text-align:center}.global-ops-audit{margin-top:8px;padding:10px;border-left:3px solid #d8e1f5;background:#fafbfe;border-radius:0 10px 10px 0}.global-ops-audit-head{display:flex;justify-content:space-between;gap:8px}.global-ops-audit-head b{font-size:12px}.global-ops-audit small{display:block;margin-top:4px;font-size:9px;color:var(--muted);line-height:1.5}@media(max-width:720px){.global-ops-grid,.global-ops-course-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.global-ops-teacher-breakdown{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:420px){.global-ops-grid,.global-ops-course-grid{grid-template-columns:1fr 1fr}}";
    document.head.appendChild(style);
  }
  const taipeiMonth=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()).slice(0,7);
  state.globalTenant=state.globalTenant||{loaded:false,loading:false,dashboard:null,tenants:[],admins:[],selectedSchoolId:"",regionFilter:"",migration:null,migrationBusy:false,attendance:null,attendanceMonth:taipeiMonth(),attendanceLoading:false,health:null,healthLoading:false,onboarding:[],onboardingBusy:false,error:""};
  if(state.globalTenant.migrationBusy===undefined)state.globalTenant.migrationBusy=false;
  if(!state.globalTenant.attendanceMonth)state.globalTenant.attendanceMonth=taipeiMonth();
  if(state.globalTenant.attendanceLoading===undefined)state.globalTenant.attendanceLoading=false;
  if(state.globalTenant.operationsSchoolId===undefined)state.globalTenant.operationsSchoolId="";
  if(state.globalTenant.operationsTeacherKey===undefined)state.globalTenant.operationsTeacherKey="";
  if(state.globalTenant.healthLoading===undefined)state.globalTenant.healthLoading=false;
  if(state.globalTenant.teacherSupport===undefined)state.globalTenant.teacherSupport=null;
  if(state.globalTenant.supportLoading===undefined)state.globalTenant.supportLoading=false;
  if(state.globalTenant.supportSourceSchoolId===undefined)state.globalTenant.supportSourceSchoolId="";
  if(!Array.isArray(state.globalTenant.onboarding))state.globalTenant.onboarding=[];
  if(state.globalTenant.onboardingBusy===undefined)state.globalTenant.onboardingBusy=false;
  state.globalBrandingAdmin=state.globalBrandingAdmin||{loading:false,error:""};
  let globalBrandLogoFile=null,globalBrandPreviewUrl="";
  const canGlobal=()=>state.me?.capabilities?.globalAdmin===true;
  const st={active:"🟢 啟用",onboarding:"🟠 隔離驗證中",setup:"🟡 建置中",inactive:"⚪ 停用"};
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
      const r=await Promise.all([api("/api/global-dashboard"),api("/api/tenant-directory"),api("/api/global-branding"),api("/api/tenant-migration"),api("/api/global-attendance?month="+encodeURIComponent(state.globalTenant.attendanceMonth)),api("/api/global-health"),api("/api/tenant-onboarding"),api("/api/global-teacher-support").catch(e=>({error:e.message}))]);
      state.globalTenant.dashboard=r[0];state.globalTenant.tenants=r[1].items||[];state.globalTenant.loaded=true;
      state.globalBranding={...(state.globalBranding||{}),...(r[2]||{})};
      state.globalTenant.migration=r[3]||null;
      state.globalTenant.attendance=r[4]||null;state.globalTenant.health=r[5]||null;state.globalTenant.onboarding=r[6]?.items||[];
      state.globalTenant.teacherSupport=r[7]||null;
      if(typeof window.setGlobalBranding==="function")window.setGlobalBranding(state.globalBranding);
      if(state.globalTenant.selectedSchoolId)await loadAdmins(state.globalTenant.selectedSchoolId);
    }catch(e){state.globalTenant.error=e.message||String(e)}
    state.globalTenant.loading=false;draw();
  }
  function inlineAdminPanel(x){
    const sid=String(x.schoolId||"");
    if(String(state.globalTenant.selectedSchoolId||"")!==sid)return "";
    const rows=(state.globalTenant.admins||[]).filter(a=>a.status==="active"),revoked=(state.globalTenant.admins||[]).filter(a=>a.status!=="active");
    const selfEmail=String(state.me?.email||"").toLowerCase();
    const selfIsAdmin=rows.some(a=>String(a.email||"").toLowerCase()===selfEmail);
    const list=rows.length?rows.map(a=>'<div class="item"><div><b>'+esc(a.email)+'</b><small>School Admin<span class="global-action-hint">移除權限不會刪除帳號或學校資料</span></small></div><button class="global-danger-btn" style="margin:0" onclick="revokeSchoolAdmin(\''+esc(sid)+'\',\''+esc(a.email)+'\')">🗑️ 移除權限</button></div>').join(""):'<div class="notice" style="margin-top:10px">尚未指定學校管理員。</div>';
    const revokedList=revoked.length?'<details style="margin-top:10px"><summary><b>已停用權限紀錄（'+revoked.length+'）</b></summary>'+revoked.map(a=>'<div class="item"><div><b>'+esc(a.email)+'</b><small>停用於 '+esc(a.updatedAt||"未記錄")+'</small></div><button class="secondary" style="margin:0" onclick="grantKnownSchoolAdmin(\''+esc(sid)+'\',\''+esc(a.email)+'\')">重新啟用</button></div>').join("")+'</details>':'';
    let selfAction="";
    if(selfIsAdmin&&["active","onboarding"].includes(x.status)){
      const testing=x.status==="onboarding";
      selfAction='<div class="notice" style="margin-top:10px"><b>'+(testing?'🧪 隔離驗證帳號':'✅ 您目前是此校 School Admin')+'</b><br>'+(testing?'現在只能操作此校 Tenant，畫面會持續顯示橘色驗證提示。':'可以由 Global 切換進入此校正式營運後台。')+'</div><button class="primary" onclick="enterSchoolAdmin(\''+esc(sid)+'\')">'+(testing?'🧪 進入 ':'🏫 進入 ')+esc(x.schoolName)+(testing?' 隔離測試後台':' 後台')+'</button>';
    }else if(selfIsAdmin){
      selfAction='<div class="notice" style="margin-top:10px"><b>✅ 您已綁定為此校 School Admin</b><br>此校目前為「'+esc(st[x.status]||x.status)+'」，待 Tenant 資料隔離完成並啟用後，才可進入營運後台。</div>';
    }else{
      selfAction='<button class="secondary" style="width:100%;margin-top:10px" onclick="bindSelfSchoolAdmin(\''+esc(sid)+'\')">👤 將我的 Global 帳號綁定為此校管理員</button>';
    }
    const cityOptions=cities.map(option=>'<option value="'+esc(option[0])+'" '+(option[0]===x.cityCode?'selected':'')+'>'+esc(option[1])+'</option>').join("");
    const levelOptions=levels.map(option=>'<option value="'+esc(option[0])+'" '+(option[0]===x.schoolLevel?'selected':'')+'>'+esc(option[1])+'</option>').join("");
    const lifecycleLocked=sid==="sacred-heart"||["onboarding","active"].includes(x.status);
    const statusOptions=sid==="sacred-heart"?'<option value="active">啟用（固定）</option>':lifecycleLocked?'<option value="'+esc(x.status)+'">'+esc(st[x.status]||x.status)+'（由 Phase 4 管理）</option>':['setup','inactive'].map(value=>'<option value="'+value+'" '+(value===x.status?'selected':'')+'>'+esc(st[value]||value)+'</option>').join("");
    const schoolForm='<div class="global-inline-admin"><h3>🏫 學校基本設定</h3><div class="notice"><b>schoolId：'+esc(sid)+'</b><br>schoolId 建立後不可修改；「隔離驗證中」與「正式啟用」只能由 Phase 4 安全流程切換。</div><label>學校名稱</label><input id="tenantName_'+esc(sid)+'" value="'+esc(x.schoolName||'')+'" maxlength="120"><div class="row2"><div><label>簡稱</label><input id="tenantShort_'+esc(sid)+'" value="'+esc(x.shortName||'')+'" maxlength="60"></div><div><label>系統名稱</label><input id="tenantSystem_'+esc(sid)+'" value="'+esc(x.systemName||'')+'" maxlength="160"></div></div><div class="row2"><div><label>縣市</label><select id="tenantCity_'+esc(sid)+'">'+cityOptions+'</select></div><div><label>學制</label><select id="tenantLevel_'+esc(sid)+'">'+levelOptions+'</select></div></div><div class="row2"><div><label>時區</label><select id="tenantTimezone_'+esc(sid)+'"><option value="Asia/Taipei" selected>Asia/Taipei</option></select></div><div><label>狀態</label><select id="tenantStatus_'+esc(sid)+'" '+(lifecycleLocked?'disabled':'')+'>'+statusOptions+'</select></div></div><button class="primary" onclick="saveSchoolTenant(\''+esc(sid)+'\')">💾 儲存學校設定</button></div>';
    return schoolForm+'<div class="global-inline-admin"><h3>🔐 '+esc(x.schoolName)+'｜學校管理員</h3><div class="notice">Global 可管理此校 School Admin 權限；只有已被指定為此校管理員的帳號，才可以進入該校營運後台。</div>'+selfAction+list+revokedList+'<label>新增此校管理員 Google Email</label><input id="globalAdminEmail_'+esc(sid)+'" type="email" placeholder="admin@example.com"><button class="primary" onclick="grantSchoolAdmin(\''+esc(sid)+'\')">＋ 指定 '+esc(x.schoolName)+' School Admin</button></div>';
  }
  function schoolCard(x){
    const mode=x.dataMode==="tenant-scoped-operational"?"學生、家長、老師、出勤、練習與個別課資料均已 Tenant 化。":x.dataMode==="tenant-onboarding-testing"?"正在隔離驗證；測試帳號只能操作此校 Tenant，尚未正式啟用。":"Tenant 結構已備妥，但維持建置狀態且尚未加入正式營運資料。";
    const region=[x.cityName||cityName(x.cityCode),x.schoolLevelName||levelName(x.schoolLevel)].filter(Boolean).join("｜");
    const opened=String(state.globalTenant.selectedSchoolId||"")===String(x.schoolId||"");
    const buttonText=opened?"▲ 收合管理":"⚙️ 管理學校";
    const teachers=x.teacherStatus||{},att=x.todayAttendance||{};
    const managerExtra=x.isSchoolManager?'<div class="notice" style="margin-top:10px"><b>🔐 您具備此校後台管理權限</b><br>可切換進入該校後台；Global 畫面仍只呈現跨校彙總。</div>':'<div class="notice" style="margin-top:10px"><b>👁️ Global 彙總觀察</b><br>可查看學生與家長帳號數量，但不會取得姓名、Email 或個別出勤明細。</div>';
    return '<div class="card '+(opened?"global-school-card-open":"")+'"><div class="student"><div><b style="font-size:17px">🏫 '+esc(x.schoolName)+'</b><div class="muted">'+(region?esc(region)+'｜':"")+esc(x.schoolId)+'｜'+esc(st[x.status]||x.status)+'</div></div><button class="global-manage-btn" style="margin:0" onclick="selectGlobalSchool(\''+esc(x.schoolId)+'\')">'+buttonText+'</button></div>'+
      '<div class="grid" style="margin-top:10px"><div class="kpi"><b>'+Number(x.studentCount||0)+'</b><span>在籍學生</span></div><div class="kpi"><b>'+Number(x.parentAccountCount||0)+'</b><span>家長帳號</span></div><div class="kpi"><b>'+Number(teachers.active||0)+'</b><span>啟用老師</span></div><div class="kpi"><b>'+Number(x.schoolAdminCount||0)+'</b><span>學校管理員</span></div></div>'+
      '<div class="grid" style="margin-top:10px"><div class="kpi"><b>'+Number(teachers.loggedInToday||0)+'</b><span>今日登入老師</span></div><div class="kpi"><b>'+Number(att.total||0)+'</b><span>今日有效點名</span></div><div class="kpi"><b>'+(att.attendanceRate===null||att.attendanceRate===undefined?'—':Number(att.attendanceRate).toFixed(1)+'%')+'</b><span>今日出席率</span></div><div class="kpi"><b>'+Number(att.cancelled||0)+'</b><span>取消課堂</span></div></div>'+
      '<div class="grid" style="margin-top:10px"><div class="kpi"><b>'+Number(att.present||0)+'</b><span>出席</span></div><div class="kpi"><b>'+Number(att.leave||0)+'</b><span>請假</span></div><div class="kpi"><b>'+Number(att.absent||0)+'</b><span>缺席</span></div><div class="kpi"><b>'+Number(att.late||0)+'</b><span>遲到</span></div></div>'+
      '<div class="notice" style="margin-top:10px"><b>📍 '+esc(region||"行政區未設定")+'</b><br><small>'+esc(mode)+'</small><br><small>點名統計採有效課程 Session 計算：團體／分部課同一學生同一課程只計最新狀態；個別課則依日期＋時間＋老師辨識不同課堂，同一天上兩堂會計 2 筆，相同時段重複建立不重複計算。</small></div>'+managerExtra+inlineAdminPanel(x)+'</div>';
  }
  function readGlobalBrandDataUrl(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onerror=()=>reject(new Error("讀取 Global Logo 失敗"));r.onload=()=>resolve(String(r.result||""));r.readAsDataURL(file)})}
  function globalBrandingBox(){
    const b=state.globalBranding||{siteName:"校務整合平台",schoolName:"Global 管理中心",loginSubtitle:"跨校營運、權限與服務治理",logoAlt:"Global Logo",primaryColor:"#3155A4",logoUrl:"/api/global-branding-logo?v=default"};
    const busy=state.globalBrandingAdmin.loading;
    return '<div class="card"><h2>🎨 Global 品牌設定</h2><div class="notice">此設定只套用 Global 管理中心，不會改動各學校自己的品牌。可設定 Global Logo、平台名稱、副標與主題色。</div>'+
      (state.globalBrandingAdmin.error?'<div class="error" style="margin-top:10px">'+esc(state.globalBrandingAdmin.error)+'</div>':'')+
      '<div style="display:flex;gap:14px;align-items:center;margin-top:14px"><div style="width:92px;height:92px;border:1px solid var(--line);border-radius:18px;background:#fff;display:grid;place-items:center;overflow:hidden"><img id="globalBrandingPreview" src="'+esc(b.logoUrl||"/api/global-branding-logo?v=default")+'" alt="'+esc(b.logoAlt||"Global Logo")+'" style="width:88px;height:88px;object-fit:contain"></div><div style="flex:1"><b>目前 Global Logo</b><small style="display:block;color:var(--muted);margin-top:4px">PNG／JPG／WebP，最大 2MB</small><input type="file" accept="image/png,image/jpeg,image/webp" onchange="previewGlobalBrandingLogo(this)" '+(busy?"disabled":"")+'></div></div>'+
      '<label>平台名稱</label><input id="globalBrandSiteName" value="'+esc(b.siteName||"")+'" maxlength="80">'+
      '<label>管理中心副標</label><input id="globalBrandSchoolName" value="'+esc(b.schoolName||"")+'" maxlength="120">'+
      '<label>Global 說明文字</label><input id="globalBrandSubtitle" value="'+esc(b.loginSubtitle||"")+'" maxlength="160">'+
      '<div class="row2"><div><label>Logo 替代文字</label><input id="globalBrandLogoAlt" value="'+esc(b.logoAlt||"")+'" maxlength="120"></div><div><label>主題色（即時預覽）</label><input id="globalBrandColor" type="color" value="'+esc(/^#[0-9A-Fa-f]{6}$/.test(String(b.primaryColor||""))?b.primaryColor:"#3155A4")+'" style="height:48px;padding:6px" oninput="previewGlobalBrandingColor(this.value)"></div></div>'+
      '<button class="primary" onclick="saveGlobalBranding()" '+(busy?"disabled":"")+'>'+(busy?"正在儲存…":"💾 儲存 Global 品牌設定")+'</button>'+
      '<button class="secondary" style="width:100%;margin-top:8px" onclick="restoreGlobalBrandingLogo()" '+(busy?"disabled":"")+'>↩️ 恢復預設 Global Logo</button>'+
      '<div class="notice" style="margin-top:10px">Global 品牌會獨立保存於 <b>SystemSettings / GLOBAL / BRANDING</b>；不會覆蓋學校的 <b>SYSTEM / BRANDING</b>。</div></div>';
  }
  function phase2MigrationBox(){
    const m=state.globalTenant.migration||{},summary=m.summary||{},totals=summary.totals||{},items=summary.items||[];
    const busy=state.globalTenant.migrationBusy,statusText={not_started:"尚未開始",previewed:"預覽完成",backfilled:"回填完成",backfill_incomplete:"回填未完整",verified:"驗證通過",verification_failed:"驗證未通過",cutover:"已切換運作"}[m.status]||m.status||"尚未開始";
    const differences=Number(totals.missing||0)+Number(totals.extra||0)+Number(totals.mismatched||0),result=items.length?'<details style="margin-top:12px" '+(differences>0?'open':'')+'><summary><b>資料表明細（'+items.length+' 類）</b></summary><div style="margin-top:8px">'+items.map(x=>{const diff=Number(x.missing||0)+Number(x.extra||0)+Number(x.mismatched||0);return '<div class="item"><div><b>'+esc(x.label||x.name)+'</b><small>舊鍵值 '+Number(x.legacy||0)+' 筆｜Tenant 鍵值 '+Number(x.scoped||0)+' 筆</small></div><span style="font-weight:900;color:'+(diff===0?'var(--green)':'var(--bad)')+'">'+(diff===0?'✅ 完整':'缺 '+Number(x.missing||0)+'／多 '+Number(x.extra||0)+'／異 '+Number(x.mismatched||0))+'</span></div>'}).join("")+'</div></details>':'';
    const actions=m.cutoverLocked?'<div class="notice" style="margin-top:12px"><b>✅ 已切換為正式 Tenant 資料來源</b><br>舊資料表已停止寫入；為避免重新回填覆寫切換後的新紀錄，回填工具已鎖定。</div>':'<div class="row2" style="margin-top:12px"><button class="secondary" onclick="runTenantMigration(\'preview\')" '+(busy?'disabled':'')+'>🔎 1. 預覽</button><button class="primary" onclick="runTenantMigration(\'backfill\')" '+(busy?'disabled':'')+'>📥 2. 安全回填</button></div><button class="secondary" style="width:100%;margin-top:8px" onclick="runTenantMigration(\'verify\')" '+(busy?'disabled':'')+'>'+(busy?'處理中…':'✅ 3. 驗證完整性')+'</button>';
    return '<div class="card"><h2>🧭 Phase 2｜聖心資料 Tenant 回填</h2><div class="notice"><b>目標 schoolId：sacred-heart</b><br>既有單校資料已轉換為 Tenant scoped 鍵值；第二間學校仍維持建置狀態，且所有營運 API 的 schoolId 由登入權限決定。</div>'+
      '<div class="grid" style="margin-top:12px"><div class="kpi"><b>'+esc(statusText)+'</b><span>遷移狀態</span></div><div class="kpi"><b>'+Number(totals.legacy||0)+'</b><span>既有資料</span></div><div class="kpi"><b>'+Number(totals.scoped||0)+'</b><span>已具 Tenant 鍵值</span></div><div class="kpi"><b>'+differences+'</b><span>鍵值差異</span></div></div>'+
      (m.updatedAt?'<div class="muted" style="margin-top:8px">最後執行：'+esc(m.updatedAt)+(m.updatedBy?'｜'+esc(m.updatedBy):'')+'</div>':'')+
      result+actions+'</div>';
  }
  function onboardingTime(value){if(!value)return "";try{return new Date(value).toLocaleString("zh-TW",{timeZone:"Asia/Taipei",hour12:false})}catch{return String(value)}}
  function onboardingUrl(schoolId,role){const url=new URL(location.href);url.search="";url.hash="";url.searchParams.set("onboardingSchoolId",schoolId);url.searchParams.set("onboardingRole",role);return url.toString()}
  function phase4OnboardingBox(){
    const items=state.globalTenant.onboarding||[],busy=state.globalTenant.onboardingBusy;
    if(!items.length)return '<div class="card global-onboarding"><h2>🚀 Phase 4｜第二校正式 Onboarding</h2><div class="notice"><b>尚未建立第二間學校 Tenant</b><br>請先在下方新增學校、完成基本資料並指派至少一位 School Admin；系統才會開放隔離驗證。</div></div>';
    const cards=items.map(item=>{
      const sid=String(item.schoolId||""),status=String(item.tenantStatus||"setup"),checks=item.checks||[],manual=item.manualChecks||[];
      const systemChecks=checks.map(check=>'<div class="global-health-row"><div><b>'+esc(check.label||check.key)+'</b><small style="display:block;color:var(--muted);margin-top:3px">'+esc(check.detail||"")+'</small></div><span class="global-health-pill '+(check.passed?'global-health-healthy':'global-health-warning')+'">'+(check.passed?'✅ 通過':'待完成')+'</span></div>').join("");
      const manualChecks=manual.map(check=>'<label class="global-onboarding-check"><input type="checkbox" '+(check.passed?'checked':'')+' '+(status!=="onboarding"||busy?'disabled':'')+' onchange="setTenantOnboardingCheck(\''+esc(sid)+'\',\''+esc(check.key)+'\',this.checked)"><span><b>'+esc(check.label||check.key)+'</b><small style="display:block;color:var(--muted);margin-top:3px">'+esc(check.description||"")+(check.confirmedAt?'｜確認：'+esc(onboardingTime(check.confirmedAt)):'')+'</small></span></label>').join("");
      const testLinks=[['schoolAdmin','School Admin'],['teacher','老師'],['parent','家長']].map(pair=>{const link=onboardingUrl(sid,pair[0]);return '<div class="global-onboarding-link"><code title="'+esc(link)+'">'+esc(pair[1])+'｜'+esc(link)+'</code><button class="secondary" style="margin:0;white-space:nowrap" onclick="copyTenantOnboardingLink(\''+esc(sid)+'\',\''+pair[0]+'\')">複製</button></div>'}).join("");
      let action="";
      if(status==="active"){
        action='<div class="notice" style="margin-top:12px;background:#ecfdf5"><b>✅ 第二校已正式啟用</b><br>自動檢查與四項人工隔離驗證均已通過。'+(item.activatedAt?'<br>啟用時間：'+esc(onboardingTime(item.activatedAt)):'')+'</div>';
      }else if(status==="onboarding"){
        action='<div class="notice" style="margin-top:12px"><b>🧪 隔離測試入口</b><br>請分別用第二校管理員、老師與家長測試帳號開啟對應連結。伺服器仍會核對真實權限，連結本身不會授予角色。</div>'+testLinks+
          '<h3 style="margin:16px 0 4px">人工隔離驗證</h3>'+manualChecks+
          '<div class="row2" style="margin-top:12px"><button class="secondary" onclick="runTenantOnboardingAction(\'verify\',\''+esc(sid)+'\')" '+(busy?'disabled':'')+'>🔄 重新驗證</button><button class="primary" onclick="runTenantOnboardingAction(\'activate\',\''+esc(sid)+'\')" '+(busy||!item.readyToActivate?'disabled':'')+'>✅ 正式啟用第二校</button></div><button class="secondary" style="width:100%;margin-top:8px" onclick="runTenantOnboardingAction(\'pause\',\''+esc(sid)+'\')" '+(busy?'disabled':'')+'>⏸ 暫停隔離驗證</button>'+
          '<div class="notice" style="margin-top:10px"><b>'+(item.readyToActivate?'✅ 全部條件通過，可正式啟用':'🔒 啟用鎖定中')+'</b><br>'+(item.readyToActivate?'啟用後，第二校帳號將進入正式營運。':'請先完成所有自動檢查與四項人工隔離驗證。')+'</div>';
      }else{
        const blockers=checks.filter(check=>["tenant-profile","school-admin","access-school-scope","partition-isolation"].includes(check.key)&&!check.passed).map(check=>check.label).join("、");
        action='<button class="primary" style="width:100%;margin-top:12px" onclick="runTenantOnboardingAction(\'start\',\''+esc(sid)+'\')" '+(busy||!item.startReady?'disabled':'')+'>🧪 開始隔離驗證</button><div class="notice" style="margin-top:10px"><b>'+(item.startReady?'可開始測試':'尚未開放')+'</b><br>'+(item.startReady?'開始後只開放授權測試帳號進入此校 Tenant，不會直接正式啟用。':'請先完成：'+esc(blockers||"學校基本設定與 School Admin 指派"))+'</div>';
      }
      return '<div class="card global-onboarding"><div class="student"><div><b style="font-size:17px">🏫 '+esc(item.schoolName||sid)+'</b><div class="muted">'+esc(sid)+'｜'+esc(st[status]||status)+'</div></div><span class="global-health-pill '+(status==="active"?'global-health-healthy':status==="onboarding"?'global-health-warning':'global-health-warning')+'">'+esc(status==="active"?'已上線':status==="onboarding"?'驗證中':'準備中')+'</span></div><div class="grid" style="margin-top:12px"><div class="kpi"><b>'+Number(item.counts?.students||0)+'</b><span>第二校學生</span></div><div class="kpi"><b>'+Number(item.counts?.teachers||0)+'</b><span>第二校老師</span></div><div class="kpi"><b>'+Number(item.counts?.parentAccounts||0)+'</b><span>家長帳號</span></div><div class="kpi"><b>'+Number(item.counts?.schoolAdmins||0)+'</b><span>School Admin</span></div></div><details style="margin-top:12px" '+(!item.automatedPassed?'open':'')+'><summary><b>自動安全檢查（'+checks.filter(x=>x.passed).length+' / '+checks.length+'）</b></summary><div style="margin-top:6px">'+systemChecks+'</div></details>'+action+'</div>';
    }).join("");
    return '<div class="card"><h2>🚀 Phase 4｜第二校正式 Onboarding</h2><div class="notice"><b>三段式安全門：準備 → 隔離驗證 → 正式啟用</b><br>一般學校設定無法直接把 Tenant 改為啟用；必須通過 Tenant 鍵值掃描、測試資料條件與四項跨校隔離確認。</div></div>'+cards;
  }
  function attendanceRateText(value){return value===null||value===undefined?"—":Number(value).toFixed(1)+"%"}
  function globalHours(value){const n=Number(value||0);return (Math.round(n*100)/100).toFixed(n%1?2:1)+" 小時"}
  function globalRating(value){return value===null||value===undefined?"—":Number(value).toFixed(1)+" / 5"}
  const globalCourseLabels={section:"分部課",ensemble:"合奏課",comprehensive:"綜合課",practice:"加練課",privateLesson:"個別課",performance:"展演活動"};
  const globalCourseIcons={section:"🎼",ensemble:"🎻",comprehensive:"🎶",practice:"⏱️",privateLesson:"👤",performance:"🎵"};
  const globalCourseTypes=Object.keys(globalCourseLabels);
  const globalTeacherKey=(school,teacher)=>String(teacher.teacherEmail||"").trim().toLowerCase()||String(school.schoolId||"")+":"+String(teacher.teacherKey||teacher.teacherName||"");
  const globalActionArg=value=>esc(JSON.stringify(String(value||"")));

  function globalCourseCard(key,item){
    item=item||{};const privateType=key==="privateLesson",unavailable=item.available===false;
    const main=unavailable?"尚未啟用點名":Number(item.sessions||0)+(key==="performance"?" 場":" 堂");
    const detail=unavailable
      ?esc(item.note||"尚無可認列資料")
      :privateType
        ?"教學 "+globalHours(item.hours||0)+"｜家長回饋 "+Number(item.feedbackCount||0)+" 筆｜"+globalRating(item.feedbackAverage)
        :key==="practice"||key==="performance"
          ?"已確認工時 "+globalHours(item.hours||0)
          :"教學 "+globalHours(item.hours||0)+"｜到課率 "+attendanceRateText(item.attendance?.attendanceRate);
    return '<div class="global-ops-course-card '+(unavailable?"is-unavailable":"")+'"><b>'+globalCourseIcons[key]+' '+globalCourseLabels[key]+'</b><strong>'+main+'</strong><small>'+detail+'</small></div>';
  }
  function crossSchoolTeacherTotals(schools){
    const map=new Map(),types=globalCourseTypes;
    for(const school of schools||[])for(const teacher of school.teachers||[]){
      const key=globalTeacherKey(school,teacher);
      if(!map.has(key))map.set(key,{key,teacherName:teacher.teacherName||teacher.teacherEmail||key,schools:[],minutes:0,course:Object.fromEntries(types.map(type=>[type,{sessions:0,minutes:0}]))});
      const total=map.get(key);total.schools.push(school.schoolName||school.schoolId);total.minutes+=Number(teacher.totalMinutes||0);
      for(const type of types){total.course[type].sessions+=Number(teacher.course?.[type]?.sessions||0);total.course[type].minutes+=Number(teacher.course?.[type]?.minutes||0)}
    }
    return [...map.values()].sort((a,b)=>b.minutes-a.minutes||String(a.teacherName).localeCompare(String(b.teacherName),"zh-Hant"));
  }
  function globalOpsBreadcrumb(school,teacher){
    let html='<div class="global-ops-breadcrumb"><button class="secondary" onclick="openGlobalOpsSchools()">全部學校</button>';
    if(school)html+='<span>›</span><button class="secondary" onclick="openGlobalOpsSchool(\''+esc(school.schoolId)+'\')">'+esc(school.schoolName)+'</button>';
    if(teacher)html+='<span>›</span><b>'+esc(teacher.teacherName)+'</b>';
    return html+'</div>';
  }
  function globalOpsLayer1(report,busy){
    const total=report.totals||{},schools=(report.schools||[]);
    const teachers=crossSchoolTeacherTotals(schools),types=globalCourseTypes;
    const courseTotals=Object.fromEntries(types.map(type=>[type,schools.reduce((out,school)=>{const course=school.courseSummary?.[type]||{};out.sessions+=Number(course.sessions||0);out.minutes+=Number(course.minutes||0);return out},{sessions:0,minutes:0})]));
    const teacherRows=teachers.map(t=>'<div class="global-ops-teacher"><div class="global-ops-teacher-head"><div><b>👤 '+esc(t.teacherName)+'</b><small>'+esc([...new Set(t.schools)].join("、"))+'</small></div><strong class="global-ops-teacher-hours">'+globalHours(t.minutes/60)+'</strong></div><div class="global-ops-teacher-breakdown">'+types.map(type=>'<span>'+globalCourseIcons[type]+' '+globalCourseLabels[type]+'<br><b>'+Number(t.course[type].sessions)+(type==="performance"?' 場｜':' 堂｜')+globalHours(t.course[type].minutes/60)+'</b></span>').join("")+'</div><button class="secondary" style="width:auto;margin:9px 0 0;padding:7px 10px" onclick="exportGlobalTeacherAttendance('+globalActionArg(t.key)+')">⬇️ 匯出這位老師課堂明細 CSV</button></div>').join("");
    const cards=schools.map(school=>{
      const s=school.summary||{},att=s.groupAttendance||{};
      return '<div class="global-ops-school-card"><div class="student"><div><b style="font-size:16px">🏫 '+esc(school.schoolName||school.schoolId)+'</b><small>'+esc(st[school.status]||school.status||"")+(school.cityName?'｜'+esc(school.cityName):'')+'</small></div><button class="secondary" style="width:auto;margin:0" onclick="openGlobalOpsSchool(\''+esc(school.schoolId)+'\')">查看老師工時 →</button></div>'+
        '<div class="global-ops-grid"><div class="global-ops-stat"><b>'+Number(s.groupSessions||0)+'</b><small>團體課已點名堂數</small></div><div class="global-ops-stat"><b>'+attendanceRateText(att.attendanceRate)+'</b><small>分部／合奏／綜合到課率</small></div><div class="global-ops-stat"><b>'+Number(s.privateLessons||0)+'</b><small>個課完成堂數</small></div><div class="global-ops-stat"><b>'+globalHours(s.totalTeachingHours||0)+'</b><small>已辨識老師工時（含展演）</small></div><div class="global-ops-stat"><b>'+globalRating(s.parentFeedbackAverage)+'</b><small>家長個課回饋｜'+Number(s.parentFeedbackCount||0)+' 筆</small></div></div>'+
        (Number(s.unassignedSessions||0)?'<div class="notice" style="margin-top:8px">⚠️ 有 '+Number(s.unassignedSessions||0)+' 堂團體課無法唯一辨識授課老師，暫不計入老師工時；第三層仍保留點名人供稽核。</div>':'')+
      '</div>';
    }).join("");
    return '<div class="card"><div class="section-title"><div><h2>📊 月度課務／師資工時</h2><div class="muted">第一層｜各校月度總覽</div></div><span class="badge ok">'+esc(report.month||"")+'</span></div>'+
      '<div class="notice"><b>統計原則</b><br>分部、合奏、綜合課依已完成點名認列；個課依老師完課紀錄認列；加練依學校管理員確認的實際授課分鐘認列。展演由 Global 在活動結束後確認每位老師的實際分鐘，再另列工時；單純排定活動不列入。按老師 Gmail 合併跨校工時，保留各校明細供核對。</div>'+
      '<div class="row2" style="align-items:end"><div><label>統計月份</label><input type="month" value="'+esc(report.month||state.globalTenant.attendanceMonth)+'" onchange="changeGlobalAttendanceMonth(this.value)" '+(busy?'disabled':'')+'></div><div><button class="secondary" style="width:100%" onclick="exportGlobalAttendance()" '+(busy?'disabled':'')+'>⬇️ 匯出全體老師月工時 CSV（含五類上課日期）</button></div></div><button class="secondary" style="width:100%;margin-top:8px" onclick="refreshGlobalAttendance()" '+(busy?'disabled':'')+'>🔄 重新統計此月份</button><small style="display:block;margin-top:7px">總表每校每位老師一列；日期欄同日多堂會標註堂數。下方可依老師匯出逐堂明細，跨校授課會合併列出。</small>'+
      '<div class="global-ops-grid"><div class="global-ops-stat"><b>'+Number(total.groupSessions||0)+'</b><small>跨校團體課堂數</small></div><div class="global-ops-stat"><b>'+attendanceRateText(total.groupAttendance?.attendanceRate)+'</b><small>跨校團體課到課率</small></div><div class="global-ops-stat"><b>'+Number(total.privateLessons||0)+'</b><small>個課完成堂數</small></div><div class="global-ops-stat"><b>'+globalHours(total.totalTeachingHours||0)+'</b><small>老師總工時（含展演）</small></div><div class="global-ops-stat"><b>'+globalRating(total.parentFeedbackAverage)+'</b><small>家長回饋｜'+Number(total.parentFeedbackCount||0)+' 筆</small></div></div>'+
      '<h3 style="margin:16px 0 6px">五類課程與展演月度總計</h3><div class="global-ops-course-grid">'+types.map(type=>'<div class="global-ops-course-card"><b>'+globalCourseIcons[type]+' '+globalCourseLabels[type]+'</b><strong>'+courseTotals[type].sessions+' '+(type==="performance"?'場':'堂')+'</strong><small>已認列 '+globalHours(courseTotals[type].minutes/60)+'</small></div>').join("")+'</div>'+
      '<h3 style="margin:16px 0 6px">跨校老師月工時（'+teachers.length+' 人）</h3>'+(teacherRows||'<div class="notice">本月尚無老師資料。</div>')+
      '<h3 style="margin:16px 0 6px">各校明細</h3>'+
      (busy?'<div class="notice" style="margin-top:10px">正在更新月份統計…</div>':cards||'<div class="notice" style="margin-top:10px">目前沒有學校資料。</div>')+
    '</div>';
  }
  function globalOpsLayer2(report,school){
    const s=school.summary||{},teachers=school.teachers||[],courses=school.courseSummary||{};
    const rows=teachers.map(t=>{
      const c=t.course||{},privateInfo=c.privateLesson||{};
      return '<div class="global-ops-teacher"><div class="global-ops-teacher-head"><div><b>👤 '+esc(t.teacherName||"老師")+'</b><small>家長回饋 '+Number(t.parentFeedbackCount||0)+' 筆｜'+globalRating(t.parentFeedbackAverage)+'</small></div><div><div class="global-ops-teacher-hours">'+globalHours(t.totalHours||0)+'</div><button class="secondary" style="width:auto;margin:5px 0 0;padding:6px 9px" onclick="openGlobalOpsTeacher(\''+esc(school.schoolId)+'\',\''+encodeURIComponent(String(t.teacherKey||""))+'\')">查看課堂稽核 →</button><button class="secondary" style="width:auto;margin:5px 0 0;padding:6px 9px" onclick="exportGlobalTeacherAttendance('+globalActionArg(globalTeacherKey(school,t))+','+globalActionArg(school.schoolId)+')">⬇️ 匯出逐堂明細 CSV</button></div></div>'+
        '<div class="global-ops-teacher-breakdown">'+
          '<span>🎼 分部<br><b>'+Number(c.section?.sessions||0)+' 堂｜'+globalHours(c.section?.hours||0)+'</b></span>'+
          '<span>🎻 合奏<br><b>'+Number(c.ensemble?.sessions||0)+' 堂｜'+globalHours(c.ensemble?.hours||0)+'</b></span>'+
          '<span>🎶 綜合<br><b>'+Number(c.comprehensive?.sessions||0)+' 堂｜'+globalHours(c.comprehensive?.hours||0)+'</b></span>'+
          '<span>⏱️ 加練<br><b>'+Number(c.practice?.sessions||0)+' 堂｜'+globalHours(c.practice?.hours||0)+'</b></span>'+
          '<span>👤 個課<br><b>'+Number(privateInfo.sessions||0)+' 堂｜'+globalHours(privateInfo.hours||0)+'</b></span>'+
          '<span>🎵 展演<br><b>'+Number(c.performance?.sessions||0)+' 場｜'+globalHours(c.performance?.hours||0)+'</b></span>'+
        '</div></div>';
    }).join("");
    return '<div class="card">'+globalOpsBreadcrumb(school,null)+'<div class="section-title"><div><h2>🏫 '+esc(school.schoolName)+'｜老師月度工時</h2><div class="muted">第二層｜依老師拆分課別、堂數與時數</div></div><span class="badge ok">'+esc(report.month||"")+'</span></div>'+
      '<div class="global-ops-grid"><div class="global-ops-stat"><b>'+Number(s.groupSessions||0)+'</b><small>團體課已點名堂數</small></div><div class="global-ops-stat"><b>'+attendanceRateText(s.groupAttendance?.attendanceRate)+'</b><small>團體課到課率</small></div><div class="global-ops-stat"><b>'+Number(s.privateLessons||0)+'</b><small>個課堂數</small></div><div class="global-ops-stat"><b>'+globalHours(s.totalTeachingHours||0)+'</b><small>已辨識工時（含展演）</small></div><div class="global-ops-stat"><b>'+Number(s.unassignedSessions||0)+'</b><small>待確認授課老師堂數</small></div></div>'+
      '<h3 style="margin:16px 0 6px">課別與展演月度概況</h3><div class="global-ops-course-grid">'+globalCourseTypes.map(k=>globalCourseCard(k,courses[k])).join("")+'</div>'+
      '<div class="notice" style="margin-top:10px"><b>⏱️ 加練課</b><br>由各校管理員在加練後確認實際授課老師及分鐘數；僅已確認、未取消的活動計入工時。此欄不代表學生出勤。</div>'+
      '<h3 style="margin:16px 0 6px">老師月度工時</h3>'+(rows||'<div class="notice">本月尚無可辨識的老師教學紀錄。</div>')+
    '</div>';
  }
  function globalOpsLayer3(report,school,teacher){
    const course=teacher.course||{},sessions=teacher.sessions||[];
    const audits=sessions.map(x=>{
      const privateType=x.courseType==="privateLesson",att=x.attendance||{},mergeText=(x.mergedSections||[]).length?"併班 "+x.mergedSections.join("、")+" → "+x.section:"",where=[x.groupName?x.groupName+"團":"",mergeText||x.section||""].filter(Boolean).join("｜");
      const recorder=x.recordedBy?('點名／紀錄人：'+esc(x.recordedBy)+(x.recordedByRole==="admin"?'（行政協助）':'')):"點名／紀錄人：未記錄";
      const detail=privateType
        ?'個課 '+Number(x.durationMinutes||0)+' 分鐘｜家長回饋 '+(x.feedbackCount?globalRating(x.feedbackAverage):"未評分")
        :x.courseType==="performance"
          ?'展演實際參與 '+Number(x.durationMinutes||0)+' 分鐘｜'+esc(x.location||"")+'｜確認時間 '+esc(x.confirmedAt||"")
        :x.courseType==="practice"
          ?'校方確認實際授課 '+Number(x.durationMinutes||0)+' 分鐘｜確認時間 '+esc(x.confirmedAt||"")
          :'應到 '+Number(att.total||0)+'｜到課 '+Number(att.attended||0)+'｜請假 '+Number(att.leave||0)+'｜缺席 '+Number(att.absent||0)+'｜遲到 '+Number(att.late||0)+'｜'+attendanceRateText(att.attendanceRate);
      return '<div class="global-ops-audit"><div class="global-ops-audit-head"><b>'+globalCourseIcons[x.courseType]+' '+esc(x.eventDate)+'｜'+esc(x.courseLabel||globalCourseLabels[x.courseType]||x.courseType)+(where?'｜'+esc(where):'')+'</b><strong>'+globalHours(x.teachingHours||0)+'</strong></div><small>'+detail+'<br>授課認列：'+esc(x.teacherSource||"")+'｜'+recorder+'</small></div>';
    }).join("");
    return '<div class="card">'+globalOpsBreadcrumb(school,teacher)+'<div class="section-title"><div><h2>🔎 '+esc(teacher.teacherName)+'｜課堂稽核</h2><div class="muted">第三層｜逐堂核對日期、課別、點名與工時來源</div></div><span class="badge ok">'+globalHours(teacher.totalHours||0)+'</span></div>'+
      '<div class="global-ops-grid"><div class="global-ops-stat"><b>'+Number(course.section?.sessions||0)+'</b><small>分部課堂數</small></div><div class="global-ops-stat"><b>'+Number(course.ensemble?.sessions||0)+'</b><small>合奏課堂數</small></div><div class="global-ops-stat"><b>'+Number(course.comprehensive?.sessions||0)+'</b><small>綜合課堂數</small></div><div class="global-ops-stat"><b>'+Number(course.practice?.sessions||0)+'</b><small>加練課堂數</small></div><div class="global-ops-stat"><b>'+Number(course.privateLesson?.sessions||0)+'</b><small>個課堂數</small></div><div class="global-ops-stat"><b>'+Number(course.performance?.sessions||0)+'</b><small>展演活動場次</small></div></div>'+
      '<div class="notice" style="margin-top:10px"><b>授課老師 ≠ 點名人</b><br>若 School Admin 協助點名，工時不會直接算到管理員；Global 會優先依老師授課設定與老師本人點名判斷。無法唯一判定的課堂不計入老師工時，避免誤算。</div><button class="secondary" style="width:auto;margin-top:9px" onclick="exportGlobalTeacherAttendance('+globalActionArg(globalTeacherKey(school,teacher))+','+globalActionArg(school.schoolId)+')">⬇️ 匯出這位老師逐堂明細 CSV</button>'+
      '<h3 style="margin:16px 0 6px">本月課堂明細</h3>'+(audits||'<div class="notice">本月沒有可稽核的課堂。</div>')+
    '</div>';
  }
  function crossSchoolAttendanceBox(){
    const report=state.globalTenant.attendance,busy=state.globalTenant.attendanceLoading;
    if(!report)return '<div class="card"><h2>📊 月度課務／師資工時</h2><div class="notice">尚未取得課務彙總。</div></div>';
    const schoolId=String(state.globalTenant.operationsSchoolId||""),school=(report.schools||[]).find(x=>String(x.schoolId)===schoolId);
    if(!school){state.globalTenant.operationsSchoolId="";state.globalTenant.operationsTeacherKey="";return globalOpsLayer1(report,busy)}
    const teacherKey=String(state.globalTenant.operationsTeacherKey||""),teacher=(school.teachers||[]).find(x=>String(x.teacherKey)===teacherKey);
    if(!teacher){state.globalTenant.operationsTeacherKey="";return globalOpsLayer2(report,school)}
    return globalOpsLayer3(report,school,teacher);
  }
  function globalTeacherSupportBox(){
    const data=state.globalTenant.teacherSupport;
    if(!data)return '<div class="card"><h2>👩‍🏫 跨校師資調度</h2><div class="notice">正在載入老師名冊…</div></div>';
    if(data.error)return '<div class="card"><h2>👩‍🏫 跨校師資調度</h2><div class="error">'+esc(data.error)+'</div><button class="secondary" onclick="refreshGlobalTeacherSupport()">重新載入</button></div>';
    const schools=data.schools||[],active=schools.filter(s=>["active","onboarding"].includes(s.status)),today=data.today||"",names=new Map(schools.map(s=>[s.schoolId,s.schoolName]));
    const source=active.find(s=>s.schoolId===state.globalTenant.supportSourceSchoolId)||active.find(s=>(s.teachers||[]).some(t=>t.status==="active"))||active[0];
    const teachers=(source?.teachers||[]).filter(t=>t.status==="active"),targets=active.filter(s=>s.schoolId!==source?.schoolId);
    const rosters=schools.map(s=>`<details class="global-ops-school-card"><summary><b>🏫 ${esc(s.schoolName)}</b>｜${(s.teachers||[]).filter(t=>t.status==="active").length} 位啟用老師</summary>${(s.teachers||[]).map(t=>`<div class="item"><div><b>${esc(t.teacherName||t.email)}</b><small>${esc(t.email)}</small></div><span class="badge ${t.status==="active"?"ok":"warn"}">${t.status==="active"?"啟用":"停用"}</span></div>`).join("")||'<div class="notice">尚無老師。</div>'}</details>`).join("");
    const assignments=schools.flatMap(s=>(s.assignments||[]).map(x=>({...x,targetName:s.schoolName,sourceName:names.get(x.sourceSchoolId)||x.sourceSchoolId}))).sort((a,b)=>String(b.startDate).localeCompare(String(a.startDate)));
    const assignmentRow=x=>`<div class="global-ops-teacher"><div class="global-ops-teacher-head"><div><b>${esc(x.teacherName)}</b><small>${esc(x.sourceName)} → ${esc(x.targetName)}｜${esc(globalCourseLabels[x.courseType]||x.courseType)}｜${esc(x.groupName==="ALL"?"全團":x.groupName)} ${esc(x.section||"")}<br>${esc(x.startDate)}～${esc(x.endDate)}｜${esc(x.reason||"")}</small></div><span class="badge ${x.status==="active"&&x.endDate>=today?"ok":"warn"}">${x.status==="revoked"?"已取消":x.endDate<today?"已到期":x.startDate>today?"即將生效":"支援中"}</span></div>${x.status==="active"&&x.endDate>=today?`<button class="secondary" style="width:auto;margin:8px 0 0" onclick="revokeGlobalTeacherSupport(${globalActionArg(x.targetSchoolId)},${globalActionArg(x.assignmentId)})">提前取消</button>`:""}</div>`;
    const eventTeachers=active.map(s=>`<div class="global-ops-school-card"><b>🏫 ${esc(s.schoolName)}</b>${(s.teachers||[]).filter(t=>t.status==="active").map(t=>`<label class="check"><input type="checkbox" class="globalEventTeacherPick" data-school-id="${esc(s.schoolId)}" value="${esc(t.email)}"><span>${esc(t.teacherName||t.email)}｜${esc(t.email)}</span></label>`).join("")||'<small>沒有啟用老師</small>'}</div>`).join("");
    const eventRows=(data.events||[]).slice().sort((a,b)=>String(b.eventDate).localeCompare(String(a.eventDate))).slice(0,80).map(e=>{
      const scheduled=Math.max(1,(Number(e.endTime.slice(0,2))*60+Number(e.endTime.slice(3,5)))-(Number(e.startTime.slice(0,2))*60+Number(e.startTime.slice(3,5))));
      const people=(e.participants||[]).map(p=>`<div class="item"><div><b>${esc(p.teacherName)}</b><small>${esc(names.get(p.schoolId)||p.schoolId)}｜${esc(p.email)}</small></div>${e.status==="planned"?`<label style="width:100px;margin:0">實際分鐘<input type="number" min="1" max="600" data-email="${esc(p.email)}" value="${scheduled}"></label>`:`<b>${Number(p.minutes||0)} 分鐘</b>`}</div>`).join("");
      return `<details class="global-ops-teacher"><summary><b>${esc(e.title)}</b>｜${esc(e.eventDate)} ${esc(e.startTime)}–${esc(e.endTime)}｜${(e.participants||[]).length} 位｜${e.status==="confirmed"?"已確認":e.status==="cancelled"?"已取消":"待確認"}</summary><div style="margin-top:8px">${e.location?"地點："+esc(e.location)+"<br>":""}${e.note?"備註："+esc(e.note)+"<br>":""}<div id="globalEventMinutes_${esc(e.eventId)}">${people}</div>${e.status==="planned"&&e.eventDate<=today?`<button class="primary" style="width:auto;margin:8px 6px 0 0" onclick="confirmGlobalTeacherEvent(${globalActionArg(e.eventId)})">確認逐位實際工時</button>`:e.status==="planned"?"<small>結束後可確認工時。</small>":""}${e.status!=="cancelled"?`<button class="secondary" style="width:auto;margin:8px 0 0" onclick="cancelGlobalTeacherEvent(${globalActionArg(e.eventId)})">取消活動與工時</button>`:""}</div></details>`;
    }).join("");
    return `<div class="card"><div class="section-title"><h2>👩‍🏫 跨校師資調度與展演</h2><span class="badge ok">${schools.length} 校</span></div><div class="notice">短期代課限指定學校、日期、課別及團別，可提前取消。展演排程不產生工時；活動結束後逐位確認實際分鐘，才會進入月報。</div><button class="secondary" onclick="refreshGlobalTeacherSupport()">🔄 更新名冊</button></div>
      <div class="card"><h3>各校老師清單</h3>${rosters}</div>
      <div class="card"><h3>＋ 臨時指派代課</h3><div class="row2"><div><label>來源學校</label><select onchange="setGlobalSupportSource(this.value)">${active.map(s=>`<option value="${esc(s.schoolId)}" ${s.schoolId===source?.schoolId?"selected":""}>${esc(s.schoolName)}</option>`).join("")}</select></div><div><label>來源老師</label><select id="supportTeacherEmail">${teachers.map(t=>`<option value="${esc(t.email)}">${esc(t.teacherName)}｜${esc(t.email)}</option>`).join("")}</select></div></div><div class="row2"><div><label>支援學校</label><select id="supportTargetSchool">${targets.map(s=>`<option value="${esc(s.schoolId)}">${esc(s.schoolName)}</option>`).join("")}</select></div><div><label>課別</label><select id="supportCourseType" onchange="setGlobalSupportCourseType(this.value)"><option value="section">分部課</option><option value="ensemble">合奏課</option><option value="comprehensive">綜合課</option><option value="practice">加練課</option></select></div></div><div class="row2"><div><label>團別</label><select id="supportGroupName"><option value="A">A 團</option><option value="B">B 團</option><option value="儲備">儲備團</option><option value="ALL">全團（綜合／加練）</option></select></div><div><label>分部（分部課使用）</label><select id="supportSection">${["小提一部","小提二部","中提","大提","低音提"].map(x=>`<option>${esc(x)}</option>`).join("")}</select></div></div><div class="row2"><div><label>開始日期</label><input id="supportStartDate" type="date" min="${esc(today)}" value="${esc(today)}"></div><div><label>結束日期（含當日）</label><input id="supportEndDate" type="date" min="${esc(today)}" value="${esc(today)}"></div></div><label>原因／內容</label><input id="supportReason" maxlength="180" placeholder="例：老師請假，跨校支援三天"><button class="primary" onclick="createGlobalTeacherSupport()" ${!teachers.length||!targets.length?"disabled":""}>指派短期支援</button><small>最長 31 天。代課老師用自己的 Gmail 切換到支援學校；加練另需由校方指定該場活動的老師 Gmail。</small></div>
      <div class="card"><h3>進行中／即將生效</h3>${assignments.filter(x=>x.status==="active"&&x.endDate>=today).map(assignmentRow).join("")||'<div class="notice">目前沒有短期指派。</div>'}<details><summary>查看已到期／已取消（${assignments.filter(x=>x.status!=="active"||x.endDate<today).length}）</summary>${assignments.filter(x=>x.status!=="active"||x.endDate<today).slice(0,80).map(assignmentRow).join("")}</details></div>
      <div class="card"><h3>＋ 七校聯演／特殊展演</h3><div class="notice">工時按老師原所屬學校入帳，月報及逐堂 CSV 會呈現活動日期。</div><label>活動名稱</label><input id="globalEventTitle" maxlength="120" placeholder="例：七校弦樂聯合展演"><div class="row2"><div><label>日期</label><input id="globalEventDate" type="date" value="${esc(today)}"></div><div><label>地點</label><input id="globalEventLocation" maxlength="120"></div></div><div class="row2"><div><label>開始</label><input id="globalEventStart" type="time"></div><div><label>結束</label><input id="globalEventEnd" type="time"></div></div><label>備註</label><input id="globalEventNote" maxlength="300"><h4>參與老師（可跨校勾選）</h4>${eventTeachers}<button class="primary" onclick="createGlobalTeacherEvent()">建立展演排程</button></div>
      <div class="card"><h3>展演活動紀錄</h3>${eventRows||'<div class="notice">尚無展演紀錄。</div>'}</div>`;
  }
  window.setGlobalSupportSource=function(schoolId){state.globalTenant.supportSourceSchoolId=String(schoolId||"");draw();document.getElementById("globalTeacherSupport")?.scrollIntoView({block:"start"})};
  window.setGlobalSupportCourseType=function(type){const group=document.getElementById("supportGroupName"),section=document.getElementById("supportSection");if(group)group.value=["comprehensive","practice"].includes(type)?"ALL":"A";if(section)section.disabled=type!=="section"};
  window.refreshGlobalTeacherSupport=async function(){
    if(state.globalTenant.supportLoading)return;state.globalTenant.supportLoading=true;
    try{state.globalTenant.teacherSupport=await api("/api/global-teacher-support?_="+Date.now())}catch(e){state.globalTenant.teacherSupport={error:e.message};toast("❌ "+e.message)}
    state.globalTenant.supportLoading=false;draw();
  };
  window.createGlobalTeacherSupport=async function(){
    const sourceSchoolId=state.globalTenant.supportSourceSchoolId||(state.globalTenant.teacherSupport?.schools||[]).find(s=>["active","onboarding"].includes(s.status)&&(s.teachers||[]).some(t=>t.status==="active"))?.schoolId;
    const v=id=>document.getElementById(id)?.value||"";
    const body={action:"assign",sourceSchoolId,targetSchoolId:v("supportTargetSchool"),teacherEmail:v("supportTeacherEmail"),courseType:v("supportCourseType"),groupName:v("supportGroupName"),section:v("supportSection"),startDate:v("supportStartDate"),endDate:v("supportEndDate"),reason:v("supportReason")};
    try{await api("/api/global-teacher-support",{method:"POST",body:JSON.stringify(body)});toast("✅ 短期支援已指派");await window.refreshGlobalTeacherSupport()}catch(e){toast("❌ "+e.message)}
  };
  window.revokeGlobalTeacherSupport=async function(targetSchoolId,assignmentId){
    if(!confirm("確定提前取消支援？取消後立即失去該校代課權限，歷史紀錄仍保留。"))return;
    try{await api("/api/global-teacher-support",{method:"PATCH",body:JSON.stringify({action:"revokeAssignment",targetSchoolId,assignmentId})});toast("✅ 已取消支援");await window.refreshGlobalTeacherSupport()}catch(e){toast("❌ "+e.message)}
  };
  window.createGlobalTeacherEvent=async function(){
    const v=id=>document.getElementById(id)?.value||"";
    const body={action:"createEvent",title:v("globalEventTitle"),eventDate:v("globalEventDate"),startTime:v("globalEventStart"),endTime:v("globalEventEnd"),location:v("globalEventLocation"),note:v("globalEventNote"),participants:[...document.querySelectorAll(".globalEventTeacherPick:checked")].map(x=>({schoolId:x.dataset.schoolId,email:x.value}))};
    try{await api("/api/global-teacher-support",{method:"POST",body:JSON.stringify(body)});toast("✅ 展演已排定");await window.refreshGlobalTeacherSupport()}catch(e){toast("❌ "+e.message)}
  };
  window.confirmGlobalTeacherEvent=async function(eventId){
    const minutesByTeacher=[...(document.getElementById("globalEventMinutes_"+eventId)?.querySelectorAll("input[data-email]")||[])].map(x=>({email:x.dataset.email,minutes:Number(x.value)}));
    try{await api("/api/global-teacher-support",{method:"PATCH",body:JSON.stringify({action:"confirmEvent",eventId,minutesByTeacher})});toast("✅ 已確認展演工時");await window.refreshGlobalTeacherSupport();await window.refreshGlobalAttendance()}catch(e){toast("❌ "+e.message)}
  };
  window.cancelGlobalTeacherEvent=async function(eventId){
    if(!confirm("確定取消展演？若工時已確認，月報會扣除，但活動紀錄保留。"))return;
    try{await api("/api/global-teacher-support",{method:"PATCH",body:JSON.stringify({action:"cancelEvent",eventId})});toast("已取消展演");await window.refreshGlobalTeacherSupport();await window.refreshGlobalAttendance()}catch(e){toast("❌ "+e.message)}
  };
  window.openGlobalOpsSchools=function(){state.globalTenant.operationsSchoolId="";state.globalTenant.operationsTeacherKey="";draw()};
  window.openGlobalOpsSchool=function(sid){state.globalTenant.operationsSchoolId=String(sid||"");state.globalTenant.operationsTeacherKey="";draw();setTimeout(()=>document.querySelector(".global-ops-breadcrumb")?.scrollIntoView({behavior:"smooth",block:"start"}),20)};
  window.openGlobalOpsTeacher=function(sid,key){state.globalTenant.operationsSchoolId=String(sid||"");state.globalTenant.operationsTeacherKey=decodeURIComponent(String(key||""));draw();setTimeout(()=>document.querySelector(".global-ops-breadcrumb")?.scrollIntoView({behavior:"smooth",block:"start"}),20)};
  function platformHealthBox(){
    const health=state.globalTenant.health,busy=state.globalTenant.healthLoading;
    if(!health)return '<div class="card"><h2>🩺 平台健康度</h2><div class="notice">尚未取得健康檢查結果。</div></div>';
    const statusMeta={healthy:["✅ 正常","global-health-healthy"],warning:["⚠️ 注意","global-health-warning"],critical:["🚨 異常","global-health-critical"]},overall=statusMeta[health.overall]||statusMeta.warning;
    let checkedAt=health.checkedAt||"";try{checkedAt=new Date(checkedAt).toLocaleString("zh-TW",{timeZone:"Asia/Taipei",hour12:false})}catch{}
    const checks=(health.checks||[]).map(check=>{const meta=statusMeta[check.status]||statusMeta.warning;return '<div class="global-health-row"><div><b>'+esc(check.label||check.key)+'</b><small style="display:block;color:var(--muted);margin-top:3px">'+esc(check.detail||"")+'</small></div><span class="global-health-pill '+meta[1]+'">'+meta[0]+'</span></div>'}).join("");
    const tableRows=(health.isolation?.byTable||[]).map(item=>'<div class="item"><div><b>'+esc(item.label||item.key)+'</b><small>'+Number(item.rows||0)+' 筆已掃描</small></div><b style="color:'+(Number(item.invalid||0)?'var(--bad)':'var(--green)')+'">'+(Number(item.invalid||0)?Number(item.invalid)+' 筆異常':'✅')+'</b></div>').join("");
    return '<div class="card"><div class="student"><div><h2 style="margin:0">🩺 平台健康度</h2><div class="muted">最後檢查：'+esc(checkedAt||"未記錄")+'</div></div><span class="global-health-pill '+overall[1]+'">'+overall[0]+'</span></div><div class="grid" style="margin-top:12px"><div class="kpi"><b>'+Number(health.summary?.healthy||0)+'</b><span>正常</span></div><div class="kpi"><b>'+Number(health.summary?.warning||0)+'</b><span>注意</span></div><div class="kpi"><b>'+Number(health.summary?.critical||0)+'</b><span>異常</span></div><div class="kpi"><b>'+Number(health.isolation?.rows||0)+'</b><span>隔離鍵值掃描</span></div></div><div style="margin-top:10px">'+checks+'</div><details style="margin-top:10px"><summary><b>Tenant 資料表掃描明細</b></summary>'+tableRows+'</details><button class="secondary" style="width:100%;margin-top:10px" onclick="refreshGlobalHealth()" '+(busy?'disabled':'')+'>'+(busy?'檢查中…':'🔄 重新檢查平台健康度')+'</button><div class="notice" style="margin-top:10px">健康檢查只回傳設定是否存在、資料筆數與錯誤數，不會顯示環境變數內容或帳號個資。</div></div>';
  }
  window.previewGlobalBrandingColor=function(value){
    if(!/^#[0-9A-Fa-f]{6}$/.test(String(value||"")))return;
    state.globalBranding={...(state.globalBranding||{}),primaryColor:value};
    if(typeof window.setGlobalBranding==="function")window.setGlobalBranding(state.globalBranding);
  };
  window.previewGlobalBrandingLogo=function(input){
    const f=input?.files?.[0];globalBrandLogoFile=null;
    if(globalBrandPreviewUrl){URL.revokeObjectURL(globalBrandPreviewUrl);globalBrandPreviewUrl=""}
    if(!f)return;
    if(!["image/png","image/jpeg","image/webp"].includes(f.type)){input.value="";toast("❌ Global Logo 只支援 PNG、JPG、WebP");return}
    if(f.size>2*1024*1024){input.value="";toast("❌ Global Logo 檔案需小於 2MB");return}
    globalBrandLogoFile=f;globalBrandPreviewUrl=URL.createObjectURL(f);
    const img=document.getElementById("globalBrandingPreview");if(img)img.src=globalBrandPreviewUrl;
  };
  window.saveGlobalBranding=async function(){
    if(state.globalBrandingAdmin.loading)return;
    const payload={siteName:document.getElementById("globalBrandSiteName")?.value||"",schoolName:document.getElementById("globalBrandSchoolName")?.value||"",loginSubtitle:document.getElementById("globalBrandSubtitle")?.value||"",logoAlt:document.getElementById("globalBrandLogoAlt")?.value||"",primaryColor:document.getElementById("globalBrandColor")?.value||"#3155A4"};
    const logoFile=globalBrandLogoFile;
    state.globalBrandingAdmin.loading=true;state.globalBrandingAdmin.error="";draw();
    try{
      let saved=await api("/api/global-branding",{method:"PATCH",body:JSON.stringify(payload)});
      if(logoFile){
        const dataUrl=await readGlobalBrandDataUrl(logoFile);
        const uploaded=await api("/api/global-branding-logo",{method:"POST",body:JSON.stringify({dataUrl})});
        saved=uploaded.branding||saved;
      }
      const verified=await api("/api/global-branding?_="+Date.now(),{cache:"no-store"});
      state.globalBranding={...(state.globalBranding||{}),...saved,...verified};
      if(typeof window.setGlobalBranding==="function")window.setGlobalBranding(state.globalBranding);
      globalBrandLogoFile=null;if(globalBrandPreviewUrl){URL.revokeObjectURL(globalBrandPreviewUrl);globalBrandPreviewUrl=""}
      toast("✅ Global 品牌設定已儲存並立即套用");
    }catch(e){state.globalBrandingAdmin.error=e.message||String(e);toast("❌ "+(e.message||e))}
    state.globalBrandingAdmin.loading=false;draw();
  };
  window.restoreGlobalBrandingLogo=async function(){
    if(!confirm("確定恢復預設 Global Logo？"))return;
    state.globalBrandingAdmin.loading=true;draw();
    try{
      await api("/api/global-branding-logo",{method:"DELETE"});
      const b=await api("/api/global-branding");
      state.globalBranding={...(state.globalBranding||{}),...b};
      if(typeof window.setGlobalBranding==="function")window.setGlobalBranding(state.globalBranding);
      toast("✅ 已恢復預設 Global Logo");
    }catch(e){state.globalBrandingAdmin.error=e.message||String(e);toast("❌ "+(e.message||e))}
    state.globalBrandingAdmin.loading=false;draw();
  };
  window.runTenantMigration=async function(action){
    if(state.globalTenant.migrationBusy)return;
    const labels={preview:"預覽",backfill:"安全回填",verify:"完整性驗證"};
    if(action==="backfill"&&!confirm("將既有聖心資料複製為 schoolId=sacred-heart 的 Tenant scoped 鍵值。\n\n不會刪除或覆寫舊鍵值資料，並可安全重跑。確定開始？"))return;
    state.globalTenant.migrationBusy=true;draw();
    try{
      const result=await api("/api/tenant-migration",{method:"POST",body:JSON.stringify({action})});
      state.globalTenant.migration=result;
      const missing=Number(result.summary?.totals?.missing||0),extra=Number(result.summary?.totals?.extra||0),mismatched=Number(result.summary?.totals?.mismatched||0),differences=missing+extra+mismatched;
      toast((differences===0?"✅ ":"⚠️ ")+(labels[action]||action)+"完成"+(differences?"，缺 "+missing+"／多 "+extra+"／異 "+mismatched+" 筆":""));
    }catch(e){toast("❌ Phase 2 "+(labels[action]||action)+"失敗："+(e.message||e))}
    state.globalTenant.migrationBusy=false;draw();
  };
  window.changeGlobalAttendanceMonth=async function(month){
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month||""))){toast("月份格式不正確");return}
    state.globalTenant.attendanceMonth=month;state.globalTenant.operationsSchoolId="";state.globalTenant.operationsTeacherKey="";
    await window.refreshGlobalAttendance();
  };
  window.refreshGlobalAttendance=async function(){
    if(state.globalTenant.attendanceLoading)return;
    state.globalTenant.attendanceLoading=true;draw();
    try{state.globalTenant.attendance=await api("/api/global-attendance?month="+encodeURIComponent(state.globalTenant.attendanceMonth))}catch(e){toast("❌ 月度工時讀取失敗："+e.message)}
    state.globalTenant.attendanceLoading=false;draw();
  };
  function globalCourseDates(teacher,type){
    const counts=new Map();
    for(const session of teacher.sessions||[]){
      if(session.courseType!==type)continue;
      const date=String(session.eventDate||"").trim()||"日期未記錄";
      counts.set(date,(counts.get(date)||0)+1);
    }
    return [...counts].sort(([a],[b])=>a.localeCompare(b)).map(([date,count])=>date+(count>1?"（"+count+" 堂）":"")).join("；");
  }
  function downloadGlobalCsv(rows,filename){
    const cell=value=>{let valueText=String(value??"");if(/^\s*[=+\-@]/.test(valueText))valueText="'"+valueText;return '"'+valueText.replace(/"/g,'""')+'"'};
    const blob=new Blob(["\ufeff"+rows.map(row=>row.map(cell).join(",")).join("\r\n")],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),link=document.createElement("a");
    link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  const globalCsvFilenamePart=value=>String(value||"teacher").replace(/[\\/:*?"<>|\x00-\x1f]/g,"_").trim().slice(0,80)||"teacher";
  window.exportGlobalAttendance=function(){
    const report=state.globalTenant.attendance;if(!report)return;
    const rows=[["月份","schoolId","學校","老師","總工時（含展演）","分部課堂數","分部課時數","合奏課堂數","合奏課時數","綜合課堂數","綜合課時數","加練課堂數","加練課時數","個課堂數","個課時數","家長回饋筆數","家長平均星等","分部課上課日期","合奏課上課日期","綜合課上課日期","加練課上課日期","個別課上課日期","展演活動場次","展演活動時數","展演活動日期"]];
    for(const school of report.schools||[]){
      for(const t of school.teachers||[]){const c=t.course||{};rows.push([report.month,school.schoolId,school.schoolName,t.teacherName,Number(t.totalHours||0),Number(c.section?.sessions||0),Number(c.section?.hours||0),Number(c.ensemble?.sessions||0),Number(c.ensemble?.hours||0),Number(c.comprehensive?.sessions||0),Number(c.comprehensive?.hours||0),Number(c.practice?.sessions||0),Number(c.practice?.hours||0),Number(c.privateLesson?.sessions||0),Number(c.privateLesson?.hours||0),Number(t.parentFeedbackCount||0),t.parentFeedbackAverage==null?"":Number(t.parentFeedbackAverage),...["section","ensemble","comprehensive","practice","privateLesson"].map(type=>globalCourseDates(t,type)),Number(c.performance?.sessions||0),Number(c.performance?.hours||0),globalCourseDates(t,"performance")])}
    }
    downloadGlobalCsv(rows,"global-teacher-workload-"+report.month+".csv");
  };
  window.exportGlobalTeacherAttendance=function(key,schoolId){
    const report=state.globalTenant.attendance;if(!report)return;
    const selected=[];
    for(const school of report.schools||[]){
      if(schoolId&&String(school.schoolId)!==String(schoolId))continue;
      for(const teacher of school.teachers||[])if(globalTeacherKey(school,teacher)===String(key))selected.push({school,teacher});
    }
    if(!selected.length){toast("找不到這位老師的月度資料，請重新統計月份");return}
    const lessons=selected.flatMap(({school,teacher})=>(teacher.sessions||[]).filter(session=>globalCourseTypes.includes(session.courseType)).map(session=>({school,teacher,session})));
    if(!lessons.length){toast("這位老師本月沒有可匯出的課堂明細");return}
    lessons.sort((a,b)=>String(a.session.eventDate||"").localeCompare(String(b.session.eventDate||""))||globalCourseTypes.indexOf(a.session.courseType)-globalCourseTypes.indexOf(b.session.courseType)||String(a.school.schoolId).localeCompare(String(b.school.schoolId))||String(a.session.sessionKey||"").localeCompare(String(b.session.sessionKey||"")));
    const rows=[["月份","schoolId","學校","老師","上課日期","課別","授課分鐘","教學時數","課程／團別","分部","併班原分部","工時認列來源","點名／紀錄人","活動地點"]];
    for(const {school,teacher,session} of lessons){
      rows.push([report.month,school.schoolId,school.schoolName,teacher.teacherName,String(session.eventDate||"").trim()||"日期未記錄",globalCourseLabels[session.courseType],Number(session.durationMinutes||0),Number(session.teachingHours||0),["practice","performance"].includes(session.courseType)?session.courseLabel||"":session.groupName||"",session.section||"",(session.mergedSections||[]).join("、"),session.teacherSource||"",session.recordedBy||"",session.location||""]);
    }
    const totalMinutes=lessons.reduce((sum,{session})=>sum+Number(session.durationMinutes||0),0);
    rows.push(["合計","","",selected[0].teacher.teacherName,"","",totalMinutes,Math.round(totalMinutes/60*100)/100,"","","","","",""]);
    downloadGlobalCsv(rows,"global-teacher-detail-"+report.month+"-"+globalCsvFilenamePart(selected[0].teacher.teacherName)+(schoolId?"-"+globalCsvFilenamePart(schoolId):"")+".csv");
  };
  window.refreshGlobalHealth=async function(){
    if(state.globalTenant.healthLoading)return;state.globalTenant.healthLoading=true;draw();
    try{state.globalTenant.health=await api("/api/global-health?_="+Date.now());toast("✅ 平台健康檢查已更新")}catch(e){toast("❌ 健康檢查失敗："+e.message)}
    state.globalTenant.healthLoading=false;draw();
  };
  window.copyTenantOnboardingLink=async function(sid,role){
    const link=onboardingUrl(String(sid||""),String(role||""));
    try{await navigator.clipboard.writeText(link);toast("✅ 測試入口已複製")}catch{window.prompt("請複製測試入口",link)}
  };
  window.setTenantOnboardingCheck=async function(sid,checkKey,passed){
    if(state.globalTenant.onboardingBusy)return;
    if(passed&&!confirm("請確認您已實際使用對應角色帳號完成此項跨校隔離測試。\n\n確認結果會留下 Global 稽核紀錄。")){draw();return}
    state.globalTenant.onboardingBusy=true;draw();
    try{await api("/api/tenant-onboarding",{method:"POST",body:JSON.stringify({action:"confirm",schoolId:sid,checkKey,passed:passed===true})});toast(passed?"✅ 隔離驗證已確認":"↩️ 已取消此項確認");state.globalTenant.onboardingBusy=false;await loadGlobal(true)}catch(e){toast("❌ "+e.message);state.globalTenant.onboardingBusy=false;draw()}
  };
  window.runTenantOnboardingAction=async function(action,sid){
    if(state.globalTenant.onboardingBusy)return;
    const school=(state.globalTenant.onboarding||[]).find(x=>String(x.schoolId)===String(sid)),name=school?.schoolName||sid;
    if(action==="start"&&!confirm("開始「"+name+"」Phase 4 隔離驗證？\n\n測試帳號會被限制在此校 Tenant；這不會正式啟用學校，也不會刪除資料。"))return;
    if(action==="pause"&&!confirm("暫停「"+name+"」隔離驗證？\n\n學校會回到建置中，既有測試資料與驗證紀錄會保留。"))return;
    if(action==="activate"&&!confirm("確定正式啟用「"+name+"」？\n\n啟用後，第二校老師、家長與 School Admin 將進入正式營運。只有所有安全條件通過時，伺服器才會允許此操作。"))return;
    state.globalTenant.onboardingBusy=true;draw();
    try{
      await api("/api/tenant-onboarding",{method:"POST",body:JSON.stringify({action,schoolId:sid})});
      const labels={start:"已進入隔離驗證模式",verify:"安全條件已重新驗證",activate:"已正式啟用第二校",pause:"已暫停隔離驗證"};toast("✅ "+(labels[action]||"Phase 4 操作完成"));
      state.globalTenant.onboardingBusy=false;await loadGlobal(true);
    }catch(e){toast("❌ "+e.message);state.globalTenant.onboardingBusy=false;draw()}
  };

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
    const managed=(d.schools||[]).filter(x=>x.isSchoolManager).length;
    return '<section id="globalOverview"><div class="card hero">'+(sessionStorage.getItem("school_context_id")?'<button class="secondary" style="margin:0 0 10px" onclick="returnToGlobalTenant()">← 返回 Global 觀察模式</button>':'')+
      '<h2>🌐 Global 管理中心｜Phase 4</h2><div class="notice"><b>跨校管理採彙總最小揭露</b><br>Global 可查看各校人數、月度課務、老師教學工時與個課家長回饋彙總；學生與家長個人明細仍不跨校揭露。第二校必須完成隔離驗證才可正式啟用。</div>'+
      '<div class="grid" style="margin-top:12px"><div class="kpi"><b>'+Number(d.schoolCount||0)+'</b><span>加入學校</span></div><div class="kpi"><b>'+Number(d.totals?.students||0)+'</b><span>在籍學生</span></div><div class="kpi"><b>'+Number(d.totals?.teachers||0)+'</b><span>啟用老師</span></div><div class="kpi"><b>'+Number(d.totals?.parentAccounts||0)+'</b><span>家長帳號</span></div></div>'+
      '<div class="grid" style="margin-top:10px"><div class="kpi"><b>'+Number(d.statusCounts?.active||0)+'</b><span>正式營運</span></div><div class="kpi"><b>'+Number(d.statusCounts?.onboarding||0)+'</b><span>隔離驗證中</span></div><div class="kpi"><b>'+Number(d.totals?.todayAttendanceRecords||0)+'</b><span>今日點名</span></div><div class="kpi"><b>'+managed+'</b><span>我管理的學校</span></div></div></div></section>'+
      '<section id="globalOnboarding">'+phase4OnboardingBox()+'</section>'+
      '<section id="globalOperations">'+crossSchoolAttendanceBox()+'</section>'+
      '<section id="globalTeacherSupport">'+globalTeacherSupportBox()+'</section>'+
      '<section id="globalHealth">'+platformHealthBox()+'</section>'+
      '<section id="globalSchools"><div class="card"><h2>🏫 學校管理</h2><div class="notice">可編輯學校基本資料與 School Admin；一般設定無法直接啟用第二校，生命週期由 Phase 4 安全門控管。</div><label>行政區篩選</label><select onchange="filterGlobalRegion(this.value)">'+regionOptions+'</select><div class="muted" style="margin-top:8px">目前顯示 '+schools.length+' / '+Number(d.schoolCount||0)+' 所學校</div></div><div class="desktop-school-grid">'+schools.map(schoolCard).join("")+'</div></section>'+
      '<section id="globalSettings" class="desktop-global-tools">'+createBox()+globalBrandingBox()+phase2MigrationBox()+(typeof window.globalSystemBackupHtml==="function"?window.globalSystemBackupHtml():"")+'</section>';
  }
  function draw(){if(state.page==="global"&&canGlobal()){const a=document.getElementById("app");if(a){a.innerHTML=shell(page());setTimeout(()=>window.updateTenantIdPreview?.(),0)}}}
  window.openGlobalTenant=async function(){if(!canGlobal())return;state.page="global";draw();await loadGlobal(true)};
  window.returnToGlobalTenant=function(){sessionStorage.setItem("role_context","global");sessionStorage.removeItem("school_context_id");location.reload()};
  window.enterSchoolAdmin=function(sid){sessionStorage.setItem("role_context","schoolAdmin");sessionStorage.setItem("school_context_id",String(sid||""));location.reload()};
  window.bindSelfSchoolAdmin=async function(sid){
    const email=String(state.me?.email||"").trim();if(!email)return;
    try{await api("/api/tenant-admins",{method:"PATCH",body:JSON.stringify({schoolId:sid,email,action:"grant"})});toast("✅ 已將您的 Global 帳號綁定為此校 School Admin");await loadGlobal(true)}catch(e){toast("❌ "+e.message)}
  };
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
  window.saveSchoolTenant=async function(sid){
    const body={schoolId:sid,schoolName:document.getElementById("tenantName_"+sid)?.value.trim(),shortName:document.getElementById("tenantShort_"+sid)?.value.trim(),systemName:document.getElementById("tenantSystem_"+sid)?.value.trim(),cityCode:document.getElementById("tenantCity_"+sid)?.value,schoolLevel:document.getElementById("tenantLevel_"+sid)?.value,timezone:document.getElementById("tenantTimezone_"+sid)?.value||"Asia/Taipei",status:sid==="sacred-heart"?"active":document.getElementById("tenantStatus_"+sid)?.value};
    if(!body.schoolName||!body.cityCode||!body.schoolLevel){toast("請完整填寫學校名稱、縣市與學制");return}
    try{await api("/api/tenant-directory",{method:"PATCH",body:JSON.stringify(body)});toast("✅ 學校設定已儲存");await loadGlobal(true)}catch(e){toast("❌ "+e.message)}
  };
  window.grantSchoolAdmin=async function(sid){
    const email=document.getElementById("globalAdminEmail_"+sid)?.value.trim();if(!email){toast("請輸入此校管理員 Email");return}
    try{await api("/api/tenant-admins",{method:"PATCH",body:JSON.stringify({schoolId:sid,email,action:"grant"})});toast("✅ 已指定此校 School Admin");await loadGlobal(true)}catch(e){toast("❌ "+e.message)}
  };
  window.grantKnownSchoolAdmin=async function(sid,email){
    try{await api("/api/tenant-admins",{method:"PATCH",body:JSON.stringify({schoolId:sid,email,action:"grant"})});toast("✅ 已重新啟用此校 School Admin");await loadGlobal(true)}catch(e){toast("❌ "+e.message)}
  };
  window.revokeSchoolAdmin=async function(sid,email){
    const school=(state.globalTenant.tenants||[]).find(x=>String(x.schoolId)===String(sid));
    if(!confirm("確定移除 "+email+" 在「"+(school?.schoolName||sid)+"」的 School Admin 權限？\n\n不會刪除帳號、學生或學校資料。"))return;
    try{await api("/api/tenant-admins",{method:"PATCH",body:JSON.stringify({schoolId:sid,email,action:"revoke"})});toast("✅ 已移除此校 School Admin 權限");await loadGlobal(true)}catch(e){toast("❌ "+e.message)}
  };
  function mountEntry(){
    if(!canGlobal()||state.page!=="admin")return;const main=document.querySelector(".main");if(!main)return;
    let root=document.getElementById("globalTenantEntry");if(!root){root=document.createElement("div");root.id="globalTenantEntry";main.prepend(root)}
    root.innerHTML='<div class="card"><h2>🌐 Global 多校管理</h2><div class="notice">您目前正在「'+esc(state.me?.schoolName||"學校")+'」School Admin 後台。Global 權限與學校後台權限彼此獨立。</div><button class="primary" onclick="returnToGlobalTenant()">← 返回 Global 管理中心</button></div>';
  }
  const baseNav=nav;
  nav=function(){
    if(state.me?.role==="globalAdmin"&&state.page!=="contextSelect")return "";
    return baseNav();
  };
  const bg=go;go=async function(p){if(p==="global"&&canGlobal()){await openGlobalTenant();return}return bg(p)};
  const br=render;render=function(){
    if(state.page==="global"&&canGlobal()){
      draw();
      if(!state.globalTenant.loaded&&!state.globalTenant.loading)setTimeout(()=>loadGlobal(false),0);
      return;
    }
    const r=br();
    if(canGlobal()&&state.page==="admin")setTimeout(mountEntry,0);
    return r
  };
  const bh=typeof home==="function"?home:null;
  if(bh)home=function(){if(state.me?.role==="tenantPending")return '<div class="card hero"><h2>🏫 '+esc(state.me.schoolName||"學校")+'｜系統建置中</h2><div class="notice">您的 School Admin 權限已建立，但此學校尚未完成多租戶資料隔離，因此暫不開放營運後台。這項保護可避免看到其他學校資料。</div></div>';return bh()};
  if(state.me?.role==="globalAdmin"&&canGlobal()&&state.page!=="contextSelect")setTimeout(()=>window.openGlobalTenant(),0);
  else if(canGlobal()&&state.page==="admin")setTimeout(mountEntry,0);
})();
