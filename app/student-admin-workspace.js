(()=>{
  if(window.__studentAdminWorkspace)return;
  window.__studentAdminWorkspace=true;

  const tasks={
    browse:{icon:"👤",title:"查詢／修改學生",description:"搜尋學生，修改資料、團別或辦理退團"},
    add:{icon:"➕",title:"新增單一學生",description:"學期中加入一位新生與正式名單"},
    import:{icon:"📥",title:"匯入學期名單",description:"整批 Excel 預覽差異後再定案"},
    upgrade:{icon:"📚",title:"學年度批次升級",description:"升年級並處理六年級畢業"}
  };
  const validTask=task=>task==="home"||Object.hasOwn(tasks,task);
  const selectedTask=()=>validTask(state.adminStudentWorkspaceTask)?state.adminStudentWorkspaceTask:"home";

  function heading(task){
    const students=Array.isArray(state.master)?state.master:[];
    const active=students.filter(student=>student.status!=="inactive").length;
    const inactive=students.length-active;
    if(task!=="home"){
      const item=tasks[task];
      return `<section class="student-workspace-heading student-workspace-heading-detail"><button type="button" class="student-workspace-back" data-student-task-open="home">← 返回學生管理選單</button><small>學生管理</small><h1>${item.icon} ${item.title}</h1><p>${item.description}</p></section>`;
    }
    const choices=Object.entries(tasks).map(([key,item])=>`<button type="button" data-student-task-open="${key}"><span class="student-task-icon" aria-hidden="true">${item.icon}</span><span><b>${item.title}</b><small>${item.description}</small></span><span aria-hidden="true">›</span></button>`).join("");
    return `<section class="student-workspace-heading"><div class="student-workspace-title"><div><small>學校後台</small><h1>學生管理</h1><p>先選擇要處理的工作，畫面只會顯示需要的資料。</p></div><button type="button" class="student-workspace-home" data-student-workspace-home>← 工作首頁</button></div><div class="student-workspace-counts"><span><b>${active}</b> 位在團</span><span><b>${inactive}</b> 位退出／停用</span></div><h2>今天要處理哪一項？</h2><div class="student-task-picker">${choices}</div><p class="student-workspace-note">學生退出後不會刪除家長綁定、點名、練習或其他歷史紀錄。</p></section>`;
  }

  const previousStudentsPage=studentsPage;
  studentsPage=function(){
    const task=selectedTask();
    return `<div class="student-admin-workspace" data-student-workspace-task="${task}">${heading(task)}${previousStudentsPage()}</div>`;
  };

  const previousGo=go;
  go=async function(page){
    if(page==="students"&&state.page!=="students")state.adminStudentWorkspaceTask="home";
    return previousGo(page);
  };

  document.addEventListener("click",async event=>{
    const button=event.target.closest?.("[data-student-task-open],[data-student-workspace-home]");
    if(!button)return;
    event.preventDefault();
    if(button.hasAttribute("data-student-workspace-home")){
      if(typeof window.openSchoolAdminWorkspace==="function")await window.openSchoolAdminWorkspace("home");
      else await go("admin");
      return;
    }
    const task=button.dataset.studentTaskOpen;
    if(!validTask(task))return;
    state.adminStudentWorkspaceTask=task;
    render();
    requestAnimationFrame(()=>{
      const target=task==="home"?document.querySelector(".student-workspace-heading"):document.querySelector(`[data-student-task-panel="${task}"]`);
      target?.scrollIntoView({block:"start",behavior:"smooth"});
    });
  });
})();
