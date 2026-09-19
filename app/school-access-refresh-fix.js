(()=>{
  const MAX_DENIED_CHECKS=3;
  const MAX_ERROR_RETRIES=8;
  let deniedChecks=0,errorRetries=0,running=false,resolved=false;

  function retry(delay){
    if(!resolved)setTimeout(enforceSchoolRole,delay);
  }

  async function enforceSchoolRole(){
    if(resolved||running)return;
    if(typeof state==="undefined"||!state.me)return;

    if(["admin","school","globalAdmin","tenantPending"].includes(state.me.role)){
      resolved=true;
      return;
    }

    running=true;
    try{
      // A hard refresh may finish /api/me much later than the support scripts
      // (for example after an Azure Functions cold start). Check as soon as
      // state.me exists; do not wait for the first shell render or a short
      // fixed polling window.
      const d=await api(`/api/school-access-self?_=${Date.now()}`,{
        cache:"no-store",
        headers:{"Cache-Control":"no-cache","Pragma":"no-cache"}
      });

      if(!d?.allowed){
        deniedChecks++;
        if(deniedChecks<MAX_DENIED_CHECKS)retry(750);
        else resolved=true;
        return;
      }

      if(d.schoolId)sessionStorage.setItem("school_context_id",String(d.schoolId));
      state.schoolViewer=state.schoolViewer||{};
      state.schoolViewer.checked=true;
      state.schoolViewer.allowed=true;
      state.me.role="school";
      state.me.schoolId=d.schoolId||state.me.schoolId;
      state.me.schoolName=d.schoolName||state.me.schoolName;
      state.me.capabilities={
        ...(state.me.capabilities||{}),
        schoolAttendance:true,
        readOnly:true
      };
      state.students=[];
      state.student=null;
      state.page="school";
      resolved=true;
      render();

      if(typeof loadSchoolFollowup==="function"){
        try{
          await loadSchoolFollowup(true);
          render();
        }catch(e){
          console.warn("school follow-up preload failed",e?.message||e);
        }
      }
    }catch(e){
      console.warn("school access refresh check failed",e?.message||e);
      errorRetries++;
      if(errorRetries<MAX_ERROR_RETRIES)retry(Math.min(500*errorRetries,2500));
      else resolved=true;
    }finally{
      running=false;
    }
  }

  function scheduleCheck(){
    if(!resolved)setTimeout(enforceSchoolRole,0);
  }

  // loadProfile may already be in flight when this file is loaded. Wrapping
  // render catches that in-flight refresh; wrapping loadProfile covers every
  // later Google sign-in without relying on timing.
  if(typeof render==="function"){
    const renderBeforeSchoolRefreshFix=render;
    render=function(...args){
      const result=renderBeforeSchoolRefreshFix.apply(this,args);
      scheduleCheck();
      return result;
    };
  }

  if(typeof loadProfile==="function"){
    const loadProfileBeforeSchoolRefreshFix=loadProfile;
    loadProfile=async function(...args){
      const result=await loadProfileBeforeSchoolRefreshFix.apply(this,args);
      await enforceSchoolRole();
      return result;
    };
  }

  // Immediate refreshes can be delayed by a cold API. Keep watching for the
  // authenticated profile instead of giving up after a few seconds.
  let waitTicks=0;
  const readyTimer=setInterval(()=>{
    if(resolved){clearInterval(readyTimer);return}
    if(typeof state!=="undefined"&&state.me){
      clearInterval(readyTimer);
      scheduleCheck();
    }else if(++waitTicks>=2400){
      // The loadProfile wrapper still covers a sign-in after this ten-minute
      // safety stop.
      clearInterval(readyTimer);
    }
  },250);

  if(!document.querySelector('script[data-global-tenant-admin="1"]')){
    const s=document.createElement("script");
    s.src="/global-tenant-admin.js?v=20260920-0245";
    s.defer=true;
    s.dataset.globalTenantAdmin="1";
    document.body.appendChild(s);
  }

  if(!document.querySelector('script[data-parent-binding-correction="1"]')){
    const s=document.createElement("script");
    s.src="/parent-binding-correction.js?v=20260919-1605";
    s.defer=true;
    s.dataset.parentBindingCorrection="1";
    document.body.appendChild(s);
  }

  window.addEventListener("pageshow",scheduleCheck);
  window.addEventListener("online",scheduleCheck);
  document.addEventListener("visibilitychange",()=>{
    if(document.visibilityState==="visible")scheduleCheck();
  });
})();
