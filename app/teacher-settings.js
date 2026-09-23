(()=>{
  const teacherAccount=()=>state.me?.role!=="admin"&&(state.me?.role==="teacher"||state.me?.capabilities?.teacherSettings);
  state.teacherSetup=state.teacherSetup||null;
  state.privateStudentFilters=state.privateStudentFilters||{group:"",section:"",q:"",selectedOnly:false};

  const originalRoleText=roleText;
  roleText=function(){if(teacherAccount())return "教學老師";return originalRoleText()};

  const originalNav=nav;
  nav=function(){
    if(!teacherAccount())return originalNav();
    const c=state.me?.capabilities||{},items=[];
    if(c.section)items.push(navBtn("section","🎼","分部課"));
    if(c.ensemble)items.push(navBtn("ensemble","🎻","合奏課"));
    if(state.teacherSetup?.profile?.comprehensiveEnabled)items.push(navBtn("comprehensive","🎶","綜合課"));
    if(c.private)items.push(navBtn("private","👤","個別課"));
    items.push(navBtn("teacherSettings","⚙️","我的教學"));
    while(items.length<4)items.push("<button></button>");
    return `<nav class="nav">${items.slice(0,4).join("")}</nav>`;
  };

  function checked(v){return v?"checked":""}
  function privateIds(){return (state.teacherSetup?.profile?.privateStudentIds||[]).map(String)}

  function teacherSettingsPage(){
    const d=state.teacherSetup;
    if(!d)return `<div class="card"><h2>我的教學設定</h2><div class="notice">正在載入學生與課程資料…</div></div>`;
    const p=d.profile||{},sectionSet=new Set((p.sectionAssignments||[]).map(x=>`${x.groupName}|${x.section}`));
    const ensembleSet=new Set((p.ensembleGroups||[]).map(String));
    const groups=d.choices?.groups||["A","B","儲備"],sections=d.choices?.sections||["小提一部","小提二部","中提","大提"];
    const schedule=d.schedule||{};
    const sectionRows=groups.map(g=>`<div class="item" style="display:block"><b>${esc(g)}團分部課</b><small>${(schedule[g]||[]).length?esc((schedule[g]||[]).join("、")):"依實際課表"}${g==="儲備"?"（時間依學校實際課表）":""}</small><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:9px">${sections.map(sec=>`<label class="check" style="margin:0"><input class="teacherSectionPick" type="checkbox" data-group="${esc(g)}" data-section="${esc(sec)}" ${checked(sectionSet.has(`${g}|${sec}`))}><div>${esc(sec)}</div></label>`).join("")}</div></div>`).join("");
    const ensembleRows=["A","B"].map(g=>`<label class="check"><input class="teacherEnsemblePick" type="checkbox" value="${g}" ${checked(ensembleSet.has(g))}><div><b>${g}團合奏課</b><br><small>四個分部一起上課，點名時自動帶入 ${g} 團全部學生</small></div></label>`).join("");
    const selectedCount=privateIds().length;
    return `<div class="card hero"><h2>⚙️ 我的教學設定</h2><div class="notice">分部課／合奏課／綜合課依授課範圍設定；個別課學生已拆成獨立頁面管理，名單多時比較容易搜尋與勾選。</div></div>
      <div class="card"><h2>🎼 分部課</h2><div class="notice">A團固定週一、週三；B團週二、週四；儲備團週五。勾選「團別＋分部」後，點名頁會自動帶入符合的學生。</div>${sectionRows}</div>
      <div class="card"><h2>🎻 合奏課</h2><div class="notice">A、B團合奏課：每週二 12:30–13:20。勾選後會自動帶入該團所有分部學生。</div>${ensembleRows}</div>
      <div class="card"><h2>🎶 弦樂團體課（綜合課）</h2><div class="notice">A團、B團、儲備團都參加。週五 08:45–10:15；本學期共 7 次：9/18、10/2、10/16、10/30、11/20、11/27、12/4。</div><label class="check"><input id="teacherComprehensivePick" type="checkbox" ${checked(p.comprehensiveEnabled===true)}><div><b>我要負責綜合課點名</b><br><small>開啟後會自動帶入 A／B／儲備團全部在團學生。</small></div></label></div>
      <div class="card"><div class="section-title"><h2>👤 個別課學生</h2><span class="badge ok">已選 ${selectedCount} 人</span></div><div class="notice">個別課學生改為獨立管理，不會和分部／合奏／綜合課設定混在一起。</div><button class="secondary" style="width:100%;margin-top:10px;padding:12px" onclick="go('privateStudents')">管理個別課學生名單 →</button></div>
      <div class="card"><button class="primary" onclick="saveTeacherSettings()">儲存分部／合奏／綜合課設定</button></div>`;
  }

  function privateStudentSettingsPage(){
    const d=state.teacherSetup;
    if(!d)return `<div class="card"><h2>👤 個別課學生管理</h2><div class="notice">正在載入學生名單…</div></div>`;
    const selected=new Set(privateIds());
    const groups=d.choices?.groups||["A","B","儲備"],sections=d.choices?.sections||["小提一部","小提二部","中提","大提","低音提"];
    const students=(d.students||[]).slice().sort((a,b)=>`${a.groupName}${a.section}${a.name}`.localeCompare(`${b.groupName}${b.section}${b.name}`,"zh-Hant"));
    const rows=students.map(s=>`<label class="check teacherStudentRow" data-group="${esc(s.groupName||"")}" data-section="${esc(s.section||"")}" data-selected="${selected.has(String(s.studentId))?"1":"0"}" data-search="${esc(`${s.name} ${s.groupName} ${s.section} ${s.instrument} ${s.grade}`.toLowerCase())}" style="padding:10px 4px;border-bottom:1px solid var(--line);margin:0"><input class="teacherPrivatePick" type="checkbox" value="${esc(s.studentId)}" ${checked(selected.has(String(s.studentId)))} onchange="privateStudentSelectionChanged(this)"><div><b>${esc(s.name)}</b><br><small>${esc(s.groupName)}團｜${esc(s.section||"待確認")}｜${esc(s.instrument)}｜${esc(s.grade)}｜${esc(s.studentId)}</small></div></label>`).join("");
    return `<div class="card hero"><div class="section-title"><h2>👤 個別課學生管理</h2><button class="secondary" onclick="go('teacherSettings')">← 返回</button></div><div class="notice">每位學生可獨立勾選。可先用團別、分部或姓名縮小範圍；學生轉團／換分部不會自動取消個課綁定。</div></div>
      <div class="card"><div class="section-title"><h2>已選學生</h2><span id="privateSelectedCount" class="badge ok">${selected.size} 人</span></div><div class="row2"><div><label>團別</label><select id="privateGroupFilter" onchange="filterPrivateStudents()"><option value="">全部團別</option>${groups.map(g=>`<option value="${esc(g)}">${esc(g)}團</option>`).join("")}</select></div><div><label>分部</label><select id="privateSectionFilter" onchange="filterPrivateStudents()"><option value="">全部分部</option>${sections.map(sec=>`<option value="${esc(sec)}">${esc(sec)}</option>`).join("")}</select></div></div><label>搜尋學生</label><input id="teacherStudentSearch" placeholder="姓名／樂器／年級／學號" oninput="filterPrivateStudents()"><label class="check"><input id="privateSelectedOnly" type="checkbox" onchange="filterPrivateStudents()"><div>只顯示已選學生</div></label><div class="row2" style="margin-top:8px"><button class="secondary" onclick="selectVisiblePrivateStudents(true)">勾選目前顯示</button><button class="secondary" onclick="selectVisiblePrivateStudents(false)">取消目前顯示</button></div></div>
      <div class="card"><div class="section-title"><h2>學生名單</h2><span id="privateVisibleCount" class="muted"></span></div><div id="privateStudentList">${rows||'<div class="notice">目前沒有在團學生。</div>'}</div></div>
      <div class="card"><button class="primary" onclick="savePrivateStudents()">💾 儲存個別課學生名單</button></div>`;
  }

  window.filterPrivateStudents=function(){
    const q=String($("teacherStudentSearch")?.value||"").trim().toLowerCase();
    const group=String($("privateGroupFilter")?.value||"");
    const section=String($("privateSectionFilter")?.value||"");
    const selectedOnly=!!$("privateSelectedOnly")?.checked;
    let shown=0;
    document.querySelectorAll(".teacherStudentRow").forEach(el=>{
      const input=el.querySelector(".teacherPrivatePick");
      const ok=(!q||String(el.dataset.search||"").includes(q))&&(!group||el.dataset.group===group)&&(!section||el.dataset.section===section)&&(!selectedOnly||!!input?.checked);
      el.style.display=ok?"flex":"none";if(ok)shown++;
    });
    const n=$("privateVisibleCount");if(n)n.textContent=`顯示 ${shown} 人`;
  };
  window.privateStudentSelectionChanged=function(input){
    const row=input?.closest?.(".teacherStudentRow");if(row)row.dataset.selected=input.checked?"1":"0";
    updatePrivateSelectedCount();
    if($("privateSelectedOnly")?.checked)filterPrivateStudents();
  };
  function updatePrivateSelectedCount(){
    const count=document.querySelectorAll(".teacherPrivatePick:checked").length;
    const el=$("privateSelectedCount");if(el)el.textContent=`${count} 人`;
  }
  window.selectVisiblePrivateStudents=function(flag){
    document.querySelectorAll(".teacherStudentRow").forEach(row=>{
      if(row.style.display==="none")return;
      const input=row.querySelector(".teacherPrivatePick");if(input){input.checked=flag;row.dataset.selected=flag?"1":"0"}
    });
    updatePrivateSelectedCount();if($("privateSelectedOnly")?.checked)filterPrivateStudents();
  };

  window.loadTeacherSettings=async function(){
    if(!teacherAccount())return;
    try{state.teacherSetup=await api("/api/teacher-profile")}catch(e){console.warn(e);state.teacherSetup={error:e.message,profile:{},students:[]}}
  };

  window.saveTeacherSettings=async function(){
    const sectionAssignments=[...document.querySelectorAll(".teacherSectionPick:checked")].map(x=>({groupName:x.dataset.group,section:x.dataset.section}));
    const ensembleGroups=[...document.querySelectorAll(".teacherEnsemblePick:checked")].map(x=>x.value);
    const comprehensiveEnabled=!!$("teacherComprehensivePick")?.checked;
    const privateStudentIds=privateIds();
    try{
      await api("/api/teacher-profile",{method:"PATCH",body:JSON.stringify({sectionAssignments,ensembleGroups,comprehensiveEnabled,privateStudentIds})});
      toast("✅ 教學設定已儲存");
      state.teacherSetup=await api("/api/teacher-profile");
      state.me=await api("/api/me");
      state.students=await api("/api/students");
      render();
    }catch(e){toast("❌ "+e.message)}
  };

  window.savePrivateStudents=async function(){
    const p=state.teacherSetup?.profile||{};
    const privateStudentIds=[...document.querySelectorAll(".teacherPrivatePick:checked")].map(x=>x.value);
    try{
      await api("/api/teacher-profile",{method:"PATCH",body:JSON.stringify({sectionAssignments:p.sectionAssignments||[],ensembleGroups:p.ensembleGroups||[],comprehensiveEnabled:p.comprehensiveEnabled===true,privateStudentIds})});
      toast(`✅ 個別課學生名單已儲存，共 ${privateStudentIds.length} 人`);
      state.teacherSetup=await api("/api/teacher-profile");
      state.me=await api("/api/me");
      state.students=await api("/api/students");
      render();setTimeout(filterPrivateStudents,0);
    }catch(e){toast("❌ "+e.message)}
  };

  const teacherRender=render;
  render=function(){
    if(teacherAccount()&&state.page==="teacherSettings"){
      document.getElementById("app").innerHTML=shell(teacherSettingsPage());return;
    }
    if(teacherAccount()&&state.page==="privateStudents"){
      document.getElementById("app").innerHTML=shell(privateStudentSettingsPage());setTimeout(filterPrivateStudents,0);return;
    }
    return teacherRender();
  };

  const teacherGo=go;
  go=async function(p){
    if((p==="teacherSettings"||p==="privateStudents")&&teacherAccount()){
      state.page=p;if(!state.teacherSetup)await loadTeacherSettings();render();return;
    }
    return teacherGo(p);
  };

  if(teacherAccount()){
    if(state.teacherSetup){
      const c=state.me?.capabilities||{};
      if(!c.section&&!c.ensemble&&!c.private&&!state.teacherSetup?.profile?.comprehensiveEnabled)state.page="teacherSettings";
      if(!window.__roleModuleBootstrap)render();
    }else{
      state.teacherSetupInitPromise=state.teacherSetupInitPromise||loadTeacherSettings().then(()=>{
        const c=state.me?.capabilities||{};
        if(!c.section&&!c.ensemble&&!c.private&&!state.teacherSetup?.profile?.comprehensiveEnabled)state.page="teacherSettings";
        if(!window.__roleModuleBootstrap)render();
      });
    }
  }
})();
