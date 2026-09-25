(()=>{
  const isParent=()=>state.me?.role==="parent";
  const baseHome=typeof home==="function"?home:null;
  const baseNav=typeof nav==="function"?nav:null;
  const feedbackLevels=[null,{icon:"🌱",label:"起步中"},{icon:"👍",label:"持續加油"},{icon:"🙂",label:"表現不錯"},{icon:"🌟",label:"很棒喔"},{icon:"🏆",label:"超級投入"}];
  state.parentPracticeFeedback=state.parentPracticeFeedback||null;
  state.parentPracticeFeedbackData=state.parentPracticeFeedbackData||null;
  state.parentMonthlyEvaluation=state.parentMonthlyEvaluation||null;
  state.parentPracticeFeedbackStudentId=state.parentPracticeFeedbackStudentId||"";
  state.parentPracticeFeedbackLoading=false;

  function localDate(){const d=new Date(),y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0");return `${y}-${m}-${day}`}
  function shortDate(v){const s=String(v||""),m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);return m?`${Number(m[2])}/${Number(m[3])}`:s}
  function attendanceKpi(label,present,total,sub=""){const p=Number(present||0),t=Number(total||0);if(t===0)return `<div class="kpi"><b style="font-size:18px">尚無課程</b><span>${esc(label)}</span>${sub?`<small style="display:block;margin-top:3px;color:var(--muted);font-weight:700">${esc(sub)}</small>`:""}</div>`;const missed=Math.max(0,t-p),status=missed===0?"🟢 全勤":`🟡 缺席 ${missed} 次`;return `<div class="kpi"><b>${p} / ${t}</b><span>${esc(label)}</span><small style="display:block;margin-top:3px;color:var(--muted);font-weight:700">${status}${sub?`｜${esc(sub)}`:""}</small></div>`}
  function latestPractice(){const rows=[...(state.practice||[])].filter(x=>x?.practiceDate).sort((a,b)=>String(b.practiceDate).localeCompare(String(a.practiceDate))||String(b.endTime||b.startTime||"").localeCompare(String(a.endTime||a.startTime||"")));return rows[0]||null}
  function todayPractices(){const today=localDate();return (state.practice||[]).filter(x=>String(x.practiceDate||"").slice(0,10)===today)}
  function practiceStreakInfo(){
    const dates=[...new Set((state.practice||[]).map(x=>String(x.practiceDate||"").slice(0,10)).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x)))].sort();
    if(!dates.length)return {longest:0,current:0,reward:null,next:3};
    const day=n=>Math.floor(new Date(n+"T12:00:00Z").getTime()/86400000);
    let longest=1,run=1;
    for(let i=1;i<dates.length;i++){if(day(dates[i])-day(dates[i-1])===1){run++;longest=Math.max(longest,run)}else run=1}
    const today=localDate(),latest=dates[dates.length-1],gap=day(today)-day(latest);
    let current=gap<=1?1:0;
    if(current){for(let i=dates.length-1;i>0;i--){if(day(dates[i])-day(dates[i-1])===1)current++;else break}}
    const levels=[{days:3,icon:"🔥",label:"3日連續"},{days:5,icon:"⭐",label:"5日穩定"},{days:7,icon:"🏆",label:"一週連續"},{days:14,icon:"🎖️",label:"兩週堅持"},{days:21,icon:"👑",label:"21日練習之星"}];
    const reward=[...levels].reverse().find(x=>longest>=x.days)||null,next=(levels.find(x=>longest<x.days)||{}).days||null;
    return {longest,current,reward,next};
  }
  async function loadParentPracticeFeedback(studentId){
    if(!studentId||state.parentPracticeFeedbackLoading)return;
    state.parentPracticeFeedbackLoading=true;
    try{
      const month=String(state.summary?.month||new Date().toISOString().slice(0,7));
      const [d,evaluation]=await Promise.all([
        api("/api/practice-feedback?studentId="+encodeURIComponent(studentId)),
        api("/api/practice-monthly-evaluation?studentId="+encodeURIComponent(studentId)+"&month="+encodeURIComponent(month)).catch(()=>({item:null}))
      ]);
      if(String(state.student?.studentId)===String(studentId)){
        state.parentPracticeFeedback=d.latest||null;
        state.parentPracticeFeedbackData=d;
        state.parentMonthlyEvaluation=evaluation.item||null;
      }
    }catch(e){state.parentPracticeFeedback=null;state.parentPracticeFeedbackData=null;state.parentMonthlyEvaluation=null}
    finally{state.parentPracticeFeedbackLoading=false;if(String(state.student?.studentId)===String(studentId))render()}
  }
  function parentMonthlyScoreCard(){
    const s=state.summary||{},practiceDays=Number(s.practiceActiveDays??s.practiceQualifiedDays??0),target=Math.max(1,Number(s.practiceEffectiveTargetDays||s.practiceTargetDays||30)),practicePoints=Math.round(Math.min(practiceDays/target,1)*1000)/100,current=String(s.month||"")===localDate().slice(0,7);
    return `<div class="parent-monthly-score">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><b>📊 自主練習月統計</b><span class="practice-feedback-chip">${practicePoints}/10</span></div>
      <div class="parent-monthly-score-grid"><div><b>${practiceDays} 天</b><small>本月有練習日期</small></div><div><b>${practicePoints}/10</b><small>本月自主練習分數</small></div></div>
      <small style="display:block;margin-top:8px;color:var(--muted)">每月分數僅用來呈現目前進度；期末以整個學期統計，自主練習最高 10 分。每日有完成自主練習紀錄即計 1 天，同一天多筆仍只計 1 天，練習分鐘數不列入分數。${current?"本月進行中，目前為暫估分數。":"此月份已結算。"}</small>
    </div>`;
  }
  function parentFeedbackCard(){
    const f=state.parentPracticeFeedback,d=state.parentPracticeFeedbackData||{},m=feedbackLevels[Number(f?.level||0)];
    if(!f||!m)return "";
    const counts=d.badgeCounts||{},monthCount=Number(d.currentMonthCount||0),recent=Array.isArray(d.recent)?d.recent:[],streak=practiceStreakInfo();
    const badges=feedbackLevels.slice(1).map((meta,i)=>`<div class="parent-feedback-badge ${Number(counts[i+1]||0)>0?"earned":""}"><span>${meta.icon}</span><small>${esc(meta.label)}</small><b>×${Number(counts[i+1]||0)}</b></div>`).join("");
    const reward=streak.reward?`<div class="practice-streak-earned"><span>${streak.reward.icon}</span><div><b>${esc(streak.reward.label)}</b><small>本月最長連續練習 ${streak.longest} 天</small></div></div>`:`<div class="practice-streak-earned"><span>🌱</span><div><b>連續練習挑戰</b><small>目前最長 ${streak.longest} 天${streak.next?`｜達 ${streak.next} 天可獲得第一枚徽章`:""}</small></div></div>`;
    return `<div class="parent-practice-feedback">
      <div class="parent-practice-feedback-head"><b>💛 自主練習｜老師鼓勵回饋</b><span class="practice-feedback-chip">本月 ${monthCount} 次</span></div>
      <div class="parent-feedback-latest"><div style="font-size:20px;font-weight:900">${m.icon} ${esc(m.label)}</div>${f.comment?`<div style="margin-top:6px;font-size:14px;font-weight:800">${esc(f.comment)}</div>`:""}<small>最近回饋｜${esc(f.teacherName||"老師")}${f.updatedAt?`｜${esc(String(f.updatedAt).slice(0,10))}`:""}</small></div>
      <div class="parent-feedback-section-title">🏅 鼓勵徽章牆</div>
      <div class="parent-feedback-badges">${badges}</div>
      <div class="parent-feedback-section-title">🔥 連續練習獎勵</div>
      ${reward}
      ${recent.length>1?`<details class="parent-feedback-history"><summary>查看最近老師鼓勵（${Math.min(recent.length,5)}）</summary>${recent.slice(0,5).map(h=>{const hm=feedbackLevels[Number(h.level||0)];return `<div><b>${hm?hm.icon:"💛"} ${esc(hm?.label||"鼓勵")}</b><small>${esc(h.teacherName||"老師")}｜${esc(String(h.updatedAt||"").slice(0,10))}</small>${h.comment?`<p>${esc(h.comment)}</p>`:""}</div>`}).join("")}</details>`:""}
    </div>`;
  }

  function todayCourseReminder(){
    const s=state.summary||{},courses=Array.isArray(s.todayCourses)?s.todayCourses:[],date=String(s.today||localDate());
    const statusText={present:"已出席",late:"遲到",leave:"請假",absent:"缺席",cancelled:"停課"};
    const statusClass={present:"ok",late:"warn",leave:"warn",absent:"bad",cancelled:"warn"};
    if(!courses.length)return `<div class="card"><h2>📅 今日課程提醒</h2><div class="notice"><b>${esc(shortDate(date))} 今天沒有固定團體課程</b><br>個別課仍依老師實際安排為準；如有自主練習，可完成後直接打卡。</div></div>`;
    const rows=courses.map(x=>{const status=x.cancelled?"今日停課":x.recorded?(statusText[x.status]||"已點名"):"待上課／待點名";const cls=x.cancelled?"bad":x.recorded?(statusClass[x.status]||"ok"):"warn";const location=x.location?`<small style="display:block;margin-top:3px">📍 ${esc(x.location)}</small>`:"";const note=x.cancelled&&x.reason?`<small style="display:block;margin-top:4px">原因：${esc(x.reason)}</small>`:"";return `<div class="item"><div><b>${esc(x.label||"課程")}</b><small>${esc(x.time||"")}</small>${location}${note}</div><span class="badge ${cls}">${esc(status)}</span></div>`}).join("");
    return `<div class="card"><h2>📅 今日課程提醒</h2><div class="notice" style="margin-bottom:10px"><b>${esc(state.student?.name||"學生")}今天有 ${courses.length} 堂固定課程</b><br>以下依目前弦樂團課表顯示；個別課另依老師安排。</div>${rows}</div>`;
  }
  function studentSwitcher(){
    const students=Array.isArray(state.students)?state.students:[];
    if(students.length<2)return "";
    return `<div class="card"><h2>👨‍👩‍👧 我的孩子</h2><div class="notice" style="margin-bottom:10px">此 Gmail 已綁定 ${students.length} 位學生，請選擇要查看的孩子。</div><label>目前學生</label><select id="parentStudentSwitcher" onchange="switchParentStudent(this.value)">${students.map(s=>`<option value="${esc(s.studentId)}" ${String(s.studentId)===String(state.student?.studentId)?"selected":""}>${esc(s.name)}｜${esc(s.groupName)}團｜${esc(s.instrument)}</option>`).join("")}</select></div>`;
  }
  window.switchParentStudent=async function(studentId){
    const next=(state.students||[]).find(s=>String(s.studentId)===String(studentId));
    if(!next||String(next.studentId)===String(state.student?.studentId))return;
    state.student=next;state.summary=null;state.practice=[];state.parentPracticeFeedback=null;state.parentPracticeFeedbackData=null;state.parentMonthlyEvaluation=null;state.parentPracticeFeedbackStudentId="";
    try{await refreshStudent();render();toast(`已切換為 ${next.name}`)}catch(e){toast("❌ "+e.message)}
  };

  home=function(){
    if(!isParent()||!state.student||!baseHome)return baseHome?baseHome():"";
    const s=state.summary||{},sectionName=String(state.student.section||"").trim(),latest=latestPractice(),todayRows=todayPractices(),todayMinutes=todayRows.reduce((n,x)=>n+Number(x.minutes||0),0),latestText=latest?`${shortDate(latest.practiceDate)}・已完成練習`:"尚無紀錄",todayDone=todayRows.length>0;
    const feedbackStudentId=String(state.student.studentId||"");if(state.parentPracticeFeedbackStudentId!==feedbackStudentId&&!state.parentPracticeFeedbackLoading){state.parentPracticeFeedbackStudentId=feedbackStudentId;setTimeout(()=>loadParentPracticeFeedback(feedbackStudentId),0)}
    const action=todayDone?`<div class="notice"><b>✅ 今天已完成自主練習</b><br><span style="display:block;margin-top:6px">今天已有 ${todayRows.length} 筆紀錄｜今日計 1 個練習日</span></div><button class="primary" onclick="go('record')">查看今日／近期紀錄</button><button class="secondary" style="width:100%;margin-top:10px" onclick="go('practice')">＋ 補登另一筆練習</button>`:`<div class="notice"><b>🎻 今天尚未有自主練習紀錄</b><br><span style="display:block;margin-top:6px">完成練習後，記得幫${esc(state.student.name)}留下紀錄。</span></div><button class="primary" onclick="go('practice')">立即自主練習打卡</button>`;
    const privateLessonPanel=typeof window.privateLessonParentPanels==="function"?window.privateLessonParentPanels("home"):"";
    return `${studentSwitcher()}${todayCourseReminder()}${privateLessonPanel}<div class="card hero"><div class="student"><div class="studentleft"><div class="avatar">${esc(state.student.name?.[0]||"學")}</div><div><div class="name">${esc(state.student.name)}</div><div class="muted">${esc(state.student.groupName)}團${sectionName?`｜${esc(sectionName)}`:""}｜${esc(state.student.instrument)}｜${esc(state.student.grade)}</div></div></div><div class="pill">${new Date().getMonth()+1}月</div></div><div style="margin-top:14px;font-weight:900">本月自主練習</div><div class="grid" style="margin-top:8px"><div class="kpi"><b>${s.practiceActiveDays??s.practiceQualifiedDays??0} 天</b><span>本月練習天數</span></div><div class="kpi"><b>${s.practiceEffectiveTargetDays||s.practiceTargetDays||30} 天</b><span>截至目前計分基準</span></div></div><div class="notice" style="margin-top:10px"><b>最近一次自主練習</b><br>${esc(latestText)}</div>${parentMonthlyScoreCard()}${parentFeedbackCard()}<div style="margin-top:16px;font-weight:900">本月上課出勤</div><div class="muted" style="font-size:12px;margin-top:3px">到課 / 應到；遲到仍計入到課</div><div class="grid" style="margin-top:8px">${attendanceKpi("分部課",s.sectionPresent,s.sectionTotal,sectionName||"目前分部")}${attendanceKpi("合奏課",s.ensemblePresent,s.ensembleTotal,"A／B 團合奏")}${attendanceKpi("綜合課（團體課）",s.comprehensivePresent,s.comprehensiveTotal,"A／B／儲備團")}${attendanceKpi("個別課",s.privatePresent,s.privateTotal,"家長確認後計入")}</div><button class="secondary" style="width:100%;margin-top:12px" onclick="go('record')">查看整學期上課紀錄 ›</button></div><div class="card"><h2>今天要做什麼？</h2>${action}</div><div class="card"><h2>📌 自主練習登記提醒</h2><div class="notice">自主練習紀錄將作為後續練習統計與成績計算依據。為保障學生權益，請家長於每次練習完成後確認紀錄已成功送出，並可至「紀錄」頁再次核對。<br><br><b>計分規則：以「有練習的日期」作為自主練習計量標準。每天只要完成自主練習並留下紀錄，即計 1 個練習日；同一天即使有多筆紀錄，也只計 1 天。練習分鐘數僅供紀錄與自我了解，不作為分數依據。</b><br><br>若主要登記之家長因出差、工作或其他因素無法操作，可由另一位已綁定之監護人登入完成登記。<b>系統以「學生」為統計單位</b>，不同監護人登記的紀錄皆累計於同一位學生名下。</div></div>`;
  };
  if(baseNav){nav=function(){if(state.page==="contextSelect")return baseNav();if(isParent())return `<nav class="nav">${navBtn("home","🏠","首頁")}${navBtn("practice","⏱️","自主打卡")}${navBtn("record","📊","紀錄")}${navBtn("register","➕","綁定孩子")}</nav>`;return baseNav()}}
  window.parentHomeSummaryReady=true;
})();