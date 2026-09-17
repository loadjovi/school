(()=>{
  function updateDailySummary(){
    if(state.me?.role!=="admin"||state.page!=="admin")return;
    const d=state.adminOps?.followup;
    const root=document.getElementById("adminOperations");
    if(!d||!root)return;

    const courses=d.courseSummary||[];
    const scheduled=courses.filter(x=>Number(x.expected||0)>0);
    const totalCourses=scheduled.length;
    const completedCourses=scheduled.filter(x=>Number(x.recorded||0)>=Number(x.expected||0)).length;
    const pendingCourses=Math.max(0,totalCourses-completedCourses);
    const allCompleted=totalCourses>0&&pendingCourses===0;
    const counts=d.counts||{};
    const attendance=d.attendanceCounts||{};

    const title=[...root.querySelectorAll("h2")].find(x=>x.textContent.includes("當日未到／請假追蹤"));
    const card=title?.closest(".card");
    const grid=card?.querySelector(".grid");
    if(!grid)return;

    let html;
    if(allCompleted){
      const expected=scheduled.reduce((n,x)=>n+Number(x.expected||0),0);
      const attended=scheduled.reduce((n,x)=>n+Number(x.attended||0),0);
      const late=scheduled.reduce((n,x)=>n+Number(x.late||0),0);
      const leave=scheduled.reduce((n,x)=>n+Number(x.leave||0),0);
      const absent=scheduled.reduce((n,x)=>n+Number(x.absent||0),0);
      html=`<div class="kpi"><b>${attended} / ${expected}</b><span>今日出席</span></div><div class="kpi"><b>${late}</b><span>遲到</span></div><div class="kpi"><b>${leave}</b><span>請假</span></div><div class="kpi"><b>${absent}</b><span>缺席</span></div>`;
    }else{
      html=`<div class="kpi"><b>${totalCourses}</b><span>今日課程</span></div><div class="kpi"><b>${completedCourses}</b><span>已完成點名</span></div><div class="kpi"><b>${pendingCourses}</b><span>尚未點名</span></div><div class="kpi"><b>${counts.total||0}</b><span>缺席待追蹤</span></div>`;
    }
    if(grid.innerHTML!==html)grid.innerHTML=html;

    const notices=[...card.querySelectorAll(".notice")];
    const ruleNotice=notices.find(x=>x.textContent.includes("應到依當日課表"));
    if(ruleNotice){
      const text=allCompleted
        ?"今日所有應點名課程皆已完成；出席＝出席＋遲到。請假與缺席依老師完成的點名紀錄彙整。"
        :"今日尚有課程未完成點名，因此暫不計算整日出席率，避免將「尚未點名」誤判為「未到」。待所有應點名課程完成後，才顯示今日出席、遲到、請假與缺席統計。";
      if(ruleNotice.textContent!==text)ruleNotice.textContent=text;
    }
  }

  let queued=false;
  const queueUpdate=()=>{
    if(queued)return;
    queued=true;
    requestAnimationFrame(()=>{queued=false;updateDailySummary()});
  };

  const observer=new MutationObserver(queueUpdate);
  observer.observe(document.body,{childList:true,subtree:true});
  window.addEventListener("load",queueUpdate);
  setTimeout(queueUpdate,0);
})();
