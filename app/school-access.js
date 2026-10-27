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
    if(s.error)return `<div class="card"><h2>🏫 校方查詢帳號</h2><div class="error">讀取失敗：${esc(s.error)}</div><button class="secondary" style="width:100%;margin-top:10px" onclick="retrySchoolAccessAdmin()">🔄 重新讀取</button></div>`;
    if(!s.loaded)return `<div class="card"><h2>🏫 校方查詢帳號</h2><div class="notice">${s.loading?"正在讀取校方帳號…":"準備讀取校方帳號…"}</div></div>`;
    return `<div class="card"><h2>🏫 校方查詢帳號</h2><div class="notice">讓校方人員查閱出缺勤，不能修改點名。每行填寫一個 Gmail，完成後按「儲存查詢帳號」。</div><label>校方 Gmail</label><textarea id="schoolAccessEmails" rows="4" placeholder="例如：school@example.com">${esc((s.emails||[]).join("\n"))}</textarea><button class="primary" onclick="saveSchoolAccess()">儲存查詢帳號</button></div>`;
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
    if(!["school","admin"].includes(state.me?.role)||state.schoolViewer.loading)return;
    if(state.schoolViewer.data?.date===state.schoolViewer.date&&!force)return;
    state.schoolViewer.loading=true;state.schoolViewer.error="";render();
    try{state.schoolViewer.data=await api(`/api/school-followup?date=${encodeURIComponent(state.schoolViewer.date)}`)}
    catch(e){state.schoolViewer.error=e.message||String(e);state.schoolViewer.data=null}
    state.schoolViewer.loading=false;
  }

  window.changeSchoolFollowupDate=async function(v){if(!/^\d{4}-\d{2}-\d{2}$/.test(String(v||"")))return;if(state.me?.role==="admin"&&v>=localDate()){toast("請選擇過去的上課日期");return}state.schoolViewer.date=v;if(state.me?.role==="admin")state.schoolViewer.correctionStudentId="";state.schoolViewer.data=null;render();await loadSchoolFollowup(true);render()};
  window.shiftSchoolFollowupDate=async function(days){state.schoolViewer.date=shiftDate(state.schoolViewer.date,days);state.schoolViewer.correctionStudentId="";state.schoolViewer.data=null;render();await loadSchoolFollowup(true);render()};
  window.todaySchoolFollowup=async function(){state.schoolViewer.date=localDate();state.schoolViewer.correctionStudentId="";state.schoolViewer.data=null;render();await loadSchoolFollowup(true);render()};
  window.refreshSchoolFollowup=async function(){state.schoolViewer.data=null;render();await loadSchoolFollowup(true);render();if(!state.schoolViewer.error)toast("✅ 已更新校方出缺勤資料")};
  const acknowledgingSchoolAbsences=new Set();
  window.acknowledgeSchoolAbsence=async function(id,version){
    const viewer=state.schoolViewer,date=viewer.date,row=viewer.data?.items?.find(x=>x.followupId===id&&x.recordVersion===version);
    if(state.me?.role!=="school"||viewer.data?.canAcknowledge!==true||!row||row.status!=="absent"||row.followup?.state==="acknowledged"||acknowledgingSchoolAbsences.has(id))return;
    if(!confirm("確認已知悉「"+row.name+"」於 "+date+" 的缺席狀況？\n只更新學校追蹤狀態，不會修改點名或成績。"))return;
    const note=prompt("追蹤備註（選填，例如：已確認學生去向／已聯繫家長）","已知悉");if(note===null)return;
    const scope=String(state.me?.email)+"|"+String(state.me?.schoolId)+"|"+date;
    acknowledgingSchoolAbsences.add(id);render();
    try{
      await api("/api/school-followup?mode=acknowledge&date="+encodeURIComponent(date),{method:"PATCH",body:JSON.stringify({followupId:id,recordVersion:version,note:note.slice(0,250)})});
      if(scope!==String(state.me?.email)+"|"+String(state.me?.schoolId)+"|"+state.schoolViewer.date)return;
      state.schoolViewer.data=null;await loadSchoolFollowup(true);render();toast("✅ 學校已知悉，後台待追蹤已同步；原缺席紀錄保留");
    }catch(error){toast("標記未完成："+(error.message||error))}
    finally{acknowledgingSchoolAbsences.delete(id);render()}
  };
  document.addEventListener("click",event=>{const button=event.target.closest?.("button[data-school-followup-ack]");if(button)window.acknowledgeSchoolAbsence(button.dataset.schoolFollowupAck,button.dataset.schoolFollowupVersion)});
  window.setSchoolFollowupFilter=function(v){state.schoolViewer.filter=v;render()};
  window.selectAdminSectionStudent=function(v){state.schoolViewer.correctionStudentId=String(v||"");mountAdminSchoolCorrection()};
  window.toggleAdminSchoolCorrection=async function(){
    if(state.me?.role!=="admin"||state.page!=="admin")return;
    state.schoolViewer.adminCorrectionOpen=!state.schoolViewer.adminCorrectionOpen;
    if(state.schoolViewer.adminCorrectionOpen&&!state.schoolViewer.data){
      state.schoolViewer.date=shiftDate(localDate(),-1);
      mountAdminSchoolCorrection();await loadSchoolFollowup(true);
    }
    mountAdminSchoolCorrection();
  };

  window.correctSchoolSection=async function(index){
    if(state.me?.role!=="admin"){toast("校方查詢帳號只能查看，不能修改點名");return}
    const record=adminCorrectionItems()[index];
    if(!record||record.classType!=="section"||record.date>=localDate()){toast("僅可修正過去日期既有的分部課點名");return}
    const status=document.getElementById(`schoolCorrection_${index}`)?.value;
    if(!status||status===record.status){toast("請選擇不同的出勤狀態");return}
    const reason=document.getElementById(`schoolCorrectionReason_${index}`)?.value||"";
    if(!reason.trim()){toast("請填寫修正原因");return}
    if(!confirm(`確認將 ${record.name} 的分部課由「${statusText[record.status]}」修正為「${statusText[status]}」？`))return;
    try{
      await api("/api/school-section-correction",{method:"PATCH",body:JSON.stringify({date:record.date,studentId:record.studentId,groupName:record.groupName,section:record.section,previousStatus:record.status,status,reason:reason.trim()})});
      state.schoolViewer.data=null;await loadSchoolFollowup(true);render();toast("✅ 點名已修正，家長成績將依最新狀態重新計算");
    }catch(e){toast("❌ "+e.message)}
  };

  function csvCell(v){const s=String(v??"");return /[",\r\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s}
  window.exportSchoolFollowup=function(){
    const d=state.schoolViewer.data;if(!d){toast("尚未載入資料");return}
    const rows=[["日期","課程","團別","分部","學生姓名","年級","班級","樂器","出勤狀態","點名老師","學校追蹤狀態","知悉人","知悉時間","追蹤備註"]];
    for(const x of d.items||[])rows.push([x.date,classText[x.classType]||x.classType,x.groupName,x.section,x.name,x.grade,x.className||x.class||x.homeroom||"",x.instrument,statusText[x.status]||x.status,x.teacherName,x.status==="absent"?(x.followup?.state==="acknowledged"?"學校已知悉":"待學校老師知悉"):"無須追蹤",x.followup?.acknowledgedBy||"",x.followup?.acknowledgedAt||"",x.followup?.note||""]);
    const content="\uFEFF"+rows.map(r=>r.map(csvCell).join(",")).join("\r\n"),blob=new Blob([content],{type:"text/csv;charset=utf-8"}),a=document.createElement("a");
    a.href=URL.createObjectURL(blob);a.download=`${d.date}_弦樂團_校方出缺勤查詢.csv`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  };

  function filterButtons(){
    const f=state.schoolViewer.filter;
    return `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:10px"><button class="${f==="followup"?"primary":"secondary"}" style="margin:0;padding:9px 4px" onclick="setSchoolFollowupFilter('followup')">需追蹤</button><button class="${f==="absent"?"primary":"secondary"}" style="margin:0;padding:9px 4px" onclick="setSchoolFollowupFilter('absent')">缺席</button><button class="${f==="leave"?"primary":"secondary"}" style="margin:0;padding:9px 4px" onclick="setSchoolFollowupFilter('leave')">請假</button><button class="${f==="all"?"primary":"secondary"}" style="margin:0;padding:9px 4px" onclick="setSchoolFollowupFilter('all')">全部</button></div>`;
  }
  function filteredItems(items=[]){const f=state.schoolViewer.filter;if(f==="all")return items;if(f==="followup")return items.filter(x=>x.status==="absent"&&x.followup?.state!=="acknowledged");return items.filter(x=>x.status===f)}
  function adminCorrectionItems(){const id=state.schoolViewer.correctionStudentId||"";return id?(state.schoolViewer.data?.items||[]).filter(x=>x.classType==="section"&&String(x.studentId)===id):[]}

  function schoolPage(){
    const s=state.schoolViewer,d=s.data,c=d?.counts||{},items=filteredItems(d?.items||[]);
    let body="";
    if(s.error)body=`<div class="error">讀取失敗：${esc(s.error)}</div><button class="secondary" style="width:100%;margin-top:10px" onclick="refreshSchoolFollowup()">🔄 重新讀取</button>`;
    else if(s.loading&&!d)body=`<div class="notice">正在彙整 ${esc(s.date)} 的學生出缺勤資料…</div>`;
    else if(d)body=`<div class="grid"><div class="kpi"><b>${c.followup||0}</b><span>尚未知悉</span></div><div class="kpi"><b>${c.absent||0}</b><span>缺席</span></div><div class="kpi"><b>${c.leave||0}</b><span>請假</span></div><div class="kpi"><b>${(c.present||0)+(c.late||0)}</b><span>到課</span></div></div>`;
    const list=s.loading&&!d?"":s.error?"":items.length?items.map((x,index)=>`<div class="item" style="display:block"><div><b>${esc(x.name)}｜${esc(classText[x.classType]||x.classType)}</b><small>${esc(x.grade||"—")}｜${esc(x.className||x.class||x.homeroom||"班級未設定")}<br>${esc(x.groupName)}團｜${esc(x.section)}｜${esc(x.instrument)}<br>點名老師：${esc(x.teacherName||"—")}</small></div><span class="badge ${badgeClass(x.status)}">${esc(statusText[x.status]||x.status)}</span>${x.status==="absent"?x.followup?.state==="acknowledged"?`<div class="notice" style="margin-top:10px"><b>✅ 學校老師已知悉</b><br>${esc(x.followup.acknowledgedBy||"校方人員")}<br>${esc(new Date(x.followup.acknowledgedAt).toLocaleString("zh-TW",{timeZone:"Asia/Taipei",hour12:false}))}${x.followup.note?`<br>追蹤備註：${esc(x.followup.note)}`:""}<br>原始缺席紀錄保留</div>`:state.me?.role==="school"&&d.canAcknowledge===true?`<button type="button" class="secondary" style="margin-top:10px" data-school-followup-ack="${esc(x.followupId)}" data-school-followup-version="${esc(x.recordVersion)}" ${acknowledgingSchoolAbsences.has(x.followupId)?"disabled":""}>${acknowledgingSchoolAbsences.has(x.followupId)?"儲存中…":"✅ 標記已知悉"}</button>`:`<div class="notice">待學校老師知悉</div>`:""}${state.me?.role==="admin"&&x.classType==="section"&&x.date<localDate()?`<details style="margin-top:10px"><summary>修正分部課點名</summary><div class="notice">請先查證實際出勤；儲存時須填寫原因。</div><select id="schoolCorrection_${index}">${Object.entries(statusText).filter(([v])=>v!=="cancelled").map(([v,t])=>`<option value="${v}" ${v===x.status?"selected":""}>${t}</option>`).join("")}</select><button class="secondary" onclick="correctSchoolSection(${index})">確認修正</button></details>`:""}</div>`).join(""):`<div class="notice">✅ 此篩選條件目前沒有資料。</div>`;
    return `<div class="card hero"><div class="section-title"><h2>🏫 校方出缺勤查詢</h2><span class="badge ok">${state.me?.role==="admin"?"學校管理員":"可確認缺席"}</span></div><div class="notice">${state.me?.role==="admin"?"學校管理員可在查證後修正過去日期的分部課點名，須填寫原因。":"學校老師負責確認缺席狀況，請逐筆標記「已知悉」。標記後同步至幹部後台，原缺席紀錄及成績不變；此帳號仍不能修改點名。"}</div></div><div class="card"><h2>📅 查詢日期</h2><div style="display:grid;grid-template-columns:48px 1fr 48px;gap:8px;align-items:center"><button class="secondary" style="margin:0;padding:12px 6px" onclick="shiftSchoolFollowupDate(-1)">←</button><input type="date" value="${esc(s.date)}" onchange="changeSchoolFollowupDate(this.value)"><button class="secondary" style="margin:0;padding:12px 6px" onclick="shiftSchoolFollowupDate(1)">→</button></div><div class="row2" style="margin-top:8px"><button class="secondary" style="margin:0" onclick="todaySchoolFollowup()">今天</button><button class="secondary" style="margin:0" onclick="refreshSchoolFollowup()">🔄 重新整理</button></div></div><div class="card"><h2>📊 當日出缺勤</h2>${body}${d?filterButtons():""}<div class="notice" style="margin-top:12px"><b>狀態說明</b><br>• <b>到課</b>：老師已確認學生正常到課；遲到仍屬已到課並保留遲到紀錄。<br>• <b>請假</b>：已有明確請假紀錄，不列入需追蹤。<br>• <b>缺席／需追蹤</b>：老師已完成點名，學生未到課且無請假紀錄。尚未知悉者列入後台告警；已知悉者仍保留於「缺席」與「全部」。<br>• <b>未點名</b>：屬老師尚未完成點名的作業狀態，不代表學生缺席。</div></div><div class="card"><div class="section-title"><h2>${esc(s.date)} 學生紀錄</h2>${d?`<span class="badge warn">${items.length} 筆</span>`:""}</div>${list}${d?`<button class="secondary" style="width:100%;margin-top:12px" onclick="exportSchoolFollowup()">📥 匯出當日出缺勤 CSV</button>`:""}</div>`;
  }
  function schoolHelpPage(){return `<div class="card"><h2>ℹ️ 校方查詢權限說明</h2><div class="notice">此帳號可查看出缺勤，並針對缺席學生標記「已知悉」、填寫追蹤備註。結果會同步給幹部後台；不能修改點名、學生主檔或系統設定。過去分部課點名如需修正，請由學校管理員在後台處理。</div></div>`}
  function mountAdminSchoolCorrection(){
    if(state.me?.role!=="admin"||state.page!=="admin")return;
    const main=document.querySelector(".main");if(!main)return;
    let root=document.getElementById("adminSchoolCorrection");
    if(!root){root=document.createElement("div");root.id="adminSchoolCorrection";main.prepend(root)}
    const s=state.schoolViewer,items=adminCorrectionItems(),students=new Map();
    for(const x of s.data?.items||[])if(x.classType==="section"&&!students.has(String(x.studentId)))students.set(String(x.studentId),x);
    const studentOptions=[...students.values()].sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""),"zh-Hant")).map(x=>`<option value="${esc(x.studentId)}" ${String(x.studentId)===s.correctionStudentId?"selected":""}>${esc(x.name)}｜${esc(x.grade||"")}｜${esc(x.studentId)}</option>`).join("");
    const rows=items.map((x,i)=>`<details class="item" style="display:block"><summary><b>${esc(x.name)}｜${esc(x.groupName)}團 ${esc(x.section)}</b>　<span class="badge ${badgeClass(x.status)}">${esc(statusText[x.status]||x.status)}</span></summary><small>${esc(x.grade||"")}｜點名老師：${esc(x.teacherName||"—")}</small><label>修正為</label><select id="schoolCorrection_${i}">${Object.entries(statusText).filter(([v])=>["present","late","leave","absent"].includes(v)).map(([v,t])=>`<option value="${v}" ${v===x.status?"selected":""}>${t}</option>`).join("")}</select><label>查證原因（必填）</label><input id="schoolCorrectionReason_${i}" maxlength="300" placeholder="例：已核對請假紀錄"><button class="secondary" onclick="correctSchoolSection(${i})">確認修正</button></details>`).join("");
    root.innerHTML=`<div class="card"><div class="section-title"><h2>📝 歷史分部課點名修正</h2></div><button class="secondary" onclick="toggleAdminSchoolCorrection()">${s.adminCorrectionOpen?"收合":"開啟修正畫面"}</button>${s.adminCorrectionOpen?`<label>上課日期（僅可修正過去日期）</label><input type="date" max="${esc(shiftDate(localDate(),-1))}" value="${esc(s.date)}" onchange="changeSchoolFollowupDate(this.value)">${s.error?`<div class="error">${esc(s.error)}</div>`:s.loading?`<div class="notice">載入中…</div>`:s.data?`<label>選擇學生</label><select id="adminCorrectionStudent" onchange="selectAdminSectionStudent(this.value)"><option value="">請選擇學生</option>${studentOptions}</select>${s.correctionStudentId?`<div class="notice">該生分部課紀錄：${items.length} 筆。原因會保留於異動紀錄。</div>${rows||`<div class="notice">此日期沒有該生的分部課點名紀錄。</div>`}`:students.size?`<div class="notice">請從下拉選單選擇當日有分部課紀錄的學生。</div>`:`<div class="notice">此日期沒有分部課點名紀錄。</div>`}`:`<div class="notice">請選擇日期查詢。</div>`}`:""}</div>`;
  }

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
    if(state.me?.role==="admin"&&state.page==="admin")setTimeout(()=>{mountAdminSchoolAccess();mountAdminSchoolCorrection()},0);
    return r;
  };

  if(state.me?.role==="admin"&&state.page==="admin")setTimeout(()=>{mountAdminSchoolAccess();mountAdminSchoolCorrection()},0);
  const refreshVisibleSchoolFollowup=()=>{if(state.me?.role==="school"&&!document.hidden&&!state.schoolViewer.loading)loadSchoolFollowup(true).then(render)};
  window.addEventListener("focus",refreshVisibleSchoolFollowup);
  setInterval(refreshVisibleSchoolFollowup,60000);
  setTimeout(checkSchoolAccess,0);
})();
