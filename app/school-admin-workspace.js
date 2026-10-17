(()=>{
 if(window.__schoolAdminWorkspace)return;
 window.__schoolAdminWorkspace=true;
 const groups={home:['工作首頁','選擇要辦理的工作。'],attendance:['出勤處理','查看出勤、追蹤未到學生，或修正過去的分部課點名。'],accounts:['帳號與綁定','核准家長綁定、管理老師，或設定校方查詢帳號。'],records:['紀錄查詢','查詢誰在何時修改資料，以及校方帳號的使用情況。'],settings:['平台設定','調整通知、網站名稱、Logo 與分享文字。']};
 const rootGroups={schoolAccessAdmin:'accounts',parentBindingStats:'accounts',parentBindingCorrection:'accounts',adminAttendanceAssistRoot:'attendance',adminSchoolCorrection:'attendance',schoolAccessAudit:'records',schoolAdminActivity:'records',brandingAdminPanel:'settings'};
 const shortcuts=[
  ['attendance','📋','出勤處理','今日出勤、未到追蹤、歷史修正'],
  ['students','👥','學生主檔','新增、退團、團別與班級資料'],
  ['schoolSchedule','📅','課表與停課','學期課表匯入、改期與臨時停課'],
  ['uniformAdmin','🎽','團服與活動','團服申請、活動報名與財務核帳'],
  ['accounts','🔑','帳號與綁定','老師啟用、家長綁定、校方查詢'],
  ['scores','📊','學期考核','查看學生成績與評量'],
  ['specialCalendar','🗓️','行事曆與加練','加練、演出及特殊活動公告'],
  ['records','🧾','紀錄查詢','資料異動、登入與使用紀錄']
 ];
 const inScope=()=>typeof state!=='undefined'&&state.me?.role==='admin'&&state.page==='admin'&&!state.teacherAdminOpen;
 window.openSchoolAdminWorkspace=async function(group='home'){
  if(state.me?.role!=='admin')return;
  const alreadyWorkspace=inScope();
  state.adminWorkspaceSection=groups[group]?group:'home';state.teacherAdminOpen=false;
  if(alreadyWorkspace)organize();
  else if(state.page!=='admin'){await go('admin');state.adminWorkspaceSection=groups[group]?group:'home';render()}else render();
  requestAnimationFrame(()=>{organize();document.querySelector('#schoolAdminWorkspace')?.scrollIntoView({block:'start'})});
 };
 const setGroup=(node,group)=>{if(node.dataset.adminGroup!==group)node.dataset.adminGroup=group};
 function classify(main){
  for(const [id,group] of Object.entries(rootGroups)){const node=document.getElementById(id);if(node&&main.contains(node))setGroup(node,group)}
  const ops=document.getElementById('adminOperations');
  if(ops)for(const child of ops.children)setGroup(child,child.querySelector('h2')?.textContent.includes('通知設定')?'settings':'attendance');
  const content=main.querySelector('.desktop-content')||main;
  for(const node of [...new Set([...main.children,...content.children])]){
   if(node.id==='schoolAdminWorkspace'||node.id==='adminOperations'||node===content||node.dataset.adminGroup)continue;
   if(node.matches('.card.hero')){setGroup(node,'legacy');continue}
   const title=node.querySelector('h2')?.textContent||'';
   const text=node.textContent||'';
   if(node.matches('[data-uniform-event-admin-link]')||/課程管理|行事曆|老師帳號|自主練習月報/.test(title))setGroup(node,'legacy');
   else if(/待審核|沒有待審核/.test(text)||title.includes('家長'))setGroup(node,'accounts');
   else if(node.matches('.card,h2'))setGroup(node,'home');
  }
 }
 function organize(){
  if(!inScope())return;
  const main=document.querySelector('.main');if(!main)return;
  const group=groups[state.adminWorkspaceSection]?state.adminWorkspaceSection:'home';
  main.classList.add('school-admin-workspace');
  let root=document.getElementById('schoolAdminWorkspace');
  if(!root){
   root=document.createElement('section');root.id='schoolAdminWorkspace';root.className='admin-workspace-header';
   root.innerHTML=`<div class="aw-heading"><div><small>學校後台</small><h1></h1><p></p></div><button type="button" data-workspace-action="help">使用說明</button></div><nav aria-label="後台工作分類" class="aw-tabs">${Object.entries(groups).map(([key,[label]])=>`<button type="button" data-workspace-group="${key}">${label}</button>`).join('')}</nav><div class="aw-home"><div class="aw-stats" aria-label="目前資料摘要"><span>學生主檔 <b data-aw-students></b> 位</span><span>家長綁定待審 <b data-aw-pending></b> 筆</span></div><h2>今天要處理什麼？</h2><div class="aw-shortcuts">${shortcuts.map(([key,icon,title,desc])=>`<button type="button" data-workspace-action="${key}"><span class="aw-icon" aria-hidden="true">${icon}</span><span><b>${title}</b><small>${desc}</small></span><span aria-hidden="true">›</span></button>`).join('')}</div><div class="aw-tip">第一次使用：先確認學生名單與課表，再啟用帳號及公告活動。<button type="button" data-workspace-action="practiceProgress">自主練習月報 →</button><button type="button" data-workspace-group="settings">平台設定 →</button></div></div><div class="aw-account-links"><button type="button" data-workspace-action="teacherAdmin">管理老師帳號</button><button type="button" data-workspace-action="parentCorrection">修正家長綁定</button></div><div class="aw-attendance-links"><button type="button" data-workspace-action="attendanceTable">開啟出勤工作台</button></div>`;
   main.prepend(root);
  }
  if(main.firstElementChild!==root)main.prepend(root);
  const text=(selector,value)=>{const n=root.querySelector(selector);if(n.textContent!==String(value))n.textContent=String(value)};
  text('h1',groups[group][0]);text('.aw-heading p',groups[group][1]);
  text('[data-aw-students]',state.master?.length||0);text('[data-aw-pending]',state.registrations?.length||0);
  root.querySelector('.aw-home').hidden=group!=='home';root.querySelector('.aw-account-links').hidden=group!=='accounts';root.querySelector('.aw-attendance-links').hidden=group!=='attendance';
  for(const b of root.querySelectorAll('[data-workspace-group]')){const active=b.dataset.workspaceGroup===group;b.classList.toggle('is-active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')}
  classify(main);
  for(const node of main.querySelectorAll('[data-admin-group]'))node.hidden=node.dataset.adminGroup!==group;
  for(const b of document.querySelectorAll('.desktop-menu-item[data-desktop-action]')){
   const selected=b.dataset.desktopAction==='workspace:'+group;b.classList.toggle('is-active',selected);if(selected)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');
  }
 }
 document.addEventListener('click',async e=>{
  const button=e.target.closest?.('[data-workspace-group],[data-workspace-action]');if(!button)return;
  e.preventDefault();
  try{
   if(button.dataset.workspaceGroup)return await window.openSchoolAdminWorkspace(button.dataset.workspaceGroup);
   const key=button.dataset.workspaceAction;
   if(groups[key])return await window.openSchoolAdminWorkspace(key);
   if(key==='uniformAdmin'){location.href='/uniform-event-admin.html';return}
   if(key==='parentCorrection'){if(typeof window.openParentBindingCorrection==='function')window.openParentBindingCorrection();else document.querySelector('#parentBindingStats button')?.click();return}
   if(key==='attendanceTable')return await window.desktopNavigate('attendance');
   await window.desktopNavigate(key);
  }catch(error){toast('操作未完成：'+(error?.message||error))}
 });
 let queued=false;
 new MutationObserver(()=>{if(!queued){queued=true;requestAnimationFrame(()=>{queued=false;organize()})}}).observe(document.getElementById('app'),{childList:true,subtree:true});
 organize();
})();
