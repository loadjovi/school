(()=>{
  "use strict";
  const baseHome=home,baseGo=go,model=window.uniformPaymentState;
  let context="",items=null,loading=false,loadedAt=0,error="",generation=0;
  const parent=()=>state.me?.role==="parent";
  const scope=()=>parent()?[String(state.me.email||""),sessionStorage.getItem("school_context_id")||state.me.schoolId||""].join("|"):"";
  function syncScope(){
    const next=scope();if(next===context)return;
    context=next;items=null;loading=false;loadedAt=0;error="";generation++;
  }
  async function load(){
    syncScope();if(!parent()||loading)return;
    const current=context,version=++generation;loading=true;loadedAt=Date.now();
    try{
      const data=await api("/api/uniform-events/requests");
      if(!Array.isArray(data.items))throw Error("付款資料格式不完整");
      if(scope()!==current||generation!==version)return;
      items=data.items;error="";
    }catch(cause){
      if(scope()!==current||generation!==version)return;
      items=null;error="暫時無法讀取團服付款狀態，請重新讀取。";
    }finally{
      if(scope()===current&&generation===version){loading=false;loadedAt=Date.now();if(state.page==="home"&&parent())render()}
    }
  }
  window.refreshParentUniformPayments=()=>{syncScope();return load()};
  function invalidate(){items=null;loadedAt=0;error="";generation++;loading=false}
  window.openParentUniformPayment=function(id){
    if(!parent()||!items?.some(item=>String(item.id)===id&&(model.due(item)||model.reported(item))))return;
    if(!/^[a-f0-9-]{36}$/i.test(id))return;
    state.parentUniformFocus="payment:"+id;return go("uniformEvents");
  };
  function row(item,pending){
    const student=(state.students||state.me?.students||[]).find(s=>String(s.studentId)===String(item.studentId));
    const name=student?.name||student?.studentName||item.studentName||"學生 "+item.studentId;
    const label=item.kind==="regularUniform"?"團 T":"A 團比賽服";
    const id=/^[a-f0-9-]{36}$/i.test(String(item.id))?String(item.id):"";
    return `<div class="parent-payment-row"><strong>${esc(name)}｜${label}</strong><span>尺寸：${esc(item.size||"待確認")}｜${Number(item.quantity||1)} 件｜${pending?"本筆金額":"應繳金額"}：<b>NT$ ${item.amount.toLocaleString("zh-TW")}</b></span><button type="button" class="${pending?"secondary":"primary"}" ${id?"":"disabled"} onclick="openParentUniformPayment('${id}')">${pending?"查看核帳進度":"查看匯款帳戶／回報末五碼"} ›</button></div>`;
  }
  function panel(){
    if(error)return `<section class="card parent-payment-notice" role="status"><h2>團服付款提醒暫時無法讀取</h2><p>${error}</p><button type="button" class="secondary" onclick="refreshParentUniformPayments()">重新讀取付款狀態</button></section>`;
    if(items===null)return `<div class="notice parent-payment-loading" role="status">正在確認團服付款進度…</div>`;
    const alerts=model.alerts(items),content=[];
    if(alerts.due.length){
      const onlyTshirts=alerts.due.every(item=>item.kind==="regularUniform");
      content.push(`<section class="card parent-payment-notice is-due" role="status" aria-labelledby="parent-payment-title"><div class="parent-payment-heading"><h2 id="parent-payment-title">🔔 ${onlyTshirts?"團 T ":"團服"}已核准，請完成匯款</h2><button type="button" class="secondary" onclick="refreshParentUniformPayments()" ${loading?"disabled":""}>更新</button></div><p>有 <b>${alerts.due.length} 筆待匯款</b>。請先匯款，再填寫匯款日期與<strong>轉出帳號末五碼</strong>送出。</p>${alerts.due.map(item=>row(item,false)).join("")}</section>`);
    }
    if(alerts.reported.length)content.push(`<section class="card parent-payment-notice is-reported" role="status"><div class="parent-payment-heading"><h2>🕒 團服匯款已回報，待財務核帳</h2><button type="button" class="secondary" onclick="refreshParentUniformPayments()" ${loading?"disabled":""}>更新</button></div><p>${alerts.reported.length} 筆匯款資料已送出。請等待學校確認入帳，<strong>無須重複匯款</strong>。</p>${alerts.reported.map(item=>row(item,true)).join("")}</section>`);
    return content.join("");
  }
  home=function(){
    syncScope();if(!parent()||!state.student)return baseHome();
    if(!loading&&Date.now()-loadedAt>60000){loadedAt=Date.now();setTimeout(load,0)}
    const notices=panel();return (notices?notices+"<!-- parent-payment-notices-end -->":"")+baseHome();
  };
  go=async function(page){
    if(page==="home")invalidate();
    return baseGo(page);
  };
  window.addEventListener("message",event=>{
    const frame=document.getElementById("parentUniformFrame");
    if(!parent()||event.origin!==location.origin||!frame||event.source!==frame.contentWindow)return;
    if(event.data?.type==="parent-uniform-requests-updated"){invalidate();load()}
    if(event.data?.type==="parent-uniform-payment-focus"){
      const id=String(event.data.requestId||"");
      if(state.parentUniformFocus!=="payment:"+id||!/^[a-f0-9-]{36}$/i.test(id))return;
      const target=frame.contentDocument?.getElementById("uniform-payment-"+id);if(!target)return;
      const header=document.querySelector("header.top"),gap=(header?.getBoundingClientRect().bottom||0)+16;
      window.scrollTo({top:Math.max(0,window.scrollY+frame.getBoundingClientRect().top+target.getBoundingClientRect().top-gap),behavior:"smooth"});
      state.parentUniformFocus="";
    }
  });
  function refreshVisible(){if(parent()&&state.page==="home"&&!document.hidden&&Date.now()-loadedAt>5000)load()}
  window.addEventListener("focus",refreshVisible);
  window.addEventListener("pageshow",refreshVisible);
  document.addEventListener("visibilitychange",refreshVisible);
  setInterval(()=>{if(parent()&&state.page==="home"&&!document.hidden&&Date.now()-loadedAt>60000)load()},60000);
  const style=document.createElement("style");style.id="parent-uniform-payment-notice-style";
  style.textContent=`.parent-payment-notice{border:2px solid #bd6c19;overflow-wrap:anywhere;min-width:0}.parent-payment-notice.is-due{background:#fff7e6;box-shadow:0 3px 14px #ad6b1720}.parent-payment-notice.is-reported{background:#eef6ff;border-color:#4773a0}.parent-payment-heading{display:flex;justify-content:space-between;align-items:start;gap:10px}.parent-payment-heading h2{margin:0;font-size:20px;line-height:1.5;min-width:0}.parent-payment-heading>button{flex:none;min-height:44px}.parent-payment-notice p{line-height:1.7}.parent-payment-row{display:grid;gap:8px;padding:14px 0;border-top:1px solid #d8bc8d;min-width:0}.parent-payment-row>span{line-height:1.65}.parent-payment-row>button{width:100%;max-width:100%;min-height:46px;white-space:normal;line-height:1.5;box-sizing:border-box}.parent-payment-loading{margin-bottom:12px}@media(max-width:500px){.parent-payment-heading h2{font-size:18px}.parent-payment-notice{padding:16px}}`;
  document.head.append(style);
})();
