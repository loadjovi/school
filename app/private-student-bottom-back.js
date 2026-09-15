(()=>{
  function mountPrivateStudentBottomBack(){
    if(state?.page!=="privateStudents")return;
    const main=document.querySelector(".main");
    if(!main||document.getElementById("privateStudentsBottomBack"))return;
    const card=document.createElement("div");
    card.className="card";
    card.id="privateStudentsBottomBack";
    card.innerHTML=`<button class="secondary" style="width:100%;padding:12px" onclick="go('teacherSettings')">← 返回我的教學</button>`;
    main.appendChild(card);
  }

  const baseRender=render;
  render=function(){
    const result=baseRender();
    setTimeout(mountPrivateStudentBottomBack,0);
    return result;
  };

  setTimeout(mountPrivateStudentBottomBack,0);
})();
