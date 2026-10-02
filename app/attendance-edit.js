(()=>{
  const statusLabels={present:"出席",late:"遲到",leave:"請假",absent:"缺席",cancelled:"停課"};
  const schedule={A:[1,3],B:[2,4],"儲備":[5]};
  const dayText={1:"週一",2:"週二",3:"週三",4:"週四",5:"週五"};
  const today=()=>new Date().toISOString().slice(0,10);
  window.__attendanceEditSectionActive=true;
  state.sectionSessionDate=state.sectionSessionDate||today();
  state.sectionSessionStatuses=state.sectionSessionStatuses||{};
  state.sectionSessionLoaded=state.sectionSessionLoaded||0;
  state.sectionSessionKey="";
  state.sectionSessionRoster=[];
  state.sectionSessionMerges=[];
  state.sectionSessionLoading=false;
  state.sectionSessionError="";
  state.ensembleSessionDate=state.ensembleSessionDate||today();
  state.ensembleSessionStatuses=state.ensembleSessionStatuses||{};
  state.ensembleSessionLoaded=state.ensembleSessionLoaded||0;
  state.ensembleSessionKey="";
  state.ensembleSessionError="";
  state.ensembleSessionLoading=false;
  state.sectionSaveFeedback=null;
  state.ensembleSaveFeedback=null;

  function verifiedItems(data,items){
    if(!Array.isArray(data?.items)||!items.length)return false;
    const actual=new Map(data.items.map(x=>[String(x.studentId),String(x.status)]));
    return items.every(x=>actual.get(String(x.studentId))===x.status);
  }
  function savedTime(value){
    if(!value)return "";
    const date=new Date(value);
    return Number.isNaN(date.getTime())?"":new Intl.DateTimeFormat("zh-TW",{timeZone:"Asia/Taipei",hour:"2-digit",minute:"2-digit",hour12:false}).format(date);
  }
  function saveFeedback(kind,key,existing,total,id){
    const feedback=(kind==="section"?state.sectionSaveFeedback:state.ensembleSaveFeedback);
    const current=feedback?.key===key?feedback:null;
    const text=current?.message||(existing? `已讀取既有點名 ${existing}/${total} 人。若有修改，請按「確認儲存」後等待下方顯示伺服器確認。`:"目前選取的狀態尚未儲存。請按「確認儲存」，並等待伺服器確認。");
    const color=current?.phase==="success"?"#15803d":current?.phase==="saving"?"#3155a4":"#b45309";
    return `<div id="${id}" class="notice" role="status" aria-live="polite" style="margin-top:10px;border-left:4px solid ${color};font-weight:700">${esc(text)}</div>`;
  }
  function markDirty(kind){
    const c=currentSection(),key=kind==="section"?[state.sectionSessionDate,String(c?.groupName||c?.group||""),String(c?.section||"")].join("|"):[state.ensembleSessionDate,currentEnsemble()].join("|");
    let feedback=kind==="section"?state.sectionSaveFeedback:state.ensembleSaveFeedback;
    if(feedback?.phase==="saving")return;
    if(!feedback||feedback.key!==key){
      feedback={key};if(kind==="section")state.sectionSaveFeedback=feedback;else state.ensembleSaveFeedback=feedback;
    }
    feedback.phase="dirty";feedback.message="⚠️ 點名狀態已修改，尚未儲存。請再次按「確認儲存」。";
    const box=document.getElementById(kind==="section"?"sectionSaveFeedback":"ensembleSaveFeedback");
    if(box){box.textContent=feedback.message;box.style.borderLeftColor="#b45309"}
    const top=document.getElementById(kind==="section"?"sectionStoredSummary":"ensembleStoredSummary");
    if(top)top.textContent="⚠️ 本頁有未儲存的修改，請到頁尾重新按「確認儲存」。";
  }

  function statusOptions(selected="present"){
    return Object.entries(statusLabels).map(([v,t])=>`<option value="${v}" ${v===selected?"selected":""}>${t}</option>`).join("");
  }
  function currentSection(){
    const list=Array.isArray(state.me?.assignments)?state.me.assignments:[];
    return list[Math.min(window.__sectionClassIndex||0,Math.max(list.length-1,0))]||list[0]||null;
  }
  function currentEnsemble(){
    const groups=Array.isArray(state.me?.ensembleGroups)?state.me.ensembleGroups.filter(x=>["A","B"].includes(x)):[];
    return groups[Math.min(window.__ensembleGroupIndex||0,Math.max(groups.length-1,0))]||"";
  }
  async function fetchSection(date=state.sectionSessionDate){
    const c=currentSection();
    state.sectionSessionDate=date||today();state.sectionSessionStatuses={};state.sectionSessionLoaded=0;state.sectionSessionError="";
    if(!c)return;
    const groupName=String(c.groupName||c.group||""),section=String(c.section||"");
    const key=[state.sectionSessionDate,groupName,section].join("|"),sequence=(state.sectionRequestSequence||0)+1;
    state.sectionRequestSequence=sequence;state.sectionSessionKey="";state.sectionSessionRoster=[];state.sectionSessionMerges=[];state.sectionSessionLoading=true;
    try{
      const data=await api(`/api/section-attendance?sessionDate=${encodeURIComponent(state.sectionSessionDate)}&groupName=${encodeURIComponent(groupName)}&section=${encodeURIComponent(section)}`);
      if(sequence!==state.sectionRequestSequence)return;
      const roster=data.roster||[],active=new Set(roster.map(x=>String(x.studentId))),records=(data.items||[]).filter(x=>active.has(String(x.studentId)));
      state.sectionSessionStatuses=Object.fromEntries(records.map(x=>[String(x.studentId),String(x.status||"present")]));
      state.sectionSessionLoaded=records.length;state.sectionSessionRoster=roster;state.sectionSessionMerges=data.merges||[];state.sectionSessionKey=key;
    }catch(e){if(sequence===state.sectionRequestSequence){state.sectionSessionError=e.message;state.sectionSessionKey=key}throw e}
    finally{if(sequence===state.sectionRequestSequence)state.sectionSessionLoading=false}
  }
  window.loadSectionExisting=async function(){try{await fetchSection(state.sectionSelectedDate||state.sectionSessionDate);render()}catch(e){toast("❌ "+e.message);render()}};
  async function fetchEnsemble(date=state.ensembleSessionDate){
    const g=currentEnsemble();
    state.ensembleSessionDate=date||today();state.ensembleSessionStatuses={};state.ensembleSessionLoaded=0;state.ensembleSessionError="";
    if(!g)return;
    const key=[state.ensembleSessionDate,g].join("|"),sequence=(state.ensembleRequestSequence||0)+1;
    state.ensembleRequestSequence=sequence;state.ensembleSessionKey="";state.ensembleSessionLoading=true;
    try{
      const data=await api(`/api/ensemble-attendance?sessionDate=${encodeURIComponent(state.ensembleSessionDate)}&groupName=${encodeURIComponent(g)}`);
      if(sequence!==state.ensembleRequestSequence)return;
      const active=new Set(state.students.filter(x=>String(x.groupName)===g).map(x=>String(x.studentId))),records=(data.items||[]).filter(x=>active.has(String(x.studentId)));
      state.ensembleSessionStatuses=Object.fromEntries(records.map(x=>[String(x.studentId),String(x.status||"present")]));
      state.ensembleSessionLoaded=records.length;state.ensembleSessionKey=key;
    }catch(e){if(sequence===state.ensembleRequestSequence){state.ensembleSessionError=e.message;state.ensembleSessionKey=key}throw e}
    finally{if(sequence===state.ensembleRequestSequence)state.ensembleSessionLoading=false}
  }

  window.changeSectionAttendanceDate=async function(v){
    state.sectionSelectedDate=String(v||today());
    try{await fetchSection(state.sectionSelectedDate)}catch(e){toast("❌ 無法讀取既有分部點名："+e.message)}finally{render()}
  };
  window.changeEnsembleAttendanceDate=async function(v){
    try{await fetchEnsemble(String(v||today()))}catch(e){toast("❌ 無法讀取既有合奏課點名："+e.message)}finally{render()}
  };
  window.changeSectionClass=async function(v){
    window.__sectionClassIndex=Number(v)||0;
    try{await fetchSection(state.sectionSessionDate)}catch(e){toast("❌ "+e.message)}finally{render()}
  };
  window.changeEnsembleGroup=async function(v){
    window.__ensembleGroupIndex=Number(v)||0;
    try{await fetchEnsemble(state.ensembleSessionDate);render()}catch(e){toast("❌ "+e.message);render()}
  };
  window.setSectionStatus=function(id,v){state.sectionSessionStatuses[String(id)]=String(v||"present");markDirty("section")};
  window.setEnsembleStatus=function(id,v){state.ensembleSessionStatuses[String(id)]=String(v||"present");markDirty("ensemble")};

  function csvCell(v){const s=String(v??"");return /[",\r\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s}
  function downloadCsv(filename,rows){
    const content="\uFEFF"+rows.map(r=>r.map(csvCell).join(",")).join("\r\n");
    const blob=new Blob([content],{type:"text/csv;charset=utf-8"});
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }
  function followupRows(date,type,groupName,section,students,statusMap){
    const rows=[["日期","課程類型","團別","分部","學生姓名","年級","樂器","出勤狀態","點名老師"]];
    for(const s of students){
      const status=String(statusMap[String(s.studentId)]||"present");
      if(!["leave","absent"].includes(status))continue;
      rows.push([date,type,groupName,section,s.name,s.grade,s.instrument,statusLabels[status]||status,state.me?.displayName||state.me?.email||""]);
    }
    return rows;
  }
  window.exportSectionFollowup=function(){
    const c=currentSection();if(!c){toast("尚未設定分部課");return}
    const groupName=String(c.groupName||c.group||""),section=String(c.section||"");
    const key=[state.sectionSessionDate,groupName,section].join("|");
    if(state.sectionSessionKey!==key||state.sectionSessionError){toast("請先載入本次點名名單");return}
    const students=state.sectionSessionRoster;
    const rows=followupRows(state.sectionSessionDate,"分部課",groupName,section,students,state.sectionSessionStatuses);
    if(rows.length===1){toast("✅ 本次沒有請假／缺席學生");return}
    downloadCsv(`${state.sectionSessionDate}_${groupName}團_${section}_未到追蹤.csv`,rows);toast(`📥 已匯出 ${rows.length-1} 位未到學生`);
  };
  window.exportEnsembleFollowup=function(){
    const g=currentEnsemble();if(!g){toast("尚未設定合奏課");return}
    const students=state.students.filter(s=>String(s.groupName)===g);
    const rows=followupRows(state.ensembleSessionDate,"合奏課",g,"四分部合班",students,state.ensembleSessionStatuses);
    if(rows.length===1){toast("✅ 本次沒有請假／缺席學生");return}
    downloadCsv(`${state.ensembleSessionDate}_${g}團_合奏課_未到追蹤.csv`,rows);toast(`📥 已匯出 ${rows.length-1} 位未到學生`);
  };

  sectionPage=function(){
    const assignments=Array.isArray(state.me?.assignments)?state.me.assignments:[];
    if(!assignments.length)return `<div class="card"><h2>分部課點名</h2><div class="notice">尚未設定分部課授課範圍，請先到「我的教學」設定。</div></div>`;
    const idx=Math.min(window.__sectionClassIndex||0,assignments.length-1),c=assignments[idx];
    const groupName=String(c.groupName||c.group||""),section=String(c.section||"");
    const key=[state.sectionSessionDate,groupName,section].join("|"),ready=state.sectionSessionKey===key&&!state.sectionSessionError;
    const students=ready?state.sectionSessionRoster:[];
    if(!ready&&!state.sectionSessionLoading&&state.sectionSessionKey!==key)setTimeout(()=>window.loadSectionExisting(),0);
    const days=schedule[groupName]||[];
    const saving=state.sectionSaveFeedback?.key===key&&state.sectionSaveFeedback.phase==="saving";
    const selector=assignments.length>1?`<label>本次分部課</label><select onchange="changeSectionClass(this.value)" ${saving?"disabled":""}>${assignments.map((x,i)=>`<option value="${i}" ${i===idx?"selected":""}>${esc(x.groupName||x.group)}團｜${esc(x.section)}</option>`).join("")}</select>`:`<div class="notice"><b>${esc(groupName)}團｜${esc(section)}</b></div>`;
    const loaded=state.sectionSessionLoading?'<div class="notice" style="margin-top:10px">⏳ 正在載入點名與併班名單…</div>':state.sectionSessionError?`<div class="notice" style="margin-top:10px">⚠️ ${esc(state.sectionSessionError)}</div>`:ready?`<div id="sectionStoredSummary" class="notice" style="margin-top:10px">${state.sectionSessionLoaded?`${state.sectionSessionLoaded===students.length?"✅ 伺服器已儲存完整點名":"⚠️ 既有點名尚未完整"}｜${state.sectionSessionLoaded}/${students.length} 人；如有修改，仍須重新按「確認儲存」。`:'⚠️ 此堂尚未儲存點名；目前的「出席」僅為預設值，請在頁尾確認儲存。'}</div>`:"";
    const mergeNote=ready&&state.sectionSessionMerges.length?`<div class="notice" style="margin-top:10px"><b>🎼 今日併班：</b>${state.sectionSessionMerges.map(x=>esc(x.sourceSection)).join("、")} 併入 ${esc(section)}；兩個分部統一點名，工時計一堂。</div>`:"";
    const scheduleExtra=groupName==="儲備"?"（時間依學校實際課表）":"";
    return `<div class="card"><h2>分部課點名</h2>${selector}<label>上課日期</label><input id="sDate" type="date" value="${esc(state.sectionSessionDate)}" onchange="changeSectionAttendanceDate(this.value)" ${saving?"disabled":""}>${days.length?`<div class="notice" style="margin-top:10px"><b>${esc(groupName)}團固定分部課：</b>${days.map(d=>dayText[d]).join("、")}${scheduleExtra}</div>`:""}${loaded}${mergeNote}<div class="notice" style="margin-top:10px">點名標準：上課開始後超過 10 分鐘才到課記為「遲到」；10 分鐘內到課記為「出席」。遲到仍算到課。</div></div>
      <div class="card"><h2>${esc(groupName)}團｜${esc(section)}${mergeNote?"（併班）":""}學生名單</h2>${students.length?students.map(s=>`<div class="item"><div><b>${esc(s.name)}</b><small>${esc(s.grade)}｜${esc(s.section||section)}｜${esc(s.instrument)}</small></div><select id="att_${s.studentId}" class="status-select" onchange="setSectionStatus('${esc(s.studentId)}',this.value)" ${saving?"disabled":""}>${statusOptions(state.sectionSessionStatuses[String(s.studentId)]||"present")}</select></div>`).join(""):`<div class="notice">${ready?"目前沒有符合此團別／分部的學生。":"請稍候載入名單，或檢查上方提示。"}</div>`}${students.length?`<button id="sectionConfirmSave" class="primary" onclick="saveSection()" ${saving?"disabled":""}>${saving?"⏳ 正在儲存並確認…":"確認儲存分部課點名"}</button>${saveFeedback("section",key,state.sectionSessionLoaded,students.length,"sectionSaveFeedback")}<button class="secondary" style="width:100%;margin-top:10px" onclick="exportSectionFollowup()">📤 一鍵匯出未到學生名單</button>`:""}</div>`;
  };

  window.saveSection=async function(){
    if(state.sectionSaveFeedback?.phase==="saving")return;
    const c=currentSection();if(!c){toast("尚未設定分部課");return}
    const groupName=String(c.groupName||c.group||""),section=String(c.section||"");
    const key=[state.sectionSessionDate,groupName,section].join("|");
    if(state.sectionSessionKey!==key||state.sectionSessionError){toast("請先載入本次點名名單");return}
    const students=state.sectionSessionRoster;
    const items=students.map(s=>{const status=String(state.sectionSessionStatuses[String(s.studentId)]||"present");return {studentId:s.studentId,status,minutes:["present","late"].includes(status)?45:0}});
    if(!items.length){toast("目前沒有可儲存的學生");return}
    const sessionDate=state.sectionSessionDate;
    state.sectionSaveFeedback={key,phase:"saving",message:"⏳ 正在儲存並向伺服器核對，請勿離開。"};render();
    try{
      const posted=await api("/api/section-attendance",{method:"POST",body:JSON.stringify({sessionDate,section,groupName,items})});
      if(posted?.ok!==true||Number(posted.count)!==items.length)throw new Error("伺服器未確認全部學生");
      const fresh=await api(`/api/section-attendance?sessionDate=${encodeURIComponent(sessionDate)}&groupName=${encodeURIComponent(groupName)}&section=${encodeURIComponent(section)}&_=${Date.now()}`);
      const rosterIds=new Set((fresh.roster||[]).map(x=>String(x.studentId)));
      if(!verifiedItems(fresh,items)||!Array.isArray(fresh.roster)||rosterIds.size!==items.length||items.some(x=>!rosterIds.has(String(x.studentId))))throw new Error("回讀的學生紀錄與送出內容不一致");
      if(state.sectionSessionDate===sessionDate&&currentSection()===c){
        state.sectionRequestSequence=(state.sectionRequestSequence||0)+1;
        const records=fresh.items.filter(x=>rosterIds.has(String(x.studentId)));
        state.sectionSessionStatuses=Object.fromEntries(records.map(x=>[String(x.studentId),String(x.status||"present")]));
        state.sectionSessionLoaded=records.length;state.sectionSessionRoster=fresh.roster;state.sectionSessionMerges=fresh.merges||[];
        state.sectionSessionKey=key;state.sectionSessionError="";state.sectionSessionLoading=false;
      }
      state.sectionSaveFeedback={key,phase:"success",message:`✅ 伺服器已確認儲存｜${sessionDate} ${groupName}團 ${section}｜${items.length}/${fresh.roster.length} 人${savedTime(fresh.lastSavedAt)?`｜${savedTime(fresh.lastSavedAt)}`:""}。可安心離開本頁。`};
      state.teacherTodayStatusDate="";
      toast("✅ 點名已確認儲存");
    }catch(e){state.sectionSaveFeedback={key,phase:"warning",message:`⚠️ 尚未確認全部點名已儲存（${e.message}）。請重新按「確認儲存」或請管理員協助核對，勿視為完成。`};toast("⚠️ 點名尚未確認完成")}
    render();
  };

  window.ensemblePage=function(){
    const groups=Array.isArray(state.me?.ensembleGroups)?state.me.ensembleGroups.filter(x=>["A","B"].includes(x)):[];
    if(!groups.length)return `<div class="card"><h2>合奏課點名</h2><div class="notice">尚未設定 A／B 團合奏課授課範圍。</div></div>`;
    const idx=Math.min(window.__ensembleGroupIndex||0,groups.length-1),g=groups[idx];
    const students=state.students.filter(s=>String(s.groupName)===g);
    const key=[state.ensembleSessionDate,g].join("|"),saving=state.ensembleSaveFeedback?.key===key&&state.ensembleSaveFeedback.phase==="saving";
    const ready=state.ensembleSessionKey===key&&!state.ensembleSessionError&&!state.ensembleSessionLoading;
    const selector=groups.length>1?`<label>合奏課</label><select onchange="changeEnsembleGroup(this.value)" ${saving?"disabled":""}>${groups.map((x,i)=>`<option value="${i}" ${i===idx?"selected":""}>${esc(x)}團｜四分部合班</option>`).join("")}</select>`:`<div class="notice"><b>${esc(g)}團｜四分部合班</b></div>`;
    const loaded=state.ensembleSessionLoading?'<div class="notice" style="margin-top:10px">⏳ 正在讀取既有點名…</div>':state.ensembleSessionError?`<div class="notice" style="margin-top:10px">⚠️ 無法確認既有點名：${esc(state.ensembleSessionError)}。請重新開啟課程後核對。</div>`:ready?`<div id="ensembleStoredSummary" class="notice" style="margin-top:10px">${state.ensembleSessionLoaded?`${state.ensembleSessionLoaded===students.length?"✅ 伺服器已儲存完整點名":"⚠️ 既有點名尚未完整"}｜${state.ensembleSessionLoaded}/${students.length} 人；如有修改，仍須重新按「確認儲存」。`:'⚠️ 此堂尚未儲存點名；目前的「出席」僅為預設值，請在頁尾確認儲存。'}</div>`:"";
    return `<div class="card"><h2>合奏課點名</h2>${selector}<label>上課日期</label><input id="eDate" type="date" value="${esc(state.ensembleSessionDate)}" onchange="changeEnsembleAttendanceDate(this.value)" ${saving?"disabled":""}><div class="notice" style="margin-top:10px"><b>${esc(g)}團合奏課：</b>每週二 12:30–13:20，四個分部一起點名；補課或臨時調整仍可選日期。</div>${loaded}<div class="notice" style="margin-top:10px">點名標準：上課開始後超過 10 分鐘才到課記為「遲到」；10 分鐘內到課記為「出席」。遲到仍算到課。</div></div>
      <div class="card"><h2>${esc(g)}團學生名單</h2>${students.length?students.map(s=>`<div class="item"><div><b>${esc(s.name)}</b><small>${esc(s.section||"待確認")}｜${esc(s.instrument)}｜${esc(s.grade)}</small></div><select id="ens_${s.studentId}" class="status-select" onchange="setEnsembleStatus('${esc(s.studentId)}',this.value)" ${saving||!ready?"disabled":""}>${statusOptions(state.ensembleSessionStatuses[String(s.studentId)]||"present")}</select></div>`).join(""):`<div class="notice">目前此團沒有學生資料。</div>`}${students.length?`<button id="ensembleConfirmSave" class="primary" onclick="saveEnsemble()" ${saving||!ready?"disabled":""}>${saving?"⏳ 正在儲存並確認…":"確認儲存合奏課點名"}</button>${saveFeedback("ensemble",key,state.ensembleSessionLoaded,students.length,"ensembleSaveFeedback")}<button class="secondary" style="width:100%;margin-top:10px" onclick="exportEnsembleFollowup()">📤 一鍵匯出未到學生名單</button>`:""}</div>`;
  };

  window.saveEnsemble=async function(){
    if(state.ensembleSaveFeedback?.phase==="saving")return;
    const g=currentEnsemble();if(!g){toast("尚未設定合奏課");return}
    const key=[state.ensembleSessionDate,g].join("|");
    if(state.ensembleSessionKey!==key||state.ensembleSessionError||state.ensembleSessionLoading){toast("請先載入本次點名名單");return}
    const students=state.students.filter(s=>String(s.groupName)===g);
    const items=students.map(s=>{const status=String(state.ensembleSessionStatuses[String(s.studentId)]||"present");return {studentId:s.studentId,status,minutes:["present","late"].includes(status)?50:0}});
    if(!items.length){toast("目前沒有可儲存的學生");return}
    const sessionDate=state.ensembleSessionDate;
    state.ensembleSaveFeedback={key,phase:"saving",message:"⏳ 正在儲存並向伺服器核對，請勿離開。"};render();
    try{
      const posted=await api("/api/ensemble-attendance",{method:"POST",body:JSON.stringify({sessionDate,groupName:g,items})});
      if(posted?.ok!==true||Number(posted.count)!==items.length)throw new Error("伺服器未確認全部學生");
      const fresh=await api(`/api/ensemble-attendance?sessionDate=${encodeURIComponent(sessionDate)}&groupName=${encodeURIComponent(g)}&_=${Date.now()}`);
      if(!verifiedItems(fresh,items))throw new Error("回讀的學生紀錄與送出內容不一致");
      if(state.ensembleSessionDate===sessionDate&&currentEnsemble()===g){
        state.ensembleRequestSequence=(state.ensembleRequestSequence||0)+1;
        const active=new Set(items.map(x=>String(x.studentId))),records=fresh.items.filter(x=>active.has(String(x.studentId)));
        state.ensembleSessionStatuses=Object.fromEntries(records.map(x=>[String(x.studentId),String(x.status||"present")]));
        state.ensembleSessionLoaded=records.length;state.ensembleSessionKey=key;state.ensembleSessionError="";state.ensembleSessionLoading=false;
      }
      state.ensembleSaveFeedback={key,phase:"success",message:`✅ 伺服器已確認儲存｜${sessionDate} ${g}團合奏課｜${items.length} 人${savedTime(fresh.lastSavedAt)?`｜${savedTime(fresh.lastSavedAt)}`:""}。可安心離開本頁。`};
      state.teacherTodayStatusDate="";
      toast("✅ 點名已確認儲存");
    }catch(e){state.ensembleSaveFeedback={key,phase:"warning",message:`⚠️ 尚未確認全部點名已儲存（${e.message}）。請重新按「確認儲存」或請管理員協助核對，勿視為完成。`};toast("⚠️ 點名尚未確認完成")}
    render();
  };

  const priorGo=go;
  go=async function(p){
    if(p==="section"&&state.me?.capabilities?.section){state.page="section";try{await fetchSection(state.sectionSelectedDate||state.sectionSessionDate)}catch(e){toast("⚠️ 無法讀取既有點名："+e.message)}render();return}
    if(p==="ensemble"&&state.me?.capabilities?.ensemble){state.page="ensemble";try{await fetchEnsemble(state.ensembleSessionDate)}catch(e){toast("⚠️ 無法讀取既有點名："+e.message)}render();return}
    return priorGo(p);
  };

  let retries=0;
  const timer=setInterval(async()=>{
    retries++;
    if(state.me?.capabilities?.teacherSettings){
      clearInterval(timer);
      try{
        if(state.page==="section"&&state.me.capabilities.section)await fetchSection(state.sectionSelectedDate||state.sectionSessionDate);
        if(state.page==="ensemble"&&state.me.capabilities.ensemble)await fetchEnsemble(state.ensembleSessionDate);
      }catch{}
      render();
    }else if(retries>40)clearInterval(timer);
  },100);
})();
