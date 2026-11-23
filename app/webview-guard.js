(()=>{
  const ua=navigator.userAgent||"";
  const isIOS=/iPhone|iPad|iPod/i.test(ua);
  const isAndroid=/Android/i.test(ua);
  const isLine=/\bLine\//i.test(ua);
  const isSocial=/FBAN|FBAV|Instagram|MicroMessenger|Twitter|Messenger|TikTok|Snapchat|ChatGPT/i.test(ua);
  const isIOSWebView=isIOS&&/AppleWebKit/i.test(ua)&&!/Safari/i.test(ua);
  const isAndroidWebView=isAndroid&&(/;\s*wv\)/i.test(ua)||/\bwv\b/i.test(ua));
  const embedded=isLine||isSocial||isIOSWebView||isAndroidWebView;
  const current=new URL(location.href);
  if(current.searchParams.get("google_redirect")==="1"){sessionStorage.setItem("google_id_token","cookie-session");current.searchParams.delete("google_redirect");history.replaceState({},"",current.pathname+(current.search?current.search:"")+current.hash)}
  const lineSchool=current.searchParams.get("line_session");
  if(lineSchool&&/^[a-z0-9-]{2,60}$/.test(lineSchool)){
    sessionStorage.setItem("google_id_token","line-session");
    sessionStorage.setItem("school_context_id",lineSchool);
    sessionStorage.removeItem("role_context");
    current.searchParams.delete("line_session");
    history.replaceState({},"",current.pathname+(current.search?current.search:"")+current.hash);
  }
  const staffMenuRoutes={
    staff_today_courses:["attendance","followup"],
    staff_activity_calendar:["courses"],
    staff_announcements:["uniformAdmin","activity"] ,
    staff_attendance:["attendance","regular"],
    staff_todos:["tasks"],
    staff_portal:["home"]
  };
  const staffEntryKey="line_staff_entry";
  function validStaffEntry(entry){
    return entry&&Object.hasOwn(staffMenuRoutes,entry.target)&&/^[a-z0-9-]{2,60}$/.test(entry.schoolId||"");
  }
  const requestedEntry={target:current.searchParams.get("line_menu"),schoolId:current.searchParams.get("schoolId")};
  if(validStaffEntry(requestedEntry)){
    sessionStorage.setItem(staffEntryKey,JSON.stringify(requestedEntry));
    sessionStorage.setItem("school_context_id",requestedEntry.schoolId);
    sessionStorage.setItem("role_context","schoolAdmin");
  }else if(requestedEntry.target){
    sessionStorage.removeItem(staffEntryKey);
  }else if(lineSchool&&getLineStaffEntry()?.schoolId===lineSchool){
    sessionStorage.setItem("role_context","schoolAdmin");
  }
  function getLineStaffEntry(){
    try{
      const entry=JSON.parse(sessionStorage.getItem(staffEntryKey)||"null");
      return validStaffEntry(entry)?entry:null;
    }catch{return null}
  }
  window.getLineStaffEntry=getLineStaffEntry;
  async function openStaffMenuEntry(){
    const entry=getLineStaffEntry();
    if(!entry)return;
    sessionStorage.removeItem(staffEntryKey);
    const url=new URL(location.href);
    if(url.searchParams.has("line_menu")){
      for(const name of ["line_menu","schoolId","openExternalBrowser"])url.searchParams.delete(name);
      history.replaceState(history.state,"",url.pathname+url.search+url.hash);
    }
    if(state.me?.role!=="admin"||state.me.schoolId!==entry.schoolId){
      toast("請使用已綁定此校管理員 Gmail 的 LINE 帳號登入。");
      return;
    }
    try{
      const [group,task]=staffMenuRoutes[entry.target];
      if(task==="regular"||task==="followup")await window.openSchoolAdminAttendanceTask(task);
      else if(task==="activity")await window.openSchoolAdminActivitySettings();
      else await window.openSchoolAdminWorkspace(group);
    }catch(error){toast("無法開啟 LINE 選單入口："+(error.message||"請稍後重試"))}
  }
  window.__lineEmbedded=isLine;
  function cleanUrl(){const u=new URL(location.href);u.searchParams.delete("openExternalBrowser");u.searchParams.delete("openInAppBrowser");u.searchParams.delete("google_redirect");return u.toString()}
  function lineExternalUrl(){const u=new URL(cleanUrl());u.searchParams.set("openExternalBrowser","1");return u.toString()}
  window.copyOrchestraUrl=async()=>{const url=cleanUrl();try{await navigator.clipboard.writeText(url);alert("網址已複製，請貼到 Safari 或 Chrome 開啟。")}catch{const t=document.createElement("textarea");t.value=url;document.body.appendChild(t);t.select();document.execCommand("copy");t.remove();alert("網址已複製，請貼到 Safari 或 Chrome 開啟。")}};
  if(embedded&&!isLine){const platform=isIOS?"Safari":isAndroid?"Chrome":"外部瀏覽器";const action=isLine?`<a class="primary" style="display:block;text-align:center;text-decoration:none" href="${lineExternalUrl()}">用 ${platform} 開啟</a>`:`<button class="primary" onclick="copyOrchestraUrl()">複製網址，用 ${platform} 開啟</button>`;document.getElementById("app").innerHTML=`<div class="login-wrap"><div class="login-card"><div class="logo">🎻</div><h1>聖心小學弦樂團</h1><p>Google Gmail 登入</p><div class="error" style="margin-top:16px"><b>目前是在 App 內建瀏覽器中開啟</b><br><br>Google 為保護帳號，不支援 Android／iOS WebView 登入，因此可能只看到白畫面。</div><div class="notice" style="margin-top:12px">請改用 <b>${platform}</b> 開啟本系統，再按「使用 Google 帳戶登入」。${isLine?"<br><br>下方按鈕會要求 LINE 改用外部瀏覽器開啟。":""}</div>${action}<button class="secondary" style="width:100%;margin-top:10px" onclick="copyOrchestraUrl()">複製網站網址</button></div></div>`;return}
  function appendScript(src,onload,onerror){
    const existing=[...document.scripts].find(s=>s.getAttribute("src")===src);
    if(existing){if(onload)setTimeout(onload,0);return existing}
    const s=document.createElement("script");s.src=src;s.defer=true;
    if(onload)s.onload=onload;if(onerror)s.onerror=onerror;document.body.appendChild(s);return s
  }
  const scriptLoads=new Map();
  function loadScript(src){
    if(scriptLoads.has(src))return scriptLoads.get(src);
    const request=new Promise((resolve,reject)=>{
      let script,done=false;
      const finish=error=>{if(done)return;done=true;clearTimeout(timer);if(error){script?.remove();reject(error)}else resolve()};
      const timer=setTimeout(()=>finish(new Error("功能載入逾時")),15000);
      script=appendScript(src,()=>finish(),()=>finish(new Error("功能載入失敗")));
    }).catch(error=>{scriptLoads.delete(src);throw error});
    scriptLoads.set(src,request);
    return request;
  }
  async function loadSeries(list){
    for(const src of list){
      await loadScript(src);
      if(state.me?.role!=="parent")continue;
      const initialized=src.startsWith("/parent-home-summary.js")?window.parentHomeSummaryReady===true:
        src.startsWith("/private-lesson-confirmation.js")?typeof window.privateLessonParentPanels==="function":true;
      if(!initialized){
        scriptLoads.delete(src);
        [...document.scripts].find(script=>script.getAttribute("src")===src)?.remove();
        throw new Error("家長功能初始化未完成");
      }
    }
  }
  function roleModules(){
    const role=String(state?.me?.role||""),cap=state?.me?.capabilities||{};
    if(role==="admin")return [
      "/roster-support.js",
      "/student-number-support.js?v=20261121-line-first-notice-labels",
      "/student-change-admin.js?v=20261102-student-workflow",
      "/parent-link-admin.js?v=20261122-admin-quick-workspace",
      "/teacher-settings.js?v=20261002-teacher-types",
      "/teacher-admin.js?v=20261122-admin-quick-workspace",
      "/batch-upgrade.js?v=20261102-student-workflow",
      "/roster-import.js?v=20261102-student-workflow",
      "/attendance-support.js?v=20261124-attendance-report-layout",
      "/attendance-edit.js?v=20261002-save-confirm",
      "/practice-progress.js?v=20261122-encouragement-notice",
      "/admin-operations.js?v=20261123-account-navigation",
      "/admin-followup-summary-fix.js?v=20260917-1320",
      "/system-backup.js?v=20261003-practice20",
      "/school-access.js?v=20261027-school-followup",
      "/school-access-audit-admin.js?v=20261017-simple-records",
      "/school-admin-activity.js?v=20261025-restore",
      "/school-access-refresh-fix.js?v=20261015-finance-role-tenant-line-20261115",
      "/training-attendance.js?v=20261102-activity-boundary"
    ];
    if(["teacher","sectionTeacher","ensembleTeacher","comprehensiveTeacher","privateTeacher"].includes(role)||cap.teacherSettings)return [
      "/roster-support.js",
      "/section-support.js?v=20260930-section-merge",
      "/teacher-support.js?v=20260929-late10",
      "/teacher-settings.js?v=20261002-teacher-types",
      "/private-student-bottom-back.js?v=20260915-1432",
      "/attendance-support.js?v=20261124-attendance-report-layout",
      "/attendance-edit.js?v=20261002-save-confirm",
      "/practice-progress.js?v=20261122-encouragement-notice",
      "/teacher-navigation.js?v=20261002-teacher-types-home-priorities-20261119",
      "/training-attendance.js?v=20261102-activity-boundary",
      "/comprehensive-support.js?v=20261002-save-confirm",
      "/private-lesson-confirmation.js?v=20261122-practice-goal-progress",
      "/teacher-line-account.js?v=20261119-teacher-binding-home-priorities-notification-center"
    ];
    if(["unassigned","contextDenied"].includes(role))return [
      "/school-access.js?v=20261027-school-followup",
      "/school-access-refresh-fix.js?v=20261015-finance-role-tenant-line-20261115"
    ];
    if(role==="school")return ["/school-access.js?v=20261027-school-followup"];
    if(role==="parent")return [
      "/parent-activity-notice.js?v=20261016-new-activity-alert-parent-tasks",
      "/uniform-payment-state.js?v=20261121-payment-resolution-owner",
      "/practice-timer.js?v=20261004-manual4h",
      "/private-lesson-confirmation.js?v=20261122-practice-goal-progress",
      "/parent-semester-attendance.js?v=20261003-practice20",
      "/parent-home-summary.js?v=20261103-tshirt-size-reminder-payment-resolution-owner-20261121",
      "/parent-uniform-payment-notice.js?v=20261121-payment-resolution-owner",
      "/parent-practice-history.js?v=20261003-practice-history-toggle",
      "/special-calendar.js?v=20261102-training-form-home-priorities-20261119"
    ];
    if(role==="globalAdmin")return [
      "/school-access.js?v=20261027-school-followup",
      "/school-access-audit-admin.js?v=20261017-simple-records",
      "/school-access-refresh-fix.js?v=20261015-finance-role-tenant-line-20261115"
    ];
    return [];
  }
  function preloadScripts(list){
    for(const src of list){
      if(document.querySelector('link[data-role-preload="'+CSS.escape(src)+'"]'))continue;
      const l=document.createElement("link");l.rel="preload";l.as="script";l.href=src;l.dataset.rolePreload=src;document.head.appendChild(l);
    }
  }
  function roleScriptList(){
    return [...roleModules(),"/desktop-ui.js?v=20261102-learning-workspace",...(state.me?.role==="admin"?["/school-admin-workspace.js?v=20261123-account-navigation","/student-admin-workspace.js?v=20261102-student-workflow"]:[])];
  }
  window.preloadRoleModules=()=>{
    if(typeof state!=="undefined"&&["parent","admin"].includes(state.me?.role))preloadScripts(roleScriptList());
  };
  function teacherWarmup(){
    const role=String(state?.me?.role||""),cap=state?.me?.capabilities||{};
    const isTeacher=["teacher","sectionTeacher","ensembleTeacher","comprehensiveTeacher","privateTeacher"].includes(role)||cap.teacherSettings;
    if(!isTeacher||typeof api!=="function")return Promise.resolve();
    const scope=roleScope(),date=new Date().toLocaleDateString("sv-SE"),month=date.slice(0,7);
    const setup=api("/api/teacher-profile").then(v=>{if(roleScope()===scope)state.teacherSetup=v}).catch(()=>{});
    const status=Promise.all([
      api("/api/attendance-report?month="+encodeURIComponent(month)),
      api("/api/practice-progress?month="+encodeURIComponent(month))
    ]).then(([att,practice])=>{
      if(roleScope()===scope){state.teacherTodayStatus=att;state.teacherAttention=practice;state.teacherTodayStatusDate=date}
    }).catch(()=>{});
    return Promise.allSettled([setup,status]);
  }
  const roleScope=()=>JSON.stringify([state.me?.identityId||state.me?.email||"",state.me?.role||"",state.me?.schoolId||"",state.token||""]);
  let roleModuleTask=null,adminInitialDataFailed=false;
  function loadRoleModules(){
    if(roleModuleTask)return roleModuleTask;
    if(typeof state==="undefined"||!state.me||window.__roleModulesReady||window.__roleModuleError)return Promise.resolve();
    const list=roleScriptList(),scope=roleScope();
    const adminData=state.me.role==="admin"?window.__adminInitialDataTask:null;
    preloadScripts(list);
    window.__roleModuleBootstrap=true;
    document.documentElement.classList.add("role-modules-loading");
    roleModuleTask=(async()=>{
      try{
        await Promise.all([loadSeries(list),teacherWarmup(),adminData?Promise.resolve(adminData).catch(error=>{if(roleScope()===scope)adminInitialDataFailed=true;throw error}):Promise.resolve()]);
        if(roleScope()===scope){
          if(state.me?.role==="parent"&&(window.parentHomeSummaryReady!==true||typeof window.privateLessonParentPanels!=="function"))throw new Error("家長功能初始化未完成");
          window.__roleModulesReady=true;
          window.__roleLoaderActive=false;
        }
      }catch(error){
        if(roleScope()===scope){window.__roleModuleError=error.message||"功能載入失敗";console.warn("Role modules could not be prepared",error)}
      }finally{
        window.__roleModuleBootstrap=false;
        document.documentElement.classList.remove("role-modules-loading");
        roleModuleTask=null;
      }
      if(roleScope()!==scope){
        window.__roleModulesReady=false;window.__roleLoaderActive=true;window.__roleModuleError="";
        if(state.me)loadRoleModules();
        else if(document.getElementById("app")?.innerHTML.includes("data-role-boot")&&typeof renderLogin==="function")renderLogin("登入已失效，請重新登入");
        return;
      }
      try{render()}catch(error){console.warn("Role page could not be rendered",error)}
      if(window.__roleModulesReady)await openStaffMenuEntry();
    })();
    return roleModuleTask;
  }
  // Login may finish long after the login page opens. Each authenticated render
  // resumes the same module task, rather than relying on a short startup timer.
  window.ensureRoleModules=loadRoleModules;
  window.retryRoleModules=()=>{
    window.__roleModuleError="";
    if(state.me?.role==="admin"&&adminInitialDataFailed&&typeof loadAdmin==="function"){
      adminInitialDataFailed=false;
      window.__adminInitialDataTask=loadAdmin();
    }
    const task=loadRoleModules();
    try{render()}catch{}
    return task;
  };
  window.resumeLineStaffEntry=()=>{if(sessionStorage.getItem(staffEntryKey))loadRoleModules()};
  function loadApp(){
    window.__roleLoaderActive=true;window.__roleModulesReady=false;
    appendScript("/app-v3.js?v=20261102-student-workflow-tenant-line-staff-session-20261116-teacher-line-paid-activity-school-admin-teacher-binding-20261119-home-priorities-notification-center-parent-login-ready-parent-login-fast-practice-goal-progress-20261122-admin-quick-workspace-account-navigation-production-cutover");
  }
  function installIOSRedirectMode(){let tries=0;const timer=setInterval(()=>{tries++;if(window.google?.accounts?.id?.initialize){clearInterval(timer);const nativeInitialize=window.google.accounts.id.initialize.bind(window.google.accounts.id);window.google.accounts.id.initialize=(config={})=>{const {callback,...rest}=config;return nativeInitialize({...rest,ux_mode:"redirect",login_uri:`${location.origin}/api/google-login`})};loadApp()}else if(tries>120){clearInterval(timer);loadApp()}},50)}
  document.addEventListener("click",async e=>{const btn=e.target.closest?.(".logout");if(!btn)return;e.preventDefault();e.stopImmediatePropagation();await Promise.allSettled([fetch("/api/google-logout",{method:"POST"}),fetch("/api/line/session/logout",{method:"POST"})]);sessionStorage.removeItem("google_id_token");sessionStorage.removeItem("school_context_id");sessionStorage.removeItem("role_context");location.href="/"},true);
  if(isIOS&&!isLine)installIOSRedirectMode();else loadApp();
})();
