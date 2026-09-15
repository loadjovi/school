(()=>{
  const statusLabels={present:"出席",late:"遲到",leave:"請假",absent:"缺席",cancelled:"停課"};
  const schedule={A:[1,3],B:[2,4],"儲備":[5]};
  const dayText={1:"週一",2:"週二",3:"週三",4:"週四",5:"週五"};
  const today=()=>new Date().toISOString().slice(0,10);
  state.sectionSessionDate=state.sectionSessionDate||today();
  state.sectionSessionStatuses=state.sectionSessionStatuses||{};
  state.sectionSessionLoaded=state.sectionSessionLoaded||0;
  state.ensembleSessionDate=state.ensembleSessionDate||today();
  state.ensembleSessionStatuses=state.ensembleSessionStatuses||{};
  state.ensembleSessionLoaded=state.ensembleSessionLoaded||0;

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
    state.sectionSessionDate=date||today();state.sectionSessionStatuses={};state.sectionSessionLoaded=0;
    if(!c)return;
    const groupName=String(c.groupName||c.group||""),section=String(c.section||"");
    const data=await api(`/api/section-attendance?sessionDate=${encodeURIComponent(state.sectionSessionDate)}&groupName=${encodeURIComponent(groupName)}&section=${encodeURIComponent(section)}`);
    state.sectionSessionStatuses=Object.fromEntries((data.items||[]).map(x=>[String(x.studentId),String(x.status||"present")]));
    state.sectionSessionLoaded=(data.items||[]).length;
  }
  async function fetchEnsemble(date=state.ensembleSessionDate){
    const g=currentEnsemble();
    state.ensembleSessionDate=date||today();state.ensembleSessionStatuses={};state.ensembleSessionLoaded=0;
    if(!g)return;
    const data=await api(`/api/ensemble-attendance?sessionDate=${encodeURIComponent(state.ensembleSessionDate)}&groupName=${encodeURIComponent(g)}`);
    state.ensembleSessionStatuses=Object.fromEntries((data.items||[]).map(x=>[String(x.studentId),String(x.status||"present")]));
    state.ensembleSessionLoaded=(data.items||[]).length;
  }

  window.changeSectionAttendanceDate=async function(v){
    try{await fetchSection(String(v||today()));render()}catch(e){toast("❌ 無法讀取既有分部點名："+e.message)}
  };
  window.changeEnsembleAttendanceDate=async function(v){
    try{await fetchEnsemble(String(v||today()));render()}catch(e){toast("❌ 無法讀取既有合奏課點名："+e.message)}
  };
  window.changeSectionClass=async function(v){
    window.__sectionClassIndex=Number(v)||0;
    try{await fetchSection(state.sectionSessionDate);render()}catch(e){toast("❌ "+e.message);render()}
  };
  window.changeEnsembleGroup=async function(v){
    window.__ensembleGroupIndex=Number(v)||0;
    try{await fetchEnsemble(state.ensembleSessionDate);render()}catch(e){toast("❌ "+e.message);render()}
  };
  window.setSectionStatus=function(id,v){state.sectionSessionStatuses[String(id)]=String(v||"present")};
  window.setEnsembleStatus=function(id,v){state.ensembleSessionStatuses[String(id)]=String(v||"present")};

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
    const students=state.students.filter(s=>String(s.groupName)===groupName&&String(s.section||"待確認")===section);
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
    const students=state.students.filter(s=>String(s.groupName)===groupName&&String(s.section||"待確認")===section);
    const days=schedule[groupName]||[];
    const selector=assignments.length>1?`<label>本次分部課</label><select onchange="changeSectionClass(this.value)">${assignments.map((x,i)=>`<option value="${i}" ${i===idx?"selected":""}>${esc(x.groupName||x.group)}團｜${esc(x.section)}</option>`).join("")}</select>`:`<div class="notice"><b>${esc(groupName)}團｜${esc(section)}</b></div>`;
    const loaded=state.sectionSessionLoaded?`<div class="notice" style="margin-top:10px">✅ 已載入 ${state.sectionSessionLoaded} 筆 ${esc(state.sectionSessionDate)} 的既有點名，可直接修改後重新儲存。</div>`:"";
    const scheduleExtra=groupName==="儲備"?"（時間依學校實際課表）":"";
    return `<div class="card"><h2>分部課點名</h2>${selector}<label>上課日期</label><input id="sDate" type="date" value="${esc(state.sectionSessionDate)}" onchange="changeSectionAttendanceDate(this.value)">${days.length?`<div class="notice" style="margin-top:10px"><b>${esc(groupName)}團固定分部課：</b>${days.map(d=>dayText[d]).join("、")}${scheduleExtra}</div>`:""}${loaded}</div>
      <div class="card"><h2>${esc(groupName)}團｜${esc(section)}學生名單</h2>${students.length?students.map(s=>`<div class="item"><div><b>${esc(s.name)}</b><small>${esc(s.grade)}｜${esc(s.instrument)}</small></div><select id="att_${s.studentId}" class="status-select" onchange="setSectionStatus('${esc(s.studentId)}',this.value)">${statusOptions(state.sectionSessionStatuses[String(s.studentId)]||"present")}</select></div>`).join(""):`<div class="notice">目前沒有符合此團別／分部的學生。</div>`}${students.length?`<button class="primary" onclick="saveSection()">儲存／更新本次點名</button><button class="secondary" style="width:100%;margin-top:10px" onclick="exportSectionFollowup()">📤 一鍵匯出未到學生名單</button>`:""}</div>`;
  };

  window.saveSection=async function(){
    const c=currentSection();if(!c){toast("尚未設定分部課");return}
    const groupName=String(c.groupName||c.group||""),section=String(c.section||"");
    const students=state.students.filter(s=>String(s.groupName)===groupName&&String(s.section||"待確認")===section);
    const items=students.map(s=>{const status=String(state.sectionSessionStatuses[String(s.studentId)]||"present");return {studentId:s.studentId,status,minutes:["present","late"].includes(status)?45:0}});
    try{
      await api("/api/section-attendance",{method:"POST",body:JSON.stringify({sessionDate:state.sectionSessionDate,section,groupName,items})});
      await fetchSection(state.sectionSessionDate);toast(`✅ ${groupName}團｜${section} ${state.sectionSessionDate} 點名已更新`);render();
    }catch(e){toast("❌ "+e.message)}
  };

  window.ensemblePage=function(){
    const groups=Array.isArray(state.me?.ensembleGroups)?state.me.ensembleGroups.filter(x=>["A","B"].includes(x)):[];
    if(!groups.length)return `<div class="card"><h2>合奏課點名</h2><div class="notice">尚未設定 A／B 團合奏課授課範圍。</div></div>`;
    const idx=Math.min(window.__ensembleGroupIndex||0,groups.length-1),g=groups[idx];
    const students=state.students.filter(s=>String(s.groupName)===g);
    const selector=groups.length>1?`<label>合奏課</label><select onchange="changeEnsembleGroup(this.value)">${groups.map((x,i)=>`<option value="${i}" ${i===idx?"selected":""}>${esc(x)}團｜四分部合班</option>`).join("")}</select>`:`<div class="notice"><b>${esc(g)}團｜四分部合班</b></div>`;
    const loaded=state.ensembleSessionLoaded?`<div class="notice" style="margin-top:10px">✅ 已載入 ${state.ensembleSessionLoaded} 筆 ${esc(state.ensembleSessionDate)} 的既有點名，可直接修改後重新儲存。</div>`:"";
    return `<div class="card"><h2>合奏課點名</h2>${selector}<label>上課日期</label><input id="eDate" type="date" value="${esc(state.ensembleSessionDate)}" onchange="changeEnsembleAttendanceDate(this.value)"><div class="notice" style="margin-top:10px"><b>${esc(g)}團合奏課：</b>每週二 12:30–13:20，四個分部一起點名；補課或臨時調整仍可選其他日期。</div>${loaded}</div>
      <div class="card"><h2>${esc(g)}團學生名單</h2>${students.length?students.map(s=>`<div class="item"><div><b>${esc(s.name)}</b><small>${esc(s.section||"待確認")}｜${esc(s.instrument)}｜${esc(s.grade)}</small></div><select id="ens_${s.studentId}" class="status-select" onchange="setEnsembleStatus('${esc(s.studentId)}',this.value)">${statusOptions(state.ensembleSessionStatuses[String(s.studentId)]||"present")}</select></div>`).join(""):`<div class="notice">目前此團沒有學生資料。</div>`}${students.length?`<button class="primary" onclick="saveEnsemble()">儲存／更新合奏課點名</button><button class="secondary" style="width:100%;margin-top:10px" onclick="exportEnsembleFollowup()">📤 一鍵匯出未到學生名單</button>`:""}</div>`;
  };

  window.saveEnsemble=async function(){
    const g=currentEnsemble();if(!g){toast("尚未設定合奏課");return}
    const students=state.students.filter(s=>String(s.groupName)===g);
    const items=students.map(s=>{const status=String(state.ensembleSessionStatuses[String(s.studentId)]||"present");return {studentId:s.studentId,status,minutes:["present","late"].includes(status)?50:0}});
    try{
      await api("/api/ensemble-attendance",{method:"POST",body:JSON.stringify({sessionDate:state.ensembleSessionDate,groupName:g,items})});
      await fetchEnsemble(state.ensembleSessionDate);toast(`✅ ${g}團 ${state.ensembleSessionDate} 合奏課點名已更新`);render();
    }catch(e){toast("❌ "+e.message)}
  };

  const priorGo=go;
  go=async function(p){
    if(p==="section"&&state.me?.capabilities?.section){state.page="section";try{await fetchSection(state.sectionSessionDate)}catch(e){toast("⚠️ 無法讀取既有點名："+e.message)}render();return}
    if(p==="ensemble"&&state.me?.capabilities?.ensemble){state.page="ensemble";try{await fetchEnsemble(state.ensembleSessionDate)}catch(e){toast("⚠️ 無法讀取既有點名："+e.message)}render();return}
    return priorGo(p);
  };

  let retries=0;
  const timer=setInterval(async()=>{
    retries++;
    if(state.me?.capabilities?.teacherSettings){
      clearInterval(timer);
      try{
        if(state.page==="section"&&state.me.capabilities.section)await fetchSection(state.sectionSessionDate);
        if(state.page==="ensemble"&&state.me.capabilities.ensemble)await fetchEnsemble(state.ensembleSessionDate);
      }catch{}
      render();
    }else if(retries>40)clearInterval(timer);
  },100);
})();