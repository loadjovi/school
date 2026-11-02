(()=>{
  state.trainingAttendanceData=null;
  state.trainingAttendanceStatuses={};
  state.trainingAttendanceList=[];
  state.trainingAttendanceReturn="teacherHome";
  state.trainingSaveFeedback=null;
  const labels={present:"出席",late:"遲到",leave:"請假",absent:"缺席"};
  const today=()=>new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Taipei"});
  function range(){const d=new Date(),from=new Date(d),to=new Date(d);from.setMonth(from.getMonth()-5);to.setMonth(to.getMonth()+5);const fmt=x=>x.toLocaleDateString("sv-SE",{timeZone:"Asia/Taipei"});return `from=${encodeURIComponent(fmt(from))}&to=${encodeURIComponent(fmt(to))}`}
  async function loadList(){const d=await api("/api/training-attendance?"+range());state.trainingAttendanceList=Array.isArray(d.items)?d.items.filter(x=>String(x.status||"active")==="active"):[]}
  async function loadEvent(eventId){const d=await api("/api/training-attendance?eventId="+encodeURIComponent(eventId));state.trainingAttendanceData=d;state.trainingAttendanceStatuses=Object.fromEntries((d.items||[]).map(x=>[String(x.studentId),String(x.status||"")]))}
  const markedCount=()=>{const rows=state.trainingAttendanceData?.items||[];return rows.filter(x=>labels[state.trainingAttendanceStatuses[String(x.studentId)]]).length};
  function updateProgress(){
    const total=state.trainingAttendanceData?.items?.length||0,count=markedCount(),complete=total>0&&count===total;
    const text=document.getElementById("trainingMarkedCount");if(text)text.textContent=`已標記 ${count}/${total} 人${complete?"，可以儲存":""}`;
    const button=document.getElementById("trainingSaveButton");if(button&&button.dataset.saving!=="true")button.disabled=!complete;
    const step=document.getElementById("trainingStepThree");if(step)step.classList.toggle("is-ready",complete);
  }
  function feedback(eventId){
    const f=state.trainingSaveFeedback?.eventId===eventId?state.trainingSaveFeedback:null;
    const message=f?.message||"尚未完成：請標記每位學生，再按「儲存並完成點名」。";
    const color=f?.phase==="success"?"#15803d":f?.phase==="saving"?"#3155a4":"#b45309";
    return `<div id="trainingSaveFeedback" class="notice" role="status" aria-live="polite" style="margin-top:10px;border-left:4px solid ${color};font-weight:700">${esc(message)}</div>`;
  }
  function markDirty(){
    if(state.trainingSaveFeedback?.phase==="saving")return;
    state.trainingSaveFeedback={eventId:state.trainingAttendanceData?.event?.eventId,phase:"dirty",message:"⚠️ 點名狀態已修改，尚未儲存。完成全員標記後，請按「儲存並完成點名」。"};
    const box=document.getElementById("trainingSaveFeedback");if(box){box.textContent=state.trainingSaveFeedback.message;box.style.borderLeftColor="#b45309"}
    const top=document.getElementById("trainingDraftSummary");if(top){top.textContent="⚠️ 本頁有未儲存的修改，請完成全員標記並儲存。";top.style.display=""}
    updateProgress();
  }

  window.openTrainingAttendance=async function(eventId=""){
    if(state.page!=="trainingAttendance")state.trainingAttendanceReturn=state.page==="specialCalendar"?"specialCalendar":state.me?.role==="admin"?"adminAttendanceWorkspace":"teacherHome";
    state.page="trainingAttendance";state.trainingAttendanceData=null;state.trainingSaveFeedback=null;render();
    try{if(eventId)await loadEvent(eventId);else await loadList();render()}catch(e){toast("❌ "+e.message);if(state.trainingAttendanceReturn==="adminAttendanceWorkspace"){state.page="admin";state.adminWorkspaceSection="attendance"}else state.page=state.trainingAttendanceReturn;render()}
  };
  window.trainingAttendanceBack=function(){
    if(state.trainingAttendanceData){state.trainingAttendanceData=null;loadList().then(render).catch(e=>toast("❌ "+e.message));render();return}
    if(state.trainingAttendanceReturn==="adminAttendanceWorkspace"){
      state.page="admin";state.adminWorkspaceSection="attendance";render();requestAnimationFrame(()=>window.scrollTo(0,0));return;
    }
    state.page=state.trainingAttendanceReturn;
    if(state.page==="teacherHome")state.teacherTodayStatusDate="";
    render();
  };
  window.setTrainingStatus=function(id,status){state.trainingAttendanceStatuses[String(id)]=String(status||"");markDirty()};
  window.markTrainingPresent=function(){for(const s of state.trainingAttendanceData?.items||[])state.trainingAttendanceStatuses[String(s.studentId)]="present";markDirty();render()};
  window.saveTrainingAttendance=async function(){
    if(state.trainingSaveFeedback?.phase==="saving")return;
    const d=state.trainingAttendanceData;if(!d)return;
    const items=(d.items||[]).map(x=>({studentId:x.studentId,status:state.trainingAttendanceStatuses[String(x.studentId)]||""}));
    if(items.some(x=>!labels[x.status])){toast("請完成每位學生的出勤狀態");return}
    if(!items.length){toast("目前沒有可儲存的學生");return}
    const eventId=d.event.eventId;
    state.trainingSaveFeedback={eventId,phase:"saving",message:"⏳ 正在儲存並向伺服器核對，請勿離開。"};render();
    try{
      const posted=await api("/api/training-attendance",{method:"POST",body:JSON.stringify({eventId,items})});
      if(posted?.ok!==true)throw new Error("伺服器未確認點名");
      const fresh=await api("/api/training-attendance?eventId="+encodeURIComponent(eventId)+"&_="+Date.now());
      const actual=new Map((fresh.items||[]).map(x=>[String(x.studentId),String(x.status)]));
      if(!Array.isArray(fresh.items)||fresh.items.length!==items.length||actual.size!==items.length||Number(fresh.recorded)!==items.length||Number(fresh.expected)!==items.length||items.some(x=>actual.get(String(x.studentId))!==x.status))throw new Error("回讀的學生紀錄與送出內容不一致");
      if(state.trainingAttendanceData?.event?.eventId===eventId){state.trainingAttendanceData=fresh;state.trainingAttendanceStatuses=Object.fromEntries(items.map(x=>[String(x.studentId),x.status]))}
      const time=fresh.lastSavedAt?new Date(fresh.lastSavedAt).toLocaleTimeString("zh-TW",{timeZone:"Asia/Taipei",hour:"2-digit",minute:"2-digit",hour12:false}):"";
      state.trainingSaveFeedback={eventId,phase:"success",message:`✅ 伺服器已確認儲存｜${fresh.event.eventDate} ${fresh.event.title}｜${items.length}/${fresh.expected} 人${time?`｜${time}`:""}。可安心離開本頁。`};state.teacherTodayStatusDate="";toast("✅ 點名已確認儲存");
    }catch(e){state.trainingSaveFeedback={eventId,phase:"warning",message:`⚠️ 尚未確認全部點名已儲存（${e.message}）。請重新按「確認儲存」或請管理員協助核對，勿視為完成。`};toast("⚠️ 點名尚未確認完成")}
    render();
  };
  function listStatus(x,day){
    if(Number(x.expected)>0&&Number(x.recorded)>=Number(x.expected))return {label:"已完成",tone:"ok",action:"查看／修正"};
    if(String(x.eventDate)>day)return {label:"尚未開放",tone:"warn",action:"查看名單"};
    return {label:"待點名",tone:"bad",action:"開始點名"};
  }
  function orderedRows(rows){
    const day=today(),rank=x=>String(x.eventDate)===day?0:String(x.eventDate)<day&&Number(x.recorded)<Number(x.expected)?1:String(x.eventDate)>day?2:3;
    return rows.slice().sort((a,b)=>rank(a)-rank(b)||(rank(a)===1||rank(a)===3?String(b.eventDate).localeCompare(String(a.eventDate)):String(a.eventDate).localeCompare(String(b.eventDate)))||String(a.startTime).localeCompare(String(b.startTime)));
  }
  function page(){
    const d=state.trainingAttendanceData;
    if(!d){
      const day=today(),rows=orderedRows(state.trainingAttendanceList||[]),admin=state.me?.role==="admin";
      return `<div class="card hero training-attendance-hero"><button class="secondary training-back" onclick="trainingAttendanceBack()">${admin?"← 返回出勤與請假":"← 返回今日教學"}</button><div class="training-title-row"><div><div class="training-admin-kicker">${admin?"幹部代點名":"授課老師點名"}</div><h2>🏆 訓練點名</h2></div></div><div class="training-howto" aria-label="訓練點名三步驟"><div><span>1</span><b>選擇訓練</b></div><div><span>2</span><b>標記學生</b></div><div><span>3</span><b>儲存完成</b></div></div><p class="training-help">需點名的比賽加練、寒訓與暑訓會列在這裡；免點名場次不顯示。學生出缺席與老師月底工時分開，不會混在一起。</p></div><div class="card training-event-list"><h2>${admin?"選擇訓練場次":"我的訓練場次"}</h2><p class="muted">待點名與最近場次會排在前面。</p>${rows.length?rows.map(x=>{const status=listStatus(x,day);return `<button class="training-event-choice" onclick="openTrainingAttendance('${esc(x.eventId)}')"><span class="training-event-date">${esc(x.eventDate.slice(5).replace("-","/"))}</span><span class="training-event-main"><b>${esc(x.title)}</b><small>${esc(x.startTime)}–${esc(x.endTime)}｜${esc(x.targetGroups)} 團｜已標記 ${Number(x.recorded)}/${Number(x.expected)} 人</small></span><span class="training-event-side"><span class="badge ${status.tone}">${status.label}</span><small>${status.action} ›</small></span></button>`}).join(""):`<div class="notice">目前沒有需點名的訓練課程。${admin?"若要新增場次，請到「課表與行事曆 → 新增訓練課程」。":"若應有場次，請管理員確認是否已指定授課老師。"}</div>`}</div>`;
    }
    const x=d.event,canSave=x.status==="active"&&x.eventDate<=today(),saving=state.trainingSaveFeedback?.eventId===x.eventId&&state.trainingSaveFeedback.phase==="saving";
    const options=v=>`<option value="" ${!v?"selected":""}>尚未點名</option>`+Object.entries(labels).map(([key,label])=>`<option value="${key}" ${v===key?"selected":""}>${label}</option>`).join("");
    const total=d.items?.length||0,count=markedCount(),draftComplete=total>0&&count===total,savedComplete=Number(d.recorded)>0&&Number(d.recorded)>=Number(d.expected);
    return `<div class="card hero training-attendance-hero"><button class="secondary training-back" onclick="trainingAttendanceBack()" ${saving?"disabled":""}>← 返回場次列表</button><div class="training-title-row"><div><div class="training-admin-kicker">步驟 1｜已選擇場次</div><h2>🏆 ${esc(x.title)}</h2></div><span class="badge ${savedComplete?"ok":"warn"}">${savedComplete?"已完成點名":"尚未完成"}</span></div><div class="training-event-summary"><b>${esc(x.eventDate)}｜${esc(x.startTime)}–${esc(x.endTime)}</b><span>${esc(x.targetGroups)} 團${x.teacherName?"｜"+esc(x.teacherName):""}${x.location?"｜📍 "+esc(x.location):""}</span>${d.lastSavedAt?`<small>最近儲存：${esc(new Date(d.lastSavedAt).toLocaleString("zh-TW",{timeZone:"Asia/Taipei",hour12:false}))}｜${esc(d.lastSavedBy)}</small>`:""}</div><div class="training-howto training-howto-active" aria-label="目前點名進度"><div class="is-done"><span>1</span><b>場次已選</b></div><div class="${count?"is-done":""}"><span>2</span><b>標記學生</b></div><div id="trainingStepThree" class="${draftComplete?"is-ready":""}"><span>3</span><b>儲存完成</b></div></div><details class="training-rule"><summary>查看出席／遲到判定</summary><p>上課開始後 10 分鐘內到課記「出席」；超過 10 分鐘記「遲到」。</p></details><div id="trainingDraftSummary" class="notice" style="margin-top:10px;${state.trainingSaveFeedback?.phase==="dirty"?"":"display:none"}">${state.trainingSaveFeedback?.phase==="dirty"?"⚠️ 本頁有未儲存的修改，請完成全員標記並儲存。":""}</div></div><div class="card training-roster-card"><div class="training-roster-toolbar"><div><div class="training-admin-kicker">步驟 2｜標記學生</div><h2>學生名單</h2><b id="trainingMarkedCount">已標記 ${count}/${total} 人${draftComplete?"，可以儲存":""}</b></div>${canSave&&total?`<button class="secondary" onclick="markTrainingPresent()" ${saving?"disabled":""}>先將全員設為出席</button>`:""}</div>${total?d.items.map(s=>`<div class="item training-student-row"><div><b>${esc(s.name)}</b><small>${esc(s.groupName)} 團｜${esc(s.section||"待確認")}｜${esc(s.grade||"")}</small></div><select class="status-select" aria-label="${esc(s.name)}出勤狀態" data-id="${esc(s.studentId)}" onchange="setTrainingStatus(this.dataset.id,this.value)" ${canSave&&!saving?"":"disabled"}>${options(state.trainingAttendanceStatuses[String(s.studentId)]||"")}</select></div>`).join(""):'<div class="notice">目前此場沒有符合團別的在籍學生。</div>'}${!canSave?'<div class="notice training-unavailable">活動日期未到或已取消，目前只能查看名單，尚不可儲存點名。</div>':total?`<div class="training-save-bar"><div><b>步驟 3｜儲存完成</b><small>只有出現伺服器確認訊息，才算點名完成。</small></div><button id="trainingSaveButton" class="primary" data-saving="${saving?"true":"false"}" onclick="saveTrainingAttendance()" ${saving||!draftComplete?"disabled":""}>${saving?"⏳ 正在儲存並確認…":savedComplete?"儲存點名修改":"儲存並完成點名"}</button></div>${feedback(x.eventId)}`:""}</div>`;
  }
  const baseRender=render;
  render=function(){
    if(state.page==="trainingAttendance"&&(state.me?.role==="admin"||state.me?.capabilities?.teacherSettings)){
      document.getElementById("app").innerHTML=shell(page());return;
    }
    return baseRender();
  };
})();
