(()=>{
  const isParent=()=>state.me?.role==="parent";
  const baseHome=typeof home==="function"?home:null;
  const baseNav=typeof nav==="function"?nav:null;

  function localDate(){
    const d=new Date(),y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0");
    return `${y}-${m}-${day}`;
  }
  function shortDate(v){
    const s=String(v||"");
    const m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m?`${Number(m[2])}/${Number(m[3])}`:s;
  }
  function attendanceKpi(label,present,total,sub=""){
    const p=Number(present||0),t=Number(total||0);
    if(t===0)return `<div class="kpi"><b style="font-size:18px">尚無課程</b><span>${esc(label)}</span>${sub?`<small style="display:block;margin-top:3px;color:var(--muted);font-weight:700">${esc(sub)}</small>`:""}</div>`;
    const missed=Math.max(0,t-p);
    const status=missed===0?"🟢 全勤":`🟡 缺席 ${missed} 次`;
    return `<div class="kpi"><b>${p} / ${t}</b><span>${esc(label)}</span><small style="display:block;margin-top:3px;color:var(--muted);font-weight:700">${status}${sub?`｜${esc(sub)}`:""}</small></div>`;
  }
  function latestPractice(){
    const rows=[...(state.practice||[])].filter(x=>x?.practiceDate).sort((a,b)=>String(b.practiceDate).localeCompare(String(a.practiceDate))||String(b.endTime||b.startTime||"").localeCompare(String(a.endTime||a.startTime||"")));
    return rows[0]||null;
  }
  function todayPractices(){
    const today=localDate();
    return (state.practice||[]).filter(x=>String(x.practiceDate||"").slice(0,10)===today);
  }

  home=function(){
    if(!isParent()||!state.student||!baseHome)return baseHome?baseHome():"";
    const s=state.summary||{};
    const sectionName=String(state.student.section||"").trim();
    const latest=latestPractice(),todayRows=todayPractices();
    const todayMinutes=todayRows.reduce((n,x)=>n+Number(x.minutes||0),0);
    const latestText=latest?`${shortDate(latest.practiceDate)}・${Number(latest.minutes||0)} 分鐘`:"尚無紀錄";
    const todayDone=todayRows.length>0;
    const action=todayDone
      ?`<div class="notice"><b>✅ 今天已完成自主練習</b><br><span style="display:block;margin-top:6px">${todayMinutes} 分鐘｜今天已有 ${todayRows.length} 筆紀錄</span></div>
        <button class="primary" onclick="go('record')">查看今日／近期紀錄</button>
        <button class="secondary" style="width:100%;margin-top:10px" onclick="go('practice')">＋ 補登另一筆練習</button>`
      :`<div class="notice"><b>🎻 今天尚未有自主練習紀錄</b><br><span style="display:block;margin-top:6px">完成練習後，記得幫${esc(state.student.name)}留下紀錄。</span></div>
        <button class="primary" onclick="go('practice')">立即自主練習打卡</button>`;

    return `<div class="card hero">
      <div class="student"><div class="studentleft"><div class="avatar">${esc(state.student.name?.[0]||"學")}</div><div><div class="name">${esc(state.student.name)}</div><div class="muted">${esc(state.student.groupName)}團${sectionName?`｜${esc(sectionName)}`:""}｜${esc(state.student.instrument)}｜${esc(state.student.grade)}</div></div></div><div class="pill">${new Date().getMonth()+1}月</div></div>
      <div style="margin-top:14px;font-weight:900">本月自主練習</div>
      <div class="grid" style="margin-top:8px"><div class="kpi"><b>${s.practiceQualifiedDays||0} 天</b><span>練習達標天數</span></div><div class="kpi"><b>${s.practiceMinutes||0} 分鐘</b><span>累計練習時間</span></div></div>
      <div class="notice" style="margin-top:10px"><b>最近一次自主練習</b><br>${esc(latestText)}</div>

      <div style="margin-top:16px;font-weight:900">本月上課出勤</div>
      <div class="muted" style="font-size:12px;margin-top:3px">到課 / 應到；遲到仍計入到課</div>
      <div class="grid" style="margin-top:8px">
        ${attendanceKpi("分部課",s.sectionPresent,s.sectionTotal,sectionName||"目前分部")}
        ${attendanceKpi("合奏課",s.ensemblePresent,s.ensembleTotal,"A／B 團合奏")}
        ${attendanceKpi("綜合課（團體課）",s.comprehensivePresent,s.comprehensiveTotal,"A／B／儲備團")}
        ${attendanceKpi("個別課",s.privatePresent,s.privateTotal,"老師登記")}
      </div>
      <button class="secondary" style="width:100%;margin-top:12px" onclick="go('record')">查看整學期上課紀錄 ›</button>
    </div>
    <div class="card"><h2>今天要做什麼？</h2>${action}</div>\n    <div class="card"><h2>📌 自主練習登記提醒</h2><div class="notice">自主練習紀錄將作為後續練習統計與成績計算依據。為保障學生權益，請家長於每次練習完成後確認紀錄已成功送出，並可至「紀錄」頁再次核對。<br><br><b>達標規則：單日累計自主練習達 15 分鐘以上，計為 1 個達標日；同一天多筆紀錄的分鐘數會累計，但達標日仍以 1 天計算。</b><br><br>若主要登記之家長因出差、工作或其他因素無法操作，可由另一位已綁定之監護人登入完成登記。<b>系統以「學生」為統計單位</b>，不同監護人登記的紀錄皆累計於同一位學生名下。</div></div>`;
  };

  if(baseNav){
    nav=function(){
      if(isParent())return `<nav class="nav">${navBtn("home","🏠","首頁")}${navBtn("practice","⏱️","自主打卡")}${navBtn("record","📊","紀錄")}${navBtn("register","➕","綁定孩子")}</nav>`;
      return baseNav();
    };
  }
})();