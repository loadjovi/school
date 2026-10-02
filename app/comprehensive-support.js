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
  state.comprehensiveLoadError="";
  state.comprehensiveSaveFeedback=null;
  state.comprehensiveDraft=null;

  function students(){
    const source=state.teacherSetup?.students?.length?state.teacherSetup.students:(state.students||[]);
    return source.filter(s=>groups.includes(String(s.groupName))&&String(s.status||"active")!=="inactive").slice().sort((a,b)=>groups.indexOf(a.groupName)-groups.indexOf(b.groupName)||String(a.section||"").localeCompare(String(b.section||""),"zh-Hant")||String(a.name||"").localeCompare(String(b.name||""),"zh-Hant"));
  }
  function existingMap(){return state.comprehensiveDraft?.date===state.comprehensiveDate?new Map(Object.entries(state.comprehensiveDraft.statuses)):new Map((state.comprehensiveExisting?.items||[]).map(x=>[String(x.studentId),String(x.status||"present")]))}
  function statusSelect(s,map){const v=map.get(String(s.studentId))||"present",saving=state.comprehensiveSaveFeedback?.date===state.comprehensiveDate&&state.comprehensiveSaveFeedback.phase==="saving",ready=state.comprehensiveExisting?.sessionDate===state.comprehensiveDate&&!state.comprehensiveLoadError&&!state.comprehensiveLoading;return `<select id="cmp_${esc(s.studentId)}" class="status-select" onchange="markComprehensiveDirty()" ${saving||!ready?"disabled":""}>${Object.entries(statusText).map(([k,t])=>`<option value="${k}" ${v===k?"selected":""}>${t}</option>`).join("")}</select>`}
  function feedback(){
    const f=state.comprehensiveSaveFeedback?.date===state.comprehensiveDate?state.comprehensiveSaveFeedback:null;
    const message=f?.message||"目前選取的狀態尚未儲存；請按「確認儲存」，並等待伺服器確認。";
    const color=f?.phase==="success"?"#15803d":f?.phase==="saving"?"#3155a4":"#b45309";
    return `<div id="comprehensiveSaveFeedback" class="notice" role="status" aria-live="polite" style="margin-top:10px;border-left:4px solid ${color};font-weight:700">${esc(message)}</div>`;
  }
  window.markComprehensiveDirty=function(){
    const statuses=Object.fromEntries(students().map(s=>[String(s.studentId),String($(`cmp_${s.studentId}`)?.value||"present")]));
    state.comprehensiveDraft={date:state.comprehensiveDate,statuses};
    if(state.comprehensiveSaveFeedback?.phase==="saving")return;
    state.comprehensiveSaveFeedback={date:state.comprehensiveDate,phase:"dirty",message:"⚠️ 點名狀態已修改，尚未儲存。請再次按「確認儲存」。"};
    const box=document.getElementById("comprehensiveSaveFeedback");if(box){box.textContent=state.comprehensiveSaveFeedback.message;box.style.borderLeftColor="#b45309"}
    const top=document.getElementById("comprehensiveStoredSummary");if(top)top.textContent="⚠️ 本頁有未儲存的修改，請到頁尾重新按「確認儲存」。"
  };
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
    const map=existingMap(),count=state.comprehensiveExisting?.items?.length||0,total=students().length,missing=Math.max(total-count,0),recorder=state.comprehensiveExisting?.recordedBy?`<br>點名：<b>${esc(state.comprehensiveExisting.recordedBy)}</b>${state.comprehensiveExisting.recordedByRole==="admin"?"（行政協助）":""}`:"";
    const saving=state.comprehensiveSaveFeedback?.date===state.comprehensiveDate&&state.comprehensiveSaveFeedback.phase==="saving";
    const ready=state.comprehensiveExisting?.sessionDate===state.comprehensiveDate&&!state.comprehensiveLoadError&&!state.comprehensiveLoading;
    return `<div class="card hero"><h2>🎶 弦樂團體課（綜合課）</h2><div class="notice"><b>參與團別：</b>A團、B團、儲備團<br><b>上課時間：</b>週五 08:45–10:15<br><b>本學期 7 次：</b>9/18、10/2、10/16、10/30、11/20、11/27、12/4</div><label>上課日期</label><input id="cmpDate" type="date" value="${esc(state.comprehensiveDate)}" onchange="changeComprehensiveDate(this.value)" ${saving?"disabled":""}>${dateNote()}<div class="notice" style="margin-top:10px">點名標準：上課開始後超過 10 分鐘才到課記為「遲到」；10 分鐘內到課記為「出席」。遲到仍算到課。</div>${state.comprehensiveLoading?'<div class="notice" style="margin-top:10px">正在載入既有點名…</div>':state.comprehensiveLoadError?`<div class="notice" style="margin-top:10px">⚠️ 無法確認此日期的既有點名：${esc(state.comprehensiveLoadError)}。請重新整理後核對。</div>`:!ready?'<div class="notice" style="margin-top:10px">正在確認此日期的點名紀錄…</div>':count?`<div id="comprehensiveStoredSummary" class="notice" style="margin-top:10px">📋 <b>已有點名紀錄</b>｜伺服器紀錄 ${count}/${total} 人${missing?`，⚠️ 尚有 ${missing} 人未有紀錄`:""}。可直接修改後重新儲存。${recorder}</div>`:'<div id="comprehensiveStoredSummary" class="notice" style="margin-top:10px">⚠️ <b>尚未點名</b>｜此日期尚無儲存紀錄；目前「出席」僅為預設值。</div>'}</div>${groups.map(g=>groupBlock(g,map)).join("")}<div class="card"><button class="primary" onclick="saveComprehensive()" ${saving||!ready?"disabled":""}>${saving?"⏳ 正在儲存並確認…":"確認儲存綜合課點名"}</button>${feedback()}<button class="secondary" style="width:100%;margin-top:10px" onclick="exportComprehensiveFollowup()">📥 匯出本次未到／請假名單</button></div>`;
  }

  async function load(date){
    if(!enabled())return;
    const sequence=(state.comprehensiveRequestSeq||0)+1;state.comprehensiveRequestSeq=sequence;
    state.comprehensiveLoading=true;render();
    try{const data=await api(`/api/comprehensive-attendance?sessionDate=${encodeURIComponent(date)}`);if(state.comprehensiveRequestSeq===sequence&&state.comprehensiveDate===date){const active=new Set(students().map(x=>String(x.studentId)));state.comprehensiveExisting={...data,items:(data.items||[]).filter(x=>active.has(String(x.studentId)))};state.comprehensiveLoadError=""}}
    catch(e){if(state.comprehensiveRequestSeq===sequence&&state.comprehensiveDate===date){state.comprehensiveExisting=null;state.comprehensiveLoadError=e.message;toast("❌ "+e.message)}}
    if(state.comprehensiveRequestSeq===sequence){state.comprehensiveLoading=false;render()}
  }
  window.changeComprehensiveDate=async function(v){const d=String(v||"");if(!/^\d{4}-\d{2}-\d{2}$/.test(d))return;state.comprehensiveDate=d;state.comprehensiveExisting=null;state.comprehensiveDraft=null;await load(d)};
  window.saveComprehensive=async function(){
    if(state.comprehensiveSaveFeedback?.phase==="saving")return;
    if(state.comprehensiveExisting?.sessionDate!==state.comprehensiveDate||state.comprehensiveLoadError||state.comprehensiveLoading){toast("請先載入本次點名名單");return}
    const list=students();if(!list.length){toast("目前沒有綜合課學生");return}
    const items=list.map(s=>{const status=String($(`cmp_${s.studentId}`)?.value||"present");return {studentId:s.studentId,status,minutes:["present","late"].includes(status)?90:0}});
    const sessionDate=state.comprehensiveDate;
    state.comprehensiveDraft={date:sessionDate,statuses:Object.fromEntries(items.map(x=>[String(x.studentId),x.status]))};
    state.comprehensiveSaveFeedback={date:sessionDate,phase:"saving",message:"⏳ 正在儲存並向伺服器核對，請勿離開。"};render();
    try{
      const posted=await api("/api/comprehensive-attendance",{method:"POST",body:JSON.stringify({sessionDate,items})});
      if(posted?.ok!==true||Number(posted.count)!==items.length)throw new Error("伺服器未確認全部學生");
      const fresh=await api(`/api/comprehensive-attendance?sessionDate=${encodeURIComponent(sessionDate)}&_=${Date.now()}`);
      const active=new Set(items.map(x=>String(x.studentId))),records=(fresh.items||[]).filter(x=>active.has(String(x.studentId))),actual=new Map(records.map(x=>[String(x.studentId),String(x.status)]));
      if(!Array.isArray(fresh.items)||records.length!==items.length||actual.size!==items.length||items.some(x=>actual.get(String(x.studentId))!==x.status))throw new Error("回讀的學生紀錄與送出內容不一致");
      if(state.comprehensiveDate===sessionDate){state.comprehensiveRequestSeq=(state.comprehensiveRequestSeq||0)+1;state.comprehensiveExisting={...fresh,items:records};state.comprehensiveDraft=null;state.comprehensiveLoadError="";state.comprehensiveLoading=false}
      const time=fresh.lastSavedAt?new Date(fresh.lastSavedAt).toLocaleTimeString("zh-TW",{timeZone:"Asia/Taipei",hour:"2-digit",minute:"2-digit",hour12:false}):"";
      state.comprehensiveSaveFeedback={date:sessionDate,phase:"success",message:`✅ 伺服器已確認儲存｜${sessionDate} 綜合課｜${items.length} 人${time?`｜${time}`:""}。可安心離開本頁。`};state.teacherTodayStatusDate="";toast("✅ 點名已確認儲存");
    }catch(e){state.comprehensiveSaveFeedback={date:sessionDate,phase:"warning",message:`⚠️ 尚未確認全部點名已儲存（${e.message}）。請重新按「確認儲存」或請管理員協助核對，勿視為完成。`};toast("⚠️ 點名尚未確認完成")}
    render();
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
