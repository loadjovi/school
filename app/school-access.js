(()=>{
  const statusText={present:"出席",late:"遲到",leave:"請假",absent:"缺席",cancelled:"停課"};
  const classText={section:"分部課",ensemble:"合奏課",comprehensive:"綜合課"};
  const localDate=()=>{const d=new Date(),x=new Date(d.getTime()-d.getTimezoneOffset()*60000);return x.toISOString().slice(0,10)};
  const shiftDate=(date,days)=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date||""));if(!m)return localDate();const d=new Date(Number(m[1]),Number(m[2])-1,Number(m[3]),12);d.setDate(d.getDate()+Number(days||0));const x=new Date(d.getTime()-d.getTimezoneOffset()*60000);return x.toISOString().slice(0,10)};
  const badgeClass=s=>s==="present"?"ok":s==="late"||s==="leave"||s==="cancelled"?"warn":"bad";

  state.schoolAccessAdmin=state.schoolAccessAdmin||{loaded:false,loading:false,emails:[],error:""};
  state.schoolViewer=state.schoolViewer||{checked:false,allowed:false,date:localDate(),data:null,loading:false,error:"",filter:"all"};

  async function loadAdminSchoolAccess(force=false){
    if(state.me?.role!=="admin"||state.schoolAccessAdmin.loading)return;
    if(state.schoolAccessAdmin.loaded&&!force)return;
    state.schoolAccessAdmin.loading=true;state.schoolAccessAdmin.error="";mountAdminSchoolAccess();
    try{const d=await api("/api/school-access");state.schoolAccessAdmin.emails=d.emails||[];state.schoolAccessAdmin.loaded=true}
    catch(e){state.schoolAccessAdmin.error=e.message||String(e)}
    state.schoolAccessAdmin.loading=false;mountAdminSchoolAccess();
  }

  window.saveSchoolAccess=async function(){
    const el=document.getElementById("schoolAccessEmails");if(!el)return;
    const emails=[...new Set(String(el.value||"").split(/[\n,;]+/).map(x=>x.trim().toLowerCase()).filter(Boolean))];
    try{
      const d=await api("/api/school-access",{method:"PATCH",body:JSON.stringify({emails})});
      state.schoolAccessAdmin.emails=d.emails||[];state.schoolAccessAdmin.loaded=true;state.schoolAccessAdmin.error="";mountAdminSchoolAccess();
      toast(`✅ 已儲存 ${state.schoolAccessAdmin.emails.length} 組校方查詢帳號`);
    }catch(e){toast("❌ "+e.message)}
  };

  function adminSchoolAccessHtml(){
    const s=state.schoolAccessAdmin;
    if(s.error)return `<div class="card"><h2>🏫 校方查詢權限</h2><div class="error">讀取失敗：${esc(s.error)}</div><button class="secondary" style="width:100%;margin-top:10px" onclick="retrySchoolAccessAdmin()">🔄 重新讀取</button></div>`;
    if(!s.loaded)return `<div class="card"><h2>🏫 校方查詢權限</h2><div class="notice">${s.loading?"正在讀取校方帳號…":"準備讀取校方帳號…"}</div></div>`;
    return `<div class="card"><h2>🏫 校方查詢權限</h2><div class="notice">提供學校行政端使用的<b>唯讀查詢權限</b>。登入後可查看學生出缺勤與需追蹤名單，但不能修改老師點名、學生主檔或系統設定。<br><br>每行輸入一組 Google Gmail，可設定一組或多組帳號。</div><label>校方 Gmail</label><textarea id="schoolAccessEmails" rows="4" placeholder="例如：school@example.com">${esc((s.emails||[]).join("\n"))}</textarea><button class="primary" onclick="saveSchoolAccess()">儲存校方查詢帳號</button></div>`;
  }

  function mountAdminSchoolAccess(){
    if(state.me?.role!=="admin"||state.page!=="admin")return;
    const main=document.querySelector(".main");if(!main)return;
    let root=document.getElementById("schoolAccessAdmin");
    if(!root){root=document.createElement("div");root.id="schoolAccessAdmin";main.prepend(root)}
    root.innerHTML=adminSchoolAccessHtml();
    if(!state.schoolAccessAdmin.loaded&&!state.schoolAccessAdmin.loading&&!state.schoolAccessAdmin.error)setTimeout(()=>loadAdminSchoolAccess(),0);
  }
  window.retrySchoolAccessAdmin=async function(){state.schoolAccessAdmin.error="";state.schoolAccessAdmin.loaded=false;mountAdminSchoolAccess();await loadAdminSchoolAccess(true)};

  async function checkSchoolAccess(){
    if(!state.me||state.me.role==="admin"||state.schoolViewer.checked)return;
    state.schoolViewer.checked=true;
    try{
      const d=await api("/api/school-access-self");
      if(!d.allowed)return;
      if(d.schoolId)sessionStorage.setItem("school_context_id",String(d.schoolId));
      state.schoolViewer.allowed=true;
      state.me.role="school";
      state.me.schoolId=d.schoolId||state.me.schoolId;
      state.me.schoolName=d.schoolName||state.me.schoolName;
      state.me.capabilities={schoolAttendance:true,readOnly:true};
      state.students=[];state.student=null;state.page="school";
      render();
      await loadSchoolFollowup(true);
      render();
    }catch(e){console.warn("school access check failed",e?.message||e)}
  }

  async function loadSchoolFollowup(force=false){
    if(state.me?.role!=="school"||state.schoolViewer.loading)return;
    if(state.schoolViewer.data?.date===state.schoolViewer.date&&!force)return;
    state.schoolViewer.loading=true;state.schoolViewer.error="";render();
    try{state.schoolViewer.data=await api(`/api/school-followup?date=${encodeURIComponent(state.schoolViewer.date)}`)}
    catch(e){state.schoolViewer.error=e.message||String(e);state.schoolViewer.data=null}
    state.schoolViewer.loading=false;
  }

  window.changeSchoolFollowupDate=async function(v){if(!/^\d{4}-\d{2}-\d{2}$/.test(String(v||"")))return;state.schoolViewer.date=v;state.schoolViewer.data=null;render();await loadSchoolFollowup(true);render()};
  window.shiftSchoolFollowupDate=async function(days){state.schoolViewer.date=shiftDate(state.schoolViewer.date,days);state.schoolViewer.data=null;render();await loadSchoolFollowup(true);render()};
  window.todaySchoolFollowup=async function(){state.schoolViewer.date=localDate();state.schoolViewer.data=null;render();await loadSchoolFollowup(true);render()};
  window.refreshSchoolFollowup=async function(){state.schoolViewer.data=null;render();await loadSchoolFollowup(true);render();if(!state.schoolViewer.error)toast("✅ 已更新校方出缺勤資料")};
  window.setSchoolFollowupFilter=function(v){state.schoolViewer.filter=v;render()};

  function csvCell(v){const s=String(v??"");return /[",\r\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s}
  window.exportSchoolFollowup=function(){
    const d=state.schoolViewer.data;if(!d){toast("尚未載入資料");return}
    const rows=[["日期","課程","團別","分部","學生姓名","年級","班級","樂器","出勤狀態","點名老師"]];
    for(const x of d.items||[])rows.push([x.date,classText[x.classType]||x.classType,x.groupName,x.section,x.name,x.grade,x.className||x.class||x.homeroom||"",x.instrument,statusText[x.status]||x.status,x.teacherName]);
    const content="\uFEFF"+rows.map(r=>r.map(csvCell).join(",")).join("\r\n"),blob=new Blob([content],{type:"text/csv;charset=utf-8"}),a=document.createElement("a");
    a.href=URL.createObjectURL(blob);a.download=`${d.date}_弦樂團_校方出缺勤查詢.csv`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  };

  function filterButtons(){
    const f=state.schoolViewer.filter;
    return `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:10px"><button class="${f==="followup"?"primary":"secondary"}" style="margin:0;padding:9px 4px" onclick="setSchoolFollowupFilter('followup')">需追蹤</button><button class="${f==="absent"?"primary":"secondary"}" style="margin:0;padding:9px 4px" onclick="setSchoolFollowupFilter('absent')">缺席</button><button class="${f==="leave"?"primary":"secondary"}" style="margin:0;padding:9px 4px" onclick="setSchoolFollowupFilter('leave')">請假</button><button class="${f==="all"?"primary":"secondary"}" style="margin:0;padding:9px 4px" onclick="setSchoolFollowupFilter('all')">全部</button></div>`;
  }
  function filteredItems(items=[]){const f=state.schoolViewer.filter;if(f==="all")return items;if(f==="followup")return items.filter(x=>x.status==="absent");return items.filter(x=>x.status===f)}

  function schoolPage(){
    const s=state.schoolViewer,d=s.data,c=d?.counts||{},items=filteredItems(d?.items||[]);
    let body="";
    if(s.error)body=`<div class="error">讀取失敗：${esc(s.error)}</div><button class="secondary" style="width:100%;margin-top:10px" onclick="refreshSchoolFollowup()">🔄 重新讀取</button>`;
    else if(s.loading&&!d)body=`<div class="notice">正在彙整 ${esc(s.date)} 的學生出缺勤資料…</div>`;
    else if(d)body=`<div class="grid"><div class="kpi"><b>${c.followup||0}</b><span>需追蹤</span></div><div class="kpi"><b>${c.absent||0}</b><span>缺席</span></div><div class="kpi"><b>${c.leave||0}</b><span>請假</span></div><div class="kpi"><b>${(c.present||0)+(c.late||0)}</b><span>到課</span></div></div>`;
    const list=s.loading&&!d?"":s.error?"":items.length?items.map(x=>`<div class="item"><div><b>${esc(x.name)}｜${esc(classText[x.classType]||x.classType)}</b><small>${esc(x.grade||"—")}｜${esc(x.className||x.class||x.homeroom||"班級未設定")}<br>${esc(x.groupName)}團｜${esc(x.section)}｜${esc(x.instrument)}<br>點名老師：${esc(x.teacherName||"—")}</small></div><span class="badge ${badgeClass(x.status)}">${esc(statusText[x.status]||x.status)}</span></div>`).join(""):`<div class="notice">✅ 此篩選條件目前沒有資料。</div>`;
    return `<div class="card hero"><div class="section-title"><h2>🏫 校方出缺勤查詢</h2><span class="badge ok">唯讀</span></div><div class="notice">提供學校行政端即時掌握弦樂團學生出缺勤，方便後續聯繫、確認與追蹤。<br><b>此帳號僅可查詢，無法修改老師點名或學生資料。</b></div></div><div class="card"><h2>📅 查詢日期</h2><div style="display:grid;grid-template-columns:48px 1fr 48px;gap:8px;align-items:center"><button class="secondary" style="margin:0;padding:12px 6px" onclick="shiftSchoolFollowupDate(-1)">←</button><input type="date" value="${esc(s.date)}" onchange="changeSchoolFollowupDate(this.value)"><button class="secondary" style="margin:0;padding:12px 6px" onclick="shiftSchoolFollowupDate(1)">→</button></div><div class="row2" style="margin-top:8px"><button class="secondary" style="margin:0" onclick="todaySchoolFollowup()">今天</button><button class="secondary" style="margin:0" onclick="refreshSchoolFollowup()">🔄 重新整理</button></div></div><div class="card"><h2>📊 當日出缺勤</h2>${body}${d?filterButtons():""}<div class="notice" style="margin-top:12px"><b>狀態說明</b><br>• <b>到課</b>：老師已確認學生正常到課；遲到仍屬已到課並保留遲到紀錄。<br>• <b>請假</b>：已有明確請假紀錄，不列入需追蹤。<br>• <b>缺席／需追蹤</b>：老師已完成點名，學生未到課且目前無請假紀錄，建議校方後續確認。<br>• <b>未點名</b>：屬老師尚未完成點名的作業狀態，不代表學生缺席。</div></div><div class="card"><div class="section-title"><h2>${esc(s.date)} 學生紀錄</h2>${d?`<span class="badge warn">${items.length} 筆</span>`:""}</div>${list}${d?`<button class="secondary" style="width:100%;margin-top:12px" onclick="exportSchoolFollowup()">📥 匯出當日出缺勤 CSV</button>`:""}</div>`;
  }
  function schoolHelpPage(){return `<div class="card"><h2>ℹ️ 校方查詢權限說明</h2><div class="notice">此權限提供學校行政人員查看弦樂團分部課、合奏課及綜合課的出缺勤資料，用於學生聯繫與後續追蹤。<br><br><b>校方查詢帳號為唯讀：</b>不能修改點名結果、學生主檔、老師設定或系統設定。若點名內容需要修正，請由原點名老師或系統管理員處理。</div></div>`}

  const baseRoleText=roleText;
  roleText=function(){return state.me?.role==="school"?"校方查詢":baseRoleText()};
  const baseNav=nav;
  nav=function(){if(state.me?.role==="school")return `<nav class="nav">${navBtn("school","🏫","出缺勤")}${navBtn("help","ℹ️","說明")}<button></button><button></button></nav>`;return baseNav()};
  const baseGo=go;
  go=async function(p){if(state.me?.role==="school"){state.page=p==="help"?"help":"school";render();if(state.page==="school")await loadSchoolFollowup();render();return}return baseGo(p)};
  const baseRender=render;
  render=function(){
    if(state.me?.role==="school"){
      const c=state.page==="help"?schoolHelpPage():schoolPage();
      document.getElementById("app").innerHTML=shell(c);
      if(state.page!=="help"&&!state.schoolViewer.data&&!state.schoolViewer.loading&&!state.schoolViewer.error)setTimeout(()=>loadSchoolFollowup().then(render),0);
      return;
    }
    const r=baseRender();
    if(state.me?.role==="admin"&&state.page==="admin")setTimeout(mountAdminSchoolAccess,0);
    return r;
  };

  if(state.me?.role==="admin"&&state.page==="admin")setTimeout(mountAdminSchoolAccess,0);
  setTimeout(checkSchoolAccess,0);
})();
