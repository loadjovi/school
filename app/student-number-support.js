(()=>{
  const sixDigit=id=>/^\d{6}$/.test(String(id||""));
  if(typeof pendingCard==="function"){
    pendingCard=function(r){
      const candidates=(state.master||[]).filter(s=>s.status!=="inactive"&&sixDigit(s.studentId));
      return `<div class="card"><h2>${esc(r.studentName)}｜待審核</h2><div class="notice">家長：${esc(r.parentName)}（${esc(r.relationship)}）<br>${esc(r.parentEmail)}<br><br><b>學號是唯一值：</b>核准時只會綁定既有 6 碼學號；若名單尚未建立，請先到「學生主檔」匯入學生名單。</div><label>學生姓名</label><input id="rn_${r.registrationId}" value="${esc(r.studentName)}"><div class="row2"><div><label>年級</label><select id="rg_${r.registrationId}">${opts(grades,r.grade)}</select></div><div><label>團別</label><select id="rgrp_${r.registrationId}">${opts(groups,r.groupName)}</select></div></div><label>樂器</label><select id="ri_${r.registrationId}">${opts(instruments,r.instrument)}</select><label>學年度</label><input id="ry_${r.registrationId}" value="${esc(r.schoolYear||"")}"><label>對應學生學號</label><select id="rm_${r.registrationId}"><option value="">自動依姓名唯一比對</option>${candidates.map(s=>`<option value="${esc(s.studentId)}">${esc(s.studentId)}｜${esc(s.name)}｜${esc(s.grade)}｜${esc(s.groupName)}團｜${esc(s.instrument)}</option>`).join("")}</select><div class="row2"><button class="primary" onclick="approveReg('${r.registrationId}')">核准並綁定</button><button class="secondary" style="margin-top:14px" onclick="rejectReg('${r.registrationId}')">退回</button></div></div>`;
    };
  }
  if(typeof studentEdit==="function"){
    const baseStudentEdit=studentEdit;
    studentEdit=function(s){
      const html=baseStudentEdit(s);
      const badge=sixDigit(s.studentId)?`<div class="notice" style="margin-bottom:10px"><b>學號／唯一 Student ID：${esc(s.studentId)}</b>${s.classCode?`<br>班級：${esc(s.classCode)}${s.seatNo?`｜座號 ${esc(s.seatNo)}`:""}`:""}<br><small>學號不可修改；年級、班級、團別、分部與樂器可隨學期更新。</small></div>`:`<div class="error" style="margin-bottom:10px">歷史 Student ID：${esc(s.studentId)}。請用新版 Excel 重新匯入，轉換為正式 6 碼學號。</div>`;
      return html.replace('<label>姓名</label>',badge+'<label>姓名</label>');
    };
  }
})();
