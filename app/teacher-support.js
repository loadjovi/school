(()=>{
  const schedule={A:[1,3],B:[2,4],"儲備":[5]};
  const dayText={1:"週一",2:"週二",3:"週三",4:"週四",5:"週五"};
  const cap=()=>state.me?.capabilities||{};
  const isTeacher=()=>cap().section||cap().ensemble||cap().comprehensive||cap().private;

  const originalRoleText=roleText;
  roleText=function(){if(isTeacher())return "教學老師";return originalRoleText()};

  const originalNav=nav;
  nav=function(){
    if(state.page==="contextSelect")return originalNav();
    if(!isTeacher())return originalNav();
    const items=[];
    if(cap().section)items.push(navBtn("section","🎼","分部課"));
    if(cap().ensemble)items.push(navBtn("ensemble","🎻","合奏課"));
    if(cap().private)items.push(navBtn("private","👤","個別課"));
    items.push(navBtn("help","ℹ️","說明"));
    while(items.length<4)items.push("<button></button>");
    return `<nav class="nav">${items.slice(0,4).join("")}</nav>`;
  };

  const originalSectionPage=sectionPage;
  sectionPage=function(){
    const assignments=Array.isArray(state.me.assignments)?state.me.assignments:[];
    const idx=Math.min(window.__sectionClassIndex||0,Math.max(assignments.length-1,0));
    const g=String(assignments[idx]?.groupName||assignments[idx]?.group||"");
    const days=schedule[g]||[];
    const note=days.length?`<div class="card"><div class="notice"><b>${esc(g)}團固定分部課：</b>${days.map(d=>dayText[d]).join("、")}。如遇補課或臨時調整仍可選其他日期，系統會照實記錄。</div></div>`:"";
    return note+originalSectionPage();
  };

  state.ensembleExisting=state.ensembleExisting||null; state.ensembleExistingKey=state.ensembleExistingKey||""; state.ensembleLoading=false;
  window.__ensembleGroupIndex=0;
  window.changeEnsembleGroup=function(v){window.__ensembleGroupIndex=Number(v)||0;state.ensembleExisting=null;state.ensembleExistingKey="";render();setTimeout(()=>loadEnsembleExisting(),0)};
  window.loadEnsembleExisting=async function(){const groups=Array.isArray(state.me.ensembleGroups)?state.me.ensembleGroups.filter(x=>["A","B"].includes(x)):[],g=groups[Math.min(window.__ensembleGroupIndex,Math.max(groups.length-1,0))],date=$("eDate")?.value;if(!g||!date)return;state.ensembleLoading=true;state.ensembleExistingKey=[date,g].join("|");render();try{state.ensembleExisting=await api(`/api/ensemble-attendance?sessionDate=${encodeURIComponent(date)}&groupName=${encodeURIComponent(g)}`)}catch(e){state.ensembleExisting={items:[]};toast("❌ "+e.message)}state.ensembleLoading=false;render()};
  window.changeEnsembleDate=function(){state.ensembleExisting=null;state.ensembleExistingKey="";setTimeout(()=>loadEnsembleExisting(),0)};
  window.ensemblePage=function(){
    const groups=Array.isArray(state.me.ensembleGroups)?state.me.ensembleGroups.filter(x=>["A","B"].includes(x)):[];
    const today=new Date().toISOString().slice(0,10);
    if(!groups.length)return `<div class="card"><h2>合奏課點名</h2><div class="notice">此老師尚未設定 A／B 團合奏課權限。</div></div>`;
    const idx=Math.min(window.__ensembleGroupIndex,groups.length-1),g=groups[idx];
    const students=state.students.filter(s=>String(s.groupName)===g);
    const loaded=state.ensembleExistingKey===[today,g].join("|")?state.ensembleExisting:null,saved=new Map((loaded?.items||[]).map(x=>[String(x.studentId),String(x.status||"present")])),count=saved.size,missing=Math.max(students.length-count,0);
    const statusBox=state.ensembleLoading?'<div class="notice" style="margin-top:10px">⏳ 正在確認點名紀錄…</div>':loaded?(count?`<div class="notice" style="margin-top:10px">✅ <b>已點名</b>｜已儲存 ${count}/${students.length} 人${missing?`，⚠️ 尚有 ${missing} 人未有紀錄`:""}。</div>`:'<div class="notice" style="margin-top:10px">⚠️ <b>尚未點名</b>｜此日期尚無儲存紀錄。</div>'):'<div class="notice" style="margin-top:10px">ℹ️ 正在確認是否已有點名紀錄。</div>';
    const selector=groups.length>1?`<label>合奏課</label><select onchange="changeEnsembleGroup(this.value)">${groups.map((x,i)=>`<option value="${i}" ${i===idx?"selected":""}>${esc(x)}團｜四分部合班</option>`).join("")}</select>`:`<div class="notice"><b>${esc(g)}團｜四分部合班</b></div>`;
    return `<div class="card"><h2>合奏課點名</h2>${selector}<label>上課日期</label><input id="eDate" type="date" value="${today}" onchange="changeEnsembleDate(this.value)">${statusBox}<div class="notice" style="margin-top:10px">合奏課會列出 ${esc(g)} 團小提一、小提二、中提、大提等全部在團學生；固定週二 12:30–13:20，如補課仍可照實選日期。</div></div><div class="card"><h2>${esc(g)}團學生名單</h2>${students.length?students.map(s=>`<div class="item"><div><b>${esc(s.name)}</b><small>${esc(s.section||"待確認")}｜${esc(s.instrument)}｜${esc(s.grade)}</small></div><select id="ens_${s.studentId}" class="status-select"><option value="present" ${saved.get(String(s.studentId))==="present"?"selected":""}>出席</option><option value="late" ${saved.get(String(s.studentId))==="late"?"selected":""}>遲到</option><option value="leave" ${saved.get(String(s.studentId))==="leave"?"selected":""}>請假</option><option value="absent" ${saved.get(String(s.studentId))==="absent"?"selected":""}>缺席</option><option value="cancelled" ${saved.get(String(s.studentId))==="cancelled"?"selected":""}>停課</option></select></div>`).join(""):`<div class="notice">目前此團沒有學生資料。</div>`}${students.length?`<button class="primary" onclick="saveEnsemble()">儲存合奏課點名</button>`:""}</div>`;
  };
  window.saveEnsemble=async function(){
    const groups=Array.isArray(state.me.ensembleGroups)?state.me.ensembleGroups.filter(x=>["A","B"].includes(x)):[];
    const g=groups[Math.min(window.__ensembleGroupIndex,groups.length-1)];
    const students=state.students.filter(s=>String(s.groupName)===g);
    const items=students.map(s=>({studentId:s.studentId,status:$(`ens_${s.studentId}`).value,minutes:$(`ens_${s.studentId}`).value==="absent"?0:50}));
    try{await api("/api/ensemble-attendance",{method:"POST",body:JSON.stringify({sessionDate:$("eDate").value,groupName:g,items})});toast(`✅ ${g}團合奏課點名已儲存`);await loadEnsembleExisting()}catch(e){toast("❌ "+e.message)}
  };

  privatePage=function(){
    const today=new Date().toISOString().slice(0,10);
    const ids=new Set((state.me.privateStudentIds||[]).map(String));
    const students=state.students.filter(s=>ids.has(String(s.studentId)));
    if(!students.length)return `<div class="card"><h2>個別課紀錄</h2><div class="notice">目前尚未綁定這位老師的個課學生。個課學生可跨小提琴、中提琴、大提琴，不受分部課權限限制。</div></div>`;
    return `<div class="card"><h2>個別課紀錄</h2><div class="notice">個課依「老師 ↔ 學生」個別綁定，可跨不同樂器與團別。</div><label>學生</label><select id="iStudent">${students.map(s=>`<option value="${s.studentId}">${esc(s.name)}｜${esc(s.groupName)}團｜${esc(s.instrument)}</option>`).join("")}</select><label>上課日期</label><input id="iDate" type="date" value="${today}"><div class="row2"><div><label>狀態</label><select id="iStatus"><option value="present">出席</option><option value="late">遲到</option><option value="leave">請假</option><option value="absent">缺席</option></select></div><div><label>分鐘</label><input id="iMinutes" type="number" value="50"></div></div><label>課程內容</label><textarea id="iContent" rows="3"></textarea><button class="primary" onclick="savePrivate()">儲存個別課紀錄</button></div>`;
  };

  const originalRecordPage=recordPage;
  recordPage=function(){
    const html=originalRecordPage();
    const s=state.summary||{};
    if(s.ensembleTotal===undefined)return html;
    return html+`<div class="card"><h2>合奏課紀錄</h2>${scoreItem("A／B 團合奏課","四分部合班，由合奏課老師點名",`${s.ensemblePresent||0} / ${s.ensembleTotal||0}`)}</div>`;
  };

  const originalRender=render;
  render=function(){
    if(!isTeacher())return originalRender();
    const available=[];if(cap().section)available.push("section");if(cap().ensemble)available.push("ensemble");if(cap().private)available.push("private");available.push("help");
    if(!available.includes(state.page))state.page=available[0];
    let c=state.page==="ensemble"?ensemblePage():state.page==="private"?privatePage():state.page==="help"?helpPage():sectionPage();
    document.getElementById("app").innerHTML=shell(c);
  };

  if(state.me&&isTeacher())render();
})();
