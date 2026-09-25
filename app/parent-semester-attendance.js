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
  function semesterScoreCard(d){
    const s=d.semesterScore||{},p=s.practice||{},sec=s.sectionAttendance||{},priv=s.privateLessonBonus||{};
    const privateText=Number(priv.total||0)?`${priv.score||0}/5｜到課 ${priv.attended||0}/${priv.total||0}`:"未參加｜0 分（不扣分）";
    return `<div class="card hero"><div class="section-title"><h2>📊 期末成長評量｜20 分</h2><span class="badge ok">${Number(s.total||0).toFixed(2)} / 20</span></div>
      <div class="notice"><b>本學期採整學期累計，不以單一月份決定期末成績。</b><br><br>
      🎻 自主練習：${Number(p.score||0).toFixed(2)} / 10<br>
      <span class="muted">練習日期 ${p.days||0} / ${p.targetDays||0} 天；分鐘數不計分</span><br><br>
      🎼 分部課出席：${Number(sec.score||0).toFixed(2)} / 5<br>
      <span class="muted">到課 ${sec.attended||0} / ${sec.total||0}${sec.rate==null?"":`｜${sec.rate}%`}</span><br><br>
      🧾 個別課加分：${privateText}<br>
      <span class="muted">個別課非強制，未參加不扣分；有參加者依到課率最高加 5 分。</span></div>
      <small style="display:block;margin-top:10px;color:var(--muted)">期末成長評量最高 20 分＝自主練習 10 分＋分部課出席 5 分＋個別課加分最高 5 分。</small>
    </div>`;
  }
  function semesterAttendanceHtml(){
    if(!state.student)return "";
    if(state.parentSemesterLoading)return `<div class="card"><h2>📅 本學期出勤摘要</h2><div class="notice">正在整理本學期出勤資料…</div></div>`;
    if(state.parentSemesterError)return `<div class="card"><h2>📅 本學期出勤紀錄</h2><div class="error">${esc(state.parentSemesterError)}</div><button class="secondary" style="width:100%;margin-top:10px" onclick="reloadParentSemesterAttendance()">重新讀取</button></div>`;
    const d=state.parentSemesterAttendance;
    if(!d||String(d.studentId)!==String(state.student.studentId)){
      setTimeout(()=>loadSemesterAttendance(true).then(render),0);
      return `<div class="card"><h2>📅 本學期出勤紀錄</h2><div class="notice">正在整理本學期出勤資料…</div></div>`;
    }
    const o=d.stats?.overall||{};
    return `<section class="record-section record-section-attendance">${semesterScoreCard(d)}
      <div class="record-section-head">
        <div class="record-section-icon">📅</div>
        <div><b>本學期出勤紀錄</b><small>只看點名與到課狀態：分部、合奏、綜合課與個別課出勤</small></div>
      </div>
      <div class="card hero record-section-summary"><div class="section-title"><h2>出勤總覽</h2><span class="badge ${Number(o.absent||0)||Number(o.leave||0)||Number(o.late||0)?"warn":"ok"}">${Number(o.absent||0)||Number(o.leave||0)||Number(o.late||0)?"非全勤":"紀錄正常"}</span></div><div class="notice"><b>${semesterTitle(d)}</b><br>統計至 ${esc(d.asOf)}<br>${esc(statsLine(o))}<br><br>此區只統計實際點名；遲到、請假與缺席分開標示，不包含個別課的上課內容與家長星級評價。</div><div class="muted" style="margin-top:10px;text-align:right">最近更新：${esc(d.asOf)}　<button class="secondary" style="padding:6px 10px;margin:0" onclick="reloadParentSemesterAttendance()">↻ 重新整理</button></div></div>
      ${classCard("section","分部課出勤","🎼",d)}
      ${classCard("ensemble","合奏課出勤","🎻",d)}
      ${classCard("comprehensive","綜合課出勤","🎶",d)}
      ${classCard("privateLesson","個別課出勤","🧾",d,"此處只顯示個別課到課／請假／缺席；課程內容與星級評價請看下方「個別課專區」。")}
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
