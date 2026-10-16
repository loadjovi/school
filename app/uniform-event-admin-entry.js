(()=>{
  const marker="data-uniform-event-admin-link";
  function addLink(html){
    if(typeof html!=="string"||html.includes(marker))return html;
    const panel='<section '+marker+' class="card"><h2>🎽 團服與活動管理</h2><p>一般團服、A 團比賽服、校外教學與期末聚餐設定及管理。</p><a href="/uniform-event-admin.html">開啟團服與活動管理後台 →</a></section>';
    return panel+html;
  }
  let current=null;
  function attach(){
    if(typeof state==="undefined"||state.me?.role!=="admin"||typeof adminPage!=="function")return;
    if(adminPage===current)return;
    const original=adminPage;
    const wrapped=function(...args){return addLink(original.apply(this,args))};
    current=wrapped;
    adminPage=wrapped;
    if(typeof render==="function"&&["admin","students","scores"].includes(state.page))render();
  }
  // Other admin modules wrap adminPage asynchronously. Reattach only if its function reference changes.
  const watcher=setInterval(attach,350);
  setTimeout(()=>clearInterval(watcher),30000);
  attach();
})();