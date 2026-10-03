(()=>{
  const isAdmin=()=>state.me?.role==="admin";
  const isTeacher=()=>state.me?.role!=="admin"&&!!state.me?.capabilities?.teacherSettings;
  const canView=()=>isAdmin()||isTeacher();
  state.practiceProgressMonth=state.practiceProgressMonth||new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Taipei"}).slice(0,7);
  state.practiceProgressData=state.practiceProgressData||null;
  state.practiceProgressGroup=state.practiceProgressGroup||"全部";
  state.practiceProgressSection=state.practiceProgressSection||"全部";
  state.practiceProgressSearch=state.practiceProgressSearch||"";
  state.practiceProgressSelected=state.practiceProgressSelected||"";
  state.practiceProgressStatus=state.practiceProgressStatus||"全部";
  state.teacherEvaluationFilter=state.teacherEvaluationFilter||"pending";
  state.teacherEvaluationSelected=state.teacherEvaluationSelected||"";
  state.teacherSemesterFallback=state.teacherSemesterFallback||null;
  state.teacherSemesterFallbackLoading=false;
  const practiceFeedbackLevels=[{level:1,icon:"🌱",label:"起步中"},{level:2,icon:"👍",label:"持續加油"},{level:3,icon:"🙂",label:"表現不錯"},{level:4,icon:"🌟",label:"很棒喔"},{level:5,icon:"🏆",label:"超級投入"}];
  const practiceFeedbackPresets=["這週練習很穩定，繼續保持！","有進步，記得每天練一點點喔！","基本功有累積，繼續加油！","練習很投入，期待下次上課的表現！","很棒！保持規律練習會進步更快。"];
  state.practiceFeedbackSaving=state.practiceFeedbackSaving||"";

  function scoreRound(v){return Math.round(Number(v||0)*100)/100}
  function scoreParts(x,progress){
    const target=Math.max(1,Number(x.effectiveTargetDays||progress?.effectiveTargetDays||1));
    const qualified=Number(x.qualifiedDays||0);
    const total=scoreRound(Math.min(qualified/target,1)*10);
    const current=String(progress?.month||"")===String(progress?.taipeiToday||"").slice(0,7),trial=/^\d{4}-09$/.test(String(progress?.month||""));
    return {total,target,qualified,current,trial,status:trial?"試營運":current?"暫估":"正式",source:"system"};
  }
  async function loadPracticeProgress(){
    if(!canView())return;
    const requestedMonth=state.practiceProgressMonth,month=encodeURIComponent(requestedMonth);
    const [progress,feedback]=await Promise.all([
      api(`/api/practice-progress?month=${month}`),
      api(`/api/practice-feedback?month=${month}`).catch(()=>({items:[]}))
    ]);
    const feedbackMap=new Map();
    for(const x of (feedback.items||[])){const id=String(x.studentId),arr=feedbackMap.get(id)||[];arr.push(x);feedbackMap.set(id,arr)}
    progress.items=(progress.items||[]).map(x=>{
      const history=(feedbackMap.get(String(x.studentId))||[]).sort((a,b)=>String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")));
      const item={...x,feedback:history[0]||null,feedbackCount:history.length,feedbackHistory:history.slice(0,5)};
      item.monthlyScore=scoreParts(item,progress);
      return item;
    });
    if(state.practiceProgressMonth===requestedMonth)state.practiceProgressData=progress;
  }

  function taipeiMonth(){
    return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit"}).format(new Date()).slice(0,7);
  }
  function semesterFinalMonth(month=taipeiMonth()){
    const [y,m]=String(month||"").split("-").map(Number);
    if(!y)return "";
    if(m===1)return `${y-1}-12`;
    if(m>=8)return `${y}-12`;
    return `${y}-05`;
  }
  function sectionFallbackOpen(){
    const now=taipeiMonth(),finalMonth=semesterFinalMonth(now);
    return !!state.me?.capabilities?.section&&now===finalMonth;
  }
  async function loadSemesterFallback(){
    if(!isTeacher()||!state.me?.capabilities?.section){state.teacherSemesterFallback=null;return}
    const month=semesterFinalMonth(taipeiMonth());
    if(!sectionFallbackOpen()){state.teacherSemesterFallback={month,mode:"semesterFallback",items:[],notOpen:true};return}
    state.teacherSemesterFallbackLoading=true;
    try{
      state.teacherSemesterFallback=await api(`/api/learning-monthly-evaluation?month=${encodeURIComponent(month)}&mode=semesterFallback`);
    }finally{state.teacherSemesterFallbackLoading=false}
  }

  function shortRecords(x){
    const limit=Number(state.practiceProgressData?.qualifiedMinutes||20);
    return (x.records||[]).filter(r=>Number(r.minutes)>0&&Number(r.minutes)<limit);
  }

  function filteredItems(){
    const q=String(state.practiceProgressSearch||"").trim().toLowerCase();
    const status=state.practiceProgressStatus||"全部";
    return (state.practiceProgressData?.items||[]).filter(x=>{
      if(state.practiceProgressGroup!=="全部"&&String(x.groupName)!==state.practiceProgressGroup)return false;
      if(state.practiceProgressSection!=="全部"&&String(x.section)!==state.practiceProgressSection)return false;
      if(q&&!`${x.name} ${x.groupName} ${x.section} ${x.instrument} ${x.grade}`.toLowerCase().includes(q))return false;
      const active=Number(x.activeDays||0),qualified=Number(x.qualifiedDays||0);
      if(status==="尚未練習"&&active!==0)return false;
      if(status==="單筆未滿20分鐘"&&shortRecords(x).length===0)return false;
      if(status==="已有有效練習"&&qualified===0)return false;
      return true;
    }).sort((a,b)=>{
      const rank=x=>Number(x.activeDays||0)===0?0:Number(x.daysSincePractice||0)>=7?1:Number(x.qualifiedDays||0)===0?2:3;
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
    if(!isTeacher())return "";
    const current=Number(x.feedback?.level||0),comment="",history=x.feedbackHistory||[];
    return `<div class="practice-feedback-box">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><div style="font-weight:900">💛 日常鼓勵｜不計分</div><span class="practice-feedback-chip">本月 ${Number(x.feedbackCount||0)} 次</span></div>
      <small style="display:block;margin:4px 0 10px;color:var(--muted)">此功能為日常互動，可視需要使用，不需每月完成，也不影響任何成績；同一位老師同一天再次送出會更新當日回饋。</small>
      <div class="practice-feedback-options">${practiceFeedbackLevels.map(m=>`<input type="radio" id="pf_${esc(x.studentId)}_${m.level}" name="pf_${esc(x.studentId)}" value="${m.level}" ${current===m.level?"checked":""}><label for="pf_${esc(x.studentId)}_${m.level}"><span>${m.icon}</span><small>${esc(m.label)}</small></label>`).join("")}</div>
      <div class="practice-feedback-presets">${practiceFeedbackPresets.map((t,i)=>`<button type="button" onclick="usePracticeFeedbackPreset('${esc(x.studentId)}',${i})">${esc(t)}</button>`).join("")}</div>
      <label style="margin-top:10px">老師留言（選填）</label>
      <textarea id="pfComment_${esc(x.studentId)}" rows="2" maxlength="120" placeholder="例如：這週練習很穩定，繼續保持！">${esc(comment)}</textarea>
      <button id="pfSave_${esc(x.studentId)}" class="primary" style="margin-top:8px" onclick="savePracticeFeedback('${esc(x.studentId)}')" ${state.practiceFeedbackSaving===String(x.studentId)?"disabled":""}>${state.practiceFeedbackSaving===String(x.studentId)?"⏳ 儲存中…":"💛 儲存鼓勵回饋"}</button>
      ${history.length?`<div class="practice-feedback-history"><b>最近回饋</b>${history.slice(0,3).map(h=>{const m=feedbackLevelMeta(h.level);return `<small>${m?m.icon:"💛"} ${esc(m?.label||"鼓勵")}｜${esc(h.teacherName||"老師")}｜${esc(String(h.updatedAt||"").slice(0,10))}${h.comment?`<br>　${esc(h.comment)}`:""}</small>`}).join("")}</div>`:""}
    </div>`;
  }

  function detailHtml(x){
    if(state.practiceProgressSelected!==String(x.studentId))return "";
    const rows=x.records||[];
    const records=rows.length?`<div style="margin-top:10px">${rows.map(r=>`<div class="item" style="display:block"><div style="display:flex;justify-content:space-between;gap:10px"><b>${esc(r.practiceDate)}｜${r.minutes} 分鐘</b><small>當日累計 ${Number(r.dayMinutes||r.minutes||0)} 分鐘</small><span class="badge ${r.qualified?'ok':'warn'}">${r.qualified?'計入練習日':'練習紀錄'}</span></div>${r.startTime||r.endTime?`<small>${esc(r.startTime||'')}～${esc(r.endTime||'')}</small>`:''}${r.practiceContent?`<small style="margin-top:7px"><b>練習內容：</b>${esc(r.practiceContent)}</small>`:''}${r.focus?`<small><b>練習重點：</b>${esc(r.focus)}</small>`:''}</div>`).join("")}</div>`:`<div class="notice" style="margin-top:10px">本月尚無家長回填的自主練習紀錄。</div>`;
    return `<div class="muted" style="margin-top:10px">${esc(state.practiceProgressMonth)} 完整紀錄｜${rows.length} 筆</div>`+records+feedbackPanel(x);
  }

  const fallbackRatingText={1:"需加強",2:"持續努力",3:"穩定",4:"良好",5:"優異"};
  function teacherEvaluationPage(){
    const now=taipeiMonth(),finalMonth=semesterFinalMonth(now),open=sectionFallbackOpen();
    if(!state.me?.capabilities?.section){
      return `<button class="secondary teacher-eval-back" onclick="go('teacherHome')">← 返回今日教學</button>
        <div class="card hero"><h2>📊 學期末分部評量｜期末 5%</h2><div class="notice"><b>此功能只提供分部老師使用。</b><br>有參加個別課的學生，最後 5% 已由個課老師在每次完課時留下的學生學習表現平均計算，不需其他老師再評。</div></div>`;
    }
    if(!open){
      const label=finalMonth.endsWith("-12")?"12 月":"5 月";
      return `<button class="secondary teacher-eval-back" onclick="go('teacherHome')">← 返回今日教學</button>
        <div class="card hero teacher-eval-hero">
          <div class="section-title"><div><h2>📊 學期末分部評量｜期末 5%</h2><div class="muted">只有「整學期未參加個別課」的學生需要評一次</div></div><span class="badge ok">平時免評</span></div>
          <div class="notice"><b>目前不需要進行評量。</b><br>本學期替代評量將於 <b>${esc(label)}</b> 開放。系統會自動排除已有完成個別課的學生，只留下需要分部老師評量的學生。<br><br>因此老師平時不用做每月正式評量，也不需要對已有個課的學生重複評分。</div>
        </div>`;
    }
    const d=state.teacherSemesterFallback;
    if(state.teacherSemesterFallbackLoading||!d)return `<div class="card"><h2>📊 學期末分部評量</h2><div class="notice">正在整理本學期未參加個課的學生…</div></div>`;
    const eligible=(d.items||[]).filter(x=>x.fallbackEligible),done=eligible.filter(x=>x.myRating),pending=eligible.filter(x=>!x.myRating);
    const filter=state.teacherEvaluationFilter||"pending",list=filter==="done"?done:filter==="all"?eligible:pending;
    if(!list.some(x=>String(x.studentId)===String(state.teacherEvaluationSelected))){
      state.teacherEvaluationSelected=String((list[0]||pending[0]||eligible[0]||{}).studentId||"");
    }
    const current=eligible.find(x=>String(x.studentId)===String(state.teacherEvaluationSelected))||null;
    const pct=eligible.length?Math.round(done.length/eligible.length*100):100;
    const row=x=>{
      const selected=String(x.studentId)===String(state.teacherEvaluationSelected),finished=!!x.myRating,score=Number(x.myRating?.score5||x.score5||0);
      return `<button class="teacher-eval-student-row ${selected?"is-selected":""}" onclick="selectTeacherEvaluationStudent('${esc(x.studentId)}')"><div><b>${finished?"✅":"🟡"} ${esc(x.name)}</b><small>${esc(x.groupName)}團｜${esc(x.section)}｜${esc(x.instrument)}</small></div><span>${finished?score+"/5":"待評"}</span></button>`;
    };
    const currentScore=Number(current?.myRating?.score5||0),comment=String(current?.myRating?.comment||"");
    const currentCard=current?`<div class="card teacher-eval-current">
      <div class="teacher-eval-current-head"><div><b>${esc(current.name)}</b><small>${esc(current.groupName)}團｜${esc(current.section)}｜${esc(current.instrument)}｜${esc(current.grade)}</small></div><span class="badge ${current.myRating?"ok":"warn"}">${current.myRating?"我的評量已完成":"待我評量"}</span></div>
      <div class="notice" style="margin-top:10px"><b>目前本學期尚無完成個別課。</b><br>因此列入分部老師學期末替代評量；若後續又完成個課，系統會自動改採個課次數規則，不重複計分。請依本學期整體課堂學習表現評定 1～5 級。</div>
      <label>學期末學習表現</label>
      <select id="semesterFallbackScore_${esc(current.studentId)}"><option value="">請選擇 1～5 級</option>${[1,2,3,4,5].map(n=>`<option value="${n}" ${currentScore===n?"selected":""}>${n}｜${fallbackRatingText[n]}</option>`).join("")}</select>
      <label>評量備註（選填）</label><textarea id="semesterFallbackComment_${esc(current.studentId)}" rows="2" maxlength="240" placeholder="例如：本學期音準與節奏穩定，分部課學習態度良好。">${esc(comment)}</textarea>
      <button class="primary" onclick="saveSemesterFallbackEvaluation('${esc(current.studentId)}')">📊 儲存學期末分部評量</button>
    </div>`:`<div class="card"><div class="notice">本學期沒有需要分部老師替代評量的學生。已有個課的學生會由個課學習表現自動計算最後 5%。</div></div>`;
    return `<button class="secondary teacher-eval-back" onclick="go('teacherHome')">← 返回今日教學</button>
      <div class="card hero teacher-eval-hero">
        <div class="section-title"><div><h2>📊 學期末分部評量｜期末 5%</h2><div class="muted">僅評「本學期沒有完成個別課」的學生，每學期一次</div></div><span class="badge ${pending.length?"warn":"ok"}">${done.length}/${eligible.length} 已完成</span></div>
        <div class="teacher-eval-progress"><i style="width:${pct}%"></i></div>
        <div class="notice">已有個課的學生：<b>${Number(d.privateLessonCount||0)} 人</b>，不需在這裡重複評量。<br>需要分部老師替代評量：<b>${eligible.length} 人</b>。儲存後會自動前往下一位待評學生。</div>
      </div>
      <div class="card teacher-eval-list-card">
        <div class="teacher-eval-filters">
          <button class="secondary ${filter==="pending"?"is-active":""}" onclick="changeTeacherEvaluationFilter('pending')">待評量 ${pending.length}</button>
          <button class="secondary ${filter==="done"?"is-active":""}" onclick="changeTeacherEvaluationFilter('done')">已完成 ${done.length}</button>
          <button class="secondary ${filter==="all"?"is-active":""}" onclick="changeTeacherEvaluationFilter('all')">全部 ${eligible.length}</button>
        </div>
        <div class="teacher-eval-student-list">${list.map(row).join("")||'<div class="notice">這個分類目前沒有學生。</div>'}</div>
      </div>
      ${currentCard}`;
  }

  window.selectTeacherEvaluationStudent=function(id){state.teacherEvaluationSelected=String(id||"");render()};
  window.changeTeacherEvaluationFilter=function(v){state.teacherEvaluationFilter=String(v||"pending");state.teacherEvaluationSelected="";render()};

  function csvCell(v){const s=String(v??"");return /[",\r\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s}
  function downloadCsv(filename,rows){
    const content="\uFEFF"+rows.map(r=>r.map(csvCell).join(",")).join("\r\n");
    const blob=new Blob([content],{type:"text/csv;charset=utf-8"});
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }
  window.exportPracticeMonthlySummary=function(){
    const items=filteredItems();
    if(!items.length){toast("目前沒有可匯出的自主練習資料");return}
    const rows=[["月份","學生姓名","年級","團別","分部","樂器","有效練習天數","建議目標天數","練習天數","總分鐘","平均分鐘/日","練習進度"]];
    for(const x of items)rows.push([state.practiceProgressMonth,x.name,x.grade,x.groupName,x.section,x.instrument,x.qualifiedDays,x.targetDays,x.activeDays,x.totalMinutes,x.averageMinutes,`${x.practiceRatePercent}%`]);
    downloadCsv(`${state.practiceProgressMonth}_自主練習月統計.csv`,rows);toast("📥 已匯出自主練習月統計");
  };
  window.exportPracticeMonthlyScore=function(){
    const items=filteredItems();
    if(!items.length){toast("目前沒有可匯出的自主練習分數資料");return}
    const rows=[["月份","學生姓名","年級","團別","分部","樂器","有效練習天數","計分分母天數","系統換算分數(10分)","狀態"]];
    for(const x of items){
      const s=x.monthlyScore||scoreParts(x,state.practiceProgressData);
      rows.push([state.practiceProgressMonth,x.name,x.grade,x.groupName,x.section,x.instrument,s.qualified,s.target,s.total,s.status]);
    }
    downloadCsv(`${state.practiceProgressMonth}_自主練習系統計分_期末10%.csv`,rows);toast("📥 已匯出自主練習系統計分");
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
    const counts={
      none:all.filter(x=>Number(x.activeDays||0)===0).length,
      qualified:all.filter(x=>Number(x.qualifiedDays||0)>0).length,
      shortRecords:all.reduce((n,x)=>n+shortRecords(x).length,0),
      shortStudents:all.filter(x=>shortRecords(x).length>0).length,
      shortDays:all.reduce((n,x)=>n+Math.max(0,Number(x.activeDays||0)-Number(x.qualifiedDays||0)),0)
    };
    const now=taipeiMonth(),[year,monthNumber]=now.split("-").map(Number),lastMonth=new Date(Date.UTC(year,monthNumber-2,1)).toISOString().slice(0,7);
    const monthShort=month=>`${Number(month.slice(0,4))} 年 ${Number(month.slice(5))} 月`;
    const filterBtn=(key,label,count)=>`<button class="secondary" style="width:100%;min-width:0;padding:9px 8px;margin:0;font-weight:800;white-space:normal;line-height:1.35;min-height:52px;${state.practiceProgressStatus===key?'background:#eef2ff;border-width:2px':''}" onclick="changePracticeProgressStatus('${key}')">${label}${count==null?'':' '+count}</button>`;
    const rows=items.map(x=>{const active=Number(x.activeDays||0),qualified=Number(x.qualifiedDays||0),short=shortRecords(x).length,status=active===0?'⚪ 本月尚無紀錄':qualified===0?'🟠 已有紀錄，尚無有效練習日':'🟢 已累積 '+qualified+' 個有效練習日',fb=feedbackLevelMeta(x.feedback?.level),fbText=fb?`<span class="practice-feedback-chip">💛 本月 ${Number(x.feedbackCount||0)} 次｜${fb.icon} ${esc(fb.label)}</span>`:"",ms=x.monthlyScore||scoreParts(x,d),scoreText=`<span class="monthly-score-chip">🎯 自主 ${esc(ms.status)} ${ms.total}/10｜有效 ${ms.qualified} 天／${ms.current?'截至今日':'當月'}分母 ${ms.target} 天</span>`;return `<div class="item" style="align-items:center"><div style="min-width:0"><b>${esc(x.name)} <span style="font-size:13px">${status}</span></b><small>${esc(x.groupName)}團｜${esc(x.section)}｜${esc(x.instrument)}<br>已記錄 ${active} 天｜達 20 分鐘 ${qualified} 天${short?`｜單筆未滿 20 分鐘 ${short} 筆`:''}｜累計 ${Number(x.totalMinutes||0)} 分鐘｜最近 ${esc(x.lastPracticeDate||'尚無紀錄')}${x.lastPracticeDate&&x.daysSincePractice!=null?`｜距今 ${Number(x.daysSincePractice)} 天`:''}</small>${scoreText}${fbText}</div><button class="secondary" style="width:auto;padding:7px 10px;margin:0" onclick="togglePracticeProgressDetail('${esc(x.studentId)}')">›</button></div>${detailHtml(x)}`}).join("");
    return `${!isAdmin()?'<button class="secondary" style="width:auto;margin:0 0 12px;padding:9px 14px;border-radius:999px;font-weight:800" onclick="go(\'teacherHome\')">← 返回今日教學</button>':''}
    <div class="card hero"><h2>📚 自主練習${isAdmin()?'月報':'進度'}</h2>
      <div class="notice">此頁只用來查看自主練習進度與提供日常鼓勵；<b>老師不需要在這裡做正式成績評量。</b></div>
      <div class="monthly-score-policy"><b>🎯 自主練習｜期末 10%｜系統自動計分</b><small>單日累計 ≥ ${d.qualifiedMinutes||20} 分鐘計 1 個有效練習日；月分數＝有效練習天數 ÷ 計分分母天數 × 10，最高 10 分。當月尚未結束時，以已過天數暫估，分數會隨日期變動；月底才依完整月份目標天數結算。資料來自已登錄的練習紀錄，老師不需另外評分。9 月為試營運，正式計分自 10 月起。</small></div>
      <div class="monthly-score-policy" style="margin-top:8px"><b>🎻 學習表現｜期末 5%</b><small>有完成個別課的學生，由系統依完成次數自動換算：每月 4 次 = 5 分，上學期 10～12 月取學期平均；整學期沒有完成個課的學生，才由分部老師在學期末評量一次。</small></div>
      <label>月份</label>${isTeacher()?`<div class="row2" style="margin-bottom:8px"><button class="secondary" type="button" style="margin:0" onclick="changePracticeProgressMonth('${now}')" ${state.practiceProgressMonth===now?'disabled':''}>本月｜${monthShort(now)}</button><button class="secondary" type="button" style="margin:0" onclick="changePracticeProgressMonth('${lastMonth}')" ${state.practiceProgressMonth===lastMonth?'disabled':''}>上月｜${monthShort(lastMonth)}</button></div><small style="display:block;margin-bottom:8px;color:var(--muted)">切到上月並展開學生，可查看該月全部練習日期、時間與內容，作為日常鼓勵參考。</small>`:''}<input type="month" value="${esc(state.practiceProgressMonth)}" onchange="changePracticeProgressMonth(this.value)">
      <div class="grid"><div class="kpi"><b>${all.length}</b><span>授課學生</span></div><div class="kpi"><b>${all.length-counts.none}</b><span>本月有紀錄（人）</span></div><div class="kpi"><b>${counts.qualified}</b><span>至少 1 天達 20 分鐘（人）</span></div><div class="kpi"><b>${counts.none}</b><span>本月尚無紀錄（人）</span></div></div>
      <div class="muted" style="margin-top:8px;font-size:12px">單筆未滿 ${d.qualifiedMinutes||20} 分鐘：<b>${counts.shortRecords} 筆</b>，涉及 <b>${counts.shortStudents} 位學生</b>；其中按每日累計仍未達標共 ${counts.shortDays} 天。同一天多筆紀錄可合計達標。</div>
      <div style="margin-top:10px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px">${filterBtn('全部','全部',all.length)}${filterBtn('尚未練習','⚪ 本月尚無紀錄',counts.none)}${filterBtn('單筆未滿20分鐘','🟠 單筆未滿 20 分鐘',counts.shortRecords+' 筆／'+counts.shortStudents+' 人')}${filterBtn('已有有效練習','🟢 已有有效練習日',counts.qualified)}</div>
      <div class="row2"><div><label>團別</label><select onchange="changePracticeProgressGroup(this.value)">${groups.map(g=>`<option value="${esc(g)}" ${g===state.practiceProgressGroup?'selected':''}>${esc(g==='全部'?'全部團別':g+'團')}</option>`).join('')}</select></div><div><label>分部</label><select onchange="changePracticeProgressSection(this.value)">${sections.map(v=>`<option value="${esc(v)}" ${v===state.practiceProgressSection?'selected':''}>${esc(v)}</option>`).join('')}</select></div></div>
      <label>搜尋學生</label><input value="${esc(state.practiceProgressSearch)}" placeholder="姓名／團別／分部／樂器" oninput="changePracticeProgressSearch(this.value)">
      <button class="secondary" style="width:100%;margin-top:10px" onclick="exportPracticeMonthlyScore()">📥 匯出自主練習系統計分 CSV（期末 10%）</button>${isAdmin()?'<button class="secondary" style="width:100%;margin-top:8px" onclick="exportPracticeMonthlySummary()">📥 匯出練習統計 CSV</button>':''}
    </div>
    <div class="card"><h2>學生列表 <span class="muted" style="font-size:14px">${items.length} 人</span></h2>${rows||'<div class="notice">目前沒有符合條件的學生。</div>'}</div>`;
  }

  window.saveSemesterFallbackEvaluation=async function(studentId){
    if(!isTeacher()||!state.me?.capabilities?.section)return;
    const score5=Number(document.getElementById("semesterFallbackScore_"+studentId)?.value||0),comment=document.getElementById("semesterFallbackComment_"+studentId)?.value?.trim()||"";
    if(!score5){toast("請先選擇 1～5 級學期末學習表現");return}
    const month=semesterFinalMonth(taipeiMonth());
    try{
      await api("/api/learning-monthly-evaluation",{method:"POST",body:JSON.stringify({mode:"semesterFallback",studentId,month,score5,comment})});
      await loadSemesterFallback();
      const eligible=(state.teacherSemesterFallback?.items||[]).filter(x=>x.fallbackEligible),pending=eligible.filter(x=>!x.myRating);
      state.teacherEvaluationFilter=pending.length?"pending":"done";
      state.teacherEvaluationSelected=String((pending[0]||{}).studentId||"");
      toast(pending.length?`✅ 已儲存，下一位待評：${pending[0].name}`:"✅ 本學期需要替代評量的學生已全部完成");
      render();
    }catch(e){toast("❌ "+e.message)}
  };

  window.usePracticeFeedbackPreset=function(studentId,index){
    const el=document.getElementById("pfComment_"+studentId),text=practiceFeedbackPresets[Number(index)]||"";
    if(el){el.value=text;el.focus()}
  };
  window.savePracticeFeedback=async function(studentId){
    if(!isTeacher()||state.practiceFeedbackSaving)return;
    const selected=document.querySelector(`input[name="pf_${CSS.escape(String(studentId))}"]:checked`);
    if(!selected){toast("請先選擇一個鼓勵圖示");return}
    const comment=document.getElementById("pfComment_"+studentId)?.value?.trim()||"";
    state.practiceFeedbackSaving=String(studentId);render();
    try{
      await api("/api/practice-feedback",{method:"POST",body:JSON.stringify({studentId,month:state.practiceProgressMonth,level:Number(selected.value),comment})});
      await loadPracticeProgress();
      toast("💛 已送出老師鼓勵回饋");
    }catch(e){toast("❌ "+e.message)}
    finally{state.practiceFeedbackSaving="";render()}
  };
  window.changePracticeProgressStatus=function(v){state.practiceProgressStatus=String(v||"全部");state.practiceProgressSelected="";render()};
  window.changePracticeProgressMonth=async function(v){
    const old=state.practiceProgressMonth,oldData=state.practiceProgressData,requested=String(v||taipeiMonth());
    state.practiceProgressMonth=requested;state.practiceProgressSelected="";state.practiceProgressData=null;render();
    try{await loadPracticeProgress();if(state.practiceProgressMonth===requested)render()}
    catch(e){if(state.practiceProgressMonth===requested){state.practiceProgressMonth=old;state.practiceProgressData=oldData;toast('❌ '+e.message);render()}}
  };
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
    if(p==='teacherEvaluation'&&isTeacher()){
      state.page='teacherEvaluation';state.teacherEvaluationFilter='pending';state.teacherEvaluationSelected='';
      try{await loadSemesterFallback()}catch(e){toast('❌ '+e.message)}
      const eligible=(state.teacherSemesterFallback?.items||[]).filter(x=>x.fallbackEligible),pending=eligible.filter(x=>!x.myRating);
      state.teacherEvaluationSelected=String((pending[0]||eligible[0]||{}).studentId||'');
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
    if(state.page==='teacherEvaluation'&&isTeacher()){
      document.getElementById('app').innerHTML=shell(teacherEvaluationPage());
      return;
    }
    return previousRender();
  };
})();
