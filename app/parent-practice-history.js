(()=>{
  const basePracticePage=practicePage;
  const baseRecordPage=recordPage;
  let pending=null,requestId=0;
  state.parentPreviousPractice=null;
  state.parentPreviousPracticeExpandedKey="";
  state.parentPracticeRefreshing=false;

  function previousMonth(){
    const current=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit"}).format(new Date());
    const [year,month]=current.split("-").map(Number);
    return new Date(Date.UTC(year,month-2,1)).toISOString().slice(0,7);
  }
  function historyKey(){return `${String(state.student?.studentId||"")}|${previousMonth()}`}
  async function loadPreviousPractice(studentId,month,key,id){
    try{
      const data=await api(`/api/practice?studentId=${encodeURIComponent(studentId)}&month=${encodeURIComponent(month)}`);
      if(id===requestId&&state.me?.role==="parent"&&historyKey()===key){
        state.parentPreviousPractice={key,items:data.items||[],qualifiedMinutes:Number(data.qualifiedMinutes||20),error:""};
      }
    }catch(error){
      if(id===requestId&&state.me?.role==="parent"&&historyKey()===key){
        state.parentPreviousPractice={key,items:[],qualifiedMinutes:20,error:error.message||"讀取失敗"};
      }
    }finally{
      if(pending?.id===id)pending=null;
      if(id===requestId&&state.me?.role==="parent"&&historyKey()===key&&["practice","record"].includes(state.page))render();
    }
  }
  function scheduleLoad(key,studentId,month,immediate=false){
    if(pending?.key===key&&!immediate)return;
    const id=++requestId;
    pending={key,id};
    if(immediate)return loadPreviousPractice(studentId,month,key,id);
    setTimeout(()=>loadPreviousPractice(studentId,month,key,id),0);
  }
  window.setParentPracticeHistoryOpen=function(open){
    state.parentPreviousPracticeExpandedKey=open?historyKey():"";
  };
  window.refreshParentPracticeHistory=async function(){
    if(state.me?.role!=="parent"||!state.student?.studentId||state.parentPracticeRefreshing)return;
    state.parentPracticeRefreshing=true;
    const studentId=String(state.student.studentId);
    render();
    try{
      await refreshStudent();
      if(String(state.student?.studentId)!==studentId)return;
      state.parentPreviousPractice=null;
      const key=historyKey();
      await scheduleLoad(key,studentId,previousMonth(),true);
      if(state.parentPreviousPractice?.key===key){
        toast(state.parentPreviousPractice.error?"❌ 上月紀錄讀取失敗，請稍後再試":"✅ 練習紀錄已更新");
      }
    }catch(error){toast("❌ 更新練習紀錄失敗："+(error.message||error))}
    finally{state.parentPracticeRefreshing=false;render()}
  };
  function historyCard(){
    if(state.me?.role!=="parent"||!state.student?.studentId)return "";
    const month=previousMonth(),studentId=String(state.student.studentId),key=historyKey();
    const d=state.parentPreviousPractice?.key===key?state.parentPreviousPractice:null;
    if(!d&&pending?.key!==key)scheduleLoad(key,studentId,month);
    const title=`${Number(month.slice(0,4))} 年 ${Number(month.slice(5))} 月`;
    const trial=month.endsWith("-09")?"9 月為測試期，紀錄可查閱，但不列入正式 10% 成績。":"單日練習累計達 20 分鐘，計為 1 個有效練習日。";
    const rows=d?.items||[],days=new Set(rows.filter(x=>x.qualified).map(x=>String(x.practiceDate||"")).filter(Boolean));
    const total=rows.reduce((sum,x)=>sum+Number(x.minutes||0),0);
    const content=!d?`<div class="notice">正在讀取上個月的練習紀錄…</div>`
      :d.error?`<div class="notice">上月紀錄暫時無法讀取：${esc(d.error)}。可到「自主打卡」的「最近練習」按更新。</div>`
      :!rows.length?`<div class="notice">${esc(state.student.name||"孩子")}在 ${esc(title)}尚無自主練習紀錄。</div>`
      :rows.map(x=>`<div class="item" style="align-items:flex-start"><div style="min-width:0;flex:1"><b>${esc(x.practiceDate)}｜${esc(x.practiceContent||"自主練習")}</b><small>${esc(x.startTime||"")}～${esc(x.endTime||"")}｜本次 ${Number(x.minutes||0)} 分鐘｜當日累計 ${Number(x.dailyMinutes||x.minutes||0)} 分鐘</small>${x.focus?`<small>練習重點：${esc(x.focus)}</small>`:""}</div><span class="badge ${x.qualified?"ok":"warn"}">${x.qualified?"當日達標":"當日未達"}</span></div>`).join("");
    const summary=!d?"正在讀取紀錄…":d.error?"讀取失敗，請更新":rows.length?`${rows.length} 筆｜${total} 分鐘｜達標 ${days.size} 天`:"尚無練習紀錄";
    return `<section class="card parent-previous-practice"><details ${state.parentPreviousPracticeExpandedKey===key?"open":""}><summary onclick="setParentPracticeHistoryOpen(!this.parentElement.open)"><span><b>📅 上月自主練習｜${esc(title)}</b><small>${esc(summary)}</small></span></summary><div class="parent-previous-practice-body"><div class="muted" style="margin-bottom:10px">${esc(state.student.name||"孩子")}的逐筆練習紀錄。${trial}</div>${content}</div></details></section>`;
  }
  practicePage=function(){
    const button=`<button class="secondary" type="button" onclick="refreshParentPracticeHistory()" ${state.parentPracticeRefreshing?"disabled":""}>${state.parentPracticeRefreshing?"更新中…":"更新"}</button>`;
    return basePracticePage().replace("<h2>最近練習</h2>",`<div class="section-title parent-recent-title"><h2>最近練習</h2>${button}</div>`)+historyCard();
  };
  recordPage=function(){return historyCard()+baseRecordPage()};
  const baseSavePractice=savePractice;
  savePractice=async function(){
    const saved=await baseSavePractice();
    if(saved){state.parentPreviousPractice=null;render()}
    return saved;
  };
})();
