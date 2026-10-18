(()=>{
 if(window.__schoolAdminWorkspace)return;
 window.__schoolAdminWorkspace=true;
 const groups={home:['工作首頁','先查看待辦，或選擇要辦理的工作。'],tasks:['待辦事項','點選一項待辦，直接進入處理畫面。'],more:['更多','操作紀錄、平台設定與使用說明。'],attendance:['出勤與請假','查看今日出勤、追蹤缺席，或修正過去的點名。'],accounts:['帳號管理','啟用老師、核准家長綁定，或設定校方查詢帳號。'],courses:['課表與行事曆','依工作選擇課表、停課，或加練與活動公告。'],uniformAdmin:['團服與活動','管理團服申請、領用、活動報名與收款。'],learning:['學習與成績','查看自主練習紀錄或學期考核。'],assessment:['學期考核','查看期末考核與學期成績的計算項目。'],records:['操作紀錄','查詢資料異動及校方帳號使用紀錄。'],settings:['平台設定','調整通知、網站名稱與外觀。']};
 const rootGroups={schoolAccessAdmin:'accounts',teacherAdmin:'accounts',parentBindingStats:'accounts',parentBindingCorrection:'accounts',adminAttendanceAssistRoot:'attendance',adminSchoolCorrection:'attendance',schoolAccessAudit:'records',schoolAdminActivity:'records',brandingAdminPanel:'settings'};
 const shortcuts=[['attendance','出勤與請假','今日出勤、缺席追蹤、點名修正'],['students','學生管理','新增學生、調整團別、辦理退團'],['courses','課表與行事曆','課表匯入、停課、加練與公告'],['uniformAdmin','團服與活動','團服申請、活動報名、收款與領取'],['accounts','帳號管理','老師啟用、家長綁定、校方查詢'],['learning','學習與成績','自主練習月報、學期考核']];
 const guideTasks={parents:['核准家長帳號','accounts','① 找到待審申請 → ② 核對學生 → ③ 核准綁定'],students:['新增或調整學生','students','① 找到學生或新增資料 → ② 填寫異動內容 → ③ 儲存並核對'],cancel:['設定停課','schoolSchedule','① 選課程並按停課 → ② 選停課日期 → ③ 填寫原因並確認'],uniform:['處理團服申請','uniformAdmin','① 選團 T 或比賽服 → ② 進入家長申請 → ③ 依付款與領取進度處理'],event:['建立活動','activitySettings','① 選活動類型 → ② 填日期、團別與費用 → ③ 核對帳戶及家長顯示設定']};
 const scopeKey=()=>{let school=state.me?.schoolId||'';try{school=school||sessionStorage.getItem('school_context_id')||''}catch{}return String(state.me?.email||'')+'|'+String(school)};
 const guideKey=()=> 'school-admin-guide:'+scopeKey();
 let summary={key:'',loading:false,loadedAt:0,uniform:null,family:null,error:false};
 function guideDismissed(){try{return localStorage.getItem(guideKey())==='done'}catch{return false}}
 async function loadTasks(force=false){
  if(state.me?.role!=='admin'||summary.loading)return;
  const key=scopeKey();if(!force&&summary.key===key&&Date.now()-summary.loadedAt<60000)return;
  summary={key,loading:true,loadedAt:0,uniform:null,family:null,error:false};organize();
  const results=await Promise.allSettled([api('/api/uniform-events/requests'),...(state.me?.capabilities?.financeVerifier===true?[api('/api/uniform-events/family-registration')]:[])]);
  if(state.me?.role!=='admin'||scopeKey()!==key){summary.loading=false;return}
  summary.uniform=results[0].status==='fulfilled'?(results[0].value.items||[]):null;
  summary.family=results[1]?.status==='fulfilled'?(results[1].value.items||[]):null;
  summary.error=results.some(x=>x.status==='rejected');summary.loading=false;summary.loadedAt=Date.now();organize();
 }
 function todoHtml(){
  const rows=[],pending=state.registrations?.length||0;
  if(pending)rows.push(['parents','家長綁定待審',pending]);
  for(const [kind,label,key] of [['regularUniform','團 T 申請待審','tshirt'],['competitionUniform','比賽服申請待審','competition']]){
   const count=summary.uniform?.filter(x=>x.kind===kind&&x.status==='PENDING').length||0;if(count)rows.push([key,label,count]);
  }
  if(state.me?.capabilities?.financeVerifier===true&&summary.uniform!==null&&summary.family!==null){
   const count=(summary.uniform?.filter(x=>!['CANCELLED','FULFILLED'].includes(x.status)&&x.paymentStatus==='REPORTED_UNVERIFIED').length||0)+(summary.family?.filter(x=>x.registrationStatus==='REGISTERED'&&x.paymentStatus==='REPORTED_UNVERIFIED').length||0);
   if(count)rows.push(['finance','匯款待核帳',count]);
  }
  return rows.map(([key,label,count])=>`<button type="button" class="aw-todo" data-admin-todo="${key}"><span>${label}</span><b>${count} 筆</b><span aria-hidden="true">›</span></button>`).join('')+(summary.loading?'<p role="status">正在讀取待辦…</p>':summary.error?'<p class="notice" role="status">部分待辦讀取失敗，請重新讀取；尚未確認的項目不列為 0 筆。</p>':summary.loadedAt&&!rows.length?'<p class="notice">目前沒有待審申請或待核帳款項。</p>':'');
 }
 function mountGuide(main){
  const key=state.adminGuideTask,candidate=guideTasks[key],expected={parents:'admin',students:'students',cancel:'schoolSchedule'}[key],task=candidate&&state.page===expected&&(key!=='parents'||state.adminWorkspaceSection==='accounts')?candidate:null;let panel=document.getElementById('adminTaskGuide');
  if(!task){panel?.remove();return}
  if(!panel){panel=document.createElement('aside');panel.id='adminTaskGuide';panel.className='aw-task-guide';main.prepend(panel)}
  const html=`<div><b>${task[0]}</b><p>${task[2]}</p></div><button type="button" data-admin-guide-close>關閉提示</button>`;if(panel.innerHTML!==html)panel.innerHTML=html;
 }
 const previousNav=nav;
 nav=function(){if(state.me?.role!=='admin')return previousNav();const current=state.page==='admin'?(state.adminWorkspaceSection||'home'):'';return `<nav class="nav aw-bottom" aria-label="手機後台導覽">${[['home','工作首頁'],['tasks','待辦事項'],['more','更多']].map(([key,label])=>`<button type="button" data-workspace-group="${key}" ${current===key?'aria-current="page"':''}>${label}</button>`).join('')}</nav>`};
 const inScope=()=>typeof state!=='undefined'&&state.me?.role==='admin'&&state.page==='admin'&&!state.teacherAdminOpen;
 window.openSchoolAdminWorkspace=async function(group='home'){
  if(state.me?.role!=='admin')return;
  const alreadyWorkspace=inScope();
  state.adminWorkspaceSection=groups[group]?group:'home';state.teacherAdminOpen=false;
  if(alreadyWorkspace)organize();
  else if(state.page!=='admin'){await go('admin');state.adminWorkspaceSection=groups[group]?group:'home';render()}else render();
  requestAnimationFrame(()=>{organize();window.scrollTo(0,0)});
 };
 const setGroup=(node,group)=>{if(node.dataset.adminGroup!==group)node.dataset.adminGroup=group};
 function classify(main){
  for(const [id,group] of Object.entries(rootGroups)){const node=document.getElementById(id);if(node&&main.contains(node))setGroup(node,group)}
  const ops=document.getElementById('adminOperations');
  if(ops)for(const child of ops.children)setGroup(child,child.querySelector('h2')?.textContent.includes('通知設定')?'settings':'attendance');
  const content=main.querySelector('.desktop-content')||main;
  for(const node of [...new Set([...main.children,...content.children])]){
   if(node.id==='adminTaskGuide'||node.id==='schoolAdminWorkspace'||node.id==='adminOperations'||node===content||node.dataset.adminGroup)continue;
   if(node.matches('.card.hero')){setGroup(node,'legacy');continue}
   const title=node.querySelector('h2')?.textContent||'';
   const text=node.textContent||'';
   if(node.matches('[data-uniform-event-admin-link]')||/課程管理|行事曆|自主練習月報/.test(title))setGroup(node,'legacy');
   else if(/待審核|沒有待審核/.test(text)||title.includes('家長'))setGroup(node,'accounts');
   else if(node.matches('.card,h2'))setGroup(node,'home');
  }
 }
 function adaptTables(){
  if(typeof state==='undefined'||state.me?.role!=='admin')return;
  for(const table of document.querySelectorAll('.desktop-shell[data-role="admin"] .main table')){
   if(table.closest('.aw-table-scroll'))continue;
   const wrap=document.createElement('div');wrap.className='aw-table-scroll';
   wrap.setAttribute('role','region');wrap.setAttribute('aria-label','資料表格，可左右滑動');wrap.tabIndex=0;
   const columns=table.querySelector('tr')?.children.length||0;
   if(columns>=6){wrap.dataset.wide='true';const hint=document.createElement('small');hint.className='aw-table-hint';hint.textContent='左右滑動查看完整表格';wrap.append(hint)}
   table.before(wrap);wrap.append(table);
  }
 }
 function organize(){
  adaptTables();
  if(state.me?.role==='admin'){const host=document.querySelector('.main');if(host)mountGuide(host)}
  if(!inScope())return;
  const main=document.querySelector('.main');if(!main)return;
  const group=groups[state.adminWorkspaceSection]?state.adminWorkspaceSection:'home';
  main.classList.add('school-admin-workspace');
  let root=document.getElementById('schoolAdminWorkspace');
  if(!root){
   root=document.createElement('section');root.id='schoolAdminWorkspace';root.className='admin-workspace-header';
   root.innerHTML=`<div class="aw-heading"><div><small>學校後台</small><h1></h1><p></p></div></div>
   <div class="aw-home"><details class="aw-onboarding" ${guideDismissed()?'':'open'}><summary>第一次使用？從這裡開始</summary><p>選一項工作，跟著畫面上方的步驟操作。</p><div class="aw-guide-choices">${Object.entries(guideTasks).map(([key,[label]])=>`<button type="button" data-admin-guide="${key}">${label} ›</button>`).join('')}</div><button type="button" data-admin-guide-skip>暫時略過</button></details><h2>選擇工作</h2><div class="aw-shortcuts">${shortcuts.map(([key,title,desc])=>`<button type="button" data-workspace-action="${key}"><span><b>${title}</b><small>${desc}</small></span><span aria-hidden="true">›</span></button>`).join('')}</div></div>
   <section class="aw-todos" aria-label="目前待辦"><div class="section-title"><h2>待辦事項</h2><button type="button" data-admin-todo-reload>重新讀取</button></div><div data-todo-body></div></section>
   <div class="aw-more"><div class="aw-choice-list"><button type="button" data-workspace-group="records">操作紀錄 ›</button><button type="button" data-workspace-group="settings">平台設定 ›</button><button type="button" data-workspace-action="help">使用說明 ›</button><button type="button" data-admin-guide-reopen>重新查看入門引導 ›</button><button type="button" data-admin-logout>登出</button></div></div>
   <div class="aw-courses aw-choice-list"><button type="button" data-workspace-action="schoolSchedule"><b>課表與停課</b><small>學期課表匯入、指定日期課程、臨時停課</small></button><button type="button" data-workspace-action="specialCalendar"><b>行事曆與加練</b><small>加練點名、演出及特殊活動公告</small></button></div>
   <section class="aw-uniform" hidden><div class="aw-uniform-frame-wrap"><iframe id="awUniformFrame" title="團服與活動管理" loading="lazy" src="about:blank"></iframe></div></section><div class="aw-learning aw-choice-list"><button type="button" data-workspace-action="practiceProgress">自主練習月報 ›</button><button type="button" data-workspace-group="assessment">學期考核 ›</button></div>
   <section class="aw-assessment" hidden><div class="card"><h2>學期考核項目</h2><p class="notice">期末成績包含期末考核與平時學習紀錄，依學校確認的考核標準統計。此頁提供項目說明，不會變更學生分數。</p><div class="aw-assessment-metrics"><div><b>80%</b><small>期末考核</small></div><div><b>10%</b><small>自主練習</small></div><div><b>5%</b><small>出勤紀錄</small></div><div><b>5%</b><small>個別課／學習表現</small></div></div><p class="notice">自主練習統計請由「學習與成績 → 自主練習月報」查看，避免重複入口。</p></div></section><div class="aw-account-panels"><div class="aw-account-school"></div><section id="awTeacherAccountCard" class="card" data-admin-group="accounts"><h2>👩‍🏫 藝享老師帳號</h2><div class="notice" id="awTeacherCount"></div><button type="button" class="secondary" data-open-teacher-admin>管理老師 →</button></section><div id="awTeacherAccountDetails" class="aw-teacher-details" hidden></div><div class="aw-account-family"></div></div><div class="aw-account-pending"></div><div class="aw-account-links"><button type="button" data-workspace-action="parentCorrection">修正家長綁定</button></div><div class="aw-attendance-links"><button type="button" data-workspace-action="attendanceTable">開啟出勤工作台</button></div>`;
   main.prepend(root);root.querySelector('.aw-heading').after(root.querySelector('.aw-todos'));
  }
  const guide=document.getElementById('adminTaskGuide');if(guide){if(guide.nextElementSibling!==root)guide.after(root)}else if(main.firstElementChild!==root)main.prepend(root);
  const text=(selector,value)=>{const n=root.querySelector(selector);if(n.textContent!==String(value))n.textContent=String(value)};
  text('h1',groups[group][0]);text('.aw-heading p',groups[group][1]);
  for(const [selector,visible] of [['.aw-todos',['home','tasks'].includes(group)],['.aw-more',group==='more'],['.aw-courses',group==='courses'],['.aw-learning',group==='learning'],['.aw-uniform',group==='uniformAdmin'],['.aw-assessment',group==='assessment']])root.querySelector(selector).hidden=!visible;
  const todos=todoHtml(),body=root.querySelector('[data-todo-body]');if(body.innerHTML!==todos)body.innerHTML=todos;
  if(['home','tasks'].includes(group)&&!summary.loading&&(summary.key!==scopeKey()||!summary.loadedAt))setTimeout(()=>loadTasks(),0);
  root.querySelector('.aw-account-pending').hidden=group!=='accounts';
  for(const card of main.querySelectorAll('.desktop-content > .card'))if(card.querySelector('h2')?.textContent.includes('待審核'))root.querySelector('.aw-account-pending').append(card);
  const uniformFrame=root.querySelector('#awUniformFrame');if(group==='uniformAdmin'&&uniformFrame&&uniformFrame.getAttribute('src')==='about:blank')uniformFrame.src='/uniform-event-admin.html?embedded=school';
  root.querySelector('.aw-home').hidden=group!=='home';root.querySelector('.aw-account-links').hidden=group!=='accounts';root.querySelector('.aw-attendance-links').hidden=group!=='attendance';
  for(const b of document.querySelectorAll('.aw-bottom [data-workspace-group]')){const active=b.dataset.workspaceGroup===group;b.classList.toggle('is-active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')}
  // Keep all account management cards together in a stable, explicit order.
  const accountPanels=root.querySelector('.aw-account-panels');
  const schoolCard=main.querySelector('#schoolAccessAdmin');
  const familyCard=main.querySelector('#parentBindingStats');
  const schoolSlot=accountPanels.querySelector('.aw-account-school');
  const familySlot=accountPanels.querySelector('.aw-account-family');
  if(schoolCard&&schoolCard.parentElement!==schoolSlot)schoolSlot.append(schoolCard);
  if(familyCard&&familyCard.parentElement!==familySlot)familySlot.append(familyCard);
  const teacherCount=root.querySelector('#awTeacherCount');
  const teachers=Array.isArray(state.teachers)?state.teachers:[];
  const active=teachers.filter(t=>t.status!=='inactive').length;
  const countLabel='啟用 '+active+' 人　停用 '+(teachers.length-active)+' 人';
  if(teacherCount.textContent!==countLabel)teacherCount.textContent=countLabel;
  accountPanels.hidden=group!=='accounts';
  const teacherDetails=root.querySelector('#awTeacherAccountDetails');
  const teacherSummary=root.querySelector('#awTeacherAccountCard');
  const inlineOpen=group==='accounts'&&state.teacherAdminInlineOpen===true;
  teacherSummary.hidden=inlineOpen;
  teacherDetails.hidden=!inlineOpen;
  if(inlineOpen&&typeof window.teacherAdminManagementHtml==='function'){
   const html=window.teacherAdminManagementHtml();
   if(teacherDetails._lastMarkup!==html){teacherDetails.innerHTML=html;teacherDetails._lastMarkup=html;}
  }
  classify(main);
  for(const node of main.querySelectorAll('[data-admin-group]'))node.hidden=node.dataset.adminGroup!==group;
  for(const b of document.querySelectorAll('.desktop-menu-item[data-desktop-action]')){
   const selected=b.dataset.desktopAction==='workspace:'+group;b.classList.toggle('is-active',selected);if(selected)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');
  }
 }
 document.addEventListener('click',async e=>{
  const b=e.target.closest?.('[data-admin-todo],[data-admin-todo-reload],[data-admin-guide],[data-admin-guide-skip],[data-admin-guide-reopen],[data-admin-guide-close],[data-admin-logout]');if(!b)return;e.preventDefault();
  try{
   if(b.hasAttribute('data-admin-logout')){logout();return}
   if(b.hasAttribute('data-admin-guide-close')){state.adminGuideTask='';organize();return}
   if(b.hasAttribute('data-admin-guide-skip')){try{localStorage.setItem(guideKey(),'done')}catch{}const d=document.querySelector('.aw-onboarding');if(d)d.open=false;return}
   if(b.hasAttribute('data-admin-guide-reopen')){await window.openSchoolAdminWorkspace('home');document.querySelector('.aw-onboarding').open=true;return}
   if(b.hasAttribute('data-admin-todo-reload')){await loadTasks(true);return}
   if(b.dataset.adminTodo){
    if(b.dataset.adminTodo==='parents'){await window.openSchoolAdminWorkspace('accounts');requestAnimationFrame(()=>[...document.querySelectorAll('.card')].find(x=>x.querySelector('h2')?.textContent.includes('待審核'))?.scrollIntoView({block:'center'}));return}
    const task={tshirt:'tshirt',competition:'competition',finance:'finance'}[b.dataset.adminTodo];if(task){await window.openSchoolAdminWorkspace('uniformAdmin');const frame=document.getElementById('awUniformFrame');if(frame)frame.src='/uniform-event-admin.html?embedded=school&task='+encodeURIComponent(task)}return;
   }
   const task=guideTasks[b.dataset.adminGuide];if(task){
    try{localStorage.setItem(guideKey(),'done')}catch{}const intro=document.querySelector('.aw-onboarding');if(intro)intro.open=false;
    state.adminGuideTask=b.dataset.adminGuide;
    if(groups[task[1]])await window.openSchoolAdminWorkspace(task[1]);
    else if(task[1]==='uniformAdmin'){await window.openSchoolAdminWorkspace('uniformAdmin');document.getElementById('awUniformFrame').src='/uniform-event-admin.html?embedded=school&task=guideUniform'}
    else if(task[1]==='activitySettings'){await window.openSchoolAdminWorkspace('uniformAdmin');document.getElementById('awUniformFrame').src='/uniform-event-admin.html?embedded=school&task=activity'}
    else await window.desktopNavigate(task[1]);organize();
   }
  }catch(error){toast('操作未完成：'+(error?.message||error))}
 });
 document.addEventListener('click',async e=>{
  const button=e.target.closest?.('[data-workspace-group],[data-workspace-action],[data-open-teacher-admin]');if(!button)return;
  e.preventDefault();
  try{
   if(button.hasAttribute('data-open-teacher-admin')){state.teacherAdminInlineOpen=true;organize();requestAnimationFrame(()=>document.getElementById('awTeacherAccountDetails')?.scrollIntoView({block:'start',behavior:'smooth'}));return}
   if(button.dataset.workspaceGroup)return await window.openSchoolAdminWorkspace(button.dataset.workspaceGroup);
   const key=button.dataset.workspaceAction;
   if(groups[key])return await window.openSchoolAdminWorkspace(key);
   if(key==='activitySettings'){await window.openSchoolAdminWorkspace('uniformAdmin');document.getElementById('awUniformFrame').src='/uniform-event-admin.html?embedded=school&task=activity';return}
   if(key==='uniformAdmin'){await window.openSchoolAdminWorkspace('uniformAdmin');return}
   if(key==='parentCorrection'){if(typeof window.openParentBindingCorrection==='function')window.openParentBindingCorrection();else document.querySelector('#parentBindingStats button')?.click();return}
   if(key==='attendanceTable')return await window.desktopNavigate('attendance');
   await window.desktopNavigate(key);
  }catch(error){toast('操作未完成：'+(error?.message||error))}
 });
 window.closeInlineTeacherAdmin=function(){state.teacherAdminInlineOpen=false;organize()};
 window.addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==document.getElementById('awUniformFrame')?.contentWindow)return;if(event.data?.type==='school-uniform-height'){const frame=document.getElementById('awUniformFrame');const height=Number(event.data.height);if(frame&&Number.isFinite(height)&&height>=200&&height<=30000)frame.style.height=Math.ceil(height)+'px';}});
 let queued=false;
 new MutationObserver(()=>{if(!queued){queued=true;requestAnimationFrame(()=>{queued=false;organize()})}}).observe(document.getElementById('app'),{childList:true,subtree:true});
 organize();
})();
