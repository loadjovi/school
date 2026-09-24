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
  const practiceFeedbackLevels=[{level:1,icon:"🌱",label:"起步中"},{level:2,icon:"👍",label:"持續加油"},{level:3,icon:"🙂",label:"表現不錯"},{level:4,icon:"🌟",label:"很棒喔"},{level:5,icon:"🏆",label:"超級投入"}];

  async function loadPracticeProgress(){
    if(!canView())return;
    const month=encodeURIComponent(state.practiceProgressMonth);
    const [progress,feedback]=await Promise.all([
      api(`/api/practice-progress?month=${month}`),
      api(`/api/practice-feedback?month=${month}`).catch(()=>({items:[]}))
    ]);
    const feedbackMap=new Map((feedback.items||[]).map(x=>[String(x.studentId),x]));
    progress.items=(progress.items||[]).map(x=>({...x,feedback:feedbackMap.get(String(x.studentId))||null}));
    state.practiceProgressData=progress;
  }

  function filteredItems(){
    const q=String(state.practiceProgressSearch||"").trim().toLowerCase();
    const status=state.practiceProgressStatus||"全部";
    return (state.practiceProgressData?.items||[]).filter(x=>{
      if(state.practiceProgressGroup!=="全部"&&String(x.groupName)!==state.practiceProgressGroup)return false;
      if(state.practiceProgressSection!=="全部"&&String(x.section)!==state.practiceProgressSection)return false;
      if(q&&!`${x.name} ${x.groupName} ${x.section} ${x.instrument} ${x.grade}`.toLowerCase().includes(q))return false;
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

  function feedbackLevelMeta(level){return practiceFeedbackLevels.find(x=>x.level===Number(level))||null}
  function feedbackPanel(x){
    if(!isTeacher())return x.feedback?(()=>{const m=feedbackLevelMeta(x.feedback.level);return m?`<div class="notice" style="margin-top:10px"><b>${m.icon} ${esc(m.label)}</b>${x.feedback.comment?`<br>${esc(x.feedback.comment)}`:""}<small style="display:block;margin-top:5px">回饋老師：${esc(x.feedback.teacherName||"")}</small></div>`:""})():"";
    const current=Number(x.feedback?.level||0),comment=String(x.feedback?.comment||"");
    return `<div class="practice-feedback-box">
      <div style="font-weight:900">💬 老師鼓勵回饋</div>
      <small style="display:block;margin:4px 0 10px;color:var(--muted)">點選一個鼓勵圖示，可再留一句話給學生；這不是排名或考試分數。</small>
      <div class="practice-feedback-options">${practiceFeedbackLevels.map(m=>`<input type="radio" id="pf_${esc(x.studentId)}_${m.level}" name="pf_${esc(x.studentId)}" value="${m.level}" ${current===m.level?"checked":""}><label for="pf_${esc(x.studentId)}_${m.level}"><span>${m.icon}</span><small>${esc(m.label)}</small></label>`).join("")}</div>
      <label style="margin-top:10px">老師留言（選填）</label>
      <textarea id="pfComment_${esc(x.studentId)}" rows="2" maxlength="120" placeholder="例如：這週練習很穩定，繼續保持！">${esc(comment)}</textarea>
      <button class="primary" style="margin-top:8px" onclick="savePracticeFeedback('${esc(x.studentId)}')">💛 儲存鼓勵回饋</button>
      ${x.feedback?`<small style="display:block;margin-top:7px;color:var(--muted)">目前回饋：${esc(x.feedback.teacherName||"老師")}｜${esc(String(x.feedback.updatedAt||"").slice(0,10))}</small>`:""}
    </div>`;
  }
  function detailHtml(x){
    if(state.practiceProgressSelected!==String(x.studentId))return "";
    const rows=isAdmin()?(x.records||[]):(x.recent||[]);
    const records=rows.length?`<div style="margin-top:10px">${rows.map(r=>`<div class="item" style="display:block"><div style="display:flex;justify-content:space-between;gap:10px"><b>${esc(r.practiceDate)}｜${r.minutes} 分鐘</b><span class="badge ${r.qualified?'ok':'warn'}">${r.qualified?'計入練習日':'練習紀錄'}</span></div>${r.startTime||r.endTime?`<small>${esc(r.startTime||'')}～${esc(r.endTime||'')}</small>`:''}${r.practiceContent?`<small style="margin-top:7px"><b>練習內容：</b>${esc(r.practiceContent)}</small>`:''}${r.focus?`<small><b>練習重點：</b>${esc(r.focus)}</small>`:''}</div>`).join("")}</div>`:`<div class="notice" style="margin-top:10px">本月尚無家長回填的自主練習紀錄。</div>`;
    return records+feedbackPanel(x);
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
    const rows=[["月份","學生姓名","年級","團別","分部","樂器","計入練習天數","建議目標天數","練習天數","總分鐘","平均分鐘/日","練習進度","自主練習10%換算"]];
    for(const x of items)rows.push([state.practiceProgressMonth,x.name,x.grade,x.groupName,x.section,x.instrument,x.qualifiedDays,x.targetDays,x.activeDays,x.totalMinutes,x.averageMinutes,`${x.practiceRatePercent}%`,x.practiceScore10]);
    downloadCsv(`${state.practiceProgressMonth}_自主練習月統計.csv`,rows);toast("📥 已匯出自主練習月統計");
  };
  window.exportPracticeMonthlyDetail=function(){
    const items=filteredItems();
    const rows=[["月份","學生姓名","年級","團別","分部","樂器","練習日期","開始時間","結束時間","分鐘","紀錄狀態","練習內容","練習重點"]];
    for(const x of items){
      for(const r of (x.records||[]))rows.push([state.practiceProgressMonth,x.name,x.grade,x.groupName,x.section,x.instrument,r.practiceDate,r.startTime,r.endTime,r.minutes,r.qualified?"計入練習日":"一般練習紀錄",r.practiceContent,r.focus]);
    }
    if(rows.length===1){toast("目前沒有逐日練習紀錄可匯出");return}
    downloadCsv(`${state.practiceProgressMonth}_自主練習逐日明細.csv`,rows);toast("📥 已匯出自主練習逐日明細");
  };

  function practiceProgressPage(){
    const d=state.practiceProgressData;
    if(!d)return `<div class="card"><h2>📚 自主練習${isAdmin()?'月報':'進度'}</h2><div class="notice">正在讀取學生練習資料…</div></div>`;
    const groups=["全部",...new Set((d.items||[]).map(x=>String(x.groupName)).filter(Boolean))];
    const sections=["全部",...new Set((d.items||[]).map(x=>String(x.section)).filter(Boolean))];
    const all=(d.items||[]),items=filteredItems();
    const counts={none:all.filter(x=>Number(x.activeDays||0)===0).length,below:all.filter(x=>Number(x.activeDays||0)>0&&Number(x.practiceRatePercent||0)<80).length,ok:all.filter(x=>Number(x.practiceRatePercent||0)>=80).length};
    const filterBtn=(key,label,count)=>`<button class="secondary" style="width:100%;min-width:0;padding:9px 8px;margin:0;font-weight:800;white-space:nowrap;${state.practiceProgressStatus===key?'background:#eef2ff;border-width:2px':''}" onclick="changePracticeProgressStatus('${key}')">${label}${count==null?'':' '+count}</button>`;
    const rows=items.map(x=>{const active=Number(x.activeDays||0),rate=Number(x.practiceRatePercent||0),gap=x.daysSincePractice==null?999:Number(x.daysSincePractice),status=active===0?'⚪ 本月尚無紀錄':gap>=7?`🟡 距上次練習 ${gap} 天`:gap>=3?`🟡 距上次練習 ${gap} 天`:rate<80?'🟡 持續累積中':'🟢 本月練習目標已完成',fb=feedbackLevelMeta(x.feedback?.level),fbText=fb?`<span class="practice-feedback-chip">${fb.icon} ${esc(fb.label)}</span>`:"";return `<div class="item" style="align-items:center"><div style="min-width:0"><b>${esc(x.name)} <span style="font-size:13px">${status}</span></b><small>${esc(x.groupName)}團｜${esc(x.section)}｜${esc(x.instrument)}<br>${active} 天｜${Number(x.totalMinutes||0)} 分鐘｜最近 ${esc(x.lastPracticeDate||'尚無紀錄')}${x.lastPracticeDate&&x.daysSincePractice!=null?`｜距今 ${Number(x.daysSincePractice)} 天`:''}</small>${fbText}</div><button class="secondary" style="width:auto;padding:7px 10px;margin:0" onclick="togglePracticeProgressDetail('${esc(x.studentId)}')">›</button></div>${detailHtml(x)}`}).join("");
    return `${!isAdmin()?'<button class="secondary" style="width:auto;margin:0 0 12px;padding:9px 14px;border-radius:999px;font-weight:800" onclick="go(\'teacherHome\')">← 返回今日教學</button>':''}
    <div class="card hero"><h2>📚 自主練習${isAdmin()?'月報':'進度'}</h2>
      <div class="notice">練習進度依「截至目前日期」動態計算；主要用來了解孩子的練習習慣並提供適度提醒，不作排名或壓力式呈現。</div>
      <label>月份</label><input type="month" value="${esc(state.practiceProgressMonth)}" onchange="changePracticeProgressMonth(this.value)">
      <div class="grid"><div class="kpi"><b>${all.length}</b><span>授課學生</span></div><div class="kpi"><b>${all.length-counts.none}</b><span>已有練習</span></div><div class="kpi"><b>${counts.none}</b><span>本月尚無紀錄</span></div><div class="kpi"><b>${counts.ok}</b><span>已完成目標</span></div></div>
      <div style="margin-top:10px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px">${filterBtn('全部','全部',all.length)}${filterBtn('尚未練習','⚪ 本月尚無紀錄',counts.none)}${filterBtn('未達標','🟡 持續累積中',counts.below)}${filterBtn('已達標','🟢 已完成目標',counts.ok)}</div>
      <div class="row2"><div><label>團別</label><select onchange="changePracticeProgressGroup(this.value)">${groups.map(g=>`<option value="${esc(g)}" ${g===state.practiceProgressGroup?'selected':''}>${esc(g==='全部'?'全部團別':g+'團')}</option>`).join('')}</select></div><div><label>分部</label><select onchange="changePracticeProgressSection(this.value)">${sections.map(v=>`<option value="${esc(v)}" ${v===state.practiceProgressSection?'selected':''}>${esc(v)}</option>`).join('')}</select></div></div>
      <label>搜尋學生</label><input value="${esc(state.practiceProgressSearch)}" placeholder="姓名／團別／分部／樂器" oninput="changePracticeProgressSearch(this.value)">
      ${isAdmin()?'<button class="secondary" style="width:100%;margin-top:10px" onclick="exportPracticeMonthlySummary()">📥 匯出月統計 CSV</button>':''}
    </div>
    <div class="card"><h2>學生列表 <span class="muted" style="font-size:14px">${items.length} 人</span></h2>${rows||'<div class="notice">目前沒有符合條件的學生。</div>'}</div>`;
  }

  window.savePracticeFeedback=async function(studentId){
    if(!isTeacher())return;
    const selected=document.querySelector(`input[name="pf_${CSS.escape(String(studentId))}"]:checked`);
    if(!selected){toast("請先選擇一個鼓勵圖示");return}
    const comment=document.getElementById("pfComment_"+studentId)?.value?.trim()||"";
    try{
      const d=await api("/api/practice-feedback",{method:"POST",body:JSON.stringify({studentId,month:state.practiceProgressMonth,level:Number(selected.value),comment})});
      const item=(state.practiceProgressData?.items||[]).find(x=>String(x.studentId)===String(studentId));
      if(item)item.feedback=d.item;
      toast("💛 已送出老師鼓勵回饋");
      render();
    }catch(e){toast("❌ "+e.message)}
  };
  window.changePracticeProgressStatus=function(v){state.practiceProgressStatus=String(v||"全部");state.practiceProgressSelected="";render()};
  window.changePracticeProgressMonth=async function(v){state.practiceProgressMonth=String(v||new Date().toISOString().slice(0,7));try{await loadPracticeProgress();render()}catch(e){toast('❌ '+e.message)}};
  window.changePracticeProgressGroup=function(v){state.practiceProgressGroup=String(v||'全部');render()};
  window.changePracticeProgressSection=function(v){state.practiceProgressSection=String(v||'全部');render()};
  window.changePracticeProgressSearch=function(v){state.practiceProgressSearch=String(v||'');render()};
  window.togglePracticeProgressDetail=function(id){state.practiceProgressSelected=state.practiceProgressSelected===String(id)?'':String(id);render()};

  if(typeof adminPage==="function"){
    const baseAdminPage=adminPage;
    adminPage=function(){
      return baseAdminPage()+`<div class="card"><h2>📚 自主練習月報</h2><div class="notice">查看全團學生每月自主練習天數、分鐘與練習明細，協助了解練習習慣與提供適度提醒；相關資料仍可供後續 10% 成績統計使用。</div><button class="primary" onclick="go('practiceProgress')">查看自主練習月報</button></div>`;
    };
  }

  window.openTeacherPracticeProgress=async function(){
    if(!canView())return;
    state.practiceProgressStatus='全部';
    state.practiceProgressGroup='全部';
    state.practiceProgressSection='全部';
    state.practiceProgressSearch='';
    state.practiceProgressSelected='';
    state.page='practiceProgress';
    try{await loadPracticeProgress()}catch(e){toast('❌ '+e.message)}
    document.getElementById('app').innerHTML=shell(practiceProgressPage());
  };

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
