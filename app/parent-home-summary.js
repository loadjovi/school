(()=>{
  const isParent=()=>state.me?.role==="parent";
  const baseHome=typeof home==="function"?home:null;
  const baseNav=typeof nav==="function"?nav:null;
  const feedbackLevels=[null,{icon:"🌱",label:"起步中"},{icon:"👍",label:"持續加油"},{icon:"🙂",label:"表現不錯"},{icon:"🌟",label:"很棒喔"},{icon:"🏆",label:"超級投入"}];
  state.parentPracticeFeedback=state.parentPracticeFeedback||null;
  state.parentPracticeFeedbackData=state.parentPracticeFeedbackData||null;
  state.parentPracticeFeedbackStudentId=state.parentPracticeFeedbackStudentId||"";
  state.parentPracticeFeedbackLoading=false;
  state.parentPracticeLeaderboard=null;
  state.parentPracticeLeaderboardStudentId="";
  state.parentPracticeLeaderboardLoadedAt=0;
  state.parentPracticeLeaderboardLoading=false;
  state.parentPracticeLeaderboardError="";

  const baseRefreshStudent=refreshStudent;
  refreshStudent=async function(){
    const oldId=String(state.student?.studentId||"");
    const oldSignature=JSON.stringify((state.practice||[]).map(x=>[x.practiceId,x.practiceDate,x.minutes]));
    await baseRefreshStudent();
    const newSignature=JSON.stringify((state.practice||[]).map(x=>[x.practiceId,x.practiceDate,x.minutes]));
    if(oldId!==String(state.student?.studentId||"")||oldSignature!==newSignature)state.parentPracticeLeaderboardLoadedAt=0;
  };

  function localDate(){const d=new Date(),y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0");return `${y}-${m}-${day}`}
  function shortDate(v){const s=String(v||""),m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);return m?`${Number(m[2])}/${Number(m[3])}`:s}
  function attendanceKpi(label,present,total,leave=0,absent=0,sub=""){const p=Number(present||0),t=Number(total||0),l=Number(leave||0),a=Number(absent||0);if(t===0)return `<div class="kpi"><b style="font-size:18px">尚無課程</b><span>${esc(label)}</span>${sub?`<small style="display:block;margin-top:3px;color:var(--muted);font-weight:700">${esc(sub)}</small>`:""}</div>`;const status=a>0?`🔴 缺席 ${a} 次`:l>0?`🟡 請假 ${l} 次（不扣分）`:"🟢 全勤";return `<div class="kpi"><b>${p} / ${t}</b><span>${esc(label)}</span><small style="display:block;margin-top:3px;color:var(--muted);font-weight:700">${status}${sub?`｜${esc(sub)}`:""}</small></div>`}
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
      const d=await api("/api/practice-feedback?studentId="+encodeURIComponent(studentId));
      if(String(state.student?.studentId)===String(studentId)){
        state.parentPracticeFeedback=d.latest||null;
        state.parentPracticeFeedbackData=d;
      }
    }catch(e){state.parentPracticeFeedback=null;state.parentPracticeFeedbackData=null}
    finally{state.parentPracticeFeedbackLoading=false;if(String(state.student?.studentId)===String(studentId))render()}
  }
  async function loadParentPracticeLeaderboard(studentId){
    if(!studentId||state.parentPracticeLeaderboardLoading)return;
    state.parentPracticeLeaderboardLoading=true;
    state.parentPracticeLeaderboardError="";
    try{
      const data=await api("/api/parent-practice-leaderboard?studentId="+encodeURIComponent(studentId));
      if(state.me?.role==="parent"&&String(state.student?.studentId)===String(studentId)){
        state.parentPracticeLeaderboard=data;
        state.parentPracticeLeaderboardStudentId=studentId;
        state.parentPracticeLeaderboardLoadedAt=Date.now();
      }
    }catch(e){
      if(state.me?.role==="parent"&&String(state.student?.studentId)===String(studentId)){
        state.parentPracticeLeaderboardError=e.message||"排名暫時無法取得";
        state.parentPracticeLeaderboardStudentId=studentId;
        state.parentPracticeLeaderboardLoadedAt=Date.now();
      }
    }finally{
      state.parentPracticeLeaderboardLoading=false;
      if(state.me?.role==="parent"&&state.page==="home")render();
    }
  }
  window.refreshParentPracticeLeaderboard=function(){
    state.parentPracticeLeaderboardLoadedAt=0;
    const studentId=String(state.student?.studentId||"");
    if(studentId&&!state.parentPracticeLeaderboardLoading){loadParentPracticeLeaderboard(studentId);render()}
  };
  function leaderboardFeedback(x){
    const level=feedbackLevels[Number(x.feedback?.level||0)];
    const status=level?`${level.icon} ${esc(level.label)}${x.feedback?.date?`｜${esc(shortDate(x.feedback.date))}`:""}`:"本月尚無回饋";
    return `<span class="practice-leaderboard-feedback">💛 老師日常鼓勵：${status}</span>`;
  }
  function parentPracticeLeaderboardCard(){
    const data=state.parentPracticeLeaderboard,d=data||{},studentId=String(state.student?.studentId||"");
    if(!state.parentPracticeLeaderboardLoading&&(!state.parentPracticeLeaderboardLoadedAt||Date.now()-state.parentPracticeLeaderboardLoadedAt>120000||state.parentPracticeLeaderboardStudentId!==studentId)){
      state.parentPracticeLeaderboardLoadedAt=Date.now();
      setTimeout(()=>loadParentPracticeLeaderboard(studentId),0);
    }
    const current=state.parentPracticeLeaderboardStudentId===studentId&&data&&!state.parentPracticeLeaderboardError;
    const months=current?d.includedMonths||[]:[],monthText=months.map(m=>Number(String(m).slice(5))+"月").join("、");
    const title=months.length>1?`${monthText}平均`:months.length?`${monthText}分數`:"正式計分月份";
    const rows=current?(d.items||[]):[];
    const content=state.parentPracticeLeaderboardError
      ?`<div class="notice">暫時無法取得排名：${esc(state.parentPracticeLeaderboardError)}。請按「更新」。</div>`
      :!current?`<div class="notice">正在讀取本校自主練習排名…</div>`
      :!months.length?`<div class="notice">9 月為測試期。正式分數自 10 月起計算，屆時可在此查看 TOP 5。</div>`
      :!rows.length?`<div class="notice">目前尚無學生在正式計分月份留下練習紀錄。</div>`
      :`<ol class="practice-leaderboard-list">${rows.map(x=>`<li class="practice-leaderboard-item ${x.isMine?"is-mine":""}"><span class="practice-leaderboard-rank">${Number(x.rank)}</span><div><b>${esc(x.name)}${x.isMine?"（我的孩子）":""}</b><small>有效練習 ${Number(x.qualifiedDays)} 天｜累計 ${Number(x.minutes)} 分鐘</small>${leaderboardFeedback(x)}</div><strong>${Number(x.score10)}/10</strong></li>`).join("")}</ol>${d.mine&&Number(d.mine.rank)>5?`<div class="practice-leaderboard-mine">我的孩子目前第 ${Number(d.mine.rank)} 名｜${Number(d.mine.score10)}/10（有效練習 ${Number(d.mine.qualifiedDays)} 天）${leaderboardFeedback(d.mine)}</div>`:""}`;
    return `<section class="card practice-leaderboard"><div class="practice-leaderboard-head"><div><h2>🏅 自主練習分數 TOP 5</h2><small>本校本學期有練習紀錄的學生｜${esc(title)}</small></div><button class="secondary" type="button" onclick="refreshParentPracticeLeaderboard()" ${state.parentPracticeLeaderboardLoading?"disabled":""}>更新</button></div>${content}<div class="practice-leaderboard-foot">${current&&d.asOf?`截至 ${esc(shortDate(d.asOf))}｜共 ${Number(d.participantCount||0)} 位有練習紀錄。`:""}依有效練習日換算 10 分，再平均已進行的正式月份；當月分數為暫估。同分依有效日數、練習分鐘排序。其他學生姓名已遮蔽。老師日常鼓勵顯示本月最新狀態，僅供鼓勵參考，不參與排名及正式成績。</div></section>`;
  }
  function parentMonthlyScoreCard(){
    const s=state.summary||{},qualified=Number(s.practiceQualifiedDays||0),target=Math.max(1,Number(s.practiceEffectiveTargetDays||s.practiceTargetDays||30)),total=Math.round(Math.min(qualified/target,1)*1000)/100,trial=/^\d{4}-09$/.test(String(s.month||"")),current=String(s.month||"")===localDate().slice(0,7);
    return `<div class="parent-monthly-score">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><b>🎯 自主練習｜期末 10%</b><span class="practice-feedback-chip">${trial?"9月試營運｜":""}${total}/10</span></div>
      <div class="parent-monthly-score-grid"><div><b>${qualified} / ${target}</b><small>有效練習日 / 月目標</small></div><div><b>${total}/10</b><small>系統自動換算</small></div></div>
      <div class="monthly-score-formula">換算：${qualified} ÷ ${target} × 10 ＝ <b>${total}/10</b></div>
      <small style="display:block;margin-top:8px;color:var(--muted)">此項由系統依有效練習天數自動計算，老師不需另外評分。${trial?"9 月僅試算，正式計分自 10 月開始。":current?"本月進行中，目前為暫估分數。":"此月份為正式結果。"}</small>
    </div>`;
  }
  function parentAttendanceScoreCard(){
    const s=state.summary||{},present=Number(s.attendancePresent||0),total=Number(s.attendanceTotal||0),leave=Number(s.attendanceLeave||0);
    const rate=s.attendanceRate==null?null:Number(s.attendanceRate),score=s.attendanceScore5==null?null:Number(s.attendanceScore5);
    const current=String(s.month||"")===localDate().slice(0,7),full=total>0&&present>=total,trial=/^\d{4}-09$/.test(String(s.month||""));
    return `<div class="parent-attendance-score">
      <div class="parent-attendance-score-head">
        <b>📘 課程點名｜期末 5%</b>
        <span class="practice-feedback-chip">${trial?"9月試營運｜":""}${score==null?"尚無點名":(Math.round(score*100)/100)+"/5"}</span>
      </div>
      ${total? `<div class="parent-attendance-score-grid">
        <div><b>${present} / ${total}</b><small>到課 / 計分應到</small></div>
        <div><b>${rate==null?"—":rate+"%"}</b><small>${full?"全勤":"出席比例"}${leave?"｜核准請假 "+leave+" 次不扣分":""}</small></div>
      </div>
      <div class="monthly-score-formula">換算：${present} ÷ ${total} × 5 ＝ <b>${Math.round(score*100)/100}/5</b></div>`
      : `<div class="notice" style="margin-top:8px">本月尚無可計分的分部課／合奏課／綜合課點名紀錄，因此暫不產生出勤分數。</div>`}
      <small style="display:block;margin-top:8px;color:var(--muted)">計分範圍：分部課＋合奏課＋綜合課；個別課不納入此 5%。上課開始後超過 10 分鐘才到課記為遲到，10 分鐘內到課記為出席；遲到仍計入到課。停課與核准請假不列入計分分母，無故缺席才影響分數。${trial?"9 月僅試算，正式計分自 10 月開始。":current?"本月進行中，目前為暫估分數。":"此月份為正式結果。"}</small>
    </div>`;
  }
  function parentMonthlyScoreOverview(){
    const s=state.summary||{},qualified=Number(s.practiceQualifiedDays||0),target=Math.max(1,Number(s.practiceEffectiveTargetDays||s.practiceTargetDays||30));
    const practice=Math.round(Math.min(qualified/target,1)*1000)/100;
    const attendance=s.attendanceScore5==null?null:Math.round(Number(s.attendanceScore5)*100)/100;
    const privateCount=Number(s.privateCompletedForScore||0),privateTarget=Math.max(1,Number(s.privateMonthlyTarget||4));
    const privateScore=Math.round(Math.min(privateCount/privateTarget,1)*500)/100;
    const trial=/^\d{4}-09$/.test(String(s.month||"")),month=String(s.month||localDate().slice(0,7)).slice(5);
    const monthComplete=attendance!=null,monthTotal=monthComplete?Math.round((practice+attendance+privateScore)*100)/100:null;
    const row=(icon,title,value,meta,cls="")=>`<div class="parent-score-row ${cls}"><div class="parent-score-row-main"><span class="parent-score-icon">${icon}</span><div><b>${title}</b><small>${meta}</small></div></div><div class="parent-score-value">${value}</div></div>`;
    return `<section class="parent-score-overview">
      <div class="parent-score-overview-head">
        <div><b>📊 ${month}月${trial?"評分試算":"學習進度"}｜期末 20%</b><small>自主練習 10%＋課程點名 5%＋個課／期末評量 5%。</small></div>
        <span class="parent-score-total ${monthComplete?"is-complete":"is-pending"}">${monthComplete?monthTotal+"/20":"已計 "+practice+"/10"}</span>
      </div>
      <div class="parent-score-indent">
        ${row("🎯","自主練習｜10%",practice+"/10",`系統自動計分｜有效練習 ${qualified}/${target} 天`,"practice")}
        ${row("📘","課程點名｜5%",attendance==null?"待資料":attendance+"/5",attendance==null?"尚無可計分點名":"只計分部／合奏／綜合；核准請假不扣分","attendance")}
        ${row("🎻","個課學習表現｜5%",privateScore+"/5",`本月完成個課 ${privateCount}/${privateTarget} 次；每月 4 次 = 5 分`,"learning")}
      </div>
      <small class="parent-score-overview-foot">${trial?"9 月為試營運，以上僅供試算；正式成績自 10 月開始。":"上學期個課 5% 以 10～12 月每月分數做學期平均；若整學期沒有完成個課，則不採個課 0 分，而是改由分部老師於學期末評量一次。"}</small>
    </section>`;
  }
  function parentFeedbackCard(){
    const f=state.parentPracticeFeedback,d=state.parentPracticeFeedbackData||{},m=feedbackLevels[Number(f?.level||0)];
    if(!f||!m)return "";
    const counts=d.badgeCounts||{},monthCount=Number(d.currentMonthCount||0),recent=Array.isArray(d.recent)?d.recent:[],streak=practiceStreakInfo();
    const badges=feedbackLevels.slice(1).map((meta,i)=>`<div class="parent-feedback-badge ${Number(counts[i+1]||0)>0?"earned":""}"><span>${meta.icon}</span><small>${esc(meta.label)}</small><b>×${Number(counts[i+1]||0)}</b></div>`).join("");
    const reward=streak.reward?`<div class="practice-streak-earned"><span>${streak.reward.icon}</span><div><b>${esc(streak.reward.label)}</b><small>本月最長連續練習 ${streak.longest} 天</small></div></div>`:`<div class="practice-streak-earned"><span>🌱</span><div><b>連續練習挑戰</b><small>目前最長 ${streak.longest} 天${streak.next?`｜達 ${streak.next} 天可獲得第一枚徽章`:""}</small></div></div>`;
    return `<details class="parent-practice-feedback parent-feedback-compact">
      <summary>
        <div><b>💛 日常鼓勵｜不計分</b><small>${m.icon} ${esc(m.label)}｜最近回饋 ${esc(f.teacherName||"老師")}</small></div>
        <span class="practice-feedback-chip">本月 ${monthCount} 次</span>
      </summary>
      <div class="parent-feedback-expanded">
        <div class="parent-feedback-latest"><div style="font-size:18px;font-weight:900">${m.icon} ${esc(m.label)}</div>${f.comment?`<div style="margin-top:6px;font-size:14px;font-weight:800">${esc(f.comment)}</div>`:""}<small>最近回饋｜${esc(f.teacherName||"老師")}${f.updatedAt?`｜${esc(String(f.updatedAt).slice(0,10))}`:""}</small></div>
        <small style="display:block;margin:7px 0;color:var(--muted)">此區為老師平時鼓勵互動，不列入任何成績；需要查看徽章或歷史回饋時再展開即可。</small>
        <div class="parent-feedback-section-title">🏅 鼓勵徽章牆</div>
        <div class="parent-feedback-badges">${badges}</div>
        <div class="parent-feedback-section-title">🔥 連續練習獎勵</div>
        ${reward}
        ${recent.length>1?`<details class="parent-feedback-history"><summary>查看最近老師鼓勵（${Math.min(recent.length,5)}）</summary>${recent.slice(0,5).map(h=>{const hm=feedbackLevels[Number(h.level||0)];return `<div><b>${hm?hm.icon:"💛"} ${esc(hm?.label||"鼓勵")}</b><small>${esc(h.teacherName||"老師")}｜${esc(String(h.updatedAt||"").slice(0,10))}</small>${h.comment?`<p>${esc(h.comment)}</p>`:""}</div>`}).join("")}</details>`:""}
      </div>
    </details>`;
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
    state.student=next;state.summary=null;state.practice=[];state.parentPracticeFeedback=null;state.parentPracticeFeedbackData=null;state.parentPracticeFeedbackStudentId="";state.parentPracticeLeaderboard=null;state.parentPracticeLeaderboardStudentId="";state.parentPracticeLeaderboardLoadedAt=0;state.parentPracticeLeaderboardError="";
    try{await refreshStudent();render();toast(`已切換為 ${next.name}`)}catch(e){toast("❌ "+e.message)}
  };

  home=function(){
    if(!isParent()||!state.student||!baseHome)return baseHome?baseHome():"";
    const s=state.summary||{},sectionName=String(state.student.section||"").trim(),latest=latestPractice(),todayRows=todayPractices(),todayMinutes=todayRows.reduce((n,x)=>n+Number(x.minutes||0),0),latestText=latest?`${shortDate(latest.practiceDate)}・${Number(latest.minutes||0)} 分鐘`:"尚無紀錄",todayDone=todayRows.length>0;
    const feedbackStudentId=String(state.student.studentId||"");if(state.parentPracticeFeedbackStudentId!==feedbackStudentId&&!state.parentPracticeFeedbackLoading){state.parentPracticeFeedbackStudentId=feedbackStudentId;setTimeout(()=>loadParentPracticeFeedback(feedbackStudentId),0)}
    const action=todayDone?`<div class="notice"><b>✅ 今天已完成自主練習</b><br><span style="display:block;margin-top:6px">${todayMinutes} 分鐘｜今天已有 ${todayRows.length} 筆紀錄</span></div><button class="primary" onclick="go('record')">查看今日／近期紀錄</button><button class="secondary" style="width:100%;margin-top:10px" onclick="go('practice')">＋ 補登另一筆練習</button>`:`<div class="notice"><b>🎻 今天尚未有自主練習紀錄</b><br><span style="display:block;margin-top:6px">完成練習後，記得幫${esc(state.student.name)}留下紀錄。</span></div><button class="primary" onclick="go('practice')">立即自主練習打卡</button>`;
    const privateLessonPanel=typeof window.privateLessonParentPanels==="function"?window.privateLessonParentPanels("home"):"";
    return `${studentSwitcher()}${todayCourseReminder()}${privateLessonPanel}<div class="card hero"><div class="student"><div class="studentleft"><div class="avatar">${esc(state.student.name?.[0]||"學")}</div><div><div class="name">${esc(state.student.name)}</div><div class="muted">${esc(state.student.groupName)}團${sectionName?`｜${esc(sectionName)}`:""}｜${esc(state.student.instrument)}｜${esc(state.student.grade)}</div></div></div><div class="pill">${new Date().getMonth()+1}月</div></div><div style="margin-top:14px;font-weight:900">本月自主練習</div><div class="grid" style="margin-top:8px"><div class="kpi"><b>${s.practiceQualifiedDays||0} 天</b><span>練習達標天數</span></div><div class="kpi"><b>${s.practiceMinutes||0} 分鐘</b><span>累計練習時間</span></div></div><div class="notice" style="margin-top:10px"><b>最近一次自主練習</b><br>${esc(latestText)}</div>${parentMonthlyScoreOverview()}${parentFeedbackCard()}<div class="parent-detail-heading"><b>本月上課出勤明細</b><small>分部／合奏／綜合課與個別課的實際點名紀錄；上課開始後超過 10 分鐘才到課記為遲到，10 分鐘內記為出席。</small></div><div class="grid" style="margin-top:8px">${attendanceKpi("分部課",s.sectionPresent,s.sectionTotal,s.sectionLeave,s.sectionAbsent,sectionName||"目前分部")}${attendanceKpi("合奏課",s.ensemblePresent,s.ensembleTotal,s.ensembleLeave,s.ensembleAbsent,"A／B 團合奏")}${attendanceKpi("綜合課（團體課）",s.comprehensivePresent,s.comprehensiveTotal,s.comprehensiveLeave,s.comprehensiveAbsent,"A／B／儲備團")}${attendanceKpi("個別課",s.privatePresent,s.privateTotal,s.privateLeave,s.privateAbsent,"不納入課程點名 5%")}</div><button class="secondary" style="width:100%;margin-top:12px" onclick="go('record')">查看整學期上課紀錄 ›</button></div>${parentPracticeLeaderboardCard()}<div class="card"><h2>今天要做什麼？</h2>${action}</div><div class="card"><h2>📌 自主練習登記提醒</h2><div class="notice">自主練習紀錄將作為後續練習統計與成績計算依據。為保障學生權益，請家長於每次練習完成後確認紀錄已成功送出，並可至「紀錄」頁再次核對。<br><br><b>達標規則：單日累計自主練習達 15 分鐘以上，計為 1 個達標日；同一天多筆紀錄的分鐘數會累計，但達標日仍以 1 天計算。</b><br><br>若主要登記之家長因出差、工作或其他因素無法操作，可由另一位已綁定之監護人登入完成登記。<b>系統以「學生」為統計單位</b>，不同監護人登記的紀錄皆累計於同一位學生名下。</div></div>`;
  };
  if(baseNav){nav=function(){if(state.page==="contextSelect")return baseNav();if(isParent())return `<nav class="nav">${navBtn("home","🏠","首頁")}${navBtn("practice","⏱️","自主打卡")}${navBtn("record","📊","紀錄")}${navBtn("register","➕","綁定孩子")}</nav>`;return baseNav()}}
  window.parentHomeSummaryReady=true;
})();
