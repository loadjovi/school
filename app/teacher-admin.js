(()=>{
  state.teachers=state.teachers||[];
  state.teacherStudents=state.teacherStudents||[];
  state.teacherAdminOpen=false;
  const key=email=>String(email||"").replace(/[^a-zA-Z0-9]/g,"_");
  const auditDate=offset=>new Date(Date.now()+8*3600000+offset*86400000).toISOString().slice(0,10);
  const loginAudit={open:false,from:auditDate(-30),to:auditDate(0),email:"",result:"",items:[],next:"",pages:[""],page:0,loading:false,loaded:false,error:"",scope:""};

  function loginAuditContent(){
    const options=(state.teachers||[]).map(t=>`<option value="${esc(t.email)}" ${loginAudit.email===t.email?"selected":""}>${esc(t.teacherName||t.email)}｜${esc(t.email)}</option>`).join("");
    const known=(state.teachers||[]).some(t=>t.email===loginAudit.email);
    const rows=loginAudit.items.map(x=>`<div class="item" style="display:block;overflow-wrap:anywhere"><b>${esc(loginText(x.at))}｜${x.result==="success"?"登入成功":"老師身分未授權"}</b><small>${esc(x.name||"未提供姓名")}｜${esc(x.email)}<br>${x.role==="privateTeacher"?"個課老師":x.result==="success"?"授課老師":"已通過 Google 驗證，但未取得老師權限"}${x.reason?`<br>${esc(x.reason)}`:""}</small></div>`).join("");
    return `<p>從本功能上線後逐次保留老師登入紀錄，時間為台灣時間。同一次 Google 登入重新整理不重複計算；重新登入會新增紀錄。舊版僅有最近登入時間，無法補回過去明細。</p><div class="row2"><div><label for="teacherLoginFrom">登入日期起</label><input id="teacherLoginFrom" type="date" value="${esc(loginAudit.from)}"></div><div><label for="teacherLoginTo">登入日期迄</label><input id="teacherLoginTo" type="date" value="${esc(loginAudit.to)}"></div></div><label for="teacherLoginEmail">老師</label><select id="teacherLoginEmail"><option value="">全部老師</option>${loginAudit.email&&!known?`<option selected value="${esc(loginAudit.email)}">${esc(loginAudit.email)}</option>`:""}${options}</select><label for="teacherLoginResult">登入結果</label><select id="teacherLoginResult"><option value="" ${!loginAudit.result?"selected":""}>全部結果</option><option value="success" ${loginAudit.result==="success"?"selected":""}>登入成功</option><option value="denied" ${loginAudit.result==="denied"?"selected":""}>老師身分未授權</option></select><button class="secondary" onclick="searchTeacherLoginHistory()" ${loginAudit.loading?"disabled":""}>查詢老師登入紀錄</button>${loginAudit.error?`<p class="error" role="alert">${esc(loginAudit.error)}</p>`:""}${loginAudit.loading?'<p role="status">正在讀取老師登入紀錄…</p>':loginAudit.loaded?`<p>第 ${loginAudit.page+1} 頁，本頁 ${loginAudit.items.length} 筆。${loginAudit.next?"可查看下一頁較早的紀錄。":""}</p>${rows||'<p>此條件沒有登入紀錄，請確認日期、老師與登入結果。</p>'}<div class="row2"><button class="secondary" onclick="pageTeacherLoginHistory(-1)" ${loginAudit.page?"":"disabled"}>上一頁</button><button class="secondary" onclick="pageTeacherLoginHistory(1)" ${loginAudit.next?"":"disabled"}>下一頁較早紀錄</button></div>`:""}`;
  }
  function mountLoginAudit(){
    if(state.me?.role!=="admin"||state.page!=="admin")return;
    const scope=String(state.me.schoolId||"")+"|"+String(state.me.email||"");
    if(loginAudit.scope!==scope){Object.assign(loginAudit,{scope,open:false,email:"",items:[],next:"",pages:[""],page:0,loaded:false,error:""})}
    const host=document.getElementById("schoolAdminActivity")||document.getElementById("schoolAccessAudit")||document.querySelector(".main");if(!host)return;
    let root=document.getElementById("teacherLoginAudit");
    if(!root){root=document.createElement("section");root.id="teacherLoginAudit";root.className="card";root.dataset.adminGroup="records";host.insertAdjacentElement("afterend",root)}
    root.hidden=state.adminWorkspaceSection!=="records";
    root.innerHTML=`<div class="section-title"><h2>老師完整登入歷史</h2><button class="secondary" style="width:auto;margin:0" onclick="toggleTeacherLoginHistory()">${loginAudit.open?"收合":"開啟老師登入查詢"}</button></div>${loginAudit.open?loginAuditContent():"<p>依日期、老師與登入結果，逐頁查詢本校老師登入紀錄。</p>"}`;
  }
  async function loadLoginAudit(cursor="",page=0){
    if(loginAudit.loading||state.me?.role!=="admin")return;
    loginAudit.loading=true;loginAudit.error="";mountLoginAudit();
    const scope=loginAudit.scope;
    const query=new URLSearchParams({from:loginAudit.from,to:loginAudit.to,email:loginAudit.email,result:loginAudit.result});if(cursor)query.set("cursor",cursor);
    try{
      const data=await api("/api/teacher-login-history?"+query);
      if(scope!==loginAudit.scope)return;
      loginAudit.items=data.items||[];loginAudit.next=data.nextCursor||"";loginAudit.page=page;loginAudit.pages[page]=cursor;loginAudit.loaded=true;
    }catch(e){loginAudit.error=e.message||String(e);loginAudit.items=[];loginAudit.loaded=false}
    finally{loginAudit.loading=false;mountLoginAudit()}
  }
  window.toggleTeacherLoginHistory=function(){loginAudit.open=!loginAudit.open;mountLoginAudit();if(loginAudit.open&&!loginAudit.loaded)loadLoginAudit()};
  window.searchTeacherLoginHistory=function(){
    const from=$("teacherLoginFrom")?.value,to=$("teacherLoginTo")?.value;
    if(!from||!to||from>to){toast("請確認查詢日期起迄");return}
    Object.assign(loginAudit,{from,to,email:$("teacherLoginEmail")?.value||"",result:$("teacherLoginResult")?.value||"",pages:[""],page:0,next:"",loaded:false});loadLoginAudit();
  };
  window.pageTeacherLoginHistory=function(direction){
    const page=loginAudit.page+direction;if(page<0||direction>0&&!loginAudit.next)return;
    loadLoginAudit(direction>0?loginAudit.next:loginAudit.pages[page],page);
  };
  window.openTeacherLoginHistory=async function(encodedEmail=""){
    if(state.me?.role!=="admin")return;
    state.teacherAdminOpen=false;
    if(typeof window.openSchoolAdminWorkspace==="function")await window.openSchoolAdminWorkspace("records");
    else{state.adminWorkspaceSection="records";render()}
    mountLoginAudit();Object.assign(loginAudit,{open:true,email:decodeURIComponent(encodedEmail),items:[],next:"",pages:[""],page:0,loaded:false});mountLoginAudit();await loadLoginAudit();
    document.getElementById("teacherLoginAudit")?.scrollIntoView({block:"start",behavior:"smooth"});
  };

  const baseLoadAdmin=loadAdmin;
  loadAdmin=async function(){
    await baseLoadAdmin();
    try{const d=await api("/api/teacher-directory");state.teachers=d.items||[];state.teacherStudents=d.students||[]}catch(e){console.warn("teacher directory load failed",e);state.teachers=[];state.teacherStudents=[]}
  };

  function summary(t){
    const parts=[];
    const sec=(t.sectionAssignments||[]).length,ens=(t.ensembleGroups||[]).length,pri=(t.privateStudentIds||[]).length;
    if(t.privateOnly)return `個課限定｜綁定學生 ${pri} 人`;
    parts.push(`分部課 ${sec?sec+" 組":"未設定"}`);
    parts.push(`合奏課 ${ens?(t.ensembleGroups||[]).join("、")+"團":"未設定"}`);
    parts.push(`綜合課 ${t.comprehensiveEnabled?"已啟用":"未啟用"}`);
    parts.push(`個別課 ${pri?pri+" 人":"未設定"}`);
    return parts.join("｜");
  }

  function loginText(v){
    if(!v)return "尚無登入紀錄";
    const d=new Date(v);if(Number.isNaN(d.getTime()))return "尚無登入紀錄";
    return new Intl.DateTimeFormat("zh-TW",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).format(d).replace(/\//g,"/");
  }
  function ratingText(t){
    const count=Number(t.ratingCount||0),avg=Number(t.ratingAverage||0),five=Number(t.fiveStarCount||0);
    if(!count)return "⭐ 家長師資評價：尚無評價";
    return "⭐ 家長師資評價："+avg.toFixed(2)+" / 5｜"+count+" 筆｜5 星 "+five+" 筆";
  }
  function ratingReviews(t){
    const rows=Array.isArray(t.recentReviews)?t.recentReviews:[];
    if(!rows.length)return "";
    return '<details style="margin-top:8px"><summary style="cursor:pointer;font-weight:800">查看最近家長評論</summary><div style="margin-top:8px">'+rows.map(r=>'<div class="notice" style="margin-top:6px"><b>'+"★".repeat(Number(r.rating||0))+"☆".repeat(Math.max(0,5-Number(r.rating||0)))+'</b>｜'+esc(r.lessonDate||"")+'<br>'+esc(r.review||"")+'</div>').join("")+'</div></details>';
  }

  function studentOptions(selected=[]){
    const ids=new Set((selected||[]).map(String));
    return (state.teacherStudents||[]).map(s=>`<option value="${esc(s.studentId)}" ${ids.has(String(s.studentId))?"selected":""}>${esc(s.name)}｜${esc(s.groupName)}團｜${esc(s.instrument)}｜${esc(s.grade||"")}</option>`).join("");
  }

  function teacherCard(t){
    const k=key(t.email),active=t.status!=="inactive";
    const privateEditor=`<div id="privateEditor_${k}" style="margin-top:10px;display:${t.privateOnly?"block":"none"}"><label>🔒 個課限定學生</label><select id="tp_${k}" multiple size="6" style="width:100%">${studentOptions(t.privateStudentIds)}</select><small>此類老師僅能使用個別課，綁定學生由校方管理員指定；轉為個課限定後，原團體課授課設定會清除。</small></div>`;
    return `<div class="item" style="display:block">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
        <div><b>${esc(t.teacherName||"未命名老師")}</b> <span class="badge ${t.privateOnly?"warn":"ok"}">${t.privateOnly?"個課限定":"一般老師"}</span><small>${esc(t.email)}<br>${esc(summary(t))}<br><b>最近登入：</b>${esc(loginText(t.lastLoginAt))}<br><b>${esc(ratingText(t))}</b>${t.accountTypeUnspecified?"<br>舊帳號未記錄類型，暫列一般老師；請校方核對後儲存。":""}</small>${ratingReviews(t)}</div>
        <span class="badge ${active?"ok":"warn"}">${active?"啟用":"停用"}</span>
      </div>
      <div class="row2" style="margin-top:10px"><div><label>老師姓名</label><input id="tn_${k}" value="${esc(t.teacherName||"")}"></div><div><label>帳號狀態</label><select id="ts_${k}"><option value="active" ${active?"selected":""}>啟用</option><option value="inactive" ${!active?"selected":""}>停用</option></select></div></div>
      <label>帳號類型</label><select id="tt_${k}" onchange="changeTeacherAccountType('${k}',this.value)"><option value="general" ${!t.privateOnly?"selected":""}>一般老師（可自行設定授課課程）</option><option value="privateOnly" ${t.privateOnly?"selected":""}>個課限定（僅校方指定的學生）</option></select>
      ${privateEditor}
      <button class="secondary" style="width:100%;margin-top:8px" onclick="saveTeacherAdmin('${encodeURIComponent(t.email)}')">儲存老師資料</button>
      <button class="secondary" style="width:100%;margin-top:8px" onclick="openTeacherLoginHistory('${encodeURIComponent(t.email).replaceAll("'","%27")}')">查看此老師完整登入歷史</button>
    </div>`;
  }

  function dashboardCard(){
    const active=state.teachers.filter(t=>t.status!=="inactive").length,inactive=state.teachers.length-active;
    return `<div class="card" id="teacherAdmin"><h2>👩‍🏫 老師帳號</h2><div class="notice">啟用 <b>${active}</b> 人　停用 <b>${inactive}</b> 人</div><button class="secondary" style="width:100%;margin-top:10px" onclick="openTeacherAdmin()">管理老師 →</button></div>`;
  }

  function managementPage(){
    return `<div class="card"><button class="secondary" onclick="closeTeacherAdmin()">← 返回後台首頁</button><h2 style="margin-top:14px">👩‍🏫 老師帳號管理</h2><div class="notice">一般老師是否勾選分部／合奏／綜合課，不會改變帳號類型。個課限定必須由校方明確指定，且只能使用指定學生的個別課。舊帳號未記錄類型時暫列一般老師，請逐一核對後儲存。「最近登入」會在老師成功登入後更新；家長的 1～5 星評價供師資參考。</div></div>
      <div class="card"><h2>新增一般老師</h2><label>老師姓名</label><input id="newTeacherName" placeholder="例：陳宣文"><label>Google Gmail</label><input id="newTeacherEmail" type="email" placeholder="teacher@gmail.com"><button class="primary" onclick="addTeacherAdmin()">新增並啟用老師＋寄送通知</button></div>
      <div class="card"><h2>🔒 新增個課限定老師</h2><div class="notice">適用於非藝享的個課老師。此帳號<b>只能使用個別課功能</b>，登入後只會看到後台指定的學生，避免其他學生個資外洩。</div><label>老師姓名</label><input id="newPrivateTeacherName" placeholder="例：王老師"><label>Google Gmail</label><input id="newPrivateTeacherEmail" type="email" placeholder="teacher@gmail.com"><label>綁定學生（可複選）</label><select id="newPrivateTeacherStudents" multiple size="8" style="width:100%">${studentOptions([])}</select><small>Windows 可按 Ctrl、Mac 可按 Command 複選；手機可依裝置的多選方式操作。</small><button class="primary" onclick="addPrivateTeacherAdmin()">新增個課老師＋寄送開通通知</button></div>
      <div class="card"><h2>老師清單（${state.teachers.length}）</h2>${state.teachers.length?state.teachers.map(teacherCard).join(""):'<div class="notice">目前尚未建立老師帳號。</div>'}</div>`;
  }

  window.teacherAdminManagementHtml=function(){return managementPage().replace('onclick="closeTeacherAdmin()"','onclick="closeInlineTeacherAdmin()"').replace('← 返回後台首頁','← 返回帳號管理')};

  function selectedValues(id){const el=$(id);return el?[...el.selectedOptions].map(o=>o.value):[]}
  window.changeTeacherAccountType=function(k,value){const editor=$(`privateEditor_${k}`);if(editor)editor.style.display=value==="privateOnly"?"block":"none"};
  window.openTeacherAdmin=function(){state.teacherAdminOpen=true;render()};
  window.closeTeacherAdmin=function(){state.teacherAdminOpen=false;render()};
  window.addTeacherAdmin=async function(){const teacherName=String($("newTeacherName")?.value||"").trim(),email=String($("newTeacherEmail")?.value||"").trim().toLowerCase();if(!teacherName||!email){toast("請填寫老師姓名與 Gmail");return}try{const d=await api("/api/teacher-directory",{method:"POST",body:JSON.stringify({teacherName,email,status:"active",privateOnly:false})}),mail=d.emailNotification||{};if(mail.status==="sent")toast("✅ 老師帳號已新增，開通通知 Email 已寄出");else if(mail.status==="not_configured")toast("✅ 老師帳號已新增；Email 服務尚未設定");else toast("✅ 老師帳號已新增；Email 通知未成功寄出");await loadAdmin();render()}catch(e){toast("❌ "+e.message)}};
  window.addPrivateTeacherAdmin=async function(){const teacherName=String($("newPrivateTeacherName")?.value||"").trim(),email=String($("newPrivateTeacherEmail")?.value||"").trim().toLowerCase(),privateStudentIds=selectedValues("newPrivateTeacherStudents");if(!teacherName||!email){toast("請填寫老師姓名與 Gmail");return}if(!privateStudentIds.length){toast("請至少綁定 1 位學生");return}try{const d=await api("/api/teacher-directory",{method:"POST",body:JSON.stringify({teacherName,email,status:"active",privateOnly:true,privateStudentIds})}),mail=d.emailNotification||{};if(mail.status==="sent")toast(`✅ 個課老師已新增並綁定 ${privateStudentIds.length} 位學生，開通通知 Email 已寄出`);else if(mail.status==="not_configured")toast(`✅ 個課老師已新增並綁定 ${privateStudentIds.length} 位學生；Email 服務尚未設定`);else toast(`✅ 個課老師已新增並綁定 ${privateStudentIds.length} 位學生；Email 通知未成功寄出`);await loadAdmin();render()}catch(e){toast("❌ "+e.message)}};
  window.saveTeacherAdmin=async function(encodedEmail){const email=decodeURIComponent(encodedEmail),k=key(email),teacherName=String($(`tn_${k}`)?.value||"").trim(),status=String($(`ts_${k}`)?.value||"active"),privateOnly=$(`tt_${k}`)?.value==="privateOnly",body={teacherName,email,status,privateOnly};if(privateOnly){body.privateStudentIds=selectedValues(`tp_${k}`);if(!body.privateStudentIds.length){toast("個課限定老師至少需要綁定 1 位學生");return}}try{await api("/api/teacher-directory",{method:"PATCH",body:JSON.stringify(body)});toast(status==="active"?"✅ 老師帳號已啟用／更新":"✅ 老師帳號已停用");await loadAdmin();render()}catch(e){toast("❌ "+e.message)}};

  const baseAdminPage=adminPage;
  adminPage=function(){
    if(state.teacherAdminOpen)return `<main class="main">${managementPage()}</main>`;
    return baseAdminPage();
  };

  const baseRender=render;
  render=function(){const result=baseRender();if(state.me?.role==="admin"&&state.page==="admin")setTimeout(mountLoginAudit,0);return result};

  if(state.me?.role==="admin"){loadAdmin().then(()=>render()).catch(()=>{})}
})();
