(()=>{
  const area=document.getElementById("protectedAdminArea");if(!area)return;
  const section=document.createElement("details");section.className="inline-finance";section.id="paymentEmailNotifications";
  section.innerHTML='<summary id="paymentEmailHeading">📧 匯款通知｜讀取中…</summary><p>每筆團服申請會顯示家長的通知紀錄、最後寄送時間與次數。已回報匯款或已核帳者不催繳。</p><p id="paymentEmailSummary" role="status">等待管理員登入驗證…</p><button type="button" id="paymentEmailRefresh">更新通知紀錄</button> <button type="button" id="paymentEmailSend">補寄尚未通知／失敗的提醒</button><p>財務通知在新增應繳款項及家長回報匯款後寄送，僅寄給本校有效財務後台帳號；已核帳不再提醒。此處統計全部團服與活動通知；個別家長請查看下方申請紀錄。「已通知」表示寄信服務已接受，不代表家長已閱讀。無紀錄的舊通知不推定為已寄送。</p>';
  area.prepend(section);
  const summary=section.querySelector('#paymentEmailSummary'),sendButton=section.querySelector('#paymentEmailSend');let busy=false,refreshGeneration=0;
  const headers=()=>window.uniformEventAuthHeaders?.()||{};
  async function call(method="GET",body){
    const response=await fetch('/api/uniform-events/requests'+(method==="GET"?'?view=payment-notifications':''),{method,headers:{'Content-Type':'application/json',...headers()},credentials:'same-origin',cache:'no-store',...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||'通知狀態讀取失敗');return data;
  }
  function text(data){
    const counts=`已通知 ${Number(data.sent||0)+Number(data.alreadySent||0)} 筆｜待寄 ${data.remaining||0} 筆｜失敗 ${data.failed||0} 筆｜待查 ${data.unconfirmed||0} 筆`;
    const f=data.financeNotification;
    const finance=f?`；財務通知：已通知 ${Number(f.sent||0)+Number(f.alreadySent||0)} 筆｜待寄 ${f.remaining||0} 筆｜失敗 ${f.failed||0} 筆｜待查 ${f.unconfirmed||0} 筆${f.noFinanceRecipients?"｜找不到有效財務後台帳號，請確認權限設定":""}`:'';
    const missing=finance+(data.missingRecipients?'｜'+data.missingRecipients+' 筆找不到可收信的家長，請核對綁定。':'');
    if(data.status==='disabled')return 'LAB 不對外寄信；可驗證通知範圍。'+counts+missing;
    if(data.status==='not_configured')return '寄信服務尚未完成設定，目前未寄出通知。'+counts+missing;
    return counts+missing;
  }
  async function refresh(){
    const school=sessionStorage.getItem('school_context_id'),generation=++refreshGeneration;
    try{const data=await call();if(sessionStorage.getItem('school_context_id')!==school||generation!==refreshGeneration)return;
      if(!Array.isArray(data.uniformStates))throw Error(data.error||'通知明細未能讀取，請重試');
      summary.textContent=text(data);
      let history=section.querySelector('#financeEmailHistory');if(!history){history=document.createElement('div');history.id='financeEmailHistory';section.append(history)}
      history.replaceChildren();
      for(const row of (data.financeStates||[]).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0,30)){
        const p=document.createElement('p');const status={SENT:'已通知（寄信服務已接受）',FAILED:'寄送失敗',SENDING:'寄送中／待確認',UNCONFIRMED:'結果待確認',OBSOLETE:'狀態已變更，未寄送'}[row.status]||row.status;
        const time=row.updatedAt?new Date(row.updatedAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}):'';
        p.textContent=`財務：${row.recipient}｜${status}｜${time}｜${row.sourceId}`;history.append(p);
      }
      section.querySelector('#paymentEmailHeading').textContent='📧 匯款通知｜'+text(data);
      window.uniformPaymentEmailStates=Object.fromEntries(data.uniformStates.map(row=>[row.id,row]));
      window.dispatchEvent(new CustomEvent('paymentEmailStatesUpdated'));
    }catch(error){if(sessionStorage.getItem('school_context_id')!==school||generation!==refreshGeneration)return;summary.textContent=error.message;section.querySelector('#paymentEmailHeading').textContent='📧 匯款通知｜紀錄暫時無法讀取';window.uniformPaymentEmailStates={};window.dispatchEvent(new CustomEvent('paymentEmailStatesUpdated'))}
  }
  window.refreshPaymentEmailStatus=refresh;
  window.paymentEmailSummaryText=text;
  window.finishPaymentNotificationBatches=async function(initial){
    let current=initial,totalSent=Number(initial.sent||0),school=sessionStorage.getItem('school_context_id');
    try{
      for(let i=0;(current.remaining>0||current.financeNotification?.remaining>0)&&i<100&&!['disabled','not_configured','failed'].includes(current.status);i++){
        if(sessionStorage.getItem('school_context_id')!==school)throw Error('學校情境已切換，停止寄送');
        summary.textContent='正在寄送匯款通知…'+text({...current,sent:totalSent});
        current=await call('PATCH',{action:'SEND_PAYMENT_NOTICES',scope:initial.scope||{kind:'all'}});totalSent+=Number(current.sent||0);
      }
      const result={...current,sent:totalSent,alreadySent:Math.max(0,Number(current.alreadySent||0)-(totalSent-Number(current.sent||0)))};
      summary.textContent=text(result);await refresh();return result;
    }catch(error){const result={...current,status:'partial',sent:totalSent,failed:Number(current.failed||0)+1};summary.textContent='部分通知未確認，請重新讀取通知狀態。'+text(result);return result}
  };
  section.querySelector('#paymentEmailRefresh').addEventListener('click',refresh);
  sendButton.addEventListener('click',async()=>{
    if(busy)return;busy=true;sendButton.disabled=true;summary.textContent='正在核對尚未通知的款項…';
    try{await window.finishPaymentNotificationBatches(await call('PATCH',{action:'SEND_PAYMENT_NOTICES',retryFailed:true}))}
    catch(error){summary.textContent='寄送未完成：'+error.message}
    finally{busy=false;sendButton.disabled=false;await refresh()}
  });
  window.addEventListener('uniformAdminAuth',event=>{if(event.detail?.authenticated)refresh()});
  window.addEventListener('uniformRequestsLoaded',refresh);
  window.addEventListener('focus',()=>{if(sessionStorage.getItem('role_context')==='schoolAdmin')refresh()});
  setInterval(()=>{if(!document.hidden&&sessionStorage.getItem('role_context')==='schoolAdmin')refresh()},60000);
  if(sessionStorage.getItem('role_context')==='schoolAdmin')refresh();
})();
