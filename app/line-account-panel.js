const accountRoles=new Set(['admin','parent','unassigned','teacher','sectionTeacher','ensembleTeacher','comprehensiveTeacher','privateTeacher']);
let googleScript;
async function googleClient(){
 if(window.google?.accounts?.id)return window.google.accounts.id;
 googleScript??=new Promise((resolve,reject)=>{
  const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';
  script.onload=()=>window.google?.accounts?.id?resolve(window.google.accounts.id):reject(Error('Gmail 登入元件未能啟動'));
  script.onerror=()=>{googleScript=null;reject(Error('Gmail 登入元件載入失敗'))};document.head.append(script);
 });
 return googleScript;
}

// Reused by the standalone account page and the notification center. Entry is read-only.
export function createLineAccountPanel({host,api,me,returnTo='account',navigate=url=>location.assign(url),onChanged=async()=>{},confirm=message=>window.confirm(message)}){
 let line=null,busy=false,destroyed=false,generation=0,message='',failed=false,authorizationPending=false;
 let callbackError='',callbackLink='',menuStatus='';
 const scope=()=>[me?.schoolId||'',...['school_context_id','role_context','google_id_token'].map(key=>sessionStorage.getItem(key)||'')].join('|');
 const originalScope=scope();
 const sameIdentity=()=>scope()===originalScope&&(!sessionStorage.getItem('school_context_id')||sessionStorage.getItem('school_context_id')===me?.schoolId);
 const make=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);return node};
 function valid(){
  if(destroyed)return false;
  if(sameIdentity())return true;
  generation++;line=null;host.replaceChildren(make('p','學校或登入身分已變更，請重新開啟我的 LINE 綁定。'));return false;
 }
 const permitted=()=>accountRoles.has(me?.role)&&me?.capabilities?.lineAccount===true;
 function button(text,action,secondary=false){const node=make('button',text);node.type='button';node.disabled=busy;node.className=secondary?'secondary':'';node.addEventListener('click',action);return node}
 const callbackMessage=()=>callbackError==='conflict'?'這個 Gmail 或 LINE 已有其他綁定，請聯絡學校管理員核對。':callbackError==='configuration'?'LINE 登入設定未通過驗證，請由學校管理員核對設定後重新授權。':callbackError==='authorization'?'LINE 授權已逾時或未完成，請重新授權。':callbackError?'LINE 授權未完成，請重新授權。':callbackLink==='confirm'?(line?.pendingLink?'請核對 Gmail 與 LINE 名稱，再確認綁定。':line?.bound?'已讀取目前的 LINE 綁定狀態。':'綁定確認已逾時，請重新開始。'):'';
 async function changed(action){
  try{await onChanged({line,action})}catch{message+=' 頁面更新未完成，請重新讀取狀態確認。';failed=true}
 }
 async function run(action,body,question){
  if(busy||!valid()||!permitted()||question&&!confirm(question))return;
  busy=true;const version=++generation;message='正在處理…';menuStatus='';failed=false;render();
  try{
   if(action==='link'){
    callbackError='';callbackLink='';
    const payload={mode:'link',...(returnTo==='notification-center'?{returnTo:'notification-center'}:{})};
    const result=await api('/api/line/tenant-login/'+encodeURIComponent(me.schoolId)+'/start',{method:'POST',body:JSON.stringify(payload)});
    if(!valid()||version!==generation)return;
    const url=new URL(result.url);
    if(url.origin!=='https://access.line.me'||url.pathname!=='/oauth2/v2.1/authorize')throw Error('LINE 授權網址不正確，請重新開啟此頁。');
    authorizationPending=true;navigate(url.href);return;
   }
   const result=await api('/api/line/school-account',{method:action==='unbind'?'DELETE':'POST',...(body?{body:JSON.stringify(body)}:{})});
   if(!valid()||version!==generation)return;
   if(action==='google'){
    line=result;message='請核對 Gmail 與 LINE 名稱，再確認綁定。';return;
   }
   if(action==='sync'){
    message=result.audience==='parent'?'已同步已核准家長的登入四宮格。':result.audience==='staff'?(result.chatActionsVerified?'LINE 已確認套用幹部六宮格。上排三格在聊天室回覆，下排三格開啟後台。':'LINE 已確認套用幹部／老師六宮格。'):result.audience==='default'?'目前使用預設三宮格；學生資料須完成家長／學生核准後開放。':'目前無法同步 LINE 選單。';
   }else{
    line=await api('/api/line/school-account');if(!valid()||version!==generation)return;
    callbackError='';callbackLink='';
    message=action==='confirm'?'已完成此校 Gmail 與 LINE 綁定。':action==='cancel'?'已取消此次綁定。':'已解除此校 LINE 綁定。';
    if(action==='confirm'&&result.menuSync?.status==='synced')menuStatus=result.menuSync.audience==='parent'?'已依核准家長身分自動套用登入四宮格。':result.menuSync.audience==='staff'?'已依同校幹部與老師名冊自動套用六宮格。':'目前使用預設三宮格；學生資料須完成家長／學生核准後開放。';
    if(action==='confirm'&&result.menuSync?.status==='pending')menuStatus='帳號綁定已完成，選單尚未同步。'+(result.menuSync.message||'可按「同步我的 LINE 選單」重試。');
   }
   await changed(action);
  }catch(error){
   if(valid()&&version===generation){
    if(['confirm','cancel'].includes(action)){try{const refreshed=await api('/api/line/school-account');if(valid()&&version===generation)line=refreshed}catch{}}
    if(valid()&&version===generation){message='操作未完成：'+error.message;failed=true}
   }
  }
  finally{busy=false;if(valid()&&version===generation)render()}
 }
 async function renderGoogle(node,version){
  if(/\bLine\//i.test(navigator.userAgent)){node.textContent='如需連結 Gmail，請在 Safari 或 Chrome 以 LINE 登入後操作。';return}
  try{
   const {googleClientId}=await api('/api/config');if(!googleClientId)throw Error('此環境尚未設定 Gmail 連結');
   const client=await googleClient();if(!valid()||version!==generation||!node.isConnected)return;
   client.initialize({client_id:googleClientId,callback:response=>{
    if(!valid()||version!==generation||!node.isConnected||!response?.credential)return;
    run('google',{credential:response.credential});
   }});
   client.renderButton(node,{theme:'outline',size:'large',text:'continue_with',locale:'zh_TW'});
  }catch(error){if(valid()&&version===generation&&node.isConnected)node.textContent=error.message}
 }
 function render(){
  if(!valid())return;
  host.replaceChildren();host.append(make('h2','我的 LINE 綁定'));
  const status=make('p',message);status.className='notice'+(failed?' error':'');status.setAttribute('role',failed?'alert':'status');status.setAttribute('aria-live','polite');status.hidden=!message;host.append(status);
  if(menuStatus){const menu=make('p',menuStatus);menu.className='notice';menu.setAttribute('role','status');host.append(menu)}
  if(!accountRoles.has(me?.role)){host.append(make('p','請切換至此校已授權的身分。'));return}
  if(!permitted()||line?.configured===false){host.append(make('p','此校尚未開啟 LINE 通知綁定，請聯絡學校管理員。'));return}
  if(!line){host.append(button('重新讀取綁定狀態',()=>load(),true));return;}
  if(line.pendingLink){
   const pending=line.pendingLink,list=make('dl');host.append(make('p','請確認 Gmail 與 LINE 都是您自己的帳號。'));
   list.append(make('dt','Gmail'),make('dd',pending.googleEmail||''),make('dt','LINE 名稱'),make('dd',pending.lineDisplayName||'未提供名稱'));host.append(list);
   const actions=make('div');actions.className='actions';
   actions.append(button('確認綁定',()=>run('confirm',{action:'confirm-link',confirmationId:pending.confirmationId})),button('取消',()=>run('cancel',{action:'cancel-link',confirmationId:pending.confirmationId}),true));host.append(actions);return;
  }
  host.append(make('p',(line.bound?'已連結 '+(line.lineDisplayName||'LINE'):'連結自己的 LINE，方便登入與接收通知。')+(line.googleLinked?' · 已連結 Gmail':'')));
  const actions=make('div');actions.className='actions';
  if(line.authProvider==='google'&&!line.bound)actions.append(button('使用 LINE 授權並綁定',()=>run('link')));
  host.append(make('p','選單依同校身分自動判定：尚未綁定平台為預設三宮格，已登入且學生關係已核准的家長為四宮格，幹部／啟用中的老師為六宮格。學生資料僅依已核准關係開放；需要時可重試同步。'));
  if(line.bound)actions.append(button('同步我的 LINE 選單',()=>run('sync',{action:'sync-menu'}),true));
  if(line.authProvider==='google'&&line.bound)actions.append(button('解除 LINE 綁定',()=>run('unbind',null,'確定解除此校 LINE 綁定？'),true));
  actions.append(button('更新綁定狀態',()=>load(),true));host.append(actions);
  if(line.authProvider==='line'&&!line.googleLinked){const google=make('div');host.append(google);if(!busy)renderGoogle(google,generation)}
 }
 async function load(params){
  if(busy||!valid())return line;
  if(params!==undefined){callbackError=params?.get('line_error')||'';callbackLink=params?.get('line_link')||''}
  const version=++generation;busy=true;message='正在讀取 LINE 綁定狀態…';menuStatus='';failed=false;render();
  try{
   line=permitted()?await api('/api/line/school-account'):{configured:false,bound:false};
   if(!valid()||version!==generation)return null;
   if(line?.pendingLink||line?.bound)authorizationPending=false;
   message=callbackMessage();failed=Boolean(callbackError);
  }catch(error){if(valid()&&version===generation){line=null;message=error.message;failed=true}}
  finally{busy=false;if(valid()&&version===generation)render()}
  return line;
 }
 // Some browsers resume the original page after returning from an external app
 // instead of navigating a new document. Re-read only after this panel initiated
 // authorization; entry and refresh remain read-only and never confirm a pair.
 const resumeAuthorization=()=>{if(authorizationPending&&!busy&&!host.hidden&&document.visibilityState!=='hidden'&&valid())void load()};
 window.addEventListener?.('focus',resumeAuthorization);
 document.addEventListener?.('visibilitychange',resumeAuthorization);
 return {load,isBusy:()=>busy,destroy(){destroyed=true;generation++;line=null;authorizationPending=false;window.removeEventListener?.('focus',resumeAuthorization);document.removeEventListener?.('visibilitychange',resumeAuthorization);host.replaceChildren()}};
}
