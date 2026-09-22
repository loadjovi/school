(()=>{
  const statusText={present:"出席",late:"遲到",leave:"請假",absent:"缺席",cancelled:"停課"};
  const classText={section:"分部課",ensemble:"合奏課",comprehensive:"綜合課",private:"個別課",privateLesson:"個別課"};
  const isTeacher=()=>!!state.me?.capabilities?.teacherSettings;
  const canView=()=>state.me?.role==="admin"||isTeacher();
  state.attendanceMonth=state.attendanceMonth||new Date().toISOString().slice(0,7);
  state.attendanceData=state.attendanceData||null;
  state.attendanceGroup=state.attendanceGroup||"全部";
  state.attendanceSelected=state.attendanceSelected||"";
  state.attendanceSearch=state.attendanceSearch||"";
  state.attendanceView=state.attendanceView||"all";
  state.attendancePageNum=state.attendancePageNum||1;
  state.attendancePageSize=15;

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
  window.changeAttendanceMonth=async function(v){state.attendanceMonth=String(v||new Date().toISOString().slice(0,7));state.attendancePageNum=1;state.attendanceSelected="";try{await loadAttendance();render()}catch(e){toast("❌ "+e.message)}};
  window.changeAttendanceGroup=function(v){state.attendanceGroup=String(v||"全部");state.attendancePageNum=1;state.attendanceSelected="";render()};
  window.changeAttendanceSearch=function(v){state.attendanceSearch=String(v||"").trim();state.attendancePageNum=1;state.attendanceSelected="";render()};
  window.changeAttendanceView=function(v){state.attendanceView=String(v||"all");state.attendancePageNum=1;state.attendanceSelected="";render()};
  window.changeAttendancePage=function(v){const total=Math.max(1,Math.ceil(filteredItems().length/state.attendancePageSize));state.attendancePageNum=Math.min(total,Math.max(1,Number(v)||1));state.attendanceSelected="";render();setTimeout(()=>document.getElementById("attendanceStudentList")?.scrollIntoView({behavior:"smooth",block:"start"}),20)};
  window.showAttendanceDetail=function(id){state.attendanceSelected=state.attendanceSelected===String(id)?"":String(id);render()};
  function filteredItems(){
    const q=String(state.attendanceSearch||"").toLowerCase();
    return (state.attendanceData?.items||[]).filter(x=>{
      if(state.attendanceGroup!=="全部"&&String(x.groupName)!==state.attendanceGroup)return false;
      const unusual=Number(x.overall?.late||0)+Number(x.overall?.leave||0)+Number(x.overall?.absent||0);
      if(state.attendanceView==="changes"&&unusual===0)return false;
      if(state.attendanceView==="full"&&unusual>0)return false;
      if(q){const hay=[x.name,x.groupName,x.section,x.instrument,x.grade].map(v=>String(v||"").toLowerCase()).join(" ");if(!hay.includes(q))return false;}
      return true;
    });
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
    const rate=total?Math.round(attended/total*1000)/10:null,pageSize=state.attendancePageSize,totalPages=Math.max(1,Math.ceil(items.length/pageSize)),page=Math.min(totalPages,Math.max(1,state.attendancePageNum||1)),pageItems=items.slice((page-1)*pageSize,page*pageSize);
    state.attendancePageNum=page;
    const rows=pageItems.map(x=>{
      const selected=state.attendanceSelected===String(x.studentId),late=Number(x.overall?.late||0),lv=Number(x.overall?.leave||0),ab=Number(x.overall?.absent||0),changes=late+lv+ab;
      return `<div style="padding:11px 0;border-bottom:1px solid var(--line)">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
          <div style="min-width:0;flex:1">
            <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap"><b style="font-size:15px">${esc(x.name)}</b><span class="muted">${esc(x.groupName)}團｜${esc(x.section||"待確認")}｜${esc(x.instrument)}｜${esc(x.grade)}</span></div>
            <small style="display:block;margin-top:5px;color:#52605a">${esc(statLine("分部",x.sectionStats))}｜${esc(statLine("合奏",x.ensembleStats))}｜${esc(statLine("綜合",x.comprehensiveStats))}｜${esc(statLine("個課",x.privateStats))}</small>
            <small style="display:block;margin-top:4px;color:${changes?"#6b756f":"#166534"}">${changes?`遲到 ${late}｜請假 ${lv}｜缺席 ${ab}`:"本月無遲到／請假／缺席"}</small>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:7px;flex:0 0 auto">${rateBadge(x.attendanceRate)}<button class="secondary" style="width:auto;padding:6px 9px;margin:0;font-size:11px" onclick="showAttendanceDetail('${esc(x.studentId)}')">${selected?"收合":"明細"}</button></div>
        </div>
        ${detailHtml(x.studentId)}
      </div>`;
    }).join("");
    const pager=totalPages>1?`<div style="display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:center;margin-top:14px"><button class="secondary" style="width:100%;margin:0" onclick="changeAttendancePage(${page-1})" ${page<=1?"disabled":""}>← 上一頁</button><span class="muted" style="white-space:nowrap">第 ${page} / ${totalPages} 頁</span><button class="secondary" style="width:100%;margin:0" onclick="changeAttendancePage(${page+1})" ${page>=totalPages?"disabled":""}>下一頁 →</button></div>`:`<div class="muted" style="text-align:center;margin-top:12px">共 ${items.length} 位學生</div>`;
    return `<div class="card hero"><h2>📋 學生出勤表</h2>
      <div class="row2"><div><label>月份</label><input type="month" value="${esc(state.attendanceMonth)}" onchange="changeAttendanceMonth(this.value)"></div><div><label>團別</label><select onchange="changeAttendanceGroup(this.value)">${groups.map(g=>`<option value="${esc(g)}" ${g===state.attendanceGroup?"selected":""}>${esc(g==="全部"?"全部團別":g+"團")}</option>`).join("")}</select></div></div>
      <label>搜尋學生</label><input value="${esc(state.attendanceSearch||"")}" placeholder="姓名／分部／樂器／年級" onchange="changeAttendanceSearch(this.value)">
      <label>顯示範圍</label><select onchange="changeAttendanceView(this.value)"><option value="all" ${state.attendanceView==="all"?"selected":""}>全部學生</option><option value="changes" ${state.attendanceView==="changes"?"selected":""}>有遲到／請假／缺席</option><option value="full" ${state.attendanceView==="full"?"selected":""}>本月無出勤異動</option></select>
      <div class="grid"><div class="kpi"><b>${items.length}</b><span>學生</span></div><div class="kpi"><b>${total}</b><span>點名人次</span></div><div class="kpi"><b>${attended}</b><span>實到人次</span></div><div class="kpi"><b>${rate==null?"—":rate+"%"}</b><span>到課率</span></div><div class="kpi"><b>${leave}</b><span>請假人次</span></div><div class="kpi"><b>${absent}</b><span>缺席人次</span></div></div>
      <button class="secondary" style="width:100%;margin-top:12px" onclick="exportAttendanceReport()">匯出目前篩選結果 CSV</button>
    </div>
    <div class="card"><h2>${esc(state.attendanceMonth)} 出勤概況</h2><div class="notice">統計單位：學生為人數；點名、實到、請假、缺席皆為「人次」。到課率＝（出席＋遲到）÷點名人次；停課不列入點名人次。</div></div>
    <div class="card" id="attendanceStudentList"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><h2 style="margin:0">學生出勤清單</h2><span class="muted">每頁最多 ${pageSize} 人</span></div>${rows||'<div class="notice" style="margin-top:12px">目前篩選條件沒有學生資料。</div>'}${pager}</div>`;
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
  let attendanceSyncBusy=false,attendanceSyncNotice="";
  function attendanceSyncSignature(d){
    return JSON.stringify([d?.lastSavedAt||"",d?.recordedBy||"",d?.recordedByRole||"",...(d?.items||[]).map(x=>[String(x.studentId),String(x.status||""),String(x.createdAt||"")])]);
  }
  function attendanceSyncEditing(){
    const e=document.activeElement;
    return !!(e&&["SELECT","INPUT","TEXTAREA"].includes(e.tagName)&&e.closest(".main"));
  }
  async function liveAttendanceSync(){
    if(state.me?.role==="admin"||!state.me?.capabilities?.teacherSettings||attendanceSyncBusy||attendanceSyncEditing()||document.hidden)return;
    const p=state.page;if(!["section","ensemble","comprehensive"].includes(p))return;
    let url="",current=null,key="";
    if(p==="section"){
      const a=Array.isArray(state.me.assignments)?state.me.assignments:[],x=a[Math.min(window.__sectionClassIndex||0,Math.max(a.length-1,0))]||a[0];
      if(!x)return;
      const date=document.getElementById("sDate")?.value||state.sectionSelectedDate||new Date().toLocaleDateString("sv-SE");
      const g=String(x.groupName||x.group||"").replace(/團$/,""),s=String(x.section||"");
      url="/api/section-attendance?sessionDate="+encodeURIComponent(date)+"&groupName="+encodeURIComponent(g)+"&section="+encodeURIComponent(s);
      current=state.sectionExisting;key=[date,g,s].join("|");
    }else if(p==="ensemble"){
      const groups=Array.isArray(state.me.ensembleGroups)?state.me.ensembleGroups.filter(x=>["A","B"].includes(x)):[],g=groups[Math.min(window.__ensembleGroupIndex||0,Math.max(groups.length-1,0))];
      if(!g)return;
      const date=document.getElementById("eDate")?.value||new Date().toLocaleDateString("sv-SE");
      url="/api/ensemble-attendance?sessionDate="+encodeURIComponent(date)+"&groupName="+encodeURIComponent(g);
      current=state.ensembleExisting;key=[date,g].join("|");
    }else{
      const date=state.comprehensiveDate||document.getElementById("cmpDate")?.value||new Date().toLocaleDateString("sv-SE");
      url="/api/comprehensive-attendance?sessionDate="+encodeURIComponent(date);current=state.comprehensiveExisting;key=date;
    }
    attendanceSyncBusy=true;
    try{
      const d=await api(url);
      if(attendanceSyncSignature(d)!==attendanceSyncSignature(current)){
        if(p==="section"){state.sectionExisting=d;state.sectionExistingKey=key}
        else if(p==="ensemble"){state.ensembleExisting=d;state.ensembleExistingKey=key}
        else state.comprehensiveExisting=d;
        render();
        const notice=[p,d.lastSavedAt,d.recordedBy].join("|");
        if(d.recordedByRole==="admin"&&d.recordedBy&&notice!==attendanceSyncNotice){
          attendanceSyncNotice=notice;
          toast("🧑‍💼 "+d.recordedBy+" 已協助點名，畫面已同步");
        }
      }
    }catch(e){
      if(!/不是已啟用課表|已停課|已改期/.test(String(e?.message||"")))console.warn("attendance live sync failed",e);
    }finally{attendanceSyncBusy=false}
  }
  setInterval(liveAttendanceSync,12000);
  window.addEventListener("focus",()=>setTimeout(liveAttendanceSync,200));
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)setTimeout(liveAttendanceSync,200)});

})();