(()=>{
  const SCHEDULE_DATES=["2026-09-18","2026-10-02","2026-10-16","2026-10-30","2026-11-20","2026-11-27","2026-12-04"];
  const statusText={present:"出席",late:"遲到",leave:"請假",absent:"缺席",cancelled:"停課"};
  const groups=["A","B","儲備"];
  const teacherAccount=()=>state.me?.role!=="admin"&&(state.me?.role==="teacher"||state.me?.capabilities?.teacherSettings);
  const enabled=()=>!!(state.me?.capabilities?.comprehensive||state.teacherSetup?.profile?.comprehensiveEnabled);
  const localDate=()=>{const d=new Date(),x=new Date(d.getTime()-d.getTimezoneOffset()*60000);return x.toISOString().slice(0,10)};
  const defaultDate=()=>SCHEDULE_DATES.find(x=>x>=localDate())||localDate();
  state.comprehensiveDate=state.comprehensiveDate||defaultDate();
  state.comprehensiveExisting=state.comprehensiveExisting||null;
  state.comprehensiveLoading=false;

  function students(){
    const source=state.teacherSetup?.students?.length?state.teacherSetup.students:(state.students||[]);
    return source.filter(s=>groups.includes(String(s.groupName))&&String(s.status||"active")!=="inactive").slice().sort((a,b)=>groups.indexOf(a.groupName)-groups.indexOf(b.groupName)||String(a.section||"").localeCompare(String(b.section||""),"zh-Hant")||String(a.name||"").localeCompare(String(b.name||""),"zh-Hant"));
  }
  function existingMap(){return new Map((state.comprehensiveExisting?.items||[]).map(x=>[String(x.studentId),String(x.status||"present")]))}
  function statusSelect(s,map){const v=map.get(String(s.studentId))||"present";return `<select id="cmp_${esc(s.studentId)}" class="status-select">${Object.entries(statusText).map(([k,t])=>`<option value="${k}" ${v===k?"selected":""}>${t}</option>`).join("")}</select>`}
  function dateNote(){
    const scheduled=SCHEDULE_DATES.includes(state.comprehensiveDate);
    return scheduled?`<div class="notice" style="margin-top:10px">✅ ${esc(state.comprehensiveDate)} 為本學期排定綜合課日期。</div>`:`<div class="notice" style="margin-top:10px">⚠️ 此日期不在原排定 7 次課程中；如為補課／調課仍可照實點名。</div>`;
  }
  function groupBlock(g,map){
    const list=students().filter(s=>String(s.groupName)===g);
    return `<div class="card"><h2>${esc(g)}團｜${list.length} 人</h2>${list.length?list.map(s=>`<div class="item"><div><b>${esc(s.name)}</b><small>${esc(s.section||"待確認")}｜${esc(s.instrument)}｜${esc(s.grade)}</small></div>${statusSelect(s,map)}</div>`).join(""):'<div class="notice">目前沒有學生資料。</div>'}</div>`;
  }
  function page(){
    if(!enabled())return `<div class="card"><h2>🎶 綜合課點名</h2><div class="notice">尚未在「我的教學」開啟綜合課點名。</div><button class="primary" onclick="go('teacherSettings')">前往我的教學設定</button></div>`;
    const map=existingMap(),count=state.comprehensiveExisting?.items?.length||0,total=students().length,missing=Math.max(total-count,0);
    return `<div class="card hero"><h2>🎶 弦樂團體課（綜合課）</h2><div class="notice"><b>參與團別：</b>A團、B團、儲備團<br><b>上課時間：</b>週五 08:45–10:15<br><b>本學期 7 次：</b>9/18、10/2、10/16、10/30、11/20、11/27、12/4</div><label>上課日期</label><input id="cmpDate" type="date" value="${esc(state.comprehensiveDate)}" onchange="changeComprehensiveDate(this.value)">${dateNote()}${state.comprehensiveLoading?'<div class="notice" style="margin-top:10px">正在載入既有點名…</div>':count?`<div class="notice" style="margin-top:10px">✅ <b>已點名</b>｜已儲存 ${count}/${total} 人${missing?`，⚠️ 尚有 ${missing} 人未有紀錄`:""}。可直接修改後重新儲存。</div>`:'<div class="notice" style="margin-top:10px">⚠️ <b>尚未點名</b>｜此日期尚無儲存紀錄；目前「出席」僅為預設值。</div>'}</div>${groups.map(g=>groupBlock(g,map)).join("")}<div class="card"><button class="primary" onclick="saveComprehensive()">儲存／更新綜合課點名</button><button class="secondary" style="width:100%;margin-top:10px" onclick="exportComprehensiveFollowup()">📥 匯出本次未到／請假名單</button></div>`;
  }

  async function load(date){
    if(!enabled())return;
    state.comprehensiveLoading=true;render();
    try{state.comprehensiveExisting=await api(`/api/comprehensive-attendance?sessionDate=${encodeURIComponent(date)}`)}
    catch(e){state.comprehensiveExisting={items:[]};toast("❌ "+e.message)}
    state.comprehensiveLoading=false;render();
  }
  window.changeComprehensiveDate=async function(v){const d=String(v||"");if(!/^\d{4}-\d{2}-\d{2}$/.test(d))return;state.comprehensiveDate=d;state.comprehensiveExisting=null;await load(d)};
  window.saveComprehensive=async function(){
    const list=students();if(!list.length){toast("目前沒有綜合課學生");return}
    const items=list.map(s=>{const status=String($(`cmp_${s.studentId}`)?.value||"present");return {studentId:s.studentId,status,minutes:["present","late"].includes(status)?90:0}});
    try{await api("/api/comprehensive-attendance",{method:"POST",body:JSON.stringify({sessionDate:state.comprehensiveDate,items})});toast(`✅ 綜合課 ${items.length} 人點名已儲存`);await load(state.comprehensiveDate)}catch(e){toast("❌ "+e.message)}
  };
  function csvCell(v){const s=String(v??"");return /[",\r\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s}
  function downloadCsv(filename,rows){const content="\uFEFF"+rows.map(r=>r.map(csvCell).join(",")).join("\r\n");const blob=new Blob([content],{type:"text/csv;charset=utf-8"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
  window.exportComprehensiveFollowup=function(){
    const rows=[["日期","課程類型","團別","分部","學生姓名","年級","樂器","出勤狀態","點名老師"]];
    for(const s of students()){
      const st=String($(`cmp_${s.studentId}`)?.value||"");if(!["leave","absent"].includes(st))continue;
      rows.push([state.comprehensiveDate,"綜合課",s.groupName,s.section||"待確認",s.name,s.grade,s.instrument,statusText[st]||st,state.me.displayName||state.me.email]);
    }
    if(rows.length===1){toast("✅ 本次沒有請假／缺席學生");return}
    downloadCsv(`${state.comprehensiveDate}_綜合課_未到請假追蹤.csv`,rows);toast(`📥 已匯出 ${rows.length-1} 位未到學生`);
  };

  if(typeof recordPage==="function"){
    const baseRecordPage=recordPage;
    recordPage=function(){
      const html=baseRecordPage(),s=state.summary||{};
      if(s.comprehensiveTotal===undefined)return html;
      return html+`<div class="card"><h2>綜合課紀錄</h2>${scoreItem("弦樂團體課（綜合課）","A／B／儲備團共同參加",`${s.comprehensivePresent||0} / ${s.comprehensiveTotal||0}`)}</div>`;
    };
  }

  const baseGo=go;
  go=async function(p){
    if(p==="comprehensive"&&teacherAccount()){
      if(!state.teacherSetup&&typeof loadTeacherSettings==="function")await loadTeacherSettings();
      state.page="comprehensive";render();
      if(enabled()&&!state.comprehensiveExisting)await load(state.comprehensiveDate);
      return;
    }
    return baseGo(p);
  };
  const baseRender=render;
  render=function(){
    if(teacherAccount()&&state.page==="comprehensive"){
      document.getElementById("app").innerHTML=shell(page());return;
    }
    return baseRender();
  };
})();
