(()=>{
  const teacherAccount=()=>state.me?.role!=="admin"&&["teacher","sectionTeacher","privateTeacher"].includes(state.me?.role)||state.me?.role!=="admin"&&!!state.me?.capabilities?.teacherSettings;
  const cap=()=>state.me?.capabilities||{};
  state.teacherTodayStatus=state.teacherTodayStatus||null;
  state.teacherTodayStatusDate=state.teacherTodayStatusDate||"";
  state.teacherAttention=state.teacherAttention||null;
  async function loadTeacherTodayStatus(date){try{const [att,practice]=await Promise.all([api(`/api/attendance-report?month=${encodeURIComponent(date.slice(0,7))}`),api(`/api/practice-progress?month=${encodeURIComponent(date.slice(0,7))}`)]);state.teacherTodayStatus=att;state.teacherAttention=practice;state.teacherTodayStatusDate=date;render()}catch{state.teacherTodayStatus=null;state.teacherAttention=null;state.teacherTodayStatusDate=date}}
  const detailPages=new Set(["section","ensemble","comprehensive","private","practiceProgress"]);
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

  function courseCard(page,icon,title,desc,enabled,progress=null){
    if(!enabled)return "";
    let badge="";
    if(progress){
      const expected=Number(progress.expected||0),recorded=Number(progress.recorded||0);
      const done=expected>0&&recorded>=expected,started=recorded>0;
      const cls=done?"good":started?"warn":"bad";
      const label=done?`✅ 已完成 ${recorded}/${expected}`:started?`⚠️ 點名未完成 ${recorded}/${expected}`:`🔴 尚未點名 0/${expected}`;
      badge='<span class="badge '+cls+'" style="margin-left:8px">'+label+'</span>';
    }
    return `<button class="item" style="width:100%;text-align:left;background:#fff;cursor:pointer" onclick="go('${page}')"><div><b>${icon} ${esc(title)}${badge}</b><small>${esc(desc)}</small></div><span style="font-size:22px">›</span></button>`;
  }

  function teacherHomePage(){
    const c=cap(),comprehensive=!!state.teacherSetup?.profile?.comprehensiveEnabled;
    const now=new Date(),weekday=now.getDay(),date=now.toLocaleDateString("sv-SE");
    const dayNames=["週日","週一","週二","週三","週四","週五","週六"],todayName=dayNames[weekday];
    const sectionGroup=(weekday===1||weekday===3)?"A":(weekday===2||weekday===4)?"B":weekday===5?"儲備":"";
    const sectionAssignments=Array.isArray(state.me?.assignments)?state.me.assignments:[];
    const hasTodaySection=!!sectionGroup&&sectionAssignments.some(x=>String(x.groupName||x.group||"")===sectionGroup);
    const ensembleGroups=Array.isArray(state.me?.ensembleGroups)?state.me.ensembleGroups:[];
    const hasTodayEnsemble=weekday===2&&ensembleGroups.some(x=>["A","B"].includes(String(x)));
    const comprehensiveDates=new Set(["2026-09-18","2026-10-02","2026-10-16","2026-10-30","2026-11-20","2026-11-27","2026-12-04"]);
    const hasTodayComprehensive=comprehensive&&comprehensiveDates.has(date);
    if(state.teacherTodayStatusDate!==date)setTimeout(()=>loadTeacherTodayStatus(date),0);
    const todayRecords=(state.teacherTodayStatus?.records||[]).filter(x=>String(x.eventDate)===date);
    const scoped=(type,group)=>todayRecords.filter(x=>(type==="private"?["private","privateLesson"].includes(String(x.classType)):String(x.classType)===type)&&(!group||String(x.groupName)===group));
    const assignmentStudents=(group)=>{const ids=new Set();for(const a of sectionAssignments){if(String(a.groupName||a.group||"")!==group)continue;for(const st of (state.teacherTodayStatus?.items||[])){if(String(st.groupName)===group&&String(st.section)===String(a.section||""))ids.add(String(st.studentId))}}return ids.size};
    const progress=(type,group,expected)=>{const rows=scoped(type,group).filter(x=>x.status!=="cancelled");const ids=new Set(rows.map(x=>String(x.studentId||"")).filter(Boolean));return {expected:Number(expected||0),recorded:ids.size}};
    const sectionExpected=hasTodaySection?assignmentStudents(sectionGroup):0;
    const ensembleExpected=hasTodayEnsemble?(state.teacherTodayStatus?.items||[]).filter(x=>ensembleGroups.includes(String(x.groupName))).length:0;
    const comprehensiveExpected=hasTodayComprehensive?(state.teacherTodayStatus?.items||[]).length:0;
    const privateExpected=c.private?(state.me?.privateStudents||state.me?.privateStudentIds||[]).length:0;
    const taskRows=[];
    const addTask=(title,p)=>{if(!p||!p.expected)return;const left=Math.max(0,p.expected-p.recorded);taskRows.push({title,done:left===0,text:left===0?`已完成 ${p.recorded}/${p.expected}`:p.recorded?`尚有 ${left} 人未完成 (${p.recorded}/${p.expected})`:`尚未點名 0/${p.expected}`})};
    if(c.section&&hasTodaySection)addTask(sectionGroup+"團分部課",progress("section",sectionGroup,sectionExpected));
    if(c.ensemble&&hasTodayEnsemble)addTask("A／B團合奏課",progress("ensemble","",ensembleExpected));
    if(hasTodayComprehensive)addTask("弦樂團體課",progress("comprehensive","",comprehensiveExpected));
    const completedTasks=taskRows.filter(x=>x.done).length,totalTasks=taskRows.length,pct=totalTasks?Math.round(completedTasks/totalTasks*100):100;
    const taskHtml=taskRows.length?taskRows.map(x=>`<div class="item" style="padding:10px 12px"><div><b>${x.done?"✅":"🔴"} ${esc(x.title)}</b><small>${esc(x.text)}</small></div></div>`).join(""):`<div class="notice">今天沒有需要固定點名的團體課；個別課採實際授課後登記。</div>`;
    const teachingCards=[
      courseCard("section","🎼",sectionGroup?sectionGroup+"團分部課":"分部課",sectionGroup?todayName+"｜依老師設定的團別＋分部帶入學生點名":"",c.section&&hasTodaySection,progress("section",sectionGroup,sectionExpected)),
      courseCard("ensemble","🎻","A／B團合奏課","今天 12:30–13:20｜依老師設定的 A／B 團帶入學生",c.ensemble&&hasTodayEnsemble,progress("ensemble","",ensembleExpected)),
      courseCard("comprehensive","🎶","弦樂團體課（綜合課）","今天 08:45–10:15｜A／B／儲備團共同參加",hasTodayComprehensive,progress("comprehensive","",comprehensiveExpected)),
      courseCard("private","👤","個別課","彈性授課｜上完即記錄，本月堂數與久未授課提醒",c.private,null)
    ].filter(Boolean).join("");
    const groupSchedule=weekday===1||weekday===3?"A團分部課":weekday===2?"B團分部課＋A／B團合奏課":weekday===4?"B團分部課":weekday===5?"儲備團分部課":"無固定團體課";
    const practiceAll=(state.teacherAttention?.items||[]).map(x=>{const gap=x.daysSincePractice==null?999:Number(x.daysSincePractice),rate=Number(x.practiceRatePercent||0),active=Number(x.activeDays||0);return {...x,_gap:gap,_rate:rate,_active:active}});\n    const practiceAttentionAll=practiceAll.filter(x=>x._gap>=3||x._rate<80).sort((a,b)=>b._gap-a._gap||a._rate-b._rate);\n    const practiceAttention=practiceAttentionAll.slice(0,5);\n    const stablePractice=practiceAll.filter(x=>x._gap<3&&x._rate>=80).length;
    const privateIds=new Set((state.me?.privateStudentIds||[]).map(String)),latestPrivate=new Map();for(const r of todayRecords.filter(x=>["private","privateLesson"].includes(String(x.classType))))latestPrivate.set(String(r.studentId),r);
    const attentionHtml=practiceAttention.length?practiceAttention.map(x=>`<div class="item" style="padding:10px 12px"><div><b>${x._gap>=7?"🔴":x._gap>=3?"🟡":"⚠️"} ${esc(x.name)}</b><small>${x._gap===999?"本月尚無自主練習":x._gap>=3?`${x._gap} 天未練習`:`目前達標率 ${x._rate}%`}｜本月 ${x._active} 天｜${esc(x.groupName)}團 ${esc(x.section)}</small></div></div>`).join(""):`<div class="notice">目前沒有明顯需要關注的自主練習紀錄。</div>`;
    const progressCard=courseCard("practiceProgress","📚","查看全部自主練習","查看完整練習進度、近期未練習與學生明細",true);
    return `<div class="card hero"><h2>🎓 今日教學</h2><div class="notice"><b>${esc(date)}｜${esc(todayName)}</b><br>今日固定課程：${esc(groupSchedule)}。首頁只顯示今天符合老師授課權限的課程。</div></div>
      <div class="card"><h2>今日點名完成度 <span style="font-size:15px">${completedTasks}/${totalTasks||0}</span></h2><div style="height:10px;background:#eef1f4;border-radius:999px;overflow:hidden;margin:8px 0 12px"><div style="height:100%;width:${pct}%;background:#4662b5;border-radius:999px"></div></div>${taskHtml}</div>
      <div class="card"><h2>今日課程</h2>${teachingCards||'<div class="notice">今天沒有符合您授課權限的固定課程。</div>'}</div>
      <div class="card"><h2>需要關注 <span class="badge warn">${practiceAttentionAll.length}</span></h2><div class="notice">依最近練習狀態判斷：連續 3 天以上未練習或目前進度未達標會列入。${stablePractice?`另有 ${stablePractice} 位學生近期穩定練習。`:""}</div>${attentionHtml}${practiceAttentionAll.length>5?`<small style="margin:8px 2px;display:block">目前先顯示最需關注的 5 人，完整名單請進入下方查看。</small>`:""}${progressCard}</div>`;
  }

  const previousNav=nav;
  nav=function(){
    if(!teacherAccount())return previousNav();
    return `<nav class="nav">${navBtn("teacherHome","🎓","教學")}${navBtn("attendance","📋","出勤")}${navBtn("teacherSettings","⚙️","我的教學")}${navBtn("help","ℹ️","說明")}</nav>`;
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

  if(teacherAccount()){
    // 登入／重新整理後固定回到「教學」首頁，避免直接落在某一種課程。
    state.page="teacherHome";
    if(!state.teacherSetup&&typeof loadTeacherSettings==="function"){
      loadTeacherSettings().finally(()=>render());
    }else render();
  }
})();
