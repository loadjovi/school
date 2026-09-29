(()=>{
  if(window.__desktopUiReady)return;
  window.__desktopUiReady=true;

  const isTeacher=()=>state.me?.role!=="admin"&&!!state.me?.capabilities?.teacherSettings;
  const item=(key,icon,label,action=key)=>({key,icon,label,action});

  function menu(){
    const role=state.me?.role,c=state.me?.capabilities||{};
    if(state.page==="contextSelect"||state.page==="schoolSelect")return [];
    if(role==="globalAdmin")return [
      item("globalOverview","🌐","跨校總覽","#globalOverview"),
      item("globalOnboarding","🚀","第二校上線","#globalOnboarding"),
      item("globalOperations","📊","月度工時","#globalOperations"),
      item("globalHealth","🩺","平台健康","#globalHealth"),
      item("globalSchools","🏫","學校管理","#globalSchools"),
      item("globalSettings","⚙️","進階設定","#globalSettings")
    ];
    if(role==="admin")return [
      item("admin","📈","管理總覽"),item("attendance","📋","出勤工作台"),
      item("students","👥","學生主檔"),item("scores","🧮","學期考核"),
      item("teacherAdmin","👩‍🏫","老師帳號"),item("schoolSchedule","📅","課程管理"),
      item("specialCalendar","🏆","加練與活動"),item("help","ℹ️","操作說明")
    ];
    if(isTeacher())return [
      item("teacherHome","🎓","今日教學"),item("attendance","📋","出勤概況"),
      ...(c.section?[item("section","🎼","分部課點名")]:[]),
      ...(c.ensemble?[item("ensemble","🎻","合奏課點名")]:[]),
      ...(c.comprehensive?[item("comprehensive","🎶","綜合課點名")]:[]),
      ...(c.private?[item("private","👤","個別課")]:[]),
      item("trainingAttendance","🏆","加練點名"),
      item("practiceProgress","📚","練習進度"),
      ...(c.section?[item("teacherEvaluation","📊","期末評量")]:[]),
      item("teacherSettings","⚙️","我的教學"),item("help","ℹ️","操作說明")
    ];
    if(role==="parent")return [item("home","🏠","首頁"),item("practice","⏱️","自主練習"),item("record","📊","學習紀錄"),item("register","➕","綁定孩子"),item("help","ℹ️","操作說明")];
    if(role==="school")return [item("school","🏫","校方出缺勤"),item("help","ℹ️","操作說明")];
    return [item("home","🏠","首頁"),item("help","ℹ️","操作說明")];
  }

  function active(key){
    if(key==="teacherAdmin")return state.page==="admin"&&!!state.teacherAdminOpen;
    if(key==="teacherSettings"&&state.page==="privateStudents")return true;
    if(key==="specialCalendar"&&state.me?.role==="admin"&&state.page==="trainingAttendance")return true;
    if(key.startsWith("global"))return state.desktopSection===key||(state.page==="global"&&!state.desktopSection&&key==="globalOverview");
    return state.page===key&&!(key==="admin"&&state.teacherAdminOpen);
  }
  function sidebar(items){
    if(!items.length)return "";
    return `<nav class="desktop-sidebar" aria-label="桌面版功能選單"><div class="desktop-sidebar-head"><b>工作選單</b><small>${esc(roleText())}</small></div><div class="desktop-menu">${items.map(x=>`<button type="button" data-desktop-action="${esc(x.action)}" class="desktop-menu-item ${active(x.key)?"is-active":""}" ${active(x.key)?'aria-current="page"':""}><span aria-hidden="true">${x.icon}</span><b>${esc(x.label)}</b></button>`).join("")}</div><div class="desktop-sidebar-foot">${esc(state.me?.schoolName||"管理中心")}</div></nav>`;
  }

  window.desktopNavigate=async function(action){
    const target=String(action||"");
    if(target.startsWith("#")){
      state.desktopSection=target.slice(1);
      document.querySelectorAll(".desktop-menu-item").forEach(b=>{const selected=b.dataset.desktopAction===target;b.classList.toggle("is-active",selected);if(selected)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current")});
      document.getElementById(target.slice(1))?.scrollIntoView({behavior:"smooth",block:"start"});return;
    }
    if(target==="teacherAdmin"&&typeof window.openTeacherAdmin==="function"){state.page="admin";window.openTeacherAdmin();return}
    if(state.me?.role==="admin"&&state.teacherAdminOpen)state.teacherAdminOpen=false;
    if(target==="schoolSchedule"&&typeof window.openScheduleAdmin==="function"){await window.openScheduleAdmin();return}
    if(target==="specialCalendar"&&typeof window.openSpecialCalendar==="function"){await window.openSpecialCalendar();return}
    if(target==="trainingAttendance"&&typeof window.openTrainingAttendance==="function"){await window.openTrainingAttendance();return}
    if(["schoolSchedule","specialCalendar","trainingAttendance","teacherAdmin"].includes(target)){toast("功能載入中，請稍後再試");return}
    await go(target);
  };
  document.addEventListener("click",e=>{
    const button=e.target.closest?.("[data-desktop-action]");if(!button)return;
    e.preventDefault();window.desktopNavigate(button.dataset.desktopAction).catch(err=>toast("❌ "+(err?.message||err)));
  });

  const baseShell=shell;
  shell=function(content){
    const page=String(state.page||"home"),layoutPage=page==="admin"&&state.teacherAdminOpen?"teacherAdmin":page,role=String(state.me?.role||""),items=menu();
    const html=baseShell(`<div class="desktop-content" data-page="${esc(layoutPage)}">${content}</div>`);
    return html.replace('<div class="shell">',`<div class="shell desktop-shell ${items.length?"":"desktop-no-sidebar"}" data-role="${esc(role)}" data-page="${esc(layoutPage)}">`)
      .replace('<main class="main">',`${sidebar(items)}<main class="main">`);
  };
})();
