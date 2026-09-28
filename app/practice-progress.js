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
  state.teacherEvaluationFilter=state.teacherEvaluationFilter||"pending";
  state.teacherEvaluationSelected=state.teacherEvaluationSelected||"";
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
    const month=encodeURIComponent(state.practiceProgressMonth);
    const [progress,feedback,learning]=await Promise.all([
      api(`/api/practice-progress?month=${month}`),
      api(`/api/practice-feedback?month=${month}`).catch(()=>({items:[]})),
      api(`/api/learning-monthly-evaluation?month=${month}`).catch(()=>({items:[]}))
    ]);
    const feedbackMap=new Map();
    for(const x of (feedback.items||[])){const id=String(x.studentId),arr=feedbackMap.get(id)||[];arr.push(x);feedbackMap.set(id,arr)}
    const learningMap=new Map((learning.items||[]).map(x=>[String(x.studentId),x]));
    progress.items=(progress.items||[]).map(x=>{
      const history=(feedbackMap.get(String(x.studentId))||[]).sort((a,b)=>String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")));
      const learningEvaluation=learningMap.get(String(x.studentId))||null;
      const item={...x,feedback:history[0]||null,feedbackCount:history.length,feedbackHistory:history.slice(0,5),learningEvaluation};
      item.monthlyScore=scoreParts(item,progress);
      return item;
    });
    state.practiceProgressData=progress;
  }

  function hasMyLearningRating(x){
    if(isTeacher())return !!x.learningEvaluation?.myRating;
    return Number(x.learningEvaluation?.score5||0)>0;
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
      if(status==="待正式評量"&&hasMyLearningRating(x))return false;
      if(status==="已正式評量"&&!hasMyLearningRating(x))return false;
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

  const learningCriteria=[
    {key:"attitude",label:"學習態度",weight:1,desc:"專注、主動參與與接受指導"},
    {key:"preparation",label:"課堂準備",weight:1,desc:"樂器、教材與指定內容準備"},
    {key:"progress",label:"技巧／曲目進步",weight:2,desc:"音準、節奏、技巧與曲目進步"},
    {key:"teamwork",label:"團體配合",weight:1,desc:"合奏合作、聆聽與團隊配合"}
  ];
  function learningScoreText(x){
    const e=x.learningEvaluation||{},score=Number(e.score5||0);
    return score>0?`${score.toFixed(2).replace(/\.00$/,"")}/5`:"待老師評量";
  }
  function learningEvaluationPanel(x){
    const e=x.learningEvaluation||{},mine=e.myRating||null,trial=/^\d{4}-09$/.test(String(state.practiceProgressMonth||""));
    if(!isTeacher()){
      const a=e.average||{};
      return `<div class="monthly-score-box learning-score-box">
        <div class="monthly-score-title"><b>📊 月底正式評量｜期末 5%</b><span class="practice-feedback-chip">${learningScoreText(x)}${trial?"｜9月試評":""}</span></div>
        <div class="monthly-score-formula">學習態度 ${a.attitude??"—"}/5｜課堂準備 ${a.preparation??"—"}/5｜技巧／曲目進步 ${a.progress??"—"}/5（×2）｜團體配合 ${a.teamwork??"—"}/5</div>
        <small style="display:block;margin-top:7px;color:var(--muted)">這是老師每月唯一需要完成的正式評量。統一權重：1＋1＋2＋1＝5 分；多位授課老師評量時取平均。個別課只作學習佐證，不直接計分。</small>
      </div>`;
    }
    const current=key=>Number(mine?.[key]||0),comment=String(mine?.comment||"");
    const options=learningCriteria.map(m=>`<div class="learning-rubric-row"><div><b>${m.label}｜${m.weight} 分</b><small>${m.desc}</small></div><select id="lm_${m.key}_${esc(x.studentId)}"><option value="">請評分</option>${[1,2,3,4,5].map(n=>`<option value="${n}" ${current(m.key)===n?"selected":""}>${n} / 5</option>`).join("")}</select></div>`).join("");
    return `<div class="monthly-score-box learning-score-box">
      <div class="monthly-score-title"><b>📊 月底正式評量｜期末 5%</b><span class="practice-feedback-chip">${learningScoreText(x)}${trial?"｜9月試評":""}</span></div>
      <small style="display:block;margin:5px 0 9px;color:var(--muted)">每位學生每月只需完成這一個正式老師評量：學習態度 1 分、課堂準備 1 分、技巧／曲目進步 2 分、團體配合 1 分。多位老師取平均；9 月僅試評，正式成績自 10 月起。</small>
      <div class="learning-rubric-list">${options}</div>
      <label style="margin-top:10px">學習評量備註（選填）</label>
      <textarea id="lm_comment_${esc(x.studentId)}" rows="2" maxlength="240" placeholder="例如：本月音準與節奏較穩定，合奏配合度持續進步。">${esc(comment)}</textarea>
      <button class="secondary" style="width:100%;margin-top:8px" onclick="saveLearningMonthlyEvaluation('${esc(x.studentId)}')">📊 儲存月底正式評量</button>
      ${e.ratings?.length?`<details class="monthly-rating-history"><summary>查看本月授課老師評量（${e.ratings.length}）</summary>${e.ratings.map(r=>`<div><b>${esc(r.teacherName||"老師")}｜${Number(r.score5||0).toFixed(2)}/5</b><small>態度 ${r.attitude}/5｜準備 ${r.preparation}/5｜進步 ${r.progress}/5｜配合 ${r.teamwork}/5</small>${r.comment?`<small>${esc(r.comment)}</small>`:""}</div>`).join("")}</details>`:""}
    </div>`;
  }
  function detailHtml(x){
    if(state.practiceProgressSelected!==String(x.studentId))return "";
    const rows=isAdmin()?(x.records||[]):(x.recent||[]);
    const records=rows.length?`<div style="margin-top:10px">${rows.map(r=>`<div class="item" style="display:block"><div style="display:flex;justify-content:space-between;gap:10px"><b>${esc(r.practiceDate)}｜${r.minutes} 分鐘</b><span class="badge ${r.qualified?'ok':'warn'}">${r.qualified?'計入練習日':'練習紀錄'}</span></div>${r.startTime||r.endTime?`<small>${esc(r.startTime||'')}～${esc(r.endTime||'')}</small>`:''}${r.practiceContent?`<small style="margin-top:7px"><b>練習內容：</b>${esc(r.practiceContent)}</small>`:''}${r.focus?`<small><b>練習重點：</b>${esc(r.focus)}</small>`:''}</div>`).join("")}</div>`:`<div class="notice" style="margin-top:10px">本月尚無家長回填的自主練習紀錄。</div>`;
    return records+feedbackPanel(x)+learningEvaluationPanel(x);
  }

  function teacherEvaluationPage(){
    const d=state.practiceProgressData;
    if(!d)return `<div class="card"><h2>📊 月底正式評量</h2><div class="notice">正在讀取學生資料…</div></div>`;
    const all=(d.items||[]),done=all.filter(hasMyLearningRating),pending=all.filter(x=>!hasMyLearningRating(x));
    const filter=state.teacherEvaluationFilter||"pending";
    const list=filter==="done"?done:filter==="all"?all:pending;
    if(!list.some(x=>String(x.studentId)===String(state.teacherEvaluationSelected))){
      state.teacherEvaluationSelected=String((list[0]||pending[0]||all[0]||{}).studentId||"");
    }
    const current=all.find(x=>String(x.studentId)===String(state.teacherEvaluationSelected))||null;
    const pct=all.length?Math.round(done.length/all.length*100):100;
    const month=String(state.practiceProgressMonth||""),trial=/^\d{4}-09$/.test(month);
    const row=x=>{
      const selected=String(x.studentId)===String(state.teacherEvaluationSelected),finished=hasMyLearningRating(x),score=Number(x.learningEvaluation?.score5||0);
      return `<button class="teacher-eval-student-row ${selected?"is-selected":""}" onclick="selectTeacherEvaluationStudent('${esc(x.studentId)}')">
        <div><b>${finished?"✅":"🟡"} ${esc(x.name)}</b><small>${esc(x.groupName)}團｜${esc(x.section)}｜${esc(x.instrument)}</small></div>
        <span>${finished?(score?score+"/5":"已完成"):"待評"}</span>
      </button>`;
    };
    const context=current?(()=>{
      const ms=current.monthlyScore||scoreParts(current,d),fb=feedbackLevelMeta(current.feedback?.level);
      return `<div class="teacher-eval-context">
        <div><b>${ms.qualified} / ${ms.target} 天</b><small>自主練習｜系統 ${ms.total}/10</small></div>
        <div><b>${current.lastPracticeDate?esc(current.lastPracticeDate):"尚無紀錄"}</b><small>最近一次自主練習</small></div>
        <div><b>${fb?fb.icon+" "+esc(fb.label):"尚無鼓勵"}</b><small>最近日常鼓勵｜不計分</small></div>
      </div>`;
    })():"";
    const currentCard=current?`<div class="card teacher-eval-current">
      <div class="teacher-eval-current-head"><div><b>${esc(current.name)}</b><small>${esc(current.groupName)}團｜${esc(current.section)}｜${esc(current.instrument)}｜${esc(current.grade)}</small></div><span class="badge ${hasMyLearningRating(current)?"ok":"warn"}">${hasMyLearningRating(current)?"我的評量已完成":"待我評量"}</span></div>
      ${context}
      <div class="notice" style="margin-top:10px">上方資料只供老師快速參考；本次正式評量仍請依孩子本月實際課堂表現判斷。個別課可作佐證，但沒有上個別課不會扣分。</div>
      ${learningEvaluationPanel(current)}
    </div>`:`<div class="card"><div class="notice">目前沒有需要評量的學生。</div></div>`;
    return `<button class="secondary teacher-eval-back" onclick="go('teacherHome')">← 返回今日教學</button>
      <div class="card hero teacher-eval-hero">
        <div class="section-title"><div><h2>📊 月底正式評量｜期末 5%</h2><div class="muted">老師每月唯一需要完成的正式評分</div></div><span class="badge ${pending.length?"warn":"ok"}">${done.length}/${all.length} 已完成</span></div>
        <div class="teacher-eval-progress"><i style="width:${pct}%"></i></div>
        <div class="notice">${trial?"9 月為試營運／試評，不列入正式成績。":"正式計分月份；完成後會自動切到下一位待評學生。"}<br>評量內容：學習態度 1 分＋課堂準備 1 分＋技巧／曲目進步 2 分＋團體配合 1 分。</div>
        <label>評量月份</label><input type="month" value="${esc(month)}" onchange="changeTeacherEvaluationMonth(this.value)">
      </div>
      <div class="card teacher-eval-list-card">
        <div class="teacher-eval-filters">
          <button class="secondary ${filter==="pending"?"is-active":""}" onclick="changeTeacherEvaluationFilter('pending')">待評量 ${pending.length}</button>
          <button class="secondary ${filter==="done"?"is-active":""}" onclick="changeTeacherEvaluationFilter('done')">已完成 ${done.length}</button>
          <button class="secondary ${filter==="all"?"is-active":""}" onclick="changeTeacherEvaluationFilter('all')">全部 ${all.length}</button>
        </div>
        <div class="teacher-eval-student-list">${list.map(row).join("")||'<div class="notice">這個分類目前沒有學生。</div>'}</div>
      </div>
      ${currentCard}`;
  }

  window.selectTeacherEvaluationStudent=function(id){state.teacherEvaluationSelected=String(id||"");render()};
  window.changeTeacherEvaluationFilter=function(v){state.teacherEvaluationFilter=String(v||"pending");state.teacherEvaluationSelected="";render()};
  window.changeTeacherEvaluationMonth=async function(v){
    state.practiceProgressMonth=String(v||new Date().toISOString().slice(0,7));
    state.teacherEvaluationSelected="";
    try{await loadPracticeProgress();render()}catch(e){toast("❌ "+e.message)}
  };

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
    const rows=[["月份","學生姓名","年級","團別","分部","樂器","有效練習天數","當月目標天數","系統換算分數(10分)","狀態"]];
    for(const x of items){
      const s=x.monthlyScore||scoreParts(x,state.practiceProgressData);
      rows.push([state.practiceProgressMonth,x.name,x.grade,x.groupName,x.section,x.instrument,s.qualified,s.target,s.total,s.status]);
    }
    downloadCsv(`${state.practiceProgressMonth}_自主練習系統計分_期末10%.csv`,rows);toast("📥 已匯出自主練習系統計分");
  };
  window.exportLearningMonthlyScore=function(){
    const items=filteredItems();
    if(!items.length){toast("目前沒有可匯出的學習評量資料");return}
    const rows=[["月份","學生姓名","年級","團別","分部","樂器","學習態度(1)","課堂準備(1)","技巧／曲目進步(2)","團體配合(1)","授課老師數","月分數(5)","狀態"]];
    for(const x of items){
      const e=x.learningEvaluation||{},a=e.average||{},trial=/^\d{4}-09$/.test(String(state.practiceProgressMonth||""));
      rows.push([state.practiceProgressMonth,x.name,x.grade,x.groupName,x.section,x.instrument,a.attitude||"",a.preparation||"",a.progress||"",a.teamwork||"",Number(e.ratingCount||0),e.score5||"",trial?"試營運／不列正式成績":(e.score5?"已評量":"待評量")]);
    }
    downloadCsv(`${state.practiceProgressMonth}_月底正式評量_期末5%.csv`,rows);toast("📥 已匯出月底正式評量");
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
    const counts={none:all.filter(x=>Number(x.activeDays||0)===0).length,below:all.filter(x=>Number(x.activeDays||0)>0&&Number(x.practiceRatePercent||0)<80).length,ok:all.filter(x=>Number(x.practiceRatePercent||0)>=80).length,pendingEval:all.filter(x=>!hasMyLearningRating(x)).length,doneEval:all.filter(x=>hasMyLearningRating(x)).length};
    const filterBtn=(key,label,count)=>`<button class="secondary" style="width:100%;min-width:0;padding:9px 8px;margin:0;font-weight:800;white-space:nowrap;${state.practiceProgressStatus===key?'background:#eef2ff;border-width:2px':''}" onclick="changePracticeProgressStatus('${key}')">${label}${count==null?'':' '+count}</button>`;
    const rows=items.map(x=>{const active=Number(x.activeDays||0),rate=Number(x.practiceRatePercent||0),gap=x.daysSincePractice==null?999:Number(x.daysSincePractice),status=active===0?'⚪ 本月尚無紀錄':gap>=7?`🟡 距上次練習 ${gap} 天`:gap>=3?`🟡 距上次練習 ${gap} 天`:rate<80?'🟡 持續累積中':'🟢 本月練習目標已完成',fb=feedbackLevelMeta(x.feedback?.level),fbText=fb?`<span class="practice-feedback-chip">💛 本月 ${Number(x.feedbackCount||0)} 次｜${fb.icon} ${esc(fb.label)}</span>`:"",ms=x.monthlyScore||scoreParts(x,d),learn=Number(x.learningEvaluation?.score5||0),myDone=hasMyLearningRating(x),scoreText=`<span class="monthly-score-chip">🎯 自主 ${ms.total}/10｜系統計算｜${esc(ms.status)}</span><span class="practice-feedback-chip">📊 ${myDone?"我的評量已完成":"待我評量"}${learn>0?"｜平均 "+learn+"/5":""}</span>`;return `<div class="item" style="align-items:center"><div style="min-width:0"><b>${esc(x.name)} <span style="font-size:13px">${status}</span></b><small>${esc(x.groupName)}團｜${esc(x.section)}｜${esc(x.instrument)}<br>${active} 天｜${Number(x.totalMinutes||0)} 分鐘｜最近 ${esc(x.lastPracticeDate||'尚無紀錄')}${x.lastPracticeDate&&x.daysSincePractice!=null?`｜距今 ${Number(x.daysSincePractice)} 天`:''}</small>${scoreText}${fbText}</div><button class="secondary" style="width:auto;padding:7px 10px;margin:0" onclick="togglePracticeProgressDetail('${esc(x.studentId)}')">›</button></div>${detailHtml(x)}`}).join("");
    return `${!isAdmin()?'<button class="secondary" style="width:auto;margin:0 0 12px;padding:9px 14px;border-radius:999px;font-weight:800" onclick="go(\'teacherHome\')">← 返回今日教學</button>':''}
    <div class="card hero"><h2>📚 自主練習${isAdmin()?'月報':'進度'}</h2>
      <div class="notice">練習進度依「截至目前日期」動態計算；主要用來了解孩子的練習習慣並提供適度提醒。</div>
      <div class="monthly-score-policy"><b>🎯 自主練習｜期末 10%｜系統自動計分</b><small>單日累計 ≥ ${d.qualifiedMinutes||15} 分鐘計 1 個有效練習日；月分數＝有效練習天數 ÷ 當月目標天數 × 10，最高 10 分。老師不需另外評分。9 月為試營運，正式計分自 10 月起。</small></div>
      <div class="monthly-score-policy" style="margin-top:8px"><b>📊 月底正式評量｜期末 5%</b><small>統一四項量尺：學習態度 1 分＋課堂準備 1 分＋技巧／曲目進步 2 分＋團體配合 1 分。多位授課老師取平均。個別課只作學習佐證，不因未參加個別課而扣分。</small></div>
      <label>月份</label><input type="month" value="${esc(state.practiceProgressMonth)}" onchange="changePracticeProgressMonth(this.value)">
      <div class="grid"><div class="kpi"><b>${all.length}</b><span>授課學生</span></div><div class="kpi"><b>${counts.doneEval}</b><span>已完成正式評量</span></div><div class="kpi"><b>${counts.pendingEval}</b><span>待正式評量</span></div><div class="kpi"><b>${all.length-counts.none}</b><span>已有練習</span></div></div>
      <div style="margin-top:10px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px">${filterBtn('全部','全部',all.length)}${filterBtn('待正式評量','📊 待正式評量',counts.pendingEval)}${filterBtn('已正式評量','✅ 已完成正式評量',counts.doneEval)}${filterBtn('尚未練習','⚪ 本月尚無紀錄',counts.none)}${filterBtn('未達標','🟡 持續累積中',counts.below)}${filterBtn('已達標','🟢 已完成目標',counts.ok)}</div>
      <div class="row2"><div><label>團別</label><select onchange="changePracticeProgressGroup(this.value)">${groups.map(g=>`<option value="${esc(g)}" ${g===state.practiceProgressGroup?'selected':''}>${esc(g==='全部'?'全部團別':g+'團')}</option>`).join('')}</select></div><div><label>分部</label><select onchange="changePracticeProgressSection(this.value)">${sections.map(v=>`<option value="${esc(v)}" ${v===state.practiceProgressSection?'selected':''}>${esc(v)}</option>`).join('')}</select></div></div>
      <label>搜尋學生</label><input value="${esc(state.practiceProgressSearch)}" placeholder="姓名／團別／分部／樂器" oninput="changePracticeProgressSearch(this.value)">
      <button class="secondary" style="width:100%;margin-top:10px" onclick="exportPracticeMonthlyScore()">📥 匯出自主練習系統計分 CSV（期末 10%）</button><button class="secondary" style="width:100%;margin-top:8px" onclick="exportLearningMonthlyScore()">📥 匯出月底正式評量 CSV（期末 5%）</button>${isAdmin()?'<button class="secondary" style="width:100%;margin-top:8px" onclick="exportPracticeMonthlySummary()">📥 匯出練習統計 CSV</button>':''}
    </div>
    <div class="card"><h2>學生列表 <span class="muted" style="font-size:14px">${items.length} 人</span></h2>${rows||'<div class="notice">目前沒有符合條件的學生。</div>'}</div>`;
  }

  window.saveLearningMonthlyEvaluation=async function(studentId){
    if(!isTeacher())return;
    const value=key=>Number(document.getElementById(`lm_${key}_${studentId}`)?.value||0);
    const payload={
      studentId,month:state.practiceProgressMonth,
      attitude:value("attitude"),preparation:value("preparation"),progress:value("progress"),teamwork:value("teamwork"),
      comment:document.getElementById("lm_comment_"+studentId)?.value?.trim()||""
    };
    if(!payload.attitude||!payload.preparation||!payload.progress||!payload.teamwork){toast("請完成四項學習評量");return}
    try{
      await api("/api/learning-monthly-evaluation",{method:"POST",body:JSON.stringify(payload)});
      await loadPracticeProgress();
      if(state.page==="teacherEvaluation"){
        const pending=(state.practiceProgressData?.items||[]).filter(x=>!hasMyLearningRating(x));
        state.teacherEvaluationFilter=pending.length?"pending":"done";
        state.teacherEvaluationSelected=String((pending[0]||{}).studentId||"");
        toast(pending.length?`✅ 已儲存，下一位待評：${pending[0].name}`:"✅ 本月正式評量已全部完成");
      }else toast("✅ 已儲存月底正式評量");
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
    if(p==='teacherEvaluation'&&isTeacher()){
      state.page='teacherEvaluation';state.teacherEvaluationFilter='pending';state.teacherEvaluationSelected='';
      try{await loadPracticeProgress()}catch(e){toast('❌ '+e.message)}
      const pending=(state.practiceProgressData?.items||[]).filter(x=>!hasMyLearningRating(x));
      state.teacherEvaluationSelected=String((pending[0]||state.practiceProgressData?.items?.[0]||{}).studentId||'');
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
