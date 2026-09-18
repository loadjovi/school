(()=>{
  const TIMER_KEY="orchestra_practice_timers_v3";
  const MAX_SECONDS=60*60;
  let intervalId=null;

  function pad(n){return String(n).padStart(2,"0")}
  function localDate(d=new Date()){return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`}
  function localTime(d=new Date()){return `${pad(d.getHours())}:${pad(d.getMinutes())}`}
  function readTimer(){try{return JSON.parse(localStorage.getItem(TIMER_KEY)||"null")}catch{return null}}
  function writeTimer(v){if(v)localStorage.setItem(TIMER_KEY,JSON.stringify(v));else localStorage.removeItem(TIMER_KEY)}
  function elapsedSeconds(t){if(!t?.startedAt)return 0;const base=Math.max(0,Number(t.accumulatedSeconds||0)),live=t.runningSince?Math.max(0,Math.floor((Date.now()-Number(t.runningSince))/1000)):0;return Math.min(MAX_SECONDS,base+live)}
  function enforceMax(t){if(!t?.runningSince)return t;const base=Math.max(0,Number(t.accumulatedSeconds||0)),live=Math.max(0,Math.floor((Date.now()-Number(t.runningSince))/1000));if(base+live<MAX_SECONDS)return t;t.accumulatedSeconds=MAX_SECONDS;t.runningSince=null;t.lastPausedAt=Date.now();t.autoStopped=true;writeTimer(t);return t}
  function durationText(sec){const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;return `${pad(h)}:${pad(m)}:${pad(s)}`}
  function timerIsRunning(){return !!readTimer()?.runningSince}
  function mode(){return document.querySelector('input[name="practiceMode"]:checked')?.value||"timer"}

  function achievement(minutes){
    const m=Number(minutes||0);
    if(m>=15)return {cls:"ok",text:"🟢 今日練習達標"};
    const left=Math.max(0,15-m);
    return {cls:"warn",text:`🟡 再練 ${left} 分鐘即可達標`};
  }
  function updateAchievement(){
    const mins=Number(document.getElementById("pMins")?.textContent||0),q=document.getElementById("pQual");
    if(!q)return;const a=achievement(mins);q.className=`badge ${a.cls}`;q.textContent=a.text;
  }
  function setMode(v){
    const manual=document.getElementById("practiceManualTimes"),timer=document.getElementById("practiceTimerControls");
    if(manual)manual.style.display=v==="manual"?"grid":"none";
    if(timer)timer.style.display=v==="timer"?"":"none";
    if(v==="timer"){
      const t=readTimer();
      if(t?.startedAt){
        const s=document.getElementById("pStart"),e=document.getElementById("pEnd"),d=document.getElementById("pDate");
        if(d)d.value=t.practiceDate||localDate(new Date(Number(t.startedAt)));
        if(s)s.value=localTime(new Date(Number(t.startedAt)));
        if(e)e.value=localTime(new Date(t.lastPausedAt||Date.now()));
        if(typeof updateMinutes==="function")updateMinutes();
      }
    }
    updateAchievement();
  }
  window.setPracticeMode=setMode;

  function refreshTimerUi(){
    const box=document.getElementById("practiceTimerValue");if(!box)return;
    let t=enforceMax(readTimer());const running=!!t?.runningSince;
    box.textContent=durationText(elapsedSeconds(t));
    const status=document.getElementById("practiceTimerStatus");
    if(status)status.textContent=t?.autoStopped?"⏱️ 已達 60 分鐘上限，系統已自動停止":running?"🎻 練習計時中，可切換頁面、App 或鎖定畫面":t?.startedAt?"⏸️ 已暫停，可稍後繼續練習":"按「開始練習」後會自動記錄時間";
    const start=document.getElementById("practiceTimerStart"),stop=document.getElementById("practiceTimerStop");
    if(start){start.disabled=running||elapsedSeconds(t)>=MAX_SECONDS;start.textContent=running?"▶️ 練習進行中":elapsedSeconds(t)>=MAX_SECONDS?"已達 60 分鐘上限":t?.startedAt?"▶️ 繼續練習":"▶️ 開始練習"}
    if(stop)stop.disabled=!running;
    if(running&&t){
      const e=document.getElementById("pEnd");if(e)e.value=localTime(new Date());
      if(typeof updateMinutes==="function")updateMinutes();
    }
    updateAchievement();
  }
  function ensureTicker(){
    if(intervalId)clearInterval(intervalId);
    intervalId=setInterval(()=>{if(!timerIsRunning()){clearInterval(intervalId);intervalId=null;return}refreshTimerUi()},1000);
  }
  window.startPracticeTimer=function(){
    if(timerIsRunning()){toast("計時器已在進行中");return}
    const now=new Date(),existing=enforceMax(readTimer());
    if(elapsedSeconds(existing)>=MAX_SECONDS){toast("本次練習已達 60 分鐘上限，請完成並送出紀錄");return}
    const t=existing?.startedAt
      ?{...existing,runningSince:Date.now(),lastPausedAt:null,autoStopped:false}
      :{startedAt:Date.now(),runningSince:Date.now(),lastPausedAt:null,accumulatedSeconds:0,studentId:String(state.student?.studentId||""),practiceDate:localDate(now)};
    writeTimer(t);
    const d=document.getElementById("pDate"),s=document.getElementById("pStart"),e=document.getElementById("pEnd");
    if(d)d.value=t.practiceDate;if(s)s.value=localTime(new Date(Number(t.startedAt)));if(e)e.value=localTime(now);
    refreshTimerUi();ensureTicker();toast(existing?.startedAt?"▶️ 已繼續自主練習計時":"▶️ 已開始自主練習計時");
  };
  window.stopPracticeTimer=function(){
    const t=readTimer();if(!t?.runningSince){toast("目前沒有進行中的計時");return}
    const now=Date.now();
    t.accumulatedSeconds=Math.min(MAX_SECONDS,Math.max(0,Number(t.accumulatedSeconds||0))+Math.max(0,Math.floor((now-Number(t.runningSince))/1000)));
    t.runningSince=null;t.lastPausedAt=now;writeTimer(t);
    const e=document.getElementById("pEnd");if(e)e.value=localTime(new Date(now));
    refreshTimerUi();if(typeof updateMinutes==="function")updateMinutes();updateAchievement();
    toast(`⏸️ 已暫停，目前累計 ${Math.max(1,Math.round(elapsedSeconds(t)/60))} 分鐘`);
  };
  window.finishPracticeTimer=function(){
    let t=enforceMax(readTimer());if(!t?.startedAt){toast("目前沒有可完成的計時紀錄");return}
    if(t.runningSince){const now=Date.now();t.accumulatedSeconds=Math.min(MAX_SECONDS,Math.max(0,Number(t.accumulatedSeconds||0))+Math.max(0,Math.floor((now-Number(t.runningSince))/1000)));t.runningSince=null;t.lastPausedAt=now;writeTimer(t)}
    const mins=Math.max(1,Math.ceil(elapsedSeconds(t)/60)),m=document.getElementById("pMins");if(m)m.textContent=mins;
    refreshTimerUi();updateAchievement();toast(`✅ 計時完成，共 ${mins} 分鐘，請確認內容後送出紀錄`);
  };
  window.resetPracticeTimer=function(){writeTimer(null);if(intervalId){clearInterval(intervalId);intervalId=null}refreshTimerUi();toast("已清除本次計時")};

  const originalUpdate=window.updateMinutes;
  if(typeof originalUpdate==="function")window.updateMinutes=function(){originalUpdate();updateAchievement()};

  const basePracticePage=practicePage;
  practicePage=function(){
    let html=basePracticePage(),t=enforceMax(readTimer()),running=!!t?.runningSince;
    html=html.replace('<div class="row2"><div><label>開始時間</label>','<div id="practiceManualTimes" class="row2" style="display:none"><div><label>開始時間</label>');
    html=html.replace('<label>練習內容／曲目</label>','<div style="margin-top:14px;font-weight:900">記錄方式</div><div class="row2" style="margin-top:8px"><label class="check" style="margin:0"><input type="radio" name="practiceMode" value="timer" checked onchange="setPracticeMode(\'timer\')"><div>⏱️ 即時計時</div></label><label class="check" style="margin:0"><input type="radio" name="practiceMode" value="manual" onchange="setPracticeMode(\'manual\')"><div>✏️ 手動登記</div></label></div><label>今天練什麼？</label>');
    html=html.replace('<label>練習重點</label>','<label>練習類型</label>');
    html=html.replace('家長確認：我確認學生已完成上述自主練習。','我確認本次練習紀錄正確。');
    html=html.replace('送出今天的打卡','完成並送出紀錄');
    html=html.replace('<h2>最近打卡</h2>','<h2>最近練習</h2>');

    const panel=`<div class="card"><h2>⏱️ 今天開始練習</h2>
      <div id="practiceTimerControls"><div style="text-align:center;padding:10px 0 12px"><div id="practiceTimerValue" style="font-size:36px;font-weight:900;letter-spacing:2px">${durationText(elapsedSeconds(t))}</div><div id="practiceTimerStatus" class="muted" style="margin-top:6px">${t?.autoStopped?"⏱️ 已達 60 分鐘上限，系統已自動停止":running?"🎻 練習計時中，可切換頁面、App 或鎖定畫面":t?.startedAt?"⏸️ 已暫停，可稍後繼續練習":"按「開始練習」後會自動記錄時間"}</div></div>
      <div class="row2"><button id="practiceTimerStart" class="primary" style="margin-top:0" onclick="startPracticeTimer()" ${running?"disabled":""}>${running?"▶️ 練習進行中":t?.startedAt?"▶️ 繼續練習":"▶️ 開始練習"}</button><button id="practiceTimerStop" class="secondary" style="margin-top:0" onclick="stopPracticeTimer()" ${running?"":"disabled"}>⏸️ 暫停</button></div>
      ${t?'<button class="primary" style="width:100%;margin-top:10px" onclick="finishPracticeTimer()">✅ 完成練習</button><button class="secondary" style="width:100%;margin-top:10px" onclick="resetPracticeTimer()">清除本次計時</button>':""}<div class="notice" style="margin-top:10px">單次練習計時最多 60 分鐘；達上限時系統會自動停止，避免忘記關閉造成時間異常。</div></div></div>`;
    const marker='<div class="card"><h2>自主練習打卡</h2>';
    const out=html.includes(marker)?html.replace(marker,panel+marker):panel+html;
    setTimeout(()=>{setMode("timer");refreshTimerUi();if(running)ensureTicker()},0);
    return out;
  };

  const baseSavePractice=savePractice;
  savePractice=async function(){
    if(mode()==="timer"&&timerIsRunning()){toast("請先停止計時，再送出紀錄");return}
    const confirmBox=document.getElementById("pConfirm");
    if(confirmBox&&!confirmBox.checked){toast("請先確認本次練習紀錄正確");return}
    await baseSavePractice();
    if(readTimer()?.startedAt&&!timerIsRunning())writeTimer(null);
  };

  const baseShell=typeof shell==="function"?shell:null;
  if(baseShell)shell=function(content){
    if(state.me?.role==="parent"&&state.student){
      const t=readTimer();
      if(t?.startedAt){
        const running=!!t.runningSince,mins=Math.floor(elapsedSeconds(t)/60);
        const banner=`<div class="card" style="margin-bottom:12px"><div class="student"><div><b>⏱️ ${esc(state.student.name)} 練習計時</b><div class="muted" style="margin-top:4px">${running?"計時中":"已暫停"}｜目前累計 ${mins} 分鐘</div></div><button class="secondary" style="margin-top:0" onclick="go('practice')">${running?"查看計時":"繼續練習"}</button></div></div>`;
        content=banner+content;
      }
    }
    return baseShell(content);
  };

  document.addEventListener("visibilitychange",()=>{if(!document.hidden&&timerIsRunning()){refreshTimerUi();ensureTicker()}});
  window.addEventListener("pageshow",()=>{if(timerIsRunning()){refreshTimerUi();ensureTicker()}});
})();