(()=>{
  const isParent=()=>state.me?.role==="parent";
  const statusText={present:"出席",late:"遲到",leave:"請假",absent:"缺席",cancelled:"停課"};
  const classText={section:"分部課",ensemble:"合奏課",comprehensive:"綜合課（團體課）",private:"個別課",privateLesson:"個別課"};
  state.parentSemesterAttendance=state.parentSemesterAttendance||null;
  state.parentSemesterExpanded=state.parentSemesterExpanded||"";
  state.parentSemesterLoading=state.parentSemesterLoading||false;
  state.parentSemesterError=state.parentSemesterError||"";

  function classKey(type){return type==="private"||type==="privateLesson"?"privateLesson":type}
  function badgeClass(status){return ["present","late"].includes(status)?"ok":status==="leave"||status==="cancelled"?"warn":"bad"}
  function rateText(x){return !Number(x?.total||0)?"尚無課程":x?.rate==null?"—":`${x.rate}%`}
  function statsLine(x){
    x=x||{};
    if(!Number(x.total||0))return "尚無課程"; const arrived=Math.min(Number(x.total||0),Number(x.attended||0)+Number(x.late||0)); return `到課 ${arrived} / ${x.total||0}${x.late?`｜遲到 ${x.late}`:""}${x.leave?`｜請假 ${x.leave}`:""}${x.absent?`｜缺席 ${x.absent}`:""}`;
  }
  function semesterTitle(d){return `${esc(d.schoolYear||"")}學年度第${esc(d.semester||"")}學期（${esc(d.semesterName||"")}）`}

  async function loadSemesterAttendance(force=false){
    if(!isParent()||!state.student?.studentId)return;
    const sid=String(state.student.studentId);
    if(!force&&state.parentSemesterAttendance?.studentId===sid)return;
    state.parentSemesterLoading=true;state.parentSemesterError="";
    try{
      const y=state.student.schoolYear?`&schoolYear=${encodeURIComponent(state.student.schoolYear)}`:"";
      const s=state.student.semester?`&semester=${encodeURIComponent(state.student.semester)}`:"";
      state.parentSemesterAttendance=await api(`/api/parent-semester-attendance?studentId=${encodeURIComponent(sid)}${y}${s}`);
    }catch(e){state.parentSemesterError=e.message||String(e)}
    state.parentSemesterLoading=false;
  }
  window.reloadParentSemesterAttendance=async function(){
    try{await loadSemesterAttendance(true);render()}catch(e){toast("❌ "+e.message)}
  };
  window.toggleParentSemesterClass=function(type){state.parentSemesterExpanded=state.parentSemesterExpanded===type?"":type;render()};

  function detailRows(type,d){
    if(state.parentSemesterExpanded!==type)return "";
    const rows=(d.records||[]).filter(r=>classKey(r.classType)===type);
    if(!rows.length)return `<div class="notice" style="margin-top:10px">本學期截至目前尚無這一類課程的點名紀錄。</div>`;
    return `<div style="margin-top:10px">${rows.map(r=>`<div class="item"><div><b>${esc(r.eventDate)}｜${esc(classText[r.classType]||classText[classKey(r.classType)]||r.classType)}</b><small>${r.groupName?`${esc(r.groupName)}團`:""}${r.section?`｜${esc(r.section)}`:""}${r.minutes?`｜${Number(r.minutes)} 分鐘`:""}</small></div><span class="badge ${badgeClass(r.status)}">${esc(statusText[r.status]||r.status)}</span></div>`).join("")}</div>`;
  }
  function classCard(type,label,icon,d,desc=""){
    const x=d.stats?.[type]||{};
    return `<div class="card record-subcard"><div class="section-title"><h2>${icon} ${label}</h2><span class="badge ${!Number(x.total||0)?"":(Number(x.absent||0)||Number(x.leave||0)||Number(x.late||0))?"warn":"ok"}">${!Number(x.total||0)?"尚無課程":Number(x.absent||0)||Number(x.leave||0)||Number(x.late||0)?"非全勤":"全勤"}</span></div>${desc?`<div class="muted" style="margin:-4px 0 9px">${esc(desc)}</div>`:""}<div class="notice">${esc(statsLine(x))}</div><button class="secondary" style="width:100%;margin-top:10px" onclick="toggleParentSemesterClass('${type}')">${state.parentSemesterExpanded===type?"收合日期明細":"查看整學期日期明細"}</button>${detailRows(type,d)}</div>`;
  }
  function scoreText(v,max){return v==null?"待資料":`${Math.round(Number(v)*100)/100}/${max}`}
  function semesterScoreHtml(){
    const d=state.parentSemesterAttendance;
    if(!d||String(d.studentId)!==String(state.student?.studentId||""))return "";
    const s=d.semesterScore||{},months=Array.isArray(d.monthlyScores)?d.monthlyScores:[],policy=d.scorePolicy||{};
    const total=s.total20==null?"待完成":`${Math.round(Number(s.total20)*100)/100}/20`;
    const source="個別課加分平均";
    const performanceNote=`本學期共完成個課 ${Number(s.privateLessonCompleted||0)} 堂；每月完成 4 次 = 5 分，未完成個課的月份為 0 分，再將 9～12 月月分數平均，最高 5 分。`;
    const rows=months.map(x=>{
      const p=x.practice||{},a=x.attendance||{},pl=x.privateLesson||{};
      const monthTotal=p.score10==null||a.score5==null||pl.score5==null?null:Math.round((Number(p.score10)+Number(a.score5)+Number(pl.score5))*100)/100;
      return `<div class="semester-score-month ${x.future?"is-future":""}">
        <b>${esc(String(x.month||"").slice(5))}月</b>
        <span>自主 ${scoreText(p.score10,10)}</span>
        <span>點名 ${scoreText(a.score5,5)}</span>
        <span>個課 ${pl.score5==null?"—":scoreText(pl.score5,5)}（${Number(pl.completed||0)}/${Number(pl.target||4)} 次）</span>
        <strong>${monthTotal==null?"—":monthTotal+"/20"}</strong>
      </div>`;
    }).join("");
    return `<section class="semester-score-panel">
      <div class="semester-score-head">
        <div><b>🏅 本學期 20% 成績總覽</b><small>自主練習 10%＋日常上課出勤 5%＋個別課加分 5%</small></div>
        <span class="semester-score-total">${total}</span>
      </div>
      <div class="semester-score-components">
        <div><b>${scoreText(s.practice10,10)}</b><small>自主練習平均</small></div>
        <div><b>${scoreText(s.attendance5,5)}</b><small>課程點名平均</small></div>
        <div><b>${scoreText(s.performance5,5)}</b><small>${esc(source)}</small></div>
      </div>
      <div class="notice" style="margin-top:10px">
        正式計分月份：${(policy.months||[]).map(m=>String(m).slice(5)+"月").join("、")}，各月分數平均後換算學期 20%。<br>
        自主練習 10%：系統依有效練習天數自動換算，老師不用另外評分。<br>
        課程點名 5%：只計分部課、合奏課、綜合課；個別課不納入此 5%。停課與核准請假不列入扣分分母，遲到仍算到課。<br>
        個別課加分 5%：每月完成 4 次 = 5 分；未完成個課的月份為 0 分，上學期以 9～12 月四個月平均，最高 5 分。<br>
        家長對個課老師的星級／評論只是師資回饋，不會計入學生分數。
      </div>
      <details class="semester-score-months"><summary>查看各月自主練習／點名／個課分數</summary>${rows}</details>
      <small class="semester-score-foot">${performanceNote}<br>${s.status==="final"?(s.complete?"本學期正式計分月份已結束，以上為正式成績。":"正式計分月份已結束，但仍有必要資料尚未完成，因此總分暫不定案。"):`本學期進行中，目前為暫估；自主練習已計 ${Number(s.practiceMonths||0)}/${Number(s.monthsPlanned||3)} 月、課程點名已計 ${Number(s.attendanceMonths||0)}/${Number(s.monthsPlanned||3)} 月。`}</small>
    </section>`;
  }
    window.parentSemesterScorePanel=semesterScoreHtml;
  function semesterAttendanceHtml(){
    if(!state.student)return "";
    if(state.parentSemesterLoading)return `<div class="card"><h2>📅 本學期出勤摘要</h2><div class="notice">正在整理本學期出勤資料…</div></div>`;
    if(state.parentSemesterError)return `<div class="card"><h2>📅 本學期出勤紀錄</h2><div class="error">${esc(state.parentSemesterError)}</div><button class="secondary" style="width:100%;margin-top:10px" onclick="reloadParentSemesterAttendance()">重新讀取</button></div>`;
    const d=state.parentSemesterAttendance;
    if(!d||String(d.studentId)!==String(state.student.studentId)){
      setTimeout(()=>loadSemesterAttendance(true).then(render),0);
      return `<div class="card"><h2>📅 本學期出勤紀錄</h2><div class="notice">正在整理本學期出勤資料…</div></div>`;
    }
    const parts=["section","ensemble","comprehensive"].map(k=>d.stats?.[k]||{});
    const o=parts.reduce((a,x)=>{for(const k of ["present","late","leave","absent","cancelled","total","attended"])a[k]+=Number(x[k]||0);return a},{present:0,late:0,leave:0,absent:0,cancelled:0,total:0,attended:0});
    return `<section class="record-section record-section-attendance">
      <div class="record-section-head">
        <div class="record-section-icon">📅</div>
        <div><b>本學期出勤紀錄</b><small>課程點名 5% 只依分部課、合奏課、綜合課正式點名比例換算</small></div>
      </div>
      <div class="card hero record-section-summary"><div class="section-title"><h2>計分出勤總覽</h2><span class="badge ${Number(o.absent||0)||Number(o.leave||0)||Number(o.late||0)?"warn":"ok"}">${Number(o.absent||0)||Number(o.leave||0)||Number(o.late||0)?"非全勤":"紀錄正常"}</span></div><div class="notice"><b>${semesterTitle(d)}</b><br>統計至 ${esc(d.asOf)}<br>${esc(statsLine(o))}<br><br>此 5% 只統計分部課、合奏課與綜合課。遲到仍計入到課，核准請假不列入計分分母，無故缺席才會影響分數。個別課另列紀錄，並依每月完成次數計算另外的加分 5%。</div><div class="muted" style="margin-top:10px;text-align:right">最近更新：${esc(d.asOf)}　<button class="secondary" style="padding:6px 10px;margin:0" onclick="reloadParentSemesterAttendance()">↻ 重新整理</button></div></div>
      ${classCard("section","分部課出勤","🎼",d)}
      ${classCard("ensemble","合奏課出勤","🎻",d)}
      ${classCard("comprehensive","綜合課出勤","🎶",d)}
      ${classCard("privateLesson","個別課出勤","🧾",d,"個別課不納入課程點名 5%；完成個課次數另計加分 5%，上學期每月 4 次 = 5 分，9～12 月四個月取平均。")}
    </section>`;
  }

  if(typeof recordPage==="function"){
    const baseRecordPage=recordPage;
    recordPage=function(){const html=baseRecordPage();return isParent()?html+semesterAttendanceHtml():html};
  }

  const previousGo=go;
  go=async function(p){
    if(p==="record"&&isParent()){
      const sid=String(state.student?.studentId||"");
      if(sid&&String(state.parentSemesterAttendance?.studentId||"")!==sid){
        state.parentSemesterLoading=true;
        try{await loadSemesterAttendance(true)}finally{state.parentSemesterLoading=false}
      }
    }
    return previousGo(p);
  };
})();
