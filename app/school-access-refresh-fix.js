(()=>{
  const MAX_TRIES=120;
  let tries=0,running=false,finished=false;

  async function enforceSchoolRole(){
    if(finished||running)return;
    tries++;

    // On a hard refresh app-v3 starts loading the profile before this support
    // module is appended. Wait until the authenticated shell has rendered so
    // the base loadProfile flow cannot overwrite the school role afterwards.
    if(typeof state==="undefined"||!state.me||!document.querySelector(".shell")){
      if(tries<MAX_TRIES)setTimeout(enforceSchoolRole,100);
      return;
    }

    if(state.me.role==="admin"){
      finished=true;
      return;
    }

    running=true;
    try{
      const d=await api("/api/school-access-self");
      if(d?.allowed){
        state.schoolViewer=state.schoolViewer||{};
        state.schoolViewer.checked=true;
        state.schoolViewer.allowed=true;
        state.me.role="school";
        state.me.capabilities={...(state.me.capabilities||{}),schoolAttendance:true,readOnly:true};
        state.students=[];
        state.student=null;
        state.page="school";
        finished=true;
        render();
      }else{
        finished=true;
      }
    }catch(e){
      console.warn("school access refresh check failed",e?.message||e);
      if(tries<MAX_TRIES)setTimeout(enforceSchoolRole,250);
      else finished=true;
    }finally{
      running=false;
    }
  }

  // The first check handles normal navigation; retries cover hard refreshes
  // where /api/me and /api/students are still in flight.
  setTimeout(enforceSchoolRole,100);
  window.addEventListener("pageshow",()=>{if(!finished)setTimeout(enforceSchoolRole,50)});
})();
