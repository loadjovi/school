(()=>{
 const query=new URLSearchParams(location.search);
 const isFinance=query.get('workspace')==='finance'||query.get('task')==='finance';
 let resolveReady;
 const state=window.uniformFinanceWorkspace={isFinance,authorized:false,ready:new Promise(resolve=>{resolveReady=resolve})};
 document.documentElement.classList.add(isFinance?'finance-workspace':'uniform-operations-workspace');
 const tabs={finance:'待核帳與補退款',accounts:'匯款帳戶',prices:'團服價格','activity-fees':'活動收費',notifications:'財務通知'};
 state.select=key=>{
  if(!state.authorized)return;
  key=Object.hasOwn(tabs,key)?key:'finance';
  for(const panel of document.querySelectorAll('[data-finance-panel]'))panel.hidden=panel.dataset.financePanel!==key;
  for(const button of document.querySelectorAll('[data-finance-tab]'))button.setAttribute('aria-selected',String(button.dataset.financeTab===key));
 };
 state.activate=me=>{
  state.authorized=isFinance&&me.role==='admin'&&me.capabilities?.financeVerifier===true;
  const shell=document.getElementById('financeWorkspaceShell');if(shell)shell.hidden=!state.authorized;
  if(state.authorized)state.select(query.get('task'));
  return state.authorized;
 };
 document.addEventListener('DOMContentLoaded',()=>{
  if(!isFinance){resolveReady();return}
  document.title='財務核帳';
  const heading=document.querySelector('body>h1');if(heading){heading.textContent='財務核帳';if(heading.nextElementSibling)heading.nextElementSibling.textContent='核對匯款、處理補退款，管理收款設定與通知。'}
  const area=document.getElementById('protectedAdminArea'),shell=document.createElement('div');shell.id='financeWorkspaceShell';shell.hidden=true;
  area.prepend(shell);
  const nav=document.createElement('nav');nav.className='finance-tabs';nav.setAttribute('aria-label','財務工作');
  for(const [key,label] of Object.entries(tabs)){const b=document.createElement('button');b.type='button';b.dataset.financeTab=key;b.textContent=label;b.setAttribute('aria-selected','false');b.addEventListener('click',()=>state.select(key));nav.append(b)}
  const refresh=document.createElement("button");refresh.type="button";refresh.id="financeWorkspaceReload";refresh.textContent="更新資料";refresh.addEventListener("click",()=>{if(state.authorized)window.dispatchEvent(new Event("uniformFinanceReload"))});shell.append(refresh,nav);
  const review=document.getElementById('inlineFinanceReview');review.dataset.financePanel='finance';review.open=true;shell.append(review);
  const accounts=document.querySelector('[data-admin-view="accounts"]');accounts.removeAttribute('data-admin-view');accounts.dataset.financePanel='accounts';shell.append(accounts);
  const prices=document.getElementById('uniformFinanceSettings');prices.dataset.financePanel='prices';shell.append(prices);document.getElementById('uniformFinanceKindWrap').hidden=false;document.getElementById('uniformPriceSettings').open=true;
  document.getElementById('uniformFinanceKind').addEventListener('change',event=>{document.getElementById('uniformPriceForm').elements.kind.value=event.target.value;window.dispatchEvent(new Event('uniformPriceKindChanged'))});
  for(const [id,key] of [['financeActivitiesPanel','activity-fees'],['financeNotificationsPanel','notifications']]){const section=document.createElement('section');section.id=id;section.dataset.financePanel=key;section.hidden=true;shell.append(section)}
  resolveReady();
 });
})();
