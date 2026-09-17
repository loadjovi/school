(()=>{
  state.teachers=state.teachers||[];
  state.teacherAdminOpen=false;
  const key=email=>String(email||"").replace(/[^a-zA-Z0-9]/g,"_");

  const baseLoadAdmin=loadAdmin;
  loadAdmin=async function(){
    await baseLoadAdmin();
    try{const d=await api("/api/teacher-directory");state.teachers=d.items||[]}catch(e){console.warn("teacher directory load failed",e);state.teachers=[]}
  };

  function summary(t){
    const parts=[];
    const sec=(t.sectionAssignments||[]).length,ens=(t.ensembleGroups||[]).length,pri=(t.privateStudentIds||[]).length;
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

  function teacherCard(t){
    const k=key(t.email),active=t.status!=="inactive";
    return `<div class="item" style="display:block">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
        <div><b>${esc(t.teacherName||"未命名老師")}</b><small>${esc(t.email)}<br>${esc(summary(t))}<br><b>最近登入：</b>${esc(loginText(t.lastLoginAt))}</small></div>
        <span class="badge ${active?"ok":"warn"}">${active?"啟用":"停用"}</span>
      </div>
      <div class="row2" style="margin-top:10px"><div><label>老師姓名</label><input id="tn_${k}" value="${esc(t.teacherName||"")}"></div><div><label>帳號狀態</label><select id="ts_${k}"><option value="active" ${active?"selected":""}>啟用</option><option value="inactive" ${!active?"selected":""}>停用</option></select></div></div>
      <button class="secondary" style="width:100%;margin-top:8px" onclick="saveTeacherAdmin('${encodeURIComponent(t.email)}')">儲存老師資料</button>
    </div>`;
  }

  function dashboardCard(){
    const active=state.teachers.filter(t=>t.status!=="inactive").length,inactive=state.teachers.length-active;
    return `<div class="card" id="teacherAdmin"><h2>👩‍🏫 老師帳號</h2><div class="notice">啟用 <b>${active}</b> 人　停用 <b>${inactive}</b> 人</div><button class="secondary" style="width:100%;margin-top:10px" onclick="openTeacherAdmin()">管理老師 →</button></div>`;
  }

  function managementPage(){
    return `<div class="card"><button class="secondary" onclick="closeTeacherAdmin()">← 返回後台首頁</button><h2 style="margin-top:14px">👩‍🏫 老師帳號管理</h2><div class="notice">管理老師姓名、Gmail、帳號狀態與教學範圍；「最近登入」會在老師成功登入系統後更新。</div></div>
      <div class="card"><h2>新增老師</h2><label>老師姓名</label><input id="newTeacherName" placeholder="例：陳宣文"><label>Google Gmail</label><input id="newTeacherEmail" type="email" placeholder="teacher@gmail.com"><button class="primary" onclick="addTeacherAdmin()">新增並啟用老師</button></div>
      <div class="card"><h2>老師清單（${state.teachers.length}）</h2>${state.teachers.length?state.teachers.map(teacherCard).join(""):'<div class="notice">目前尚未建立老師帳號。</div>'}</div>`;
  }

  window.openTeacherAdmin=function(){state.teacherAdminOpen=true;render()};
  window.closeTeacherAdmin=function(){state.teacherAdminOpen=false;render()};
  window.addTeacherAdmin=async function(){const teacherName=String($("newTeacherName")?.value||"").trim(),email=String($("newTeacherEmail")?.value||"").trim().toLowerCase();if(!teacherName||!email){toast("請填寫老師姓名與 Gmail");return}try{await api("/api/teacher-directory",{method:"POST",body:JSON.stringify({teacherName,email,status:"active"})});toast("✅ 老師帳號已新增");await loadAdmin();render()}catch(e){toast("❌ "+e.message)}};
  window.saveTeacherAdmin=async function(encodedEmail){const email=decodeURIComponent(encodedEmail),k=key(email),teacherName=String($(`tn_${k}`)?.value||"").trim(),status=String($(`ts_${k}`)?.value||"active");try{await api("/api/teacher-directory",{method:"PATCH",body:JSON.stringify({teacherName,email,status})});toast(status==="active"?"✅ 老師帳號已啟用／更新":"✅ 老師帳號已停用");await loadAdmin();render()}catch(e){toast("❌ "+e.message)}};

  const baseAdminPage=adminPage;
  adminPage=function(){
    if(state.teacherAdminOpen)return `<main class="main">${managementPage()}</main>`;
    return baseAdminPage()+dashboardCard();
  };

  if(state.me?.role==="admin"){loadAdmin().then(()=>render()).catch(()=>{})}
})();
