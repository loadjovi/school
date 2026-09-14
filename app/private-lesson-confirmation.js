(()=>{
  state.privateLessons=state.privateLessons||[];
  let teacherPoll=null;

  const statusText={present:"出席",late:"遲到",leave:"請假",absent:"缺席",cancelled:"停課"};
  const confirmText={pending:"家長待確認",confirmed:"家長已確認",issue:"家長回報有問題",not_required:"不需確認"};
  const confirmClass={pending:"warn",confirmed:"ok",issue:"bad",not_required:""};
  const emailText={sent:"Email 已寄送",partial:"Email 部分寄送",failed:"Email 寄送失敗",not_configured:"Email 尚未設定",no_recipients:"尚無家長 Gmail",pending:"Email 準備中",not_required:""};

  function teacherAccount(){return state.me?.role!=="admin"&&!!state.me?.capabilities?.private}
  function teacherLabel(x){
    const raw=String(x?.teacherName||"").trim();
    const name=raw&& !raw.includes("@") ? raw : "個別課老師";
    return /老師$/.test(name)?name:`${name}老師`;
  }
  function currentStudentName(id){
    const s=(state.students||[]).find(x=>String(x.studentId)===String(id));
    return s?.name||id;
  }
  async function loadPrivateLessons(){
    try{
      if(state.me?.role==="parent"&&state.student?.studentId){
        const d=await api(`/api/private-lesson?studentId=${encodeURIComponent(state.student.studentId)}`);
        state.privateLessons=d.items||[];
      }else if(teacherAccount()){
        const d=await api("/api/private-lesson");
        state.privateLessons=d.items||[];
      }else state.privateLessons=[];
    }catch(e){console.warn("load private lesson confirmations failed",e);state.privateLessons=[]}
  }

  function teacherHistoryHtml(){
    const recent=(state.privateLessons||[]).slice(0,20);
    return recent.length?recent.map(x=>`<div class="item"><div><b>${esc(currentStudentName(x.studentId))}｜${esc(x.lessonDate)}</b><small>${esc(x.startTime||"")}～${esc(x.endTime||"")}｜${Number(x.minutes||0)} 分鐘｜${esc(statusText[x.status]||x.status)}${emailText[x.emailNotificationStatus]?`<br>📩 ${esc(emailText[x.emailNotificationStatus])}`:""}${x.parentNote?`<br>家長：${esc(x.parentNote)}`:""}</small></div><span class="badge ${confirmClass[x.parentConfirmation]||""}">${esc(confirmText[x.parentConfirmation]||x.parentConfirmation)}</span></div>`).join(""):`<div class="notice">目前尚無個別課紀錄。</div>`;
  }

  function startTeacherPoll(){
    if(teacherPoll)clearInterval(teacherPoll);
    if(!teacherAccount())return;
    teacherPoll=setInterval(async()=>{
      if(state.page!=="private")return;
      await loadPrivateLessons();
      const box=document.getElementById("privateConfirmList");
      if(box)box.innerHTML=teacherHistoryHtml();
    },30000);
  }

  window.reloadPrivateLessons=async function(){await loadPrivateLessons();const box=document.getElementById("privateConfirmList");if(box)box.innerHTML=teacherHistoryHtml();else render();toast("已更新個別課確認狀態")};

  window.confirmPrivateLesson=async function(lessonId,action){
    if(state.me?.role!=="parent"||!state.student)return;
    let note="";
    if(action==="issue"){
      note=prompt("請簡單說明問題，例如：日期不符、時間不符、當天未上課")||"";
      if(!note.trim()){toast("請填寫問題說明");return}
    }
    try{
      await api("/api/private-lesson",{method:"PATCH",body:JSON.stringify({studentId:state.student.studentId,lessonId,action,note})});
      toast(action==="confirmed"?"✅ 已確認本次個別課完成":"⚠️ 已回報老師確認");
      await loadPrivateLessons();render();
    }catch(e){toast("❌ "+e.message)}
  };

  function parentLessonNotice(){
    if(state.me?.role!=="parent"||!state.student)return "";
    const pending=(state.privateLessons||[]).filter(x=>x.parentConfirmation==="pending");
    if(!pending.length)return "";
    return `<div class="card"><h2>🔔 個別課待確認 <span class="badge warn">${pending.length}</span></h2><div class="notice">老師已登記個別課日期與時間，請家長確認學生是否完成本次個別課。</div>${pending.map(x=>`<div class="item" style="display:block"><div><b>${esc(x.lessonDate)}｜${esc(x.startTime||"")}～${esc(x.endTime||"")}</b><small>${esc(teacherLabel(x))}｜${esc(statusText[x.status]||x.status)}｜${Number(x.minutes||0)} 分鐘${x.lessonContent?`<br>內容：${esc(x.lessonContent)}`:""}</small></div><div class="row2" style="margin-top:10px"><button class="primary" style="margin-top:0" onclick="confirmPrivateLesson('${esc(x.lessonId)}','confirmed')">✅ 已完成</button><button class="secondary" style="margin-top:0" onclick="confirmPrivateLesson('${esc(x.lessonId)}','issue')">⚠️ 有問題</button></div></div>`).join("")}</div>`;
  }

  const baseHome=home;
  home=function(){return parentLessonNotice()+baseHome()};

  const baseRecordPage=recordPage;
  recordPage=function(){
    const html=baseRecordPage();
    if(state.me?.role!=="parent")return html;
    const rows=(state.privateLessons||[]).slice(0,12);
    if(!rows.length)return html;
    const history=`<div class="card"><h2>👤 個別課確認紀錄</h2>${rows.map(x=>`<div class="item"><div><b>${esc(x.lessonDate)}｜${esc(x.startTime||"")}～${esc(x.endTime||"")}</b><small>${esc(teacherLabel(x))}｜${Number(x.minutes||0)} 分鐘${x.parentNote?`<br>家長備註：${esc(x.parentNote)}`:""}</small></div><span class="badge ${confirmClass[x.parentConfirmation]||""}">${esc(confirmText[x.parentConfirmation]||x.parentConfirmation)}</span></div>`).join("")}</div>`;
    return html+history;
  };

  privatePage=function(){
    const today=new Date().toISOString().slice(0,10);
    const ids=new Set((state.me.privateStudentIds||[]).map(String));
    const students=(state.students||[]).filter(s=>ids.has(String(s.studentId)));
    if(!students.length)return `<div class="card"><h2>個別課紀錄</h2><div class="notice">目前尚未綁定這位老師的個課學生。請到「⚙️ 我的教學」選擇個別課學生。</div></div>`;
    setTimeout(startTeacherPoll,0);
    return `<div class="card"><h2>👤 個別課紀錄</h2><div class="notice">老師完成個別課後登記日期與實際時間；出席／遲到紀錄會同步出現在家長端，系統設定寄信服務後也會自動寄 Email 給已綁定的家長 Gmail。</div><label>學生</label><select id="iStudent">${students.map(s=>`<option value="${esc(s.studentId)}">${esc(s.name)}｜${esc(s.groupName)}團｜${esc(s.instrument)}</option>`).join("")}</select><label>上課日期</label><input id="iDate" type="date" value="${today}"><div class="row2"><div><label>開始時間</label><input id="iStart" type="time" value="18:00"></div><div><label>結束時間</label><input id="iEnd" type="time" value="18:50"></div></div><label>狀態</label><select id="iStatus"><option value="present">出席</option><option value="late">遲到</option><option value="leave">請假</option><option value="absent">缺席</option><option value="cancelled">停課</option></select><label>課程內容</label><textarea id="iContent" rows="3" placeholder="例：音階、換把、考試曲第 1～32 小節"></textarea><button class="primary" onclick="savePrivate()">儲存並通知家長確認</button></div><div class="card"><h2>家長確認狀態</h2><div class="notice">家長確認後，這裡最慢約 30 秒會自動更新；也可以手動重新整理。</div><button class="secondary" style="width:100%;margin:0 0 10px" onclick="reloadPrivateLessons()">🔄 重新整理確認狀態</button><div id="privateConfirmList">${teacherHistoryHtml()}</div></div>`;
  };

  savePrivate=async function(){
    const studentId=$("iStudent")?.value;
    if(!studentId)return;
    const body={studentId,lessonDate:$("iDate").value,startTime:$("iStart").value,endTime:$("iEnd").value,status:$("iStatus").value,lessonContent:$("iContent").value.trim()};
    try{
      const r=await api("/api/private-lesson",{method:"POST",body:JSON.stringify(body)});
      if(r.item?.parentConfirmation==="pending"){
        const m=r.emailNotification||{};
        if(m.status==="sent")toast(`✅ 已儲存並寄送 Email 給 ${m.sentCount||m.recipientCount||1} 位家長`);
        else if(m.status==="no_recipients")toast("✅ 已儲存；此學生尚未綁定家長 Gmail");
        else if(m.status==="not_configured")toast("✅ 已儲存；家長端有通知，但 Email 寄信服務尚未設定");
        else if(m.status==="partial")toast("⚠️ 已儲存；部分家長 Email 已寄送");
        else if(m.status==="failed")toast("⚠️ 已儲存；Email 寄送失敗，網站內通知仍有效");
        else toast("✅ 已儲存，家長端將顯示待確認通知");
      }else toast("✅ 個別課紀錄已儲存");
      await loadPrivateLessons();render();
    }catch(e){toast("❌ "+e.message)}
  };

  const baseRefreshStudent=refreshStudent;
  refreshStudent=async function(){await baseRefreshStudent();if(state.me?.role==="parent")await loadPrivateLessons()};

  const baseGo=go;
  go=async function(p){
    if((p==="private"&&teacherAccount())||(state.me?.role==="parent"&&["home","record"].includes(p)))await loadPrivateLessons();
    return baseGo(p);
  };

  if(state.me?.role==="parent"&&state.student){loadPrivateLessons().then(()=>render()).catch(()=>{})}
  if(teacherAccount())startTeacherPoll();
})();
