(()=>{
  const teacherAccount=()=>state.me?.role!=="admin"&&["teacher","sectionTeacher","privateTeacher"].includes(state.me?.role)||state.me?.role!=="admin"&&!!state.me?.capabilities?.teacherSettings;
  const cap=()=>state.me?.capabilities||{};
  function teacherFinalEvalMonth(month){
    const [y,m]=String(month||"").split("-").map(Number);
    if(!y)return "";
    if(m===1)return `${y-1}-12`;
    if(m>=8)return `${y}-12`;
    return `${y}-05`;
  }
  state.teacherTodayStatus=state.teacherTodayStatus||null;
  state.teacherTodayStatusDate=state.teacherTodayStatusDate||"";
  state.teacherAttention=state.teacherAttention||null;
  state.teacherTodayCourses=state.teacherTodayCourses||[];
  state.teacherTrainingEvents=state.teacherTrainingEvents||[];
  state.teacherLearningEvaluation=state.teacherLearningEvaluation||null;
  state.teacherLearningEvaluationMonth=state.teacherLearningEvaluationMonth||"";
  async function loadTeacherTodayStatus(date){try{const month=date.slice(0,7),finalMonth=teacherFinalEvalMonth(month),needFallback=!!cap().section&&month===finalMonth;const now=new Date(),from=new Date(now),to=new Date(now);from.setMonth(from.getMonth()-5);to.setMonth(to.getMonth()+5);const dateText=d=>d.toLocaleDateString("sv-SE",{timeZone:"Asia/Taipei"});const trainingUrl=`/api/training-attendance?from=${encodeURIComponent(dateText(from))}&to=${encodeURIComponent(dateText(to))}`;const [att,practice,schedule,learning,training]=await Promise.all([api(`/api/attendance-report?month=${encodeURIComponent(month)}`),api(`/api/practice-progress?month=${encodeURIComponent(month)}`),api(`/api/school-schedule?date=${encodeURIComponent(date)}`),needFallback?api(`/api/learning-monthly-evaluation?month=${encodeURIComponent(finalMonth)}&mode=semesterFallback`).catch(()=>({items:[]})):Promise.resolve(null),api(trainingUrl).catch(()=>({items:[]}))]);state.teacherTodayStatus=att;state.teacherAttention=practice;state.teacherTodayCourses=(schedule?.items||[]).filter(x=>String(x.effectiveStatus||"active")!=="cancelled");state.teacherTrainingEvents=training?.items||[];state.teacherLearningEvaluation=learning;state.teacherLearningEvaluationMonth=month;state.teacherTodayStatusDate=date;render()}catch{state.teacherTodayStatus=null;state.teacherAttention=null;state.teacherTodayCourses=[];state.teacherTrainingEvents=[];state.teacherLearningEvaluation=null;state.teacherLearningEvaluationMonth=date.slice(0,7);state.teacherTodayStatusDate=date}}
  const detailPages=new Set(["section","ensemble","comprehensive","private"]);
  function mountTeacherBack(){
    if(!teacherAccount()||!detailPages.has(state.page)||document.getElementById("teacherHomeBack"))return;
    const main=document.querySelector(".main");if(!main)return;
    const btn=document.createElement("button");
    btn.id="teacherHomeBack";btn.className="secondary";
    btn.setAttribute("aria-label","返回今日教學");
    btn.style.cssText="width:auto;margin:0 0 12px 0;padding:9px 14px;border-radius:999px;font-weight:800;display:inline-flex;align-items:center;gap:6px";
    btn.innerHTML="← 返回今日教學";
    btn.onclick=()=>go("teacherHome");
    main.prepend(btn);
  }

  window.openTeacherCourse=async function(page,targetGroup="",targetDate=""){
    if(page==="section"){
      const group=String(targetGroup||"").trim().replace(/團$/,"");
      const date=String(targetDate||new Date().toLocaleDateString("sv-SE"));
      const assignments=Array.isArray(state.me?.assignments)?state.me.assignments:[];
      const current=assignments[Math.min(window.__sectionClassIndex||0,Math.max(assignments.length-1,0))]||assignments[0];
      const currentSection=String(current?.section||"");
      let idx=assignments.findIndex(x=>String(x.groupName||x.group||"").trim().replace(/團$/,"")===group&&String(x.section||"")===currentSection);
      if(idx<0)idx=assignments.findIndex(x=>String(x.groupName||x.group||"").trim().replace(/團$/,"")===group);
      if(idx>=0)window.__sectionClassIndex=idx;
      state.sectionSelectedDate=date;
      state.sectionManualOverride=true;
      state.sectionExisting=null;
      state.sectionExistingKey="";
    }
    await go(page);
    if(page==="section"&&!window.__attendanceEditSectionActive&&typeof loadSectionExisting==="function")setTimeout(()=>loadSectionExisting(),0);
  };
  function courseCard(page,icon,title,desc,enabled,progress=null,targetGroup="",targetDate=""){
    if(!enabled)return "";
    let badge="";
    if(progress){
      const expected=Number(progress.expected||0),recorded=Number(progress.recorded||0);
      const done=expected>0&&recorded>=expected,started=recorded>0;
      const cls=done?"good":started?"warn":"bad";
      const label=done?`✅ 已完成 ${recorded}/${expected}`:started?`⚠️ 點名未完成 ${recorded}/${expected}`:`🔴 尚未點名 0/${expected}`;
      badge='<span class="badge '+cls+'" style="margin-left:8px">'+label+'</span>';
    }
    const click=page==="section"&&targetGroup?`openTeacherCourse('section','${esc(targetGroup)}','${esc(targetDate)}')`:`go('${page}')`;
    return `<button class="item" style="width:100%;text-align:left;background:#fff;cursor:pointer" onclick="${click}"><div><b>${icon} ${esc(title)}${badge}</b><small>${esc(desc)}</small></div><span style="font-size:22px">›</span></button>`;
  }

  function teacherHomePage(){
    const c=cap(),comprehensive=!!state.teacherSetup?.profile?.comprehensiveEnabled;
    const now=new Date(),date=now.toLocaleDateString("sv-SE",{timeZone:"Asia/Taipei"}),weekday=new Date(`${date}T12:00:00+08:00`).getUTCDay();
    const dayNames=["週日","週一","週二","週三","週四","週五","週六"],todayName=dayNames[weekday];
    const sectionAssignments=Array.isArray(state.me?.assignments)?state.me.assignments:[];
    const ensembleGroups=Array.isArray(state.me?.ensembleGroups)?state.me.ensembleGroups:[];
    const todayCourses=Array.isArray(state.teacherTodayCourses)?state.teacherTodayCourses:[];
    const trainingEvents=(state.teacherTrainingEvents||[]).filter(x=>x.status==="active"),todayTraining=trainingEvents.filter(x=>x.eventDate===date);
    const normGroup=v=>String(v||"").trim().replace(/團$/,"");
    const sectionCourse=todayCourses.find(x=>String(x.courseType)==="section"&&sectionAssignments.some(a=>{
      const target=normGroup(x.groupName),g=normGroup(a.groupName||a.group);
      const section=String(x.section||"").trim(),assignedSection=String(a.section||"").trim();
      return (!target||target==="ALL"||target.split(",").map(normGroup).includes(g))&&(!section||!assignedSection||section===assignedSection);
    }));
    const sectionGroup=normGroup(sectionCourse?.groupName||"");
    const hasTodaySection=!!sectionCourse;
    const hasTodayEnsemble=todayCourses.some(x=>String(x.courseType)==="ensemble"&&(!x.groupName||String(x.groupName)==="ALL"||String(x.groupName).split(",").map(normGroup).some(g=>ensembleGroups.map(normGroup).includes(g))));
    const hasTodayComprehensive=comprehensive&&todayCourses.some(x=>String(x.courseType)==="comprehensive");
    if(state.teacherTodayStatusDate!==date||state.teacherLearningEvaluationMonth!==date.slice(0,7))setTimeout(()=>loadTeacherTodayStatus(date),0);
    const todayRecords=(state.teacherTodayStatus?.records||[]).filter(x=>String(x.eventDate)===date);
    const scoped=(type,group)=>todayRecords.filter(x=>(type==="private"?["private","privateLesson"].includes(String(x.classType)):String(x.classType)===type)&&(!group||String(x.groupName)===group));
    const assignmentStudents=(group)=>{const ids=new Set();for(const a of sectionAssignments){if(String(a.groupName||a.group||"")!==group)continue;for(const st of (state.teacherTodayStatus?.items||[])){if(String(st.groupName)===group&&String(st.section)===String(a.section||""))ids.add(String(st.studentId))}}return ids.size};
    const progress=(type,group,expected)=>{const rows=scoped(type,group).filter(x=>x.status!=="cancelled");const ids=new Set(rows.map(x=>String(x.studentId||"")).filter(Boolean));return {expected:Number(expected||0),recorded:ids.size}};
    const activeSection=sectionAssignments[Math.min(window.__sectionClassIndex||0,Math.max(sectionAssignments.length-1,0))]||sectionAssignments[0];
    const loadedSectionKey=[date,sectionGroup,String(activeSection?.section||"")].join("|");
    const mergedRosterReady=state.sectionSessionKey===loadedSectionKey&&Array.isArray(state.sectionSessionMerges)&&state.sectionSessionMerges.length>0;
    const sectionExpected=hasTodaySection?(mergedRosterReady?state.sectionSessionRoster.length:assignmentStudents(sectionGroup)):0;
    const ensembleExpected=hasTodayEnsemble?(state.teacherTodayStatus?.items||[]).filter(x=>ensembleGroups.includes(String(x.groupName))).length:0;
    const comprehensiveExpected=hasTodayComprehensive?(state.teacherTodayStatus?.items||[]).length:0;
    const privateExpected=c.private?(state.me?.privateStudents||state.me?.privateStudentIds||[]).length:0;
    const taskRows=[];
    const addTask=(title,p)=>{if(!p||!p.expected)return;const left=Math.max(0,p.expected-p.recorded);taskRows.push({title,done:left===0,text:left===0?`已完成 ${p.recorded}/${p.expected}`:p.recorded?`尚有 ${left} 人未完成 (${p.recorded}/${p.expected})`:`尚未點名 0/${p.expected}`})};
    if(c.section&&hasTodaySection)addTask(sectionGroup+"團分部課",mergedRosterReady?{expected:sectionExpected,recorded:state.sectionSessionLoaded}:progress("section",sectionGroup,sectionExpected));
    if(c.ensemble&&hasTodayEnsemble)addTask("A／B團合奏課",progress("ensemble","",ensembleExpected));
    if(hasTodayComprehensive)addTask("弦樂團體課",progress("comprehensive","",comprehensiveExpected));
    for(const x of todayTraining)addTask(x.title||"週六加練",{expected:x.expected,recorded:x.recorded});
    const completedTasks=taskRows.filter(x=>x.done).length,totalTasks=taskRows.length,pct=totalTasks?Math.round(completedTasks/totalTasks*100):100;
    const taskHtml=taskRows.length?taskRows.map(x=>`<div class="item" style="padding:10px 12px"><div><b>${x.done?"✅":"🔴"} ${esc(x.title)}</b><small>${esc(x.text)}</small></div></div>`).join(""):`<div class="notice">今天沒有需要固定點名的團體課；個別課請先建立預約，上課後再送家長確認。</div>`;
    const teachingCards=[
      courseCard("section","🎼",sectionGroup?sectionGroup+"團分部課":"分部課",sectionGroup?todayName+"｜依老師設定的團別＋分部帶入學生點名":"",c.section&&hasTodaySection,mergedRosterReady?{expected:sectionExpected,recorded:state.sectionSessionLoaded}:progress("section",sectionGroup,sectionExpected),sectionGroup,date),
      courseCard("ensemble","🎻","A／B團合奏課","今天 12:30–13:20｜依老師設定的 A／B 團帶入學生",c.ensemble&&hasTodayEnsemble,progress("ensemble","",ensembleExpected)),
      courseCard("comprehensive","🎶","弦樂團體課（綜合課）","今天 08:45–10:15｜A／B／儲備團共同參加",hasTodayComprehensive,progress("comprehensive","",comprehensiveExpected)),
      courseCard("private","👤","個別課","預約、改期／停課、完課與家長確認；完成次數自動換算個課 5%",c.private,null)
    ].filter(Boolean).join("");
    const trainingCards=todayTraining.map(x=>`<button class="item" style="width:100%;text-align:left;background:#fff;cursor:pointer" onclick="openTrainingAttendance('${esc(x.eventId)}')"><div><b>🏆 ${esc(x.title)} <span class="badge ${x.expected&&x.recorded>=x.expected?"good":"warn"}">${x.recorded}/${x.expected} 已點名</span></b><small>${esc(x.eventDate)} ${esc(x.startTime)}–${esc(x.endTime)}｜${esc(x.targetGroups)} 團</small></div><span style="font-size:22px">›</span></button>`).join("");
    const trainingEntry=trainingEvents.length?`<div class="card"><h2>🏆 加練點名</h2><div class="notice">週六加練獨立點名；早自習加練免點名。加練紀錄不列入一般課程出勤 5%。</div>${trainingCards}<button class="secondary" style="width:100%;margin-top:9px" onclick="openTrainingAttendance()">查看我的加練場次與既有點名</button></div>`:"";
    const todayLabels=todayCourses.filter(x=>["section","ensemble","comprehensive"].includes(String(x.courseType||""))).map(x=>String(x.courseName||"課程")).filter(Boolean);const groupSchedule=todayLabels.length?[...new Set(todayLabels)].join("＋"):"無固定團體課";
    const practiceAll=(state.teacherAttention?.items||[]).map(x=>{const gap=x.daysSincePractice==null?999:Number(x.daysSincePractice),rate=Number(x.practiceRatePercent||0),active=Number(x.activeDays||0);return {...x,_gap:gap,_rate:rate,_active:active}});
    // 關注排序：優先抓出「原本有練習、但近期中斷」的學生，避免本月從未練習者長期佔滿首頁。
    // 權重：有練習且 >=7 天未練 > 有練習且 3–6 天未練 > 本月尚未練習 > 其他未達標。
    const attentionRank=x=>x._active>0&&x._gap>=7?0:x._active>0&&x._gap>=3?1:x._active===0?2:3;
    const practiceAttentionAll=practiceAll.filter(x=>x._gap>=3||x._rate<80).sort((a,b)=>attentionRank(a)-attentionRank(b)||b._gap-a._gap||b._active-a._active||a._rate-b._rate);
    const practiceAttention=practiceAttentionAll.slice(0,5);
    const stablePractice=practiceAll.filter(x=>x._gap<3&&x._rate>=80).length;
    const privateIds=new Set((state.me?.privateStudentIds||[]).map(String)),latestPrivate=new Map();for(const r of todayRecords.filter(x=>["private","privateLesson"].includes(String(x.classType))))latestPrivate.set(String(r.studentId),r);
    const attentionHtml=practiceAttention.length?practiceAttention.map(x=>`<div class="item" style="padding:10px 12px"><div><b>${x._gap>=7?"🔴":x._gap>=3?"🟡":"⚠️"} ${esc(x.name)}</b><small>${x._gap===999?"本月尚無自主練習":x._gap>=3?`${x._gap} 天未練習`:`目前達標率 ${x._rate}%`}｜本月 ${x._active} 天｜${esc(x.groupName)}團 ${esc(x.section)}</small></div></div>`).join(""):`<div class="notice">目前沒有明顯需要關注的自主練習紀錄。</div>`;
    const month=date.slice(0,7),finalEvalMonth=teacherFinalEvalMonth(month),finalEvalOpen=!!c.section&&month===finalEvalMonth;
    const fallbackItems=Array.isArray(state.teacherLearningEvaluation?.items)?state.teacherLearningEvaluation.items:[],eligible=fallbackItems.filter(x=>x.fallbackEligible);
    const evalDone=eligible.filter(x=>!!x.myRating).length,evalPending=Math.max(0,eligible.length-evalDone),evalPct=eligible.length?Math.round(evalDone/eligible.length*100):100;
    const evaluationSection=finalEvalOpen?`<div class="card"><h2>📌 學期末待辦</h2><div class="teacher-monthly-task ${evalPending?"has-pending":"is-done"}">
      <div class="teacher-monthly-task-head"><div><b>📊 學期末分部評量</b><small>只評整學期沒有完成個別課的學生｜每學期一次</small></div><span class="badge ${evalPending?"warn":"ok"}">${evalDone}/${eligible.length}</span></div>
      <div class="teacher-monthly-task-progress"><i style="width:${evalPct}%"></i></div>
      <div class="teacher-monthly-task-note">${eligible.length===0?"✅ 本學期沒有需要分部老師替代評量的學生。":evalPending?`尚有 ${evalPending} 位未參加個課的學生待評量。`:"✅ 本學期替代評量已全部完成。"}</div>
      <button class="primary" style="width:100%;margin-top:9px" onclick="go('teacherEvaluation')">${evalPending?"立即完成期末評量":"查看期末評量"} →</button>
    </div></div>`:"";
    const progressCard=`<button class="item" style="width:100%;text-align:left;background:#fff;cursor:pointer" onclick="go('practiceProgress')"><div><b>📚 自主練習進度</b><small>查看練習天數、需要關注學生與日常鼓勵；平時不需要做正式評量</small></div><span style="font-size:22px">›</span></button>`;
    return `<div class="card hero"><h2>🎓 今日教學</h2><div class="notice"><b>${esc(date)}｜${esc(todayName)}</b><br>今日固定課程：${esc(groupSchedule)}。首頁只顯示今天符合老師授課權限的課程。</div></div>
      <div class="card"><h2>今日點名完成度 <span style="font-size:15px">${completedTasks}/${totalTasks||0}</span></h2><div style="height:10px;background:#eef1f4;border-radius:999px;overflow:hidden;margin:8px 0 12px"><div style="height:100%;width:${pct}%;background:#4662b5;border-radius:999px"></div></div>${taskHtml}</div>
      <div class="card"><h2>今日課程</h2>${teachingCards||'<div class="notice">今天沒有符合您授課權限的固定課程。</div>'}</div>
      ${trainingEntry}
      ${evaluationSection}
      <div class="card"><h2>需要關注 <span class="badge warn">${practiceAttentionAll.length}</span></h2><div class="notice">這裡只協助老師掌握自主練習狀況；需要時可給日常鼓勵，但不影響正式成績。${stablePractice?`另有 ${stablePractice} 位學生近期穩定練習。`:""}</div>${attentionHtml}${practiceAttentionAll.length>5?`<small style="margin:8px 2px;display:block">目前先顯示最需關注的 5 人，完整名單請進入下方查看。</small>`:""}${progressCard}</div>`;
  }

  const previousNav=nav;
  nav=function(){
    if(state.page==="contextSelect")return previousNav();
    if(!teacherAccount())return previousNav();
    return `<nav class="nav">${navBtn("teacherHome","🎓","教學")}${navBtn("attendance","📋","出勤")}${cap().section?navBtn("teacherEvaluation","📊","期末評量"):""}${navBtn("teacherSettings","⚙️","我的教學")}</nav>`;
  };

  const previousGo=go;
  go=async function(p){
    if(p==="teacherHome"&&teacherAccount()){
      state.page="teacherHome";
      render();
      return;
    }
    return previousGo(p);
  };

  const previousRender=render;
  render=function(){
    if(teacherAccount()&&state.page==="teacherHome"){
      document.getElementById("app").innerHTML=shell(teacherHomePage());
      return;
    }
    const result=previousRender();
    setTimeout(mountTeacherBack,0);
    return result;
  };

  if(teacherAccount()&&state.page!=="contextSelect"){
    // 登入／重新整理後固定回到「教學」首頁；模組初始化期間不重複改寫整頁。
    state.page="teacherHome";
    if(!state.teacherSetup&&typeof loadTeacherSettings==="function"&&!state.teacherSetupInitPromise){
      state.teacherSetupInitPromise=loadTeacherSettings();
    }
    if(!window.__roleModuleBootstrap){
      const ready=state.teacherSetupInitPromise||Promise.resolve();
      ready.finally(()=>render());
    }
  }
})();
