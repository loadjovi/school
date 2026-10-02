(()=>{
  state.trainingAttendanceData=null;
  state.trainingAttendanceStatuses={};
  state.trainingAttendanceList=[];
  state.trainingAttendanceReturn="teacherHome";
  state.trainingSaveFeedback=null;
  const labels={present:"出席",late:"遲到",leave:"請假",absent:"缺席"};
  const today=()=>new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Taipei"});
  function range(){const d=new Date(),from=new Date(d),to=new Date(d);from.setMonth(from.getMonth()-5);to.setMonth(to.getMonth()+5);const fmt=x=>x.toLocaleDateString("sv-SE",{timeZone:"Asia/Taipei"});return `from=${encodeURIComponent(fmt(from))}&to=${encodeURIComponent(fmt(to))}`}
  async function loadList(){const d=await api("/api/training-attendance?"+range());state.trainingAttendanceList=Array.isArray(d.items)?d.items:[]}
  async function loadEvent(eventId){const d=await api("/api/training-attendance?eventId="+encodeURIComponent(eventId));state.trainingAttendanceData=d;state.trainingAttendanceStatuses=Object.fromEntries((d.items||[]).map(x=>[String(x.studentId),String(x.status||"")]))}
  function feedback(eventId){
    const f=state.trainingSaveFeedback?.eventId===eventId?state.trainingSaveFeedback:null;
    const message=f?.message||"目前選取的狀態尚未儲存；請按「確認儲存」，並等待伺服器確認。";
    const color=f?.phase==="success"?"#15803d":f?.phase==="saving"?"#3155a4":"#b45309";
    return `<div id="trainingSaveFeedback" class="notice" role="status" aria-live="polite" style="margin-top:10px;border-left:4px solid ${color};font-weight:700">${esc(message)}</div>`;
  }
  function markDirty(){
    if(state.trainingSaveFeedback?.phase==="saving")return;
    state.trainingSaveFeedback={eventId:state.trainingAttendanceData?.event?.eventId,phase:"dirty",message:"⚠️ 點名狀態已修改，尚未儲存。請再次按「確認儲存」。"};
    const box=document.getElementById("trainingSaveFeedback");if(box){box.textContent=state.trainingSaveFeedback.message;box.style.borderLeftColor="#b45309"}
    const top=document.getElementById("trainingDraftSummary");if(top){top.textContent="⚠️ 本頁有未儲存的修改，請到頁尾重新按「確認儲存」。";top.style.display=""}
  }

  window.openTrainingAttendance=async function(eventId=""){
    if(state.page!=="trainingAttendance")state.trainingAttendanceReturn=state.page==="specialCalendar"?"specialCalendar":"teacherHome";
    state.page="trainingAttendance";state.trainingAttendanceData=null;state.trainingSaveFeedback=null;render();
    try{if(eventId)await loadEvent(eventId);else await loadList();render()}catch(e){toast("❌ "+e.message);state.page=state.trainingAttendanceReturn;render()}
  };
  window.trainingAttendanceBack=function(){
    if(state.trainingAttendanceData){state.trainingAttendanceData=null;loadList().then(render).catch(e=>toast("❌ "+e.message));render();return}
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
  function page(){
    const d=state.trainingAttendanceData;
    if(!d){
      const rows=state.trainingAttendanceList||[];
      return `<div class="card hero"><button class="secondary" style="width:auto;margin:0 0 12px;padding:8px 12px" onclick="trainingAttendanceBack()">← 返回</button><h2>🏆 加練點名</h2><div class="notice">週六加練需點名，早自習加練免點名。加練出勤獨立保存，不列入一般課程出勤 5%；授課工時仍由學校管理員於課後確認。上課開始後超過 10 分鐘才到課記為「遲到」，10 分鐘內到課記為「出席」。</div></div><div class="card"><h2>我的加練場次</h2>${rows.length?rows.map(x=>`<button class="item" style="width:100%;text-align:left;background:#fff;cursor:pointer" onclick="openTrainingAttendance('${esc(x.eventId)}')"><div><b>${esc(x.title)}</b><small>${esc(x.eventDate)}｜${esc(x.startTime)}–${esc(x.endTime)}｜${esc(x.targetGroups)} 團｜${x.recorded}/${x.expected} 已點名</small></div><span style="font-size:22px">›</span></button>`).join(""):'<div class="notice">目前沒有指派給您的需點名加練。若老師姓名無法與 Gmail 對應，請由學校管理員在行事曆指定點名老師。</div>'}</div>`;
    }
    const x=d.event,canSave=x.status==="active"&&x.eventDate<=today(),saving=state.trainingSaveFeedback?.eventId===x.eventId&&state.trainingSaveFeedback.phase==="saving";
    const options=v=>`<option value="" ${!v?"selected":""}>尚未點名</option>`+Object.entries(labels).map(([key,label])=>`<option value="${key}" ${v===key?"selected":""}>${label}</option>`).join("");
    return `<div class="card hero"><button class="secondary" style="width:auto;margin:0 0 12px;padding:8px 12px" onclick="trainingAttendanceBack()" ${saving?"disabled":""}>← 返回場次列表</button><h2>🏆 ${esc(x.title)}</h2><div class="notice">${esc(x.eventDate)}｜${esc(x.startTime)}–${esc(x.endTime)}｜${esc(x.targetGroups)} 團｜${esc(x.teacherName)}<br>${esc(x.location||"")}<br>點名標準：上課開始後超過 10 分鐘才到課記為「遲到」；10 分鐘內到課記為「出席」。<br>已點名 ${d.recorded}/${d.expected}${d.lastSavedAt?`｜最近儲存：${esc(new Date(d.lastSavedAt).toLocaleString("zh-TW",{timeZone:"Asia/Taipei",hour12:false}))}（${esc(d.lastSavedBy)}）`:""}</div><div id="trainingDraftSummary" class="notice" style="margin-top:10px;${state.trainingSaveFeedback?.phase==="dirty"?"":"display:none"}">${state.trainingSaveFeedback?.phase==="dirty"?"⚠️ 本頁有未儲存的修改，請到頁尾重新按「確認儲存」。":""}</div></div><div class="card"><h2>學生名單</h2>${d.items?.length?d.items.map(s=>`<div class="item"><div><b>${esc(s.name)}</b><small>${esc(s.groupName)} 團｜${esc(s.section||"待確認")}｜${esc(s.grade||"")}</small></div><select class="status-select" data-id="${esc(s.studentId)}" onchange="setTrainingStatus(this.dataset.id,this.value)" ${canSave&&!saving?"":"disabled"}>${options(state.trainingAttendanceStatuses[String(s.studentId)]||"")}</select></div>`).join(""):'<div class="notice">目前此場沒有符合團別的在籍學生。</div>'}${!canSave?'<div class="notice">活動日期未到或已取消，暫時不可儲存點名。</div>':d.items?.length?`<button class="secondary" style="width:100%;margin-top:10px" onclick="markTrainingPresent()" ${saving?"disabled":""}>全員標記出席</button><button class="primary" onclick="saveTrainingAttendance()" ${saving?"disabled":""}>${saving?"⏳ 正在儲存並確認…":"確認儲存加練點名"}</button>${feedback(x.eventId)}`:""}</div>`;
  }
  const baseRender=render;
  render=function(){
    if(state.page==="trainingAttendance"&&(state.me?.role==="admin"||state.me?.capabilities?.teacherSettings)){
      document.getElementById("app").innerHTML=shell(page());return;
    }
    return baseRender();
  };
})();
