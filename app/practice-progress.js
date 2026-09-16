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
  state.practiceProgressStatus=state.practiceProgressStatus||"全部";

  async function loadPracticeProgress(){
    if(!canView())return;
    state.practiceProgressData=await api(`/api/practice-progress?month=${encodeURIComponent(state.practiceProgressMonth)}`);
  }

  function filteredItems(){
    const q=String(state.practiceProgressSearch||"").trim().toLowerCase();
    const status=state.practiceProgressStatus||"全部";
    return (state.practiceProgressData?.items||[]).filter(x=>{
      if(state.practiceProgressGroup!=="全部"&&String(x.groupName)!==state.practiceProgressGroup)return false;
      if(state.practiceProgressSection!=="全部"&&String(x.section)!==state.practiceProgressSection)return false;
      if(q&&!\`${x.name} ${x.groupName} ${x.section} ${x.instrument} ${x.grade}\`.toLowerCase().includes(q))return false;
      const active=Number(x.activeDays||0),rate=Number(x.practiceRatePercent||0);
      if(status==="尚未練習"&&active!==0)return false;
      if(status==="未達標"&&!(active>0&&rate<80))return false;
      if(status==="已達標"&&rate<80)return false;
      return true;
    }).sort((a,b)=>{
      const rank=x=>x.daysSincePractice==null?0:Number(x.daysSincePractice)>=7?1:Number(x.practiceRatePercent||0)<80?2:3;
      const r=rank(a)-rank(b);if(r)return r;
      const ad=a.lastPracticeDate||"",bd=b.lastPracticeDate||"";if(ad!==bd)return ad.localeCompare(bd);
      return String(a.name||"").localeCompare(String(b.name||""),"zh-Hant");
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
    if(!d)return \`<div class="card"><h2>📚 自主練習${isAdmin()?'月報':'進度'}</h2><div class="notice">正在讀取學生練習資料…</div></div>\`;
    const groups=["全部",...new Set((d.items||[]).map(x=>String(x.groupName)).filter(Boolean))];
    const sections=["全部",...new Set((d.items||[]).map(x=>String(x.section)).filter(Boolean))];
    const all=(d.items||[]),items=filteredItems();
    const counts={none:all.filter(x=>Number(x.activeDays||0)===0).length,below:all.filter(x=>Number(x.activeDays||0)>0&&Number(x.practiceRatePercent||0)<80).length,ok:all.filter(x=>Number(x.practiceRatePercent||0)>=80).length};
    const filterBtn=(key,label,count)=>\`<button class="secondary" style="width:auto;padding:8px 11px;margin:3px;font-weight:800;${state.practiceProgressStatus===key?'background:#eef2ff;border-width:2px':''}" onclick="changePracticeProgressStatus('${key}')">${label}${count==null?'':' '+count}</button>\`;
    const rows=items.map(x=>{const active=Number(x.activeDays||0),rate=Number(x.practiceRatePercent||0),gap=x.daysSincePractice==null?999:Number(x.daysSincePractice),status=active===0?'🔴 尚未練習':gap>=7?`🔴 ${gap}天未練習`:gap>=3?`🟡 ${gap}天未練習`:rate<80?'🟡 未達標':'🟢 已達標';return \`<div class="item" style="align-items:center"><div style="min-width:0"><b>${esc(x.name)} <span style="font-size:13px">${status}</span></b><small>${esc(x.groupName)}團｜${esc(x.section)}｜${esc(x.instrument)}<br>${active} 天｜${Number(x.totalMinutes||0)} 分鐘｜截至目前目標 ${Number(x.effectiveTargetDays||x.targetDays||0)} 天｜最近 ${esc(x.lastPracticeDate||'尚無紀錄')}</small></div><button class="secondary" style="width:auto;padding:7px 10px;margin:0" onclick="togglePracticeProgressDetail('${esc(x.studentId)}')">›</button></div>${detailHtml(x)}\`}).join("");
    return \`${!isAdmin()?'<button class="secondary" style="width:auto;margin:0 0 12px;padding:9px 14px;border-radius:999px;font-weight:800" onclick="go(\\'teacherHome\\')">← 返回今日教學</button>':''}
    <div class="card hero"><h2>📚 自主練習${isAdmin()?'月報':'進度'}</h2>
      <div class="notice">達標率依「截至目前日期」動態計算；並優先顯示尚無紀錄、7 天以上未練習及未達標學生。</div>
      <label>月份</label><input type="month" value="${esc(state.practiceProgressMonth)}" onchange="changePracticeProgressMonth(this.value)">
      <div class="grid"><div class="kpi"><b>${all.length}</b><span>授課學生</span></div><div class="kpi"><b>${all.length-counts.none}</b><span>已有練習</span></div><div class="kpi"><b>${counts.none}</b><span>尚未練習</span></div><div class="kpi"><b>${counts.ok}</b><span>已達標</span></div></div>
      <div style="margin-top:10px">${filterBtn('全部','全部',all.length)}${filterBtn('尚未練習','🔴 尚未練習',counts.none)}${filterBtn('未達標','🟡 未達標',counts.below)}${filterBtn('已達標','🟢 已達標',counts.ok)}</div>
      <div class="row2"><div><label>團別</label><select onchange="changePracticeProgressGroup(this.value)">${groups.map(g=>\`<option value="${esc(g)}" ${g===state.practiceProgressGroup?'selected':''}>${esc(g==='全部'?'全部團別':g+'團')}</option>\`).join('')}</select></div><div><label>分部</label><select onchange="changePracticeProgressSection(this.value)">${sections.map(v=>\`<option value="${esc(v)}" ${v===state.practiceProgressSection?'selected':''}>${esc(v)}</option>\`).join('')}</select></div></div>
      <label>搜尋學生</label><input value="${esc(state.practiceProgressSearch)}" placeholder="姓名／團別／分部／樂器" oninput="changePracticeProgressSearch(this.value)">
      ${isAdmin()?'<button class="secondary" style="width:100%;margin-top:10px" onclick="exportPracticeMonthlySummary()">📥 匯出月統計 CSV</button>':''}
    </div>
    <div class="card"><h2>學生列表 <span class="muted" style="font-size:14px">${items.length} 人</span></h2>${rows||'<div class="notice">目前沒有符合條件的學生。</div>'}</div>\`;
  }

  window.changePracticeProgressStatus=function(v){state.practiceProgressStatus=String(v||"全部");state.practiceProgressSelected="";render()};
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
      state.practiceProgressStatus='全部';state.practiceProgressGroup='全部';state.practiceProgressSection='全部';state.practiceProgressSearch='';state.practiceProgressSelected='';
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
