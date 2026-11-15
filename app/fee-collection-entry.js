(()=>{
  const isFunctionalLab=location.hostname==="icy-ocean-0a2602100.6.azurestaticapps.net";
  async function syncParentLineMenu(button,output){
    if(button.disabled)return;
    button.disabled=true;button.textContent="同步中…";output.textContent="";
    try{
      const result=await api("/api/line/lab-rich-menus/sync",{method:"POST"});
      output.textContent=result.audience==="parent"
        ?"✅ 已同步為家長選單，請關閉並重新開啟 LINE 聊天室。"
        :result.audience==="staff"
          ?"✅ 此帳號同時具備幹部權限，已同步為幹部選單。請關閉並重新開啟 LINE 聊天室。"
          :"目前尚未取得可指派的家長或幹部身分。";
    }catch(error){output.textContent=error.message||"LINE 選單同步失敗，請稍後再試。"}
    finally{button.disabled=false;button.textContent="重新同步我的 LINE 選單"}
  }
  function mountFeeCollectionEntry(){
    if(typeof state==="undefined"||!state.me)return;
    const existing=document.getElementById("feeCollectionEntry"),role=String(state.me.role||""),visible=role==="admin"&&state.page==="admin"||role==="parent"&&["home","uniformEvents"].includes(state.page);
    if(!visible){existing?.remove();return}
    const main=document.querySelector(".main");if(!main)return;
    const card=existing||document.createElement("section");card.id="feeCollectionEntry";card.className="card";
    card.style.border="2px solid var(--tenant-primary, #245c48)";
    card.innerHTML=role==="admin"
      ?`<h2>💰 收費專案與匯款核帳</h2><div class="notice"><b>第一階段已整合：</b>團 T、期末聚餐共用收費專案，並直接同步既有訂單付款狀態。</div><button class="primary" style="width:100%" onclick="location.href='/fee-collections.html'">前往收費專案／財務核帳 →</button>`
      :`<h2>🔔 LINE 通知與家長服務</h2><div class="notice">先綁定個人 LINE，方便後續接收弦樂團課程、活動與重要提醒；若有團 T 或期末餐費，也可在此查看繳費與核帳進度。</div><button class="primary" style="width:100%" onclick="location.href='/fee-collections.html'">開啟 LINE 通知／費用資訊 →</button>${isFunctionalLab?`<button type="button" class="secondary" style="width:100%;margin-top:10px" data-action="sync-parent-line-menu">重新同步我的 LINE 選單</button><div class="notice" data-role="line-menu-sync-result" style="margin-top:10px" aria-live="polite"></div>`:""}`;
    const syncButton=card.querySelector('[data-action="sync-parent-line-menu"]'),syncOutput=card.querySelector('[data-role="line-menu-sync-result"]');
    if(syncButton&&syncOutput)syncButton.addEventListener("click",()=>syncParentLineMenu(syncButton,syncOutput));
    if(!existing)main.prepend(card);
  }
  const originalRender=render;
  render=function(){const result=originalRender();setTimeout(mountFeeCollectionEntry,0);return result};
  setTimeout(mountFeeCollectionEntry,0);
})();
