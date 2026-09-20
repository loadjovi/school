(()=>{
  state.parentLinks=state.parentLinks||[];
  state.parentBindingView=state.parentBindingView||{detail:false,query:"",group:"all",grade:"all",binding:"unbound"};

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
  loadAdmin=async function(){await originalLoadAdmin();await loadParentLinks()};

  function pendingForStudent(s){
    const id=String(s.studentId||s.studentNo||"").trim(),name=String(s.name||s.studentName||"").trim();
    return (state.registrations||[]).filter(r=>String(r.status||"pending")==="pending"&&(
      String(r.studentNo||r.studentId||"").trim()===id||
      String(r.matchedStudentId||"").trim()===id||
      (name&&String(r.studentName||"").trim()===name)
    ));
  }
  function parentBlock(s){
    const parents=Array.isArray(s.parents)?s.parents:[],pending=pendingForStudent(s);
    if(!parents.length&&!pending.length)return `<div class="notice" style="margin:10px 0"><b>👪 家長 Gmail 綁定</b><br><span class="muted">尚未綁定家長 Gmail，也沒有待審核申請。</span></div>`;
    const pendingRows=pending.map(r=>`<div style="padding:5px 0"><b>⏳ 待審核家長申請</b><br><span>${esc(r.parentEmail||"")}</span><small style="display:block;margin-top:2px">學生：${esc(r.studentName||s.name||"")}｜學號 ${esc(r.studentNo||s.studentId||"")}</small></div>`).join("");
    const rows=parents.map(p=>{const rel=esc(p.relationship||"家長"),name=p.parentName?` ${esc(p.parentName)}`:"",oldId=p.sourceStudentId&&p.sourceStudentId!==s.studentId?`<small style="display:block;margin-top:2px">歷史學生 ID：${esc(p.sourceStudentId)}</small>`:"";return `<div style="padding:5px 0"><b>✅ ${rel}${name}</b><br><span>${esc(p.parentEmail)}</span>${oldId}</div>`}).join("");
    return `<div class="notice" style="margin:10px 0"><b>👪 家長 Gmail 綁定</b>${pendingRows}${rows}</div>`;
  }

  const originalStudentEdit=studentEdit;
  studentEdit=function(s){const html=originalStudentEdit(s),block=parentBlock(s),close="</h2>",idx=html.indexOf(close);return idx<0?block+html:html.slice(0,idx+close.length)+block+html.slice(idx+close.length)};

  function bindingStats(){
    const active=(state.master||[]).filter(s=>(s.status||"active")==="active");
    const activeIds=new Set(active.map(s=>String(s.studentId||"")).filter(Boolean));
    const links=(state.parentLinks||[]).filter(x=>activeIds.has(String(x.studentId||"")));
    const boundIds=new Set(links.map(x=>String(x.studentId||"")).filter(Boolean));
    const parentEmails=new Set(links.map(x=>String(x.parentEmail||"").trim().toLowerCase()).filter(Boolean));
    const pendingIds=new Set((state.registrations||[]).filter(r=>String(r.status||"pending")==="pending").map(r=>String(r.studentNo||r.studentId||r.matchedStudentId||"")).filter(Boolean));
    const unbound=active.filter(s=>!boundIds.has(String(s.studentId||""))&&!pendingIds.has(String(s.studentId||"")));
    return {active,boundIds,pendingIds,total:active.length,bound:boundIds.size,pending:pendingIds.size,unbound,parentAccounts:parentEmails.size};
  }

  function normalizeGroup(v){const s=String(v||"").trim();return s==="C"?"儲備":s}
  function gradeKey(v){return String(v||"").trim()}

  function summaryHtml(){
    const x=bindingStats();
    return `<div class="card hero"><h2>👨‍👩‍👧 家長綁定</h2>
      <div class="grid">
        <div class="kpi"><b>${x.bound} / ${x.total}</b><span>已綁定</span></div>
        <div class="kpi"><b>${x.pending}</b><span>待審核</span></div><div class="kpi"><b>${x.unbound.length}</b><span>尚未申請</span></div>
      </div>
      <button class="secondary" style="width:100%;margin-top:12px" onclick="openParentBindingDetail()">查看未綁定學生 →</button>
    </div>`;
  }

  function detailHtml(){
    const x=bindingStats(),v=state.parentBindingView;
    const groups=[...new Set(x.active.map(s=>normalizeGroup(s.groupName)).filter(Boolean))].sort((a,b)=>["A","B","儲備"].indexOf(a)-["A","B","儲備"].indexOf(b));
    const grades=[...new Set(x.active.map(s=>gradeKey(s.grade)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"zh-Hant",{numeric:true}));
    const q=String(v.query||"").trim().toLowerCase();
    const rows=x.active.filter(s=>{
      const id=String(s.studentId||""),bound=x.boundIds.has(id),studentNo=String(s.studentNo||s.studentId||"");
      if(q&&!`${s.name||""} ${studentNo}`.toLowerCase().includes(q))return false;
      if(v.group!=="all"&&normalizeGroup(s.groupName)!==v.group)return false;
      if(v.grade!=="all"&&gradeKey(s.grade)!==v.grade)return false;
      if(v.binding==="bound"&&!bound)return false;
      if(v.binding==="unbound"&&bound)return false;
      return true;
    });
    const list=rows.length?rows.map(s=>{const bound=x.boundIds.has(String(s.studentId||"")),parents=Array.isArray(s.parents)?s.parents:[];return `<div class="item"><div><b>${esc(s.name||"未命名")}</b><small>${esc(s.grade||"—")}｜${esc(normalizeGroup(s.groupName)||"—")}團｜${esc(s.instrument||"—")}｜學號 ${esc(s.studentNo||s.studentId||"—")}${bound&&parents.length?`<br>${parents.map(p=>esc(p.parentEmail||"")).filter(Boolean).join("、")}`:""}</small></div><span class="badge ${bound?"good":"warn"}">${bound?"已綁定":"未綁定"}</span></div>`}).join(""):`<div class="notice">沒有符合目前篩選條件的學生。</div>`;
    return `<div class="card"><button class="secondary" style="margin:0 0 12px" onclick="closeParentBindingDetail()">← 返回後台首頁</button><h2>👨‍👩‍👧 家長綁定管理</h2><div class="notice">在團學生 ${x.total} 人｜已綁定 ${x.bound} 人｜待審核 ${x.pending} 人｜尚未申請 ${x.unbound.length} 人</div>
      <label>搜尋姓名／學號</label><input type="search" placeholder="輸入姓名或學號" value="${esc(v.query)}" oninput="setParentBindingFilter('query',this.value)">
      <div class="row2" style="margin-top:10px"><div><label>團別</label><select onchange="setParentBindingFilter('group',this.value)"><option value="all">全部團別</option>${groups.map(g=>`<option value="${esc(g)}" ${v.group===g?"selected":""}>${esc(g)}團</option>`).join("")}</select></div><div><label>年級</label><select onchange="setParentBindingFilter('grade',this.value)"><option value="all">全部年級</option>${grades.map(g=>`<option value="${esc(g)}" ${v.grade===g?"selected":""}>${esc(g)}</option>`).join("")}</select></div></div>
      <label style="margin-top:10px">綁定狀態</label><select onchange="setParentBindingFilter('binding',this.value)"><option value="all" ${v.binding==="all"?"selected":""}>全部</option><option value="unbound" ${v.binding==="unbound"?"selected":""}>未綁定</option><option value="bound" ${v.binding==="bound"?"selected":""}>已綁定</option></select>
      <div style="margin-top:14px"><b>符合條件：${rows.length} 人</b>${list}</div>
    </div>`;
  }

  window.openParentBindingDetail=function(){state.parentBindingView.detail=true;state.parentBindingView.binding="unbound";mountBindingStats()};
  window.closeParentBindingDetail=function(){state.parentBindingView.detail=false;mountBindingStats()};
  window.setParentBindingFilter=function(key,value){if(!["query","group","grade","binding"].includes(key))return;state.parentBindingView[key]=String(value??"");mountBindingStats();if(key==="query"){const input=document.querySelector('#parentBindingStats input[type="search"]');if(input){input.focus();input.setSelectionRange(input.value.length,input.value.length)}}};

  function mountBindingStats(){
    if(state.me?.role!=="admin"||state.page!=="admin")return;
    const main=document.querySelector(".main");if(!main)return;
    let root=document.getElementById("parentBindingStats");if(!root){root=document.createElement("div");root.id="parentBindingStats";main.prepend(root)}
    root.innerHTML=state.parentBindingView.detail?detailHtml():summaryHtml();
  }

  const originalRender=render;
  render=function(){const r=originalRender();if(state.me?.role==="admin"&&state.page==="admin")setTimeout(mountBindingStats,0);return r};
  if(state.me?.role==="admin")loadParentLinks().then(()=>render()).catch(()=>{});
})();
