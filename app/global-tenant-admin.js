(()=>{
  if(!document.getElementById("globalTenantStyles")){
    const style=document.createElement("style");style.id="globalTenantStyles";
    style.textContent=".global-manage-btn{border:0;border-radius:12px;padding:10px 14px;background:var(--green);color:#fff;font-weight:900;box-shadow:0 2px 6px rgba(0,0,0,.08)}.global-manage-btn:hover{filter:brightness(.95)}.global-danger-btn{border:1px solid var(--bad);border-radius:12px;padding:9px 11px;background:#fff7f7;color:var(--bad);font-weight:900}.global-danger-btn:hover{background:#fee2e2}.global-action-hint{display:block;font-size:11px;color:var(--muted);margin-top:4px}.global-school-card-open{border:2px solid var(--green);box-shadow:0 8px 20px rgba(0,0,0,.08)}.global-inline-admin{margin-top:14px;padding-top:14px;border-top:1px dashed var(--line)}.global-inline-admin h3{margin:0 0 8px;font-size:15px}.global-health-row{display:flex;gap:10px;align-items:flex-start;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--line)}.global-health-row:last-child{border-bottom:0}.global-health-pill{border-radius:999px;padding:4px 9px;font-size:12px;font-weight:900;white-space:nowrap}.global-health-healthy{background:#dcfce7;color:#166534}.global-health-warning{background:#fef3c7;color:#92400e}.global-health-critical{background:#fee2e2;color:#991b1b}.global-attendance-school{margin-top:10px;padding:12px;border:1px solid var(--line);border-radius:14px;background:#fff}";
    document.head.appendChild(style);
  }
  const taipeiMonth=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()).slice(0,7);
  state.globalTenant=state.globalTenant||{loaded:false,loading:false,dashboard:null,tenants:[],admins:[],selectedSchoolId:"",regionFilter:"",migration:null,migrationBusy:false,attendance:null,attendanceMonth:taipeiMonth(),attendanceLoading:false,health:null,healthLoading:false,error:""};
  if(state.globalTenant.migrationBusy===undefined)state.globalTenant.migrationBusy=false;
  if(!state.globalTenant.attendanceMonth)state.globalTenant.attendanceMonth=taipeiMonth();
  if(state.globalTenant.attendanceLoading===undefined)state.globalTenant.attendanceLoading=false;
  if(state.globalTenant.healthLoading===undefined)state.globalTenant.healthLoading=false;
  state.globalBrandingAdmin=state.globalBrandingAdmin||{loading:false,error:""};
  let globalBrandLogoFile=null,globalBrandPreviewUrl="";
  const canGlobal=()=>state.me?.capabilities?.globalAdmin===true;
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
      const r=await Promise.all([api("/api/global-dashboard"),api("/api/tenant-directory"),api("/api/global-branding"),api("/api/tenant-migration"),api("/api/global-attendance?month="+encodeURIComponent(state.globalTenant.attendanceMonth)),api("/api/global-health")]);
      state.globalTenant.dashboard=r[0];state.globalTenant.tenants=r[1].items||[];state.globalTenant.loaded=true;
      state.globalBranding={...(state.globalBranding||{}),...(r[2]||{})};
      state.globalTenant.migration=r[3]||null;
      state.globalTenant.attendance=r[4]||null;state.globalTenant.health=r[5]||null;
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
    if(selfIsAdmin&&x.status==="active"){
      selfAction='<div class="notice" style="margin-top:10px"><b>✅ 您目前是此校 School Admin</b><br>可以由 Global 切換進入此校正式營運後台。</div><button class="primary" onclick="enterSchoolAdmin(\''+esc(sid)+'\')">🏫 進入 '+esc(x.schoolName)+' 後台</button>';
    }else if(selfIsAdmin){
      selfAction='<div class="notice" style="margin-top:10px"><b>✅ 您已綁定為此校 School Admin</b><br>此校目前為「'+esc(st[x.status]||x.status)+'」，待 Tenant 資料隔離完成並啟用後，才可進入營運後台。</div>';
    }else{
      selfAction='<button class="secondary" style="width:100%;margin-top:10px" onclick="bindSelfSchoolAdmin(\''+esc(sid)+'\')">👤 將我的 Global 帳號綁定為此校管理員</button>';
    }
    const cityOptions=cities.map(option=>'<option value="'+esc(option[0])+'" '+(option[0]===x.cityCode?'selected':'')+'>'+esc(option[1])+'</option>').join("");
    const levelOptions=levels.map(option=>'<option value="'+esc(option[0])+'" '+(option[0]===x.schoolLevel?'selected':'')+'>'+esc(option[1])+'</option>').join("");
    const statusOptions=sid==="sacred-heart"?'<option value="active">啟用（固定）</option>':['setup','inactive'].map(value=>'<option value="'+value+'" '+(value===x.status?'selected':'')+'>'+esc(st[value]||value)+'</option>').join("");
    const schoolForm='<div class="global-inline-admin"><h3>🏫 學校基本設定</h3><div class="notice"><b>schoolId：'+esc(sid)+'</b><br>schoolId 建立後不可修改；非聖心學校在 Phase 4 Onboarding 與隔離驗證前只能維持「建置中」或「停用」。</div><label>學校名稱</label><input id="tenantName_'+esc(sid)+'" value="'+esc(x.schoolName||'')+'" maxlength="120"><div class="row2"><div><label>簡稱</label><input id="tenantShort_'+esc(sid)+'" value="'+esc(x.shortName||'')+'" maxlength="60"></div><div><label>系統名稱</label><input id="tenantSystem_'+esc(sid)+'" value="'+esc(x.systemName||'')+'" maxlength="160"></div></div><div class="row2"><div><label>縣市</label><select id="tenantCity_'+esc(sid)+'">'+cityOptions+'</select></div><div><label>學制</label><select id="tenantLevel_'+esc(sid)+'">'+levelOptions+'</select></div></div><div class="row2"><div><label>時區</label><select id="tenantTimezone_'+esc(sid)+'"><option value="Asia/Taipei" selected>Asia/Taipei</option></select></div><div><label>狀態</label><select id="tenantStatus_'+esc(sid)+'" '+(sid==="sacred-heart"?'disabled':'')+'>'+statusOptions+'</select></div></div><button class="primary" onclick="saveSchoolTenant(\''+esc(sid)+'\')">💾 儲存學校設定</button></div>';
    return schoolForm+'<div class="global-inline-admin"><h3>🔐 '+esc(x.schoolName)+'｜學校管理員</h3><div class="notice">Global 可管理此校 School Admin 權限；只有已被指定為此校管理員的帳號，才可以進入該校營運後台。</div>'+selfAction+list+revokedList+'<label>新增此校管理員 Google Email</label><input id="globalAdminEmail_'+esc(sid)+'" type="email" placeholder="admin@example.com"><button class="primary" onclick="grantSchoolAdmin(\''+esc(sid)+'\')">＋ 指定 '+esc(x.schoolName)+' School Admin</button></div>';
  }
  function schoolCard(x){
    const mode=x.dataMode==="tenant-scoped-operational"?"學生、家長、老師、出勤、練習與個別課資料均已 Tenant 化。":"Tenant 結構已備妥，但維持建置狀態且尚未加入正式營運資料。";
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
  function attendanceRateText(value){return value===null||value===undefined?"—":Number(value).toFixed(1)+"%"}
  function crossSchoolAttendanceBox(){
    const report=state.globalTenant.attendance,busy=state.globalTenant.attendanceLoading;
    if(!report)return '<div class="card"><h2>📊 跨校出勤統計</h2><div class="notice">尚未取得出勤彙總。</div></div>';
    const total=report.totals||{},classLabels={section:"分部課",ensemble:"合奏課",comprehensive:"綜合課",privateLesson:"個別課"};
    const schools=(report.schools||[]).map(school=>{
      const attendance=school.total||{},classes=school.byClass||{};
      const detail=Object.keys(classLabels).map(key=>{const item=classes[key]||{};return '<div class="item"><div><b>'+classLabels[key]+'</b><small>出席 '+Number(item.attended||0)+'｜請假 '+Number(item.leave||0)+'｜缺席 '+Number(item.absent||0)+'｜遲到 '+Number(item.late||0)+'</small></div><b>'+Number(item.total||0)+' 筆</b></div>'}).join("");
      return '<div class="global-attendance-school"><div class="student"><div><b>'+esc(school.schoolName||school.schoolId)+'</b><div class="muted">'+esc(st[school.status]||school.status||"")+'｜'+esc(school.cityName||"")+'</div></div><div style="text-align:right"><b style="font-size:20px">'+attendanceRateText(attendance.attendanceRate)+'</b><small style="display:block;color:var(--muted)">出席率</small></div></div><div class="grid" style="margin-top:10px"><div class="kpi"><b>'+Number(attendance.total||0)+'</b><span>有效點名</span></div><div class="kpi"><b>'+Number(attendance.attended||0)+'</b><span>已到（含遲到）</span></div><div class="kpi"><b>'+Number(attendance.leave||0)+'</b><span>請假</span></div><div class="kpi"><b>'+Number(attendance.absent||0)+'</b><span>缺席</span></div></div><details style="margin-top:10px"><summary><b>依課程類型查看</b></summary>'+detail+'</details></div>';
    }).join("");
    return '<div class="card"><h2>📊 跨校出勤統計</h2><div class="notice"><b>僅顯示彙總數字</b><br>月份由 Global 選擇，API 只使用伺服器已登錄的 Tenant 清單，不接受前端指定 schoolId，也不回傳學生或家長個資。</div><div class="row2" style="align-items:end"><div><label>統計月份</label><input type="month" value="'+esc(report.month||state.globalTenant.attendanceMonth)+'" onchange="changeGlobalAttendanceMonth(this.value)" '+(busy?'disabled':'')+'></div><div><button class="secondary" style="width:100%" onclick="exportGlobalAttendance()" '+(busy?'disabled':'')+'>⬇️ 匯出彙總 CSV</button></div></div><div class="grid" style="margin-top:12px"><div class="kpi"><b>'+Number(total.total||0)+'</b><span>有效點名</span></div><div class="kpi"><b>'+Number(total.attended||0)+'</b><span>已到（含遲到）</span></div><div class="kpi"><b>'+attendanceRateText(total.attendanceRate)+'</b><span>跨校出席率</span></div><div class="kpi"><b>'+Number(total.absent||0)+'</b><span>缺席</span></div></div>'+(busy?'<div class="notice" style="margin-top:10px">正在更新月份統計…</div>':schools)+'</div>';
  }
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
    state.globalTenant.attendanceMonth=month;state.globalTenant.attendanceLoading=true;draw();
    try{state.globalTenant.attendance=await api("/api/global-attendance?month="+encodeURIComponent(month))}catch(e){toast("❌ 跨校出勤讀取失敗："+e.message)}
    state.globalTenant.attendanceLoading=false;draw();
  };
  window.exportGlobalAttendance=function(){
    const report=state.globalTenant.attendance;if(!report)return;
    const labels={total:"全部課程",section:"分部課",ensemble:"合奏課",comprehensive:"綜合課",privateLesson:"個別課"},rows=[["月份","schoolId","學校","狀態","課程類型","有效點名","出席","遲到","請假","缺席","取消","出席率"]];
    for(const school of report.schools||[]){
      for(const key of Object.keys(labels)){
        const item=key==="total"?school.total:school.byClass?.[key];
        rows.push([report.month,school.schoolId,school.schoolName,school.status,labels[key],Number(item?.total||0),Number(item?.present||0),Number(item?.late||0),Number(item?.leave||0),Number(item?.absent||0),Number(item?.cancelled||0),attendanceRateText(item?.attendanceRate)]);
      }
    }
    const cell=value=>{let text=String(value??"");if(/^[=+\-@]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"'};
    const blob=new Blob(["\ufeff"+rows.map(row=>row.map(cell).join(",")).join("\r\n")],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),link=document.createElement("a");
    link.href=url;link.download="global-attendance-"+report.month+".csv";document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  window.refreshGlobalHealth=async function(){
    if(state.globalTenant.healthLoading)return;state.globalTenant.healthLoading=true;draw();
    try{state.globalTenant.health=await api("/api/global-health?_="+Date.now());toast("✅ 平台健康檢查已更新")}catch(e){toast("❌ 健康檢查失敗："+e.message)}
    state.globalTenant.healthLoading=false;draw();
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
    return '<div class="card hero">'+(sessionStorage.getItem("school_context_id")?'<button class="secondary" style="margin:0 0 10px" onclick="returnToGlobalTenant()">← 返回 Global 觀察模式</button>':'')+'<h2>🌐 Phase 3｜Global 管理中心</h2><div class="notice"><b>跨校管理採彙總最小揭露</b><br>Global 可查看各校人數、出勤與平台健康度，但不取得學生、家長或老師明細；只有綁定為該校 School Admin 後，才可切換進入該校後台。</div><div class="grid" style="margin-top:12px"><div class="kpi"><b>'+Number(d.schoolCount||0)+'</b><span>加入學校</span></div><div class="kpi"><b>'+Number(d.totals?.students||0)+'</b><span>在籍學生</span></div><div class="kpi"><b>'+Number(d.totals?.teachers||0)+'</b><span>啟用老師</span></div><div class="kpi"><b>'+Number(d.totals?.parentAccounts||0)+'</b><span>家長帳號</span></div></div><div class="grid" style="margin-top:10px"><div class="kpi"><b>'+Number(d.statusCounts?.active||0)+'</b><span>正式營運</span></div><div class="kpi"><b>'+Number(d.statusCounts?.setup||0)+'</b><span>建置中</span></div><div class="kpi"><b>'+Number(d.totals?.todayAttendanceRecords||0)+'</b><span>今日點名</span></div><div class="kpi"><b>'+managed+'</b><span>我管理的學校</span></div></div></div>'+crossSchoolAttendanceBox()+platformHealthBox()+'<div class="card"><h2>🏫 學校管理</h2><div class="notice">可編輯學校基本資料與 School Admin；新學校會保持建置中，正式啟用留待 Phase 4 隔離驗證完成。</div><label>行政區篩選</label><select onchange="filterGlobalRegion(this.value)">'+regionOptions+'</select><div class="muted" style="margin-top:8px">目前顯示 '+schools.length+' / '+Number(d.schoolCount||0)+' 所學校</div></div>'+schools.map(schoolCard).join("")+createBox()+globalBrandingBox()+phase2MigrationBox()+(typeof window.globalSystemBackupHtml==="function"?window.globalSystemBackupHtml():"");
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
