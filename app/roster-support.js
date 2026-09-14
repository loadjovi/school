(()=>{
  try{
    if(typeof instruments!=="undefined"&&!instruments.includes("待確認"))instruments.push("待確認");
  }catch(e){console.warn("roster support init failed",e)}
})();
