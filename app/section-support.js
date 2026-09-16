(()=>{
  const sectionOptions=["小提一部","小提二部","中提","大提","低音提","待確認"];
  const sectionOpts=(val)=>sectionOptions.map(x=>`<option value="${esc(x)}" ${x===val?"selected":""}>${esc(x)}</option>`).join("");

  const originalStudentEdit=studentEdit;
  studentEdit=function(s){
    return `<div class="card"><h2>${esc(s.name)} <span class="badge ${s.status==="active"?"ok":"warn"}">${esc(s.studentId)}</span></h2>
      <label>姓名</label><input id="sn_${s.studentId}" value="${esc(s.name)}">
      <div class="row2"><div><label>年級</label><select id="sg_${s.studentId}">${opts(grades,s.grade)}</select></div><div><label>團別</label><select id="sgrp_${s.studentId}">${opts(groups,s.groupName)}</select></div></div>
      <div class="row2"><div><label>樂器</label><select id="si_${s.studentId}">${opts(instruments,s.instrument)}</select></div><div><label>分部</label><select id="ssec_${s.studentId}">${sectionOpts(s.section||"待確認")}</select></div></div>
      <div class="row2"><div><label>學年度</label><input id="sy_${s.studentId}" value="${esc(s.schoolYear||"")}"></div><div><label>狀態</label><select id="ss_${s.studentId}"><option value="active" ${s.status==="active"?"selected":""}>在團</option><option value="inactive" ${s.status==="inactive"?"selected":""}>停用／離團</option></select></div></div>
      <button class="primary" onclick="saveStudent('${s.studentId}')">儲存異動</button></div>`;
  };

  saveStudent=async function(id){
    const body={studentId:id,name:$(`sn_${id}`).value,grade:$(`sg_${id}`).value,groupName:$(`sgrp_${id}`).value,instrument:$(`si_${id}`).value,section:$(`ssec_${id}`).value,schoolYear:$(`sy_${id}`).value,status:$(`ss_${id}`).value};
    try{await api("/api/student-master",{method:"PATCH",body:JSON.stringify(body)});toast("✅ 學生主檔已更新");await loadAdmin();render()}catch(e){toast("❌ "+e.message)}
  };

  window.__sectionClassIndex=0;
  window.changeSectionClass=function(v){window.__sectionClassIndex=Number(v)||0;state.sectionExisting=null;state.sectionExistingKey="";render();setTimeout(()=>loadSectionExisting(),0)};
  state.sectionExisting=state.sectionExisting||null; state.sectionExistingKey=state.sectionExistingKey||""; state.sectionLoading=false;
  function sectionContext(){const a=Array.isArray(state.me.assignments)?state.me.assignments:[],c=a[Math.min(window.__sectionClassIndex,Math.max(a.length-1,0))]||a[0];return c?{groupName:String(c.groupName||c.group||""),section:String(c.section||"")}:null}
  window.loadSectionExisting=async function(){const c=sectionContext(),date=$("sDate")?.value;if(!c||!date)return;state.sectionLoading=true;state.sectionExistingKey=[date,c.groupName,c.section].join("|");render();try{state.sectionExisting=await api(`/api/section-attendance?sessionDate=${encodeURIComponent(date)}&groupName=${encodeURIComponent(c.groupName)}&section=${encodeURIComponent(c.section)}`)}catch(e){state.sectionExisting={items:[]};toast("❌ "+e.message)}state.sectionLoading=false;render()};
  function sectionGroupForDate(date){
    const d=new Date(String(date||"")+"T12:00:00"),weekday=d.getDay();
    if(weekday===1||weekday===3)return "A";
    if(weekday===2||weekday===4)return "B";
    if(weekday===5)return "儲備";
    return "";
  }
  function assignmentIndexForDate(date){
    const target=sectionGroupForDate(date),a=Array.isArray(state.me.assignments)?state.me.assignments:[];
    if(!target)return -1;
    const current=a[Math.min(window.__sectionClassIndex||0,Math.max(a.length-1,0))]||a[0];
    const currentSection=String(current?.section||"");
    let i=a.findIndex(x=>{
      const g=String(x.groupName||x.group||"").trim().replace(/團$/,"");
      return g===target&&String(x.section||"")===currentSection;
    });
    if(i<0)i=a.findIndex(x=>String(x.groupName||x.group||"").trim().replace(/團$/,"")===target);
    return i;
  }
  window.changeSectionDate=function(v){
    const date=String(v||$("sDate")?.value||""),next=assignmentIndexForDate(date);
    if(next>=0)window.__sectionClassIndex=next;
    state.sectionSelectedDate=date;state.sectionExisting=null;state.sectionExistingKey="";
    render();setTimeout(()=>loadSectionExisting(),0);
  };

  sectionPage=function(){
    const today=state.sectionSelectedDate||new Date().toLocaleDateString("sv-SE");
    const assignments=Array.isArray(state.me.assignments)?state.me.assignments:[];
    if(!assignments.length){
      return `<div class="card"><h2>分部團練點名</h2><div class="notice">此老師尚未設定「團別＋分部」權限，請管理員設定 SECTION_TEACHER_MAP_JSON。</div></div>`;
    }
    const autoIdx=assignmentIndexForDate(today);if(autoIdx>=0&&state.sectionSelectedDate)window.__sectionClassIndex=autoIdx;
    const idx=Math.min(window.__sectionClassIndex,assignments.length-1);
    const current=assignments[idx]||assignments[0];
    const groupName=String(current.groupName||current.group||"").trim().replace(/團$/,"");
    const section=String(current.section||"");
    const students=state.students.filter(s=>String(s.groupName)===groupName&&String(s.section||"待確認")===section);
    const loaded=state.sectionExistingKey===[today,groupName,section].join("|")?state.sectionExisting:null;
    const weekday=["週日","週一","週二","週三","週四","週五","週六"][new Date(today+"T12:00:00").getDay()];
    const expectedGroup=sectionGroupForDate(today);
    const scheduleHint=expectedGroup?`📅 ${weekday}固定分部課：<b>${esc(expectedGroup)}團</b>｜已依日期自動切換`:`📅 ${weekday}沒有固定分部課；如為補課／調課，可手動選擇授課分部。`;
    const saved=new Map((loaded?.items||[]).map(x=>[String(x.studentId),String(x.status||"present")]));
    const savedCount=saved.size,missing=Math.max(students.length-savedCount,0);
    const statusBox=state.sectionLoading?'<div class="notice" style="margin-top:10px">⏳ 正在確認點名紀錄…</div>':loaded?(savedCount?`<div class="notice" style="margin-top:10px">✅ <b>已點名</b>｜已儲存 ${savedCount}/${students.length} 人${missing?`，⚠️ 尚有 ${missing} 人未有紀錄`:""}。可直接修改後重新儲存。</div>`:'<div class="notice" style="margin-top:10px">⚠️ <b>尚未點名</b>｜此日期尚無儲存紀錄。</div>'):'<div class="notice" style="margin-top:10px">ℹ️ 正在確認是否已有點名紀錄。</div>';
    const selector=assignments.length>1?`<label>本次分部課</label><select onchange="changeSectionClass(this.value)">${assignments.map((x,i)=>`<option value="${i}" ${i===idx?"selected":""}>${esc(String(x.groupName||x.group||"").replace(/團$/,""))}團｜${esc(x.section)}</option>`).join("")}</select>`:`<div class="notice"><b>${esc(groupName)}團｜${esc(section)}</b></div>`;
    return `<div class="card"><h2>分部團練點名</h2><label>上課日期</label><input id="sDate" type="date" value="${today}" onchange="changeSectionDate(this.value)"><div class="notice" style="margin-top:10px">${scheduleHint}</div>${selector}${statusBox}<input id="sSection" type="hidden" value="${esc(section)}"><input id="sGroup" type="hidden" value="${esc(groupName)}"></div>
      <div class="card"><h2>${esc(groupName)}團｜${esc(section)}學生名單</h2>${students.length?students.map(s=>`<div class="item"><div><b>${esc(s.name)}</b><small>${esc(s.grade)}｜${esc(s.instrument)}</small></div><select id="att_${s.studentId}" class="status-select"><option value="present" ${saved.get(String(s.studentId))==="present"?"selected":""}>出席</option><option value="late" ${saved.get(String(s.studentId))==="late"?"selected":""}>遲到</option><option value="leave" ${saved.get(String(s.studentId))==="leave"?"selected":""}>請假</option><option value="absent" ${saved.get(String(s.studentId))==="absent"?"selected":""}>缺席</option><option value="cancelled" ${saved.get(String(s.studentId))==="cancelled"?"selected":""}>停課</option></select></div>`).join(""):`<div class="notice">目前沒有符合此團別／分部的學生。請確認學生主檔中的「團別」與「分部」。</div>`}${students.length?`<button class="primary" onclick="saveSection()">儲存本次點名</button>`:""}</div>`;
  };

  saveSection=async function(){
    const assignments=Array.isArray(state.me.assignments)?state.me.assignments:[];
    const current=assignments[Math.min(window.__sectionClassIndex,assignments.length-1)]||assignments[0];
    if(!current){toast("尚未設定分部課權限");return}
    const groupName=String(current.groupName||current.group||"").trim().replace(/團$/,"");
    const section=String(current.section||"");
    const students=state.students.filter(s=>String(s.groupName)===groupName&&String(s.section||"待確認")===section);
    const items=students.map(s=>({studentId:s.studentId,status:$(`att_${s.studentId}`).value,minutes:$(`att_${s.studentId}`).value==="absent"?0:45}));
    try{await api("/api/section-attendance",{method:"POST",body:JSON.stringify({sessionDate:$("sDate").value,section,groupName,items})});toast(`✅ ${groupName}團｜${section} 點名已儲存`);await loadSectionExisting()}catch(e){toast("❌ "+e.message)}
  };
})();
