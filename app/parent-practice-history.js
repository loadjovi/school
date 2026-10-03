(()=>{
  const basePracticePage=practicePage;
  const baseRecordPage=recordPage;
  let pendingKey="";
  state.parentPreviousPractice=null;

  function previousMonth(){
    const current=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit"}).format(new Date());
    const [year,month]=current.split("-").map(Number);
    return new Date(Date.UTC(year,month-2,1)).toISOString().slice(0,7);
  }
  function historyKey(){return `${String(state.student?.studentId||"")}|${previousMonth()}`}
  async function loadPreviousPractice(studentId,month,key){
    try{
      const data=await api(`/api/practice?studentId=${encodeURIComponent(studentId)}&month=${encodeURIComponent(month)}`);
      if(state.me?.role==="parent"&&historyKey()===key){
        state.parentPreviousPractice={key,items:data.items||[],qualifiedMinutes:Number(data.qualifiedMinutes||20),error:""};
      }
    }catch(error){
      if(state.me?.role==="parent"&&historyKey()===key){
        state.parentPreviousPractice={key,items:[],qualifiedMinutes:20,error:error.message||"讀取失敗"};
      }
    }finally{
      if(pendingKey===key)pendingKey="";
      if(state.me?.role==="parent"&&historyKey()===key&&["practice","record"].includes(state.page))render();
    }
  }
  function scheduleLoad(key,studentId,month){
    if(pendingKey===key)return;
    pendingKey=key;
    setTimeout(()=>loadPreviousPractice(studentId,month,key),0);
  }
  window.refreshParentPreviousPractice=function(){
    if(state.me?.role!=="parent"||!state.student?.studentId)return;
    state.parentPreviousPractice=null;
    const month=previousMonth(),studentId=String(state.student.studentId),key=historyKey();
    scheduleLoad(key,studentId,month);
    render();
  };
  function historyCard(){
    if(state.me?.role!=="parent"||!state.student?.studentId)return "";
    const month=previousMonth(),studentId=String(state.student.studentId),key=historyKey();
    const d=state.parentPreviousPractice?.key===key?state.parentPreviousPractice:null;
    if(!d&&pendingKey!==key)scheduleLoad(key,studentId,month);
    const title=`${Number(month.slice(0,4))} 年 ${Number(month.slice(5))} 月`;
    const trial=month.endsWith("-09")?"9 月為測試期，紀錄可查閱，但不列入正式 10% 成績。":"單日練習累計達 20 分鐘，計為 1 個有效練習日。";
    const rows=d?.items||[],days=new Set(rows.filter(x=>x.qualified).map(x=>String(x.practiceDate||"")).filter(Boolean));
    const total=rows.reduce((sum,x)=>sum+Number(x.minutes||0),0);
    const content=!d?`<div class="notice">正在讀取上個月的練習紀錄…</div>`
      :d.error?`<div class="notice">上月紀錄暫時無法讀取：${esc(d.error)}。請按「更新」。</div>`
      :!rows.length?`<div class="notice">${esc(state.student.name||"孩子")}在 ${esc(title)}尚無自主練習紀錄。</div>`
      :`<div class="notice" style="margin-bottom:10px">共 ${rows.length} 筆｜${total} 分鐘｜達標 ${days.size} 天</div>${rows.map(x=>`<div class="item" style="align-items:flex-start"><div style="min-width:0;flex:1"><b>${esc(x.practiceDate)}｜${esc(x.practiceContent||"自主練習")}</b><small>${esc(x.startTime||"")}～${esc(x.endTime||"")}｜本次 ${Number(x.minutes||0)} 分鐘｜當日累計 ${Number(x.dailyMinutes||x.minutes||0)} 分鐘</small>${x.focus?`<small>練習重點：${esc(x.focus)}</small>`:""}</div><span class="badge ${x.qualified?"ok":"warn"}">${x.qualified?"當日達標":"當日未達"}</span></div>`).join("")}`;
    return `<section class="card parent-previous-practice"><div class="section-title"><h2>📅 上月自主練習｜${esc(title)}</h2><button class="secondary" type="button" style="width:auto;margin:0;padding:7px 10px" onclick="refreshParentPreviousPractice()">更新</button></div><div class="muted" style="margin-bottom:10px">${esc(state.student.name||"孩子")}的逐筆練習紀錄。${trial}</div>${content}</section>`;
  }
  practicePage=function(){return basePracticePage()+historyCard()};
  recordPage=function(){return historyCard()+baseRecordPage()};
  const baseSavePractice=savePractice;
  savePractice=async function(){
    const saved=await baseSavePractice();
    if(saved){state.parentPreviousPractice=null;render()}
    return saved;
  };
})();
