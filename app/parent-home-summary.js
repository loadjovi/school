(()=>{
  const isParent=()=>state.me?.role==="parent";
  const baseHome=typeof home==="function"?home:null;
  function attendanceKpi(label,present,total,sub=""){
    return `<div class="kpi"><b>${Number(present||0)} / ${Number(total||0)}</b><span>${esc(label)}</span>${sub?`<small style="display:block;margin-top:3px;color:var(--muted);font-weight:700">${esc(sub)}</small>`:""}</div>`;
  }
  home=function(){
    if(!isParent()||!state.student||!baseHome)return baseHome?baseHome():"";
    const s=state.summary||{},rate=Math.round((s.practiceRate||0)*1000)/10;
    const sectionName=String(state.student.section||"").trim();
    return `<div class="card hero">
      <div class="student"><div class="studentleft"><div class="avatar">${esc(state.student.name?.[0]||"學")}</div><div><div class="name">${esc(state.student.name)}</div><div class="muted">${esc(state.student.groupName)}團${sectionName?`｜${esc(sectionName)}`:""}｜${esc(state.student.instrument)}｜${esc(state.student.grade)}</div></div></div><div class="pill">${new Date().getMonth()+1}月</div></div>
      <div class="grid"><div class="kpi"><b>${s.practiceQualifiedDays||0}</b><span>自主練習達標天數</span></div><div class="kpi"><b>${s.practiceMinutes||0}</b><span>累計練習分鐘</span></div></div>
      <div class="notice" style="margin-top:12px"><b>本月上課出勤</b><br>數字格式：<b>到課 / 應到</b>（遲到仍計入到課）</div>
      <div class="grid" style="margin-top:10px">
        ${attendanceKpi("分部課",s.sectionPresent,s.sectionTotal,sectionName||"目前分部")}
        ${attendanceKpi("合奏課",s.ensemblePresent,s.ensembleTotal,"A／B 團合奏")}
        ${attendanceKpi("綜合課（團體課）",s.comprehensivePresent,s.comprehensiveTotal,"A／B／儲備團")}
        ${attendanceKpi("個別課",s.privatePresent,s.privateTotal,"老師登記")}
      </div>
      <div style="margin-top:12px;font-size:12px;font-weight:800">自主練習達標率 <span style="float:right">${rate}%</span></div><div class="progress"><i style="width:${Math.min(rate,100)}%"></i></div>
      <button class="secondary" style="width:100%;margin-top:12px" onclick="go('record')">📊 查看整學期上課紀錄</button>
    </div>
    <div class="card"><h2>今天要做什麼？</h2>
      <div class="notice"><b>📌 自主練習登記提醒</b><br><br>為避免練習紀錄遺漏，影響後續成績統計與學生權益，請家長確認每次練習完成後皆已成功送出紀錄。<br><br>若主要登記之家長因出差、工作或其他因素無法操作，請由另一位已綁定之監護人登入系統完成自主練習登記。<br><br><b>系統以「學生」為統計單位</b>，不同監護人所填寫的自主練習紀錄會累計於同一位學生名下，不會分開計算。</div>
      <button class="primary" onclick="go('practice')">立即自主練習打卡</button>
    </div>`;
  };
})();
