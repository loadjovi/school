(()=>{
  if(typeof state==="undefined"||typeof render!=="function")return;
  const localDate=()=>new Date().toLocaleDateString("sv-SE");
  state.adminAttendanceAssist=state.adminAttendanceAssist||{
    date:localDate(),type:"section",groupName:"A",section:"小提一部",
    data:null,loading:false,error:""
  };
  const statusText={present:"出席",late:"遲到",leave:"請假",absent:"缺席",cancelled:"停課"};
  const typeText={section:"分部課",ensemble:"合奏課",comprehensive:"綜合課"};

  function masters(){
    return (state.master||[]).filter(s=>String(s.status||"active")!=="inactive");
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
    const a=state.adminAttendanceAssist,all=masters();
    if(a.type==="comprehensive")return all.filter(s=>["A","B","儲備"].includes(String(s.groupName||"")));
    if(a.type==="ensemble")return all.filter(s=>String(s.groupName||"")===String(a.groupName||""));
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
    const a=state.adminAttendanceAssist;
    a[field]=String(value||"");a.data=null;a.error="";
    normalizeSelection();mount();
  };
  window.adminAssistLoad=async function(){
    const a=state.adminAttendanceAssist;
    a.loading=true;a.error="";mount();
    try{a.data=await api(endpoint())}
    catch(e){a.data=null;a.error=e.message||String(e)}
    a.loading=false;mount();
  };
  window.adminAssistSave=async function(){
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
    try{
      await api(postUrl(),{method:"POST",body:JSON.stringify(body)});
      toast("✅ 行政協助點名已儲存，老師端會同步更新");
      await adminAssistLoad();
    }catch(e){toast("❌ "+e.message)}
  };

  function cardHtml(){
    normalizeSelection();
    const a=state.adminAttendanceAssist,groups=groupsForType(),sections=sectionsForGroup(),list=roster();
    const saved=new Map((a.data?.items||[]).map(x=>[String(x.studentId),String(x.status||"present")]));
    const recorded=a.data?.recordedBy
      ? `<div class="notice" style="margin-top:10px">目前已有點名：<b>${esc(a.data.recordedBy)}</b>${a.data.recordedByRole==="admin"?"（行政協助）":""}</div>`
      : "";
    const error=a.error?`<div class="error" style="margin-top:10px">${esc(a.error)}</div>`:"";
    const listHtml=a.data&&list.length
      ? `<div style="margin-top:12px"><b>${esc(typeText[a.type])}學生｜${list.length} 人</b>
          ${list.map(s=>`<div class="item"><div><b>${esc(s.name)}</b><small>${esc(s.groupName||"")}團｜${esc(s.section||"待確認")}｜${esc(s.instrument||"")}</small></div>
          <select id="admAtt_${esc(s.studentId)}" class="status-select">
            ${Object.entries(statusText).map(([k,t])=>`<option value="${k}" ${(saved.get(String(s.studentId))||"present")===k?"selected":""}>${t}</option>`).join("")}
          </select></div>`).join("")}
          <button class="primary" onclick="adminAssistSave()">✅ 儲存行政協助點名</button>
        </div>`
      : a.data?'<div class="notice" style="margin-top:10px">目前條件沒有學生資料。</div>':"";

    return `<div class="card" id="adminAttendanceAssist">
      <h2>🧑‍💼 行政協助點名</h2>
      <div class="notice">授課老師臨時來不及操作平台時，學校管理員可在這裡直接代為點名。儲存的是同一份正式出勤紀錄，老師端會自動同步，不會產生第二份資料。</div>
      <label>課程類型</label>
      <select onchange="adminAssistChange('type',this.value)">
        <option value="section" ${a.type==="section"?"selected":""}>分部課</option>
        <option value="ensemble" ${a.type==="ensemble"?"selected":""}>合奏課</option>
        <option value="comprehensive" ${a.type==="comprehensive"?"selected":""}>綜合課</option>
      </select>
      <label>上課日期</label><input type="date" value="${esc(a.date)}" onchange="adminAssistChange('date',this.value)">
      ${a.type!=="comprehensive"?`<label>團別</label><select onchange="adminAssistChange('groupName',this.value)">${groups.map(g=>`<option value="${esc(g)}" ${String(a.groupName)===String(g)?"selected":""}>${esc(g)}團</option>`).join("")}</select>`:""}
      ${a.type==="section"?`<label>分部</label><select onchange="adminAssistChange('section',this.value)">${sections.map(s=>`<option value="${esc(s)}" ${String(a.section)===String(s)?"selected":""}>${esc(s)}</option>`).join("")}</select>`:""}
      <button class="secondary" style="width:100%;margin-top:10px" onclick="adminAssistLoad()" ${a.loading?"disabled":""}>${a.loading?"⏳ 正在載入":"🔄 載入目前點名／開始點名"}</button>
      ${recorded}${error}${listHtml}
    </div>`;
  }

  function mount(){
    if(state.me?.role!=="admin"||state.page!=="attendance")return;
    const main=document.querySelector(".main");if(!main)return;
    let root=document.getElementById("adminAttendanceAssistRoot");
    if(!root){root=document.createElement("div");root.id="adminAttendanceAssistRoot";main.prepend(root)}
    root.innerHTML=cardHtml();
  }

  const baseRender=render;
  render=function(){
    const r=baseRender();
    if(state.me?.role==="admin"&&state.page==="attendance")setTimeout(mount,0);
    return r;
  };
  if(state.me?.role==="admin"&&state.page==="attendance")setTimeout(mount,0);
})();