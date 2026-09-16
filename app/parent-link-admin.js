(()=>{
  state.parentLinks=state.parentLinks||[];

  async function loadParentLinks(){
    if(state.me?.role!=="admin")return;
    try{
      const d=await api("/api/student-parent-links");
      state.parentLinks=d.items||[];
      const byStudent=new Map();
      for(const x of state.parentLinks){
        const id=String(x.studentId||"");
        if(!id)continue;
        if(!byStudent.has(id))byStudent.set(id,[]);
        byStudent.get(id).push(x);
      }
      for(const s of state.master||[])s.parents=byStudent.get(String(s.studentId))||[];
    }catch(e){
      console.warn("load parent Gmail links failed",e);
      state.parentLinks=[];
      for(const s of state.master||[])s.parents=[];
    }
  }

  const originalLoadAdmin=loadAdmin;
  loadAdmin=async function(){
    await originalLoadAdmin();
    await loadParentLinks();
  };

  function parentBlock(s){
    const parents=Array.isArray(s.parents)?s.parents:[];
    if(!parents.length){
      return `<div class="notice" style="margin:10px 0"><b>👪 家長 Gmail 綁定</b><br><span class="muted">尚未綁定家長 Gmail</span></div>`;
    }
    const rows=parents.map(p=>{
      const rel=esc(p.relationship||"家長");
      const name=p.parentName?` ${esc(p.parentName)}`:"";
      const oldId=p.sourceStudentId&&p.sourceStudentId!==s.studentId?`<small style="display:block;margin-top:2px">歷史學生 ID：${esc(p.sourceStudentId)}</small>`:"";
      return `<div style="padding:5px 0"><b>${rel}${name}</b><br><span>${esc(p.parentEmail)}</span>${oldId}</div>`;
    }).join("");
    return `<div class="notice" style="margin:10px 0"><b>👪 家長 Gmail 綁定（${parents.length}）</b>${rows}</div>`;
  }

  const originalStudentEdit=studentEdit;
  studentEdit=function(s){
    const html=originalStudentEdit(s);
    const block=parentBlock(s);
    const close="</h2>";
    const idx=html.indexOf(close);
    if(idx<0)return block+html;
    return html.slice(0,idx+close.length)+block+html.slice(idx+close.length);
  };

  function bindingStats(){
    const active=(state.master||[]).filter(s=>(s.status||"active")==="active");
    const activeIds=new Set(active.map(s=>String(s.studentId||"")).filter(Boolean));
    const links=(state.parentLinks||[]).filter(x=>activeIds.has(String(x.studentId||"")));
    const boundIds=new Set(links.map(x=>String(x.studentId||"")).filter(Boolean));
    const parentEmails=new Set(links.map(x=>String(x.parentEmail||"").trim().toLowerCase()).filter(Boolean));
    const unbound=active.filter(s=>!boundIds.has(String(s.studentId||"")));
    const total=active.length,bound=boundIds.size;
    const rate=total?Math.round(bound*1000/total)/10:0;
    const groups=["A","B","C","儲備"].map(groupName=>{
      const students=active.filter(s=>String(s.groupName||"")===groupName);
      const b=students.filter(s=>boundIds.has(String(s.studentId||""))).length;
      return {groupName,total:students.length,bound:b,unbound:students.length-b};
    }).filter(x=>x.total>0);
    return {total,bound,unbound,parentAccounts:parentEmails.size,rate,groups};
  }

  function statsHtml(){
    const x=bindingStats();
    const groupRows=x.groups.length?x.groups.map(g=>`
      <div class="item">
        <div><b>${esc(g.groupName)}團</b><small>學生 ${g.total} 人｜已綁定 ${g.bound} 人</small></div>
        <span class="badge ${g.unbound?"warn":"ok"}">未綁定 ${g.unbound}</span>
      </div>`).join(""):`<div class="notice">目前沒有在團學生資料。</div>`;
    const unboundRows=x.unbound.length?x.unbound.map(s=>`
      <div class="item">
        <div><b>${esc(s.name||"未命名")}</b><small>${esc(s.grade||"—")}｜${esc(s.groupName||"—")}團｜${esc(s.instrument||"—")}｜學號 ${esc(s.studentNo||s.studentId||"—")}</small></div>
        <span class="badge warn">未綁定</span>
      </div>`).join(""):`<div class="notice">✅ 目前所有在團學生皆已有家長 Gmail 綁定。</div>`;
    return `<div class="card hero"><h2>👪 家長綁定統計</h2>
      <div class="grid">
        <div class="kpi"><b>${x.total}</b><span>在團學生</span></div>
        <div class="kpi"><b>${x.bound}</b><span>已綁定學生</span></div>
        <div class="kpi"><b>${x.unbound.length}</b><span>未綁定學生</span></div>
        <div class="kpi"><b>${x.rate}%</b><span>綁定完成率</span></div>
      </div>
      <div class="notice" style="margin-top:12px">已綁定家長 Gmail 帳號：<b>${x.parentAccounts}</b> 個。學生人數以 Student ID 去重，同一學生綁定多位家長仍只計 1 位學生。</div>
    </div>
    <div class="card"><h2>📊 各團綁定進度</h2>${groupRows}</div>
    <div class="card"><h2>⚠️ 尚未綁定家長的學生（${x.unbound.length}）</h2>
      <div class="notice">僅列出目前狀態為「在團」的學生，方便管理員追蹤家長登入與學生綁定進度。</div>
      ${unboundRows}
    </div>`;
  }

  function mountBindingStats(){
    if(state.me?.role!=="admin"||state.page!=="admin")return;
    const main=document.querySelector(".main");if(!main)return;
    let root=document.getElementById("parentBindingStats");
    if(!root){root=document.createElement("div");root.id="parentBindingStats";main.prepend(root)}
    root.innerHTML=statsHtml();
  }

  const originalRender=render;
  render=function(){
    const r=originalRender();
    if(state.me?.role==="admin"&&state.page==="admin")setTimeout(mountBindingStats,0);
    return r;
  };

  if(state.me?.role==="admin"){
    loadParentLinks().then(()=>render()).catch(()=>{});
  }
})();