(()=>{
  const localDate=()=>{const d=new Date(),x=new Date(d.getTime()-d.getTimezoneOffset()*60000);return x.toISOString().slice(0,10)};
  const statusText={leave:"請假",absent:"缺席"};
  const classText={section:"分部課",ensemble:"合奏課",comprehensive:"綜合課"};
  const SETTINGS_URL="/api/daily-followup?mode=settings";
  state.adminOps=state.adminOps||{
    date:localDate(),settings:null,followup:null,
    loadingSettings:false,loadingFollowup:false,
    settingsError:"",followupError:""
  };

  function csvCell(v){const s=String(v??"");return /[",\r\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s}
  function downloadCsv(filename,rows){
    const content="\uFEFF"+rows.map(r=>r.map(csvCell).join(",")).join("\r\n");
    const blob=new Blob([content],{type:"text/csv;charset=utf-8"});
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }
  function shiftDate(date,days){
    const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date||""));
    if(!m)return localDate();
    const d=new Date(Number(m[1]),Number(m[2])-1,Number(m[3]),12,0,0);
    d.setDate(d.getDate()+Number(days||0));
    const x=new Date(d.getTime()-d.getTimezoneOffset()*60000);
    return x.toISOString().slice(0,10);
  }

  async function loadSettings(){
    if(state.me?.role!=="admin"||state.adminOps.loadingSettings)return;
    state.adminOps.loadingSettings=true;state.adminOps.settingsError="";mountAdminOps();
    try{state.adminOps.settings=await api(SETTINGS_URL)}
    catch(e){state.adminOps.settingsError=e.message||String(e)}
    state.adminOps.loadingSettings=false;mountAdminOps();
  }

  async function loadDaily(){
    if(state.me?.role!=="admin"||state.adminOps.loadingFollowup)return;
    state.adminOps.loadingFollowup=true;state.adminOps.followupError="";mountAdminOps();
    try{
      state.adminOps.followup=await api(`/api/daily-followup?date=${encodeURIComponent(state.adminOps.date)}`);
      state.adminOps.followupError="";
    }catch(e){state.adminOps.followupError=e.message||String(e);state.adminOps.followup=null}
    state.adminOps.loadingFollowup=false;mountAdminOps();
  }

  function ensureLoads(){
    if(state.me?.role!=="admin")return;
    if(!state.adminOps.settings&&!state.adminOps.loadingSettings&&!state.adminOps.settingsError)loadSettings();
    if(!state.adminOps.followup&&!state.adminOps.loadingFollowup&&!state.adminOps.followupError)loadDaily();
  }

  window.toggleAdminEmail=async function(checked){
    try{
      const d=await api(SETTINGS_URL,{method:"PATCH",body:JSON.stringify({emailNotificationsEnabled:!!checked})});
      state.adminOps.settings=d;state.adminOps.settingsError="";mountAdminOps();
      if(d.emailNotificationsEnabled&&!d.emailServiceConfigured)toast("⚠️ 已開啟寄信，但 Azure Email 服務尚未完成設定");
      else toast(d.emailNotificationsEnabled?"✅ 個別課 Email 通知已開啟":"✅ 個別課 Email 通知已關閉");
    }catch(e){toast("❌ "+e.message);mountAdminOps()}
  };
  window.changeAdminFollowupDate=async function(v){
    const next=String(v||"");if(!/^\d{4}-\d{2}-\d{2}$/.test(next))return;
    state.adminOps.date=next;state.adminOps.followup=null;state.adminOps.followupError="";mountAdminOps();await loadDaily();
  };
  window.shiftAdminFollowupDate=async function(days){
    state.adminOps.date=shiftDate(state.adminOps.date,days);state.adminOps.followup=null;state.adminOps.followupError="";mountAdminOps();await loadDaily();
  };
  window.todayAdminFollowup=async function(){
    state.adminOps.date=localDate();state.adminOps.followup=null;state.adminOps.followupError="";mountAdminOps();await loadDaily();
  };
  window.refreshAdminFollowup=async function(){state.adminOps.followup=null;state.adminOps.followupError="";mountAdminOps();await loadDaily();if(!state.adminOps.followupError)toast("✅ 已重新整理整日未到名單")};
  window.resendAdminPrivateLessonEmail=async function(studentId,lessonId,studentName){
    if(!studentId||!lessonId)return;
    if(!confirm(`確定重寄「${studentName||studentId}」這筆個別課確認 Email？\n\n系統會寄給目前已綁定此學生的所有家長 Gmail。`))return;
    try{
      const r=await api("/api/private-lesson",{method:"PATCH",body:JSON.stringify({studentId,lessonId,action:"resend_email"})});
      const m=r.emailNotification||{};
      if(m.status==="sent")toast(`✅ 已重寄確認 Email 給 ${m.sentCount||m.recipientCount||1} 位家長`);
      else if(m.status==="partial")toast("⚠️ 已重寄，但部分家長 Email 寄送失敗");
      else if(m.status==="no_recipients")toast("⚠️ 此學生目前沒有已綁定的家長 Gmail");
      else if(m.status==="not_configured")toast("⚠️ Azure Email 尚未完成設定");
      else if(m.status==="disabled")toast("⏸️ 後台目前已關閉個別課 Email 通知");
      else toast("❌ Email 重寄失敗");
      state.adminOps.followup=null;state.adminOps.followupError="";mountAdminOps();await loadDaily();
    }catch(e){toast("❌ "+e.message)}
  };
  window.cancelAdminPrivateLesson=async function(studentId,lessonId,studentName,startTime,endTime){
    if(!studentId||!lessonId)return;
    const time=[startTime,endTime].filter(Boolean).join("～");
    if(!confirm(`確定將「${studentName||studentId}」這筆個別課標記為誤登記並取消？\n\n${time?("時間："+time+"\n"):""}取消後不計入當日堂數／出席統計，也不再要求家長確認；紀錄仍保留供稽核。`))return;
    try{
      await api("/api/private-lesson",{method:"PATCH",body:JSON.stringify({studentId,lessonId,action:"cancel_lesson",reason:"管理員確認為誤登記"})});
      toast("✅ 已取消誤登記個別課");
      state.adminOps.followup=null;state.adminOps.followupError="";mountAdminOps();await loadDaily();
    }catch(e){toast("❌ "+e.message)}
  };
  window.retryAdminSettings=async function(){state.adminOps.settingsError="";state.adminOps.settings=null;mountAdminOps();await loadSettings()};
  window.exportAdminDailyFollowup=function(){
    if(state.adminOps.loadingFollowup){toast("正在彙整整日點名，請稍候");return}
    if(state.adminOps.followupError){toast("請先重新整理當日資料");return}
    const d=state.adminOps.followup,items=d?.items||[];
    if(!d){toast("尚未載入當日資料");return}
    if(!items.length){toast("✅ 這一天沒有請假／缺席學生");return}
    const rows=[["日期","課程類型","團別","分部","學生姓名","年級","樂器","出勤狀態","點名老師"]];
    for(const x of items)rows.push([x.date,classText[x.classType]||x.classType,x.groupName,x.section,x.name,x.grade,x.instrument,statusText[x.status]||x.status,x.teacherName]);
    downloadCsv(`${d.date}_弦樂團_整日未到請假追蹤.csv`,rows);toast(`📥 已匯出 ${items.length} 筆整日行政追蹤資料`);
  };

  function settingsHtml(){
    if(state.adminOps.settingsError)return `<div class="card"><h2>⚙️ 系統通知設定</h2><div class="error">讀取失敗：${esc(state.adminOps.settingsError)}</div><button class="secondary" style="width:100%;margin-top:10px" onclick="retryAdminSettings()">🔄 重新讀取設定</button></div>`;
    const s=state.adminOps.settings;
    if(!s)return `<div class="card"><h2>⚙️ 系統通知設定</h2><div class="notice">${state.adminOps.loadingSettings?"正在讀取通知設定…":"準備讀取通知設定…"}</div></div>`;
    const enabled=!!s.emailNotificationsEnabled,configured=!!s.emailServiceConfigured;
    const effective=enabled&&configured;
    return `<div class="card"><h2>⚙️ 系統通知設定</h2><div class="item"><div><b>個別課完成 Email 通知</b><small>老師登記「出席／遲到」個別課後，寄信給該學生所有已綁定的家長 Gmail；網站內待確認通知不受此開關影響。</small></div><label style="display:flex;align-items:center;gap:8px;margin:0;white-space:nowrap"><input type="checkbox" style="width:22px;height:22px" ${enabled?"checked":""} onchange="toggleAdminEmail(this.checked)"><b>${enabled?"開啟":"關閉"}</b></label></div><div class="notice" style="margin-top:10px">Azure Email 服務：<b>${configured?"✅ 已設定":"⚠️ 尚未設定"}</b><br>目前實際寄信：<b>${effective?"✅ 啟用":"⏸️ 停用"}</b><br><small>連線字串與寄件地址仍保存在 Azure 環境變數，不會顯示在後台。</small></div></div>`;
  }

  function dateControls(){
    return `<label>查詢日期（整日）</label><div style="display:grid;grid-template-columns:48px 1fr 48px;gap:8px;align-items:center"><button class="secondary" style="margin:0;padding:12px 6px" onclick="shiftAdminFollowupDate(-1)" title="前一天">←</button><input id="adminFollowupDate" type="date" value="${esc(state.adminOps.date)}" onchange="changeAdminFollowupDate(this.value)"><button class="secondary" style="margin:0;padding:12px 6px" onclick="shiftAdminFollowupDate(1)" title="後一天">→</button></div><div class="row2" style="margin-top:8px"><button class="secondary" style="margin:0" onclick="todayAdminFollowup()">今天</button><button class="secondary" style="margin:0" onclick="refreshAdminFollowup()">🔄 重新整理</button></div>`;
  }

  function followupHtml(){
    const d=state.adminOps.followup;
    const loading=state.adminOps.loadingFollowup;
    const error=state.adminOps.followupError;
    const items=d?.items||[],c=d?.counts||{},a=d?.attendanceCounts||{};
    let body="";
    if(error)body=`<div class="error" style="margin-top:10px">讀取 ${esc(state.adminOps.date)} 整日點名失敗：${esc(error)}</div>`;
    else if(loading&&!d)body=`<div class="notice" style="margin-top:10px">正在彙整 ${esc(state.adminOps.date)} 所有老師的分部課、合奏課與綜合課點名…</div>`;
    else if(d){
      const courses=d.courseSummary||[];
      const scheduledExpected=courses.reduce((n,x)=>n+Number(x.expected||0),0);
      const scheduledAttended=courses.reduce((n,x)=>n+Number(x.attended||0),0);
      const scheduledRate=scheduledExpected?Math.round(scheduledAttended/scheduledExpected*1000)/10:null;
      const privateDetails=d.privateLessonDetails||[];
      const privateStatusText={present:"出席",late:"遲到",leave:"請假",absent:"缺席",cancelled:"停課"};
      const confirmText={pending:"待家長確認",confirmed:"家長已確認",issue:"家長回報異常",not_required:"免確認"};
      const privateEmailText={sent:"✅ 已寄送",partial:"⚠️ 部分寄送",failed:"❌ 寄送失敗",not_configured:"⚠️ Email 尚未設定",no_recipients:"⚠️ 當時無可寄送家長 Gmail",disabled:"⏸️ 後台已關閉",pending:"準備寄送",not_required:"—"};
      const emailAt=v=>{if(!v)return "";try{return new Intl.DateTimeFormat("zh-TW",{timeZone:"Asia/Taipei",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(v))}catch{return ""}};
      const courseHtml=courses.length?courses.map(x=>{const expected=Number(x.expected||0),recorded=Number(x.recorded||0),done=expected>0&&recorded>=expected,started=recorded>0;const status=done?`<span class="badge good">✅ 已完成</span>`:started?`<span class="badge warn">⚠️ 點名未完成 ${recorded}/${expected}</span>`:`<span class="badge bad">🔴 尚未點名</span>`;const detail=x.key==="private"&&privateDetails.length?`<div style="margin-top:8px">${privateDetails.map(p=>`<div class="notice" style="margin-top:6px"><b>👤 ${esc(p.name||"未命名學生")}</b>｜${esc(p.groupName||"—")}團｜${esc(p.instrument||"—")}<br>老師：${esc(p.teacherName||p.teacherEmail||"—")}｜時間：${esc(p.startTime||"—")}${p.endTime?"～"+esc(p.endTime):""}${p.minutes?`｜${Number(p.minutes)} 分鐘`:""}<br>狀態：${esc(privateStatusText[p.status]||p.status||"—")}｜家長確認：${esc(confirmText[p.parentConfirmation]||p.parentConfirmation||"—")}${Number(p.teacherRating||0)?`<br>師資評價：<span style="color:#d5a100;font-weight:900">${"★".repeat(Number(p.teacherRating||0))}${"☆".repeat(Math.max(0,5-Number(p.teacherRating||0)))}</span> ${Number(p.teacherRating||0)}/5`:""}${p.teacherReview?`<br>家長評論：${esc(p.teacherReview)}`:""}${Array.isArray(p.currentParentBindings)&&p.currentParentBindings.length?`<br><b>👪 目前家長綁定（${p.currentParentBindings.length}）</b>：${p.currentParentBindings.map(x=>`${esc(x.relationship||"家長")}${x.parentName?" "+esc(x.parentName):""}｜${esc(x.parentEmail||"")}`).join("；")}`:`<br><b>👪 目前家長綁定：</b>尚未綁定`}<br>上次 Email 通知：${esc(privateEmailText[p.emailNotificationStatus]||p.emailNotificationStatus||"—")}${Number(p.emailNotificationRecipients||0)?`｜家長 ${(p.emailNotificationStatus==="sent"&&!Number(p.emailNotificationSentCount||0))?Number(p.emailNotificationRecipients||0):Number(p.emailNotificationSentCount||0)}/${Number(p.emailNotificationRecipients||0)} 位`:""}${emailAt(p.emailNotificationAt)?`｜${esc(emailAt(p.emailNotificationAt))}`:""}${Number(p.emailNotificationResendCount||0)?`｜已重寄 ${Number(p.emailNotificationResendCount||0)} 次`:""}${p.lessonContent?`<br>課程內容：${esc(p.lessonContent)}`:""}${p.duplicateSameDay?`<br><span class="badge bad" style="margin-top:6px">⚠️ 同一學生／老師當日有 ${Number(p.duplicateCount||2)} 筆個課，請確認誤登記</span>`:""}${p.parentConfirmation==="pending"&&p.lessonId?`<button class="secondary" style="width:100%;margin-top:8px" onclick="resendAdminPrivateLessonEmail('${esc(p.studentId)}','${esc(p.lessonId)}','${esc(p.name||"學生")}')">📨 重寄確認 Email</button>`:""}${p.lessonId?`<button class="secondary" style="width:100%;margin-top:8px;border-color:#c94b4b;color:#a52a2a" onclick="cancelAdminPrivateLesson('${esc(p.studentId)}','${esc(p.lessonId)}','${esc(p.name||"學生")}','${esc(p.startTime||"")}','${esc(p.endTime||"")}')">🗑️ 誤登記／取消此筆</button>`:""}</div>`).join("")}</div>`:"";return `<div class="item" style="align-items:flex-start"><div style="width:100%"><div style="display:flex;justify-content:space-between;gap:12px"><div><b>${esc(x.label)}</b><small>${x.groups?.length?"團別："+esc(x.groups.join("、"))+"｜":""}${esc(x.time||"")}<br>${status}<br>已點名 ${recorded}/${expected}｜請假 ${x.leave||0}｜缺席 ${x.absent||0}｜遲到 ${x.late||0}</small></div><div style="text-align:right;white-space:nowrap"><b style="font-size:18px">${x.expected||0} / ${x.attended||0}</b><small>應到 / 實到<br>${x.attendanceRate==null?"—":x.attendanceRate+"%"}</small></div></div>${detail}</div></div>`}).join(""):`<div class="notice" style="margin-top:10px">此日期沒有依固定課表排定的團體課；若有補課或個別課，仍會依實際點名紀錄顯示。</div>`;
      body=`<div class="grid" style="margin-top:12px"><div class="kpi"><b>${scheduledExpected}</b><span>今日應到人次</span></div><div class="kpi"><b>${scheduledAttended}</b><span>今日實到人次</span></div><div class="kpi"><b>${scheduledRate==null?"—":scheduledRate+"%"}</b><span>今日出席率</span></div><div class="kpi"><b>${c.total||0}</b><span>需追蹤筆數</span></div></div><div style="margin-top:12px"><b>今日課程／團別出席</b>${courseHtml}</div><div class="notice" style="margin-top:10px">應到依當日課表與目前在團學生名單計算；實到＝出席＋遲到。系統會以「已點名筆數／應到人次」判斷老師是否完成點名；0 筆顯示尚未點名，未達應到人次顯示點名未完成。</div>`;
    }
    return `<div class="card"><h2>📣 當日未到／請假追蹤</h2><div class="notice">選擇任一天，管理員會跨所有老師彙整該日 00:00～23:59 的「分部課＋合奏課＋綜合課」請假與缺席學生，供學校行政老師聯絡追蹤。</div>${dateControls()}${body}<button class="primary" style="margin-top:12px" onclick="exportAdminDailyFollowup()" ${loading?"disabled":""}>📥 匯出 ${esc(state.adminOps.date)} 整日未到／請假名單</button></div><div class="card"><h2>${esc(state.adminOps.date)} 行政追蹤名單</h2>${loading?`<div class="notice">正在整理整日點名資料…</div>`:error?`<div class="notice">請修正讀取問題後重新整理。</div>`:items.length?items.map(x=>`<div class="item"><div><b>${esc(x.name)}｜${esc(classText[x.classType]||x.classType)}</b><small>${esc(x.groupName)}團｜${esc(x.section)}｜${esc(x.grade)}｜${esc(x.instrument)}<br>點名老師：${esc(x.teacherName||"—")}</small></div><span class="badge ${x.status==="leave"?"warn":"bad"}">${esc(statusText[x.status]||x.status)}</span></div>`).join(""):`<div class="notice">✅ 這一天目前沒有分部課／合奏課／綜合課的請假或缺席紀錄。</div>`}</div>`;
  }

  function mountAdminOps(){
    if(state.me?.role!=="admin"||state.page!=="admin")return;
    const main=document.querySelector(".main");if(!main)return;
    let root=document.getElementById("adminOperations");
    if(!root){root=document.createElement("div");root.id="adminOperations";main.prepend(root)}
    root.innerHTML=settingsHtml()+followupHtml();
    setTimeout(ensureLoads,0);
  }

  const baseRender=render;
  render=function(){const r=baseRender();if(state.me?.role==="admin"&&state.page==="admin")setTimeout(mountAdminOps,0);return r};
  if(state.me?.role==="admin"&&state.page==="admin")setTimeout(mountAdminOps,0);
})();
