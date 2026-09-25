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
  const practiceFeedbackPresets=["這週練習很穩定，繼續保持！","有進步，記得每天練一點點喔！","基本功有累積，繼續加油！","練習很投入，期待下次上課的表現！","很棒！保持規律練習會進步更快。"];
  state.practiceFeedbackSaving=state.practiceFeedbackSaving||"";

  function scoreRound(v){return Math.round(Number(v||0)*100)/100}
  function scoreParts(x,progress){
    const target=Math.max(1,Number(x.effectiveTargetDays||progress?.effectiveTargetDays||1));
    const practiceDays=Number(x.activeDays||0);
    const practicePoints=scoreRound(Math.min(practiceDays/target,1)*7);
    const avg=Number(x.monthlyEvaluation?.averageRating||0);
    const teacherPoints=avg>0?scoreRound(avg/5*3):null;
    const total=teacherPoints==null?null:scoreRound(practicePoints+teacherPoints);
    const current=String(progress?.month||"")===String(progress?.taipeiToday||"").slice(0,7);
    return {practicePoints,teacherPoints,total,target,practiceDays,current,status:teacherPoints==null?"待老師月評":current?"暫估":"正式"};
  }
  async function loadPracticeProgress(){
    if(!canView())return;
    const month=encodeURIComponent(state.practiceProgressMonth);
    const [progress,feedback,evaluation]=await Promise.all([
      api(`/api/practice-progress?month=${month}`),
      api(`/api/practice-feedback?month=${month}`).catch(()=>({items:[]})),
      api(`/api/practice-monthly-evaluation?month=${month}`).catch(()=>({items:[]}))
    ]);
    const feedbackMap=new Map();
    for(const x of (feedback.items||[])){const id=String(x.studentId),arr=feedbackMap.get(id)||[];arr.push(x);feedbackMap.set(id,arr)}
    const evaluationMap=new Map((evaluation.items||[]).map(x=>[String(x.studentId),x]));
    progress.items=(progress.items||[]).map(x=>{
      const history=(feedbackMap.get(String(x.studentId))||[]).sort((a,b)=>String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")));
      const monthlyEvaluation=evaluationMap.get(String(x.studentId))||null;
      const item={...x,feedback:history[0]||null,feedbackCount:history.length,feedbackHistory:history.slice(0,5),monthlyEvaluation};
      item.monthlyScore=scoreParts(item,progress);
      return item;
    });
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
      if(status==="待月評"&&x.monthlyScore?.total!=null)return false;
      if(status==="已月評"&&x.monthlyScore?.total==null)return false;
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
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><div style="font-weight:900">💬 老師鼓勵回饋</div><span class="practice-feedback-chip">本月 ${Number(x.feedbackCount||0)} 次</span></div>
      <small style="display:block;margin:4px 0 10px;color:var(--muted)">可多次鼓勵；同一位老師同一天再次送出會更新當日回饋，不重複計次。</small>
      <div class="practice-feedback-options">${practiceFeedbackLevels.map(m=>`<input type="radio" id="pf_${esc(x.studentId)}_${m.level}" name="pf_${esc(x.studentId)}" value="${m.level}" ${current===m.level?"checked":""}><label for="pf_${esc(x.studentId)}_${m.level}"><span>${m.icon}</span><small>${esc(m.label)}</small></label>`).join("")}</div>
      <div class="practice-feedback-presets">${practiceFeedbackPresets.map((t,i)=>`<button type="button" onclick="usePracticeFeedbackPreset('${esc(x.studentId)}',${i})">${esc(t)}</button>`).join("")}</div>
      <label style="margin-top:10px">老師留言（選填）</label>
      <textarea id="pfComment_${esc(x.studentId)}" rows="2" maxlength="120" placeholder="例如：這週練習很穩定，繼續保持！">${esc(comment)}</textarea>
      <button id="pfSave_${esc(x.studentId)}" class="primary" style="margin-top:8px" onclick="savePracticeFeedback('${esc(x.studentId)}')" ${state.practiceFeedbackSaving===String(x.studentId)?"disabled":""}>${state.practiceFeedbackSaving===String(x.studentId)?"⏳ 儲存中…":"💛 儲存鼓勵回饋"}</button>
      ${history.length?`<div class="practice-feedback-history"><b>最近回饋</b>${history.slice(0,3).map(h=>{const m=feedbackLevelMeta(h.level);return `<small>${m?m.icon:"💛"} ${esc(m?.label||"鼓勵")}｜${esc(h.teacherName||"老師")}｜${esc(String(h.updatedAt||"").slice(0,10))}${h.comment?`<br>　${esc(h.comment)}`:""}</small>`}).join("")}</div>`:""}
    </div>`;
  }

  const monthlyRatingMeta=[null,{label:"1｜需加強",desc:"練習投入或準備不足，需要更多提醒"},{label:"2｜持續努力",desc:"已有參與，但穩定度仍可加強"},{label:"3｜穩定",desc:"能維持基本練習與課堂要求"},{label:"4｜良好",desc:"練習投入、準備與進步表現良好"},{label:"5｜優異",desc:"練習積極且能持續展現明顯進步"}];
  function monthlyEvaluationPanel(x){
    const m=x.monthlyEvaluation||{},mine=m.myRating||null,score=x.monthlyScore||scoreParts(x,state.practiceProgressData),avg=Number(m.averageRating||0);
    if(!isTeacher()){
      return `<div class="monthly-score-box"><div class="monthly-score-title"><b>📊 ${esc(state.practiceProgressMonth)} 月評比</b><span class="practice-feedback-chip">${score.total==null?"待評":score.total+"/10"}</span></div><div class="monthly-score-formula">有效練習：${score.qualified}/${score.target} 天 → <b>${score.practicePoints}/7</b>｜老師月評：${avg?avg.toFixed(2)+"/5":"待評"} → <b>${score.teacherPoints==null?"—":score.teacherPoints+"/3"}</b></div>${m.ratings?.length?`<details class="monthly-rating-history"><summary>查看老師月評明細（${m.ratings.length}）</summary>${m.ratings.map(r=>`<div><b>${esc(r.teacherName||"老師")}｜${Number(r.rating||0)}/5</b>${r.comment?`<small>${esc(r.comment)}</small>`:""}</div>`).join("")}</details>`:""}</div>`;
    }
    const current=Number(mine?.rating||0),comment=String(mine?.comment||"");
    return `<div class="monthly-score-box">
      <div class="monthly-score-title"><b>📊 ${esc(state.practiceProgressMonth)} 月總結評比</b><span class="practice-feedback-chip">${score.total==null?"待評":score.total+"/10"}｜${esc(score.status)}</span></div>
      <div class="monthly-score-formula">有效練習 ${score.qualified}/${score.target} 天 → <b>${score.practicePoints}/7</b>　｜　老師平均 ${avg?avg.toFixed(2)+"/5":"待評"} → <b>${score.teacherPoints==null?"—":score.teacherPoints+"/3"}</b></div>
      <small style="display:block;margin:7px 0 8px;color:var(--muted)">請依固定 1～5 級量尺完成本月評比；若有多位授課老師，系統取所有老師月評平均。未完成月評前不產生正式總分。</small>
      <div class="monthly-rating-options">${monthlyRatingMeta.slice(1).map((r,i)=>{const n=i+1;return `<input type="radio" id="mr_${esc(x.studentId)}_${n}" name="mr_${esc(x.studentId)}" value="${n}" ${current===n?"checked":""}><label for="mr_${esc(x.studentId)}_${n}"><b>${esc(r.label)}</b><small>${esc(r.desc)}</small></label>`}).join("")}</div>
      <label style="margin-top:10px">月評備註（選填）</label>
      <textarea id="mrComment_${esc(x.studentId)}" rows="2" maxlength="200" placeholder="例如：本月規律練習，音準與節奏穩定度有進步。">${esc(comment)}</textarea>
      <button class="secondary" style="width:100%;margin-top:8px" onclick="savePracticeMonthlyEvaluation('${esc(x.studentId)}')">📊 儲存本月老師評比</button>
      ${m.ratings?.length?`<details class="monthly-rating-history"><summary>查看本月老師評比明細（${m.ratings.length}）</summary>${m.ratings.map(r=>`<div><b>${esc(r.teacherName||"老師")}｜${Number(r.rating||0)}/5</b>${r.comment?`<small>${esc(r.comment)}</small>`:""}</div>`).join("")}</details>`:""}
    </div>`;
  }
  function detailHtml(x){
    if(state.practiceProgressSelected!==String(x.studentId))return "";
    const rows=isAdmin()?(x.records||[]):(x.recent||[]);
    const records=rows.length?`<div style="margin-top:10px">${rows.map(r=>`<div class="item" style="display:block"><div style="display:flex;justify-content:space-between;gap:10px"><b>${esc(r.practiceDate)}｜${r.minutes} 分鐘</b><span class="badge ${r.qualified?'ok':'warn'}">${r.qualified?'計入練習日':'練習紀錄'}</span></div>${r.startTime||r.endTime?`<small>${esc(r.startTime||'')}～${esc(r.endTime||'')}</small>`:''}${r.practiceContent?`<small style="margin-top:7px"><b>練習內容：</b>${esc(r.practiceContent)}</small>`:''}${r.focus?`<small><b>練習重點：</b>${esc(r.focus)}</small>`:''}</div>`).join("")}</div>`:`<div class="notice" style="margin-top:10px">本月尚無家長回填的自主練習紀錄。</div>`;
    return records+feedbackPanel(x)+monthlyEvaluationPanel(x);
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
    const rows=[["月份","學生姓名","年級","團別","分部","樂器","有效練習天數","建議目標天數","練習天數","總分鐘","平均分鐘/日","練習進度"]];
    for(const x of items)rows.push([state.practiceProgressMonth,x.name,x.grade,x.groupName,x.section,x.instrument,x.qualifiedDays,x.targetDays,x.activeDays,x.totalMinutes,x.averageMinutes,`${x.practiceRatePercent}%`]);
    downloadCsv(`${state.practiceProgressMonth}_自主練習月統計.csv`,rows);toast("📥 已匯出自主練習月統計");
  };
  window.exportPracticeMonthlyScore=function(){
    const items=filteredItems();
    if(!items.length){toast("目前沒有可匯出的月評比資料");return}
    const rows=[["月份","學生姓名","年級","團別","分部","樂器","有效練習天數","當月目標天數","練習分(7分)","老師評比平均(5級)","參與月評老師數","老師評比明細","老師分(3分)","月總分(10分)","狀態","期末10%換算"]];
    for(const x of items){
      const s=x.monthlyScore||scoreParts(x,state.practiceProgressData),m=x.monthlyEvaluation||{};
      const ratingDetail=(m.ratings||[]).map(r=>`${r.teacherName||"老師"}:${Number(r.rating||0)}/5`).join("；");
      rows.push([state.practiceProgressMonth,x.name,x.grade,x.groupName,x.section,x.instrument,s.qualified,s.target,s.practicePoints,m.averageRating?Number(m.averageRating).toFixed(2):"",Number(m.ratingCount||0),ratingDetail,s.teacherPoints==null?"":s.teacherPoints,s.total==null?"":s.total,s.status,s.total==null?"":s.total]);
    }
    downloadCsv(`${state.practiceProgressMonth}_自主練習月總評比_期末10%.csv`,rows);toast("📥 已匯出自主練習月總評比");
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
    const counts={none:all.filter(x=>Number(x.activeDays||0)===0).length,below:all.filter(x=>Number(x.activeDays||0)>0&&Number(x.practiceRatePercent||0)<80).length,ok:all.filter(x=>Number(x.practiceRatePercent||0)>=80).length,pendingEval:all.filter(x=>x.monthlyScore?.total==null).length,doneEval:all.filter(x=>x.monthlyScore?.total!=null).length};
    const filterBtn=(key,label,count)=>`<button class="secondary" style="width:100%;min-width:0;padding:9px 8px;margin:0;font-weight:800;white-space:nowrap;${state.practiceProgressStatus===key?'background:#eef2ff;border-width:2px':''}" onclick="changePracticeProgressStatus('${key}')">${label}${count==null?'':' '+count}</button>`;
    const rows=items.map(x=>{const active=Number(x.activeDays||0),rate=Number(x.practiceRatePercent||0),gap=x.daysSincePractice==null?999:Number(x.daysSincePractice),status=active===0?'⚪ 本月尚無紀錄':gap>=7?`🟡 距上次練習 ${gap} 天`:gap>=3?`🟡 距上次練習 ${gap} 天`:rate<80?'🟡 持續累積中':'🟢 本月練習目標已完成',fb=feedbackLevelMeta(x.feedback?.level),fbText=fb?`<span class="practice-feedback-chip">💛 本月 ${Number(x.feedbackCount||0)} 次｜${fb.icon} ${esc(fb.label)}</span>`:"",ms=x.monthlyScore||scoreParts(x,d),scoreText=`<span class="monthly-score-chip">${ms.total==null?"📊 待老師月評":`📊 月評 ${ms.total}/10｜${esc(ms.status)}`}</span>`;return `<div class="item" style="align-items:center"><div style="min-width:0"><b>${esc(x.name)} <span style="font-size:13px">${status}</span></b><small>${esc(x.groupName)}團｜${esc(x.section)}｜${esc(x.instrument)}<br>${active} 天｜${Number(x.totalMinutes||0)} 分鐘｜最近 ${esc(x.lastPracticeDate||'尚無紀錄')}${x.lastPracticeDate&&x.daysSincePractice!=null?`｜距今 ${Number(x.daysSincePractice)} 天`:''}</small>${scoreText}${fbText}</div><button class="secondary" style="width:auto;padding:7px 10px;margin:0" onclick="togglePracticeProgressDetail('${esc(x.studentId)}')">›</button></div>${detailHtml(x)}`}).join("");
    return `${!isAdmin()?'<button class="secondary" style="width:auto;margin:0 0 12px;padding:9px 14px;border-radius:999px;font-weight:800" onclick="go(\'teacherHome\')">← 返回今日教學</button>':''}
    <div class="card hero"><h2>📚 自主練習${isAdmin()?'月報':'進度'}</h2>
      <div class="notice">練習進度依「截至目前日期」動態計算；主要用來了解孩子的練習習慣並提供適度提醒。</div>
      <div class="monthly-score-policy"><b>📊 月總評比規則｜期末計分占比 10%</b><small>① 練習日期占 70%（7 分）：每天有完成自主練習紀錄即計 1 天，同一天多筆紀錄仍只計 1 天；分鐘數僅供紀錄，不列入分數。練習分＝min（練習天數 ÷ 當月目標天數，1）× 7。<br>② 老師月評占 30%（3 分）：1～5 級固定量尺；多位授課老師取平均，老師分＝平均級分 ÷ 5 × 3。<br>③ 月總分＝練習分＋老師分，滿分 10 分；未完成老師月評時顯示「待評」，不先以 0 分計算。當月進行中顯示暫估，歷史月份為正式月分。</small></div>
      <label>月份</label><input type="month" value="${esc(state.practiceProgressMonth)}" onchange="changePracticeProgressMonth(this.value)">
      <div class="grid"><div class="kpi"><b>${all.length}</b><span>授課學生</span></div><div class="kpi"><b>${counts.doneEval}</b><span>已完成月評</span></div><div class="kpi"><b>${counts.pendingEval}</b><span>待老師月評</span></div><div class="kpi"><b>${all.length-counts.none}</b><span>已有練習</span></div></div>
      <div style="margin-top:10px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px">${filterBtn('全部','全部',all.length)}${filterBtn('待月評','📊 待老師月評',counts.pendingEval)}${filterBtn('已月評','✅ 已完成月評',counts.doneEval)}${filterBtn('尚未練習','⚪ 本月尚無紀錄',counts.none)}${filterBtn('未達標','🟡 持續累積中',counts.below)}${filterBtn('已達標','🟢 已完成目標',counts.ok)}</div>
      <div class="row2"><div><label>團別</label><select onchange="changePracticeProgressGroup(this.value)">${groups.map(g=>`<option value="${esc(g)}" ${g===state.practiceProgressGroup?'selected':''}>${esc(g==='全部'?'全部團別':g+'團')}</option>`).join('')}</select></div><div><label>分部</label><select onchange="changePracticeProgressSection(this.value)">${sections.map(v=>`<option value="${esc(v)}" ${v===state.practiceProgressSection?'selected':''}>${esc(v)}</option>`).join('')}</select></div></div>
      <label>搜尋學生</label><input value="${esc(state.practiceProgressSearch)}" placeholder="姓名／團別／分部／樂器" oninput="changePracticeProgressSearch(this.value)">
      <button class="secondary" style="width:100%;margin-top:10px" onclick="exportPracticeMonthlyScore()">📥 匯出月總評比 CSV（期末 10%）</button>${isAdmin()?'<button class="secondary" style="width:100%;margin-top:8px" onclick="exportPracticeMonthlySummary()">📥 匯出練習統計 CSV</button>':''}
    </div>
    <div class="card"><h2>學生列表 <span class="muted" style="font-size:14px">${items.length} 人</span></h2>${rows||'<div class="notice">目前沒有符合條件的學生。</div>'}</div>`;
  }

  window.savePracticeMonthlyEvaluation=async function(studentId){
    if(!isTeacher())return;
    const selected=document.querySelector(`input[name="mr_${CSS.escape(String(studentId))}"]:checked`);
    if(!selected){toast("請先完成 1～5 級老師月評");return}
    const comment=document.getElementById("mrComment_"+studentId)?.value?.trim()||"";
    try{
      await api("/api/practice-monthly-evaluation",{method:"POST",body:JSON.stringify({studentId,month:state.practiceProgressMonth,rating:Number(selected.value),comment})});
      await loadPracticeProgress();
      toast("📊 已儲存本月老師評比");
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
      return baseAdminPage()+`<div class="card"><h2>📚 自主練習月報</h2><div class="notice">查看全團學生每月自主練習日期與練習明細，協助了解是否養成每日練習習慣；分鐘數僅供紀錄，不作為分數依據。</div><button class="primary" onclick="go('practiceProgress')">查看自主練習月報</button></div>`;
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
