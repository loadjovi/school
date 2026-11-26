(()=>{
  const status=document.getElementById("loginResetStatus"),retry=document.getElementById("loginResetRetry");
  if(!status||!retry)return;
  const query=new URLSearchParams(location.search),schools=query.getAll("schoolId");
  const schoolId=schools.length===1&&schools[0].length>=2&&schools[0].length<=60&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(schools[0])?schools[0]:"";
  const target=new URL("/",location.origin);
  if(schoolId)target.searchParams.set("schoolId",schoolId);
  let busy=false,navigating=false;
  async function restart(){
    if(busy||navigating)return;
    busy=true;retry.hidden=true;retry.disabled=true;
    status.textContent="正在清除舊登入，請稍候…";
    try{
      for(const key of ["google_id_token","school_context_id","role_context","teacher_line_account_return","parent_line_account_return","line_staff_entry"])sessionStorage.removeItem(key);
      const responses=await Promise.allSettled(["/api/google-logout","/api/line/session/logout"].map(url=>fetch(url,{method:"POST",credentials:"same-origin",cache:"no-store"})));
      if(responses.some(response=>response.status!=="fulfilled"||!response.value.ok&&response.value.status!==204))throw Error("logout_unconfirmed");
      navigating=true;
      status.textContent="已清除舊登入，正在開啟登入頁…";
      location.replace(target.pathname+target.search);
    }catch{
      navigating=false;
      status.textContent="舊登入尚未清除完成，請確認網路後按「重新嘗試」。已完成的帳號綁定會保留。";
      retry.hidden=false;retry.disabled=false;
    }finally{busy=false}
  }
  retry.onclick=restart;
  void restart();
})();
