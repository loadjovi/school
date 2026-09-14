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

  if(state.me?.role==="admin"){
    loadParentLinks().then(()=>render()).catch(()=>{});
  }
})();
