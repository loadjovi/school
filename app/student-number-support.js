(()=>{
  const sixDigit=id=>/^\d{6}$/.test(String(id||""));
  const semesterText=s=>String(s?.semester)==="1"?"上學期":String(s?.semester)==="2"?"下學期":String(s?.semesterName||"");
  function approvalNoticeText(result){
    const notice=result?.notification||{},line=result?.lineNotification||{};
    let channel=notice.channel,status=notice.status;
    // Older API versions returned the durable LINE result separately from the
    // generic mail status. A known LINE receipt must not become a mail error.
    if(!channel&&(["accepted","partial"].includes(line.status)||line.status==="pending_friend"&&status==="failed")){
      channel="line";status=line.status;
    }
    if(channel==="line")return ({
      accepted:"LINE 已受理，收件待確認",sent:"LINE 已受理，收件待確認",
      partial:"部分 LINE 通知已受理，其餘結果待確認",
      pending_friend:"LINE 通知待確認本校官方帳號好友後補送",
      pending:"LINE 通知結果待確認",unconfirmed:"LINE 通知結果待確認",
      not_bound:"LINE 收件帳號待確認，通知尚未送出",no_recipient:"LINE 收件帳號待確認，通知尚未送出",
      not_configured:"LINE 通知尚未完成設定",environment_suppressed:"此環境未對外發送 LINE 通知",
      ineligible:"LINE 收件資格待確認，通知尚未送出",failed:"LINE 通知發送失敗"
    })[status]||"LINE 通知結果待確認";
    if(channel==="email")return ({
      sent:"Email 已受理，收件待確認",accepted:"Email 已受理，收件待確認",
      partial:"部分 Email 已受理，其餘結果待確認",failed:"Email 通知發送失敗",
      not_configured:"Email 通知尚未完成設定",no_recipient:"尚無可用的 Email 收件地址",
      no_recipients:"尚無可用的 Email 收件地址",disabled:"Email 通知未啟用",
      pending:"Email 通知結果待確認",unconfirmed:"Email 通知結果待確認"
    })[status]||"Email 通知結果待確認";
    return ({sent:"核准通知已受理，收件待確認",accepted:"核准通知已受理，收件待確認",
      failed:"核准通知發送失敗",not_configured:"核准通知尚未完成設定",
      pending:"核准通知結果待確認",unconfirmed:"核准通知結果待確認"})[status]||"";
  }
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
        const noticeText=approvalNoticeText(d);
        toast("✅ 已核准並綁定"+(noticeText?"；"+noticeText:""));
        await loadAdmin();render();
      }catch(e){toast("❌ "+e.message)}
    };
  }
})();
