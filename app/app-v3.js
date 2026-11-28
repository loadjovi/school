(()=>{const q=new URLSearchParams(location.search),sid=String(q.get("onboardingSchoolId")||"").trim().toLowerCase(),role=String(q.get("onboardingRole")||"").trim();if(/^[a-z0-9-]{2,60}$/.test(sid)&&["schoolAdmin","teacher","parent"].includes(role)){sessionStorage.setItem("school_context_id",sid);sessionStorage.setItem("role_context",role)}})();
const state={me:null,students:[],student:null,page:"home",summary:null,practice:[],token:sessionStorage.getItem("google_id_token")||"",registrations:[],master:[],schoolOptions:[],parentLineBinding:null,parentLineFriendPromptEpoch:0,parentSelfBind:{schoolId:"",schoolName:"",students:[],loading:false}};
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const grades=["一年級","二年級","三年級","四年級","五年級","六年級"],groups=["A","B","C","儲備"],instruments=["小提琴","中提琴","大提琴","低音提琴","其他"];
function opts(list,val){return list.map(x=>`<option value="${esc(x)}" ${x===val?"selected":""}>${esc(x)}</option>`).join("")}
function toast(msg){const t=$("toast");if(!t)return;t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),1800)}
const pendingApiGets=new Map();
let apiRequestEpoch=0;
function apiReadScope(){return JSON.stringify([apiRequestEpoch,state.token,state.me?.identityId||state.me?.email||"",state.me?.role||"",sessionStorage.getItem("school_context_id")||state.me?.schoolId||"",sessionStorage.getItem("role_context")||""])}
async function api(url,options={}){
  const h={"Content-Type":"application/json"};
  if(state.token)h["X-Google-ID-Token"]=state.token;
  const schoolContext=sessionStorage.getItem("school_context_id")||"",roleContext=sessionStorage.getItem("role_context")||"";
  if(schoolContext)h["X-School-Id"]=schoolContext;
  if(roleContext)h["X-Role-Context"]=roleContext;
  Object.assign(h,options.headers||{});
  const method=String(options.method||"GET").toUpperCase(),fetchOptions={...options,headers:h};
  if(method==="GET"&&String(url).startsWith("/api/")&&!fetchOptions.cache)fetchOptions.cache="no-store";
  // Only identical reads still in flight share a request. No private response
  // cache survives completion, a write, logout, or an account/school change.
  if(method!=="GET"){apiRequestEpoch++;pendingApiGets.clear()}
  const requestScope=apiReadScope();
  const key=state.me?.role==="parent"&&method==="GET"&&String(url).startsWith("/api/")&&!options.signal&&!options.body?
    JSON.stringify([requestScope,url,Object.entries(h).sort(([a],[b])=>a.localeCompare(b)),fetchOptions.cache,fetchOptions.credentials,fetchOptions.mode,fetchOptions.redirect]):"";
  const perform=async()=>{
    const r=await fetch(url,fetchOptions),d=await r.json().catch(()=>({}));
    if(r.status===401){if(apiReadScope()===requestScope)logout(false);throw new Error("登入已失效，請重新登入")}
    if(!r.ok)throw new Error(d.error||d.message||`HTTP ${r.status}`);
    return d;
  };
  if(!key)return perform();
  let pending=pendingApiGets.get(key);
  if(!pending){pending=perform();pendingApiGets.set(key,pending)}
  try{return JSON.parse(JSON.stringify(await pending))}
  finally{if(pendingApiGets.get(key)===pending)pendingApiGets.delete(key)}
}
function logout(reload=true){apiRequestEpoch++;pendingApiGets.clear();state.token="";state.me=null;state.students=[];state.student=null;state.parentLineBinding=null;state.parentLineFriendPromptEpoch=(state.parentLineFriendPromptEpoch||0)+1;window.parentLineFriendPrompt?.reset();sessionStorage.removeItem("google_id_token");sessionStorage.removeItem("school_context_id");sessionStorage.removeItem("role_context");sessionStorage.removeItem("teacher_line_account_return");sessionStorage.removeItem("parent_line_account_return");if(window.google?.accounts?.id)google.accounts.id.disableAutoSelect();if(reload)renderLogin()}
function teacherLineAccountEntry(){
  const query=new URLSearchParams(location.search),schoolId=query.get("teacherLineAccount");
  if(/^[a-z0-9-]{2,60}$/.test(schoolId||""))return schoolId;
  if(/^[a-z0-9-]{2,60}$/.test(query.get("parentLineAccount")||""))return "";
  // A failed app handoff can lose the OAuth state cookie. Retain only the
  // intended screen; the server must still verify the Gmail teaching identity.
  const pending=sessionStorage.getItem("teacher_line_account_return")||"";
  return /^[a-z0-9-]{2,60}$/.test(pending)?pending:"";
}
function accountReturnIdentityScope(){
  return JSON.stringify([state.token,state.me?.identityId||state.me?.email||"",state.me?.schoolId||"",state.me?.role||"",state.me?.authProvider||"",...["google_id_token","school_context_id","role_context"].map(key=>sessionStorage.getItem(key)||"")]);
}
function accountReturnCancelled(){
  const error=Error("登入身分已變更，請重新開啟帳號綁定。");error.staleAccountReturn=true;return error;
}
function teacherAccountRestoreError(status){
  const http=Number.isInteger(status)&&status>=100&&status<=599?status:null;
  const code=http?"TCH-HTTP-"+http:status==="network"?"TCH-NETWORK":"TCH-RESPONSE";
  const message=http===401?"此瀏覽器的 Gmail 登入已失效，請重新登入原 Gmail；已完成綁定者可選擇 LINE 登入。":
    http===403?"Gmail 登入請求未獲允許，請聯絡學校管理員協助。":
    http===429||http>=500?"Gmail 登入服務暫時無法回應，請稍後重試。":
    status==="network"?"網路連線中斷，未能確認 Gmail 登入，請檢查連線後重試。":
    "暫時無法確認老師的 Gmail 登入，請重新開啟登入頁。";
  const error=Error(message+"（檢查碼："+code+"）");error.teacherAccountRestoreError=true;return error;
}
async function restoreTeacherLineAccountSession(schoolId){
  const token=state.token,headers={"X-School-Id":schoolId,"X-Role-Context":"teacher"};
  sessionStorage.setItem("teacher_line_account_return",schoolId);
  sessionStorage.removeItem("parent_line_account_return");
  sessionStorage.setItem("school_context_id",schoolId);
  sessionStorage.setItem("role_context","teacher");
  const query=new URLSearchParams(location.search);query.set("teacherLineAccount",schoolId);
  history.replaceState({},"",location.pathname+"?"+query+(location.hash||""));
  if(token&&!["line-session","cookie-session"].includes(token))headers["X-Google-ID-Token"]=token;
  const scope=accountReturnIdentityScope();let profile,response;
  try{
    response=await fetch("/api/me",{credentials:"same-origin",cache:"no-store",headers});
    if(scope!==accountReturnIdentityScope())throw accountReturnCancelled();
    if(!response.ok)throw teacherAccountRestoreError(response.status);
    profile=await response.json();
    if(!profile||typeof profile!=="object"||Array.isArray(profile))throw teacherAccountRestoreError("response");
  }catch(error){
    if(scope!==accountReturnIdentityScope())throw accountReturnCancelled();
    if(error?.staleAccountReturn||error?.teacherAccountRestoreError)throw error;
    throw teacherAccountRestoreError(response?"response":"network");
  }
  if(scope!==accountReturnIdentityScope())throw accountReturnCancelled();
  if(profile.authProvider!=="google")throw Error("目前未取得 Gmail 登入身分，請使用原 Gmail 繼續核對 LINE 綁定；老師不需綁定學生。（檢查碼：TCH-PROVIDER）");
  if(profile.schoolId!==schoolId)throw Error("Gmail 登入學校不符，請使用此校老師名冊中的 Gmail 登入；老師不需綁定學生。（檢查碼：TCH-SCHOOL）");
  if(!["teacher","sectionTeacher","ensembleTeacher","comprehensiveTeacher","privateTeacher"].includes(profile.role)){
    throw Error("此 Gmail 尚未取得本校老師身分，請聯絡學校管理員核對名冊與啟用狀態；老師不需綁定學生。（檢查碼：TCH-ROLE）");
  }
  state.token=token&&!["line-session","cookie-session"].includes(token)?token:"cookie-session";
  sessionStorage.setItem("google_id_token",state.token);
  return profile;
}
function parentLineAccountEntry(){
  const query=new URLSearchParams(location.search),schoolId=query.get("parentLineAccount");
  if(/^[a-z0-9-]{2,60}$/.test(schoolId||""))return schoolId;
  if(/^[a-z0-9-]{2,60}$/.test(query.get("teacherLineAccount")||"")||/^[a-z0-9-]{2,60}$/.test(query.get("adminLineAccount")||""))return "";
  const pending=sessionStorage.getItem("parent_line_account_return")||"";
  return /^[a-z0-9-]{2,60}$/.test(pending)?pending:"";
}
async function restoreParentLineAccountSession(schoolId){
  const token=state.token,headers={"X-School-Id":schoolId,"X-Role-Context":"parent"};
  sessionStorage.setItem("parent_line_account_return",schoolId);
  sessionStorage.removeItem("teacher_line_account_return");
  sessionStorage.setItem("school_context_id",schoolId);
  sessionStorage.setItem("role_context","parent");
  const query=new URLSearchParams(location.search);query.set("parentLineAccount",schoolId);
  history.replaceState({},"",location.pathname+"?"+query+(location.hash||""));
  if(token&&!["line-session","cookie-session"].includes(token))headers["X-Google-ID-Token"]=token;
  const scope=accountReturnIdentityScope();let profile;
  try{
    const response=await fetch("/api/me",{credentials:"same-origin",cache:"no-store",headers});
    if(scope!==accountReturnIdentityScope())throw accountReturnCancelled();
    if(!response.ok)throw Error("請以原本已綁定學生的 Gmail 重新登入，繼續 LINE 綁定；不需重填學生資料。");
    profile=await response.json();
  }catch(error){if(scope!==accountReturnIdentityScope())throw accountReturnCancelled();throw error}
  if(scope!==accountReturnIdentityScope())throw accountReturnCancelled();
  if(profile.schoolId!==schoolId||profile.authProvider!=="google"||profile.role!=="parent"){
    throw Error("請使用原本已完成學生核准的 Gmail 登入，繼續 LINE 綁定；不需重新輸入學生姓名或學號。");
  }
  state.token=token&&!["line-session","cookie-session"].includes(token)?token:"cookie-session";
  sessionStorage.setItem("google_id_token",state.token);
  return profile;
}
function openParentLineAccount(schoolId){
  const returned=new URLSearchParams(location.search),query=new URLSearchParams({parentLineAccount:schoolId});
  for(const name of ["line_link","line_error","line_friend"]){
    const value=returned.get(name);
    const allowed=name==="line_friend"?["checked","unavailable","mismatch"]:name==="line_link"?["confirm"]:["conflict","configuration","authorization","verification"];
    if(allowed.includes(value))query.set(name,value);
  }
  location.replace("/line-account.html?"+query);
}
function adminFriendAccountEntry(){
  const query=new URLSearchParams(location.search),schoolId=query.get('adminLineAccount');
  return ['/','/index.html'].includes(location.pathname)&&query.getAll('adminLineAccount').length===1&&/^[a-z0-9-]{2,60}$/.test(schoolId||'')&&query.getAll('line_friend').length===1&&['checked','unavailable','mismatch'].includes(query.get('line_friend'))?schoolId:'';
}
async function restoreAdminFriendAccountSession(schoolId){
  const token=state.token,headers={'X-School-Id':schoolId,'X-Role-Context':'schoolAdmin'};
  if(token&&!['line-session','cookie-session'].includes(token))headers['X-Google-ID-Token']=token;
  const response=await fetch('/api/me',{credentials:'same-origin',cache:'no-store',headers});
  if(!response.ok)throw Error('請使用原本的管理員 Gmail 登入，繼續確認 LINE 好友狀態。');
  const profile=await response.json();
  if(profile.authProvider!=='google'||profile.role!=='admin'||profile.schoolId!==schoolId)throw Error('請使用此校已授權的管理員 Gmail 登入，繼續確認 LINE 好友狀態。');
  state.token=token&&!['line-session','cookie-session'].includes(token)?token:'cookie-session';
  sessionStorage.setItem('google_id_token',state.token);sessionStorage.setItem('school_context_id',schoolId);sessionStorage.setItem('role_context','schoolAdmin');
  for(const key of ['teacher_line_account_return','parent_line_account_return','line_staff_entry'])sessionStorage.removeItem(key);
  return profile;
}
async function restoreLineStaffSession(){
  const entry=window.getLineStaffEntry?.();
  if(!entry)return;
  const response=await fetch("/api/me",{
    credentials:"same-origin",cache:"no-store",
    headers:{"X-School-Id":entry.schoolId,"X-Role-Context":"schoolAdmin"}
  });
  if(response.status===401||response.status===403)return;
  if(!response.ok)throw new Error("暫時無法確認登入狀態，請重新整理後再試。");
  const profile=await response.json();
  if(profile.role!=="admin"||profile.schoolId!==entry.schoolId)return;
  state.token=profile.authProvider==="line"?"line-session":"cookie-session";
  sessionStorage.setItem("google_id_token",state.token);
  sessionStorage.setItem("school_context_id",entry.schoolId);
  sessionStorage.setItem("role_context","schoolAdmin");
  return profile;
}
const paidActivityEntryKey="paid_activity_entry";
function paidActivityEntry(){
  const query=new URLSearchParams(location.search);
  const supplied={activity:query.get("paidActivity"),schoolId:query.get("schoolId")};
  const valid=entry=>entry&&/^(yearEndDinner|fieldTrip):[A-Za-z0-9_-]{1,80}$/.test(entry.activity||"")&&/^[a-z0-9-]{2,60}$/.test(entry.schoolId||"");
  if(valid(supplied)){
    sessionStorage.setItem(paidActivityEntryKey,JSON.stringify(supplied));
    return supplied;
  }
  try{
    const stored=JSON.parse(sessionStorage.getItem(paidActivityEntryKey)||"null");
    return valid(stored)?stored:null;
  }catch{return null}
}
function choosePaidActivityContext(entry){
  sessionStorage.setItem("school_context_id",entry.schoolId);
  sessionStorage.setItem("role_context","parent");
}
async function restorePaidActivitySession(entry){
  const response=await fetch("/api/me",{credentials:"same-origin",cache:"no-store",headers:{
    "X-School-Id":entry.schoolId,"X-Role-Context":"parent"
  }});
  if(!response.ok)return;
  const profile=await response.json();
  if(profile.role!=="parent"||profile.schoolId!==entry.schoolId)return;
  state.token=profile.authProvider==="line"?"line-session":"cookie-session";
  sessionStorage.setItem("google_id_token",state.token);
  return profile;
}
function openPaidActivity(entry,profile){
  if(!entry||profile.role!=="parent"||profile.schoolId!==entry.schoolId)return false;
  sessionStorage.removeItem(paidActivityEntryKey);
  const query=new URLSearchParams({
    view:entry.activity.startsWith("yearEndDinner:")?"events":"performance",activity:entry.activity
  });
  location.replace("/parent-uniform-events.html?"+query);
  return true;
}
async function boot(){
  const query=new URLSearchParams(location.search);
  const lineError=query.get("line_error");
  const adminFriendAccount=adminFriendAccountEntry();
  if(adminFriendAccount){
    try{await loadProfile(await restoreAdminFriendAccountSession(adminFriendAccount))}
    catch(error){if(!error?.staleAccountReturn){state.me=null;renderLogin(error.message)}}
    return;
  }
  const teacherAccount=teacherLineAccountEntry();
  if(teacherAccount){
    try{await loadProfile(await restoreTeacherLineAccountSession(teacherAccount))}
    catch(error){if(!error?.staleAccountReturn){state.me=null;renderLogin(error.message)}}
    return;
  }
  const parentAccount=parentLineAccountEntry();
  if(parentAccount){
    try{await restoreParentLineAccountSession(parentAccount);openParentLineAccount(parentAccount)}
    catch(error){if(!error?.staleAccountReturn){state.me=null;renderLogin(error.message)}}
    return;
  }
  // The school workspace forwards this result to its embedded account panel
  // after checking the authenticated role and school. Do not consume it here.
  const lineAccountReturn=/^[a-z0-9-]{2,60}$/.test(query.get("adminLineAccount")||"");
  if(lineError&&!lineAccountReturn){
    query.delete("line_error");
    history.replaceState({}, "", location.pathname+(query.size?"?"+query:""));
    renderLogin(lineError==="conflict"?"此校帳號已有綁定，請聯絡管理員確認。":"LINE 驗證未完成，請重新登入後再綁定。");return;
  }
  try{
    const entry=window.getLineStaffEntry?.()?null:paidActivityEntry();
    if(entry)choosePaidActivityContext(entry);
    const profile=state.token?undefined:await (entry?restorePaidActivitySession(entry):restoreLineStaffSession());
    if(!state.token){renderLogin();return}
    await loadProfile(profile);
  }catch(error){renderLogin(error.message)}
}
const schoolViewScript="/school-access.js?v=20261027-school-followup";
let schoolViewLoading=null;
async function loadSchoolViewModule(){
  if(typeof window.changeSchoolFollowupDate==="function"){state.schoolViewerLoadError="";render();return}
  if(!schoolViewLoading){
    schoolViewLoading=new Promise((resolve,reject)=>{
      let script=[...document.scripts].find(s=>s.getAttribute("src")===schoolViewScript);
      const fresh=!script;
      if(fresh){script=document.createElement("script");script.src=schoolViewScript;script.defer=true}
      let done=false;
      const finish=error=>{if(done)return;done=true;clearTimeout(timer);script.removeEventListener("load",loaded);script.removeEventListener("error",failed);if(error){script.remove();reject(error)}else resolve()};
      const loaded=()=>finish(typeof window.changeSchoolFollowupDate==="function"?null:new Error("校方功能初始化失敗"));
      const failed=()=>finish(new Error("校方功能載入失敗"));
      const timer=setTimeout(()=>finish(new Error("校方功能載入逾時")),15000);
      script.addEventListener("load",loaded);script.addEventListener("error",failed);
      if(fresh)document.body.appendChild(script);
    }).finally(()=>{schoolViewLoading=null});
  }
  try{await schoolViewLoading;state.schoolViewerLoadError="";render()}
  catch(e){state.schoolViewerLoadError=e.message||"校方功能載入失敗";render()}
}
window.retrySchoolView=()=>{state.schoolViewerLoadError="";render();return loadSchoolViewModule()};
async function loadProfile(profile){
  state.parentLineBinding=null;
  window.parentLineFriendPrompt?.reset();
  const entry=window.getLineStaffEntry?.()?null:paidActivityEntry();
  if(entry&&!sessionStorage.getItem("role_context"))choosePaidActivityContext(entry);
  state.me=profile??await api("/api/me?includeStudentProfiles=1");
  if(openPaidActivity(entry,state.me))return;
  if(state.me.role!=="admin")window.resumeLineStaffEntry?.();
  const contexts=Array.isArray(state.me.contexts)?state.me.contexts:[];
  const chosen=sessionStorage.getItem("role_context")||"";
  if(["unassigned","contextDenied"].includes(state.me.role)&&!contexts.length){
    // 校方唯讀帳號由伺服器的授權名單定位唯一學校；舊的家長選校記錄不參與判斷。
    try{
      const school=await api("/api/school-access-self",{headers:{"X-School-Id":"","X-Role-Context":""}});
      if(school.allowed){
        sessionStorage.setItem("school_context_id",String(school.schoolId));
        sessionStorage.removeItem("role_context");
        state.me.role="school";state.me.schoolId=school.schoolId;
        state.me.schoolName=school.schoolName;state.me.systemName=school.systemName||state.me.systemName;
        state.me.capabilities={schoolAttendance:true,readOnly:true};
        state.schoolViewer={checked:true,allowed:true,date:new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Taipei"}),data:null,loading:false,error:"",filter:"all"};
        state.students=[];state.student=null;state.page="school";render();await loadSchoolViewModule();return;
      }
      if(school.reason==="multipleSchools"){
        state.students=[];state.student=null;state.page="schoolAccessError";render();return;
      }
    }catch(e){console.warn("school access lookup failed",e?.message||e)}
  }
  if(!chosen&&state.me.role==="unassigned"&&!contexts.length){
    if(state.me.authProvider==="line"&&/^[a-z0-9-]{2,60}$/.test(state.me.schoolId||"")){
      state.students=[];state.student=null;state.page="home";render();return;
    }
    try{const d=await api("/api/school-options");state.schoolOptions=Array.isArray(d.items)?d.items:[]}catch{state.schoolOptions=[]}
    state.students=[];state.student=null;state.page="schoolSelect";render();return;
  }
  if(!chosen&&contexts.length>0&&(contexts.length>1||["unassigned","tenantPending"].includes(state.me.role))){
    state.me.role="contextSelector";state.me.capabilities={};state.me.activeContextKey="";
    state.students=[];state.student=null;state.page="contextSelect";render();return;
  }
  if(state.me.role==="contextDenied"){
    sessionStorage.removeItem("school_context_id");sessionStorage.removeItem("role_context");
    state.me.role="contextSelector";state.me.capabilities={};state.me.activeContextKey="";
    state.students=[];state.student=null;state.page="contextSelect";render();return;
  }
  if(["globalAdmin","tenantPending"].includes(state.me.role)){
    state.students=[];state.student=null;state.page=state.me.role==="globalAdmin"?"global":"home";render();return;
  }
  if(state.me.role==="admin"){
    state.page="admin";
    window.preloadRoleModules?.();
    const adminScope=apiReadScope(),initialData=loadAdmin();
    window.__adminInitialDataTask=initialData;
    render();
    try{await initialData}catch(error){
      if(!state.me){renderLogin("登入已失效，請重新登入");return}
      if(apiReadScope()!==adminScope||state.me?.role!=="admin")return;
      if(!window.__roleLoaderActive)throw error;
      window.__roleModuleError="工作資料暫時無法讀取，請重新載入。";render();return;
    }finally{if(window.__adminInitialDataTask===initialData)window.__adminInitialDataTask=null}
    if(apiReadScope()!==adminScope||state.me?.role!=="admin")return;
    state.students=Array.isArray(state.master)?state.master:[];
    state.student=state.students[0]||null;
  }else{
    if(state.me.role==="parent"){
      state.summary=null;state.practice=[];state.summaryLoadError="";
      window.preloadRoleModules?.();
    }
    state.students=state.me.role==="parent"&&Array.isArray(state.me.studentProfiles)?state.me.studentProfiles:await api("/api/students");
    state.student=state.students[0]||null;
    if(["teacher","sectionTeacher","ensembleTeacher","comprehensiveTeacher","privateTeacher"].includes(state.me.role)||state.me?.capabilities?.teacherSettings)state.page="teacherHome";
    else state.page="home";
    if(state.me.role==="parent"&&state.me.capabilities?.lineAccount&&typeof refreshParentLineBindingStatus==="function")void refreshParentLineBindingStatus();
    if(state.me.role==="parent"&&state.student){
      render();
      state.summaryLoadError="";
      refreshStudent().then(()=>render()).catch(e=>{console.warn("parent summary load failed",e);state.summaryLoadError=e.message||"資料載入失敗";render()});
      return;
    }
  }
  render()
}
async function loadAdmin(){const scope=apiReadScope();const [r,m]=await Promise.all([api("/api/student-registration?status=pending"),api("/api/student-master")]);if(apiReadScope()!==scope||state.me?.role!=="admin")return;state.registrations=r.items||[];state.master=m.items||[];window.applyAdminParentLinks?.()}
async function refreshStudent(){if(!state.student)return;const scope=apiReadScope(),studentId=String(state.student.studentId),month=new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Taipei"}).slice(0,7);const[sum,logs]=await Promise.all([api(`/api/summary?studentId=${encodeURIComponent(studentId)}&month=${month}`),api(`/api/practice?studentId=${encodeURIComponent(studentId)}&month=${month}`)]);if(apiReadScope()!==scope||String(state.student?.studentId)!==studentId)return;state.summary=sum;state.practice=logs.items||[]}
async function renderLineLogin(){
  const mount=$("tenantLineSignIn");
  if(!mount)return;
  if(adminFriendAccountEntry()){
    mount.innerHTML='<div class="notice">請使用原本的管理員 Gmail 登入，繼續確認 LINE 好友狀態。原綁定與學校權限會保留。</div>';
    return;
  }
  const teacherSchool=teacherLineAccountEntry();
  if(teacherSchool){
    mount.innerHTML='<div class="notice">首次連結請使用原本已建檔的 Gmail 核對帳號；老師不需填寫學生資料。若您已完成 Gmail 與 LINE 綁定，可直接使用 LINE 登入。</div><button type="button" class="primary" id="teacherLineSignIn">已完成綁定，使用 LINE 登入</button><p id="teacherLineSignInError" role="status"></p>';
    const button=$("teacherLineSignIn"),status=$("teacherLineSignInError"),scope=accountReturnIdentityScope(),search=location.search;
    let busy=false,navigating=false;
    const current=()=>mount.isConnected&&$("teacherLineSignIn")===button&&scope===accountReturnIdentityScope()&&location.search===search&&teacherLineAccountEntry()===teacherSchool;
    button.onclick=async()=>{
      if(busy||!current())return;
      busy=true;button.disabled=true;status.textContent="正在開啟 LINE 登入…";
      try{
        const response=await fetch("/api/line/tenant-login/"+encodeURIComponent(teacherSchool)+"/start",{
          method:"POST",credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:"login"})
        });
        const data=await response.json();
        if(!current())return;
        if(!response.ok)throw Error(data.error||"LINE 登入暫時無法使用，請稍後再試。");
        let target;try{target=new URL(data.url)}catch{throw Error("LINE 登入網址不正確，請稍後重試。")}
        if(target.origin!=="https://access.line.me"||target.pathname!=="/oauth2/v2.1/authorize"||target.username||target.password)throw Error("LINE 登入網址不正確，請稍後重試。");
        if(!current())return;
        // This is an explicit login choice. A successful login callback selects
        // the LINE session; it must not resume an earlier Gmail pairing screen.
        // Clean this history entry too: Safari can return to this original tab
        // instead of the callback tab, where its old query would force Gmail.
        const clean=new URL(location.href);
        for(const name of ["teacherLineAccount","parentLineAccount","line_link","line_error","line_friend","google_redirect","line_session"])clean.searchParams.delete(name);
        clean.searchParams.set("schoolId",teacherSchool);
        history.replaceState({},"",clean.pathname+clean.search+clean.hash);
        for(const key of ["teacher_line_account_return","parent_line_account_return","line_staff_entry"])sessionStorage.removeItem(key);
        navigating=true;location.assign(target.href);
      }catch(error){if(current())status.textContent=error.message||"LINE 登入暫時無法使用，請稍後再試。"}
      finally{if(current()&&!navigating){busy=false;button.disabled=false}}
    };
    return;
  }
  if(parentLineAccountEntry()){
    mount.innerHTML='<div class="notice">請使用原本的 Gmail 登入，繼續連結 LINE；已核准的學生關係會沿用，不需重填姓名或學號。</div>';
    return;
  }
  try{
    const response=await fetch("/api/line/login-schools",{cache:"no-store"});
    if(!response.ok)return;
    const {items}=await response.json();
    if(!mount.isConnected||!items?.length)return;
    const requested=new URLSearchParams(location.search).get("schoolId")||window.getLineStaffEntry?.()?.schoolId||paidActivityEntry()?.schoolId;
    mount.innerHTML=`<label for="lineSchoolChoice">選擇所屬學校</label>
      <select id="lineSchoolChoice">${items.map(item=>`<option value="${esc(item.schoolId)}"${item.schoolId===requested?" selected":""}>${esc(item.schoolName)}</option>`).join("")}</select>
      <button type="button" class="primary" id="lineSchoolSignIn">使用 LINE 登入</button>
      <p id="lineSignInError" role="status"></p>`;
    $("lineSchoolSignIn").onclick=async()=>{
      const button=$("lineSchoolSignIn"),sid=$("lineSchoolChoice").value;
      button.disabled=true;
      try{
        const result=await fetch("/api/line/tenant-login/"+encodeURIComponent(sid)+"/start",{
          method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:"login"})
        });
        const data=await result.json();
        if(!result.ok)throw new Error(data.error||"LINE 登入暫時無法使用");
        location.assign(data.url);
      }catch(error){$("lineSignInError").textContent=error.message;button.disabled=false}
    };
  }catch(error){console.warn("LINE school list unavailable")}
}

let parentLineBindingRequest=0;
function parentLineBindingKey(){
  return JSON.stringify([state.token,state.me?.identityId||state.me?.email||"",state.me?.schoolId||"",state.me?.role||"",state.me?.authProvider||"",sessionStorage.getItem("school_context_id")||"",sessionStorage.getItem("role_context")||""]);
}
async function refreshParentLineBindingStatus(){
  if(state.me?.role!=="parent"||!state.me.capabilities?.lineAccount)return;
  const request=++parentLineBindingRequest,scope=apiReadScope(),key=parentLineBindingKey();
  const wasBound=state.parentLineBinding?.bound===true;
  const pending={key,bound:null};state.parentLineBinding=pending;
  if(wasBound&&state.page==="home")render();
  try{
    const account=await api("/api/line/school-account");
    if(request!==parentLineBindingRequest||state.parentLineBinding!==pending||scope!==apiReadScope()||key!==parentLineBindingKey())return;
    const lineBound=account.configured===true&&account.bound===true;
    state.parentLineBinding={key,bound:lineBound&&account.googleLinked===true,lineBound,
      friendStatus:["friend","not_friend"].includes(account.friendStatus)?account.friendStatus:"unknown",
      authProvider:["google","line"].includes(account.authProvider)?account.authProvider:"",
      friendCheckedAt:account.friendCheckedAt||null};
    if(state.page==="home")render();
    else window.parentLineFriendPrompt?.refresh();
  }catch{
    // An unavailable status leaves the account entry visible at the top.
  }
}
window.addEventListener("pageshow",event=>{if(event.persisted)void refreshParentLineBindingStatus()});
function parentServicesAtTop(){
  return state.me?.role==="parent"&&state.me.capabilities?.lineAccount===true&&state.page==="home"&&!(state.parentLineBinding?.key===parentLineBindingKey()&&state.parentLineBinding.bound===true);
}
function tenantServicesEntry(){
  const me=state.me, options=me?.capabilities||{};
  if(!["admin","parent","unassigned"].includes(me?.role)||!["home","admin","uniformEvents"].includes(state.page))return "";
  const billing=options.feeCollections&&me.role!=="unassigned";
  if(me.role==="admin"){
    if(state.page!=="admin"||state.teacherAdminOpen||window.__roleLoaderActive&&window.__roleModulesReady!==true)return "";
    const fees=billing?`<section class="aw-home-service" data-admin-service="fees" data-admin-group="home" aria-labelledby="schoolFeeServicesTitle"><a class="aw-job-link" href="/fee-collections.html"><span class="aw-job-icon" aria-hidden="true">💰</span><span class="aw-job-copy"><b id="schoolFeeServicesTitle">收費與核帳</b><small>${options.financeVerifier===true?'核對匯款、處理補款與退費':'管理收費專案、查看繳費進度'}</small></span></a></section>`:"";
    if(!options.lineRoleMenus&&!options.lineAccount)return fees;
    return `${fees}<section class="aw-home-service" data-admin-service="line" data-admin-group="home" aria-labelledby="schoolLineServicesTitle"><a class="aw-job-link" href="/line-announcement.html"><span class="aw-job-icon" aria-hidden="true">📣</span><span class="aw-job-copy"><b id="schoolLineServicesTitle">LINE 通知中心</b><small>通知家長、學校／幹部與活動志工 LINE 群組</small></span></a></section>`;
  }
  if(options.lineAccount&&["teacher","sectionTeacher","ensembleTeacher","comprehensiveTeacher","privateTeacher"].includes(me.role)){
    return ""; // Teacher home and settings show the verified binding status in teacher-line-account.js.
  }
  if(!options.lineAccount&&!billing)return "";
  if(options.lineAccount&&["parent","unassigned"].includes(me.role)){
    const description=me.role==="parent"?"LINE 綁定會沿用此 Gmail 已核准的學生關係，不需重新輸入學生姓名或學號；完成後自動啟用家長選單，不需另外同步。":me.authProvider==="line"?"LINE 已登入。連結原本的 Gmail 後，系統會依學校已建檔的身分開放功能。":"完成學生核准與 LINE 綁定後，系統會自動啟用家長選單，不需另外同步；啟用 Facebook 後為五個入口。";
    const button="管理我的 LINE 通知設定 →";
    return `<details class="card" id="parentAccountSettings"><summary><b>⚙️ 帳號與通知設定</b></summary><h2 id="parentLineServicesTitle">LINE 通知設定</h2><div class="notice">${description}</div><button type="button" class="secondary" style="width:100%" onclick="location.href='/line-account.html${me.role==="parent"?"?parentLineAccount="+encodeURIComponent(me.schoolId):""}'">${button}</button>${billing?'<a href="/fee-collections.html" style="display:block;margin-top:12px">查看我的繳費紀錄</a>':""}</details>`;
  }
  return billing?'<div class="card"><a href="/fee-collections.html">查看費用資訊</a></div>':"";
}
function googleAccountReturnState(){
  const teacher=teacherLineAccountEntry();
  if(/^[a-z0-9-]{2,60}$/.test(teacher||""))return "teacher-account:"+teacher;
  const parent=parentLineAccountEntry();
  return /^[a-z0-9-]{2,60}$/.test(parent||"")?"parent-account:"+parent:"";
}
function googleAccountExternalEntry(){
  const match=/^(teacher|parent)-account:([a-z0-9-]{2,60})$/.exec(googleAccountReturnState());
  if(!match)return "";
  const query=new URLSearchParams({[match[1]==="teacher"?"teacherLineAccount":"parentLineAccount"]:match[2],openExternalBrowser:"1"}),returned=new URLSearchParams(location.search);
  for(const [name,allowed] of [["line_link",["confirm"]],["line_error",["configuration","authorization","verification","conflict"]],["line_friend",["checked","unavailable","mismatch"]]]){
    if(returned.getAll(name).length===1&&allowed.includes(returned.get(name)))query.set(name,returned.get(name));
  }
  return "/?"+query;
}
async function renderLogin(error=""){
  const recoverySchool=teacherLineAccountEntry();
  const recovery=error&&recoverySchool?`<a class="secondary" href="/login-reset.html?schoolId=${encodeURIComponent(recoverySchool)}" style="display:block;text-align:center;text-decoration:none;margin-top:16px">重新開始登入</a><p class="muted">清除這台瀏覽器的舊登入後，再選 Gmail 或 LINE；已完成的帳號綁定會保留。</p>`:"";
  document.getElementById("app").innerHTML=`<div class="login-wrap"><div class="login-card"><div class="logo">🎻</div><h1>聖心小學弦樂團</h1><p>家長、老師與管理員共用入口</p>${error?`<div class="error">${esc(error)}</div>`:""}<div id="googleBtn" style="display:flex;justify-content:center;margin-top:18px"></div><div id="tenantLineSignIn"></div>${recovery}<div class="notice" style="margin-top:16px">${adminFriendAccountEntry()?"請使用原本的管理員 Gmail 登入，繼續確認官方帳號好友狀態。":teacherLineAccountEntry()?"老師首次綁定請使用名冊中已建檔的 Gmail；完成綁定後，請使用上方的 LINE 登入按鈕。":parentLineAccountEntry()?"已核准的學生關係會沿用原 Gmail，LINE 綁定不需重填學生姓名或學號。":"家長第一次登入若尚未綁定學生，可填寫學生資料送交管理員確認。"}</div></div></div>`;
  renderLineLogin();
  if(window.__lineEmbedded){
    const external=googleAccountExternalEntry();
    $("googleBtn").innerHTML=external?`<a class="primary" href="${esc(external)}" style="display:block;text-align:center;text-decoration:none">使用 Safari 或 Chrome，以原 Gmail 繼續</a>`:"Google 登入請使用 Safari 或 Chrome";
    return;
  }
  try{
    const cfg=await fetch("/api/config").then(r=>r.json());
    if(!cfg.googleClientId){$("googleBtn").innerHTML='<div class="error">尚未設定 GOOGLE_CLIENT_ID</div>';return}
    let n=0;
    const wait=setInterval(()=>{
      n++;
      if(window.google?.accounts?.id){
        clearInterval(wait);
        google.accounts.id.initialize({client_id:cfg.googleClientId,callback:async res=>{state.token=res.credential;sessionStorage.setItem("google_id_token",state.token);try{const adminFriendAccount=adminFriendAccountEntry(),teacherAccount=teacherLineAccountEntry(),parentAccount=parentLineAccountEntry();if(adminFriendAccount)await loadProfile(await restoreAdminFriendAccountSession(adminFriendAccount));else if(parentAccount&&!teacherAccount){await restoreParentLineAccountSession(parentAccount);openParentLineAccount(parentAccount)}else await loadProfile(teacherAccount?await restoreTeacherLineAccountSession(teacherAccount):undefined)}catch(e){if(!e?.staleAccountReturn){state.me=null;renderLogin(e.message)}}}});
        // GIS returns the rendered button's state in redirect POSTs. It selects
        // only a fixed account screen; /me still verifies the Gmail and role.
        const accountState=googleAccountReturnState();
        google.accounts.id.renderButton($("googleBtn"),{theme:"outline",size:"large",shape:"pill",text:"signin_with",locale:"zh_TW",...(accountState?{state:accountState}:{}),width:Math.min(280,Math.max(200,document.getElementById("googleBtn").clientWidth||280))});
      }else if(n>50){clearInterval(wait);$("googleBtn").innerHTML='<div class="error">Google 登入元件載入失敗</div>'}
    },100);
  }catch(e){$("googleBtn").innerHTML=`<div class="error">${esc(e.message)}</div>`}
}
function roleText(){return({parent:"家長／學生",teacher:"老師",sectionTeacher:"分部老師",ensembleTeacher:"合奏老師",comprehensiveTeacher:"綜合課老師",privateTeacher:"個別課老師",admin:"學校管理員",school:"校方查詢",globalAdmin:"Global 管理員",tenantPending:"學校建置中",contextSelector:"選擇身分",contextDenied:"請重新選擇身分",unassigned:"尚未綁定"}[state.me?.role]||"使用者")}
function navBtn(p,i,l){return `<button class="${state.page===p?"active":""}" onclick="go('${p}')"><span>${i}</span>${l}</button>`}
function nav(){const r=state.me.role;if(state.page==="contextSelect")return `<nav class="nav"><button></button><button></button><button></button><button></button></nav>`;if(r==="parent")return `<nav class="nav">${navBtn("home","🏠","首頁")}${navBtn("practice","⏱️","自主打卡")}${navBtn("record","📊","紀錄")}${navBtn("uniformEvents","🎻","活動團服")}</nav>`;if(r==="sectionTeacher")return `<nav class="nav">${navBtn("section","🎼","分部點名")}${navBtn("help","ℹ️","說明")}<button></button><button></button></nav>`;if(r==="privateTeacher")return `<nav class="nav">${navBtn("private","🎻","個別課")}${navBtn("help","ℹ️","說明")}<button></button><button></button></nav>`;if(r==="admin")return `<nav class="nav">${navBtn("admin","🏠","工作首頁")}${navBtn("students","👥","學生主檔")}${navBtn("scores","🧮","學期考核")}${navBtn("help","ℹ️","說明")}</nav>`;return `<nav class="nav">${navBtn("home","🏠","登記")}${navBtn("help","ℹ️","說明")}<button></button><button></button></nav>`}
function shell(content){const multi=(state.me?.contexts||[]).length>1;const roleBadge=multi?`<button class="role" style="border:0;cursor:pointer" onclick="showContextSelector()" title="切換使用身分">${roleText()} ▾</button>`:`<span class="role">${roleText()}</span>`;const onboarding=state.me?.capabilities?.tenantOnboarding===true?`<div class="card" style="border:2px solid #f59e0b"><div class="notice"><b>🟠 Phase 4 隔離驗證模式</b><br>目前只操作「${esc(state.me?.schoolName||"第二校")}」的 Tenant 資料。這不是正式營運狀態，請依 Global Onboarding 清單完成角色隔離測試。</div></div>`:"";return `<div class="shell"><header class="top"><div class="brand">🎻 ${esc(state.me?.systemName||state.me?.schoolName||"聖心小學弦樂團")}</div><div class="sub">${state.me?.schoolName?esc(state.me.schoolName)+"｜":""}${state.me?.authProvider==="line"?"LINE 登入":"Google 登入"}</div><div class="userrow"><div><small>${esc(state.me.displayName||state.me.email)}</small>${roleBadge}</div><button class="logout" onclick="logout()">登出</button></div></header><main class="main">${onboarding}${state.me?.role==="parent"&&!parentServicesAtTop()?content+tenantServicesEntry():tenantServicesEntry()+content}</main>${nav()}</div>`}
function parentSelfBindPanel(){
  const b=state.parentSelfBind||{};
  if(!b.schoolId)return "";
  if(b.loading)return `<div class="card"><h2>👨‍👩‍👧 綁定家長身分</h2><div class="notice">正在讀取 ${esc(b.schoolName||"學校")} 學生清單…</div></div>`;
  const students=Array.isArray(b.students)?b.students:[];
  return `<div class="card"><button class="secondary" style="margin:0 0 12px" onclick="closeParentSelfBind()">← 取消綁定</button><h2>👨‍👩‍👧 綁定家長身分｜${esc(b.schoolName||"學校")}</h2>
    <div class="notice"><b>此功能僅提供該校 School Admin 綁定自己的家長身分。</b><br>綁定後，這個 Google 帳號會多出「${esc(b.schoolName||"學校")}｜家長」身分，可切換查看該學生的出勤、自主練習與個別課紀錄。</div>
    <label>家長姓名</label><input id="selfParentName" value="${esc(state.me?.displayName||"")}">
    <label>與學生關係</label><select id="selfParentRel"><option>父親</option><option>母親</option><option>監護人</option><option>家長</option><option>其他</option></select>
    <label>綁定學生</label><select id="selfParentStudent">${students.map(s=>`<option value="${esc(s.studentId)}">${esc(s.name||"未命名")}｜${esc(s.grade||"—")}｜${esc(s.groupName||"—")}團｜${esc(s.instrument||"—")}｜學號 ${esc(s.studentId)}</option>`).join("")}</select>
    <div class="check"><input id="selfParentConsent" type="checkbox"><div>我確認此 Google 帳號確實為上述學生之家長／監護人，並同意建立家長存取權限。</div></div>
    <button class="primary" onclick="saveParentSelfBind()">✅ 建立家長身分</button>
  </div>`;
}
function contextSelectorPage(){
  const contexts=Array.isArray(state.me?.contexts)?state.me.contexts:[];
  const active=sessionStorage.getItem("role_context")?String(state.me?.activeContextKey||""):"";
  if(!contexts.length)return `<div class="card hero"><h2>👤 尚無可用身分</h2><div class="notice">目前帳號尚未被授予任何平台或學校角色。</div></div>`;
  const cards=contexts.map(x=>{
    const usable=["active","onboarding"].includes(String(x.status||"active")),disabled=!usable&&x.type==="schoolAdmin",current=active===x.key;
    const hasParent=contexts.some(y=>y.type==="parent"&&String(y.schoolId||"")===String(x.schoolId||""));
    const bindParent=x.type==="schoolAdmin"&&usable&&!hasParent
      ?`<button class="secondary" style="width:100%;margin-top:10px" onclick="openParentSelfBind('${esc(x.schoolId||"")}','${esc(x.schoolName||"")}')">＋ 綁定為此校學生家長</button>`
      :"";
    const statusLabel=x.status==="setup"?"建置中":x.status==="onboarding"?"隔離驗證中":x.status==="inactive"?"停用":"可使用";
    return `<div class="card"><div class="student"><div><b style="font-size:17px">${esc(x.icon||"👤")} ${esc(x.label||x.role)}</b><div class="muted">${x.schoolName?esc(x.schoolName)+"｜":""}${esc(statusLabel)}</div></div>${current?`<span class="badge ok">目前身分</span>`:""}</div><button class="${disabled?"secondary":"primary"}" ${disabled?"disabled":""} onclick="selectIdentityContext('${esc(x.type)}','${esc(x.schoolId||"")}')">${disabled?"尚未開放":x.status==="onboarding"?"進入隔離測試":"使用此身分"}</button>${bindParent}</div>`;
  }).join("");
  return `<div class="card hero"><h2>👤 選擇使用身分</h2><div class="notice"><b>${esc(state.me?.displayName||state.me?.email)}</b><br>請選擇本次使用的身分。</div></div>`+cards+parentSelfBindPanel();
}
window.showContextSelector=function(){state.page="contextSelect";render()};
window.openParentSelfBind=async function(schoolId,schoolName){
  state.parentSelfBind={schoolId:String(schoolId||""),schoolName:String(schoolName||""),students:[],loading:true};
  render();
  try{
    const d=await api("/api/parent-self-bind",{headers:{"X-Role-Context":"schoolAdmin","X-School-Id":String(schoolId||"")}});
    state.parentSelfBind={schoolId:String(schoolId||""),schoolName:String(d.schoolName||schoolName||""),students:d.students||[],loading:false};
    render();
    setTimeout(()=>document.getElementById("selfParentStudent")?.scrollIntoView({behavior:"smooth",block:"center"}),50);
  }catch(e){
    state.parentSelfBind={schoolId:"",schoolName:"",students:[],loading:false};
    toast("❌ "+e.message);render();
  }
};
window.closeParentSelfBind=function(){state.parentSelfBind={schoolId:"",schoolName:"",students:[],loading:false};render()};
window.saveParentSelfBind=async function(){
  const b=state.parentSelfBind||{},studentId=document.getElementById("selfParentStudent")?.value,parentName=document.getElementById("selfParentName")?.value.trim(),relationship=document.getElementById("selfParentRel")?.value;
  if(!document.getElementById("selfParentConsent")?.checked){toast("請先確認家長／監護人關係");return}
  if(!studentId){toast("請選擇要綁定的學生");return}
  const s=(b.students||[]).find(x=>String(x.studentId)===String(studentId));
  if(!confirm(`確定將目前 Google 帳號綁定為「${s?.name||studentId}」的${relationship||"家長"}？\n\n綁定後，此帳號會取得該學生之家長資料存取權限。`))return;
  try{
    await api("/api/parent-self-bind",{method:"POST",headers:{"X-Role-Context":"schoolAdmin","X-School-Id":String(b.schoolId||"")},body:JSON.stringify({studentId,parentName,relationship,consent:true})});
    toast("✅ 家長身分已建立");
    state.parentSelfBind={schoolId:"",schoolName:"",students:[],loading:false};
    state.me=await api("/api/me");state.page="contextSelect";render();
  }catch(e){toast("❌ "+e.message)}
};
window.selectIdentityContext=function(type,schoolId){
  const t=String(type||""),sid=String(schoolId||"");
  if(!["global","schoolAdmin","teacher","parent"].includes(t))return;
  sessionStorage.setItem("role_context",t);
  if(t==="global")sessionStorage.removeItem("school_context_id");else if(sid)sessionStorage.setItem("school_context_id",sid);
  location.reload();
};
async function go(p){if(p==='admin'&&state.me?.role==='admin')state.adminWorkspaceSection='home';state.page=p;if(["home","practice","record"].includes(p)&&state.student)await refreshStudent();if(state.me.role==="admin"&&["admin","students"].includes(p))await loadAdmin();render()}
function scoreItem(n,s,v,c="ok"){return `<div class="item"><div><b>${esc(n)}</b><small>${esc(s)}</small></div><span class="badge ${c}">${esc(v)}</span></div>`}
function schoolSelectionPage(){
  const items=Array.isArray(state.schoolOptions)?state.schoolOptions:[];
  const rows=items.length?items.map(x=>{
    const testing=String(x.status||"")==="onboarding";
    return `<div class="card"><div class="student"><div><b style="font-size:17px">🏫 ${esc(x.schoolName||x.schoolId)}</b><div class="muted">${testing?"隔離驗證中":"正式啟用"}｜${esc(x.systemName||"")}</div></div><span class="badge ${testing?"warn":"ok"}">${testing?"測試":"可使用"}</span></div><button class="primary" onclick="chooseParentSchool('${esc(x.schoolId)}')">${testing?"進入測試並綁定":"選擇此學校"}</button></div>`;
  }).join(""):`<div class="card"><div class="notice">目前沒有可選擇的學校，請聯絡系統管理員。</div></div>`;
  return `<div class="card hero"><h2>🏫 第一次登入｜選擇學校</h2><div class="notice">請先選擇學生所屬學校。後續姓名與學號只會在該校學生主檔中比對，不會跨校查詢或綁定。</div></div>${rows}`;
}
window.chooseParentSchool=function(schoolId){
  const sid=String(schoolId||"").trim();
  if(!sid)return;
  sessionStorage.setItem("school_context_id",sid);
  sessionStorage.setItem("role_context","parent");
  location.reload();
};
window.clearParentSchoolSelection=function(){
  sessionStorage.removeItem("school_context_id");
  sessionStorage.removeItem("role_context");
  location.reload();
};
function registrationForm(){return `<div class="card"><h2>第一次登入｜綁定學生</h2><div class="notice"><b>綁定學校：${esc(state.me?.schoolName||"未指定學校")}</b><br>登入 Gmail：${esc(state.me.email)}<br>請填寫學生姓名與學號供系統比對。年級、班級、團別與樂器一律以目前學校的學生主檔為準，家長填寫內容不會修改學生資料。</div><button class="secondary" style="width:100%;margin:0 0 12px" onclick="clearParentSchoolSelection()">← 重新選擇學校</button><label>學生姓名</label><input id="rName" autocomplete="off" placeholder="請輸入學生完整姓名"><label>學生學號</label><input id="rStudentNo" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="請輸入 6 碼學生學號"><div class="check"><input id="rConsent" type="checkbox"><div>我確認此 Google 帳號為上述學生之家長／監護人，並同意建立家長存取權限。</div></div><button class="primary" onclick="submitRegistration()">送出綁定申請</button></div>`}
async function submitRegistration(){if(!$("rConsent").checked){toast("請先確認家長／監護人關係");return}const studentName=$("rName").value.trim(),studentNo=$("rStudentNo").value.trim();if(!studentName){toast("請填寫學生姓名");return}if(!studentNo){toast("請填寫學生學號");return}if(!/^\d{6}$/.test(studentNo)){toast("學號需為 6 碼數字");return}const body={studentName,studentNo,consent:true};try{await api("/api/student-registration",{method:"POST",body:JSON.stringify(body)});toast("✅ 已送出，等待管理員確認");state.page="home";render()}catch(e){toast("❌ "+e.message)}}
function lineAccountRecoveryPanel(){
  const schoolId=state.me?.schoolId||"",valid=/^[a-z0-9-]{2,60}$/.test(schoolId);
  const entry=role=>"/?"+new URLSearchParams({[role+"LineAccount"]:schoolId,openExternalBrowser:"1"});
  const linkStyle="display:block;padding:14px;text-align:center;text-decoration:none;border-radius:12px";
  const existing=valid?`<a class="primary" href="${esc(entry("parent"))}" style="${linkStyle}">已核准家長｜用原 Gmail 綁定 LINE</a>
      <a class="secondary" href="${esc(entry("teacher"))}" style="${linkStyle};margin-top:10px">已建檔老師｜用原 Gmail 綁定 LINE</a>
      <p class="muted">請用 Safari 或 Chrome，以原本的 Gmail 登入，完成 LINE 授權並確認綁定。不用重填學生資料，也不用等幹部審核。</p>`:
    '<p class="notice">請重新選擇所屬學校，再連結原本的 Gmail 帳號。</p>';
  return `<section class="card"><h2>連結既有平台帳號</h2><p>如果您已經有平台帳號，請使用下方對應的 Gmail 入口，不要重新申請。</p>
    ${existing}<button type="button" class="secondary" style="display:block;width:100%;margin-top:14px" onclick="go('register')">首次申請家長資格｜申請綁定學生</button></section>`;
}
function home(){if(state.me.role==="unassigned")return state.me.authProvider==="line"?lineAccountRecoveryPanel():registrationForm();if(!state.student)return `<div class="card"><div class="notice">目前帳號尚未綁定學生。</div><button class="primary" onclick="go('register')">綁定孩子</button></div>`;const s=state.summary||{},rate=Math.round((s.practiceRate||0)*1000)/10;return `<div class="card hero"><div class="student"><div class="studentleft"><div class="avatar">${esc(state.student.name?.[0]||"學")}</div><div><div class="name">${esc(state.student.name)}</div><div class="muted">${esc(state.student.groupName)}團｜${esc(state.student.instrument)}｜${esc(state.student.grade)}</div></div></div><div class="pill">${new Date().getMonth()+1}月</div></div><div class="grid"><div class="kpi"><b>${s.practiceQualifiedDays||0}</b><span>自主練習達標天數</span></div><div class="kpi"><b>${s.practiceMinutes||0}</b><span>累計練習分鐘</span></div><div class="kpi"><b>${s.sectionPresent||0} / ${s.sectionTotal||0}</b><span>分部團練</span></div><div class="kpi"><b>${s.privatePresent||0} / ${s.privateTotal||0}</b><span>個別課</span></div></div><div style="margin-top:12px;font-size:12px;font-weight:800">自主練習達標率 <span style="float:right">${rate}%</span></div><div class="progress"><i style="width:${Math.min(rate,100)}%"></i></div></div><div class="card"><h2>今天要做什麼？</h2><div class="notice">年級、團別與樂器資料由學生主檔管理，之後異動不會影響既有點名／練習紀錄。</div><button class="primary" onclick="go('practice')">立即自主練習打卡</button></div>`}
function calcMinutes(s,e){if(!s||!e)return 0;const[a,b]=s.split(":").map(Number),[c,d]=e.split(":").map(Number);let m=(c*60+d)-(a*60+b);if(m<0)m+=1440;return m}
function practicePage(){const today=new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Taipei"}),logs=state.practice.slice(0,8);const history=logs.length?logs.map(x=>`<div class="item" style="align-items:flex-start"><div style="min-width:0;flex:1"><b>${esc(x.practiceDate)}｜${esc(x.practiceContent||"自主練習")}</b><small>${esc(x.startTime||"")}～${esc(x.endTime||"")}｜本次 ${Number(x.minutes||0)} 分鐘｜當日累計 ${Number(x.dailyMinutes||x.minutes||0)} 分鐘</small>${x.weeklyGoalText?`<small>🎯 老師建議：${esc(x.weeklyGoalText)}</small>`:""}</div><div style="display:flex;align-items:center;gap:8px;flex-shrink:0"><span class="badge ${x.qualified?"ok":"bad"}">${x.qualified?"當日達標":"當日未達"}</span>${x.practiceId?`<button type="button" style="border:1px solid #c94b4b;background:#fff7f7;color:#a52a2a;border-radius:10px;padding:7px 9px;font-weight:800" onclick="deletePracticeRecord('${esc(x.practiceId)}','${esc(x.practiceDate)}','${esc(x.startTime||"")}','${esc(x.endTime||"")}',${Number(x.minutes||0)},'${esc(x.sourceStudentId||"")}')">🗑️</button>`:""}</div></div>`).join(""):`<div class="notice">本月尚無紀錄。</div>`;return `<div class="card"><h2>自主練習打卡</h2><div class="notice">${esc(state.student?.name)}｜${esc(state.student?.groupName)}團｜${esc(state.student?.instrument)}</div><label>練習日期</label><input id="pDate" type="date" value="${today}" onchange="updateMinutes()"><div class="row2"><div><label>開始時間</label><input id="pStart" type="time" value="18:00" oninput="updateMinutes()"></div><div><label>結束時間</label><input id="pEnd" type="time" value="18:20" oninput="updateMinutes()"></div></div><div class="minutes"><div><div class="muted">本次練習時間</div><strong><span id="pMins">20</span> 分鐘</strong></div><span id="pQual" class="badge ok">✅ 已達標</span></div><label>練習內容／曲目</label><textarea id="pContent" rows="3"></textarea><label>練習重點</label><select id="pFocus"><option>音階／基本功</option><option>團練曲目</option><option>考試曲</option><option>節奏／視奏</option><option>其他</option></select><div class="check"><input id="pConfirm" type="checkbox"><div>家長確認：我確認學生已完成上述自主練習。</div></div><button id="savePracticeBtn" class="primary" onclick="savePractice()">送出今天的打卡</button></div><div class="card"><h2>最近打卡</h2><div class="notice" style="margin-bottom:10px">如誤登日期或時間，可由家長移除錯誤紀錄；移除後會重新計算本月練習分鐘與達標天數。</div>${history}</div>`}
function updateMinutes(){const m=calcMinutes($("pStart").value,$("pEnd").value),date=$("pDate").value,registered=(state.practice||[]).filter(x=>String(x.practiceDate||"")===date).reduce((sum,x)=>sum+Number(x.minutes||0),0),total=registered+m;$("pMins").textContent=m;$("pQual").className=`badge ${m>0&&total>=20?"ok":"bad"}`;$("pQual").textContent=m<=0?"⚠️ 本次尚未練習":total>=20?"✅ 當日累計達標":`⚠️ 當日還差 ${20-total} 分鐘`}
let practiceSaving=false;
async function savePractice(){
  if(practiceSaving)return false;
  if(!$("pConfirm").checked){toast("請先完成家長確認");return false}
  const body={studentId:state.student.studentId,practiceDate:$("pDate").value,startTime:$("pStart").value,endTime:$("pEnd").value,practiceContent:$("pContent").value.trim(),focus:$("pFocus").value,parentConfirmed:true};
  // Optional link to a published, student-authorized teacher goal.
  const selectedGoal=document.querySelector('input[name="weeklyGoalChoice"]:checked');
  if(selectedGoal?.dataset.goalLesson){
    body.weeklyGoal={lessonId:selectedGoal.dataset.goalLesson,index:Number(selectedGoal.dataset.goalIndex)};
    if(selectedGoal.dataset.goalText)body.weeklyGoal.text=selectedGoal.dataset.goalText;
  }
  const button=document.getElementById("savePracticeBtn");
  practiceSaving=true;
  if(button){button.disabled=true;button.textContent="⏳ 正在送出紀錄…"}
  try{
    const result=await api("/api/practice",{method:"POST",body:JSON.stringify(body)});
    toast(result.duplicate?"ℹ️ 這個時段已有練習紀錄，沒有重複新增":"✅ 自主練習已送出");
    await refreshStudent();render();return true;
  }catch(e){toast("❌ "+e.message);return false}
  finally{
    practiceSaving=false;
    if(button?.isConnected){button.disabled=false;button.textContent="完成並送出紀錄"}
  }
}
window.deletePracticeRecord=async function(practiceId,practiceDate,startTime,endTime,minutes,sourceStudentId=""){
  if(state.me?.role!=="parent"||!state.student)return;
  const detail=[practiceDate,[startTime,endTime].filter(Boolean).join("～"),minutes?minutes+" 分鐘":""].filter(Boolean).join("｜");
  if(!confirm("確定移除這筆自主練習紀錄？\n\n"+detail+"\n\n移除後，本月練習分鐘與達標天數會重新計算。"))return;
  try{
    await api("/api/practice",{method:"DELETE",body:JSON.stringify({studentId:state.student.studentId,practiceId,sourceStudentId})});
    toast("✅ 已移除自主練習紀錄");
    await refreshStudent();render();
  }catch(e){toast("❌ "+e.message)}
};
function recordPage(){const s=state.summary||{},m=Number(s.practiceMinutes||0);return `<div class="card hero record-overview"><h2>📊 ${esc(state.student?.name)}｜學習紀錄總覽</h2><div class="muted">下方分為「本學期出勤紀錄」與「個別課專區」，避免將點名統計、課程內容與師資評價混在一起。</div><div class="grid" style="margin-top:14px"><div class="kpi"><b>${s.practiceQualifiedDays||0} 天</b><span>自主練習達標</span></div><div class="kpi"><b>${Math.floor(m/60)} 小時 ${m%60} 分</b><span>自主練習</span></div></div></div>`}
function sectionPage(){const today=new Date().toISOString().slice(0,10);return `<div class="card"><h2>分部團練點名</h2><label>上課日期</label><input id="sDate" type="date" value="${today}"><label>聲部</label><input id="sSection" value="${esc(state.me.section||"")}"></div><div class="card"><h2>學生名單</h2>${state.students.map(s=>`<div class="item"><div><b>${esc(s.name)}</b><small>${esc(s.groupName)}團｜${esc(s.instrument)}</small></div><select id="att_${s.studentId}" class="status-select"><option value="present">出席</option><option value="late">遲到</option><option value="leave">請假</option><option value="absent">缺席</option><option value="cancelled">停課</option></select></div>`).join("")}<button class="primary" onclick="saveSection()">儲存本次點名</button></div>`}
async function saveSection(){const items=state.students.map(s=>({studentId:s.studentId,status:$(`att_${s.studentId}`).value,minutes:$(`att_${s.studentId}`).value==="absent"?0:45}));try{await api("/api/section-attendance",{method:"POST",body:JSON.stringify({sessionDate:$("sDate").value,section:$("sSection").value,items})});toast("✅ 分部點名已儲存")}catch(e){toast("❌ "+e.message)}}
function privatePage(){const today=new Date().toISOString().slice(0,10);return `<div class="card"><h2>個別課紀錄</h2><label>學生</label><select id="iStudent">${state.students.map(s=>`<option value="${s.studentId}">${esc(s.name)}｜${esc(s.instrument)}</option>`).join("")}</select><label>上課日期</label><input id="iDate" type="date" value="${today}"><div class="row2"><div><label>狀態</label><select id="iStatus"><option value="present">出席</option><option value="late">遲到</option><option value="leave">請假</option><option value="absent">缺席</option></select></div><div><label>分鐘</label><input id="iMinutes" type="number" value="50"></div></div><label>課程內容</label><textarea id="iContent" rows="3"></textarea><button class="primary" onclick="savePrivate()">儲存個別課紀錄</button></div>`}
async function savePrivate(){try{await api("/api/private-lesson",{method:"POST",body:JSON.stringify({studentId:$("iStudent").value,lessonDate:$("iDate").value,status:$("iStatus").value,minutes:Number($("iMinutes").value||0),lessonContent:$("iContent").value})});toast("✅ 個別課紀錄已儲存")}catch(e){toast("❌ "+e.message)}}
function pendingCard(r){const matches=state.master.filter(s=>String(s.name||"").trim()===String(r.studentName||"").trim()&&String(s.studentId||"").trim()===String(r.studentNo||"").trim()),matched=matches.length===1?matches[0]:null;return `<div class="card"><h2>${esc(r.studentName)}｜待審核</h2><div class="notice">申請 Gmail：${esc(r.parentEmail)}<br>家長填寫：${esc(r.studentName)}｜學號 ${esc(r.studentNo||"未填學號")}<br>${matched?`系統比對：${esc(matched.grade)}｜${esc(matched.groupName)}團｜${esc(matched.instrument)}｜學號 ${esc(matched.studentId)}`:"⚠️ 無法唯一比對學生，請管理員指定正確學生。"}</div><label>對應學生主檔</label><select id="rm_${r.registrationId}"><option value="">請選擇學生</option>${state.master.map(s=>`<option value="${esc(s.studentId)}" ${matched&&s.studentId===matched.studentId?"selected":""}>${esc(s.name)}｜${esc(s.grade)}｜${esc(s.groupName)}團｜${esc(s.instrument)}</option>`).join("")}</select><div class="row2"><button class="primary" onclick="approveReg('${r.registrationId}')">核准綁定</button><button class="secondary" style="margin-top:14px" onclick="rejectReg('${r.registrationId}')">退回</button></div></div>`}
async function approveReg(id){const studentId=$(`rm_${id}`).value;if(!studentId){toast("請先指定正確學生");return}const body={registrationId:id,action:"approve",studentId};try{await api("/api/student-registration",{method:"PATCH",body:JSON.stringify(body)});toast("✅ 已核准並綁定");await loadAdmin();render()}catch(e){toast("❌ "+e.message)}}
async function rejectReg(id){if(!confirm("確定退回此登記？"))return;try{await api("/api/student-registration",{method:"PATCH",body:JSON.stringify({registrationId:id,action:"reject"})});toast("已退回");await loadAdmin();render()}catch(e){toast("❌ "+e.message)}}
function adminPage(){return `<div class="card hero"><h2>管理員 Dashboard</h2><div class="grid"><div class="kpi"><b>${state.master.length}</b><span>學生主檔</span></div><div class="kpi"><b>${state.registrations.length}</b><span>待審核</span></div><div class="kpi"><b>80%</b><span>考試</span></div><div class="kpi"><b>10/5/5</b><span>練習／個課／分部</span></div></div></div>${state.registrations.length?`<h2>待審核學生</h2>${state.registrations.map(pendingCard).join("")}`:`<div class="card"><div class="notice">目前沒有待審核資料。</div></div>`}`}
function studentEdit(s){return `<div class="card"><h2>${esc(s.name)} <span class="badge ${s.status==="active"?"ok":"warn"}">${esc(s.studentId)}</span></h2><label>姓名</label><input id="sn_${s.studentId}" value="${esc(s.name)}"><div class="row2"><div><label>年級</label><select id="sg_${s.studentId}">${opts(grades,s.grade)}</select></div><div><label>團別</label><select id="sgrp_${s.studentId}">${opts(groups,s.groupName)}</select></div></div><label>樂器</label><select id="si_${s.studentId}">${opts(instruments,s.instrument)}</select><div class="row2"><div><label>學年度</label><input id="sy_${s.studentId}" value="${esc(s.schoolYear||"")}"></div><div><label>狀態</label><select id="ss_${s.studentId}"><option value="active" ${s.status==="active"?"selected":""}>在團</option><option value="inactive" ${s.status==="inactive"?"selected":""}>停用／離團</option></select></div></div><button class="primary" onclick="saveStudent('${s.studentId}')">儲存異動</button></div>`}
function studentsPage(){
 const all=state.master||[],filter=state.studentMasterFilter||"ALL";
 const group=s=>["C","儲備"].includes(String(s.groupName||"").trim())?"RESERVE":String(s.groupName||"").trim();
 const query=String(state.studentMasterQuery||"").trim().toLocaleLowerCase("zh-Hant");
 const rank=s=>{const section=String(s.section||"").trim(),instrument=String(s.instrument||"").trim();if(section.includes("小提一"))return 0;if(section.includes("小提二"))return 1;if(section.includes("中提"))return 3;if(section.includes("大提"))return 4;if(section.includes("低音"))return 5;if(instrument.includes("小提"))return 2;if(instrument.includes("中提"))return 3;if(instrument.includes("大提"))return 4;if(instrument.includes("低音"))return 5;return 6};
 const lineFilter=window.currentStudentLineFilter?.()||"all";
 const students=all.filter(s=>(lineFilter==="all"||(s.status!=="inactive"&&window.studentLineStatus?.(s)===lineFilter))&&(filter==="ALL"||filter==="INACTIVE"?filter!=="INACTIVE"||s.status==="inactive":group(s)===filter)&&(!query||[s.name,s.studentId,s.classCode,s.grade,s.groupName,s.instrument,s.section].join(" ").toLocaleLowerCase("zh-Hant").includes(query))).sort((a,b)=>Number(a.status==="inactive")-Number(b.status==="inactive")||rank(a)-rank(b)||String(a.grade||"").localeCompare(String(b.grade||""),"zh-Hant",{numeric:true})||String(a.name||"").localeCompare(String(b.name||""),"zh-Hant"));
 const choices=[["ALL","全部"],["A","A 團"],["B","B 團"],["RESERVE","儲備團"],["INACTIVE","退出／停用"]];
 const filters=choices.map(([key,label])=>{const count=all.filter(s=>key==="ALL"||key==="INACTIVE"?key!=="INACTIVE"||s.status==="inactive":group(s)===key).length;return `<button type="button" aria-pressed="${filter===key}" onclick="selectStudentMasterGroup('${key}')">${label} <span>${count}</span></button>`}).join("");
 const rows=students.map(s=>{const parents=Array.isArray(s.parents)?s.parents.length:0;const pending=(state.registrations||[]).some(r=>String(r.status||"pending")==="pending"&&(String(r.studentNo||r.studentId||"").trim()===String(s.studentId||"").trim()||String(r.matchedStudentId||"").trim()===String(s.studentId||"").trim()));
  return `<details class="student-master-row"><summary><span><strong>${esc(s.name)}</strong><small>${esc(s.studentId)}</small></span><span>${esc(s.grade||"待確認")}<small>${esc(s.groupName||"待確認")}團</small></span><span>${esc(s.instrument||"待確認")}<small>${esc(s.section||"分部待確認")}</small></span><span>${s.status==="inactive"?"已退出／停用":parents?`已核准 ${parents} 位家長`:pending?"家長待審核":"未綁定"}${s.status!=="inactive"&&window.studentLineStatusLabel?`<small class="student-line-row" data-line-status="${window.studentLineStatus(s)}">${esc(window.studentLineStatusLabel(s))}</small>`:""}<small>展開編輯</small></span></summary><div class="student-master-edit">${studentEdit(s)}</div></details>`}).join("");
 return `<div class="card student-master-list student-task-panel" data-student-task-panel="browse"><h2>查詢／修改學生</h2>${window.studentLineCoverage?.(all,students.length)||""}<div class="student-task-steps" aria-label="操作步驟"><span><b>1</b>搜尋學生</span><span><b>2</b>展開資料</span><span><b>3</b>儲存修改</span></div><form class="student-master-search" onsubmit="runStudentMasterSearch(event)"><label for="studentMasterQuery">姓名或學號</label><div><input id="studentMasterQuery" value="${esc(state.studentMasterQuery||"")}" placeholder="輸入姓名、學號、班級或樂器"><button type="submit">搜尋</button>${query?'<button type="button" class="secondary" onclick="clearStudentMasterSearch()">清除</button>':""}</div></form><p>共 ${all.length} 位學生；目前顯示 ${students.length} 位。點選學生即可修改基本資料，或辦理團別異動、退出與重新加入。</p><div class="student-master-filters" role="group" aria-label="依團別篩選學生">${filters}</div><div class="student-master-head" aria-hidden="true"><span>學生</span><span>年級／團別</span><span>樂器／分部</span><span>家長／狀態</span></div>${rows||'<div class="notice">找不到符合條件的學生，請調整關鍵字或團別。</div>'}</div>`
}
window.selectStudentMasterGroup=function(group){if(!["ALL","A","B","RESERVE","INACTIVE"].includes(group))return;state.studentMasterFilter=group;render()};
window.runStudentMasterSearch=function(event){event?.preventDefault();state.studentMasterQuery=$("studentMasterQuery")?.value.trim()||"";render()};
window.clearStudentMasterSearch=function(){state.studentMasterQuery="";render()};
async function saveStudent(id){const body={studentId:id,name:$(`sn_${id}`).value,grade:$(`sg_${id}`).value,groupName:$(`sgrp_${id}`).value,instrument:$(`si_${id}`).value,schoolYear:$(`sy_${id}`).value,status:$(`ss_${id}`).value};try{await api("/api/student-master",{method:"PATCH",body:JSON.stringify(body)});toast("✅ 學生主檔已更新");await loadAdmin();render()}catch(e){toast("❌ "+e.message)}}
function helpPage(){return `<div class="card"><h2>系統說明</h2><div class="notice">Gmail 只用來辨識家長／老師／管理員；學生資料存在 StudentMaster。年級升級、A/B 團異動、換樂器時，只更新學生主檔即可。</div></div>`}
function render(){if(window.__roleLoaderActive&&window.__roleModulesReady!==true)window.ensureRoleModules?.();let c;const teacherRole=["teacher","sectionTeacher","ensembleTeacher","comprehensiveTeacher","privateTeacher"].includes(state.me?.role)||state.me?.capabilities?.teacherSettings;if((teacherRole||state.me?.role==="parent"||state.me?.role==="admin")&&window.__roleLoaderActive&&window.__roleModulesReady!==true){const parent=state.me?.role==="parent",admin=state.me?.role==="admin",app=document.getElementById("app"),bootKey=[state.me?.email,state.me?.schoolId,state.me?.role,window.__roleModuleError||""].join("|");if(app._roleBootKey===bootKey&&app.innerHTML.includes('data-role-boot'))return;app._roleBootKey=bootKey;c=window.__roleModuleError?`<div class="card hero" data-role-boot role="alert"><h2>功能尚未載入完成</h2><div class="notice">請再試一次，即可繼續查看完整功能。</div><button class="primary" onclick="retryRoleModules()">重新載入功能</button></div>`:`<div class="card hero" data-role-boot aria-live="polite"><h2>${parent?"正在準備家長功能":admin?"正在準備工作首頁":"🎓 正在準備教學功能"}</h2><div class="notice">${parent?"正在載入今日課程、活動與學習紀錄，請稍候。":admin?"正在準備常用工作入口，請稍候。":"正在同步今日課程、點名與教學設定，完成後即可直接操作。"}</div><div class="teacher-boot-progress"><i></i></div></div>`;app.innerHTML=admin?`<div class="admin-boot-screen">${c}</div>`:shell(c);return}if(state.page==="schoolAccessError")c=`<div class="card hero"><h2>🏫 校方帳號設定需修正</h2><div class="notice">此 Gmail 對應多所學校，請通知系統管理員確認校方查詢權限。</div></div>`;else if(state.me.role==="school")c=state.schoolViewerLoadError?`<div class="card hero"><h2>🏫 校方功能暫時無法開啟</h2><div class="error">${esc(state.schoolViewerLoadError)}</div><button class="primary" onclick="retrySchoolView()">重新載入校方功能</button></div>`:`<div class="card hero"><h2>🏫 正在載入校方出缺勤資料…</h2></div>`;else if(state.page==="schoolSelect")c=schoolSelectionPage();else if(state.page==="contextSelect")c=contextSelectorPage();else if(state.me.role==="admin")c=state.page==="students"?studentsPage():state.page==="help"?helpPage():adminPage();else if(teacherRole){if(state.page==="help")c=helpPage();else if(state.page==="private")c=privatePage();else if(state.page==="section")c=sectionPage();else c=home()}else if(state.me?.role==="parent"&&state.page==="home"&&state.student&&!state.summary)c=`<div class="card hero"><h2>👋 ${esc(state.student.name)}</h2>${state.summaryLoadError?`<div class="error">${esc(state.summaryLoadError)}</div><button class="secondary" onclick="state.summaryLoadError='';render();refreshStudent().then(()=>render()).catch(e=>{state.summaryLoadError=e.message||'資料載入失敗';render()})">重新載入資料</button>`:`<div class="notice">正在載入學習紀錄與課程資訊…</div>`}</div>`;else if(state.me?.role==="parent"&&state.page==="uniformEvents")c=`<div class="parent-uniform-view"><h2>🎻 活動與團服</h2><iframe id="parentUniformFrame" title="活動與團服" src="/parent-uniform-events.html?embedded=1${state.parentUniformFocus?"&focus="+encodeURIComponent(state.parentUniformFocus):""}" loading="eager" scrolling="no"></iframe></div>`;else if(state.page==="practice")c=practicePage();else if(state.page==="record")c=recordPage();else if(state.page==="register")c=registrationForm();else if(state.page==="help")c=helpPage();else c=home();document.getElementById("app").innerHTML=shell(c)}
boot();

window.addEventListener("message",event=>{if(event.origin!==location.origin||event.data?.type!=="parent-uniform-height")return;const frame=document.getElementById("parentUniformFrame");if(frame&&event.source===frame.contentWindow&&Number.isFinite(event.data.height))frame.style.height=Math.max(400,Math.min(event.data.height,50000))+"px"});
