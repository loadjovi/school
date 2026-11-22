const feeFields=[['studentFee','學生'],['firstAdultFee','首位陪同者'],['extraAdultFee','其他陪同者'],['extraChildFee','6 歲以下兒童（非團員）']];
const financialFields=['paymentMode','feeStatus','paymentOpen','collectionOpen',...feeFields.map(([key])=>key)];
const activityKey=item=>item.module+':'+item.id;
const financialVersion=item=>JSON.stringify(financialFields.map(key=>item[key]??(key.endsWith('Fee')?0:null)));
const bankFields=['bankName','bankCode','accountHolder','accountNumber'];
const validBank=item=>item&&item.bankName&&item.accountHolder&&/^\d{3}$/.test(item.bankCode||'')&&/^\d{6,30}$/.test(item.accountNumber||'');
const sameBank=(a,b)=>bankFields.every(key=>String(a?.[key]||'')===String(b?.[key]||''));
const bankPath=item=>'uniform-events/'+(item.module==='yearEndDinner'?'dinner-payment-account':'field-trip-payment-account');

export function financeActivityPayload(activity,fees,open){
 if(!activity||!['yearEndDinner','fieldTrip'].includes(activity.module)||!activity.id)throw Error('請先選擇已建立的付費活動。');
 const item={...activity};delete item.updatedAt;delete item.activityLineNotifications;
 for(const [key] of feeFields){const value=fees[key];if(!Number.isSafeInteger(value)||value<0)throw Error('費用須為 0 以上的整數。');item[key]=value}
 if(activity.module==='fieldTrip'&&open&&activity.enabled!==true)throw Error('請先由活動管理人員開放家長報名，再開放收款。');
 item.paymentMode=activity.module==='yearEndDinner'?'PAY_NOW':'PAY_LATER';
 item.paymentOpen=open===true;item.feeStatus=open?'PUBLISHED':'DRAFT';
 if(activity.module==='yearEndDinner')item.enabled=open===true;
 else item.collectionOpen=open===true;
 return item;
}

// Created only after the finance permission check. Nothing is read or written at import time.
export function createFinanceActivitySettings({host,api,onSaved=async()=>{}}){
 let items=[],templates=[],selected=null,boundAccount=null,loading=0,busy=false;
 let select,form,status,accountSelect,accountStatus,openSelect,save,inputs={};
 const make=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node};
 const label=(text,control)=>{const node=make('label',text);node.append(control);return node};
 const option=(text,value)=>{const node=make('option',text);node.value=value;return node};
 const find=key=>items.find(item=>activityKey(item)===key);
 const showAccount=()=>{
  const account=accountSelect.value==='__current__'?boundAccount:templates.find(item=>item.id===accountSelect.value);
  accountStatus.textContent=validBank(account)?'收款帳戶：'+account.bankName+'（'+account.bankCode+'）｜末四碼 '+String(account.accountNumber).slice(-4):'尚未設定。請先在「匯款帳戶」建立帳戶，再回來選擇。';
 };
 const fillAccounts=()=>{
  accountSelect.replaceChildren(option('請選擇收款帳戶',''));
  if(validBank(boundAccount))accountSelect.append(option('目前綁定｜'+boundAccount.bankName+'｜末四碼 '+String(boundAccount.accountNumber).slice(-4),'__current__'));
  for(const item of templates.filter(x=>x.active))accountSelect.append(option(item.label+'｜'+item.bankName+'｜末四碼 '+String(item.accountNumber).slice(-4),item.id));
  accountSelect.value=validBank(boundAccount)?'__current__':'';showAccount();
 };
 async function choose(){
  const version=++loading;selected=find(select.value)||null;boundAccount=null;
  form.hidden=!selected;save.disabled=true;status.textContent='';
  if(!selected)return;
  for(const [key] of feeFields)inputs[key].value=String(selected[key]??0);
  const dinner=selected.module==='yearEndDinner';
  openSelect.replaceChildren(option(dinner?'暫不開放報名與匯款':'暫不收款','false'),option(dinner?'開放報名與匯款':'開放已報名家庭匯款','true'));
  openSelect.value=String(dinner?selected.paymentOpen===true:selected.collectionOpen===true);
  accountStatus.textContent='正在讀取活動帳戶…';
  try{
   const data=await api(bankPath(selected)+'?activityId='+encodeURIComponent(selected.id));
   if(version!==loading)return;
   boundAccount=data.item||null;fillAccounts();save.disabled=false;
  }catch(error){if(version===loading){accountStatus.textContent='帳戶讀取失敗：'+error.message;status.textContent='請重新讀取後再儲存。'}}
 }
 function render(){
  host.replaceChildren();
  const heading=make('h2','活動收費設定');host.append(heading);
  const intro=make('p','選擇既有活動，設定費用、收款帳戶與開放收款。活動日期及報名期間請至「團服與活動」管理。');host.append(intro);
  if(!items.length){host.append(make('p','尚無付費活動，請先至「團服與活動」建立。'));return}
  select=make('select');select.id='financeActivitySelect';select.setAttribute('aria-label','選擇要設定收費的活動');
  for(const item of items)select.append(option((item.module==='yearEndDinner'?'餐會｜':'活動｜')+item.title,activityKey(item)));
  select.value=selected&&find(activityKey(selected))?activityKey(selected):activityKey(items[0]);
  host.append(label('選擇活動',select));
  form=make('form');form.id='financeActivityForm';inputs={};
  const grid=make('div');grid.className='activity-config-grid';
  for(const [key,title] of feeFields){const input=make('input');input.type='number';input.name=key;input.min='0';input.step='1';input.required=true;inputs[key]=input;grid.append(label(title+'費用（元）',input))}
  form.append(grid);accountSelect=make('select');accountSelect.id='financeActivityAccount';form.append(label('收款帳戶',accountSelect));
  accountStatus=make('p');accountStatus.setAttribute('role','status');form.append(accountStatus);
  openSelect=make('select');openSelect.name='paymentOpen';form.append(label('收款狀態',openSelect));
  save=make('button','儲存收費設定');save.type='submit';form.append(save);
  status=make('p');status.id='financeActivityStatus';status.setAttribute('role','status');status.setAttribute('aria-live','polite');form.append(status);host.append(form);
  select.addEventListener('change',choose);accountSelect.addEventListener('change',showAccount);
  form.addEventListener('submit',async event=>{
   event.preventDefault();if(busy||save.disabled||!selected)return;
   busy=true;save.disabled=true;select.disabled=true;status.textContent='正在核對費用與帳戶…';
   const original=selected;let submitted=false;
   try{
    const fees={};for(const [key] of feeFields){const raw=String(inputs[key].value).trim();fees[key]=raw===''?NaN:Number(raw)}
    const open=openSelect.value==='true';
    // Re-read before saving so operational metadata changes cannot be overwritten by this form.
    const latestData=await api('uniform-events/config'),latest=(latestData.items||[]).find(x=>activityKey(x)===activityKey(original));
    if(!latest)throw Error('活動已不存在，請重新讀取。');
    if(financialVersion(latest)!==financialVersion(original))throw Error('此活動收費設定已由其他人更新，請重新讀取後再處理。');
    const payload=financeActivityPayload(latest,fees,open);
    const account=accountSelect.value==='__current__'?boundAccount:templates.find(x=>x.active&&x.id===accountSelect.value);
    if(open&&!validBank(account))throw Error('請先選擇有效的收款帳戶，才能開放匯款。');
    const current=(await api(bankPath(original)+'?activityId='+encodeURIComponent(original.id))).item||null;
    if(!sameBank(current,boundAccount))throw Error('活動收款帳戶已變更，請重新讀取後再處理。');
    if(validBank(account)&&!sameBank(account,current)){
     const bank={activityId:original.id};for(const key of bankFields)bank[key]=account[key];
     await api(bankPath(original),{method:'POST',body:JSON.stringify(bank)});
    }
    if(validBank(account)){
     const check=await api(bankPath(original)+'?activityId='+encodeURIComponent(original.id));
     if(!validBank(check.item)||!sameBank(check.item,account))throw Error('收款帳戶讀回驗證失敗，尚未儲存收費設定。');
     boundAccount=check.item;
    }
    const result=await api('uniform-events/config',{method:'POST',body:JSON.stringify(payload)});submitted=true;
    const readback=await api('uniform-events/config'),persisted=(readback.items||[]).find(x=>activityKey(x)===activityKey(original));
    if(!persisted||financialVersion(persisted)!==financialVersion(payload)||persisted.enabled!==payload.enabled)throw Error('重新讀取尚未確認收費設定，請更新後檢查。');
    selected=persisted;items=(readback.items||[]).filter(x=>['yearEndDinner','fieldTrip'].includes(x.module));
    await onSaved({item:persisted,result});
    status.textContent=open?'已儲存，家長可依活動設定回報匯款。':'已儲存，目前暫不收款。';
   }catch(error){status.textContent=(submitted?'設定已送出，請重新讀取確認：':'儲存未完成：')+error.message}
   finally{busy=false;select.disabled=false;save.disabled=false}
  });
  return choose();
 }
 async function load(existing){
  if(busy)return;
  const previous=selected&&activityKey(selected);
  host.replaceChildren(make('p','正在讀取活動收費設定…'));
  try{
   const [config,accounts]=await Promise.all([Array.isArray(existing)?Promise.resolve({items:existing}):api('uniform-events/config'),api('uniform-events/payment-account-templates')]);
   items=(config.items||[]).filter(x=>['yearEndDinner','fieldTrip'].includes(x.module));templates=accounts.items||[];
   selected=previous?find(previous)||null:null;await render();
  }catch(error){host.replaceChildren(make('p','活動收費設定讀取失敗：'+error.message));throw error}
 }
 return {load,render:load};
}
