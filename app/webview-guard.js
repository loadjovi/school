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
  function cleanUrl(){const u=new URL(location.href);u.searchParams.delete("openExternalBrowser");u.searchParams.delete("openInAppBrowser");u.searchParams.delete("google_redirect");return u.toString()}
  function lineExternalUrl(){const u=new URL(cleanUrl());u.searchParams.set("openExternalBrowser","1");return u.toString()}
  window.copyOrchestraUrl=async()=>{const url=cleanUrl();try{await navigator.clipboard.writeText(url);alert("網址已複製，請貼到 Safari 或 Chrome 開啟。")}catch{const t=document.createElement("textarea");t.value=url;document.body.appendChild(t);t.select();document.execCommand("copy");t.remove();alert("網址已複製，請貼到 Safari 或 Chrome 開啟。")}};
  if(embedded){const platform=isIOS?"Safari":isAndroid?"Chrome":"外部瀏覽器";const action=isLine?`<a class="primary" style="display:block;text-align:center;text-decoration:none" href="${lineExternalUrl()}">用 ${platform} 開啟</a>`:`<button class="primary" onclick="copyOrchestraUrl()">複製網址，用 ${platform} 開啟</button>`;document.getElementById("app").innerHTML=`<div class="login-wrap"><div class="login-card"><div class="logo">🎻</div><h1>聖心小學弦樂團</h1><p>Google Gmail 登入</p><div class="error" style="margin-top:16px"><b>目前是在 App 內建瀏覽器中開啟</b><br><br>Google 為保護帳號，不支援 Android／iOS WebView 登入，因此可能只看到白畫面。</div><div class="notice" style="margin-top:12px">請改用 <b>${platform}</b> 開啟本系統，再按「使用 Google 帳戶登入」。${isLine?"<br><br>下方按鈕會要求 LINE 改用外部瀏覽器開啟。":""}</div>${action}<button class="secondary" style="width:100%;margin-top:10px" onclick="copyOrchestraUrl()">複製網站網址</button></div></div>`;return}
  function appendScript(src,onload,onerror){
    const existing=[...document.scripts].find(s=>s.getAttribute("src")===src);
    if(existing){if(onload)setTimeout(onload,0);return existing}
    const s=document.createElement("script");s.src=src;s.defer=true;
    if(onload)s.onload=onload;if(onerror)s.onerror=onerror;document.body.appendChild(s);return s
  }
  function loadScript(src){
    return new Promise((resolve,reject)=>appendScript(src,resolve,()=>reject(new Error("載入失敗："+src))));
  }
  async function loadSeries(list){
    for(const src of list){
      try{await loadScript(src)}catch(e){console.warn(e)}
    }
  }
  function waitForProfileReady(){
    return new Promise(resolve=>{
      let tries=0;
      const timer=setInterval(()=>{
        tries++;
        try{
          if(typeof state!=="undefined"&&state.me&&document.querySelector(".shell")){clearInterval(timer);resolve()}
          else if(tries>400){clearInterval(timer);resolve()}
        }catch(e){if(tries>400){clearInterval(timer);resolve()}}
      },25);
    });
  }
  function roleModules(){
    const role=String(state?.me?.role||""),cap=state?.me?.capabilities||{};
    if(role==="admin")return [
      "/roster-support.js",
      "/student-number-support.js?v=20260918-1105",
      "/student-change-admin.js?v=20260918-1015",
      "/parent-link-admin.js?v=20260921-0135",
      "/teacher-settings.js?v=20260924-2245",
      "/teacher-admin.js?v=20260925-0315",
      "/batch-upgrade.js",
      "/roster-import.js?v=20260915-1135",
      "/attendance-support.js?v=20260922-2015",
      "/attendance-edit.js",
      "/practice-progress.js?v=20260925-0205",
      "/admin-operations.js?v=20260920-0500",
      "/admin-followup-summary-fix.js?v=20260917-1320",
      "/system-backup.js?v=20260919-2305",
      "/school-access.js?v=20260920-0010",
      "/school-access-audit-admin.js?v=20260918-0005",
      "/school-access-refresh-fix.js?v=20260920-0245"
    ];
    if(["teacher","sectionTeacher","ensembleTeacher","comprehensiveTeacher","privateTeacher"].includes(role)||cap.teacherSettings)return [
      "/roster-support.js",
      "/section-support.js?v=20260924-2238",
      "/teacher-support.js?v=20260924-2245",
      "/teacher-settings.js?v=20260915-1415",
      "/private-student-bottom-back.js?v=20260915-1432",
      "/attendance-support.js?v=20260922-2015",
      "/attendance-edit.js",
      "/practice-progress.js?v=20260925-0205",
      "/teacher-navigation.js?v=20260924-2359",
      "/comprehensive-support.js?v=20260922-0715",
      "/private-lesson-confirmation.js?v=20260925-0415"
    ];
    if(role==="parent")return [
      "/practice-timer.js?v=20260918-0725",
      "/private-lesson-confirmation.js?v=20260925-0415",
      "/parent-semester-attendance.js?v=20260925-0415",
      "/parent-home-summary.js?v=20260925-0205"
    ];
    if(role==="globalAdmin")return [
      "/school-access.js?v=20260920-0010",
      "/school-access-audit-admin.js?v=20260918-0005",
      "/school-access-refresh-fix.js?v=20260920-0245"
    ];
    return [];
  }
  function preloadScripts(list){
    for(const src of list){
      if(document.querySelector('link[data-role-preload="'+CSS.escape(src)+'"]'))continue;
      const l=document.createElement("link");l.rel="preload";l.as="script";l.href=src;l.dataset.rolePreload=src;document.head.appendChild(l);
    }
  }
  function teacherWarmup(){
    const role=String(state?.me?.role||""),cap=state?.me?.capabilities||{};
    const isTeacher=["teacher","sectionTeacher","ensembleTeacher","comprehensiveTeacher","privateTeacher"].includes(role)||cap.teacherSettings;
    if(!isTeacher||typeof api!=="function")return Promise.resolve();
    const date=new Date().toLocaleDateString("sv-SE"),month=date.slice(0,7);
    const setup=api("/api/teacher-profile").then(v=>{state.teacherSetup=v}).catch(()=>{});
    const status=Promise.all([
      api("/api/attendance-report?month="+encodeURIComponent(month)),
      api("/api/practice-progress?month="+encodeURIComponent(month))
    ]).then(([att,practice])=>{
      state.teacherTodayStatus=att;state.teacherAttention=practice;state.teacherTodayStatusDate=date;
    }).catch(()=>{});
    return Promise.allSettled([setup,status]);
  }
  async function loadRoleModules(){
    await waitForProfileReady();
    if(typeof state==="undefined"||!state.me)return;
    const list=roleModules();
    preloadScripts(list);
    window.__roleModuleBootstrap=true;
    document.documentElement.classList.add("role-modules-loading");
    const warmup=teacherWarmup();
    await Promise.all([loadSeries(list),warmup]);
    window.__roleModuleBootstrap=false;
    window.__roleModulesReady=true;
    window.__roleLoaderActive=false;
    document.documentElement.classList.remove("role-modules-loading");
    try{render()}catch(e){}
  }
  function loadApp(){
    window.__roleLoaderActive=true;window.__roleModulesReady=false;
    appendScript("/app-v3.js?v=20260925-0415",()=>{
      const start=()=>loadRoleModules();
      if("requestIdleCallback" in window)requestIdleCallback(start,{timeout:500});
      else setTimeout(start,60);
    });
  }
  function installIOSRedirectMode(){let tries=0;const timer=setInterval(()=>{tries++;if(window.google?.accounts?.id?.initialize){clearInterval(timer);const nativeInitialize=window.google.accounts.id.initialize.bind(window.google.accounts.id);window.google.accounts.id.initialize=(config={})=>{const {callback,...rest}=config;return nativeInitialize({...rest,ux_mode:"redirect",login_uri:`${location.origin}/api/google-login`})};loadApp()}else if(tries>120){clearInterval(timer);loadApp()}},50)}
  document.addEventListener("click",async e=>{const btn=e.target.closest?.(".logout");if(!btn)return;e.preventDefault();e.stopImmediatePropagation();try{await fetch("/api/google-logout",{method:"POST"})}catch{}sessionStorage.removeItem("google_id_token");sessionStorage.removeItem("school_context_id");sessionStorage.removeItem("role_context");location.href="/"},true);
  if(isIOS)installIOSRedirectMode();else loadApp();
})();
