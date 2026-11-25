const accountRoles=new Set(['admin','parent','unassigned','teacher','sectionTeacher','ensembleTeacher','comprehensiveTeacher','privateTeacher']);
const staffMenuRoles=new Set(['admin','teacher','sectionTeacher','ensembleTeacher','comprehensiveTeacher','privateTeacher']);
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
 let callbackError='',callbackLink='',callbackFriend='',menuStatus='';
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
 const canSyncMenu=()=>staffMenuRoles.has(me?.role);
 function button(text,action,secondary=false){const node=make('button',text);node.type='button';node.disabled=busy;node.className=secondary?'secondary':'';node.addEventListener('click',action);return node}
 const callbackMessage=()=>callbackError==='conflict'?'這個 Gmail 或 LINE 已有其他綁定，請聯絡學校管理員核對。':callbackError==='configuration'?'LINE 登入設定未通過驗證，請由學校管理員核對設定後重新授權。':callbackError==='authorization'?'LINE 授權已逾時或未完成，請重新授權。':callbackError?'LINE 授權未完成，請重新授權。':callbackFriend==='mismatch'?'此次使用的 LINE 與原綁定帳號不同，好友狀態未更新。請使用原綁定的 LINE 再確認；原帳號綁定不變。':callbackFriend==='unavailable'?'此次未能取得官方帳號好友狀態，請稍後按「重新確認好友」再試。原帳號綁定與家長核准資料不變。':callbackFriend==='checked'?(line?.friendStatus==='friend'?'已更新好友確認紀錄：您是本校官方帳號好友。':line?.friendStatus==='not_friend'?'已更新好友確認紀錄：目前未確認為本校官方帳號好友。請加入好友或解除封鎖後，再按「重新確認好友」。':'尚未取得可確認的好友結果，請稍後再試。'):callbackLink==='confirm'?(line?.pendingLink?'請核對 Gmail 與 LINE 名稱，再確認綁定。':line?.bound?'已讀取目前的 LINE 綁定狀態。':'綁定確認已逾時，請重新開始。'):'';
 async function changed(action){
  try{await onChanged({line,action})}catch{message+=' 頁面更新未完成，請重新讀取狀態確認。';failed=true}
 }
 async function run(action,body,question){
  if(busy||!valid()||!permitted()||question&&!confirm(question))return;
  if(action==='friendship'&&line?.bound!==true)return;
  busy=true;const version=++generation;message='正在處理…';menuStatus='';failed=false;render();
  try{
   if(action==='link'||action==='friendship'){
    callbackError='';callbackLink='';callbackFriend='';
    // A friendship check must return to the existing identity. Only a Gmail
    // session uses the dedicated Gmail role-return screens.
    const payload={mode:action==='friendship'?'friendship':'link',...((action==='link'||line.authProvider==='google')&&['notification-center','teacher-account','parent-account'].includes(returnTo)?{returnTo}:{})};
    const result=await api('/api/line/tenant-login/'+encodeURIComponent(me.schoolId)+'/start',{method:'POST',body:JSON.stringify(payload)});
    if(!valid()||version!==generation)return;
    const url=new URL(result.url);
    if(url.origin!=='https://access.line.me'||url.pathname!=='/oauth2/v2.1/authorize'||url.username||url.password)throw Error('LINE 授權網址不正確，請重新開啟此頁。');
    authorizationPending=true;navigate(url.href,{action,authProvider:line.authProvider});return;
   }
   const result=await api('/api/line/school-account',{method:action==='unbind'?'DELETE':'POST',...(body?{body:JSON.stringify(body)}:{})});
   if(!valid()||version!==generation)return;
   if(action==='google'){
    line=result;message='請核對 Gmail 與 LINE 名稱，再確認綁定。';return;
   }
   if(action==='sync'){
    message=result.audience==='parent'?'已同步已核准家長選單。':result.audience==='staff'?(result.chatActionsVerified?'LINE 已確認套用幹部六宮格，上排三格可在聊天室查詢。':'LINE 已確認套用幹部／老師六宮格。'):result.audience==='default'?'目前使用預設三宮格；學生資料須完成家長／學生核准後開放。':'目前無法同步 LINE 選單。';
   }else{
    line=await api('/api/line/school-account');if(!valid()||version!==generation)return;
    callbackError='';callbackLink='';callbackFriend='';
    message=action==='confirm'?'已完成此校 Gmail 與 LINE 綁定。':action==='cancel'?'已取消此次綁定。':'已解除此校 LINE 綁定。';
    if(action==='confirm'&&me.role==='parent')message+=' 已沿用原 Gmail 核准的學生關係，不需重新註冊學生。';
    if(action==='confirm'&&result.menuSync?.status==='synced')menuStatus=result.menuSync.audience==='parent'?(result.menuSync.areaCount===5?'已依核准家長身分自動啟用五格選單。':'已依核准家長身分自動套用家長選單。'):result.menuSync.audience==='staff'?'已依同校幹部與老師名冊自動套用六宮格。':'目前使用預設三宮格；學生資料須完成家長／學生核准後開放。';
    if(action==='confirm'&&result.menuSync?.status==='pending')menuStatus=canSyncMenu()?'帳號綁定已完成，選單尚未同步。'+(result.menuSync.message||'可按「同步我的 LINE 選單」重試。'):'帳號綁定已完成，家長選單由系統自動處理；若畫面尚未更新，請聯絡學校管理員確認設定。';
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
  if(line.bound){
   const friendship=make('div');friendship.className='notice';
   const result=line.friendStatus==='friend'?'已確認為好友':line.friendStatus==='not_friend'?'需確認好友狀態':'尚未取得確認結果';
   friendship.append(make('b','本校官方帳號好友：'+result));
   const checked=line.friendCheckedAt?new Date(line.friendCheckedAt):null;
   friendship.append(make('p',checked&&Number.isFinite(checked.getTime())?'最後確認時間：'+checked.toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}):'尚無好友確認時間。'));
   friendship.append(make('p','LINE 帳號綁定與平台身分核准是不同項目。按「重新確認好友」，以原綁定 LINE 查看本校官方帳號的好友狀態；既有帳號配對與學生資料會保留。'));
   host.append(friendship);
  }
  if(me.role==='parent'&&line.authProvider==='google')host.append(make('p','此 Gmail 已核准的學生關係會直接沿用，LINE 綁定不需再輸入學生姓名或學號。'));
  const actions=make('div');actions.className='actions';
  if(line.authProvider==='google'&&!line.bound)actions.append(button('使用 LINE 授權並綁定',()=>run('link')));
  host.append(make('p',canSyncMenu()?'選單依同校身分自動判定：尚未綁定平台為預設三宮格，已核准家長啟用 Facebook 後為五格，幹部／啟用中的老師為六宮格。學生資料僅依已核准關係開放；幹部需要時可手動更新選單。':'完成學生核准與 LINE 綁定後，系統會自動啟用家長選單，不需另外同步；啟用 Facebook 後為五格。學生資料僅依已核准關係開放。'));
  if(line.bound&&canSyncMenu())actions.append(button('同步我的 LINE 選單',()=>run('sync',{action:'sync-menu'}),true));
  if(line.bound)actions.append(button('重新確認好友',()=>run('friendship'),true));
  if(line.authProvider==='google'&&line.bound)actions.append(button('解除 LINE 綁定',()=>run('unbind',null,'確定解除此校 LINE 綁定？'),true));
  actions.append(button(canSyncMenu()?'更新綁定狀態':'查看綁定狀態',()=>load(),true));host.append(actions);
  if(line.authProvider==='line'&&!line.googleLinked){const google=make('div');host.append(google);if(!busy)renderGoogle(google,generation)}
 }
 async function load(params){
  if(busy||!valid())return line;
  if(params!==undefined){callbackError=params?.get('line_error')||'';callbackLink=params?.get('line_link')||'';const friend=params?.get('line_friend');callbackFriend=['checked','unavailable','mismatch'].includes(friend)?friend:''}
  const version=++generation;busy=true;message='正在讀取 LINE 綁定狀態…';menuStatus='';failed=false;render();
  try{
   line=permitted()?await api('/api/line/school-account'):{configured:false,bound:false};
   if(!valid()||version!==generation)return null;
   if(line?.pendingLink||line?.bound)authorizationPending=false;
   message=callbackMessage();failed=Boolean(callbackError)||['unavailable','mismatch'].includes(callbackFriend);
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
