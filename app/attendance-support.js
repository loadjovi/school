(()=>{
  const statusText={present:"出席",late:"遲到",leave:"請假",absent:"缺席",cancelled:"停課"};
  const classText={section:"分部課",ensemble:"合奏課",comprehensive:"綜合課",private:"個別課",privateLesson:"個別課"};
  const isTeacher=()=>!!state.me?.capabilities?.teacherSettings;
  const canView=()=>state.me?.role==="admin"||isTeacher();
  state.attendanceMonth=state.attendanceMonth||new Date().toISOString().slice(0,7);
  state.attendanceData=state.attendanceData||null;
  state.attendanceGroup=state.attendanceGroup||"全部";
  state.attendanceSelected=state.attendanceSelected||"";

  function csvCell(v){const s=String(v??"");return /[",\r\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s}
  function downloadCsv(filename,rows){
    const content="\uFEFF"+rows.map(r=>r.map(csvCell).join(",")).join("\r\n");
    const blob=new Blob([content],{type:"text/csv;charset=utf-8"});
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }
  function followRows({date,classType,groupName,section,students,prefix}){
    const rows=[["日期","課程類型","團別","分部","學生姓名","年級","樂器","出勤狀態","點名老師"]];
    for(const s of students){
      const el=$(prefix+s.studentId);if(!el)continue;
      const st=String(el.value||"");
      if(!["leave","absent"].includes(st))continue;
      rows.push([date,classText[classType]||classType,groupName,section||"四分部合班",s.name,s.grade,s.instrument,statusText[st]||st,state.me.displayName||state.me.email]);
    }
    return rows;
  }
  window.exportSectionFollowup=function(){
    const assignments=Array.isArray(state.me.assignments)?state.me.assignments:[];
    const current=assignments[Math.min(window.__sectionClassIndex||0,Math.max(assignments.length-1,0))]||assignments[0];
    if(!current){toast("尚未設定分部課");return}
    const groupName=String(current.groupName||current.group||""),section=String(current.section||"");
    const students=state.students.filter(s=>String(s.groupName)===groupName&&String(s.section||"待確認")===section);
    const date=$("sDate")?.value||new Date().toISOString().slice(0,10);
    const rows=followRows({date,classType:"section",groupName,section,students,prefix:"att_"});
    if(rows.length===1){toast("✅ 本次沒有請假／缺席學生");return}
    downloadCsv(`${date}_${groupName}團_${section}_未到追蹤.csv`,rows);toast(`📥 已匯出 ${rows.length-1} 位未到學生`);
  };
  window.exportEnsembleFollowup=function(){
    const groups=Array.isArray(state.me.ensembleGroups)?state.me.ensembleGroups.filter(x=>["A","B"].includes(x)):[];
    const g=groups[Math.min(window.__ensembleGroupIndex||0,Math.max(groups.length-1,0))];
    if(!g){toast("尚未設定合奏課");return}
    const students=state.students.filter(s=>String(s.groupName)===g);
    const date=$("eDate")?.value||new Date().toISOString().slice(0,10);
    const rows=followRows({date,classType:"ensemble",groupName:g,section:"四分部合班",students,prefix:"ens_"});
    if(rows.length===1){toast("✅ 本次沒有請假／缺席學生");return}
    downloadCsv(`${date}_${g}團_合奏課_未到追蹤.csv`,rows);toast(`📥 已匯出 ${rows.length-1} 位未到學生`);
  };

  const baseSectionPage=sectionPage;
  sectionPage=function(){
    const html=baseSectionPage();
    if(!state.me?.capabilities?.section)return html;
    return html+`<div class="card"><h2>📤 行政追蹤</h2><div class="notice">點名完成後可匯出本次「請假／缺席」學生 CSV，交由行政老師確認未到原因與後續追蹤。</div><button class="secondary" style="width:100%;margin-top:12px" onclick="exportSectionFollowup()">匯出未到學生名單 CSV</button></div>`;
  };
  if(typeof ensemblePage==="function"){
    const baseEnsemblePage=ensemblePage;
    ensemblePage=function(){
      const html=baseEnsemblePage();
      if(!state.me?.capabilities?.ensemble)return html;
      return html+`<div class="card"><h2>📤 行政追蹤</h2><div class="notice">點名完成後可匯出本次「請假／缺席」學生 CSV，交由行政老師追蹤。</div><button class="secondary" style="width:100%;margin-top:12px" onclick="exportEnsembleFollowup()">匯出未到學生名單 CSV</button></div>`;
    };
  }

  async function loadAttendance(){
    if(!canView())return;
    state.attendanceData=await api(`/api/attendance-report?month=${encodeURIComponent(state.attendanceMonth)}`);
  }
  window.changeAttendanceMonth=async function(v){state.attendanceMonth=String(v||new Date().toISOString().slice(0,7));try{await loadAttendance();render()}catch(e){toast("❌ "+e.message)}};
  window.changeAttendanceGroup=function(v){state.attendanceGroup=String(v||"全部");render()};
  window.showAttendanceDetail=function(id){state.attendanceSelected=state.attendanceSelected===String(id)?"":String(id);render()};
  function filteredItems(){
    const items=state.attendanceData?.items||[];
    return items.filter(x=>state.attendanceGroup==="全部"||String(x.groupName)===state.attendanceGroup);
  }
  function rateBadge(rate){if(rate===null||rate===undefined)return `<span class="badge warn">—</span>`;const c=rate>=90?"ok":rate>=75?"warn":"bad";return `<span class="badge ${c}">${rate}%</span>`}
  function statLine(label,x){return `${label} ${x?.attended||0}/${x?.total||0}`}
  function detailHtml(id){
    if(state.attendanceSelected!==String(id))return "";
    const records=(state.attendanceData?.records||[]).filter(r=>String(r.studentId)===String(id));
    if(!records.length)return `<div class="notice" style="margin-top:10px">本月尚無點名紀錄。</div>`;
    return `<div style="margin-top:10px">${records.map(r=>`<div class="item"><div><b>${esc(r.eventDate)}｜${esc(classText[r.classType]||r.classType)}</b><small>${esc(r.groupName||"")}團${r.section?`｜${esc(r.section)}`:""}<br>${esc(r.teacher||"")}</small></div><span class="badge ${["present","late"].includes(r.status)?"ok":r.status==="leave"?"warn":"bad"}">${esc(statusText[r.status]||r.status)}</span></div>`).join("")}</div>`;
  }
  window.exportAttendanceReport=function(){
    const items=filteredItems();
    if(!items.length){toast("目前沒有可匯出的學生出勤資料");return}
    const rows=[["月份","學生姓名","年級","團別","分部","樂器","分部課出席","分部課應到","合奏課出席","合奏課應到","綜合課出席","綜合課應到","個別課出席","個別課應到","遲到","請假","缺席","總出勤率"]];
    for(const x of items)rows.push([state.attendanceMonth,x.name,x.grade,x.groupName,x.section,x.instrument,x.sectionStats.attended,x.sectionStats.total,x.ensembleStats.attended,x.ensembleStats.total,x.comprehensiveStats?.attended||0,x.comprehensiveStats?.total||0,x.privateStats.attended,x.privateStats.total,x.overall.late,x.overall.leave,x.overall.absent,x.attendanceRate==null?"":`${x.attendanceRate}%`]);
    downloadCsv(`${state.attendanceMonth}_弦樂團學生出勤表.csv`,rows);toast("📥 已匯出學生出勤表");
  };
  function attendancePage(){
    const d=state.attendanceData;
    if(!d)return `<div class="card"><h2>📋 學生出勤表</h2><div class="notice">正在讀取出勤資料…</div></div>`;
    const groups=["全部",...new Set((d.items||[]).map(x=>String(x.groupName)).filter(Boolean))];
    const items=filteredItems();
    const total=items.reduce((n,x)=>n+Number(x.overall.total||0),0),attended=items.reduce((n,x)=>n+Number(x.overall.attended||0),0),absent=items.reduce((n,x)=>n+Number(x.overall.absent||0),0),leave=items.reduce((n,x)=>n+Number(x.overall.leave||0),0);
    const rate=total?Math.round(attended/total*1000)/10:null;
    return `<div class="card hero"><h2>📋 學生出勤表</h2><div class="row2"><div><label>月份</label><input type="month" value="${esc(state.attendanceMonth)}" onchange="changeAttendanceMonth(this.value)"></div><div><label>團別</label><select onchange="changeAttendanceGroup(this.value)">${groups.map(g=>`<option value="${esc(g)}" ${g===state.attendanceGroup?"selected":""}>${esc(g==="全部"?"全部團別":g+"團")}</option>`).join("")}</select></div></div><div class="grid"><div class="kpi"><b>${items.length}</b><span>授課學生</span></div><div class="kpi"><b>${total}</b><span>應到人次</span></div><div class="kpi"><b>${attended}</b><span>實到人次</span></div><div class="kpi"><b>${rate==null?"—":rate+"%"}</b><span>到課率</span></div><div class="kpi"><b>${leave}</b><span>請假人次</span></div><div class="kpi"><b>${absent}</b><span>缺席人次</span></div></div><button class="secondary" style="width:100%;margin-top:12px" onclick="exportAttendanceReport()">匯出本月出勤表 CSV</button></div>
      <div class="card"><h2>${esc(state.attendanceMonth)} 出勤概況</h2><div class="notice">統計單位：學生為人數；應到、實到、請假、缺席皆為「人次」。到課率＝（出席＋遲到）÷應到人次；停課不列入應到。分部課、合奏課、綜合課、個別課分開統計。</div></div>
      ${items.map(x=>`<div class="card"><div class="student"><div class="studentleft"><div class="avatar">${esc(x.name?.[0]||"學")}</div><div><div class="name">${esc(x.name)}</div><div class="muted">${esc(x.groupName)}團｜${esc(x.section||"待確認")}｜${esc(x.instrument)}｜${esc(x.grade)}</div></div></div>${rateBadge(x.attendanceRate)}</div><div class="notice" style="margin-top:12px">${esc(statLine("分部課",x.sectionStats))}　｜　${esc(statLine("合奏課",x.ensembleStats))}<br>${esc(statLine("綜合課",x.comprehensiveStats))}　｜　${esc(statLine("個別課",x.privateStats))}<br><b>應到 ${x.overall.total||0}｜實到 ${x.overall.attended||0}</b><br>遲到 ${x.overall.late||0} 人次　請假 ${x.overall.leave||0} 人次　缺席 ${x.overall.absent||0} 人次</div><button class="secondary" style="width:100%;margin-top:10px" onclick="showAttendanceDetail('${esc(x.studentId)}')">${state.attendanceSelected===String(x.studentId)?"收合明細":"查看點名明細"}</button>${detailHtml(x.studentId)}</div>`).join("")||`<div class="card"><div class="notice">本月沒有可查看的學生資料。</div></div>`}`;
  }

  const baseNav=nav;
  nav=function(){
    if(state.me?.role==="admin")return `<nav class="nav">${navBtn("admin","📈","Dashboard")}${navBtn("students","👥","學生主檔")}${navBtn("attendance","📋","出勤")}${navBtn("scores","🧮","考核")}</nav>`;
    if(isTeacher()){
      const c=state.me.capabilities||{},items=[];
      if(c.section)items.push(navBtn("section","🎼","分部課"));
      if(c.ensemble)items.push(navBtn("ensemble","🎻","合奏課"));
      if(c.private)items.push(navBtn("private","👤","個別課"));
      items.push(navBtn("attendance","📋","出勤"));
      if(items.length<4)items.push(navBtn("help","ℹ️","說明"));
      while(items.length<4)items.push("<button></button>");
      return `<nav class="nav">${items.slice(0,4).join("")}</nav>`;
    }
    return baseNav();
  };

  const baseGo=go;
  go=async function(p){
    if(p==="attendance"&&canView()){
      state.page="attendance";
      try{await loadAttendance()}catch(e){toast("❌ "+e.message)}
      render();return;
    }
    return baseGo(p);
  };
  const baseRender=render;
  render=function(){
    if(state.page==="attendance"&&canView()){
      document.getElementById("app").innerHTML=shell(attendancePage());return;
    }
    return baseRender();
  };
})();