(()=>{
  state.specialEvents=state.specialEvents||[];
  state.specialCalendar=state.specialCalendar||null;

  const today=()=>{const d=new Date(),y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0");return `${y}-${m}-${day}`};
  const addDays=(date,days)=>{const d=new Date(date+"T12:00:00");d.setDate(d.getDate()+days);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-")};
  const eventTypeText=t=>({competition_training:"🏆 比賽加練",performance:"🎵 演出",competition:"🏅 比賽",general:"📌 特殊活動"}[t]||"📌 特殊活動");
  const eventTime=x=>x.timeLabel||([x.startTime,x.endTime].filter(Boolean).join("–"))||"時間另行通知";

  async function loadParentEvents(){
    if(state.me?.role!=="parent"||!state.student)return;
    const from=today(),to=addDays(from,45),group=String(state.student.groupName||"");
    try{
      const d=await api("/api/calendar-events?from="+encodeURIComponent(from)+"&to="+encodeURIComponent(to)+"&groupName="+encodeURIComponent(group));
      state.specialEvents=Array.isArray(d.items)?d.items:[];
    }catch{state.specialEvents=[]}
  }

  const baseRefresh=typeof refreshStudent==="function"?refreshStudent:null;
  if(baseRefresh)refreshStudent=async function(){await baseRefresh();await loadParentEvents()};

  function parentCalendarCard(){
    if(state.me?.role!=="parent"||!state.student)return "";
    const rows=(state.specialEvents||[]).filter(x=>x.status==="active").slice(0,8);
    if(!rows.length)return `<div class="card"><h2>🗓️ 近期行事曆</h2><div class="notice">未來 45 天目前沒有特殊活動或比賽加練。</div></div>`;
    return `<div class="card"><h2>🗓️ 近期行事曆</h2><div class="notice" style="margin-bottom:10px">特殊活動不列入一般分部／合奏／綜合課全勤統計；若需點名會另行標示。</div>${rows.map(x=>`<div class="item"><div><b>${eventTypeText(x.eventType)}｜${esc(x.title)}</b><small>${esc(x.eventDate)}｜${esc(eventTime(x))}${x.teacherName?"｜"+esc(x.teacherName):""}${x.location?"｜"+esc(x.location):""}</small>${x.note?`<small style="display:block;margin-top:3px">${esc(x.note)}</small>`:""}</div><span class="badge ok">${esc(x.targetGroups||"全團")}</span></div>`).join("")}</div>`;
  }

  const baseHome=typeof home==="function"?home:null;
  if(baseHome)home=function(){
    const html=baseHome();
    return state.me?.role==="parent"?parentCalendarCard()+html:html;
  };

  async function loadCalendarAdmin(){state.specialCalendar=await api("/api/calendar-events")}

  window.openSpecialCalendar=async function(){state.page="specialCalendar";await loadCalendarAdmin();render()};
  window.closeSpecialCalendar=function(){state.page="admin";render()};

  function calendarAdmin(){
    const items=(state.specialCalendar?.items||[]).slice().sort((a,b)=>String(a.eventDate).localeCompare(String(b.eventDate))||String(a.startTime).localeCompare(String(b.startTime)));
    const sacred=String(state.me?.schoolName||"").includes("聖心");
    return `<div class="card hero"><button class="secondary" style="width:auto;margin:0 0 12px;padding:8px 12px" onclick="closeSpecialCalendar()">← 回管理員 Dashboard</button><div class="student"><div><h2 style="margin:0">🗓️ 行事曆／特殊活動</h2><div class="muted">比賽加練、演出、比賽等非固定課程</div></div><span class="badge ok">${items.filter(x=>x.status==="active").length} 個活動</span></div><div class="notice" style="margin-top:12px"><b>特殊活動與正式課表分開管理。</b><br>預設不列入一般課程全勤統計；只有有比賽、演出或臨時活動時才需要建立。</div>${sacred?`<button class="primary" onclick="createSacredHeartCompetitionPreset()">🏆 建立／更新 2026 A團比賽加練（20 場）</button>`:""}</div>
    <div class="card"><h2>＋ 新增特殊活動</h2><label>活動類型</label><select id="calType"><option value="competition_training">🏆 比賽加練</option><option value="performance">🎵 演出</option><option value="competition">🏅 比賽</option><option value="general">📌 其他活動</option></select><label>活動名稱</label><input id="calTitle" value="A團比賽加練"><label>對象</label><select id="calGroup"><option value="A">A 團</option><option value="B">B 團</option><option value="儲備">儲備團</option><option value="A,B">A、B 團</option><option value="A,B,儲備">全團</option></select><label>日期（可一次輸入多天）</label><textarea id="calDates" rows="4" placeholder="2026-10-03&#10;2026-10-17"></textarea><div class="row2"><div><label>開始時間</label><input id="calStart" type="time"></div><div><label>結束時間</label><input id="calEnd" type="time"></div></div><label>老師（選填）</label><input id="calTeacher" placeholder="例：陳宣文老師"><label>地點（選填）</label><input id="calLocation" value="${sacred?"聖家樓四樓團練教室":""}" placeholder="例：四樓音樂教室"><label>備註（選填）</label><input id="calNote" placeholder="例：比賽前加強練習"><button class="primary" onclick="createSpecialEvents()">建立活動</button></div>
    <div class="card"><h2>目前行事曆</h2>${items.length?items.map(x=>`<div class="item"><div><b>${eventTypeText(x.eventType)}｜${esc(x.title)}</b><small>${esc(x.eventDate)}｜${esc(eventTime(x))}｜${esc(x.targetGroups||"全團")}${x.teacherName?"｜"+esc(x.teacherName):""}${x.location?"｜📍 "+esc(x.location):""}</small>${x.note?`<small style="display:block;margin-top:3px">${esc(x.note)}</small>`:""}</div><div style="display:flex;gap:6px;align-items:center"><span class="badge ${x.status==="active"?"ok":"warn"}">${x.status==="active"?"顯示中":"已取消"}</span><button class="secondary" style="width:auto;margin:0;padding:7px 9px" onclick="toggleCalendarEvent('${esc(x.eventId)}','${x.status==="active"?"cancel":"restore"}')">${x.status==="active"?"取消":"恢復"}</button><button class="secondary" style="width:auto;margin:0;padding:7px 9px" onclick="deleteCalendarEvent('${esc(x.eventId)}')">刪除</button></div></div>`).join(""):'<div class="notice">目前尚未建立特殊活動。</div>'}</div>`;
  }

  window.createSacredHeartCompetitionPreset=async function(){
    if(!confirm("建立／更新 2026 A團比賽加練共 20 場？\n\n早自習 16 場：陳宣文老師\n週六 4 場：林逸旻老師\n地點：聖家樓四樓團練教室\n\n若已建立過，會更新原 20 場，不會重複新增。\n特殊活動不列入一般課程全勤統計。"))return;
    try{const d=await api("/api/calendar-events",{method:"POST",body:JSON.stringify({action:"preset_a_competition_2026"})});toast(`✅ 已建立／更新 ${d.count} 場 A團比賽加練`);await loadCalendarAdmin();render()}catch(e){toast("❌ "+e.message)}
  };

  window.createSpecialEvents=async function(){
    const dates=String(document.getElementById("calDates")?.value||"").split(/[\s,，;；]+/).map(x=>x.trim()).filter(Boolean);
    if(!dates.length){toast("請至少輸入一個日期");return}
    const base={eventType:document.getElementById("calType").value,title:document.getElementById("calTitle").value.trim()||"特殊活動",targetGroups:document.getElementById("calGroup").value,startTime:document.getElementById("calStart").value,endTime:document.getElementById("calEnd").value,teacherName:document.getElementById("calTeacher").value.trim(),location:document.getElementById("calLocation").value.trim(),note:document.getElementById("calNote").value.trim(),requiresAttendance:false,visibleToParents:true};
    try{await api("/api/calendar-events",{method:"POST",body:JSON.stringify({items:dates.map(eventDate=>({...base,eventDate}))})});toast(`✅ 已建立 ${dates.length} 個特殊活動`);await loadCalendarAdmin();render()}catch(e){toast("❌ "+e.message)}
  };

  window.toggleCalendarEvent=async function(eventId,action){
    try{await api("/api/calendar-events",{method:"PATCH",body:JSON.stringify({eventId,action})});toast(action==="cancel"?"已取消活動":"已恢復活動");await loadCalendarAdmin();render()}catch(e){toast("❌ "+e.message)}
  };

  window.deleteCalendarEvent=async function(eventId){
    if(!confirm("確定刪除此活動？"))return;
    try{await api("/api/calendar-events",{method:"PATCH",body:JSON.stringify({eventId,action:"delete"})});toast("已刪除活動");await loadCalendarAdmin();render()}catch(e){toast("❌ "+e.message)}
  };

  const baseAdmin=typeof adminPage==="function"?adminPage:null;
  if(baseAdmin)adminPage=function(){
    const html=baseAdmin();
    return html.replace("</div>",'</div><div class="card"><h2>🗓️ 行事曆／特殊活動</h2><div class="notice">比賽加練、演出、比賽等非固定課程集中管理，預設不列入一般全勤。</div><button class="primary" onclick="openSpecialCalendar()">開啟行事曆管理</button></div>');
  };

  const baseRender=render;
  render=function(){
    if(state.me?.role==="admin"&&state.page==="specialCalendar"){document.getElementById("app").innerHTML=shell(calendarAdmin());return}
    return baseRender();
  };
  if(state.me?.role==="parent"&&state.student)loadParentEvents().then(()=>render()).catch(()=>{});
})();
