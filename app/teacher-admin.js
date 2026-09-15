(()=>{
  state.teachers=state.teachers||[];
  const key=email=>String(email||"").replace(/[^a-zA-Z0-9]/g,"_");

  const baseLoadAdmin=loadAdmin;
  loadAdmin=async function(){
    await baseLoadAdmin();
    try{const d=await api("/api/teacher-directory");state.teachers=d.items||[]}catch(e){console.warn("teacher directory load failed",e);state.teachers=[]}
  };

  function summary(t){
    const parts=[];
    const sec=(t.sectionAssignments||[]).length;
    const ens=(t.ensembleGroups||[]).length;
    const pri=(t.privateStudentIds||[]).length;
    if(sec)parts.push(`分部課 ${sec} 組`);
    if(ens)parts.push(`合奏課 ${(t.ensembleGroups||[]).join("、")}團`);
    if(t.comprehensiveEnabled)parts.push("綜合課");
    if(pri)parts.push(`個課 ${pri} 人`);
    return parts.length?parts.join("｜"):"尚未設定教學範圍";
  }

  function teacherCard(t){
    const k=key(t.email),active=t.status!=="inactive";
    return `<div class="item" style="display:block">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
        <div><b>${esc(t.teacherName||"未命名老師")}</b><small>${esc(t.email)}<br>${esc(summary(t))}</small></div>
        <span class="badge ${active?"ok":"warn"}">${active?"啟用":"停用"}</span>
      </div>
      <div class="row2" style="margin-top:10px"><div><label>老師姓名</label><input id="tn_${k}" value="${esc(t.teacherName||"")}"></div><div><label>帳號狀態</label><select id="ts_${k}"><option value="active" ${active?"selected":""}>啟用</option><option value="inactive" ${!active?"selected":""}>停用</option></select></div></div>
      <button class="secondary" style="width:100%;margin-top:8px" onclick="saveTeacherAdmin('${encodeURIComponent(t.email)}')">儲存老師資料</button>
    </div>`;
  }

  function teacherAdminPanel(){
    const active=state.teachers.filter(t=>t.status!=="inactive").length;
    return `<div class="card hero" id="teacherAdmin"><h2>👩‍🏫 老師帳號管理</h2><div class="notice">老師權限只以此後台名單為準。老師登入後可在「我的教學」自行勾選分部課、合奏課、綜合課與個別課學生。</div><div class="grid" style="margin-top:12px"><div class="kpi"><b>${state.teachers.length}</b><span>老師帳號</span></div><div class="kpi"><b>${active}</b><span>目前啟用</span></div></div></div>
      <div class="card"><h2>新增老師</h2><label>老師姓名</label><input id="newTeacherName" placeholder="例：陳宣文"><label>Google Gmail</label><input id="newTeacherEmail" type="email" placeholder="teacher@gmail.com"><button class="primary" onclick="addTeacherAdmin()">新增並啟用老師</button></div>
      <div class="card"><h2>老師清單</h2>${state.teachers.length?state.teachers.map(teacherCard).join(""):'<div class="notice">目前尚未建立老師帳號。</div>'}</div>`;
  }

  window.addTeacherAdmin=async function(){
    const teacherName=String($("newTeacherName")?.value||"").trim();
    const email=String($("newTeacherEmail")?.value||"").trim().toLowerCase();
    if(!teacherName||!email){toast("請填寫老師姓名與 Gmail");return}
    try{
      await api("/api/teacher-directory",{method:"POST",body:JSON.stringify({teacherName,email,status:"active"})});
      toast("✅ 老師帳號已新增");await loadAdmin();render();
    }catch(e){toast("❌ "+e.message)}
  };

  window.saveTeacherAdmin=async function(encodedEmail){
    const email=decodeURIComponent(encodedEmail),k=key(email);
    const teacherName=String($(`tn_${k}`)?.value||"").trim();
    const status=String($(`ts_${k}`)?.value||"active");
    try{
      await api("/api/teacher-directory",{method:"PATCH",body:JSON.stringify({teacherName,email,status})});
      toast(status==="active"?"✅ 老師帳號已啟用／更新":"✅ 老師帳號已停用");await loadAdmin();render();
    }catch(e){toast("❌ "+e.message)}
  };

  const baseAdminPage=adminPage;
  adminPage=function(){return baseAdminPage()+teacherAdminPanel()};

  if(state.me?.role==="admin"){
    loadAdmin().then(()=>render()).catch(()=>{});
  }
})();
