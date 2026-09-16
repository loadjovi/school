(()=>{
  const teacherAccount=()=>state.me?.role!=="admin"&&(state.me?.role==="teacher"||state.me?.capabilities?.teacherSettings);
  const cap=()=>state.me?.capabilities||{};

  function courseCard(page,icon,title,desc,enabled){
    if(!enabled)return "";
    return `<button class="item" style="width:100%;text-align:left;background:#fff;cursor:pointer" onclick="go('${page}')"><div><b>${icon} ${esc(title)}</b><small>${esc(desc)}</small></div><span style="font-size:22px">›</span></button>`;
  }

  function teacherHomePage(){
    const c=cap(),comprehensive=!!state.teacherSetup?.profile?.comprehensiveEnabled;
    const teachingCards=[
      courseCard("section","🎼","分部課","A團週一、週三；B團週二、週四；儲備團週五。依團別＋分部帶入學生點名",c.section),
      courseCard("ensemble","🎻","合奏課","A／B團每週二 12:30–13:20，依團別帶入全部分部學生",c.ensemble),
      courseCard("comprehensive","🎶","綜合課","A／B／儲備團共同參加；本學期 7 次，整團點名",comprehensive),
      courseCard("private","👤","個別課","查看自己綁定的個課學生並記錄課程",c.private)
    ].filter(Boolean).join("");
    const progressCard=courseCard("practiceProgress","📚","自主練習進度","查看家長回填的練習天數、分鐘、內容與最近練習紀錄",true);
    return `<div class="card hero"><h2>🎓 我的教學</h2><div class="notice">請選擇本次要進行的課程。授課範圍由「⚙️ 我的教學」設定，可同時擁有分部課、合奏課、綜合課與個別課。</div></div>
      <div class="card"><h2>教學區域</h2>${teachingCards||'<div class="notice">目前尚未設定任何教學區域。請先到「我的教學」勾選授課範圍。</div>'}${!teachingCards?'<button class="primary" onclick="go(\'teacherSettings\')">前往設定我的教學</button>':''}</div>
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
    return previousRender();
  };

  if(teacherAccount()){
    // 登入／重新整理後固定回到「教學」首頁，避免直接落在某一種課程。
    state.page="teacherHome";
    if(!state.teacherSetup&&typeof loadTeacherSettings==="function"){
      loadTeacherSettings().finally(()=>render());
    }else render();
  }
})();
