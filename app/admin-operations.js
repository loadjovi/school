(()=>{
  const localDate=()=>{const d=new Date(),x=new Date(d.getTime()-d.getTimezoneOffset()*60000);return x.toISOString().slice(0,10)};
  const statusText={leave:"請假",absent:"缺席"};
  const classText={section:"分部課",ensemble:"團體課"};
  state.adminOps=state.adminOps||{date:localDate(),settings:null,followup:null,loading:false,error:""};

  function csvCell(v){const s=String(v??"");return /[",\r\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s}
  function downloadCsv(filename,rows){
    const content="\uFEFF"+rows.map(r=>r.map(csvCell).join(",")).join("\r\n");
    const blob=new Blob([content],{type:"text/csv;charset=utf-8"});
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }

  async function loadAdminOps(){
    if(state.me?.role!=="admin"||state.adminOps.loading)return;
    state.adminOps.loading=true;state.adminOps.error="";mountAdminOps();
    try{
      const [settings,followup]=await Promise.all([
        api("/api/admin-settings"),
        api(`/api/daily-followup?date=${encodeURIComponent(state.adminOps.date)}`)
      ]);
      state.adminOps.settings=settings;state.adminOps.followup=followup;
    }catch(e){state.adminOps.error=e.message||String(e)}
    state.adminOps.loading=false;mountAdminOps();
  }

  async function loadDaily(){
    try{
      state.adminOps.followup=await api(`/api/daily-followup?date=${encodeURIComponent(state.adminOps.date)}`);
      state.adminOps.error="";mountAdminOps();
    }catch(e){toast("❌ "+e.message)}
  }

  window.toggleAdminEmail=async function(checked){
    try{
      const d=await api("/api/admin-settings",{method:"PATCH",body:JSON.stringify({emailNotificationsEnabled:!!checked})});
      state.adminOps.settings=d;mountAdminOps();
      if(d.emailNotificationsEnabled&&!d.emailServiceConfigured)toast("⚠️ 已開啟寄信，但 Azure Email 服務尚未完成設定");
      else toast(d.emailNotificationsEnabled?"✅ 個別課 Email 通知已開啟":"✅ 個別課 Email 通知已關閉");
    }catch(e){toast("❌ "+e.message);mountAdminOps()}
  };
  window.changeAdminFollowupDate=async function(v){state.adminOps.date=String(v||localDate());await loadDaily()};
  window.refreshAdminFollowup=async function(){await loadDaily();toast("✅ 已重新整理當日未到名單")};
  window.exportAdminDailyFollowup=function(){
    const d=state.adminOps.followup,items=d?.items||[];
    if(!items.length){toast("✅ 當日沒有請假／缺席學生");return}
    const rows=[["日期","課程類型","團別","分部","學生姓名","年級","樂器","出勤狀態","點名老師"]];
    for(const x of items)rows.push([x.date,classText[x.classType]||x.classType,x.groupName,x.section,x.name,x.grade,x.instrument,statusText[x.status]||x.status,x.teacherName]);
    downloadCsv(`${d.date}_弦樂團_未到請假追蹤.csv`,rows);toast(`📥 已匯出 ${items.length} 筆行政追蹤資料`);
  };

  function settingsHtml(){
    const s=state.adminOps.settings;
    if(!s)return `<div class="card"><h2>⚙️ 系統通知設定</h2><div class="notice">正在讀取通知設定…</div></div>`;
    const enabled=!!s.emailNotificationsEnabled,configured=!!s.emailServiceConfigured;
    const effective=enabled&&configured;
    return `<div class="card"><h2>⚙️ 系統通知設定</h2><div class="item"><div><b>個別課完成 Email 通知</b><small>老師登記「出席／遲到」個別課後，寄信給該學生所有已綁定的家長 Gmail；網站內待確認通知不受此開關影響。</small></div><label style="display:flex;align-items:center;gap:8px;margin:0"><input type="checkbox" style="width:22px;height:22px" ${enabled?"checked":""} onchange="toggleAdminEmail(this.checked)"><b>${enabled?"開啟":"關閉"}</b></label></div><div class="notice" style="margin-top:10px">Azure Email 服務：<b>${configured?"✅ 已設定":"⚠️ 尚未設定"}</b><br>目前實際寄信：<b>${effective?"✅ 啟用":"⏸️ 停用"}</b><br><small>連線字串與寄件地址仍保存在 Azure 環境變數，不會顯示在後台。</small></div></div>`;
  }

  function followupHtml(){
    const d=state.adminOps.followup;
    if(!d)return `<div class="card"><h2>📣 當日未到／請假追蹤</h2><label>日期</label><input type="date" value="${esc(state.adminOps.date)}" onchange="changeAdminFollowupDate(this.value)"><div class="notice" style="margin-top:10px">正在彙整所有老師的分部課與團體課點名…</div></div>`;
    const c=d.counts||{},items=d.items||[];
    return `<div class="card"><h2>📣 當日未到／請假追蹤</h2><div class="notice">管理員可跨老師彙整當天所有「分部課＋團體課」的請假與缺席學生，交由學校行政老師聯絡追蹤。</div><div class="row2"><div><label>日期</label><input type="date" value="${esc(d.date)}" onchange="changeAdminFollowupDate(this.value)"></div><div style="display:flex;align-items:end"><button class="secondary" style="width:100%;margin:0" onclick="refreshAdminFollowup()">🔄 重新整理</button></div></div><div class="grid" style="margin-top:12px"><div class="kpi"><b>${c.total||0}</b><span>需追蹤筆數</span></div><div class="kpi"><b>${c.absent||0}</b><span>缺席</span></div><div class="kpi"><b>${c.leave||0}</b><span>請假</span></div><div class="kpi"><b>${(c.section||0)+(c.ensemble||0)}</b><span>分部＋團體</span></div></div><button class="primary" onclick="exportAdminDailyFollowup()">📥 匯出當日未到／請假名單 CSV</button></div><div class="card"><h2>${esc(d.date)} 行政追蹤名單</h2>${items.length?items.map(x=>`<div class="item"><div><b>${esc(x.name)}｜${esc(classText[x.classType]||x.classType)}</b><small>${esc(x.groupName)}團｜${esc(x.section)}｜${esc(x.grade)}｜${esc(x.instrument)}<br>點名老師：${esc(x.teacherName||"—")}</small></div><span class="badge ${x.status==="leave"?"warn":"bad"}">${esc(statusText[x.status]||x.status)}</span></div>`).join(""):`<div class="notice">✅ 這一天目前沒有分部課／團體課的請假或缺席紀錄。</div>`}</div>`;
  }

  function mountAdminOps(){
    if(state.me?.role!=="admin"||state.page!=="admin")return;
    const main=document.querySelector(".main");if(!main)return;
    let root=document.getElementById("adminOperations");
    if(!root){root=document.createElement("div");root.id="adminOperations";main.prepend(root)}
    root.innerHTML=(state.adminOps.error?`<div class="card"><div class="error">${esc(state.adminOps.error)}</div></div>`:"")+settingsHtml()+followupHtml();
    if(!state.adminOps.settings&&!state.adminOps.loading)loadAdminOps();
  }

  const baseRender=render;
  render=function(){const r=baseRender();if(state.me?.role==="admin"&&state.page==="admin")setTimeout(mountAdminOps,0);return r};
  if(state.me?.role==="admin"&&state.page==="admin")setTimeout(mountAdminOps,0);
})();
