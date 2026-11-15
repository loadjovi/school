(()=>{
  function mountFeeCollectionEntry(){
    if(typeof state==="undefined"||!state.me)return;
    const existing=document.getElementById("feeCollectionEntry"),role=String(state.me.role||""),visible=role==="admin"&&state.page==="admin"||role==="parent"&&["home","uniformEvents"].includes(state.page);
    if(!visible){existing?.remove();return}
    const main=document.querySelector(".main");if(!main)return;
    const card=existing||document.createElement("section");card.id="feeCollectionEntry";card.className="card";
    card.style.border="2px solid var(--tenant-primary, #245c48)";
    card.innerHTML=role==="admin"
      ?`<h2>💰 收費專案與匯款核帳</h2><div class="notice"><b>第一階段已整合：</b>團 T、期末聚餐共用收費專案，並直接同步既有訂單付款狀態。</div><button class="primary" style="width:100%" onclick="location.href='/fee-collections.html'">前往收費專案／財務核帳 →</button>`
      :`<h2>🔔 LINE 通知與家長服務</h2><div class="notice">先綁定個人 LINE，方便後續接收弦樂團課程、活動與重要提醒；若有團 T 或期末餐費，也可在此查看繳費與核帳進度。</div><button class="primary" style="width:100%" onclick="location.href='/fee-collections.html'">開啟 LINE 通知／費用資訊 →</button>`;
    if(!existing)main.prepend(card);
  }
  const originalRender=render;
  render=function(){const result=originalRender();setTimeout(mountFeeCollectionEntry,0);return result};
  setTimeout(mountFeeCollectionEntry,0);
})();
