const modes=[['important_and_daily','重要即時＋每日摘要'],['instant_only','只有即時'],['daily_only','只有每日摘要'],['off','關閉待辦通知']];
const groups=[
 {key:'cadres',title:'幹部群組',purpose:'後台待辦通知',bound:'lineTargetBound',label:'lineTargetLabel',boundAt:'lineTargetBoundAt',testAt:'lineLastTestAt',code:'bindingCode',expires:'bindingCodeExpiresAt',create:'create_binding_code',test:'test',unbind:'unbind'},
 {key:'school',title:'學校群組',purpose:'學生缺席即時通知群組',bound:'lineAbsenceTargetBound',label:'lineAbsenceTargetLabel',boundAt:'lineAbsenceTargetBoundAt',testAt:'lineAbsenceLastTestAt',code:'absenceBindingCode',expires:'absenceBindingCodeExpiresAt',create:'create_absence_binding_code',test:'test_absence',unbind:'unbind_absence'}
];
const formatted=value=>value?new Date(value).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}):'';

// The caller starts this panel only after verifying the current school's administrator.
export function createLineNotificationSettings({host,api,onChanged=async()=>{},confirm=message=>window.confirm(message),now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}){
 let settings=null,active=false,destroyed=false,busy=false,generation=0,timer=null,scope='',feedback='',failed=false;
 const pending={};
 const currentScope=()=>['school_context_id','role_context','google_id_token'].map(key=>sessionStorage.getItem(key)||'').join('|');
 const valid=expected=>!destroyed&&active&&scope===expected&&currentScope()===expected;
 const make=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node};
 const button=(text,action,secondary=false)=>{const node=make('button',text);node.type='button';node.disabled=busy;node.className=secondary?'secondary':'';node.addEventListener('click',action);return node};
 const cancelPoll=()=>{if(timer!==null){clearTimer(timer);timer=null}};
 function trimPending(){
  for(const group of groups){const code=pending[group.key];if(!code)continue;if(settings?.[group.bound]&&code.boundBefore!==true||Number.isFinite(Date.parse(code.expiresAt))&&Date.parse(code.expiresAt)<=now())delete pending[group.key]}
 }
 function schedulePoll(){
  cancelPoll();trimPending();if(!active||destroyed||!Object.keys(pending).length)return;
  timer=setTimer(async()=>{timer=null;if(!active||destroyed)return;if(document.visibilityState!=='hidden'&&!host.hidden)await refresh(false);else schedulePoll()},10000);
 }
 function stampState(value){return JSON.stringify(groups.map(group=>[value?.[group.bound],value?.[group.label],value?.[group.boundAt]]))}
 async function refresh(showLoading=true){
  if(destroyed||!active||busy||!valid(scope))return;
  const expected=scope,version=++generation;
  if(showLoading){feedback='正在讀取群組與通知設定…';failed=false;render()}
  try{
   const result=await api('/api/line/settings');if(!valid(expected)||version!==generation)return;
   const changed=settings!==null&&stampState(settings)!==stampState(result);
   const old=settings;settings=result;trimPending();
   // A replacement keeps the old group active until the new binding completes.
   for(const group of groups)if(pending[group.key]&&old?.[group.boundAt]!==result[group.boundAt])delete pending[group.key];
   if(showLoading)feedback='已更新群組與通知設定。';failed=false;render();
   if(changed)await onChanged({settings,reason:'binding'});
  }catch(error){if(!valid(expected)||version!==generation)return;feedback='讀取失敗：'+error.message;failed=true;render()}
  finally{if(valid(expected))schedulePoll()}
 }
 async function mutate(method,body,{message,question}={}){
  if(busy||!valid(scope)||question&&!confirm(question))return;
  const expected=scope;generation++;busy=true;feedback='正在處理…';failed=false;render();cancelPoll();
  try{
   const result=await api('/api/line/settings',{method,body:JSON.stringify(body)});if(!valid(expected))return;
   const before=settings;settings=result;
   for(const group of groups){
    if(result[group.code]&&/^\d{6}$/.test(result[group.code]))pending[group.key]={code:result[group.code],expiresAt:result[group.expires],boundBefore:before?.[group.bound]===true};
    if(body.action===group.unbind)delete pending[group.key];
   }
   trimPending();feedback=message||'設定已更新。';
   try{await onChanged({settings,reason:body.action||'mode'})}catch{feedback='設定已儲存；通知對象更新未完成，請更新狀態後確認。';failed=true}
  }catch(error){if(!valid(expected))return;feedback='操作未確認：'+error.message+'。請更新狀態後再確認。';failed=true}
  finally{busy=false;if(valid(expected)){render();schedulePoll()}}
 }
 function renderGroup(group){
  const card=make('section');card.className='line-settings-group';card.dataset.lineSettingsGroup=group.key;
  card.append(make('h3',group.title));card.append(make('p',group.purpose));
  if(group.key==='school'){const rule=make('p','分部課、合奏課、綜合課與訓練／加練中，只有學生新標記為缺席時通知；請假、遲到與重複儲存不通知。');rule.className='muted';card.append(rule)}
  const bound=settings[group.bound]===true,status=make('p',bound?'已綁定：'+(settings[group.label]||group.title):'尚未綁定');status.className='notice';card.append(status);
  for(const [key,label] of [[group.boundAt,'綁定時間'],[group.testAt,'最近測試']])if(settings[key])card.append(make('small',label+'：'+formatted(settings[key])));
  const actions=make('div');actions.className='actions';
  if(settings.lineServiceConfigured===true){
   if(bound){
    actions.append(button('發送測試通知',()=>mutate('POST',{action:group.test},{question:'確認發送一則測試通知到「'+(settings[group.label]||group.title)+'」？',message:'LINE 已受理測試通知，請到群組確認收件。'})));
    actions.append(button('解除綁定',()=>mutate('POST',{action:group.unbind},{question:'確認解除「'+(settings[group.label]||group.title)+'」的'+group.purpose+'綁定？',message:'已解除此群組綁定。'}),true));
    const replacement=make('details');replacement.append(make('summary','更換通知群組'));
    replacement.append(button('產生新的群組綁定碼',()=>mutate('POST',{action:group.create},{question:'產生「'+group.title+'」的新綁定碼？原群組在完成新綁定前仍維持使用。',message:'已產生新綁定碼，請在要使用的群組輸入下方指令。'}),true));card.append(actions,replacement);
   }else{actions.append(button(pending[group.key]?'重新產生綁定碼':'產生群組綁定碼',()=>mutate('POST',{action:group.create},{message:'已產生綁定碼，請在「'+group.title+'」輸入下方指令。'})));card.append(actions)}
  }
  const code=pending[group.key];
  if(code){const box=make('div');box.className='notice';box.dataset.bindingPurpose=group.key;box.append(make('p','請先將本校 LINE 官方帳號加入群組，再在群組輸入：'));box.append(make('code','#綁定通知 '+code.code));box.append(make('p','有效至 '+formatted(code.expiresAt)+'（15 分鐘內完成）。完成後會自動更新狀態。'));card.append(box)}
  return card;
 }
 function render(){
  if(!active||destroyed)return;
  trimPending();host.replaceChildren();host.append(make('h2','群組與通知設定'));
  const controls=make('div');controls.className='actions';controls.append(button('更新狀態',()=>refresh()));host.append(controls);
  const status=make('p',feedback||'');status.setAttribute('role',failed?'alert':'status');status.setAttribute('aria-live','polite');host.append(status);
  if(!settings)return;
  if(!settings.lineServiceConfigured){const warning=make('p','此校 LINE 官方帳號尚未完成啟用，請由 Global 管理員確認設定。');warning.className='notice';host.append(warning)}
  const label=make('label','幹部待辦通知方式'),select=make('select');select.id='centerLineNotificationMode';select.disabled=busy;
  for(const [value,text] of modes){const option=make('option',text);option.value=value;select.append(option)}
  select.value=settings.lineNotificationMode||'important_and_daily';select.addEventListener('change',()=>mutate('PATCH',{lineNotificationMode:select.value},{message:'幹部待辦通知方式已更新。'}));label.append(select);host.append(label);
  const grid=make('div');grid.className='line-settings-groups';for(const group of groups)grid.append(renderGroup(group));host.append(grid);
  const advanced=make('details');advanced.className='line-settings-connection';advanced.append(make('summary','LINE 連線資訊'));
  advanced.append(make('p','Messaging API：'+(settings.lineServiceConfigured?'已連線':'尚未完成設定')));
  let webhook='';try{webhook=settings.webhookPath?new URL(settings.webhookPath,location.origin).href:String(settings.webhookUrl||'')}catch{}
  if(webhook){const text=make('p','Webhook：'+webhook);text.style.overflowWrap='anywhere';advanced.append(text)}
  advanced.append(make('p','LINE API 受理不代表實際收件；請確認本校官方帳號仍在群組內。'));host.append(advanced);
 }
 return {
  isBusy:()=>busy,
  async load(){
   if(destroyed)return;
   const next=currentScope();if(scope!==next){scope=next;settings=null;for(const key of Object.keys(pending))delete pending[key];generation++}
   active=true;await refresh();
  },
  setActive(value){active=value===true;if(!active){cancelPoll();generation++}else{trimPending();render();schedulePoll()}},
  destroy(){destroyed=true;active=false;generation++;cancelPoll();settings=null;for(const key of Object.keys(pending))delete pending[key];host.replaceChildren()}
 };
}
