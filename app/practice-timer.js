(()=>{
  const TIMER_KEY="orchestra_practice_timer_v1";
  let intervalId=null;

  function pad(n){return String(n).padStart(2,"0")}
  function localDate(d=new Date()){return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`}
  function localTime(d=new Date()){return `${pad(d.getHours())}:${pad(d.getMinutes())}`}
  function readTimer(){try{return JSON.parse(sessionStorage.getItem(TIMER_KEY)||"null")}catch{return null}}
  function writeTimer(v){if(v)sessionStorage.setItem(TIMER_KEY,JSON.stringify(v));else sessionStorage.removeItem(TIMER_KEY)}
  function elapsedSeconds(timer){if(!timer?.startedAt)return 0;const end=timer.stoppedAt||Date.now();return Math.max(0,Math.floor((end-Number(timer.startedAt))/1000))}
  function durationText(sec){const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;return `${pad(h)}:${pad(m)}:${pad(s)}`}
  function timerIsRunning(){const t=readTimer();return !!(t?.startedAt&&!t?.stoppedAt)}

  function refreshTimerUi(){
    const box=document.getElementById("practiceTimerValue");if(!box)return;
    const t=readTimer(),running=!!(t?.startedAt&&!t?.stoppedAt),sec=elapsedSeconds(t);
    box.textContent=durationText(sec);
    const label=document.getElementById("practiceTimerStatus");if(label)label.textContent=running?"計時中…":"可使用計時或手動輸入";
    const startBtn=document.getElementById("practiceTimerStart"),stopBtn=document.getElementById("practiceTimerStop");
    if(startBtn)startBtn.disabled=running;if(stopBtn)stopBtn.disabled=!running;
    const startInput=document.getElementById("pStart"),endInput=document.getElementById("pEnd");
    if(startInput)startInput.disabled=running;if(endInput)endInput.disabled=running;
    if(running&&t){const now=new Date();if(endInput)endInput.value=localTime(now);if(typeof updateMinutes==="function")updateMinutes()}
  }

  function ensureTicker(){
    if(intervalId)clearInterval(intervalId);
    intervalId=setInterval(()=>{if(!timerIsRunning()){clearInterval(intervalId);intervalId=null;return}refreshTimerUi()},1000);
  }

  window.startPracticeTimer=function(){
    if(timerIsRunning()){toast("計時器已在進行中");return}
    const now=new Date(),timer={startedAt:Date.now(),stoppedAt:null,studentId:String(state.student?.studentId||""),practiceDate:localDate(now)};
    writeTimer(timer);
    const d=document.getElementById("pDate"),s=document.getElementById("pStart"),e=document.getElementById("pEnd");
    if(d)d.value=timer.practiceDate;if(s)s.value=localTime(now);if(e)e.value=localTime(now);
    refreshTimerUi();ensureTicker();toast("▶️ 已開始自主練習計時");
  };

  window.stopPracticeTimer=function(){
    const timer=readTimer();if(!timer?.startedAt||timer.stoppedAt){toast("目前沒有進行中的計時");return}
    const now=new Date();timer.stoppedAt=Date.now();writeTimer(timer);
    const e=document.getElementById("pEnd");if(e)e.value=localTime(now);
    refreshTimerUi();if(typeof updateMinutes==="function")updateMinutes();toast(`⏹ 已停止，計時 ${durationText(elapsedSeconds(timer))}`);
  };

  window.resetPracticeTimer=function(){writeTimer(null);if(intervalId){clearInterval(intervalId);intervalId=null}refreshTimerUi();toast("已清除計時器，可手動輸入時間")};

  const basePracticePage=practicePage;
  practicePage=function(){
    const html=basePracticePage(),timer=readTimer(),running=!!(timer?.startedAt&&!timer?.stoppedAt);
    const timerPanel=`<div class="card"><h2>⏱️ 練習計時器</h2><div class="notice">可以直接計時，也可以繼續使用下方的「開始時間／結束時間」手動登記。停止計時後仍可手動微調時間再送出。</div><div style="text-align:center;padding:14px 0 8px"><div id="practiceTimerValue" style="font-size:34px;font-weight:900;letter-spacing:2px">${durationText(elapsedSeconds(timer))}</div><div id="practiceTimerStatus" class="muted" style="margin-top:5px">${running?"計時中…":"可使用計時或手動輸入"}</div></div><div class="row2"><button id="practiceTimerStart" class="primary" style="margin-top:0" onclick="startPracticeTimer()" ${running?"disabled":""}>▶️ 開始練習</button><button id="practiceTimerStop" class="secondary" style="margin-top:0" onclick="stopPracticeTimer()" ${running?"":"disabled"}>⏹ 停止</button></div>${timer?`<button class="secondary" style="width:100%;margin-top:10px" onclick="resetPracticeTimer()">清除計時／改用手動時間</button>`:""}</div>`;
    const reminderPanel=state.me?.role==="parent"?`<div class="card"><h2>📌 自主練習登記提醒</h2><div class="notice">為避免自主練習紀錄遺漏，影響後續成績統計與學生權益，請家長務必確認每次練習完成後已成功送出紀錄。<br><br>若主要登記之家長因出差、工作或其他因素無法操作，請由另一位已綁定之監護人登入系統完成自主練習登記。<br><br><b>系統以「學生」為統計單位</b>，不同監護人所填寫的自主練習紀錄會累計於同一位學生名下，不會分開計算。</div></div>`:"";
    const marker='<div class="card"><h2>自主練習打卡</h2>',out=html.includes(marker)?html.replace(marker,timerPanel+marker):timerPanel+html;
    setTimeout(()=>{refreshTimerUi();if(running)ensureTicker()},0);return out+reminderPanel;
  };

  const baseSavePractice=savePractice;
  savePractice=async function(){
    if(timerIsRunning()){toast("請先停止計時，再送出自主練習");return}
    await baseSavePractice();
  };
})();
