(()=>{
  state.teachers=state.teachers||[];
  state.teacherStudents=state.teacherStudents||[];
  state.teacherAdminOpen=false;
  const key=email=>String(email||"").replace(/[^a-zA-Z0-9]/g,"_");

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

  function studentOptions(selected=[]){
    const ids=new Set((selected||[]).map(String));
    return (state.teacherStudents||[]).map(s=>`<option value="${esc(s.studentId)}" ${ids.has(String(s.studentId))?"selected":""}>${esc(s.name)}｜${esc(s.groupName)}團｜${esc(s.instrument)}｜${esc(s.grade||"")}</option>`).join("");
  }

  function teacherCard(t){
    const k=key(t.email),active=t.status!=="inactive";
    const privateEditor=t.privateOnly?`<div style="margin-top:10px"><label>🔒 個課限定學生</label><select id="tp_${k}" multiple size="6" style="width:100%">${studentOptions(t.privateStudentIds)}</select><small>此類老師登入後僅能使用個別課，且只會看到這裡綁定的學生；不提供其他學生名單、分部課、合奏課或綜合課權限。</small></div>`:"";
    return `<div class="item" style="display:block">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
        <div><b>${esc(t.teacherName||"未命名老師")}</b>${t.privateOnly?' <span class="badge warn">個課限定</span>':''}<small>${esc(t.email)}<br>${esc(summary(t))}<br><b>最近登入：</b>${esc(loginText(t.lastLoginAt))}</small></div>
        <span class="badge ${active?"ok":"warn"}">${active?"啟用":"停用"}</span>
      </div>
      <div class="row2" style="margin-top:10px"><div><label>老師姓名</label><input id="tn_${k}" value="${esc(t.teacherName||"")}"></div><div><label>帳號狀態</label><select id="ts_${k}"><option value="active" ${active?"selected":""}>啟用</option><option value="inactive" ${!active?"selected":""}>停用</option></select></div></div>
      ${privateEditor}
      <button class="secondary" style="width:100%;margin-top:8px" onclick="saveTeacherAdmin('${encodeURIComponent(t.email)}',${t.privateOnly?'true':'false'})">儲存老師資料</button>
    </div>`;
  }

  function dashboardCard(){
    const active=state.teachers.filter(t=>t.status!=="inactive").length,inactive=state.teachers.length-active;
    return `<div class="card" id="teacherAdmin"><h2>👩‍🏫 老師帳號</h2><div class="notice">啟用 <b>${active}</b> 人　停用 <b>${inactive}</b> 人</div><button class="secondary" style="width:100%;margin-top:10px" onclick="openTeacherAdmin()">管理老師 →</button></div>`;
  }

  function managementPage(){
    return `<div class="card"><button class="secondary" onclick="closeTeacherAdmin()">← 返回後台首頁</button><h2 style="margin-top:14px">👩‍🏫 老師帳號管理</h2><div class="notice">管理老師姓名、Gmail、帳號狀態與教學範圍；「最近登入」會在老師成功登入系統後更新。</div></div>
      <div class="card"><h2>新增一般老師</h2><label>老師姓名</label><input id="newTeacherName" placeholder="例：陳宣文"><label>Google Gmail</label><input id="newTeacherEmail" type="email" placeholder="teacher@gmail.com"><button class="primary" onclick="addTeacherAdmin()">新增並啟用老師</button></div>
      <div class="card"><h2>🔒 新增個課限定老師</h2><div class="notice">適用於非藝享的個課老師。此帳號<b>只能使用個別課功能</b>，登入後只會看到後台指定的學生，避免其他學生個資外洩。</div><label>老師姓名</label><input id="newPrivateTeacherName" placeholder="例：王老師"><label>Google Gmail</label><input id="newPrivateTeacherEmail" type="email" placeholder="teacher@gmail.com"><label>綁定學生（可複選）</label><select id="newPrivateTeacherStudents" multiple size="8" style="width:100%">${studentOptions([])}</select><small>Windows 可按 Ctrl、Mac 可按 Command 複選；手機可依裝置的多選方式操作。</small><button class="primary" onclick="addPrivateTeacherAdmin()">新增個課老師並綁定學生</button></div>
      <div class="card"><h2>老師清單（${state.teachers.length}）</h2>${state.teachers.length?state.teachers.map(teacherCard).join(""):'<div class="notice">目前尚未建立老師帳號。</div>'}</div>`;
  }

  function selectedValues(id){const el=$(id);return el?[...el.selectedOptions].map(o=>o.value):[]}
  window.openTeacherAdmin=function(){state.teacherAdminOpen=true;render()};
  window.closeTeacherAdmin=function(){state.teacherAdminOpen=false;render()};
  window.addTeacherAdmin=async function(){const teacherName=String($("newTeacherName")?.value||"").trim(),email=String($("newTeacherEmail")?.value||"").trim().toLowerCase();if(!teacherName||!email){toast("請填寫老師姓名與 Gmail");return}try{await api("/api/teacher-directory",{method:"POST",body:JSON.stringify({teacherName,email,status:"active"})});toast("✅ 老師帳號已新增");await loadAdmin();render()}catch(e){toast("❌ "+e.message)}};
  window.addPrivateTeacherAdmin=async function(){const teacherName=String($("newPrivateTeacherName")?.value||"").trim(),email=String($("newPrivateTeacherEmail")?.value||"").trim().toLowerCase(),privateStudentIds=selectedValues("newPrivateTeacherStudents");if(!teacherName||!email){toast("請填寫老師姓名與 Gmail");return}if(!privateStudentIds.length){toast("請至少綁定 1 位學生");return}try{await api("/api/teacher-directory",{method:"POST",body:JSON.stringify({teacherName,email,status:"active",privateOnly:true,privateStudentIds})});toast(`✅ 個課老師已新增並綁定 ${privateStudentIds.length} 位學生`);await loadAdmin();render()}catch(e){toast("❌ "+e.message)}};
  window.saveTeacherAdmin=async function(encodedEmail,privateOnly=false){const email=decodeURIComponent(encodedEmail),k=key(email),teacherName=String($(`tn_${k}`)?.value||"").trim(),status=String($(`ts_${k}`)?.value||"active"),body={teacherName,email,status};if(privateOnly){body.privateOnly=true;body.privateStudentIds=selectedValues(`tp_${k}`);if(!body.privateStudentIds.length){toast("個課限定老師至少需要綁定 1 位學生");return}}try{await api("/api/teacher-directory",{method:"PATCH",body:JSON.stringify(body)});toast(status==="active"?"✅ 老師帳號已啟用／更新":"✅ 老師帳號已停用");await loadAdmin();render()}catch(e){toast("❌ "+e.message)}};

  const baseAdminPage=adminPage;
  adminPage=function(){
    if(state.teacherAdminOpen)return `<main class="main">${managementPage()}</main>`;
    return baseAdminPage()+dashboardCard();
  };

  if(state.me?.role==="admin"){loadAdmin().then(()=>render()).catch(()=>{})}
})();
