(()=>{
  const teacherAccount=()=>state.me?.role!=="admin"&&["teacher","sectionTeacher","privateTeacher"].includes(state.me?.role)||state.me?.role!=="admin"&&!!state.me?.capabilities?.teacherSettings;
  const cap=()=>state.me?.capabilities||{};
  state.teacherTodayStatus=state.teacherTodayStatus||null;
  state.teacherTodayStatusDate=state.teacherTodayStatusDate||"";
  async function loadTeacherTodayStatus(date){try{state.teacherTodayStatus=await api(`/api/attendance-report?month=${encodeURIComponent(date.slice(0,7))}`);state.teacherTodayStatusDate=date;render()}catch{state.teacherTodayStatus=null;state.teacherTodayStatusDate=date}}
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

  function courseCard(page,icon,title,desc,enabled,status=""){
    if(!enabled)return "";
    const badge=status?'<span class="badge '+(status==="已完成"?'good':'bad')+'" style="margin-left:8px">'+(status==="已完成"?'✅ 已完成':'🔴 尚未點名')+'</span>':"";
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
    const hasRecord=(type,group)=>todayRecords.some(x=>(type==="private"?["private","privateLesson"].includes(String(x.classType)):String(x.classType)===type)&&(!group||String(x.groupName)===group));
    const teachingCards=[
      courseCard("section","🎼",sectionGroup?sectionGroup+"團分部課":"分部課",sectionGroup?todayName+"｜依老師設定的團別＋分部帶入學生點名":"",c.section&&hasTodaySection,hasTodaySection?(hasRecord("section",sectionGroup)?"已完成":"尚未點名"):""),
      courseCard("ensemble","🎻","A／B團合奏課","今天 12:30–13:20｜依老師設定的 A／B 團帶入學生",c.ensemble&&hasTodayEnsemble,hasTodayEnsemble?(hasRecord("ensemble")?"已完成":"尚未點名"):""),
      courseCard("comprehensive","🎶","弦樂團體課（綜合課）","今天 08:45–10:15｜A／B／儲備團共同參加",hasTodayComprehensive,hasTodayComprehensive?(hasRecord("comprehensive")?"已完成":"尚未點名"):""),
      courseCard("private","👤","個別課","依老師綁定的個課學生與實際排課進行紀錄",c.private,hasRecord("private")?"已完成":"尚未點名")
    ].filter(Boolean).join("");
    const groupSchedule=weekday===1||weekday===3?"A團分部課":weekday===2?"B團分部課＋A／B團合奏課":weekday===4?"B團分部課":weekday===5?"儲備團分部課":"無固定團體課";
    const progressCard=courseCard("practiceProgress","📚","自主練習進度","查看家長回填的練習天數、分鐘、內容與最近練習紀錄",true);
    return `<div class="card hero"><h2>🎓 今日教學</h2><div class="notice"><b>${esc(date)}｜${esc(todayName)}</b><br>今日固定課程：${esc(groupSchedule)}。首頁只顯示今天符合老師授課權限的課程。</div></div>
      <div class="card"><h2>今日課程</h2>${teachingCards||'<div class="notice">今天沒有符合您授課權限的固定課程。</div>'}</div>
      <div class="card"><h2>學生學習狀況</h2>${progressCard}</div>`;
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
