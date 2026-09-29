(()=>{
  state.trainingAttendanceData=null;
  state.trainingAttendanceStatuses={};
  state.trainingAttendanceList=[];
  state.trainingAttendanceReturn="teacherHome";
  const labels={present:"出席",late:"遲到",leave:"請假",absent:"缺席"};
  const today=()=>new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Taipei"});
  function range(){const d=new Date(),from=new Date(d),to=new Date(d);from.setMonth(from.getMonth()-5);to.setMonth(to.getMonth()+5);const fmt=x=>x.toLocaleDateString("sv-SE",{timeZone:"Asia/Taipei"});return `from=${encodeURIComponent(fmt(from))}&to=${encodeURIComponent(fmt(to))}`}
  async function loadList(){const d=await api("/api/training-attendance?"+range());state.trainingAttendanceList=Array.isArray(d.items)?d.items:[]}
  async function loadEvent(eventId){const d=await api("/api/training-attendance?eventId="+encodeURIComponent(eventId));state.trainingAttendanceData=d;state.trainingAttendanceStatuses=Object.fromEntries((d.items||[]).map(x=>[String(x.studentId),String(x.status||"")]))}

  window.openTrainingAttendance=async function(eventId=""){
    if(state.page!=="trainingAttendance")state.trainingAttendanceReturn=state.page==="specialCalendar"?"specialCalendar":"teacherHome";
    state.page="trainingAttendance";state.trainingAttendanceData=null;render();
    try{if(eventId)await loadEvent(eventId);else await loadList();render()}catch(e){toast("❌ "+e.message);state.page=state.trainingAttendanceReturn;render()}
  };
  window.trainingAttendanceBack=function(){
    if(state.trainingAttendanceData){state.trainingAttendanceData=null;loadList().then(render).catch(e=>toast("❌ "+e.message));render();return}
    state.page=state.trainingAttendanceReturn;
    if(state.page==="teacherHome")state.teacherTodayStatusDate="";
    render();
  };
  window.setTrainingStatus=function(id,status){state.trainingAttendanceStatuses[String(id)]=String(status||"")};
  window.markTrainingPresent=function(){for(const s of state.trainingAttendanceData?.items||[])state.trainingAttendanceStatuses[String(s.studentId)]="present";render()};
  window.saveTrainingAttendance=async function(){
    const d=state.trainingAttendanceData;if(!d)return;
    const items=(d.items||[]).map(x=>({studentId:x.studentId,status:state.trainingAttendanceStatuses[String(x.studentId)]||""}));
    if(items.some(x=>!labels[x.status])){toast("請完成每位學生的出勤狀態");return}
    try{
      await api("/api/training-attendance",{method:"POST",body:JSON.stringify({eventId:d.event.eventId,items})});
      await loadEvent(d.event.eventId);render();toast(`✅ 已儲存 ${items.length} 位學生的加練點名`);
    }catch(e){toast("❌ "+e.message)}
  };
  function page(){
    const d=state.trainingAttendanceData;
    if(!d){
      const rows=state.trainingAttendanceList||[];
      return `<div class="card hero"><button class="secondary" style="width:auto;margin:0 0 12px;padding:8px 12px" onclick="trainingAttendanceBack()">← 返回</button><h2>🏆 加練點名</h2><div class="notice">週六加練需點名，早自習加練免點名。加練出勤獨立保存，不列入一般課程出勤 5%；授課工時仍由學校管理員於課後確認。上課開始後超過 10 分鐘才到課記為「遲到」，10 分鐘內到課記為「出席」。</div></div><div class="card"><h2>我的加練場次</h2>${rows.length?rows.map(x=>`<button class="item" style="width:100%;text-align:left;background:#fff;cursor:pointer" onclick="openTrainingAttendance('${esc(x.eventId)}')"><div><b>${esc(x.title)}</b><small>${esc(x.eventDate)}｜${esc(x.startTime)}–${esc(x.endTime)}｜${esc(x.targetGroups)} 團｜${x.recorded}/${x.expected} 已點名</small></div><span style="font-size:22px">›</span></button>`).join(""):'<div class="notice">目前沒有指派給您的需點名加練。若老師姓名無法與 Gmail 對應，請由學校管理員在行事曆指定點名老師。</div>'}</div>`;
    }
    const x=d.event,canSave=x.status==="active"&&x.eventDate<=today();
    const options=v=>`<option value="" ${!v?"selected":""}>尚未點名</option>`+Object.entries(labels).map(([key,label])=>`<option value="${key}" ${v===key?"selected":""}>${label}</option>`).join("");
    return `<div class="card hero"><button class="secondary" style="width:auto;margin:0 0 12px;padding:8px 12px" onclick="trainingAttendanceBack()">← 返回場次列表</button><h2>🏆 ${esc(x.title)}</h2><div class="notice">${esc(x.eventDate)}｜${esc(x.startTime)}–${esc(x.endTime)}｜${esc(x.targetGroups)} 團｜${esc(x.teacherName)}<br>${esc(x.location||"")}<br>點名標準：上課開始後超過 10 分鐘才到課記為「遲到」；10 分鐘內到課記為「出席」。<br>已點名 ${d.recorded}/${d.expected}${d.lastSavedAt?`｜最近儲存：${esc(d.lastSavedAt.slice(0,16).replace("T"," "))}（${esc(d.lastSavedBy)}）`:""}</div></div><div class="card"><h2>學生名單</h2>${d.items?.length?d.items.map(s=>`<div class="item"><div><b>${esc(s.name)}</b><small>${esc(s.groupName)} 團｜${esc(s.section||"待確認")}｜${esc(s.grade||"")}</small></div><select class="status-select" data-id="${esc(s.studentId)}" onchange="setTrainingStatus(this.dataset.id,this.value)" ${canSave?"":"disabled"}>${options(state.trainingAttendanceStatuses[String(s.studentId)]||"")}</select></div>`).join(""):'<div class="notice">目前此場沒有符合團別的在籍學生。</div>'}${!canSave?'<div class="notice">活動日期未到或已取消，暫時不可儲存點名。</div>':d.items?.length?'<button class="secondary" style="width:100%;margin-top:10px" onclick="markTrainingPresent()">全員標記出席</button><button class="primary" onclick="saveTrainingAttendance()">儲存／更新本次加練點名</button>':""}</div>`;
  }
  const baseRender=render;
  render=function(){
    if(state.page==="trainingAttendance"&&(state.me?.role==="admin"||state.me?.capabilities?.teacherSettings)){
      document.getElementById("app").innerHTML=shell(page());return;
    }
    return baseRender();
  };
})();
