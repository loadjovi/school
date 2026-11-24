(()=>{
  if(typeof state==="undefined"||typeof render!=="function")return;
  const localDate=()=>new Date().toLocaleDateString("sv-SE");
  state.adminAttendanceAssist=state.adminAttendanceAssist||{
    date:localDate(),type:"section",groupName:"A",section:"小提一部",
    data:null,loading:false,error:""
  };
  const statusText={present:"出席",late:"遲到",leave:"請假",absent:"缺席",cancelled:"停課"};
  const typeText={section:"分部課",ensemble:"合奏課",comprehensive:"綜合課"};
  function scopeKey(){
    let school="",role="";
    try{school=sessionStorage.getItem("school_context_id")||"";role=sessionStorage.getItem("role_context")||""}catch{}
    return JSON.stringify([state.token||"",state.me?.identityId||state.me?.email||"",state.me?.role||"",state.me?.schoolId||"",school,role]);
  }
  const readScope=()=>typeof apiReadScope==="function"?apiReadScope():scopeKey();
  const selectionKey=()=>{
    const a=state.adminAttendanceAssist;
    return JSON.stringify([a.type,a.date,a.type==="comprehensive"?"":a.groupName,a.type==="section"?a.section:""]);
  };
  let assistScope=scopeKey(),verifiedMaster=null,loadedSelection="",loadSequence=0,draftStatuses=null;
  function syncScope(){
    const scope=scopeKey();
    if(scope!==assistScope){
      assistScope=scope;verifiedMaster=[];loadedSelection="";draftStatuses=null;loadSequence++;
      Object.assign(state.adminAttendanceAssist,{data:null,loading:false,saving:false,error:""});
    }
    return scope;
  }
  function loadedData(){
    syncScope();
    return loadedSelection===selectionKey()?state.adminAttendanceAssist.data:null;
  }

  function masters(){
    syncScope();
    return (verifiedMaster??state.master??[]).filter(s=>String(s.status||"active")!=="inactive");
  }
  function groupsForType(){
    const a=state.adminAttendanceAssist;
    if(a.type==="ensemble")return ["A","B"];
    if(a.type==="comprehensive")return [];
    return [...new Set(masters().map(s=>String(s.groupName||"")).filter(Boolean))].sort();
  }
  function sectionsForGroup(){
    const a=state.adminAttendanceAssist;
    return [...new Set(masters().filter(s=>String(s.groupName||"")===String(a.groupName||"")).map(s=>String(s.section||"待確認")).filter(Boolean))].sort((x,y)=>x.localeCompare(y,"zh-Hant"));
  }
  function normalizeSelection(){
    const a=state.adminAttendanceAssist,groups=groupsForType();
    if(groups.length&&!groups.includes(a.groupName))a.groupName=groups[0];
    if(a.type==="section"){
      const ss=sectionsForGroup();
      if(ss.length&&!ss.includes(a.section))a.section=ss[0];
    }
  }
  function roster(){
    normalizeSelection();
    const a=state.adminAttendanceAssist,all=masters(),data=loadedData();
    if(a.type==="comprehensive")return all.filter(s=>["A","B","儲備"].includes(String(s.groupName||"")));
    if(a.type==="ensemble")return all.filter(s=>String(s.groupName||"")===String(a.groupName||""));
    if(Array.isArray(data?.roster)&&data.sessionDate===a.date&&data.groupName===a.groupName&&data.section===a.section)return data.roster;
    return all.filter(s=>String(s.groupName||"")===String(a.groupName||"")&&String(s.section||"待確認")===String(a.section||""));
  }
  function endpoint(){
    const a=state.adminAttendanceAssist,d=encodeURIComponent(a.date||"");
    if(a.type==="comprehensive")return "/api/comprehensive-attendance?sessionDate="+d;
    if(a.type==="ensemble")return "/api/ensemble-attendance?sessionDate="+d+"&groupName="+encodeURIComponent(a.groupName||"");
    return "/api/section-attendance?sessionDate="+d+"&groupName="+encodeURIComponent(a.groupName||"")+"&section="+encodeURIComponent(a.section||"");
  }
  function postUrl(){
    const t=state.adminAttendanceAssist.type;
    return t==="comprehensive"?"/api/comprehensive-attendance":t==="ensemble"?"/api/ensemble-attendance":"/api/section-attendance";
  }

  window.adminAssistChange=function(field,value){
    if(!["type","date","groupName","section"].includes(field)||state.me?.role!=="admin"||state.adminAttendanceAssist.saving)return;
    syncScope();loadSequence++;loadedSelection="";draftStatuses=null;
    const a=state.adminAttendanceAssist;
    a[field]=String(value||"");a.data=null;a.error="";a.loading=false;
    normalizeSelection();mount();
  };
  window.adminAssistLoad=async function(){
    if(state.me?.role!=="admin")return;
    const a=state.adminAttendanceAssist,scope=syncScope(),requestScope=readScope(),sequence=++loadSequence;
    let selected=selectionKey();
    const ownsLoad=()=>state.me?.role==="admin"&&scopeKey()===scope&&sequence===loadSequence&&selectionKey()===selected;
    const current=()=>ownsLoad()&&readScope()===requestScope;
    a.loading=true;a.error="";a.data=null;loadedSelection="";draftStatuses=null;mount();
    try{
      // Attendance reads contain saved marks, not the full class. In particular,
      // an administrator who also teaches must use the complete school master,
      // rather than their teaching mappings or an unfinished startup snapshot.
      const master=await api("/api/student-master",{cache:"no-store"});
      if(!current())return;
      if(!Array.isArray(master?.items))throw new Error("學生名單格式不完整，請重新載入");
      verifiedMaster=master.items;
      normalizeSelection();selected=selectionKey();
      const data=await api(endpoint(),{cache:"no-store"});
      if(!current())return;
      if(!data||typeof data!=="object")throw new Error("點名紀錄格式不完整，請重新載入");
      a.data=data;loadedSelection=selected;
    }catch(e){
      if(!current())return;
      a.data=null;a.error="名單或點名紀錄載入失敗，請重新載入。"+(e.message||String(e));
    }finally{
      if(ownsLoad()){
        if(readScope()!==requestScope)a.error="資料已更新，請重新載入學生名單。";
        a.loading=false;mount();
      }
    }
  };
  window.adminAssistSave=async function(){
    if(state.me?.role!=="admin")return;
    const scope=syncScope(),selected=selectionKey();
    if(state.adminAttendanceAssist.loading||state.adminAttendanceAssist.saving||!loadedData()){
      toast("請先載入目前課程的學生名單，再儲存點名");return;
    }
    const a=state.adminAttendanceAssist,list=roster();
    if(!list.length){toast("目前條件沒有學生資料");return}
    const items=list.map(s=>{
      const status=String(document.getElementById("admAtt_"+s.studentId)?.value||"present");
      const minutes=a.type==="comprehensive"?90:a.type==="ensemble"?50:45;
      return {studentId:s.studentId,status,minutes:["present","late"].includes(status)?minutes:0};
    });
    const body={sessionDate:a.date,items};
    if(a.type!=="comprehensive")body.groupName=a.groupName;
    if(a.type==="section")body.section=a.section;
    const label=[a.date,typeText[a.type],a.groupName?String(a.groupName)+"團":"",a.type==="section"?a.section:""].filter(Boolean).join("｜");
    if(!confirm("確定由目前管理員帳號協助完成點名？\n\n"+label+"\n\n儲存後會直接同步到授課老師的點名畫面。"))return;
    const current=()=>state.me?.role==="admin"&&scopeKey()===scope&&selectionKey()===selected;
    draftStatuses=new Map(items.map(item=>[String(item.studentId),item.status]));
    a.saving=true;mount();
    try{
      await api(postUrl(),{method:"POST",body:JSON.stringify(body)});
      if(!current())return;
      await adminAssistLoad();
      if(!current())return;
      // Refresh the separately loaded daily report; otherwise today's cards retain
      // their previous snapshot until the user manually reloads them.
      if(typeof window.todayAdminFollowup==="function"&&a.date===localDate()){
        await window.todayAdminFollowup();
      }else if(typeof window.refreshAdminFollowup==="function"&&state.adminOps?.date===a.date){
        await window.refreshAdminFollowup();
      }
      toast("✅ 此分部點名已儲存；今日總覽已重新整理（全團完成需各分部皆點名）");
    }catch(e){if(current())toast("❌ "+e.message)}
    finally{if(state.me?.role==="admin"&&scopeKey()===scope){a.saving=false;mount()}}
  };

  function cardHtml(){
    normalizeSelection();
    const a=state.adminAttendanceAssist,groups=groupsForType(),sections=sectionsForGroup(),list=roster(),data=loadedData();
    const saved=new Map((data?.items||[]).map(x=>[String(x.studentId),String(x.status||"present")]));
    const savedCount=list.filter(student=>saved.has(String(student.studentId))).length;
    const complete=list.length>0&&savedCount>=list.length;
    const sectionStatus=data&&list.length
      ? `<div class="notice" style="margin-top:10px"><b>${complete?"✅ 此分部已完成點名":"⚠️ 此分部點名未完成"}：${savedCount}/${list.length} 人</b><br>此處僅代表目前選擇的${esc(typeText[a.type])}${a.type==="section"?"「"+esc(a.section)+"」":""}；今日全團統計仍須其他分部完成。</div>`
      : "";
    const recorded=data?.recordedBy
      ? `<div class="notice" style="margin-top:10px">目前已有點名：<b>${esc(data.recordedBy)}</b>${data.recordedByRole==="admin"?"（行政協助）":""}</div>`
      : "";
    const error=a.error?`<div class="error" style="margin-top:10px">${esc(a.error)}</div>`:"";
    const mergeNotice=data?.merges?.length?`<div class="notice" style="margin-top:10px">🎼 今日併班：${data.merges.map(x=>esc(x.sourceSection)).join("、")} 併入 ${esc(a.section)}。本名單包含兩個分部，工時按一堂認列。</div>`:"";
    const listHtml=data&&list.length
      ? `<div style="margin-top:12px"><b>${esc(typeText[a.type])}學生｜${list.length} 人</b>
          ${list.map(s=>`<div class="item"><div><b>${esc(s.name)}</b><small>${esc(s.groupName||"")}團｜${esc(s.section||"待確認")}｜${esc(s.instrument||"")}</small></div>
          <select id="admAtt_${esc(s.studentId)}" class="status-select" ${a.saving?"disabled":""}>
            ${Object.entries(statusText).map(([k,t])=>`<option value="${k}" ${(draftStatuses?.get(String(s.studentId))||saved.get(String(s.studentId))||"present")===k?"selected":""}>${t}</option>`).join("")}
          </select></div>`).join("")}
          <button class="primary" onclick="adminAssistSave()" ${a.saving?"disabled":""}>${a.saving?"⏳ 正在儲存":"✅ 儲存並完成一般課程點名"}</button>
        </div>`
      : data?'<div class="notice" style="margin-top:10px">目前條件沒有學生資料。</div>':"";

    return `<div class="card aw-attendance-assist-card" id="adminAttendanceAssist">
      <span class="aw-attendance-kicker">一般課程</span><h2>📋 幹部代點名</h2>
      <div class="aw-attendance-steps" aria-label="一般課程代點名三步驟"><span><b>1</b>選課程</span><span><b>2</b>載入學生</span><span><b>3</b>儲存完成</span></div>
      <div class="notice">老師臨時無法操作時，幹部可代為點名。儲存後會直接同步至老師端，不會產生第二份紀錄。</div>
      <label>課程類型</label>
      <select onchange="adminAssistChange('type',this.value)" ${a.saving?"disabled":""}>
        <option value="section" ${a.type==="section"?"selected":""}>分部課</option>
        <option value="ensemble" ${a.type==="ensemble"?"selected":""}>合奏課</option>
        <option value="comprehensive" ${a.type==="comprehensive"?"selected":""}>綜合課</option>
      </select>
      <label>上課日期</label><input type="date" value="${esc(a.date)}" onchange="adminAssistChange('date',this.value)" ${a.saving?"disabled":""}>
      ${a.type!=="comprehensive"?`<label>團別</label><select onchange="adminAssistChange('groupName',this.value)" ${a.saving?"disabled":""}>${groups.map(g=>`<option value="${esc(g)}" ${String(a.groupName)===String(g)?"selected":""}>${esc(g)}團</option>`).join("")}</select>`:""}
      ${a.type==="section"?`<label>分部</label><select onchange="adminAssistChange('section',this.value)" ${a.saving?"disabled":""}>${sections.map(s=>`<option value="${esc(s)}" ${String(a.section)===String(s)?"selected":""}>${esc(s)}</option>`).join("")}</select>`:""}
      <button class="secondary" style="width:100%;margin-top:10px" onclick="adminAssistLoad()" ${a.loading||a.saving?"disabled":""}>${a.loading?"⏳ 正在載入":"載入學生名單，開始點名"}</button>
      ${sectionStatus}${recorded}${mergeNotice}${error}${listHtml}
    </div>`;
  }

  function mount(){
    if(state.me?.role!=="admin")return;
    const workspace=state.page==="admin"&&state.adminWorkspaceSection==="attendance"&&state.adminAttendanceWorkspaceTask==="regular";
    if(state.page!=="attendance"&&!workspace)return;
    const main=document.querySelector(".main");if(!main)return;
    const target=workspace?document.querySelector("#schoolAdminWorkspace .aw-attendance-assist-slot"):main;
    if(!target)return;
    let root=document.getElementById("adminAttendanceAssistRoot");
    if(!root){root=document.createElement("div");root.id="adminAttendanceAssistRoot"}
    if(root.parentElement!==target)target.prepend(root);
    root.innerHTML=cardHtml();
  }
  // The simplified school workspace keeps state.page='admin', not 'attendance'.
  // Expose the existing attendance editor there without duplicating data or APIs.
  window.mountAdminAttendanceAssist=function(){
    if(state.me?.role!=="admin")return;
    const workspace=state.page==="admin"&&state.adminWorkspaceSection==="attendance"&&state.adminAttendanceWorkspaceTask==="regular";
    if(!workspace)return;
    const target=document.querySelector("#schoolAdminWorkspace .aw-attendance-assist-slot");
    if(!target)return;
    const existing=document.getElementById("adminAttendanceAssistRoot");
    const changedScope=scopeKey()!==assistScope;
    syncScope();
    if(existing?.parentElement===target&&!changedScope)return;
    mount();
  };

  const baseRender=render;
  render=function(){
    const r=baseRender();
    if(state.me?.role==="admin"&&state.page==="attendance")setTimeout(mount,0);
    return r;
  };
  if(state.me?.role==="admin"&&state.page==="attendance")setTimeout(mount,0);
})();
