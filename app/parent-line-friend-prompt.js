(()=>{
  if(window.parentLineFriendPrompt)return;
  const shown=new Set();
  const ownDialogs=new WeakSet();
  let active=null,generation=0,refreshQueued=false;
  const make=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node};

  function snapshot(){
    if(window.__roleModulesReady===false||window.__roleModuleBootstrap||window.__roleLoaderActive&&window.__roleModulesReady!==true)return null;
    const me=state.me,binding=state.parentLineBinding;
    if(me?.role!=="parent"||state.page!=="home"||me.capabilities?.lineAccount!==true||binding?.lineBound!==true||binding.friendStatus!=="not_friend"||typeof parentLineBindingKey!=="function")return null;
    // Let the initial student reads settle before an optional OAuth POST can
    // advance the API write scope and discard their otherwise valid results.
    if(state.student&&!state.summary&&!state.summaryLoadError)return null;
    const bindingKey=parentLineBindingKey(),schoolId=me.schoolId;
    const schoolContext=sessionStorage.getItem("school_context_id")||"",roleContext=sessionStorage.getItem("role_context")||"";
    if(binding.key!==bindingKey||!/^[a-z0-9-]{2,60}$/.test(schoolId||"")||schoolContext&&schoolContext!==schoolId||roleContext&&roleContext!=="parent"||!["google","line"].includes(binding.authProvider))return null;
    const epoch=state.parentLineFriendPromptEpoch??0;
    const loginKey=JSON.stringify([epoch,bindingKey,me.authProvider||"",binding.authProvider,sessionStorage.getItem("google_id_token")||""]);
    return {loginKey,bindingKey,schoolId,authProvider:binding.authProvider,friendCheckedAt:binding.friendCheckedAt??null};
  }
  function sameSnapshot(a,b){return a&&b&&a.loginKey===b.loginKey&&a.bindingKey===b.bindingKey&&a.schoolId===b.schoolId&&a.authProvider===b.authProvider&&a.friendCheckedAt===b.friendCheckedAt}
  function current(entry,version){return active===entry&&entry.dialog.open&&entry.version===version&&generation===version&&sameSnapshot(entry.snapshot,snapshot())}
  function dismiss(entry){
    if(active!==entry)return;
    active=null;generation++;
    // Native close events are queued. Leave the closed node connected until
    // its close event so other modal queues can observe it in capture phase.
    if(entry.dialog.open)entry.dialog.close();else entry.dialog.remove();
  }
  function reset(){
    generation++;
    const entry=active;active=null;
    if(entry){if(entry.dialog.open)entry.dialog.close();else entry.dialog.remove()}
    // A same-identity profile refresh is not another login. Keep the record of
    // reminders already shown; a new epoch or verified identity has its own key.
  }
  function setBusy(entry,busy,text=""){
    entry.busy=busy;entry.primary.disabled=busy;
    entry.dialog.setAttribute("aria-busy",String(busy));
    entry.status.textContent=text;entry.status.hidden=!text;
    entry.status.className="parent-line-friend-status";
    entry.status.setAttribute("role","status");
  }
  async function confirmFriend(entry){
    if(active!==entry||entry.busy)return;
    if(!sameSnapshot(entry.snapshot,snapshot())||!entry.dialog.open){dismiss(entry);return}
    const version=entry.version=++generation;
    setBusy(entry,true,"正在開啟 LINE 好友確認…");
    try{
      const {schoolId,authProvider}=entry.snapshot;
      const result=await api("/api/line/tenant-login/"+encodeURIComponent(schoolId)+"/start",{method:"POST",body:JSON.stringify({mode:"friendship",...(authProvider==="google"?{returnTo:"parent-account"}:{})})});
      if(!current(entry,version)){dismiss(entry);return}
      const url=new URL(result?.url);
      if(url.origin!=="https://access.line.me"||url.pathname!=="/oauth2/v2.1/authorize"||url.username||url.password)throw Error("Invalid LINE authorization URL");
      if(!current(entry,version)){dismiss(entry);return}
      if(authProvider==="google"){
        sessionStorage.setItem("parent_line_account_return",schoolId);
        sessionStorage.removeItem("teacher_line_account_return");
      }
      if(!current(entry,version)){dismiss(entry);return}
      entry.navigating=true;entry.status.textContent="正在前往 LINE…";
      location.assign(url.href);
    }catch{
      if(current(entry,version)){
        entry.navigating=false;setBusy(entry,false,"目前無法開啟 LINE 好友確認，請稍後重試。原帳號與學生綁定會保留。");
        entry.status.className+=" error";entry.status.setAttribute("role","alert");
      }else dismiss(entry);
    }finally{
      if(current(entry,version)&&!entry.navigating)entry.primary.disabled=false;
    }
  }
  function buildPrompt(scope){
    const dialog=make("dialog");dialog.className="parent-line-friend-dialog";ownDialogs.add(dialog);
    dialog.setAttribute("aria-labelledby","parent-line-friend-title");dialog.setAttribute("aria-describedby","parent-line-friend-description");
    const mark=make("span","LINE 通知");mark.className="parent-line-friend-mark";
    const title=make("h2","加入本校官方帳號好友");title.id="parent-line-friend-title";
    const description=make("p","依上次確認結果，尚未確認您是本校官方帳號好友。加入好友或解除封鎖後，可接收課程與活動通知。");description.id="parent-line-friend-description";
    const note=make("p","您的 LINE 已綁定平台，學生資料不需重新綁定。您可以現在確認，也可以稍後再說。");note.className="parent-line-friend-note";
    const status=make("p");status.hidden=true;status.className="parent-line-friend-status";status.setAttribute("aria-live","polite");
    const actions=make("div");actions.className="parent-line-friend-actions";
    const primary=make("button","加入好友並確認");primary.type="button";primary.className="primary";
    const later=make("button","稍後再說");later.type="button";later.className="secondary";later.autofocus=true;
    const entry={snapshot:scope,dialog,primary,status,busy:false,navigating:false,version:++generation};
    primary.addEventListener("click",()=>confirmFriend(entry));later.addEventListener("click",()=>dismiss(entry));
    dialog.addEventListener("cancel",()=>dismiss(entry));dialog.addEventListener("close",()=>{
      if(active===entry){active=null;generation++}
      dialog.remove();
    });
    actions.append(primary,later);dialog.append(mark,title,description,note,status,actions);
    return entry;
  }
  function refresh(){
    const scope=snapshot();
    if(active&&!sameSnapshot(active.snapshot,scope))dismiss(active);
    const anotherDialog=[...document.querySelectorAll("dialog[open]")].some(node=>node!==active?.dialog);
    if(anotherDialog){if(active)dismiss(active);return}
    if(active||!scope||shown.has(scope.loginKey))return;
    const entry=buildPrompt(scope);
    if(typeof entry.dialog.showModal!=="function")return;
    document.body.append(entry.dialog);active=entry;
    try{
      entry.dialog.showModal();
      if(entry.dialog.open)shown.add(scope.loginKey);else dismiss(entry);
    }catch{dismiss(entry)}
  }
  function scheduleRefresh(){
    if(refreshQueued)return;
    refreshQueued=true;
    Promise.resolve().then(()=>{refreshQueued=false;refresh()});
  }
  const previousRender=render;
  render=function(...args){const output=previousRender.apply(this,args);refresh();return output};
  document.addEventListener("close",event=>{if(!ownDialogs.has(event.target))scheduleRefresh()},true);
  window.addEventListener("pageshow",scheduleRefresh);
  window.addEventListener("pagehide",reset);
  window.parentLineFriendPrompt={refresh,reset};
  scheduleRefresh();
})();
