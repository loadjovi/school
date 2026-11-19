(()=>{
  const roles=new Set(["teacher","sectionTeacher","ensembleTeacher","comprehensiveTeacher","privateTeacher"]);
  const pages=new Set(["teacherHome","teacherSettings"]);
  const teacher=()=>roles.has(state.me?.role);
  const identity=()=>teacher()?JSON.stringify([state.me.schoolId,state.me.identityId,state.me.email,state.me.authProvider,state.me.role]):"";
  let currentKey="",account=null,error="",loading=false,busy=false,version=0;
  const manage="/fee-collections.html#lineBinding";

  function mount(){
    document.getElementById("teacherLineAccount")?.remove();
    if(!teacher()||!pages.has(state.page))return;
    const main=document.querySelector(".main");if(!main)return;
    const key=identity();
    if(key!==currentKey){
      currentKey=key;account=null;error="";loading=false;busy=false;version++;
      if(state.me.capabilities?.lineAccount){void load();return}
    }
    let content="";
    if(!state.me.capabilities?.lineAccount||account?.configured===false){
      content='<div class="notice">此校尚未開啟 LINE 綁定，請聯絡學校管理員設定。</div>';
    }else if(error){
      content=`<div class="notice" role="alert">${esc(error)}</div><button type="button" class="secondary" onclick="teacherLineAccount.refresh()">重新確認綁定狀態</button>`;
    }else if(loading||!account){
      content='<div class="notice" role="status">正在確認 LINE 綁定狀態…</div>';
    }else if(account.pendingLink){
      content='<div class="notice">LINE 授權已完成，請核對 Gmail 與 LINE 帳號並確認綁定。</div><a class="button primary" href="'+manage+'">核對並確認綁定</a>';
    }else if(account.bound&&account.googleLinked){
      content=`<div class="notice"><b>✅ LINE 已綁定</b><br>LINE 名稱：${esc(account.lineDisplayName||"未提供名稱")}<br>Gmail：${esc(state.me.email||"")}</div><p class="muted">請維持加入此校官方帳號好友，以接收家長的個課改期、停課及確認通知。收到通知後，可進入平台回應與處理。</p><a class="button secondary" href="${manage}">管理 LINE 綁定</a>`;
    }else{
      content=`<div class="notice"><b>尚未完成 Gmail 與 LINE 綁定</b><br>Gmail：${esc(state.me.email||"")}</div><p class="muted">請使用自己的 LINE 帳號授權，再核對 Gmail 與 LINE 名稱完成綁定。完成後可接收家長的個課狀態通知，並回平台處理。</p>${account.authProvider==="google"?`<button type="button" class="primary" onclick="teacherLineAccount.bind()" ${busy?"disabled":""}>${busy?"正在開啟 LINE 授權…":"綁定我的 LINE 帳號"}</button>`:`<a class="button primary" href="${manage}">連結我的 Gmail 與 LINE</a>`}`;
    }
    main.insertAdjacentHTML("afterbegin",`<section id="teacherLineAccount" class="card" aria-labelledby="teacherLineAccountTitle" style="overflow-wrap:anywhere"><h2 id="teacherLineAccountTitle">🔔 老師 LINE 通知</h2>${content}${account&&!error&&!loading?'<button type="button" class="secondary" style="margin-top:8px" onclick="teacherLineAccount.refresh()">更新綁定狀態</button>':""}</section>`);
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
    refresh:()=>{if(!loading)return load()},
    async bind(){
      if(!teacher()||busy||loading||!account?.configured||account.bound||account.pendingLink||account.authProvider!=="google")return;
      const key=identity(),schoolId=state.me.schoolId;
      busy=true;error="";mount();
      try{
        const {url}=await api("/api/line/tenant-login/"+encodeURIComponent(schoolId)+"/start",{method:"POST",body:JSON.stringify({mode:"link"})});
        if(key===identity())location.assign(url);
      }catch(e){if(key===identity())error=e?.message||"LINE 授權啟動失敗，請重試。"}
      finally{if(key===identity()){busy=false;mount()}}
    }
  };
  const previousRender=render;
  render=function(){const result=previousRender();mount();return result};
  window.addEventListener("pageshow",()=>{if(teacher()&&pages.has(state.page))void load()});
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&teacher()&&pages.has(state.page)&&!loading)void load()});
  mount();
})();
