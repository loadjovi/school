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
  function rateText(x){return x?.rate==null?"—":`${x.rate}%`}
  function statsLine(x){
    x=x||{};
    return `應到 ${x.total||0}｜到課 ${x.attended||0}｜遲到 ${x.late||0}｜請假 ${x.leave||0}｜缺席 ${x.absent||0}`;
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
  function classCard(type,label,icon,d){
    const x=d.stats?.[type]||{};
    return `<div class="card"><div class="section-title"><h2>${icon} ${label}</h2><span class="badge ${x.rate==null?"warn":x.rate>=90?"ok":x.rate>=75?"warn":"bad"}">${rateText(x)}</span></div><div class="notice">${esc(statsLine(x))}</div><button class="secondary" style="width:100%;margin-top:10px" onclick="toggleParentSemesterClass('${type}')">${state.parentSemesterExpanded===type?"收合日期明細":"查看整學期日期明細"}</button>${detailRows(type,d)}</div>`;
  }
  function semesterAttendanceHtml(){
    if(!state.student)return "";
    if(state.parentSemesterLoading)return `<div class="card"><h2>📅 整學期上課紀錄</h2><div class="notice">正在整理本學期出勤資料…</div></div>`;
    if(state.parentSemesterError)return `<div class="card"><h2>📅 整學期上課紀錄</h2><div class="error">${esc(state.parentSemesterError)}</div><button class="secondary" style="width:100%;margin-top:10px" onclick="reloadParentSemesterAttendance()">重新讀取</button></div>`;
    const d=state.parentSemesterAttendance;
    if(!d||String(d.studentId)!==String(state.student.studentId)){
      setTimeout(()=>loadSemesterAttendance(true).then(render),0);
      return `<div class="card"><h2>📅 整學期上課紀錄</h2><div class="notice">正在整理本學期出勤資料…</div></div>`;
    }
    const o=d.stats?.overall||{};
    return `<div class="card hero"><div class="section-title"><h2>📅 整學期上課紀錄</h2><span class="badge ${o.rate==null?"warn":o.rate>=90?"ok":o.rate>=75?"warn":"bad"}">${rateText(o)}</span></div><div class="notice"><b>${semesterTitle(d)}</b><br>統計期間：${esc(d.start)} ～ ${esc(d.end)}（截至 ${esc(d.asOf)}）<br>${esc(statsLine(o))}<br><br>「綜合課」即本學期的「弦樂團體課」，系統只計算一次，不重複列入。</div><button class="secondary" style="width:100%;margin-top:10px" onclick="reloadParentSemesterAttendance()">🔄 更新學期紀錄</button></div>
      ${classCard("section","分部課","🎼",d)}
      ${classCard("ensemble","合奏課","🎻",d)}
      ${classCard("comprehensive","綜合課（團體課）","🎶",d)}
      ${classCard("privateLesson","個別課","👤",d)}`;
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
