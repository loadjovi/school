(()=>{
  const PARAM="line_menu";
  const STORAGE_KEY="lab_line_menu_target";
  const STAFF_TARGETS=new Set(["staff_today_courses","staff_attendance","staff_todos","staff_portal"]);
  const ALL_TARGETS=new Set([...STAFF_TARGETS,"parent_today_courses","parent_announcements","parent_activity_leave","parent_portal"]);

  function requestedTarget(){
    const query=new URLSearchParams(location.search).get(PARAM)||"";
    if(ALL_TARGETS.has(query)){
      try{sessionStorage.setItem(STORAGE_KEY,query)}catch{}
      return query;
    }
    try{
      const saved=sessionStorage.getItem(STORAGE_KEY)||"";
      return ALL_TARGETS.has(saved)?saved:"";
    }catch{return ""}
  }

  function clearTarget(){
    try{sessionStorage.removeItem(STORAGE_KEY)}catch{}
    const url=new URL(location.href);
    if(url.searchParams.has(PARAM)){
      url.searchParams.delete(PARAM);
      history.replaceState(history.state,"",url.pathname+url.search+url.hash);
    }
  }

  function activeSchoolAdminContexts(){
    const contexts=Array.isArray(state?.me?.contexts)?state.me.contexts:[];
    return contexts.filter(context=>context?.type==="schoolAdmin"&&["active","onboarding"].includes(String(context.status||"active")));
  }

  function chooseStaffContext(){
    const contexts=activeSchoolAdminContexts();
    if(contexts.length!==1)return false;
    sessionStorage.setItem("role_context","schoolAdmin");
    if(contexts[0].schoolId)sessionStorage.setItem("school_context_id",String(contexts[0].schoolId));
    location.reload();
    return true;
  }

  function showMessage(message){
    if(typeof toast==="function")toast(message);
  }

  function scrollToTodayCourses(){
    requestAnimationFrame(()=>setTimeout(()=>{
      const headings=[...document.querySelectorAll("#adminOperations h2")];
      const heading=headings.find(node=>node.textContent.includes("當日未到")||node.textContent.includes("今日課程"));
      heading?.closest(".card")?.scrollIntoView({behavior:"smooth",block:"start"});
    },250));
  }

  async function routeStaff(target){
    if(state.me?.role!=="admin"){
      if(chooseStaffContext())return true;
      const contexts=activeSchoolAdminContexts();
      if(contexts.length>1){
        if(typeof window.showContextSelector==="function")window.showContextSelector();
        showMessage("請先選擇要使用的學校管理員身分");
        return false;
      }
      clearTarget();
      showMessage("目前帳號沒有學校管理員權限");
      return true;
    }

    clearTarget();
    if(typeof window.openSchoolAdminWorkspace!=="function"){
      showMessage("幹部功能仍在載入，請稍後再試");
      return true;
    }

    if(target==="staff_today_courses"){
      await window.openSchoolAdminWorkspace("attendance");
      if(typeof window.todayAdminFollowup==="function")await window.todayAdminFollowup();
      scrollToTodayCourses();
      return true;
    }
    if(target==="staff_attendance"){
      await window.openSchoolAdminWorkspace("attendance");
      window.scrollTo(0,0);
      return true;
    }
    if(target==="staff_todos"){
      await window.openSchoolAdminWorkspace("tasks");
      window.scrollTo(0,0);
      return true;
    }
    await window.openSchoolAdminWorkspace("home");
    window.scrollTo(0,0);
    return true;
  }

  let running=false;
  const timer=setInterval(async()=>{
    const target=requestedTarget();
    if(!target){clearInterval(timer);return}
    if(running||typeof state==="undefined"||!state.me)return;
    if(!STAFF_TARGETS.has(target))return;
    running=true;
    try{
      const finished=await routeStaff(target);
      if(finished)clearInterval(timer);
    }catch(error){
      console.error("LAB LINE menu route failed",error);
      showMessage("LINE 選單導頁失敗，請重新點選一次");
      clearTarget();
      clearInterval(timer);
    }finally{running=false}
  },120);
  setTimeout(()=>clearInterval(timer),30000);
})();