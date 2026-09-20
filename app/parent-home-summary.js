(()=>{
  const isParent=()=>state.me?.role==="parent";
  const baseHome=typeof home==="function"?home:null;
  const baseNav=typeof nav==="function"?nav:null;

  function localDate(){const d=new Date(),y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0");return `${y}-${m}-${day}`}
  function shortDate(v){const s=String(v||""),m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);return m?`${Number(m[2])}/${Number(m[3])}`:s}
  function attendanceKpi(label,present,total,sub=""){const p=Number(present||0),t=Number(total||0);if(t===0)return `<div class="kpi"><b style="font-size:18px">尚無課程</b><span>${esc(label)}</span>${sub?`<small style="display:block;margin-top:3px;color:var(--muted);font-weight:700">${esc(sub)}</small>`:""}</div>`;const missed=Math.max(0,t-p),status=missed===0?"🟢 全勤":`🟡 缺席 ${missed} 次`;return `<div class="kpi"><b>${p} / ${t}</b><span>${esc(label)}</span><small style="display:block;margin-top:3px;color:var(--muted);font-weight:700">${status}${sub?`｜${esc(sub)}`:""}</small></div>`}
  function latestPractice(){const rows=[...(state.practice||[])].filter(x=>x?.practiceDate).sort((a,b)=>String(b.practiceDate).localeCompare(String(a.practiceDate))||String(b.endTime||b.startTime||"").localeCompare(String(a.endTime||a.startTime||"")));return rows[0]||null}
  function todayPractices(){const today=localDate();return (state.practice||[]).filter(x=>String(x.practiceDate||"").slice(0,10)===today)}
  function todayCourseReminder(){
    const s=state.summary||{},courses=Array.isArray(s.todayCourses)?s.todayCourses:[],date=String(s.today||localDate());
    const statusText={present:"已出席",late:"遲到",leave:"請假",absent:"缺席",cancelled:"停課"};
    const statusClass={present:"ok",late:"warn",leave:"warn",absent:"bad",cancelled:"warn"};
    if(!courses.length)return `<div class="card"><h2>📅 今日課程提醒</h2><div class="notice"><b>${esc(shortDate(date))} 今天沒有固定團體課程</b><br>個別課仍依老師實際安排為準；如有自主練習，可完成後直接打卡。</div></div>`;
    const rows=courses.map(x=>{const status=x.cancelled?"今日停課":x.recorded?(statusText[x.status]||"已點名"):"待上課／待點名";const cls=x.cancelled?"bad":x.recorded?(statusClass[x.status]||"ok"):"warn";const note=x.cancelled&&x.reason?`<small style="display:block;margin-top:4px">原因：${esc(x.reason)}</small>`:"";return `<div class="item"><div><b>${esc(x.label||"課程")}</b><small>${esc(x.time||"")}</small>${note}</div><span class="badge ${cls}">${esc(status)}</span></div>`}).join("");
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
    state.student=next;state.summary=null;state.practice=[];
    try{await refreshStudent();render();toast(`已切換為 ${next.name}`)}catch(e){toast("❌ "+e.message)}
  };

  home=function(){
    if(!isParent()||!state.student||!baseHome)return baseHome?baseHome():"";
    const s=state.summary||{},sectionName=String(state.student.section||"").trim(),latest=latestPractice(),todayRows=todayPractices(),todayMinutes=todayRows.reduce((n,x)=>n+Number(x.minutes||0),0),latestText=latest?`${shortDate(latest.practiceDate)}・${Number(latest.minutes||0)} 分鐘`:"尚無紀錄",todayDone=todayRows.length>0;
    const action=todayDone?`<div class="notice"><b>✅ 今天已完成自主練習</b><br><span style="display:block;margin-top:6px">${todayMinutes} 分鐘｜今天已有 ${todayRows.length} 筆紀錄</span></div><button class="primary" onclick="go('record')">查看今日／近期紀錄</button><button class="secondary" style="width:100%;margin-top:10px" onclick="go('practice')">＋ 補登另一筆練習</button>`:`<div class="notice"><b>🎻 今天尚未有自主練習紀錄</b><br><span style="display:block;margin-top:6px">完成練習後，記得幫${esc(state.student.name)}留下紀錄。</span></div><button class="primary" onclick="go('practice')">立即自主練習打卡</button>`;
    const privateLessonPanel=typeof window.privateLessonParentPanels==="function"?window.privateLessonParentPanels("home"):"";
    return `${studentSwitcher()}${todayCourseReminder()}${privateLessonPanel}<div class="card hero"><div class="student"><div class="studentleft"><div class="avatar">${esc(state.student.name?.[0]||"學")}</div><div><div class="name">${esc(state.student.name)}</div><div class="muted">${esc(state.student.groupName)}團${sectionName?`｜${esc(sectionName)}`:""}｜${esc(state.student.instrument)}｜${esc(state.student.grade)}</div></div></div><div class="pill">${new Date().getMonth()+1}月</div></div><div style="margin-top:14px;font-weight:900">本月自主練習</div><div class="grid" style="margin-top:8px"><div class="kpi"><b>${s.practiceQualifiedDays||0} 天</b><span>練習達標天數</span></div><div class="kpi"><b>${s.practiceMinutes||0} 分鐘</b><span>累計練習時間</span></div></div><div class="notice" style="margin-top:10px"><b>最近一次自主練習</b><br>${esc(latestText)}</div><div style="margin-top:16px;font-weight:900">本月上課出勤</div><div class="muted" style="font-size:12px;margin-top:3px">到課 / 應到；遲到仍計入到課</div><div class="grid" style="margin-top:8px">${attendanceKpi("分部課",s.sectionPresent,s.sectionTotal,sectionName||"目前分部")}${attendanceKpi("合奏課",s.ensemblePresent,s.ensembleTotal,"A／B 團合奏")}${attendanceKpi("綜合課（團體課）",s.comprehensivePresent,s.comprehensiveTotal,"A／B／儲備團")}${attendanceKpi("個別課",s.privatePresent,s.privateTotal,"家長確認後計入")}</div><button class="secondary" style="width:100%;margin-top:12px" onclick="go('record')">查看整學期上課紀錄 ›</button></div><div class="card"><h2>今天要做什麼？</h2>${action}</div><div class="card"><h2>📌 自主練習登記提醒</h2><div class="notice">自主練習紀錄將作為後續練習統計與成績計算依據。為保障學生權益，請家長於每次練習完成後確認紀錄已成功送出，並可至「紀錄」頁再次核對。<br><br><b>達標規則：單日累計自主練習達 15 分鐘以上，計為 1 個達標日；同一天多筆紀錄的分鐘數會累計，但達標日仍以 1 天計算。</b><br><br>若主要登記之家長因出差、工作或其他因素無法操作，可由另一位已綁定之監護人登入完成登記。<b>系統以「學生」為統計單位</b>，不同監護人登記的紀錄皆累計於同一位學生名下。</div></div>`;
  };
  if(baseNav){nav=function(){if(state.page==="contextSelect")return baseNav();if(isParent())return `<nav class="nav">${navBtn("home","🏠","首頁")}${navBtn("practice","⏱️","自主打卡")}${navBtn("record","📊","紀錄")}${navBtn("register","➕","綁定孩子")}</nav>`;return baseNav()}}
  window.parentHomeSummaryReady=true;
})();