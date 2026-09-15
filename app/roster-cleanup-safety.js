(()=>{
  let tries=0;
  const timer=setInterval(()=>{
    tries++;
    if(typeof window.api!=="function"){
      if(tries>400)clearInterval(timer);
      return;
    }
    clearInterval(timer);
    const baseApi=window.api;
    window.api=async function(path,options={}){
      if(path==="/api/student-roster-replace-cleanup"&&options?.body&&state?.rosterPreview?.items?.length){
        try{
          const body=JSON.parse(options.body);
          const keepStudentNos=[...new Set((state.rosterPreview.items||[])
            .map(x=>String(x.studentNo||x.studentId||"").trim().replace(/\.0$/, ""))
            .filter(x=>/^\d{6}$/.test(x)))];
          if(keepStudentNos.length)options={...options,body:JSON.stringify({...body,keepStudentNos})};
        }catch{}
      }
      return baseApi(path,options);
    };
  },50);
})();
