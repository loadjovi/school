(()=>{
  state.specialEvents=state.specialEvents||[];
  state.specialCalendar=state.specialCalendar||null;
  state.specialCalendarTask=state.specialCalendarTask||"add";

  const today=()=>{const d=new Date(),y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0");return `${y}-${m}-${day}`};
  const addDays=(date,days)=>{const d=new Date(date+"T12:00:00");d.setDate(d.getDate()+days);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-")};
  const trainingTypes=new Set(["competition_training","winter_training","summer_training","intensive_training"]);
  const isTrainingEvent=x=>trainingTypes.has(String(x?.eventType||""));
  const eventTypeText=t=>({competition_training:"🏆 比賽加練",winter_training:"❄️ 寒訓",summer_training:"☀️ 暑訓",intensive_training:"🎻 密集訓練",performance:"🎵 演出／聯演",competition:"🏅 賽事",exchange:"🤝 校際交流",field_trip:"🚌 校外活動",general:"📌 活動提醒"}[t]||"📌 活動提醒");
  const eventDateText=x=>x.endDate&&x.endDate!==x.eventDate?x.eventDate+"～"+x.endDate:x.eventDate;
  const eventTime=x=>x.timeLabel||(x.endDate&&x.endDate!==x.eventDate?(x.startTime&&x.endTime?`${x.startTime} 起，${x.endDate} ${x.endTime} 結束`:"時間另行通知"):([x.startTime,x.endTime].filter(Boolean).join("–")))||"時間另行通知";
  const taipeiDate=()=>new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Taipei"});
  const scheduledMinutes=x=>{const start=String(x.startTime||"").split(":"),end=String(x.endTime||"").split(":");if(start.length!==2||end.length!==2)return 0;const n=(Number(end[0])*60+Number(end[1]))-(Number(start[0])*60+Number(start[1]));return n>0&&n<=600?n:0};
  function trainingControls(x){
    if(!isTrainingEvent(x))return "";
    if(x.teachingConfirmedAt)return `<details class="training-secondary-settings training-hours-settings"><summary>② 月底工時確認（非點名）｜✅ 已確認</summary><div class="training-secondary-body"><div class="notice"><b>已確認授課：${esc(x.teachingTeacherName||x.teachingTeacherEmail)}｜${Number(x.teachingMinutes||0)} 分鐘</b><br>確認：${esc(x.teachingConfirmedAt.slice(0,16).replace("T"," "))}｜${esc(x.teachingConfirmedBy||"")}<br><b>此紀錄只供老師工時計算，不代表學生點名完成。</b></div><button class="secondary training-inline-action" onclick="revokeTrainingHours('${esc(x.eventId)}')">撤銷工時確認</button></div></details>`;
    if(x.status!=="active")return "";
    const day=taipeiDate(),time=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Taipei",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date());
    if(x.eventDate>day||(x.eventDate===day&&(!x.endTime||x.endTime>time)))return '<details class="training-secondary-settings training-hours-settings"><summary>② 月底工時確認（非點名）</summary><div class="training-secondary-body"><div class="muted">訓練結束後才能確認實際授課工時；學生點名請使用上方「開始點名」。</div></div></details>';
    const teachers=state.specialCalendar?.teachers||[];
    if(!teachers.length)return '<details class="training-secondary-settings training-hours-settings"><summary>② 月底工時確認（非點名）</summary><div class="training-secondary-body"><div class="notice">請先在老師管理新增授課老師 Gmail，再確認訓練工時。此設定不影響學生點名。</div></div></details>';
    const planned=String(x.teacherName||"").replace(/老師$/,""),matched=teachers.find(t=>String(t.teacherName||"").replace(/老師$/ ,"")===planned);
    const options=teachers.map(t=>`<option value="${esc(t.email)}" ${t.email===(x.teachingTeacherEmail||matched?.email)?"selected":""}>${esc(t.teacherName)}｜${esc(t.email)}</option>`).join("");
    return `<details class="training-secondary-settings training-hours-settings"><summary>② 月底工時確認（非點名）</summary><div class="training-secondary-body"><div class="notice"><b>這裡只計算老師工時，不會儲存學生出缺席。</b><br>僅已實際授課的訓練課程才會計入 Global 月報。</div><label>實際授課老師</label><select id="trainingTeacher_${esc(x.eventId)}"><option value="">請選擇老師</option>${options}</select><label>實際授課分鐘</label><input id="trainingMinutes_${esc(x.eventId)}" type="number" min="1" max="600" value="${scheduledMinutes(x)||""}" placeholder="例如 45"><button class="primary" onclick="confirmTrainingHours('${esc(x.eventId)}')">確認老師授課工時</button></div></details>`;
  }
  function trainingAttendanceControls(x){
    if(!isTrainingEvent(x))return "";
    if(x.status!=="active")return '<div class="notice training-unavailable" style="margin-top:9px"><b>🚫 此場訓練已取消，不需點名。</b></div>';
    if(!x.requiresAttendance)return '<div class="muted" style="margin-top:8px">本場設定為免點名</div>';
    const teachers=state.specialCalendar?.teachers||[];
    const named=String(x.teacherName||"").replace(/老師$/ ,"");
    const matched=teachers.filter(t=>String(t.teacherName||"").replace(/老師$/ ,"")===named);
    const options=teachers.map(t=>`<option value="${esc(t.email)}" ${x.teacherEmail===t.email?"selected":""}>${esc(t.teacherName)}｜${esc(t.email)}</option>`).join("");
    return `<section class="training-admin-attendance" aria-label="訓練點名"><div class="training-admin-kicker">① 幹部點名</div><b>📋 此場訓練需要點名</b><p>管理員可直接代點名，不必先指定老師 Gmail。進入名單後，標記每位學生並儲存即可。</p><button class="primary training-attendance-start" onclick="openTrainingAttendance('${esc(x.eventId)}')">開始點名</button><details class="training-secondary-settings"><summary>指定點名老師（非必要）</summary><div class="training-secondary-body"><p>只有要讓授課老師自行登入點名時才需設定；幹部代點名可略過。</p><label>點名老師 Gmail</label><select id="trainingAttendanceTeacher_${esc(x.eventId)}"><option value="" ${!x.teacherEmail?"selected":""}>${matched.length===1?`依姓名自動對應：${esc(matched[0].teacherName)}`:"未指派（管理員可代點名）"}</option>${options}</select><button class="secondary training-inline-action" onclick="assignTrainingAttendanceTeacher('${esc(x.eventId)}')">儲存點名老師</button></div></details></section>`;
  }

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
    const now=new Date(),todayText=today(),nowHm=String(now.getHours()).padStart(2,"0")+":"+String(now.getMinutes()).padStart(2,"0");
    const rows=(state.specialEvents||[])
      .filter(x=>{
        if(x.status!=="active")return false;
        const d=String(x.eventDate||"");
        if(d>todayText)return true;
        if((x.endDate||d)<todayText)return false;
        if(d<todayText)return true;
        if(x.endDate&&x.endDate>todayText)return true;
        const end=String(x.endTime||(x.sourceModule?"":x.startTime)||"");
        return !end||end>nowHm;
      })
      .sort((a,b)=>String(a.eventDate).localeCompare(String(b.eventDate))||String(a.startTime).localeCompare(String(b.startTime)))
      .slice(0,2);
    if(!rows.length)return "";
    return `<div class="card"><h2>🗓️ 近期行事曆</h2><div class="notice" style="margin-bottom:10px">僅顯示最近 2 筆訓練課程或活動；結束後會自動移除。這些安排不列入一般分部／合奏／綜合課全勤統計。</div>${rows.map(x=>`<div class="item"><div><b>${eventTypeText(x.eventType)}｜${esc(x.title)}</b><small>${esc(eventDateText(x))}｜${esc(eventTime(x))}${x.teacherName?"｜"+esc(x.teacherName):""}${x.location?"｜"+esc(x.location):""}</small>${x.note?`<small style="display:block;margin-top:3px">${esc(x.note)}</small>`:""}</div></div>`).join("")}</div>`;
  }

  const baseHome=typeof home==="function"?home:null;
  if(baseHome)home=function(){
    const html=baseHome();
    if(state.me?.role!=="parent")return html;
    const boundary="<!-- parent-payment-notices-end -->",card=parentCalendarCard();
    return html.includes(boundary)?html.replace(boundary,boundary+card):card+html;
  };

  async function loadCalendarAdmin(){state.specialCalendar=await api("/api/calendar-events")}

  window.confirmTrainingHours=async function(eventId){
    const teacherEmail=document.getElementById("trainingTeacher_"+eventId)?.value||"",minutes=Number(document.getElementById("trainingMinutes_"+eventId)?.value);
    if(!teacherEmail||!Number.isInteger(minutes)||minutes<1||minutes>600){toast("請選擇老師並填寫實際授課分鐘（1～600）");return}
    try{await api("/api/calendar-events",{method:"PATCH",body:JSON.stringify({eventId,action:"confirmTeaching",teacherEmail,minutes})});await loadCalendarAdmin();render();toast("✅ 已計入老師月度工時")}
    catch(e){toast("❌ "+e.message)}
  };
  window.revokeTrainingHours=async function(eventId){
    try{await api("/api/calendar-events",{method:"PATCH",body:JSON.stringify({eventId,action:"revokeTeaching"})});await loadCalendarAdmin();render();toast("已撤銷訓練工時確認")}
    catch(e){toast("❌ "+e.message)}
  };
  window.assignTrainingAttendanceTeacher=async function(eventId){
    const teacherEmail=document.getElementById("trainingAttendanceTeacher_"+eventId)?.value||"";
    try{await api("/api/calendar-events",{method:"PATCH",body:JSON.stringify({eventId,teacherEmail})});await loadCalendarAdmin();render();toast("✅ 已更新點名老師")}
    catch(e){toast("❌ "+e.message)}
  };

  window.openSpecialCalendar=async function(task="add"){
    state.specialCalendarTask=["add","manage"].includes(task)?task:"add";
    state.page="specialCalendar";await loadCalendarAdmin();render();
  };
  window.closeSpecialCalendar=function(){state.page="admin";state.adminWorkspaceSection="courses";render()};
  window.openActivitySettingsFromCalendar=function(){
    state.page="admin";state.adminWorkspaceSection="uniformAdmin";render();
    requestAnimationFrame(()=>{const frame=document.getElementById("awUniformFrame");if(frame)frame.src="/uniform-event-admin.html?embedded=school&v=20261102-activity-boundary&task=activity"});
  };

  const trainingNameByType={
    competition_training:"比賽加練",
    winter_training:"寒訓",
    summer_training:"暑訓",
    intensive_training:"密集訓練"
  };
  const trainingGroupName=value=>({A:"A團",B:"B團","儲備":"儲備團","A,B":"A、B團","A,B,儲備":"全團"}[value]||"弦樂團");
  const suggestedTrainingName=(type,group)=>trainingGroupName(group)+(trainingNameByType[type]||"訓練");
  window.syncTrainingCourseDefaults=function(){
    const type=document.getElementById("calType"),group=document.getElementById("calGroup"),title=document.getElementById("calTitle"),hint=document.getElementById("calTitleHint");
    if(!type||!group||!title)return;
    const suggestion=suggestedTrainingName(type.value,group.value),mayReplace=title.dataset.autoTitle!=="false"||!title.value.trim();
    if(mayReplace){title.value=suggestion;title.dataset.autoTitle="true"}
    if(hint)hint.textContent=mayReplace?`已自動帶入「${suggestion}」，仍可自行修改。`:`已保留自訂名稱；若要重新套用建議，請先清空名稱再切換類型或團別。`;
  };
  window.syncTrainingLocationChoice=function(){
    const select=document.getElementById("calLocation"),wrap=document.getElementById("calLocationOtherWrap"),input=document.getElementById("calLocationOther");
    if(!select||!wrap||!input)return;
    wrap.hidden=select.value!=="__other__";
    if(!wrap.hidden)input.focus();
  };

  function calendarTaskHeading(task,count){
    const meta=task==="manage"
      ?{icon:"🗓️",title:"管理訓練行事曆",description:"查看比賽加練、寒訓與暑訓，處理點名及老師工時。",steps:["找到訓練","確認狀態","點名或確認工時"]}
      :{icon:"➕",title:"新增訓練課程",description:"建立比賽加練、寒訓、暑訓等可跨多天的訓練安排。",steps:["選訓練類型","輸入多個日期","建立課程"]};
    return `<section class="card course-workflow-heading"><button class="secondary" style="width:auto;margin:0 0 12px;padding:8px 12px" onclick="closeSpecialCalendar()">← 返回課表與行事曆</button><small>課表與行事曆</small><div class="student"><div><h1>${meta.icon} ${meta.title}</h1><p>${meta.description}</p></div><span class="badge ok">${count} 個顯示中</span></div><div class="course-workflow-steps" aria-label="操作步驟">${meta.steps.map((step,index)=>`<span><b>${index+1}</b>${step}</span>`).join("")}</div></section>`;
  }

  function calendarAdmin(){
    const items=(state.specialCalendar?.items||[]).slice().sort((a,b)=>String(a.eventDate).localeCompare(String(b.eventDate))||String(a.startTime).localeCompare(String(b.startTime)));
    const trainingItems=items.filter(isTrainingEvent),activityItems=items.filter(x=>!isTrainingEvent(x)&&x.sourceModule),legacyItems=items.filter(x=>!isTrainingEvent(x)&&!x.sourceModule);
    const sacred=String(state.me?.schoolName||"").includes("聖心"),task=state.specialCalendarTask==="manage"?"manage":"add",activeCount=trainingItems.filter(x=>x.status==="active").length;
    const heading=calendarTaskHeading(task,activeCount);
    const notice=`<div class="card"><div class="notice"><b>本區只管理「需要上課」的訓練課程。</b><br>比賽加練、寒訓、暑訓可一次輸入多天；學生點名與老師月底工時是兩筆不同紀錄。<br><b>演出日期、比賽當天、快閃、他校交流與多校聯演，請到「團服與活動 → 活動設定」。</b></div><button class="secondary" style="width:100%;margin-top:10px" onclick="openActivitySettingsFromCalendar()">前往演出與活動設定 →</button>${task==="add"&&sacred?`<button class="secondary" style="width:100%;margin-top:10px" onclick="createSacredHeartCompetitionPreset()">🏆 建立／更新 2026 A團比賽加練（20 場）</button>`:""}</div>`;
    const addCard=`<div class="card"><h2>訓練課程資料</h2>
      <label>訓練類型</label>
      <select id="calType" onchange="syncTrainingCourseDefaults()">
        <option value="competition_training">🏆 比賽加強訓練</option>
        <option value="winter_training">❄️ 寒訓</option>
        <option value="summer_training">☀️ 暑訓</option>
        <option value="intensive_training">🎻 其他密集訓練</option>
      </select>
      <label>訓練名稱</label>
      <input id="calTitle" value="A團比賽加練" data-auto-title="true" oninput="this.dataset.autoTitle='false'" placeholder="例：A團寒訓">
      <small id="calTitleHint" class="muted">會依訓練類型與對象自動帶入，仍可自行修改。</small>
      <label>對象</label>
      <select id="calGroup" onchange="syncTrainingCourseDefaults()">
        <option value="A">A 團</option><option value="B">B 團</option><option value="儲備">儲備團</option><option value="A,B">A、B 團</option><option value="A,B,儲備">全團</option>
      </select>
      <label>上課日期（可一次輸入多天）</label>
      <textarea id="calDates" rows="4" placeholder="每行一個日期，例如：&#10;2027-01-21&#10;2027-01-22&#10;2027-01-25"></textarea>
      <div class="row2"><div><label>開始時間</label><input id="calStart" type="time"></div><div><label>結束時間</label><input id="calEnd" type="time"></div></div>
      <label>老師（選填）</label><input id="calTeacher" placeholder="例：陳宣文老師">
      <label>點名老師 Gmail（可選）</label><select id="calTeacherEmail"><option value="">未指派，依老師姓名自動對應</option>${(state.specialCalendar?.teachers||[]).map(t=>`<option value="${esc(t.email)}">${esc(t.teacherName)}｜${esc(t.email)}</option>`).join("")}</select>
      <label style="display:flex;align-items:center;gap:8px;margin-top:12px"><input id="calRequiresAttendance" type="checkbox" style="width:auto;margin:0">這些訓練場次需要學生點名</label>
      <label>上課地點</label>
      <select id="calLocation" onchange="syncTrainingLocationChoice()">
        <option value="">地點稍後確認</option>
        <option value="聖家樓四樓團練教室" ${sacred?"selected":""}>聖家樓四樓團練教室（共用）</option>
        <option value="聖家樓四樓 A 團練教室">聖家樓四樓 A 團練教室</option>
        <option value="聖家樓四樓 B 團練教室">聖家樓四樓 B 團練教室</option>
        <option value="音樂教室 1">音樂教室 1</option>
        <option value="音樂教室 2">音樂教室 2</option>
        <option value="__other__">其他地點（自行輸入）</option>
      </select>
      <label id="calLocationOtherWrap" hidden>其他地點<input id="calLocationOther" maxlength="120" placeholder="請輸入實際上課地點"></label>
      <label>備註（選填）</label><input id="calNote" placeholder="例：比賽前加強練習">
      <button class="primary" onclick="createTrainingEvents()">建立訓練課程</button>
    </div>`;
    const trainingRow=x=>`<div class="item" style="flex-wrap:wrap"><div style="flex:1 1 240px;min-width:0"><b>${eventTypeText(x.eventType)}｜${esc(x.title)}</b><small>${esc(eventDateText(x))}｜${esc(eventTime(x))}｜${esc(x.targetGroups==="ALL"?"全團":String(x.targetGroups||"全團").replaceAll("C","儲備").split(",").map(g=>g+" 團").join("、"))}${x.teacherName?"｜"+esc(x.teacherName):""}${x.location?"｜📍 "+esc(x.location):""}</small>${x.note?`<small style="display:block;margin-top:3px">${esc(x.note)}</small>`:""}${trainingAttendanceControls(x)}${trainingControls(x)}</div><div style="display:flex;gap:6px;align-items:center"><span class="badge ${x.status==="active"?"ok":"warn"}">${x.status==="active"?"顯示中":"已取消"}</span><button class="secondary" style="width:auto;margin:0;padding:7px 9px" onclick="toggleCalendarEvent('${esc(x.eventId)}','${x.status==="active"?"cancel":"restore"}')">${x.status==="active"?"取消":"恢復"}</button><button class="secondary" style="width:auto;margin:0;padding:7px 9px" onclick="deleteCalendarEvent('${esc(x.eventId)}')">刪除</button></div></div>`;
    const manageCard=`<div class="card"><h2>訓練行事曆</h2><p>此處只顯示加練、寒訓、暑訓與密集訓練；可取消／恢復，並依需求點名或確認老師工時。</p>${trainingItems.length?trainingItems.map(trainingRow).join(""):'<div class="notice">目前尚未建立訓練課程。</div>'}</div>${activityItems.length?`<div class="card"><h2>🎪 演出與活動已分流</h2><p>${activityItems.length} 筆演出、比賽或交流活動由「團服與活動 → 活動設定」管理，不列入上方訓練數量。</p><button class="secondary" style="width:100%" onclick="openActivitySettingsFromCalendar()">前往活動設定 →</button></div>`:""}${legacyItems.length?`<details class="card"><summary><b>舊版非訓練活動（${legacyItems.length} 筆）</b></summary><div class="notice" style="margin-top:10px">這些是舊版直接建立的活動，資料仍保留。請在「活動設定」重建後，再取消或刪除此處舊資料。</div>${legacyItems.map(x=>`<div class="item"><div><b>${eventTypeText(x.eventType)}｜${esc(x.title)}</b><small>${esc(eventDateText(x))}｜${esc(eventTime(x))}</small></div><div><button class="secondary" onclick="toggleCalendarEvent('${esc(x.eventId)}','${x.status==="active"?"cancel":"restore"}')">${x.status==="active"?"取消":"恢復"}</button><button class="secondary" onclick="deleteCalendarEvent('${esc(x.eventId)}')">刪除</button></div></div>`).join("")}</details>`:""}`;
    return heading+notice+(task==="manage"?manageCard:addCard);
  }

  window.createSacredHeartCompetitionPreset=async function(){
    if(!confirm("建立／更新 2026 A團比賽加練共 20 場？\n\n早自習 16 場：陳宣文老師（免點名）\n週六 4 場：林逸旻老師（需點名）\n地點：聖家樓四樓團練教室\n\n若已建立過，會更新原 20 場，不會重複新增。\n訓練課程不列入一般課程全勤統計。"))return;
    try{const d=await api("/api/calendar-events",{method:"POST",body:JSON.stringify({action:"preset_a_competition_2026"})});toast(`✅ 已建立／更新 ${d.count} 場 A團比賽加練`);await loadCalendarAdmin();render()}catch(e){toast("❌ "+e.message)}
  };

  window.createTrainingEvents=async function(){
    const dates=String(document.getElementById("calDates")?.value||"").split(/[\s,，;；]+/).map(x=>x.trim()).filter(Boolean);
    if(!dates.length){toast("請至少輸入一個日期");return}
    const teacherEmail=document.getElementById("calTeacherEmail").value,chosen=(state.specialCalendar?.teachers||[]).find(x=>x.email===teacherEmail);
    const locationChoice=document.getElementById("calLocation").value,location=locationChoice==="__other__"?document.getElementById("calLocationOther").value.trim():locationChoice;
    if(locationChoice==="__other__"&&!location){toast("請輸入其他上課地點");return}
    const base={eventType:document.getElementById("calType").value,title:document.getElementById("calTitle").value.trim()||"訓練課程",targetGroups:document.getElementById("calGroup").value,startTime:document.getElementById("calStart").value,endTime:document.getElementById("calEnd").value,teacherName:document.getElementById("calTeacher").value.trim()||(chosen?.teacherName||""),teacherEmail,location,note:document.getElementById("calNote").value.trim(),requiresAttendance:document.getElementById("calRequiresAttendance").checked,visibleToParents:true};
    try{await api("/api/calendar-events",{method:"POST",body:JSON.stringify({items:dates.map(eventDate=>({...base,eventDate}))})});toast(`✅ 已建立 ${dates.length} 場訓練課程`);await loadCalendarAdmin();render()}catch(e){toast("❌ "+e.message)}
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
    return html.replace("</div>",'</div><div class="card"><h2>🗓️ 訓練課程行事曆</h2><div class="notice">比賽加練、寒訓、暑訓等多日訓練集中管理；演出與賽事當天請至「團服與活動」。</div><button class="primary" onclick="openSpecialCalendar()">開啟訓練課程管理</button></div>');
  };

  const baseRender=render;
  render=function(){
    if(state.me?.role==="admin"&&state.page==="specialCalendar"){document.getElementById("app").innerHTML=shell(calendarAdmin());return}
    return baseRender();
  };
  if(state.me?.role==="parent"&&state.student)loadParentEvents().then(()=>render()).catch(()=>{});
})();
