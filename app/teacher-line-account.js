(()=>{
  const roles=new Set(["teacher","sectionTeacher","ensembleTeacher","comprehensiveTeacher","privateTeacher"]);
  const pages=new Set(["teacherHome","teacherSettings"]);
  const teacher=()=>roles.has(state.me?.role);
  const identity=()=>teacher()?JSON.stringify([state.me.schoolId,state.me.identityId,state.me.email,state.me.authProvider,state.me.role]):"";
  let currentKey="",account=null,error="",loading=false,busy=false,version=0;
  let accountViewKey="";
  function openAccount(params){
    if(!teacher()||!state.me.capabilities?.lineAccount)return;
    state.teacherLineAccountParams=params||new URLSearchParams();
    state.page="teacherLineAccount";render();
  }
  function renderAccount(){
    const key=identity();
    if(accountViewKey===key&&document.getElementById("teacherLineAccountFrame"))return;
    const query=new URLSearchParams({embedded:"teacher",schoolId:state.me.schoolId});
    for(const name of ["line_link","line_error","line_friend"]){
      const value=state.teacherLineAccountParams?.get(name);
      const allowed=name==="line_friend"?["checked","unavailable","mismatch"]:name==="line_link"?["confirm"]:["conflict","configuration","authorization","verification"];
      if(allowed.includes(value))query.set(name,value);
    }
    document.getElementById("app").innerHTML=shell(`<button type="button" class="secondary" onclick="go('teacherHome')">← 返回教學首頁</button><iframe id="teacherLineAccountFrame" title="老師 Gmail 與 LINE 綁定" src="/line-account.html?${esc(query.toString())}" style="display:block;width:100%;min-height:650px;border:0;margin-top:12px" scrolling="no"></iframe>`);
    accountViewKey=key;
  }

  function mount(){
    document.getElementById("teacherLineAccount")?.remove();
    if(!teacher()||!pages.has(state.page))return;
    const main=document.querySelector(".main");if(!main)return;
    const key=identity();
    if(key!==currentKey){
      currentKey=key;account=null;error="";loading=false;busy=false;version++;
      if(state.me.capabilities?.lineAccount){void load();return}
    }
    if(state.page==="teacherHome"&&(loading||!account||account.configured===false||account.bound&&account.googleLinked&&!account.pendingLink))return;
    let content="";
    if(!state.me.capabilities?.lineAccount||account?.configured===false){
      content='<div class="notice">此校尚未開啟 LINE 綁定，請聯絡學校管理員設定。</div>';
    }else if(error){
      content=`<div class="notice" role="alert">${esc(error)}</div><button type="button" class="secondary" onclick="teacherLineAccount.refresh()">重新確認綁定狀態</button>`;
    }else if(loading||!account){
      content='<div class="notice" role="status">正在確認 LINE 綁定狀態…</div>';
    }else if(account.pendingLink){
      content='<div class="notice">LINE 授權已完成，請核對 Gmail 與 LINE 帳號並確認綁定。</div><button type="button" class="primary" onclick="teacherLineAccount.open()">核對並確認綁定</button>';
    }else if(account.bound&&account.googleLinked){
      content=`<div class="notice"><b>✅ LINE 已綁定</b><br>LINE 名稱：${esc(account.lineDisplayName||"未提供名稱")}<br>Gmail：${esc(state.me.email||"")}</div><p class="muted">請維持加入此校官方帳號好友，以接收家長的個課改期、停課及確認通知。收到通知後，可進入平台回應與處理。</p><button type="button" class="secondary" onclick="teacherLineAccount.open()">管理 LINE 綁定</button>`;
    }else{
      content=`<div class="notice"><b>尚未完成 Gmail 與 LINE 綁定</b><br>Gmail：${esc(state.me.email||"")}</div><p class="muted">請使用自己的 LINE 帳號授權，再核對 Gmail 與 LINE 名稱完成綁定。完成後可接收家長的個課狀態通知，並回平台處理。</p>${account.authProvider==="google"?`<button type="button" class="primary" onclick="teacherLineAccount.bind()" ${busy?"disabled":""}>${busy?"正在開啟 LINE 授權…":"綁定我的 LINE 帳號"}</button>`:`<button type="button" class="primary" onclick="teacherLineAccount.open()">連結我的 Gmail 與 LINE</button>`}`;
    }
    main.insertAdjacentHTML(state.page==="teacherHome"?"beforeend":"afterbegin",`<section id="teacherLineAccount" class="card" aria-labelledby="teacherLineAccountTitle" style="overflow-wrap:anywhere"><h2 id="teacherLineAccountTitle">🔔 老師 LINE 通知</h2>${content}${account&&!error&&!loading?'<button type="button" class="secondary" style="margin-top:8px" onclick="teacherLineAccount.refresh()">更新綁定狀態</button>':""}</section>`);
  }

  async function load(){
    const key=identity();if(!key||!state.me.capabilities?.lineAccount)return;
    const request=++version;loading=true;error="";
    mount();
    try{
      const result=await api("/api/line/school-account");
      if(request!==version||key!==identity())return;
      account=result;
    }catch(e){
      if(request!==version||key!==identity())return;
      account=null;error=e?.message||"無法確認 LINE 綁定狀態，請稍後重試。";
    }finally{
      if(request===version&&key===identity()){loading=false;mount()}
    }
  }

  window.teacherLineAccount={
    open:()=>openAccount(),
    refresh:()=>{if(!loading)return load()},
    async bind(){
      if(!teacher()||busy||loading||!account?.configured||account.bound||account.pendingLink||account.authProvider!=="google")return;
      const key=identity(),schoolId=state.me.schoolId;
      busy=true;error="";mount();
      try{
        const {url}=await api("/api/line/tenant-login/"+encodeURIComponent(schoolId)+"/start",{method:"POST",body:JSON.stringify({mode:"link",returnTo:"teacher-account"})});
        const target=new URL(url);
        if(target.origin!=="https://access.line.me"||target.pathname!=="/oauth2/v2.1/authorize")throw Error("LINE 授權網址不正確，請重試。");
        if(key===identity()){
          sessionStorage.setItem("teacher_line_account_return",schoolId);
          sessionStorage.removeItem("parent_line_account_return");
          location.assign(target.href);
        }
      }catch(e){if(key===identity())error=e?.message||"LINE 授權啟動失敗，請重試。"}
      finally{if(key===identity()){busy=false;mount()}}
    }
  };
  const previousRender=render;
  render=function(){
    if(teacher()&&state.page==="teacherLineAccount"&&state.me.capabilities?.lineAccount){
      if(window.__roleLoaderActive&&window.__roleModulesReady!==true){
        document.getElementById("app").innerHTML=shell('<section class="card" role="status">正在準備老師 LINE 綁定，請稍候…</section>');
        return;
      }
      renderAccount();return;
    }
    accountViewKey="";const result=previousRender();mount();return result;
  };
  window.addEventListener("message",event=>{
    const frame=document.getElementById("teacherLineAccountFrame");
    if(event.origin!==location.origin||!frame||event.source!==frame.contentWindow)return;
    if(event.data?.type==="teacher-line-account-changed"){void load();return}
    if(event.data?.type!=="teacher-line-account-height"||!Number.isFinite(event.data.height))return;
    frame.style.height=Math.max(400,Math.min(event.data.height,12000))+"px";
  });
  window.addEventListener("pageshow",()=>{if(teacher()&&pages.has(state.page))void load()});
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&teacher()&&pages.has(state.page)&&!loading)void load()});
  const returned=new URLSearchParams(location.search);
  if(teacher()&&returned.get("teacherLineAccount")===state.me.schoolId){
    sessionStorage.removeItem("teacher_line_account_return");
    openAccount(returned);
    for(const name of ["teacherLineAccount","line_link","line_error","line_friend"])returned.delete(name);
    history.replaceState({},"",location.pathname+(returned.size?"?"+returned:"")+location.hash);
  }else mount();
})();
