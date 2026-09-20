(()=>{
  state.privateLessons=state.privateLessons||[];
  state.privateLessonToday=state.privateLessonToday||"";
  state.privateLessonNowTime=state.privateLessonNowTime||"";
  let privatePoll=null;

  const workflowText={scheduled:"已預約",awaiting_parent:"待家長確認",issue:"家長回報問題",completed:"流程完成",cancelled:"已停課"};
  const workflowClass={scheduled:"warn",awaiting_parent:"warn",issue:"bad",completed:"ok",cancelled:"bad"};
  const notificationTypeText={scheduled:"預約",rescheduled:"改期",cancelled:"停課",completed:"完課確認",confirmed:"家長確認",issue:"問題回報"};
  const emailText={sent:"Email 已寄送",partial:"Email 部分寄送",failed:"Email 寄送失敗",not_configured:"Email 尚未設定",no_recipients:"尚無收件人 Email",disabled:"Email 通知已由後台關閉",pending:"Email 準備中",not_required:""};
  function localDate(){const d=new Date(),x=new Date(d.getTime()-d.getTimezoneOffset()*60000);return x.toISOString().slice(0,10)}
  function localTime(){const d=new Date();return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`}
  function shiftDate(date,days){const d=new Date(`${date}T12:00:00`);d.setDate(d.getDate()+Number(days||0));const x=new Date(d.getTime()-d.getTimezoneOffset()*60000);return x.toISOString().slice(0,10)}
  function today(){return state.privateLessonToday||localDate()}
  function nowTime(){return state.privateLessonNowTime||localTime()}
  function workflow(x){
    if(x?.workflowStatus)return String(x.workflowStatus);
    if(x?.status==="cancelled")return "cancelled";
    if(x?.status==="scheduled")return "scheduled";
    if(x?.status==="completion_issue"||x?.parentConfirmation==="issue")return "issue";
    if(x?.status==="teacher_completed"||x?.parentConfirmation==="pending")return "awaiting_parent";
    return "completed";
  }
  function canChange(x){return workflow(x)==="scheduled"&&today()<String(x.lessonDate||"")}
  function canComplete(x){const date=String(x.lessonDate||""),end=String(x.endTime||"");return workflow(x)==="issue"||workflow(x)==="scheduled"&&(date<today()||date===today()&&end&&nowTime()>=end)}
  function teacherAccount(){return state.me?.role!=="admin"&&!!state.me?.capabilities?.private}
  function teacherLabel(x){const raw=String(x?.teacherName||"").trim(),name=raw&&!raw.includes("@")?raw:"個別課老師";return /老師$/.test(name)?name:`${name}老師`}
  function currentStudentName(id){const s=(state.students||[]).find(x=>String(x.studentId)===String(id));return s?.name||id}
  function lessonDomKey(id){return String(id||"").replace(/[^a-zA-Z0-9_-]/g,"_")}
  function ratingStars(value){const n=Math.max(0,Math.min(5,Number(value||0)));return "★".repeat(n)+"☆".repeat(5-n)}
  function fmtEmailAt(v){if(!v)return "";try{return new Intl.DateTimeFormat("zh-TW",{timeZone:"Asia/Taipei",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(v))}catch{return ""}}
  function emailStatusLine(x){
    const label=emailText[x?.emailNotificationStatus]||"";if(!label)return "";
    const type=notificationTypeText[x?.emailNotificationType]||"通知",total=Number(x?.emailNotificationRecipients||0),rawSent=Number(x?.emailNotificationSentCount||0),failed=Number(x?.emailNotificationFailedCount||0),sent=x?.emailNotificationStatus==="sent"&&total&&rawSent===0?total:rawSent,at=fmtEmailAt(x?.emailNotificationAt),resend=Number(x?.emailNotificationResendCount||0);
    return `📩 ${type}：${label}${total?`｜${sent}/${total} 位${failed?`（失敗 ${failed}）`:""}`:""}${at?`｜${at}`:""}${resend?`｜重寄 ${resend} 次`:""}`;
  }
  function notifyToast(result,successText){
    const m=result?.emailNotification||{};
    if(m.status==="sent")toast(`✅ ${successText}，Email 已寄送 ${m.sentCount||m.recipientCount||1} 位`);
    else if(m.status==="partial")toast(`⚠️ ${successText}；部分 Email 寄送失敗`);
    else if(m.status==="no_recipients")toast(`✅ ${successText}；目前尚無可通知的 Email`);
    else if(m.status==="not_configured")toast(`✅ ${successText}；Azure Email 尚未設定`);
    else if(m.status==="disabled")toast(`✅ ${successText}；Email 通知目前關閉`);
    else if(m.status==="failed")toast(`⚠️ ${successText}；Email 寄送失敗，平台資料已同步`);
    else toast(`✅ ${successText}`);
  }
  function sortedLessons(rows=state.privateLessons){
    const rank={awaiting_parent:0,issue:1,scheduled:2,completed:3,cancelled:4};
    return [...(rows||[])].sort((a,b)=>{
      const wa=workflow(a),wb=workflow(b),r=(rank[wa]??9)-(rank[wb]??9);if(r)return r;
      if(wa==="scheduled")return String(a.lessonDate).localeCompare(String(b.lessonDate))||String(a.startTime).localeCompare(String(b.startTime));
      return String(b.lessonDate).localeCompare(String(a.lessonDate))||String(b.startTime).localeCompare(String(a.startTime));
    });
  }
  function scheduleEditor(x,source){
    if(!canChange(x))return "";
    const k=`${source}_${lessonDomKey(x.lessonId)}`;
    return `<details style="margin-top:10px"><summary style="cursor:pointer;font-weight:900;color:#3155a4">📅 改期</summary><div style="margin-top:8px"><label>新日期</label><input id="plDate_${k}" type="date" min="${esc(today())}" value="${esc(x.lessonDate)}"><div class="row2"><div><label>開始時間</label><input id="plStart_${k}" type="time" value="${esc(x.startTime)}"></div><div><label>結束時間</label><input id="plEnd_${k}" type="time" value="${esc(x.endTime)}"></div></div><label>改期原因（選填）</label><input id="plReason_${k}" maxlength="300" placeholder="例：家庭行程調整"><button class="secondary" style="width:100%;margin-top:10px" onclick="reschedulePrivateLesson('${esc(x.studentId)}','${esc(x.lessonId)}','${source}')">儲存改期並同步通知</button></div></details>`;
  }
  function cancelButton(x,source){return canChange(x)?`<button class="secondary" style="width:100%;margin-top:8px;border-color:#c94b4b;color:#a52a2a" onclick="cancelPrivateLesson('${esc(x.studentId)}','${esc(x.lessonId)}','${source}')">⏸️ 停課並同步通知</button>`:""}
  function lessonSummary(x,{showStudent=false}={}){
    const rating=Number(x.teacherRating||0),review=x.teacherReview?`<br>家長評論：${esc(x.teacherReview)}`:"",rated=rating?`<br>師資評價：<span style="color:#d5a100;font-weight:900">${ratingStars(rating)}</span> ${rating}/5`:"",student=showStudent?`${esc(currentStudentName(x.studentId))}｜`:"";
    return `<div><b>${student}${esc(x.lessonDate)}｜${esc(x.startTime||"")}～${esc(x.endTime||"")}</b><small>${esc(teacherLabel(x))}｜${Number(x.minutes||0)} 分鐘${x.actualAttendanceStatus==="late"&&["awaiting_parent","completed","issue"].includes(workflow(x))?"｜遲到後完成":""}${x.lessonContent?`<br>內容：${esc(x.lessonContent)}`:""}${rated}${review}${x.rescheduleCount?`<br>已改期 ${Number(x.rescheduleCount)} 次`:""}${emailStatusLine(x)?`<br>${esc(emailStatusLine(x))}`:""}${x.parentNote?`<br>家長備註：${esc(x.parentNote)}`:""}${workflow(x)==="cancelled"&&x.cancelReason?`<br>停課原因：${esc(x.cancelReason)}`:""}</small></div>`;
  }
  function parentReviewControls(x){
    if(workflow(x)!=="awaiting_parent")return "";
    const k=lessonDomKey(x.lessonId),rating=Number(x.teacherRating||0);let stars="";
    for(let n=1;n<=5;n++)stars+=`<button type="button" data-star-rating="${esc(k)}" data-star-value="${n}" aria-label="${n} 顆星" aria-pressed="${n<=rating?"true":"false"}" onclick="setPrivateLessonRating('${esc(x.lessonId)}',${n})" style="border:0;background:transparent;padding:2px;font-size:30px;line-height:1;color:#d5a100;cursor:pointer">${n<=rating?"★":"☆"}</button>`;
    return `<div class="notice" style="margin-top:10px"><b>✅ 請家長確認已完成上課</b><br><span class="muted">老師已送出完課；星等為選填。若選擇 1～5 顆星，請同時填寫文字評論；若不評分，可直接確認完成上課。</span><input id="rating_${esc(k)}" type="hidden" value="${rating}"><label style="margin-top:10px">老師教學星等（選填）</label><div style="display:flex;align-items:center;gap:4px;margin:6px 0 10px">${stars}<button type="button" class="secondary" style="margin:0 0 0 8px;padding:6px 9px" onclick="setPrivateLessonRating('${esc(x.lessonId)}',0)">清除</button></div><label>老師教學評論／家長備註（選擇星等後必填）</label><textarea id="review_${esc(k)}" rows="3" maxlength="800" placeholder="選擇星等後，請填寫本次課程回饋，例如：學習狀況、老師指導或需要協助的事項">${esc(x.teacherReview||"")}</textarea><div class="row2" style="margin-top:10px"><button class="primary" style="margin-top:0" onclick="confirmPrivateLesson('${esc(x.lessonId)}','confirmed')">✅ 確認完成上課</button><button class="secondary" style="margin-top:0" onclick="confirmPrivateLesson('${esc(x.lessonId)}','issue')">⚠️ 回報問題</button></div></div>`;
  }
  function parentLessonRow(x){
    const w=workflow(x),badge=`<span class="badge ${workflowClass[w]||""}">${esc(workflowText[w]||w)}</span>`;
    let action="";
    if(w==="scheduled")action=canChange(x)?`${scheduleEditor(x,"parent")}${cancelButton(x,"parent")}`:`<div class="notice" style="margin-top:10px">${String(x.lessonDate)===today()?"今天是預約上課日；上課完成後，請等待老師送出完課確認。":"已到或超過上課日期，等待老師更新上課結果。"}</div>`;
    else if(w==="awaiting_parent")action=parentReviewControls(x);
    else if(w==="issue")action=`<div class="notice" style="margin-top:10px">已將問題同步給老師，等待老師確認後重新送出完課。</div>`;
    return `<div class="item" style="display:block"><div class="student">${lessonSummary(x)}${badge}</div>${action}</div>`;
  }
  function teacherLessonRow(x){
    const w=workflow(x),badge=`<span class="badge ${workflowClass[w]||""}">${esc(workflowText[w]||w)}</span>`;let action="";
    if(w==="scheduled"){
      if(canChange(x))action=`${scheduleEditor(x,"teacher")}${cancelButton(x,"teacher")}<button class="secondary" style="width:100%;margin-top:8px" onclick="resendPrivateLessonEmail('${esc(x.studentId)}','${esc(x.lessonId)}','teacher')">📨 重寄預約 Email</button>`;
      else if(String(x.lessonDate)===today()){
        const k=lessonDomKey(x.lessonId),ended=canComplete(x);
        action=`<div class="notice" style="margin-top:10px"><b>今天是預約上課日</b><br>原預約時間固定為 ${esc(x.startTime)}～${esc(x.endTime)}，開啟或儲存上課內容都不會改動預約時間。</div><label>實際課程內容（可修正）</label><textarea id="completeContent_${k}" rows="3" maxlength="500">${esc(x.lessonContent||"")}</textarea><button class="secondary" style="width:100%;margin-top:8px" onclick="savePrivateLessonContent('${esc(x.studentId)}','${esc(x.lessonId)}')">💾 儲存上課內容</button>${ended?`<label>實際上課狀態</label><select id="completeAttendance_${k}"><option value="present" ${x.actualAttendanceStatus!=="late"?"selected":""}>完成上課</option><option value="late" ${x.actualAttendanceStatus==="late"?"selected":""}>遲到後完成</option></select><button class="primary" onclick="completePrivateLesson('${esc(x.studentId)}','${esc(x.lessonId)}')">✅ 已完成上課並通知家長</button>`:`<div class="muted" style="margin-top:8px">預約結束時間 ${esc(x.endTime)} 後，才可送出「完成上課」。</div>`}`;
      }else if(canComplete(x)){const k=lessonDomKey(x.lessonId);action=`<div class="notice" style="margin-top:10px"><b>本堂預約時間已結束</b><br>原預約時間保留不變；確認實際完成上課後，再送交家長確認。</div><label>實際上課狀態</label><select id="completeAttendance_${k}"><option value="present" ${x.actualAttendanceStatus!=="late"?"selected":""}>完成上課</option><option value="late" ${x.actualAttendanceStatus==="late"?"selected":""}>遲到後完成</option></select><label>實際課程內容（可修正）</label><textarea id="completeContent_${k}" rows="2" maxlength="500">${esc(x.lessonContent||"")}</textarea><button class="primary" onclick="completePrivateLesson('${esc(x.studentId)}','${esc(x.lessonId)}')">✅ 已完成上課並通知家長</button>`}
      else action=`<div class="notice" style="margin-top:10px">預約已同步給家長；預約日期與時間會固定保留。</div>`;
    }else if(w==="awaiting_parent")action=`<div class="notice" style="margin-top:10px">老師已完成上課，等待家長確認；家長確認後才正式完成流程。</div><button class="secondary" style="width:100%;margin-top:8px" onclick="resendPrivateLessonEmail('${esc(x.studentId)}','${esc(x.lessonId)}','teacher')">📨 重寄完課確認 Email</button>`;
    else if(w==="issue"){
      const k=lessonDomKey(x.lessonId);action=`<div class="error" style="margin-top:10px"><b>家長回報問題</b><br>${esc(x.parentNote||"請聯繫家長確認")}</div><label>實際上課狀態</label><select id="completeAttendance_${k}"><option value="present" ${x.actualAttendanceStatus!=="late"?"selected":""}>完成上課</option><option value="late" ${x.actualAttendanceStatus==="late"?"selected":""}>遲到後完成</option></select><label>修正後課程內容（選填）</label><textarea id="completeContent_${k}" rows="2" maxlength="500">${esc(x.lessonContent||"")}</textarea><button class="primary" onclick="completePrivateLesson('${esc(x.studentId)}','${esc(x.lessonId)}')">再次送出完課確認</button>`;
    }else if(w==="completed")action=`<div class="notice" style="margin-top:10px">🔒 老師完課與家長確認均已完成，紀錄已結案。</div>`;
    return `<div class="item" id="privateLesson_${lessonDomKey(x.lessonId)}" style="display:block"><div class="student">${lessonSummary(x,{showStudent:true})}${badge}</div>${action}</div>`;
  }

  async function loadPrivateLessons(){
    try{
      let d;
      if(state.me?.role==="parent"&&state.student?.studentId)d=await api(`/api/private-lesson?studentId=${encodeURIComponent(state.student.studentId)}`);
      else if(teacherAccount())d=await api("/api/private-lesson");
      else {state.privateLessons=[];return}
      state.privateLessons=d.items||[];state.privateLessonToday=d.today||localDate();state.privateLessonNowTime=d.nowTime||localTime();
    }catch(e){console.warn("load private lessons failed",e);state.privateLessons=[]}
  }
  function lessonSignature(){return JSON.stringify((state.privateLessons||[]).map(x=>[x.lessonId,x.updatedAt,x.status,x.parentConfirmation,x.lessonDate,x.startTime,x.endTime]))}
  function startPrivatePoll(){
    if(privatePoll)clearInterval(privatePoll);
    if(!(teacherAccount()||state.me?.role==="parent"))return;
    privatePoll=setInterval(async()=>{
      const active=teacherAccount()?state.page==="private":["home","record"].includes(state.page);if(!active)return;
      const before=lessonSignature();await loadPrivateLessons();
      if(before!==lessonSignature())render();
      else if(teacherAccount()){const box=document.getElementById("privateConfirmList");if(box)box.innerHTML=teacherHistoryHtml()}
    },30000);
  }
  function teacherHistoryHtml(){const rows=sortedLessons().slice(0,40);return rows.length?rows.map(teacherLessonRow).join(""):`<div class="notice">目前尚無個別課預約。</div>`}

  window.reloadPrivateLessons=async function(){await loadPrivateLessons();render();toast("已更新個別課預約與確認狀態")};
  window.reschedulePrivateLesson=async function(studentId,lessonId,source){
    const k=`${source}_${lessonDomKey(lessonId)}`,lessonDate=document.getElementById(`plDate_${k}`)?.value,startTime=document.getElementById(`plStart_${k}`)?.value,endTime=document.getElementById(`plEnd_${k}`)?.value,reason=document.getElementById(`plReason_${k}`)?.value.trim()||"";
    if(!lessonDate||!startTime||!endTime){toast("請填寫新的日期、開始與結束時間");return}
    if(!confirm(`確定改期為 ${lessonDate} ${startTime}～${endTime}？\n\n儲存後會同步更新老師與家長平台。`))return;
    try{const r=await api("/api/private-lesson",{method:"PATCH",body:JSON.stringify({studentId,lessonId,action:"reschedule_lesson",lessonDate,startTime,endTime,reason})});notifyToast(r,"個別課已改期並同步");await loadPrivateLessons();render()}catch(e){toast("❌ "+e.message)}
  };
  window.cancelPrivateLesson=async function(studentId,lessonId,source){
    const x=(state.privateLessons||[]).find(r=>String(r.lessonId)===String(lessonId)),who=currentStudentName(studentId),reason=prompt(`請填寫「${who}」這堂個別課的停課原因（可簡短填寫）`,source==="parent"?"家長提出停課":"老師提出停課");
    if(reason===null)return;if(!String(reason).trim()){toast("請填寫停課原因");return}
    if(!confirm(`確定停課？\n\n${x?`${x.lessonDate} ${x.startTime}～${x.endTime}\n`:""}停課後會同步更新雙方平台。`))return;
    try{const r=await api("/api/private-lesson",{method:"PATCH",body:JSON.stringify({studentId,lessonId,action:"cancel_lesson",reason:String(reason).trim()})});notifyToast(r,"個別課已停課並同步");await loadPrivateLessons();render()}catch(e){toast("❌ "+e.message)}
  };
  window.savePrivateLessonContent=async function(studentId,lessonId){
    const k=lessonDomKey(lessonId),lessonContent=document.getElementById(`completeContent_${k}`)?.value.trim()||"";
    try{await api("/api/private-lesson",{method:"PATCH",body:JSON.stringify({studentId,lessonId,action:"update_lesson_content",lessonContent})});toast("✅ 上課內容已儲存；原預約日期與時間保持不變");await loadPrivateLessons();render();setTimeout(()=>document.getElementById("privateLesson_"+k)?.scrollIntoView({behavior:"smooth",block:"center"}),50)}catch(e){toast("❌ "+e.message)}
  };
  window.completePrivateLesson=async function(studentId,lessonId){
    const k=lessonDomKey(lessonId),lessonContent=document.getElementById(`completeContent_${k}`)?.value.trim()||"",attendanceStatus=document.getElementById(`completeAttendance_${k}`)?.value||"present";
    if(!confirm("確定本堂已完成上課？\n\n送出後家長平台會出現『待確認』，並寄送完課確認 Email。"))return;
    try{const r=await api("/api/private-lesson",{method:"PATCH",body:JSON.stringify({studentId,lessonId,action:"complete_lesson",lessonContent,attendanceStatus})});notifyToast(r,"已送出完成上課，等待家長確認");await loadPrivateLessons();render()}catch(e){toast("❌ "+e.message)}
  };
  window.resendPrivateLessonEmail=async function(studentId,lessonId,source="teacher"){
    if(!studentId||!lessonId)return;const x=(state.privateLessons||[]).find(r=>String(r.lessonId)===String(lessonId)),kind=workflow(x)==="scheduled"?"預約":"完課確認";
    if(!confirm(`確定重寄「${currentStudentName(studentId)}」這筆${kind} Email？`))return;
    try{const r=await api("/api/private-lesson",{method:"PATCH",body:JSON.stringify({studentId,lessonId,action:"resend_email"})});notifyToast(r,`${kind} Email 已重寄`);if(source==="admin"&&typeof refreshAdminFollowup==="function")await refreshAdminFollowup();else{await loadPrivateLessons();render()}}catch(e){toast("❌ "+e.message)}
  };
  window.cancelPrivateLessonTeacher=function(studentId,lessonId){return window.cancelPrivateLesson(studentId,lessonId,"teacher")};
  window.setPrivateLessonRating=function(lessonId,value){const k=lessonDomKey(lessonId),n=Math.max(0,Math.min(5,Number(value||0))),input=document.getElementById("rating_"+k);if(input)input.value=String(n);document.querySelectorAll(`[data-star-rating="${k}"]`).forEach(btn=>{const selected=Number(btn.dataset.starValue||0)<=n;btn.textContent=selected?"★":"☆";btn.setAttribute("aria-pressed",selected?"true":"false")})};
  window.confirmPrivateLesson=async function(lessonId,action){
    if(state.me?.role!=="parent"||!state.student)return;let note="",teacherRating=0,teacherReview="";
    if(action==="issue"){note=prompt("請說明問題，例如：日期或時間不符、當天未完成上課")||"";if(!note.trim()){toast("請填寫問題說明");return}}
    else{const k=lessonDomKey(lessonId),reviewInput=document.getElementById("review_"+k);teacherRating=Number(document.getElementById("rating_"+k)?.value||0);teacherReview=String(reviewInput?.value||"").trim();if(teacherRating&&(!Number.isInteger(teacherRating)||teacherRating<1||teacherRating>5)){toast("老師評價必須為 1～5 顆星");return}if(teacherRating&&!teacherReview){toast("已選擇星等，請填寫老師教學評論後再確認");reviewInput?.focus();return}if(teacherReview&&!teacherRating){toast("若要留下老師教學評論，請先選擇 1～5 顆星");return}}
    try{const r=await api("/api/private-lesson",{method:"PATCH",body:JSON.stringify({studentId:state.student.studentId,lessonId,action,note,teacherRating,teacherReview})});notifyToast(r,action==="confirmed"?"已確認完成上課，個課流程已結案":"問題已同步給老師");await loadPrivateLessons();render()}catch(e){toast("❌ "+e.message)}
  };

  function parentActivePanel(){
    if(state.me?.role!=="parent"||!state.student)return "";
    const rows=sortedLessons().filter(x=>["scheduled","awaiting_parent","issue"].includes(workflow(x)));
    if(!rows.length)return "";
    const pending=rows.filter(x=>workflow(x)==="awaiting_parent").length,scheduled=rows.filter(x=>workflow(x)==="scheduled").length;
    return `<div class="card"><h2>🎻 個別課預約與確認 ${pending?`<span class="badge warn">${pending} 待確認</span>`:""}</h2><div class="notice">${scheduled?`目前有 ${scheduled} 堂預約。`:""}預約、改期與停課會同步顯示；老師完成上課後，請家長在此確認。</div>${rows.map(parentLessonRow).join("")}</div>`;
  }
  function parentHistoryPanel(){
    if(state.me?.role!=="parent"||!state.student)return "";
    const rows=sortedLessons().filter(x=>["completed","cancelled"].includes(workflow(x))).slice(0,12);
    return rows.length?`<div class="card"><h2>👤 個別課最近紀錄</h2>${rows.map(parentLessonRow).join("")}</div>`:"";
  }
  window.privateLessonParentPanels=function(location="home"){return location==="record"?parentActivePanel()+parentHistoryPanel():parentActivePanel()};
  const baseHome=home;home=function(){return parentActivePanel()+baseHome()};
  const baseRecordPage=recordPage;recordPage=function(){const html=baseRecordPage();return state.me?.role==="parent"?html+parentActivePanel()+parentHistoryPanel():html};

  privatePage=function(){
    const d=today(),defaultBookingDate=nowTime()<"18:00"?d:shiftDate(d,1),ids=new Set((state.me.privateStudentIds||[]).map(String)),students=(state.students||[]).filter(s=>ids.has(String(s.studentId)));
    if(!students.length)return `<div class="card"><h2>個別課預約</h2><div class="notice">目前尚未綁定這位老師的個課學生。請到「⚙️ 我的教學」選擇個別課學生。</div></div>`;
    setTimeout(startPrivatePoll,0);
    const rows=state.privateLessons||[],month=d.slice(0,7),monthRows=rows.filter(x=>String(x.lessonDate||"").startsWith(month)),scheduled=rows.filter(x=>workflow(x)==="scheduled"&&String(x.lessonDate)>=d),pending=rows.filter(x=>["awaiting_parent","issue"].includes(workflow(x))),completed=monthRows.filter(x=>workflow(x)==="completed"&&["present","late"].includes(String(x.status))),minutes=completed.reduce((n,x)=>n+Number(x.minutes||0),0);
    const latestCompleted=new Map(),nextScheduled=new Map();
    for(const x of rows){const id=String(x.studentId),w=workflow(x);if(w==="completed"&&(!latestCompleted.has(id)||String(x.lessonDate)>String(latestCompleted.get(id).lessonDate)))latestCompleted.set(id,x);if(w==="scheduled"&&String(x.lessonDate)>=d&&(!nextScheduled.has(id)||String(x.lessonDate)<String(nextScheduled.get(id).lessonDate)))nextScheduled.set(id,x)}
    const daysSince=date=>date?Math.floor((new Date(d+"T12:00:00")-new Date(date+"T12:00:00"))/86400000):999;
    const sorted=[...students].sort((a,b)=>{const an=nextScheduled.get(String(a.studentId)),bn=nextScheduled.get(String(b.studentId));if(!!an!==!!bn)return an?-1:1;if(an&&bn)return String(an.lessonDate).localeCompare(String(bn.lessonDate));return daysSince(latestCompleted.get(String(b.studentId))?.lessonDate)-daysSince(latestCompleted.get(String(a.studentId))?.lessonDate)});
    const quick=sorted.map(st=>{const next=nextScheduled.get(String(st.studentId)),last=latestCompleted.get(String(st.studentId)),hint=next?`下次：${next.lessonDate} ${next.startTime}–${next.endTime}`:last?`最近完成：${last.lessonDate} ${last.startTime}–${last.endTime}`:"尚無預約";return `<button class="item" style="width:100%;text-align:left;background:#fff;cursor:pointer" onclick="${next?`openPrivateLesson('${esc(next.lessonId)}')`:`quickPrivateStudent('${esc(st.studentId)}')`}"><div><b>${esc(st.name)}</b><small>${esc(st.groupName)}團｜${esc(st.instrument)}｜${esc(hint)}</small></div><span>${next?"已約":"＋ 預約"}</span></button>`}).join("");
    return `<div class="card"><h2>👤 個別課流程</h2><div class="notice"><b>預約 → 上課 → 老師完課 → 家長確認 → 正式完成</b><br>上課日前，老師與家長都可改期或停課；所有異動會同步至雙方平台。</div><div class="grid"><div class="kpi"><b>${scheduled.length}</b><span>未來預約</span></div><div class="kpi"><b>${pending.length}</b><span>待處理／確認</span></div><div class="kpi"><b>${completed.length}</b><span>本月完成流程</span></div><div class="kpi"><b>${minutes}</b><span>本月完成分鐘</span></div></div></div>
    <div class="card"><h2>快速選擇學生</h2><div class="notice">已有預約的學生優先顯示；也可直接選擇學生建立下一堂課。</div>${quick}</div>
    <div class="card" id="privateBookingForm"><h2>📅 預約個別課</h2><div class="notice">建立後會立即顯示在家長平台，並依後台通知設定寄送預約 Email。</div><label>學生</label><select id="iStudent">${students.map(st=>`<option value="${esc(st.studentId)}">${esc(st.name)}｜${esc(st.groupName)}團｜${esc(st.instrument)}</option>`).join("")}</select><label>上課日期</label><input id="iDate" type="date" min="${esc(d)}" value="${esc(defaultBookingDate)}"><div class="row2"><div><label>開始時間</label><input id="iStart" type="time" value="18:00"></div><div><label>結束時間</label><input id="iEnd" type="time" value="18:50"></div></div><label>預約備註／預計內容（選填）</label><textarea id="iContent" rows="3" placeholder="例：預計複習音階、換把、考試曲"></textarea><button class="primary" onclick="savePrivate()">📅 預約上課並通知家長</button></div>
    <div class="card"><h2>預約／完課／家長確認</h2><button class="secondary" style="width:100%;margin:0 0 10px" onclick="reloadPrivateLessons()">🔄 重新整理雙方狀態</button><div id="privateConfirmList">${teacherHistoryHtml()}</div></div>`;
  };
  window.openPrivateLesson=function(lessonId){const el=document.getElementById("privateLesson_"+lessonDomKey(lessonId));if(el)el.scrollIntoView({behavior:"smooth",block:"center"})};
  window.quickPrivateStudent=function(studentId){const sel=document.getElementById("iStudent");if(sel)sel.value=String(studentId);document.getElementById("privateBookingForm")?.scrollIntoView({behavior:"smooth",block:"start"})};
  savePrivate=async function(){
    const studentId=document.getElementById("iStudent")?.value;if(!studentId)return;
    const body={studentId,lessonDate:document.getElementById("iDate")?.value,startTime:document.getElementById("iStart")?.value,endTime:document.getElementById("iEnd")?.value,lessonContent:document.getElementById("iContent")?.value.trim()||""};
    const existing=(state.privateLessons||[]).find(x=>String(x.studentId)===String(studentId)&&String(x.lessonDate)===String(body.lessonDate)&&workflow(x)!=="cancelled");
    if(existing){toast(`⚠️ ${currentStudentName(studentId)} 當天已有個別課 ${existing.startTime||""}～${existing.endTime||""}`);return}
    try{const r=await api("/api/private-lesson",{method:"POST",body:JSON.stringify(body)});notifyToast(r,"已建立個別課預約並同步家長平台");await loadPrivateLessons();render()}catch(e){toast("❌ "+e.message)}
  };

  const baseRefreshStudent=refreshStudent;refreshStudent=async function(){await baseRefreshStudent();if(state.me?.role==="parent")await loadPrivateLessons()};
  const baseGo=go;go=async function(p){if((p==="private"&&teacherAccount())||(state.me?.role==="parent"&&["home","record"].includes(p)))await loadPrivateLessons();const result=await baseGo(p);startPrivatePoll();return result};
  if(state.me?.role==="parent"&&state.student)loadPrivateLessons().then(()=>{render();startPrivatePoll()}).catch(()=>{});
  if(teacherAccount())startPrivatePoll();
})();
