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
  window.setAttendanceQuickView=function(v){state.attendanceView=String(v||"all");state.attendancePageNum=1;state.attendanceSelected="";render();setTimeout(()=>document.getElementById("attendanceStudentList")?.scrollIntoView({behavior:"smooth",block:"start"}),20)};
  window.changeAttendancePage=function(v){const total=Math.max(1,Math.ceil(filteredItems().length/state.attendancePageSize));state.attendancePageNum=Math.min(total,Math.max(1,Number(v)||1));state.attendanceSelected="";render();setTimeout(()=>document.getElementById("attendanceStudentList")?.scrollIntoView({behavior:"smooth",block:"start"}),20)};
  window.showAttendanceDetail=function(id){state.attendanceSelected=state.attendanceSelected===String(id)?"":String(id);render()};
  function groupStats(x){
    const keys=["sectionStats","ensembleStats","comprehensiveStats"],out={present:0,late:0,leave:0,absent:0,cancelled:0,total:0,attended:0};
    for(const key of keys){const s=x?.[key]||{};for(const k of Object.keys(out))out[k]+=Number(s[k]||0)}
    out.rate=out.total?Math.round(out.attended/out.total*1000)/10:null;
    out.unusual=out.late+out.leave+out.absent;
    out.attention=out.absent>0||out.unusual>=2;
    return out;
  }
  function scopedAttendanceItems(){
    const q=String(state.attendanceSearch||"").toLowerCase();
    return (state.attendanceData?.items||[]).filter(x=>{
      if(state.attendanceGroup!=="全部"&&String(x.groupName)!==state.attendanceGroup)return false;
      if(q){const hay=[x.name,x.groupName,x.section,x.instrument,x.grade].map(v=>String(v||"").toLowerCase()).join(" ");if(!hay.includes(q))return false;}
      return true;
    });
  }
  function filteredItems(){
    const view=String(state.attendanceView||"all");
    return scopedAttendanceItems().filter(x=>{
      const s=groupStats(x);
      if(view==="changes"&&s.unusual===0)return false;
      if(view==="absent"&&s.absent===0)return false;
      if(view==="leave"&&s.leave===0)return false;
      if(view==="late"&&s.late===0)return false;
      if(view==="repeat"&&s.unusual<2)return false;
      if(view==="attention"&&!s.attention)return false;
      if(view==="full"&&s.unusual>0)return false;
      return true;
    }).sort((a,b)=>{
      const sa=groupStats(a),sb=groupStats(b);
      if(Number(sb.attention)!==Number(sa.attention))return Number(sb.attention)-Number(sa.attention);
      if(sb.absent!==sa.absent)return sb.absent-sa.absent;
      if(sb.unusual!==sa.unusual)return sb.unusual-sa.unusual;
      return String(a.name||"").localeCompare(String(b.name||""),"zh-Hant");
    });
  }
  function rateBadge(rate){if(rate===null||rate===undefined)return `<span class="badge warn">—</span>`;const c=rate>=90?"ok":rate>=75?"warn":"bad";return `<span class="badge ${c}">${rate}%</span>`}
  function statLine(label,x){return `${label} ${x?.attended||0}/${x?.total||0}`}
  function aggregateStats(items,key){
    const out={present:0,late:0,leave:0,absent:0,cancelled:0,total:0,attended:0};
    for(const x of items){const s=x?.[key]||{};for(const k of Object.keys(out))out[k]+=Number(s[k]||0)}
    out.rate=out.total?Math.round(out.attended/out.total*1000)/10:null;
    return out;
  }
  function latestAbnormal(studentId){
    return (state.attendanceData?.records||[]).find(r=>String(r.studentId)===String(studentId)&&["late","leave","absent"].includes(String(r.status||"")))||null;
  }
  function detailHtml(id){
    if(state.attendanceSelected!==String(id))return "";
    const records=(state.attendanceData?.records||[]).filter(r=>String(r.studentId)===String(id));
    if(!records.length)return `<div class="notice" style="margin-top:10px">本月尚無點名紀錄。</div>`;
    return `<div style="margin-top:10px">${records.map(r=>`<div class="item"><div><b>${esc(r.eventDate)}｜${esc(classText[r.classType]||r.classType)}</b><small>${esc(r.groupName||"")}團${r.section?`｜${esc(r.section)}`:""}<br>${esc(r.teacher||"")}</small></div><span class="badge ${["present","late"].includes(r.status)?"ok":r.status==="leave"?"warn":"bad"}">${esc(statusText[r.status]||r.status)}</span></div>`).join("")}</div>`;
  }
  window.exportAttendanceReport=function(){
    const items=filteredItems();
    if(!items.length){toast("目前沒有可匯出的學生出勤資料");return}
    const rows=[["月份","學生姓名","年級","團別","分部","樂器","團體課到課","團體課應到","團體課到課率","遲到","請假","缺席","需關注","分部課出席","分部課應到","合奏課出席","合奏課應到","綜合課出席","綜合課應到","個別課出席","個別課應到"]];
    for(const x of items){const s=groupStats(x);rows.push([state.attendanceMonth,x.name,x.grade,x.groupName,x.section,x.instrument,s.attended,s.total,s.rate==null?"":`${s.rate}%`,s.late,s.leave,s.absent,s.attention?"是":"否",x.sectionStats.attended,x.sectionStats.total,x.ensembleStats.attended,x.ensembleStats.total,x.comprehensiveStats?.attended||0,x.comprehensiveStats?.total||0,x.privateStats.attended,x.privateStats.total])}
    downloadCsv(`${state.attendanceMonth}_弦樂團學生出勤表.csv`,rows);toast("📥 已匯出學生出勤表");
  };
  function attendancePage(){
    const d=state.attendanceData;
    if(!d)return `<div class="card"><h2>📋 學生出勤表</h2><div class="notice">正在讀取出勤資料…</div></div>`;
    const groups=["全部",...new Set((d.items||[]).map(x=>String(x.groupName)).filter(Boolean))];
    const scope=scopedAttendanceItems(),items=filteredItems();
    const groupTotals=scope.reduce((o,x)=>{const s=groupStats(x);for(const k of ["present","late","leave","absent","total","attended"])o[k]+=Number(s[k]||0);return o},{present:0,late:0,leave:0,absent:0,total:0,attended:0});
    groupTotals.rate=groupTotals.total?Math.round(groupTotals.attended/groupTotals.total*1000)/10:null;
    const absentStudents=scope.filter(x=>groupStats(x).absent>0).length;
    const leaveStudents=scope.filter(x=>groupStats(x).leave>0).length;
    const lateStudents=scope.filter(x=>groupStats(x).late>0).length;
    const repeatStudents=scope.filter(x=>groupStats(x).unusual>=2).length;
    const attentionStudents=scope.filter(x=>groupStats(x).attention).length;
    const pageSize=state.attendancePageSize,totalPages=Math.max(1,Math.ceil(items.length/pageSize)),page=Math.min(totalPages,Math.max(1,state.attendancePageNum||1)),pageItems=items.slice((page-1)*pageSize,page*pageSize);
    state.attendancePageNum=page;

    const courseMeta=[
      {key:"sectionStats",icon:"🎼",label:"分部課"},
      {key:"ensembleStats",icon:"🎻",label:"合奏課"},
      {key:"comprehensiveStats",icon:"🎶",label:"綜合課"}
    ];
    const courseCards=courseMeta.map(m=>{
      const s=aggregateStats(scope,m.key);
      return `<div class="attendance-course-card">
        <div class="attendance-course-head"><b>${m.icon} ${m.label}</b>${rateBadge(s.rate)}</div>
        <div class="attendance-course-main"><strong>${s.attended} / ${s.total}</strong><small>到課 / 應到</small></div>
        <div class="attendance-course-detail"><span>🟡 請假 ${s.leave}</span><span>🔴 缺席 ${s.absent}</span><span>⏰ 遲到 ${s.late}</span></div>
      </div>`;
    }).join("");
    const privateStat=aggregateStats(scope,"privateStats");

    const quick=(key,icon,label,count,sub,cls="")=>`<button class="attendance-quick-card ${cls} ${state.attendanceView===key?"is-active":""}" onclick="setAttendanceQuickView('${key}')"><span>${icon}</span><div><b>${count}</b><small>${label}</small><em>${sub}</em></div></button>`;
    const quickCards=[
      quick("attention","⚠️","需關注學生",attentionStudents,"缺席或本月異動達 2 次","attention"),
      quick("absent","🔴","有缺席",absentStudents,`${groupTotals.absent} 人次`,"absent"),
      quick("leave","🟡","有請假",leaveStudents,`${groupTotals.leave} 人次`,"leave"),
      quick("late","⏰","有遲到",lateStudents,`${groupTotals.late} 人次`,"late"),
      quick("repeat","🔁","2 次以上異動",repeatStudents,"請假／缺席／遲到合計","repeat"),
      quick("full","✅","無出勤異動",scope.filter(x=>groupStats(x).unusual===0&&groupStats(x).total>0).length,"本月團體課","full")
    ].join("");

    const rows=pageItems.map(x=>{
      const selected=state.attendanceSelected===String(x.studentId),s=groupStats(x),recent=latestAbnormal(x.studentId);
      const needs=s.attention?`<span class="badge bad">⚠️ 需關注</span>`:"";
      const recentText=recent?`最近異動：${esc(recent.eventDate)} ${esc(classText[recent.classType]||recent.classType)}｜${esc(statusText[recent.status]||recent.status)}`:"本月團體課無遲到／請假／缺席";
      return `<div class="attendance-student-row">
        <div class="attendance-student-top">
          <div class="attendance-student-name"><div><b>${esc(x.name)}</b>${needs}</div><small>${esc(x.groupName)}團｜${esc(x.section||"待確認")}｜${esc(x.instrument)}｜${esc(x.grade)}</small></div>
          <div class="attendance-student-rate">${rateBadge(s.rate)}<button class="secondary" onclick="showAttendanceDetail('${esc(x.studentId)}')">${selected?"收合":"明細"}</button></div>
        </div>
        <div class="attendance-student-summary">
          <span class="present">✅ 到課 <b>${s.attended}/${s.total}</b></span>
          <span class="leave">🟡 請假 <b>${s.leave}</b></span>
          <span class="absent">🔴 缺席 <b>${s.absent}</b></span>
          <span class="late">⏰ 遲到 <b>${s.late}</b></span>
        </div>
        <small class="attendance-recent ${recent?"has-change":"is-clear"}">${recentText}</small>
        <small class="attendance-class-breakdown">${esc(statLine("分部",x.sectionStats))}｜${esc(statLine("合奏",x.ensembleStats))}｜${esc(statLine("綜合",x.comprehensiveStats))}${Number(x.privateStats?.total||0)?`｜個課 ${esc(statLine("",x.privateStats).trim())}`:""}</small>
        ${detailHtml(x.studentId)}
      </div>`;
    }).join("");

    const pager=totalPages>1?`<div class="attendance-pager"><button class="secondary" onclick="changeAttendancePage(${page-1})" ${page<=1?"disabled":""}>← 上一頁</button><span>第 ${page} / ${totalPages} 頁</span><button class="secondary" onclick="changeAttendancePage(${page+1})" ${page>=totalPages?"disabled":""}>下一頁 →</button></div>`:`<div class="muted" style="text-align:center;margin-top:12px">共 ${items.length} 位學生</div>`;

    return `<div class="card hero attendance-workbench"><div class="section-title"><div><h2>📋 出勤行政工作台</h2><div class="muted">先看需要處理的人，再查看明細；主統計以分部／合奏／綜合課為準。</div></div><span class="badge ok">${esc(state.attendanceMonth)}</span></div>
      <div class="row2"><div><label>月份</label><input type="month" value="${esc(state.attendanceMonth)}" onchange="changeAttendanceMonth(this.value)"></div><div><label>團別</label><select onchange="changeAttendanceGroup(this.value)">${groups.map(g=>`<option value="${esc(g)}" ${g===state.attendanceGroup?"selected":""}>${esc(g==="全部"?"全部團別":g+"團")}</option>`).join("")}</select></div></div>
      <label>搜尋學生</label><input value="${esc(state.attendanceSearch||"")}" placeholder="姓名／分部／樂器／年級" oninput="changeAttendanceSearch(this.value)">
      <div class="attendance-primary-kpis">
        <div><b>${scope.length}</b><span>在團學生</span></div>
        <div><b>${groupTotals.attended} / ${groupTotals.total}</b><span>團體課到課 / 應到</span></div>
        <div><b>${groupTotals.rate==null?"—":groupTotals.rate+"%"}</b><span>團體課到課率</span></div>
        <div class="${attentionStudents?"attention":""}"><b>${attentionStudents}</b><span>需關注學生</span></div>
      </div>
      <button class="secondary" style="width:100%;margin-top:12px" onclick="exportAttendanceReport()">📥 匯出目前篩選結果 CSV</button>
    </div>

    <div class="card"><div class="section-title"><div><h2>⚠️ 本月異動學生</h2><div class="muted">以下數字是「學生人數」，不是人次；點一下即可直接篩選名單。</div></div><button class="secondary attendance-reset-filter" onclick="setAttendanceQuickView('all')">全部</button></div>
      <div class="attendance-quick-grid">${quickCards}</div>
    </div>

    <div class="card"><h2>📊 課程別出勤狀況</h2><div class="notice">團體課分開呈現，方便快速判斷問題主要出現在分部、合奏或綜合課。請假、缺席、遲到皆以人次呈現。</div>
      <div class="attendance-course-grid">${courseCards}</div>
      ${privateStat.total?`<div class="attendance-private-reference"><b>👤 個別課紀錄</b><span>${privateStat.attended}/${privateStat.total} 到課</span><small>個別課屬學習紀錄／升等參考，不混入上方團體課主出勤率。</small></div>`:""}
    </div>

    <div class="card attendance-list-card" id="attendanceStudentList">
      <div class="section-title"><div><h2>學生出勤清單</h2><div class="muted">目前顯示：${({
        all:"全部學生",attention:"需關注學生",absent:"有缺席",leave:"有請假",late:"有遲到",repeat:"2 次以上異動",changes:"有出勤異動",full:"無出勤異動"
      })[state.attendanceView]||"全部學生"}｜${items.length} 人</div></div><span class="muted">每頁最多 ${pageSize} 人</span></div>
      <label>顯示範圍</label><select onchange="changeAttendanceView(this.value)">
        <option value="all" ${state.attendanceView==="all"?"selected":""}>全部學生</option>
        <option value="attention" ${state.attendanceView==="attention"?"selected":""}>⚠️ 需關注學生</option>
        <option value="absent" ${state.attendanceView==="absent"?"selected":""}>🔴 有缺席</option>
        <option value="leave" ${state.attendanceView==="leave"?"selected":""}>🟡 有請假</option>
        <option value="late" ${state.attendanceView==="late"?"selected":""}>⏰ 有遲到</option>
        <option value="repeat" ${state.attendanceView==="repeat"?"selected":""}>🔁 2 次以上異動</option>
        <option value="changes" ${state.attendanceView==="changes"?"selected":""}>有遲到／請假／缺席</option>
        <option value="full" ${state.attendanceView==="full"?"selected":""}>✅ 無出勤異動</option>
      </select>
      ${rows||'<div class="notice" style="margin-top:12px">目前篩選條件沒有學生資料。</div>'}${pager}
    </div>`;
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