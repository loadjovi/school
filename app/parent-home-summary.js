(()=>{
  const isParent=()=>state.me?.role==="parent";
  const baseHome=typeof home==="function"?home:null;
  const baseNav=typeof nav==="function"?nav:null;
  const feedbackLevels=[null,{icon:"🌱",label:"起步中"},{icon:"👍",label:"持續加油"},{icon:"🙂",label:"表現不錯"},{icon:"🌟",label:"很棒喔"},{icon:"🏆",label:"超級投入"}];
  state.parentPracticeFeedback=state.parentPracticeFeedback||null;
  state.parentPracticeFeedbackData=state.parentPracticeFeedbackData||null;
  state.parentPracticeFeedbackStudentId=state.parentPracticeFeedbackStudentId||"";
  state.parentPracticeFeedbackLoading=false;
  state.parentPracticeLeaderboard=null;
  state.parentPracticeLeaderboardStudentId="";
  state.parentPracticeLeaderboardLoadedAt=0;
  state.parentPracticeLeaderboardLoading=false;
  state.parentPracticeLeaderboardError="";
  state.parentPracticeLeaderboardMode="monthly";
  state.parentPracticeLeaderboardMonth="";
  state.parentPracticeLeaderboardDataMode="";
  state.parentActivityConfigs=state.parentActivityConfigs||[];
  state.parentActivityLoadedAt=0;
  state.parentActivityLoading=false;
  let activityScope="",taskBoundary,taskDialog,taskDialogContent="";
  const shownTasks=new Map();
  state.parentTshirtSizes=null;
  state.parentTshirtSizesLoadedAt=0;
  state.parentTshirtSizesLoading=false;
  state.parentTshirtSizesError="";
  state.parentTshirtSizesScope="";

  const parentTshirtSizeScope=()=>[String(state.me?.email||"").trim().toLowerCase(),sessionStorage.getItem("school_context_id")||state.me?.schoolId||""].join("|");
  function syncParentTshirtSizeScope(){
    const next=parentTshirtSizeScope();
    if(next===state.parentTshirtSizesScope)return next;
    state.parentTshirtSizesScope=next;state.parentTshirtSizes=null;state.parentTshirtSizesLoadedAt=0;state.parentTshirtSizesLoading=false;state.parentTshirtSizesError="";
    return next;
  }

  async function loadParentTshirtSizes(){
    if(state.parentTshirtSizesLoading||state.me?.role!=="parent")return;
    const requestScope=syncParentTshirtSizeScope();
    state.parentTshirtSizesLoading=true;state.parentTshirtSizesError="";
    try{
      const token=sessionStorage.getItem("google_id_token")||"",school=sessionStorage.getItem("school_context_id")||"",role=sessionStorage.getItem("role_context")||"";
      const headers={...(token&&token!=="cookie-session"?{"X-Google-ID-Token":token}:{}),...(school?{"X-School-Id":school}:{}),...(role?{"X-Role-Context":role}:{})};
      const response=await fetch("/api/uniform-events/tshirt-historical-size",{credentials:"same-origin",cache:"no-store",headers});
      const data=await response.json().catch(()=>({}));
      if(!response.ok){
        if(response.status===403&&String(data.error||"").includes("未啟用")){if(parentTshirtSizeScope()===requestScope)state.parentTshirtSizes=[];return}
        throw Error(data.error||("HTTP "+response.status));
      }
      if(parentTshirtSizeScope()===requestScope)state.parentTshirtSizes=Array.isArray(data.items)?data.items:[];
    }catch(error){
      console.warn("團 T 尺寸讀取失敗",error);
      if(parentTshirtSizeScope()===requestScope){state.parentTshirtSizes=null;state.parentTshirtSizesError="團 T 尺寸狀態暫時無法確認"}
    }
    finally{if(parentTshirtSizeScope()===requestScope){state.parentTshirtSizesLoadedAt=Date.now();state.parentTshirtSizesLoading=false;if(state.page==="home")render()}}
  }
  window.retryParentTshirtSizes=function(){state.parentTshirtSizesLoadedAt=0;state.parentTshirtSizesError="";return loadParentTshirtSizes()};
  window.openTshirtSizeCollection=function(){state.parentUniformFocus="tshirt-size";go("uniformEvents")};
  window.addEventListener("message",event=>{
    if(event.origin!==location.origin||event.source!==document.getElementById("parentUniformFrame")?.contentWindow)return;
    if(event.data?.type==="parent-tshirt-size-saved"){
      state.parentTshirtSizesLoadedAt=0;loadParentTshirtSizes();
    }
    if(event.data?.type==="parent-uniform-size-focus"){
      const frame=document.getElementById("parentUniformFrame"),target=frame?.contentDocument?.getElementById("regularUniformCard");
      if(target)window.scrollTo({top:window.scrollY+frame.getBoundingClientRect().top+target.getBoundingClientRect().top-16,behavior:"smooth"});
      state.parentUniformFocus="";
    }
  });
  function tshirtSizeShortcut(){
    if(state.parentTshirtSizesError)return `<section class="card" aria-live="polite" style="border:2px solid #d8a752"><h2>🎽 團 T 尺寸</h2><div class="notice" style="background:#fff8e8;border:1px solid #d8a752"><b>${esc(state.parentTshirtSizesError)}</b><br>請重新讀取，確認是否需要填寫。<button type="button" class="secondary" style="display:block;width:100%;margin-top:10px" onclick="retryParentTshirtSizes()">重新讀取尺寸狀態</button></div></section>`;
    if(state.parentTshirtSizes===null)return `<section class="card" aria-live="polite"><h2>🎽 團 T 尺寸狀態</h2><div class="notice">正在確認孩子的團 T 尺寸登記狀態…</div></section>`;
    const pending=(state.parentTshirtSizes||[]).filter(item=>!item.size);
    if(!pending.length)return "";
    const names=pending.map(item=>esc(item.studentName||item.studentId)).join("、");
    return `<section class="card" aria-live="polite" style="border:2px solid #d8a752"><h2>🎽 請填寫團 T 尺寸</h2><p><b>${names}尚未登錄尺寸</b></p><p class="muted">只登記尺寸，不會下單。填完後此提醒會自動消失。</p><button type="button" class="primary" onclick="openTshirtSizeCollection()">填寫團 T 尺寸 ›</button></section>`;
  }
  window.parentTshirtSizeReminderHtml=tshirtSizeShortcut;

  async function loadParentActivityAlerts(){
    if(state.parentActivityLoading||state.me?.role!=="parent")return;
    const scope=activityScope;
    state.parentActivityLoading=true;
    try{
      const token=sessionStorage.getItem("google_id_token")||"",school=sessionStorage.getItem("school_context_id")||"",role=sessionStorage.getItem("role_context")||"";
      const headers={...(token&&token!=="cookie-session"?{"X-Google-ID-Token":token}:{}),...(school?{"X-School-Id":school}:{}),...(role?{"X-Role-Context":role}:{})};
      const response=await fetch("/api/uniform-events/config",{credentials:"same-origin",cache:"no-store",headers});
      if(!response.ok)throw Error("HTTP "+response.status);
      const data=await response.json();
      if(isParent()&&parentTshirtSizeScope()===scope)state.parentActivityConfigs=data.items||[];
    }catch(error){
      console.warn("家長活動提醒讀取失敗",error);
      if(isParent()&&parentTshirtSizeScope()===scope)state.parentActivityConfigs=[];
    }finally{
      if(isParent()&&parentTshirtSizeScope()===scope){
        state.parentActivityLoadedAt=Date.now();state.parentActivityLoading=false;
        if(state.page==="home")render();
      }
    }
  }

  function parentTasks(){
    const notice=window.parentActivityNotice;
    const activities=notice?.registrationTasks(state.parentActivityConfigs,window.getParentActivityRegistrations?.(),state.students)||[];
    const tasks=activities.map(item=>{
      const key=notice.key(item);
      const deadline=item.closeAt?new Intl.DateTimeFormat("zh-TW",{timeZone:"Asia/Taipei",dateStyle:"short",timeStyle:"short",hourCycle:"h23"}).format(new Date(item.closeAt)):"";
      const view=item.module==="yearEndDinner"?"events":"performance";
      return {key:key+":"+String(item.closeAt||""),title:item.title||"活動",detail:deadline?"報名截止 "+deadline:notice.activityDate(item),action:"前往報名",href:"/parent-uniform-events.html?view="+view+"&activity="+encodeURIComponent(key)};
    });
    for(const item of state.parentTshirtSizes||[]){
      const issued=item.historicalIssued===true&&item.received!==false;
      const action=!item.size?"填寫尺寸":item.schoolIssuedAt&&!issued?"確認領取":"";
      if(!action||!item.studentId)continue;
      tasks.push({key:"tshirt:"+item.studentId+":"+action,title:"團 T｜"+(item.studentName||item.studentId),action,href:"/parent-uniform-events.html?focus=tshirt-size&studentId="+encodeURIComponent(item.studentId)});
    }
    return tasks;
  }

  function tasksDialog(tasks,manual=false){
    if(!isParent()||state.page!=="home"||!tasks.length){
      if(taskDialog?.open)taskDialog.close();
      return;
    }
    const scope=parentTshirtSizeScope();
    const storageKey="parent-tasks-shown:"+scope;
    if(!shownTasks.has(scope)){
      let previous=[];
      try{previous=JSON.parse(sessionStorage.getItem(storageKey)||"[]")}catch{}
      shownTasks.set(scope,new Set(Array.isArray(previous)?previous:[]));
    }
    const shown=shownTasks.get(scope),hasNew=tasks.some(task=>!shown.has(task.key));
    if(!manual&&!hasNew&&!taskDialog?.open)return;
    const activeDialog=document.querySelector?.("dialog[open]");
    if(activeDialog&&activeDialog!==taskDialog)return;
    if(!taskDialog){
      taskDialog=document.createElement("dialog");
      taskDialog.className="parent-task-dialog";
      taskDialog.setAttribute("aria-labelledby","parent-task-dialog-title");
      taskDialog.innerHTML='<h2 id="parent-task-dialog-title">有新活動或待辦</h2><ul></ul><form method="dialog"><button type="submit" class="secondary" autofocus>稍後處理</button></form>';
      document.body.append(taskDialog);
    }
    const content=tasks.map(task=>`<li><a href="${esc(task.href)}"><strong>${esc(task.title)}</strong>${task.detail?`<small>${esc(task.detail)}</small>`:""}<span>${esc(task.action)} ›</span></a></li>`).join("");
    if(content!==taskDialogContent){taskDialog.querySelector("ul").innerHTML=content;taskDialogContent=content;}
    if(!taskDialog.open)taskDialog.showModal();
    for(const task of tasks)shown.add(task.key);
    try{sessionStorage.setItem(storageKey,JSON.stringify([...shown]))}catch{}
  }

  function syncParentTasks(){
    clearTimeout(taskBoundary);
    if(!isParent()||state.page!=="home"||!state.student){tasksDialog([]);return}
    const now=Date.now();
    const next=state.parentActivityConfigs.flatMap(item=>[Date.parse(item.openAt),Date.parse(item.closeAt)])
      .reduce((earliest,at)=>at>now?Math.min(earliest,at):earliest,Infinity);
    if(Number.isFinite(next))taskBoundary=setTimeout(()=>render(),Math.min(next-now,2147483647));
    if(!state.parentActivityLoading&&!state.parentTshirtSizesLoading)tasksDialog(parentTasks());
  }

  function parentTaskLauncher(){
    const count=parentTasks().length;
    return count?`<button type="button" class="secondary parent-task-launcher" onclick="showParentTasks()">查看待辦（${count}） ›</button>`:"";
  }
  window.showParentTasks=()=>tasksDialog(parentTasks(),true);
  const renderWithParentHome=render;
  render=function(){const output=renderWithParentHome();syncParentTasks();return output};
  document.addEventListener?.("close",()=>syncParentTasks(),true);
  window.addEventListener("pageshow",event=>{
    if(!event.persisted||!isParent()||state.page!=="home")return;
    if(taskDialog?.open)taskDialog.close();
    state.parentActivityConfigs=[];state.parentActivityLoadedAt=0;
    state.parentTshirtSizes=null;state.parentTshirtSizesLoadedAt=0;
    window.refreshParentUniformPayments?.();
    render();
  });

  const baseRefreshStudent=refreshStudent;
  refreshStudent=async function(){
    const oldId=String(state.student?.studentId||"");
    const oldSignature=JSON.stringify((state.practice||[]).map(x=>[x.practiceId,x.practiceDate,x.minutes]));
    await baseRefreshStudent();
    const newSignature=JSON.stringify((state.practice||[]).map(x=>[x.practiceId,x.practiceDate,x.minutes]));
    if(oldId!==String(state.student?.studentId||"")||oldSignature!==newSignature)state.parentPracticeLeaderboardLoadedAt=0;
  };

  function localDate(){const d=new Date(),y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0");return `${y}-${m}-${day}`}
  function shortDate(v){const s=String(v||""),m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);return m?`${Number(m[2])}/${Number(m[3])}`:s}
  function attendanceKpi(label,present,total,leave=0,absent=0,sub=""){const p=Number(present||0),t=Number(total||0),l=Number(leave||0),a=Number(absent||0);if(t===0)return `<div class="kpi"><b style="font-size:18px">尚無課程</b><span>${esc(label)}</span>${sub?`<small style="display:block;margin-top:3px;color:var(--muted);font-weight:700">${esc(sub)}</small>`:""}</div>`;const status=a>0?`🔴 缺席 ${a} 次`:l>0?`🟡 請假 ${l} 次（不扣分）`:"🟢 全勤";return `<div class="kpi"><b>${p} / ${t}</b><span>${esc(label)}</span><small style="display:block;margin-top:3px;color:var(--muted);font-weight:700">${status}${sub?`｜${esc(sub)}`:""}</small></div>`}
  function latestPractice(){const rows=[...(state.practice||[])].filter(x=>x?.practiceDate).sort((a,b)=>String(b.practiceDate).localeCompare(String(a.practiceDate))||String(b.endTime||b.startTime||"").localeCompare(String(a.endTime||a.startTime||"")));return rows[0]||null}
  function todayPractices(){const today=localDate();return (state.practice||[]).filter(x=>String(x.practiceDate||"").slice(0,10)===today)}
  function practiceStreakInfo(){
    const dates=[...new Set((state.practice||[]).map(x=>String(x.practiceDate||"").slice(0,10)).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x)))].sort();
    if(!dates.length)return {longest:0,current:0,reward:null,next:3};
    const day=n=>Math.floor(new Date(n+"T12:00:00Z").getTime()/86400000);
    let longest=1,run=1;
    for(let i=1;i<dates.length;i++){if(day(dates[i])-day(dates[i-1])===1){run++;longest=Math.max(longest,run)}else run=1}
    const today=localDate(),latest=dates[dates.length-1],gap=day(today)-day(latest);
    let current=gap<=1?1:0;
    if(current){for(let i=dates.length-1;i>0;i--){if(day(dates[i])-day(dates[i-1])===1)current++;else break}}
    const levels=[{days:3,icon:"🔥",label:"3日連續"},{days:5,icon:"⭐",label:"5日穩定"},{days:7,icon:"🏆",label:"一週連續"},{days:14,icon:"🎖️",label:"兩週堅持"},{days:21,icon:"👑",label:"21日練習之星"}];
    const reward=[...levels].reverse().find(x=>longest>=x.days)||null,next=(levels.find(x=>longest<x.days)||{}).days||null;
    return {longest,current,reward,next};
  }
  async function loadParentPracticeFeedback(studentId){
    if(!studentId||state.parentPracticeFeedbackLoading)return;
    state.parentPracticeFeedbackLoading=true;
    try{
      const d=await api("/api/practice-feedback?studentId="+encodeURIComponent(studentId));
      if(String(state.student?.studentId)===String(studentId)){
        state.parentPracticeFeedback=d.latest||null;
        state.parentPracticeFeedbackData=d;
      }
    }catch(e){state.parentPracticeFeedback=null;state.parentPracticeFeedbackData=null}
    finally{state.parentPracticeFeedbackLoading=false;if(String(state.student?.studentId)===String(studentId))render()}
  }
  async function loadParentPracticeLeaderboard(studentId){
    if(!studentId||state.parentPracticeLeaderboardLoading)return;
    const mode="monthly",month=String(state.parentPracticeLeaderboardMonth||"");
    const key=mode+"|"+month;
    state.parentPracticeLeaderboardLoading=true;
    state.parentPracticeLeaderboardError="";
    try{
      const data=await api("/api/parent-practice-leaderboard?studentId="+encodeURIComponent(studentId)+"&mode="+mode+(month?"&month="+encodeURIComponent(month):""));
      if(state.me?.role==="parent"&&String(state.student?.studentId)===String(studentId)&&state.parentPracticeLeaderboardMonth===month){
        state.parentPracticeLeaderboardDataMode=key;
        state.parentPracticeLeaderboard=data;
        state.parentPracticeLeaderboardStudentId=studentId;
        state.parentPracticeLeaderboardLoadedAt=Date.now();
      }
    }catch(e){
      if(state.me?.role==="parent"&&String(state.student?.studentId)===String(studentId)&&state.parentPracticeLeaderboardMonth===month){
        state.parentPracticeLeaderboardDataMode=key;
        state.parentPracticeLeaderboardError=e.message||"排名暫時無法取得";
        state.parentPracticeLeaderboardStudentId=studentId;
        state.parentPracticeLeaderboardLoadedAt=Date.now();
      }
    }finally{
      state.parentPracticeLeaderboardLoading=false;
      if(state.me?.role==="parent"&&state.page==="home")render();
    }
  }
  window.refreshParentPracticeLeaderboard=function(){
    state.parentPracticeLeaderboardLoadedAt=0;
    const studentId=String(state.student?.studentId||"");
    if(studentId&&!state.parentPracticeLeaderboardLoading){loadParentPracticeLeaderboard(studentId);render()}
  };
  window.setParentPracticeLeaderboardMonth=function(value){
    const month=String(value||"");
    if(state.parentPracticeLeaderboardLoading||!/^\d{4}-\d{2}$/.test(month))return;
    const offered=state.parentPracticeLeaderboard?.availableMonths||[];
    if(!offered.includes(month))return;
    state.parentPracticeLeaderboardMonth=month;
    state.parentPracticeLeaderboardLoadedAt=0;
    state.parentPracticeLeaderboard=null;
    state.parentPracticeLeaderboardError="";
    state.parentPracticeLeaderboardDataMode="";
    const studentId=String(state.student?.studentId||"");
    if(studentId)loadParentPracticeLeaderboard(studentId);
    render();
  };

  function leaderboardMonthlyDetail(data){
    const own=data?.mine,rows=Array.isArray(own?.monthlyDetails)?own.monthlyDetails:[];
    if(!rows.length)return `<p class="muted">我的孩子這個月尚未有可列入計分的練習紀錄。</p>`;
    const row=rows[0],target=Number(row.targetDays||data.targetDays||30),days=Number(row.qualifiedDays||0),minutes=Number(own?.minutes||0),score=Number(row.score10||0);
    return `<div class="notice" style="margin-top:10px">
      <b>我的孩子｜${Number(String(row.month).slice(5))} 月計算明細</b>
      <div style="margin-top:6px">${days} 個有效練習日 ÷ ${target} 天 × 10 ＝ <b>${score}/10</b></div>
      <div style="margin-top:4px">本月累計練習：<b>${minutes} 分鐘</b></div>
      <small>本月榜單獨立計分，老師鼓勵不列入分數；歷史月份若有合法補正，結果會重新計算。</small>
    </div>`;
  }
  function parentPracticeLeaderboardCard(){
    const data=state.parentPracticeLeaderboard,d=data||{},studentId=String(state.student?.studentId||"");
    const mode="monthly",requestedMonth=String(state.parentPracticeLeaderboardMonth||"");
    const requestKey=mode+"|"+requestedMonth;
    if(!state.parentPracticeLeaderboardLoading&&(!state.parentPracticeLeaderboardLoadedAt||Date.now()-state.parentPracticeLeaderboardLoadedAt>120000||state.parentPracticeLeaderboardStudentId!==studentId||state.parentPracticeLeaderboardDataMode!==requestKey||data?.asOf&&data.asOf!==localDate())){
      state.parentPracticeLeaderboardLoadedAt=Date.now();
      setTimeout(()=>loadParentPracticeLeaderboard(studentId),0);
    }
    const current=state.parentPracticeLeaderboardStudentId===studentId&&state.parentPracticeLeaderboardDataMode===requestKey&&data&&!state.parentPracticeLeaderboardError;
    const available=current?(d.availableMonths||[]):[];
    const month=current?String(d.selectedMonth||""):"",monthName=month?Number(month.slice(5))+" 月":"本月";
    const calendarMonth=localDate().slice(0,7),active=month===calendarMonth;
    const rows=current?(d.items||[]):[];
    const monthTarget=month?Math.min(Number(d.targetDays||30),new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).getDate()):Number(d.targetDays||30);
    const options=available.slice().reverse().map(m=>`<option value="${esc(m)}" ${m===month?"selected":""}>${Number(m.slice(5))} 月（${m===calendarMonth?"進行中":"歷史紀錄"}）</option>`).join("");
    const content=state.parentPracticeLeaderboardError
      ?`<div class="notice">排行榜暫時無法取得，請點選「更新」再試一次。</div>`
      :!current?`<div class="notice">正在載入本月份的 TOP 5 練習紀錄…</div>`
      :!month?`<div class="notice">目前尚未開始正式計分月份；等正式練習月份開始就會自動顯示排行榜。</div>`
      :!rows.length?`<div class="notice">${active?"新的月份開始了！目前尚無練習紀錄，第一個累計達標的練習日就會更新榜單。":"這個月份沒有可列入鼓勵榜的練習紀錄。"}</div>`
      :`<div class="practice-leaderboard-order-note"><b>排名方式：</b>先看有效練習天數；天數相同時，再比較本月累計練習分鐘。</div><ol class="practice-leaderboard-list">${rows.map(x=>`<li class="practice-leaderboard-item ${x.isMine?"is-mine":""}"><span class="practice-leaderboard-rank">${Number(x.rank)}</span><div><b>${esc(x.name)}${x.isMine?"（我的孩子）":""}</b><div class="practice-leaderboard-metrics"><span>${monthName}有效練習 ${Number(x.qualifiedDays)} / ${monthTarget} 天</span><span class="practice-leaderboard-minutes">⏱ 累計 ${Number(x.minutes||0)} 分鐘</span></div></div><strong>${Number(x.score10)}/10</strong></li>`).join("")}</ol>${d.mine&&Number(d.mine.rank)>5?`<div class="practice-leaderboard-mine">我的孩子｜第 ${Number(d.mine.rank)} 名｜${Number(d.mine.qualifiedDays)} 個有效日｜累計 ${Number(d.mine.minutes||0)} 分鐘｜${Number(d.mine.score10)}/10</div>`:""}`;
    return `<section class="card practice-leaderboard">
      <div class="practice-leaderboard-head"><div><h2>🏅 自主練習分數 TOP 5</h2><small>${month?monthName+(active?"｜本月進行中":"｜歷史月份"):"每月獨立排名"}</small></div><button class="secondary" type="button" onclick="refreshParentPracticeLeaderboard()" ${state.parentPracticeLeaderboardLoading?"disabled":""}>更新</button></div>
      ${available.length?`<div style="display:flex;align-items:center;gap:10px;margin:10px 0"><label for="practiceRankingMonth" style="white-space:nowrap;font-weight:700">月份</label><select id="practiceRankingMonth" aria-label="切換自主練習排行榜月份" style="flex:1;max-width:240px;padding:9px;border:1px solid #cbd6e4;border-radius:9px" onchange="setParentPracticeLeaderboardMonth(this.value)" ${state.parentPracticeLeaderboardLoading?"disabled":""}>${options}</select></div>`:""}
      <p class="muted">每天累計滿 ${Number(d.qualifiedMinutes||20)} 分鐘算 1 個達標日。此榜為練習鼓勵，不是正式成績。</p>
      ${content}
      <details class="practice-leaderboard-audit" style="margin-top:12px">
        <summary style="cursor:pointer;font-weight:700">ⓘ 查看計算方式與我的孩子明細</summary>
        <div style="padding:8px 0;font-size:14px">
          <p><b>分數怎麼算？</b>每天累計滿 ${Number(d.qualifiedMinutes||20)} 分鐘算 1 天；本月有效日 ÷ ${monthTarget} 天 × 10＝本月分數，最高 10 分。</p>
          <p>每月獨立累計，不與其他月份混算。${active?"例如 11/1 首次達標 1 天＝0.33/10（以每月目標 30 天為例）。":""}</p>
          <p>同一天多次練習可累計分鐘，但有效練習日最多算 1 天。每月以最多 ${Number(d.targetDays||30)} 天為目標，當月分數依完整月份目標天數換算，不使用當日已過天數當作分母。</p>
          <p>TOP 5 <strong>只比較選定的單一月份</strong>；先依有效練習日排序，天數相同時再依該月累計分鐘數排序，所以有效天數相同的學生仍可能有不同名次。月初重新排行不表示上個月的努力被取消。</p>
          ${current?leaderboardMonthlyDetail(d):""}
          <p class="muted">這是鼓勵排行榜；正式學期成績請查看期末／學期成績總覽。其他學生姓名僅顯示遮蔽資料，不公開逐日紀錄。</p>
        </div>
      </details>
    </section>`;
  }
  function parentMonthlyScoreCard(){
    const s=state.summary||{},qualified=Number(s.practiceQualifiedDays||0),target=Math.max(1,Number(s.practiceEffectiveTargetDays||s.practiceTargetDays||30)),total=Math.round(Math.min(qualified/target,1)*1000)/100,trial=/^\d{4}-09$/.test(String(s.month||"")),current=String(s.month||"")===localDate().slice(0,7);
    return `<div class="parent-monthly-score">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><b>🎯 自主練習｜期末 10%</b><span class="practice-feedback-chip">${trial?"9月試營運｜":""}${total}/10</span></div>
      <div class="parent-monthly-score-grid"><div><b>${qualified} / ${target}</b><small>有效練習日 / 月目標</small></div><div><b>${total}/10</b><small>系統自動換算</small></div></div>
      <div class="monthly-score-formula">換算：${qualified} ÷ ${target} × 10 ＝ <b>${total}/10</b></div>
      <small style="display:block;margin-top:8px;color:var(--muted)">此項由系統依有效練習天數自動計算，老師不需另外評分。${trial?"9 月僅試算，正式計分自 10 月開始。":current?"本月進行中，目前為暫估分數。":"此月份為正式結果。"}</small>
    </div>`;
  }
  function parentAttendanceScoreCard(){
    const s=state.summary||{},present=Number(s.attendancePresent||0),total=Number(s.attendanceTotal||0),leave=Number(s.attendanceLeave||0);
    const rate=s.attendanceRate==null?null:Number(s.attendanceRate),score=s.attendanceScore5==null?null:Number(s.attendanceScore5);
    const current=String(s.month||"")===localDate().slice(0,7),full=total>0&&present>=total,trial=/^\d{4}-09$/.test(String(s.month||""));
    return `<div class="parent-attendance-score">
      <div class="parent-attendance-score-head">
        <b>📘 課程點名｜期末 5%</b>
        <span class="practice-feedback-chip">${trial?"9月試營運｜":""}${score==null?"尚無點名":(Math.round(score*100)/100)+"/5"}</span>
      </div>
      ${total? `<div class="parent-attendance-score-grid">
        <div><b>${present} / ${total}</b><small>到課 / 計分應到</small></div>
        <div><b>${rate==null?"—":rate+"%"}</b><small>${full?"全勤":"出席比例"}${leave?"｜核准請假 "+leave+" 次不扣分":""}</small></div>
      </div>
      <div class="monthly-score-formula">換算：${present} ÷ ${total} × 5 ＝ <b>${Math.round(score*100)/100}/5</b></div>`
      : `<div class="notice" style="margin-top:8px">本月尚無可計分的分部課／合奏課／綜合課點名紀錄，因此暫不產生出勤分數。</div>`}
      <small style="display:block;margin-top:8px;color:var(--muted)">計分範圍：分部課＋合奏課＋綜合課；個別課不納入此 5%。上課開始後超過 10 分鐘才到課記為遲到，10 分鐘內記為出席；遲到仍計入到課。停課與核准請假不列入計分分母，無故缺席才影響分數。${trial?"9 月僅試算，正式計分自 10 月開始。":current?"本月進行中，目前為暫估分數。":"此月份為正式結果。"}</small>
    </div>`;
  }
  function parentMonthlyScoreOverview(){
    const s=state.summary||{},qualified=Number(s.practiceQualifiedDays||0),target=Math.max(1,Number(s.practiceEffectiveTargetDays||s.practiceTargetDays||30));
    const practice=Math.round(Math.min(qualified/target,1)*1000)/100;
    const attendance=s.attendanceScore5==null?null:Math.round(Number(s.attendanceScore5)*100)/100;
    const privateCount=Number(s.privateCompletedForScore||0),privateTarget=Math.max(1,Number(s.privateMonthlyTarget||4));
    const privateScore=Math.round(Math.min(privateCount/privateTarget,1)*500)/100;
    const trial=/^\d{4}-09$/.test(String(s.month||"")),month=String(s.month||localDate().slice(0,7)).slice(5);
    const monthComplete=attendance!=null,monthTotal=monthComplete?Math.round((practice+attendance+privateScore)*100)/100:null;
    const row=(icon,title,value,meta,cls="")=>`<div class="parent-score-row ${cls}"><div class="parent-score-row-main"><span class="parent-score-icon">${icon}</span><div><b>${title}</b><small>${meta}</small></div></div><div class="parent-score-value">${value}</div></div>`;
    return `<section class="parent-score-overview">
      <div class="parent-score-overview-head">
        <div><b>📊 ${month}月${trial?"評分試算":"學習進度"}｜期末 20%</b><small>自主練習 10%＋課程點名 5%＋個課／期末評量 5%。</small></div>
        <span class="parent-score-total ${monthComplete?"is-complete":"is-pending"}">${monthComplete?monthTotal+"/20":"已計 "+practice+"/10"}</span>
      </div>
      <div class="parent-score-indent">
        ${row("🎯","自主練習｜10%",practice+"/10",`系統自動計分｜有效練習 ${qualified}/${target} 天`,"practice")}
        ${row("📘","課程點名｜5%",attendance==null?"待資料":attendance+"/5",attendance==null?"尚無可計分點名":"只計分部／合奏／綜合；核准請假不扣分","attendance")}
        ${row("🎻","個課學習表現｜5%",privateScore+"/5",`本月完成個課 ${privateCount}/${privateTarget} 次；每月 4 次 = 5 分`,"learning")}
      </div>
      <small class="parent-score-overview-foot">${trial?"9 月為試營運，以上僅供試算；正式成績自 10 月開始。":"上學期個課 5% 以 10～12 月每月分數做學期平均；若整學期沒有完成個課，則不採個課 0 分，而是改由分部老師於學期末評量一次。"}</small>
    </section>`;
  }
  function parentFeedbackCard(){
    const f=state.parentPracticeFeedback,d=state.parentPracticeFeedbackData||{},m=feedbackLevels[Number(f?.level||0)];
    if(!f||!m)return "";
    const counts=d.badgeCounts||{},monthCount=Number(d.currentMonthCount||0),recent=Array.isArray(d.recent)?d.recent:[],streak=practiceStreakInfo();
    const badges=feedbackLevels.slice(1).map((meta,i)=>`<div class="parent-feedback-badge ${Number(counts[i+1]||0)>0?"earned":""}"><span>${meta.icon}</span><small>${esc(meta.label)}</small><b>×${Number(counts[i+1]||0)}</b></div>`).join("");
    const reward=streak.reward?`<div class="practice-streak-earned"><span>${streak.reward.icon}</span><div><b>${esc(streak.reward.label)}</b><small>本月最長連續練習 ${streak.longest} 天</small></div></div>`:`<div class="practice-streak-earned"><span>🌱</span><div><b>連續練習挑戰</b><small>目前最長 ${streak.longest} 天${streak.next?`｜達 ${streak.next} 天可獲得第一枚徽章`:""}</small></div></div>`;
    return `<details class="parent-practice-feedback parent-feedback-compact">
      <summary>
        <div><b>💛 日常鼓勵｜不計分</b><small>${m.icon} ${esc(m.label)}｜最近回饋 ${esc(f.teacherName||"老師")}</small></div>
        <span class="practice-feedback-chip">本月 ${monthCount} 次</span>
      </summary>
      <div class="parent-feedback-expanded">
        <div class="parent-feedback-latest"><div style="font-size:18px;font-weight:900">${m.icon} ${esc(m.label)}</div>${f.comment?`<div style="margin-top:6px;font-size:14px;font-weight:800">${esc(f.comment)}</div>`:""}<small>最近回饋｜${esc(f.teacherName||"老師")}${f.updatedAt?`｜${esc(String(f.updatedAt).slice(0,10))}`:""}</small></div>
        <small style="display:block;margin:7px 0;color:var(--muted)">此區為老師平時鼓勵互動，不列入任何成績；需要查看徽章或歷史回饋時再展開即可。</small>
        <div class="parent-feedback-section-title">🏅 鼓勵徽章牆</div>
        <div class="parent-feedback-badges">${badges}</div>
        <div class="parent-feedback-section-title">🔥 連續練習獎勵</div>
        ${reward}
        ${recent.length>1?`<details class="parent-feedback-history"><summary>查看最近老師鼓勵（${Math.min(recent.length,5)}）</summary>${recent.slice(0,5).map(h=>{const hm=feedbackLevels[Number(h.level||0)];return `<div><b>${hm?hm.icon:"💛"} ${esc(hm?.label||"鼓勵")}</b><small>${esc(h.teacherName||"老師")}｜${esc(String(h.updatedAt||"").slice(0,10))}</small>${h.comment?`<p>${esc(h.comment)}</p>`:""}</div>`}).join("")}</details>`:""}
      </div>
    </details>`;
  }
  function todayCourseReminder(){
    const s=state.summary||{},date=String(s.today||localDate());
    const privateStatus={scheduled:"已預約",awaiting_parent:"待家長確認",issue:"待老師回覆",completed:"已完成上課",cancelled:"今日停課"};
    const individual=(state.privateLessons||[]).filter(x=>String(x.studentId)===String(state.student?.studentId)&&x.lessonDate===date).map(x=>{
      const status=x.workflowStatus||(x.status==="cancelled"?"cancelled":x.status==="scheduled"?"scheduled":x.status==="teacher_completed"?"awaiting_parent":x.status==="completion_issue"?"issue":"completed");
      return {label:"個課｜"+(x.teacherName||"個課老師"),time:[x.startTime,x.endTime].filter(Boolean).join("～"),cancelled:status==="cancelled",displayStatus:privateStatus[status]||"查看個課狀態",displayClass:status==="cancelled"?"bad":status==="completed"?"ok":"warn"};
    });
    const courses=[...(Array.isArray(s.todayCourses)?s.todayCourses:[]),...individual].sort((a,b)=>String(a.time||"").localeCompare(String(b.time||"")));
    const statusText={present:"已出席",late:"遲到",leave:"請假",absent:"缺席",cancelled:"停課"};
    const statusClass={present:"ok",late:"warn",leave:"warn",absent:"bad",cancelled:"warn"};
    if(!courses.length)return `<div class="card"><h2>📅 今日課程</h2><div class="notice"><b>${esc(shortDate(date))} 今天沒有安排的課程</b></div></div>`;
    const rows=courses.map(x=>{const status=x.displayStatus||(x.cancelled?"今日停課":x.recorded?(statusText[x.status]||"已點名"):"尚未點名");const cls=x.displayClass||(x.cancelled?"bad":x.recorded?(statusClass[x.status]||"ok"):"warn");const location=x.location?`<small style="display:block;margin-top:3px">📍 ${esc(x.location)}</small>`:"";const note=x.cancelled&&x.reason?`<small style="display:block;margin-top:4px">原因：${esc(x.reason)}</small>`:"";return `<div class="item"><div><b>${esc(x.label||"課程")}</b><small>${esc(x.time||"")}</small>${location}${note}</div><span class="badge ${cls}">${esc(status)}</span></div>`}).join("");
    return `<div class="card"><h2>📅 今日課程</h2><div class="notice" style="margin-bottom:10px"><b>${esc(state.student?.name||"學生")}今天有 ${courses.length} 堂課程</b></div>${rows}</div>`;
  }
  const homeDate=()=>new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Taipei"});
  const homeUpdateScope=()=>[parentTshirtSizeScope(),state.student?.studentId,homeDate()].join("|");
  let homeUpdatesScope="",homeUpdates=null,homeUpdatesError="",homeUpdatesLoading=false,homeUpdatesVersion=0,homeUpdatesLoadedAt=0;
  async function loadParentHomeUpdates(){
    if(!isParent()||!state.student)return;
    const scope=homeUpdateScope(),version=++homeUpdatesVersion;homeUpdatesLoading=true;homeUpdatesLoadedAt=Date.now();
    try{
      const data=await api("/api/parent-home-updates?studentId="+encodeURIComponent(state.student.studentId));
      if(scope!==homeUpdateScope()||version!==homeUpdatesVersion)return;
      homeUpdates=data;homeUpdatesError="";
    }catch(error){
      if(scope!==homeUpdateScope()||version!==homeUpdatesVersion)return;
      homeUpdates=null;homeUpdatesError="活動與最新提醒暫時無法讀取。";
    }finally{
      if(scope===homeUpdateScope()&&version===homeUpdatesVersion){homeUpdatesLoading=false;if(state.page==="home")render()}
    }
  }
  window.refreshParentHomeUpdates=()=>{if(!homeUpdatesLoading)return loadParentHomeUpdates()};
  function parentUpcomingItems(){
    const groupName=v=>{const g=String(v||"").trim().replace(/團$/u,"").toUpperCase();return ["儲備","預備"].includes(g)?"C":g};
    const group=groupName(state.student?.groupName),date=homeDate(),now=Date.now();
    const registrations=window.getParentActivityRegistrations?.();
    const configs=(state.parentActivityConfigs||[]).filter(x=>x.enabled&&["fieldTrip","yearEndDinner","calendarActivity"].includes(x.module)&&
      (x.module!=="yearEndDinner"||x.feeStatus==="PUBLISHED")&&
      String(x.targetGroups||"ALL").split(",").some(g=>groupName(g)==="ALL"||groupName(g)===group));
    const rows=new Map();
    for(const x of homeUpdates?.events||[]){
      const key=x.sourceModule&&x.sourceActivityId?x.sourceModule+":"+x.sourceActivityId:"calendar:"+x.eventId;
      rows.set(key,{...x,key,date:x.eventDate,href:["fieldTrip","yearEndDinner","calendarActivity"].includes(x.sourceModule)&&x.sourceActivityId?"/parent-uniform-events.html?view="+(x.sourceModule==="yearEndDinner"?"events":"performance")+"&activity="+encodeURIComponent(key):"",description:[x.startTime,x.endTime].filter(Boolean).join("～")||x.timeLabel||"時間另行通知"});
    }
    for(const config of configs){
      const key=config.module+":"+config.id,old=rows.get(key)||{},start=config.module==="calendarActivity"?config.eventDate:window.parentActivityNotice?.activityDate(config)?.split("～")[0];
      const registration=registrations?.find(x=>x.kind===config.module&&x.activityId===config.id),cancelled=registration?.registrationStatus==="CANCELLED",registered=cancelled?null:registration;
      const closed=config.closeAt&&Date.parse(config.closeAt)<=now;
      const end=config.module==="calendarActivity"?config.endDate||start:window.parentActivityNotice?.activityDate(config)?.split("～").at(-1)||start;
      const ended=config.endAt?Date.parse(config.endAt)<=now:config.module==="calendarActivity"&&config.endTime?Date.parse(end+"T"+config.endTime+":00+08:00")<=now:false;
      if(!start||end<date||ended||closed&&!registered){rows.delete(key);continue}
      const opening=config.openAt&&Date.parse(config.openAt)>now,bookable=config.module!=="yearEndDinner"||config.paymentOpen===true;
      rows.set(key,{...old,key,date:start,endDate:end,title:config.title||old.title,location:config.location||old.location||"",
        description:config.module==="calendarActivity"?old.description||"":"",
        status:cancelled?(registration.paymentStatus==="REFUNDED"?"已退款，報名已作廢":"報名已取消"):registered?({VERIFIED:"報名完成",REPORTED_UNVERIFIED:"待財務核帳",ADJUSTMENT_REQUIRED:"待處理差額",SUPPLEMENT_REPORTED:"補款待核帳",REFUND_REQUESTED:"退費處理中"}[registered.paymentStatus]||"已送出報名"):config.module==="calendarActivity"?"免報名":opening||!bookable?"尚未開放":"報名中",
        action:cancelled?"查看退費／取消紀錄":registered?"查看報名":config.module==="calendarActivity"||opening||!bookable?"查看活動":"立即報名",
        deadline:!registered&&Number.isFinite(Date.parse(config.closeAt))?new Intl.DateTimeFormat("zh-TW",{timeZone:"Asia/Taipei",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date(config.closeAt)):"",
        href:cancelled?"/parent-uniform-events.html?view=history":"/parent-uniform-events.html?view="+(config.module==="yearEndDinner"?"events":"performance")+"&activity="+encodeURIComponent(key)});
    }
    return [...rows.values()].filter(x=>(x.endDate||x.date)>=date).sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.startTime||"").localeCompare(String(b.startTime||""))).slice(0,4);
  }
  function parentUpcomingPanel(){
    const rows=parentUpcomingItems();
    return `<section class="card" id="parentUpcomingActivities"><h2>🗓️ 未來活動</h2>${homeUpdatesError?`<div class="notice" role="alert">${esc(homeUpdatesError)}<button type="button" class="secondary" onclick="refreshParentHomeUpdates()">重新讀取</button></div>`:!homeUpdates?'<div class="notice">正在讀取活動…</div>':""}${rows.length?rows.map(x=>`<article class="parent-home-activity"><div class="parent-home-activity-head"><b>${esc(x.title||"活動")}</b>${x.status?`<span class="badge ${x.status==="報名中"?"ok":"warn"}">${esc(x.status)}</span>`:""}</div><p class="muted">${esc(x.date)}${x.endDate&&x.endDate!==x.date?"～"+esc(x.endDate):""}${x.description?`<br>${esc(x.description)}`:""}${x.location?`<br>📍 ${esc(x.location)}`:""}${x.deadline?`<br>報名截止 ${esc(x.deadline)}`:""}</p>${x.href?`<a class="parent-home-action" href="${esc(x.href)}">${esc(x.action||"查看活動")} ›</a>`:""}</article>`).join(""):homeUpdates?'<div class="notice">目前沒有近期活動。</div>':""}</section>`;
  }
  function parentNewsPanel(){
    const changes=(state.summary?.todayCourses||[]).filter(x=>x.cancelled).map(x=>({title:(x.label||"今日課程")+"｜停課",note:x.reason||"今日停課，請留意上課安排。",eventDate:state.summary?.today||localDate()}));
    const rows=[...changes,...(homeUpdates?.announcements||[])].slice(0,4);
    return `<section class="card" id="parentLatestNews"><h2>📢 最新消息</h2>${rows.length?rows.map(x=>`<div class="item"><div style="min-width:0;overflow-wrap:anywhere"><b>${esc(x.title||"重要提醒")}</b><small>${esc(x.eventDate||"")}</small>${x.note?`<p style="white-space:pre-wrap;margin:6px 0">${esc(x.note)}</p>`:""}</div></div>`).join(""):homeUpdatesError?'<div class="notice">最新消息暫時無法確認，請重新讀取活動與提醒。</div>':homeUpdates?'<div class="notice">目前沒有新消息。</div>':'<div class="notice">正在確認最新重要提醒…</div>'}</section>`;
  }

  function studentSwitcher(){
    const students=Array.isArray(state.students)?state.students:[];
    const selection=students.length>1?`<label>目前學生</label><select id="parentStudentSwitcher" onchange="switchParentStudent(this.value)">${students.map(s=>`<option value="${esc(s.studentId)}" ${String(s.studentId)===String(state.student?.studentId)?"selected":""}>${esc(s.name)}｜${esc(s.groupName)}團｜${esc(s.instrument)}</option>`).join("")}</select>`:`<div class="notice">目前查看：${esc(state.student?.name||"學生")}</div>`;
    return `<div class="card parent-children-card"><h2>👨‍👩‍👧 我的孩子</h2>${selection}<button type="button" class="secondary" onclick="go('register')">＋ 綁定另一位孩子</button></div>`;
  }
  window.switchParentStudent=async function(studentId){
    const next=(state.students||[]).find(s=>String(s.studentId)===String(studentId));
    if(!next||String(next.studentId)===String(state.student?.studentId))return;
    state.student=next;state.summary=null;state.practice=[];state.parentPracticeFeedback=null;state.parentPracticeFeedbackData=null;state.parentPracticeFeedbackStudentId="";state.parentPracticeLeaderboard=null;state.parentPracticeLeaderboardStudentId="";state.parentPracticeLeaderboardLoadedAt=0;state.parentPracticeLeaderboardError="";
    try{await refreshStudent();render();toast(`已切換為 ${next.name}`)}catch(e){toast("❌ "+e.message)}
  };

  home=function(){
    if(!isParent()||!state.student||!baseHome)return baseHome?baseHome():"";
    const updateScope=homeUpdateScope();
    if(updateScope!==homeUpdatesScope){homeUpdatesScope=updateScope;homeUpdates=null;homeUpdatesError="";homeUpdatesLoading=false;homeUpdatesVersion++;homeUpdatesLoadedAt=0}
    if(!homeUpdatesLoading&&Date.now()-homeUpdatesLoadedAt>60000){homeUpdatesLoadedAt=Date.now();setTimeout(loadParentHomeUpdates,0)}
    const scope=syncParentTshirtSizeScope();
    if(scope!==activityScope){
      activityScope=scope;state.parentActivityConfigs=[];state.parentActivityLoadedAt=0;state.parentActivityLoading=false;
    }
    if(!state.parentActivityLoading&&Date.now()-state.parentActivityLoadedAt>120000){
      state.parentActivityLoadedAt=Date.now();setTimeout(loadParentActivityAlerts,0);
    }
    if(!state.parentTshirtSizesLoading&&Date.now()-state.parentTshirtSizesLoadedAt>120000){state.parentTshirtSizesLoadedAt=Date.now();setTimeout(loadParentTshirtSizes,0)}
    const s=state.summary||{},sectionName=String(state.student.section||"").trim(),latest=latestPractice(),todayRows=todayPractices(),todayMinutes=todayRows.reduce((n,x)=>n+Number(x.minutes||0),0),latestText=latest?`${shortDate(latest.practiceDate)}・${Number(latest.minutes||0)} 分鐘`:"尚無紀錄",todayDone=todayRows.length>0;
    const feedbackStudentId=String(state.student.studentId||"");if(state.parentPracticeFeedbackStudentId!==feedbackStudentId&&!state.parentPracticeFeedbackLoading){state.parentPracticeFeedbackStudentId=feedbackStudentId;setTimeout(()=>loadParentPracticeFeedback(feedbackStudentId),0)}
    const action=todayDone?`<div class="notice"><b>✅ 今天已記錄 ${todayMinutes} 分鐘</b><br><span>共 ${todayRows.length} 筆練習</span></div><button class="primary" onclick="go('record')">查看練習紀錄</button><button class="secondary" style="width:100%;margin-top:10px" onclick="go('practice')">＋ 再記一筆</button>`:`<p class="muted">練習後，幫${esc(state.student.name)}記錄時間與曲目。</p><button class="primary" onclick="go('practice')">記錄練習</button>`;
    const privateLessonPanel=typeof window.privateLessonParentPanels==="function"?window.privateLessonParentPanels("home"):"";
    return `${tshirtSizeShortcut()}${todayCourseReminder()}${parentUpcomingPanel()}${parentNewsPanel()}<section class="card" id="parentPracticeAction"><h2>🎻 自主練習</h2>${action}</section><div class="card" id="parentUniformEventsEntry"><h2>🎻 活動與團服</h2>${parentTaskLauncher()}<div class="notice">報名活動、申請團服或查詢進度。</div><button type="button" class="secondary" style="width:100%;margin-top:10px" onclick="go('uniformEvents')">前往活動與團服 ›</button></div>${privateLessonPanel}<div class="card hero"><div class="student"><div class="studentleft"><div class="avatar">${esc(state.student.name?.[0]||"學")}</div><div><div class="name">${esc(state.student.name)}</div><div class="muted">${esc(state.student.groupName)}團${sectionName?`｜${esc(sectionName)}`:""}｜${esc(state.student.instrument)}｜${esc(state.student.grade)}</div></div></div><div class="pill">${new Date().getMonth()+1}月</div></div><div style="margin-top:14px;font-weight:900">本月自主練習</div><div class="grid" style="margin-top:8px"><div class="kpi"><b>${s.practiceQualifiedDays||0} 天</b><span>練習達標天數</span></div><div class="kpi"><b>${s.practiceMinutes||0} 分鐘</b><span>累計練習時間</span></div></div><div class="notice" style="margin-top:10px"><b>最近一次自主練習</b><br>${esc(latestText)}</div><details style="margin-top:12px"><summary><b>查看學習進度與出勤</b></summary>${parentMonthlyScoreOverview()}${parentFeedbackCard()}<div class="parent-detail-heading"><b>本月上課出勤明細</b><small>分部／合奏／綜合課與個別課的實際點名紀錄；上課開始後超過 10 分鐘才到課記為遲到，10 分鐘內記為出席。</small></div><div class="grid" style="margin-top:8px">${attendanceKpi("分部課",s.sectionPresent,s.sectionTotal,s.sectionLeave,s.sectionAbsent,sectionName||"目前分部")}${attendanceKpi("合奏課",s.ensemblePresent,s.ensembleTotal,s.ensembleLeave,s.ensembleAbsent,"A／B 團合奏")}${attendanceKpi("綜合課（團體課）",s.comprehensivePresent,s.comprehensiveTotal,s.comprehensiveLeave,s.comprehensiveAbsent,"A／B／儲備團")}${attendanceKpi("個別課",s.privatePresent,s.privateTotal,s.privateLeave,s.privateAbsent,"不納入課程點名 5%")}</div><button class="secondary" style="width:100%;margin-top:12px" onclick="go('record')">查看整學期上課紀錄 ›</button></details></div>${parentPracticeLeaderboardCard()}<details class="card"><summary><b>📌 自主練習登記說明</b></summary><div class="notice">自主練習紀錄將作為後續練習統計與成績計算依據。為保障學生權益，請家長於每次練習完成後確認紀錄已成功送出，並可至「紀錄」頁再次核對。<br><br><b>達標規則：單日累計自主練習達 20 分鐘以上，計為 1 個達標日；同一天多筆紀錄的分鐘數會累計，但達標日仍以 1 天計算。</b><br><br>若主要登記之家長因出差、工作或其他因素無法操作，可由另一位已綁定之監護人登入完成登記。<b>系統以「學生」為統計單位</b>，不同監護人登記的紀錄皆累計於同一位學生名下。</div></details>${studentSwitcher()}`;
  };
  if(baseNav){nav=function(){if(state.page==="contextSelect")return baseNav();if(isParent())return `<nav class="nav">${navBtn("home","🏠","首頁")}${navBtn("practice","⏱️","自主打卡")}${navBtn("record","📊","紀錄")}${navBtn("uniformEvents","🎻","活動團服")}</nav>`;return baseNav()}}
  window.parentHomeFocusReady=true;
  window.parentHomeSummaryReady=true;
})();
