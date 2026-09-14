(()=>{
  const teacherAccount=()=>state.me?.role!=="admin"&&(state.me?.role==="teacher"||state.me?.capabilities?.teacherSettings);
  state.teacherSetup=state.teacherSetup||null;

  const originalRoleText=roleText;
  roleText=function(){if(teacherAccount())return "教學老師";return originalRoleText()};

  const originalNav=nav;
  nav=function(){
    if(!teacherAccount())return originalNav();
    const c=state.me?.capabilities||{},items=[];
    if(c.section)items.push(navBtn("section","🎼","分部課"));
    if(c.ensemble)items.push(navBtn("ensemble","🎻","團體課"));
    if(c.private)items.push(navBtn("private","👤","個別課"));
    items.push(navBtn("teacherSettings","⚙️","我的教學"));
    while(items.length<4)items.push("<button></button>");
    return `<nav class="nav">${items.slice(0,4).join("")}</nav>`;
  };

  function checked(v){return v?"checked":""}
  function teacherSettingsPage(){
    const d=state.teacherSetup;
    if(!d)return `<div class="card"><h2>我的教學設定</h2><div class="notice">正在載入學生與課程資料…</div></div>`;
    const p=d.profile||{},sectionSet=new Set((p.sectionAssignments||[]).map(x=>`${x.groupName}|${x.section}`));
    const ensembleSet=new Set((p.ensembleGroups||[]).map(String));
    const privateSet=new Set((p.privateStudentIds||[]).map(String));
    const groups=d.choices?.groups||["A","B","儲備"],sections=d.choices?.sections||["小提一部","小提二部","中提","大提"];
    const schedule=d.schedule||{};
    const sectionRows=groups.map(g=>`<div class="item" style="display:block"><b>${esc(g)}團分部課</b><small>${esc((schedule[g]||[]).join("、"))}</small><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:9px">${sections.map(sec=>`<label class="check" style="margin:0"><input class="teacherSectionPick" type="checkbox" data-group="${esc(g)}" data-section="${esc(sec)}" ${checked(sectionSet.has(`${g}|${sec}`))}><div>${esc(sec)}</div></label>`).join("")}</div></div>`).join("");
    const ensembleRows=["A","B"].map(g=>`<label class="check"><input class="teacherEnsemblePick" type="checkbox" value="${g}" ${checked(ensembleSet.has(g))}><div><b>${g}團團體課</b><br><small>四個分部一起上課，點名時自動帶入 ${g} 團全部學生</small></div></label>`).join("");
    const students=(d.students||[]).slice().sort((a,b)=>`${a.groupName}${a.section}${a.name}`.localeCompare(`${b.groupName}${b.section}${b.name}`,"zh-Hant"));
    const privateRows=students.map(s=>`<label class="check teacherStudentRow" data-search="${esc(`${s.name} ${s.groupName} ${s.section} ${s.instrument} ${s.grade}`.toLowerCase())}"><input class="teacherPrivatePick" type="checkbox" value="${esc(s.studentId)}" ${checked(privateSet.has(String(s.studentId)))}><div><b>${esc(s.name)}</b><br><small>${esc(s.groupName)}團｜${esc(s.section||"待確認")}｜${esc(s.instrument)}｜${esc(s.grade)}</small></div></label>`).join("");
    return `<div class="card hero"><h2>⚙️ 我的教學設定</h2><div class="notice">老師可自行選擇授課範圍。分部課／團體課名單會依 StudentMaster 自動更新；個別課則由老師自行勾選學生，可跨團、跨小提／中提／大提。</div></div>
      <div class="card"><h2>🎼 分部課</h2><div class="notice">A團固定週一、週三；B團週二、週四；儲備團週五。勾選「團別＋分部」後，點名頁會自動帶入符合的學生。</div>${sectionRows}</div>
      <div class="card"><h2>🎻 團體課</h2><div class="notice">目前只有 A、B 團設團體課；勾選後會自動帶入該團所有分部學生。</div>${ensembleRows}</div>
      <div class="card"><h2>👤 個別課學生</h2><div class="notice">個課老師可跨樂器與團別選學生。學生轉團或換分部不會取消個課綁定。</div><input id="teacherStudentSearch" placeholder="搜尋學生姓名／團別／分部／樂器" oninput="filterTeacherStudents()" style="margin-top:10px">${privateRows||'<div class="notice">目前沒有在團學生。</div>'}</div>
      <div class="card"><button class="primary" onclick="saveTeacherSettings()">儲存我的教學設定</button></div>`;
  }

  window.filterTeacherStudents=function(){
    const q=String($("teacherStudentSearch")?.value||"").trim().toLowerCase();
    document.querySelectorAll(".teacherStudentRow").forEach(el=>{el.style.display=!q||String(el.dataset.search||"").includes(q)?"flex":"none"});
  };

  window.loadTeacherSettings=async function(){
    if(!teacherAccount())return;
    try{state.teacherSetup=await api("/api/teacher-profile")}catch(e){console.warn(e);state.teacherSetup={error:e.message,profile:{},students:[]}}
  };

  window.saveTeacherSettings=async function(){
    const sectionAssignments=[...document.querySelectorAll(".teacherSectionPick:checked")].map(x=>({groupName:x.dataset.group,section:x.dataset.section}));
    const ensembleGroups=[...document.querySelectorAll(".teacherEnsemblePick:checked")].map(x=>x.value);
    const privateStudentIds=[...document.querySelectorAll(".teacherPrivatePick:checked")].map(x=>x.value);
    try{
      await api("/api/teacher-profile",{method:"PATCH",body:JSON.stringify({sectionAssignments,ensembleGroups,privateStudentIds})});
      toast("✅ 教學設定已儲存");
      state.teacherSetup=await api("/api/teacher-profile");
      state.me=await api("/api/me");
      state.students=await api("/api/students");
      if(state.me.capabilities?.section)state.page="section";
      else if(state.me.capabilities?.ensemble)state.page="ensemble";
      else if(state.me.capabilities?.private)state.page="private";
      else state.page="teacherSettings";
      render();
    }catch(e){toast("❌ "+e.message)}
  };

  const teacherRender=render;
  render=function(){
    if(teacherAccount()&&state.page==="teacherSettings"){
      document.getElementById("app").innerHTML=shell(teacherSettingsPage());
      return;
    }
    return teacherRender();
  };

  const teacherGo=go;
  go=async function(p){
    if(p==="teacherSettings"&&teacherAccount()){
      state.page=p;
      if(!state.teacherSetup)await loadTeacherSettings();
      render();return;
    }
    return teacherGo(p);
  };

  if(teacherAccount()){
    loadTeacherSettings().then(()=>{
      const c=state.me?.capabilities||{};
      if(!c.section&&!c.ensemble&&!c.private)state.page="teacherSettings";
      render();
    });
  }
})();
