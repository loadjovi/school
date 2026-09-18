(()=>{
  const today=()=>new Date().toISOString().slice(0,10);
  const changeLabels={profile_update:"基本資料修改",group_change:"團別異動",leave_or_inactive:"退出弦樂團",rejoin:"重新加入"};
  function sectionOptions(s){return ["小提一部","小提二部","中提","大提","低音提","待確認"].map(x=>`<option value="${esc(x)}" ${x===s?"selected":""}>${esc(x)}</option>`).join("")}
  function enhancedStudentEdit(s){
    const inactive=s.status==="inactive";
    return `<div class="card"><h2>${esc(s.name)} <span class="badge ${inactive?"warn":"ok"}">${inactive?"已退出／停用":"在團"}</span></h2>
      <div class="notice" style="margin-bottom:10px"><b>學號：${esc(s.studentId)}</b>｜${esc(s.grade)}｜${esc(s.groupName)}團｜${esc(s.instrument)}${s.inactiveAt?`<br>退出日期：${esc(s.inactiveAt)}`:s.joinedAt?`<br>加入日期：${esc(String(s.joinedAt).slice(0,10))}`:""}${s.inactiveReason?`<br>原因：${esc(s.inactiveReason)}`:""}</div>
      <details><summary><b>✏️ 基本資料修改</b></summary>
        <label>姓名</label><input id="sn_${s.studentId}" value="${esc(s.name)}">
        <div class="row2"><div><label>年級</label><select id="sg_${s.studentId}">${opts(grades,s.grade)}</select></div><div><label>團別</label><select id="sgrp_${s.studentId}">${opts(groups,s.groupName)}</select></div></div>
        <div class="row2"><div><label>樂器</label><select id="si_${s.studentId}">${opts(instruments,s.instrument)}</select></div><div><label>分部</label><select id="ssec_${s.studentId}">${sectionOptions(s.section)}</select></div></div>
        <div class="row2"><div><label>班級</label><input id="sclass_${s.studentId}" value="${esc(s.classCode||"")}"></div><div><label>座號</label><input id="sseat_${s.studentId}" value="${esc(s.seatNo||"")}"></div></div>
        <label>學年度</label><input id="sy_${s.studentId}" value="${esc(s.schoolYear||"")}">
        <button class="primary" onclick="saveStudentChange('${s.studentId}','profile_update')">儲存基本資料</button>
      </details>
      <details style="margin-top:10px"><summary><b>🔄 學生異動</b></summary>
        <label>異動類型</label><select id="schange_${s.studentId}" onchange="studentChangeType('${s.studentId}')">
          <option value="group_change">團別異動</option><option value="leave_or_inactive">退出弦樂團</option><option value="rejoin" ${inactive?"":"disabled"}>重新加入</option>
        </select>
        <div id="schangeGroup_${s.studentId}"><label>異動後團別</label><select id="snewgrp_${s.studentId}">${opts(groups,s.groupName)}</select></div>
        <div class="row2"><div><label>生效日期</label><input id="seffective_${s.studentId}" type="date" value="${today()}"></div><div><label>異動原因／備註</label><input id="snote_${s.studentId}" placeholder="例：轉入B團、家長申請退團"></div></div>
        <button class="primary" onclick="saveStudentChange('${s.studentId}',document.getElementById('schange_${s.studentId}').value)">確認異動</button>
      </details></div>`;
  }
  window.studentChangeType=function(id){const t=document.getElementById("schange_"+id)?.value,b=document.getElementById("schangeGroup_"+id);if(b)b.style.display=(t==="group_change"||t==="rejoin")?"":"none"};
  window.saveStudentChange=async function(id,type){
    const s=(state.master||[]).find(x=>String(x.studentId)===String(id));if(!s)return;
    const basic=type==="profile_update";
    const status=type==="leave_or_inactive"?"inactive":type==="rejoin"?"active":s.status;
    const body={studentId:id,name:basic?$("sn_"+id).value:s.name,grade:basic?$("sg_"+id).value:s.grade,groupName:basic?$("sgrp_"+id).value:(type==="group_change"||type==="rejoin"?$("snewgrp_"+id).value:s.groupName),instrument:basic?$("si_"+id).value:s.instrument,section:basic?$("ssec_"+id).value:s.section,schoolYear:basic?$("sy_"+id).value:s.schoolYear,classCode:basic?$("sclass_"+id).value:s.classCode,seatNo:basic?$("sseat_"+id).value:s.seatNo,status,changeType:type,changeNote:basic?"基本資料修改":$("snote_"+id)?.value||"",effectiveDate:basic?today():$("seffective_"+id)?.value||today()};
    if(!basic&&!confirm(`確定執行「${changeLabels[type]||"學生異動"}」？\n\n學生：${s.name}\n生效日期：${body.effectiveDate}\n所有歷史點名、練習及家長綁定都會保留。`))return;
    try{await api("/api/student-master",{method:"PATCH",body:JSON.stringify(body)});toast("✅ "+(changeLabels[type]||"學生異動")+"已完成");await loadAdmin();render()}catch(e){toast("❌ "+e.message)}
  };
  if(typeof studentEdit==="function")studentEdit=enhancedStudentEdit;
  const baseStudentsPage=studentsPage;
  studentsPage=function(){
    const active=(state.master||[]).filter(s=>s.status!=="inactive").length,inactive=(state.master||[]).length-active;
    return `<div class="card hero"><h2>👥 學生異動管理</h2><div class="notice"><b>目前在團 ${active} 人｜退出／停用 ${inactive} 人</b><br>學生退出不刪除主檔、家長綁定、點名或練習歷史；重新加入時沿用原學號。團別、分部、班級等資料可直接在既有清冊異動。</div></div>`+baseStudentsPage();
  };
})();