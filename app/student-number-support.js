(()=>{
  const sixDigit=id=>/^\d{6}$/.test(String(id||""));
  const semesterText=s=>String(s?.semester)==="1"?"上學期":String(s?.semester)==="2"?"下學期":String(s?.semesterName||"");
  if(typeof pendingCard==="function"){
    pendingCard=function(r){
      const candidates=(state.master||[]).filter(s=>s.status!=="inactive"&&sixDigit(s.studentId));
      return `<div class="card"><h2>${esc(r.studentName)}｜待審核</h2><div class="notice">家長：${esc(r.parentName)}（${esc(r.relationship)}）<br>${esc(r.parentEmail)}<br><br><b>學號是唯一值：</b>核准時只會綁定既有 6 碼學號；若名單尚未建立，請先到「學生主檔」定案本學期名單。</div><label>學生姓名</label><input id="rn_${r.registrationId}" value="${esc(r.studentName)}"><div class="row2"><div><label>年級</label><select id="rg_${r.registrationId}">${opts(grades,r.grade)}</select></div><div><label>團別</label><select id="rgrp_${r.registrationId}">${opts(groups,r.groupName)}</select></div></div><label>樂器</label><select id="ri_${r.registrationId}">${opts(instruments,r.instrument)}</select><label>學年度</label><input id="ry_${r.registrationId}" value="${esc(r.schoolYear||"")}"><label>對應學生學號</label><select id="rm_${r.registrationId}"><option value="">自動依姓名唯一比對</option>${candidates.map(s=>`<option value="${esc(s.studentId)}">${esc(s.studentId)}｜${esc(s.name)}｜${esc(s.grade)}｜${esc(s.groupName)}團｜${esc(s.instrument)}</option>`).join("")}</select><div class="row2"><button class="primary" onclick="approveReg('${r.registrationId}')">核准並綁定</button><button class="secondary" style="margin-top:14px" onclick="rejectReg('${r.registrationId}')">退回</button></div></div>`;
    };
  }
  if(typeof studentEdit==="function"){
    const baseStudentEdit=studentEdit;
    studentEdit=function(s){
      const html=baseStudentEdit(s),term=(s.schoolYear&&s.semester)?`${esc(s.schoolYear)}學年度第${esc(s.semester)}學期（${esc(semesterText(s))}）`:"尚未定案學期";
      const badge=sixDigit(s.studentId)?`<div class="notice" style="margin-bottom:10px"><b>學號／唯一 Student ID：${esc(s.studentId)}</b>${s.classCode?`<br>班級：${esc(s.classCode)}${s.seatNo?`｜座號 ${esc(s.seatNo)}`:""}`:""}<br>目前名單：<b>${term}</b>${s.status==="inactive"?`<br><span style="color:#a43b32">本學期未列入正式上課名單</span>`:""}<br><small>學號永久不變；每學期另行定案是否正式上課。</small></div>`:`<div class="error" style="margin-bottom:10px">歷史 Student ID：${esc(s.studentId)}。請用新版 Excel 重新匯入，轉換為正式 6 碼學號。</div>`;
      return html.replace('<label>姓名</label>',badge+'<label>姓名</label>');
    };
  }

  if(typeof approveReg==="function"){
    approveReg=async function(id){
      const body={registrationId:id,action:"approve",studentName:$(`rn_${id}`).value,grade:$(`rg_${id}`).value,groupName:$(`rgrp_${id}`).value,instrument:$(`ri_${id}`).value,schoolYear:$(`ry_${id}`).value,studentId:$(`rm_${id}`).value};
      try{
        const d=await api("/api/student-registration",{method:"PATCH",body:JSON.stringify(body)});
        const ns=d?.notification?.status;
        if(ns==="sent")toast("✅ 已核准並綁定，認證通知信已寄出");
        else if(ns==="not_configured")toast("✅ 已核准並綁定；Email 尚未完成設定");
        else if(ns==="failed")toast("✅ 已核准並綁定；但通知信寄送失敗");
        else toast("✅ 已核准並綁定");
        await loadAdmin();render();
      }catch(e){toast("❌ "+e.message)}
    };
  }
})();
