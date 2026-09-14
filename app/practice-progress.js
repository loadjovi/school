(()=>{
  const isAdmin=()=>state.me?.role==="admin";
  const isTeacher=()=>state.me?.role!=="admin"&&!!state.me?.capabilities?.teacherSettings;
  const canView=()=>isAdmin()||isTeacher();
  state.practiceProgressMonth=state.practiceProgressMonth||new Date().toISOString().slice(0,7);
  state.practiceProgressData=state.practiceProgressData||null;
  state.practiceProgressGroup=state.practiceProgressGroup||"全部";
  state.practiceProgressSection=state.practiceProgressSection||"全部";
  state.practiceProgressSearch=state.practiceProgressSearch||"";
  state.practiceProgressSelected=state.practiceProgressSelected||"";

  async function loadPracticeProgress(){
    if(!canView())return;
    state.practiceProgressData=await api(`/api/practice-progress?month=${encodeURIComponent(state.practiceProgressMonth)}`);
  }

  function filteredItems(){
    const q=String(state.practiceProgressSearch||"").trim().toLowerCase();
    return (state.practiceProgressData?.items||[]).filter(x=>{
      if(state.practiceProgressGroup!=="全部"&&String(x.groupName)!==state.practiceProgressGroup)return false;
      if(state.practiceProgressSection!=="全部"&&String(x.section)!==state.practiceProgressSection)return false;
      if(q&&!`${x.name} ${x.groupName} ${x.section} ${x.instrument} ${x.grade}`.toLowerCase().includes(q))return false;
      return true;
    });
  }

  function progressBadge(x){
    const p=Number(x.practiceRatePercent||0);
    if(p>=80)return `<span class="badge ok">${p}%</span>`;
    if(p>=50)return `<span class="badge warn">${p}%</span>`;
    return `<span class="badge bad">${p}%</span>`;
  }

  function detailHtml(x){
    if(state.practiceProgressSelected!==String(x.studentId))return "";
    const rows=isAdmin()?(x.records||[]):(x.recent||[]);
    if(!rows.length)return `<div class="notice" style="margin-top:10px">本月尚無家長回填的自主練習紀錄。</div>`;
    return `<div style="margin-top:10px">${rows.map(r=>`<div class="item" style="display:block"><div style="display:flex;justify-content:space-between;gap:10px"><b>${esc(r.practiceDate)}｜${r.minutes} 分鐘</b><span class="badge ${r.qualified?'ok':'warn'}">${r.qualified?'達標':'未達標'}</span></div>${r.startTime||r.endTime?`<small>${esc(r.startTime||'')}～${esc(r.endTime||'')}</small>`:''}${r.practiceContent?`<small style="margin-top:7px"><b>練習內容：</b>${esc(r.practiceContent)}</small>`:''}${r.focus?`<small><b>練習重點：</b>${esc(r.focus)}</small>`:''}</div>`).join("")}</div>`;
  }

  function csvCell(v){const s=String(v??"");return /[",\r\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s}
  function downloadCsv(filename,rows){
    const content="\uFEFF"+rows.map(r=>r.map(csvCell).join(",")).join("\r\n");
    const blob=new Blob([content],{type:"text/csv;charset=utf-8"});
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }
  window.exportPracticeMonthlySummary=function(){
    const items=filteredItems();
    if(!items.length){toast("目前沒有可匯出的自主練習資料");return}
    const rows=[["月份","學生姓名","年級","團別","分部","樂器","達標天數","目標天數","練習天數","總分鐘","平均分鐘/日","達成率","自主練習10%換算"]];
    for(const x of items)rows.push([state.practiceProgressMonth,x.name,x.grade,x.groupName,x.section,x.instrument,x.qualifiedDays,x.targetDays,x.activeDays,x.totalMinutes,x.averageMinutes,`${x.practiceRatePercent}%`,x.practiceScore10]);
    downloadCsv(`${state.practiceProgressMonth}_自主練習月統計.csv`,rows);toast("📥 已匯出自主練習月統計");
  };
  window.exportPracticeMonthlyDetail=function(){
    const items=filteredItems();
    const rows=[["月份","學生姓名","年級","團別","分部","樂器","練習日期","開始時間","結束時間","分鐘","是否達標","練習內容","練習重點"]];
    for(const x of items){
      for(const r of (x.records||[]))rows.push([state.practiceProgressMonth,x.name,x.grade,x.groupName,x.section,x.instrument,r.practiceDate,r.startTime,r.endTime,r.minutes,r.qualified?"達標":"未達標",r.practiceContent,r.focus]);
    }
    if(rows.length===1){toast("目前沒有逐日練習紀錄可匯出");return}
    downloadCsv(`${state.practiceProgressMonth}_自主練習逐日明細.csv`,rows);toast("📥 已匯出自主練習逐日明細");
  };

  function practiceProgressPage(){
    const d=state.practiceProgressData;
    if(!d)return `<div class="card"><h2>📚 自主練習${isAdmin()?'月報':'進度'}</h2><div class="notice">正在讀取學生練習資料…</div></div>`;
    const groups=["全部",...new Set((d.items||[]).map(x=>String(x.groupName)).filter(Boolean))];
    const sections=["全部",...new Set((d.items||[]).map(x=>String(x.section)).filter(Boolean))];
    const items=filteredItems();
    const qualified=items.reduce((n,x)=>n+Number(x.qualifiedDays||0),0);
    const minutes=items.reduce((n,x)=>n+Number(x.totalMinutes||0),0);
    const noPractice=items.filter(x=>Number(x.activeDays||0)===0).length;
    const notice=isAdmin()
      ?`管理員可查看全團每位學生整月自主練習，作為後續「自主練習 10%」成績統計依據。每日達 ${d.qualifiedMinutes} 分鐘視為達標，目前目標為每月 ${d.targetDays} 天。`
      :`資料來自家長回填的自主練習。每次達 ${d.qualifiedMinutes} 分鐘視為當日達標；老師只會看到自己目前有授課關係的學生。`;
    return `<div class="card hero"><h2>📚 自主練習${isAdmin()?'月報':'進度'}</h2><div class="notice">${esc(notice)}</div>
      <label>月份</label><input type="month" value="${esc(state.practiceProgressMonth)}" onchange="changePracticeProgressMonth(this.value)">
      <div class="row2"><div><label>團別</label><select onchange="changePracticeProgressGroup(this.value)">${groups.map(g=>`<option value="${esc(g)}" ${g===state.practiceProgressGroup?'selected':''}>${esc(g==='全部'?'全部團別':g+'團')}</option>`).join('')}</select></div><div><label>分部</label><select onchange="changePracticeProgressSection(this.value)">${sections.map(s=>`<option value="${esc(s)}" ${s===state.practiceProgressSection?'selected':''}>${esc(s)}</option>`).join('')}</select></div></div>
      <label>搜尋學生</label><input value="${esc(state.practiceProgressSearch)}" placeholder="姓名／團別／分部／樂器" oninput="changePracticeProgressSearch(this.value)">
      <div class="grid"><div class="kpi"><b>${items.length}</b><span>學生</span></div><div class="kpi"><b>${qualified}</b><span>本月達標天數合計</span></div><div class="kpi"><b>${minutes}</b><span>練習總分鐘</span></div><div class="kpi"><b>${noPractice}</b><span>本月尚未練習</span></div></div>
      ${isAdmin()?`<button class="secondary" style="width:100%;margin-top:12px" onclick="exportPracticeMonthlySummary()">📥 匯出月統計 CSV</button><button class="secondary" style="width:100%;margin-top:8px" onclick="exportPracticeMonthlyDetail()">📥 匯出逐日明細 CSV</button>`:''}
    </div>
    ${items.map(x=>`<div class="card"><div class="student"><div class="studentleft"><div class="avatar">${esc(x.name?.[0]||'學')}</div><div><div class="name">${esc(x.name)}</div><div class="muted">${esc(x.groupName)}團｜${esc(x.section)}｜${esc(x.instrument)}｜${esc(x.grade)}</div></div></div>${progressBadge(x)}</div>
      <div class="grid"><div class="kpi"><b>${x.qualifiedDays}</b><span>達標天數 / ${x.targetDays}</span></div><div class="kpi"><b>${x.totalMinutes}</b><span>本月分鐘</span></div><div class="kpi"><b>${x.activeDays}</b><span>有練習天數</span></div><div class="kpi"><b>${x.averageMinutes}</b><span>平均分鐘/日</span></div></div>
      ${isAdmin()?`<div class="notice" style="margin-top:10px">自主練習 10% 換算參考：<b>${Number(x.practiceScore10||0).toFixed(1)} / 10</b></div>`:''}
      <div class="notice" style="margin-top:10px">最近練習：<b>${esc(x.lastPracticeDate||'尚無紀錄')}</b>${Number(x.activeDays||0)===0?'<br><span style="color:#991b1b">⚠️ 本月尚未收到自主練習紀錄</span>':''}</div>
      <button class="secondary" style="width:100%;margin-top:10px" onclick="togglePracticeProgressDetail('${esc(x.studentId)}')">${state.practiceProgressSelected===String(x.studentId)?'收合練習內容':isAdmin()?'查看本月完整紀錄':'查看最近練習內容'}</button>${detailHtml(x)}</div>`).join('')||`<div class="card"><div class="notice">目前沒有符合條件的學生。</div></div>`}`;
  }

  window.changePracticeProgressMonth=async function(v){state.practiceProgressMonth=String(v||new Date().toISOString().slice(0,7));try{await loadPracticeProgress();render()}catch(e){toast('❌ '+e.message)}};
  window.changePracticeProgressGroup=function(v){state.practiceProgressGroup=String(v||'全部');render()};
  window.changePracticeProgressSection=function(v){state.practiceProgressSection=String(v||'全部');render()};
  window.changePracticeProgressSearch=function(v){state.practiceProgressSearch=String(v||'');render()};
  window.togglePracticeProgressDetail=function(id){state.practiceProgressSelected=state.practiceProgressSelected===String(id)?'':String(id);render()};

  if(typeof adminPage==="function"){
    const baseAdminPage=adminPage;
    adminPage=function(){
      return baseAdminPage()+`<div class="card"><h2>📚 自主練習月報</h2><div class="notice">查看全團學生每月自主練習達標天數、分鐘與完整練習明細，供後續 10% 成績統計使用。</div><button class="primary" onclick="go('practiceProgress')">查看自主練習月報</button></div>`;
    };
  }

  const previousGo=go;
  go=async function(p){
    if(p==='practiceProgress'&&canView()){
      state.page='practiceProgress';
      try{await loadPracticeProgress()}catch(e){toast('❌ '+e.message)}
      render();return;
    }
    return previousGo(p);
  };

  const previousRender=render;
  render=function(){
    if(state.page==='practiceProgress'&&canView()){
      document.getElementById('app').innerHTML=shell(practiceProgressPage());
      return;
    }
    return previousRender();
  };
})();
