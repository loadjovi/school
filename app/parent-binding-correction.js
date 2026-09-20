(()=>{
  state.parentBindingCorrection=state.parentBindingCorrection||{open:false,query:"",items:[],loading:false,editKey:""};

  const studentName=id=>{
    const s=(state.master||[]).find(x=>String(x.studentId)===String(id));
    return s?.name||s?.studentName||String(id||"");
  };
  const studentLabel=s=>`${s.name||s.studentName||"未命名"}｜${s.grade||"—"}｜${s.groupName||"—"}團｜學號 ${s.studentNo||s.studentId||"—"}`;
  const bindingKey=x=>String(x.parentEmail||"")+"|"+String(x.sourceStudentId||x.studentId||"");

  async function loadCorrectionLinks(){
    if(state.me?.role!=="admin")return;
    state.parentBindingCorrection.loading=true;
    try{
      const d=await api("/api/student-parent-links");
      state.parentBindingCorrection.items=d.items||[];
    }catch(e){
      console.warn("load parent binding correction failed",e);
      state.parentBindingCorrection.items=[];
    }finally{
      state.parentBindingCorrection.loading=false;
    }
  }

  function editHtml(x){
    if(state.parentBindingCorrection.editKey!==bindingKey(x))return "";
    const students=(state.master||[]).filter(s=>(s.status||"active")==="active");
    const rels=["父親","母親","監護人","家長","其他"];
    return `<div class="notice" style="margin-top:10px">
      <b>✏️ 修正綁定</b><br>
      <span class="muted">可修正家長 Gmail，或將家長改綁到正確學生。儲存後會留下異動紀錄。</span>
      <label>家長 Gmail</label>
      <input id="bindingFixEmail" type="email" value="${esc(x.parentEmail||"")}">
      <label>家長姓名</label>
      <input id="bindingFixName" value="${esc(x.parentName||"")}">
      <div class="row2">
        <div><label>關係</label><select id="bindingFixRel">${rels.map(r=>`<option value="${esc(r)}" ${String(x.relationship||"家長")===r?"selected":""}>${esc(r)}</option>`).join("")}</select></div>
        <div><label>正確綁定學生</label><select id="bindingFixStudent">${students.map(s=>`<option value="${esc(s.studentId)}" ${String(s.studentId)===String(x.studentId)?"selected":""}>${esc(studentLabel(s))}</option>`).join("")}</select></div>
      </div>
      <div class="row2" style="margin-top:10px">
        <button class="primary" style="margin-top:0" onclick="saveParentBindingFix('${esc(x.parentEmail||"")}','${esc(x.sourceStudentId||x.studentId||"")}')">儲存修正</button>
        <button class="secondary" style="margin-top:0" onclick="cancelParentBindingFix()">取消</button>
      </div>
    </div>`;
  }

  function bodyHtml(){
    const v=state.parentBindingCorrection;
    if(!v.open)return `<div class="card"><h2>🛠️ 家長綁定修正</h2><div class="notice">若家長 Gmail 綁錯學生，或 Gmail 輸入錯誤，可由後台修正，不需要重新建立學生資料。</div><button class="secondary" style="width:100%;margin-top:12px" onclick="openParentBindingCorrection()">✏️ 修正已綁定 Gmail／學生</button></div>`;
    const q=String(v.query||"").trim().toLowerCase();
    const rows=(v.items||[]).filter(x=>{
      const name=studentName(x.studentId);
      return !q||(`${name} ${x.studentId||""} ${x.parentEmail||""} ${x.parentName||""}`).toLowerCase().includes(q);
    });
    const list=rows.length?rows.map(x=>`<div class="item" style="display:block">
      <div class="student">
        <div><b>${esc(studentName(x.studentId))}</b><small>學號 ${esc(x.studentId||"—")}｜${esc(x.relationship||"家長")} ${esc(x.parentName||"")}</small><small>${esc(x.parentEmail||"")}</small></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
          <button class="secondary" style="margin:0;padding:8px 10px" onclick="editParentBindingFix('${esc(bindingKey(x))}')">✏️ 修正</button>
          <button class="secondary" style="margin:0;padding:8px 10px;border-color:#c94b4b;color:#a52a2a" onclick="removeParentBinding('${esc(x.parentEmail||"")}','${esc(x.sourceStudentId||x.studentId||"")}','${esc(studentName(x.studentId))}')">🗑️ 移除</button>
        </div>
      </div>
      ${editHtml(x)}
    </div>`).join(""):`<div class="notice">沒有符合搜尋條件的家長綁定。</div>`;
    return `<div class="card"><button class="secondary" style="margin:0 0 12px" onclick="closeParentBindingCorrection()">← 返回</button><h2>🛠️ 家長 Gmail／學生綁定修正</h2>
      <div class="notice"><b>適用情境</b><br>家長驗證時綁錯學生、Gmail 輸入錯誤，或需要改綁到正確學生。<br><br>修正後原綁定會被替換，並寫入學生異動歷史。若需讓帳號回到未綁定狀態，可直接使用「移除」。</div>
      <label>搜尋學生姓名／學號／家長 Gmail</label><input type="search" value="${esc(v.query)}" placeholder="輸入姓名、學號或 Gmail" oninput="setParentBindingCorrectionQuery(this.value)">
      <div style="margin-top:12px"><b>目前綁定：${rows.length} 筆</b></div>${list}
    </div>`;
  }

  function mount(){
    if(state.me?.role!=="admin"||state.page!=="admin")return;
    const main=document.querySelector(".main");if(!main)return;
    let root=document.getElementById("parentBindingCorrection");
    if(!root){root=document.createElement("div");root.id="parentBindingCorrection";const anchor=document.getElementById("parentBindingStats");if(anchor&&anchor.parentNode)anchor.after(root);else main.prepend(root)}
    root.innerHTML=bodyHtml();
  }

  window.openParentBindingCorrection=async function(){state.parentBindingCorrection.open=true;state.parentBindingCorrection.editKey="";await loadCorrectionLinks();mount()};
  window.closeParentBindingCorrection=function(){state.parentBindingCorrection.open=false;state.parentBindingCorrection.editKey="";mount()};
  window.setParentBindingCorrectionQuery=function(v){state.parentBindingCorrection.query=String(v||"");mount();const input=document.querySelector('#parentBindingCorrection input[type="search"]');if(input){input.focus();input.setSelectionRange(input.value.length,input.value.length)}};
  window.editParentBindingFix=function(key){state.parentBindingCorrection.editKey=String(key||"");mount();setTimeout(()=>document.getElementById("bindingFixEmail")?.scrollIntoView({behavior:"smooth",block:"center"}),50)};
  window.cancelParentBindingFix=function(){state.parentBindingCorrection.editKey="";mount()};
  window.removeParentBinding=async function(parentEmail,studentId,studentName){
    if(!confirm(`確定移除這筆家長綁定？\n\n學生：${studentName}\n家長 Gmail：${parentEmail}\n\n移除後，此 Gmail 將不再具有此學生的家長存取權；學生資料不會刪除，系統會保留異動紀錄。`))return;
    try{
      await api("/api/student-parent-links",{method:"PATCH",body:JSON.stringify({action:"remove_binding",originalParentEmail:parentEmail,originalStudentId:studentId})});
      toast("✅ 家長 Gmail 綁定已移除");
      state.parentBindingCorrection.editKey="";
      await loadAdmin();
      await loadCorrectionLinks();
      render();
    }catch(e){toast("❌ "+e.message)}
  };

  window.saveParentBindingFix=async function(originalParentEmail,originalStudentId){
    const parentEmail=document.getElementById("bindingFixEmail")?.value.trim();
    const parentName=document.getElementById("bindingFixName")?.value.trim();
    const relationship=document.getElementById("bindingFixRel")?.value;
    const studentId=document.getElementById("bindingFixStudent")?.value;
    if(!parentEmail||!studentId){toast("請填寫家長 Gmail 並選擇正確學生");return}
    const target=(state.master||[]).find(x=>String(x.studentId)===String(studentId));
    if(!confirm(`確定修正家長綁定？\n\nGmail：${parentEmail}\n正確學生：${target?.name||target?.studentName||studentId}\n\n原綁定會被替換，並留下異動紀錄。`))return;
    try{
      await api("/api/student-parent-links",{method:"PATCH",body:JSON.stringify({originalParentEmail,originalStudentId,parentEmail,parentName,relationship,studentId})});
      toast("✅ 家長綁定已修正");
      state.parentBindingCorrection.editKey="";
      await loadAdmin();
      await loadCorrectionLinks();
      render();
    }catch(e){toast("❌ "+e.message)}
  };

  const baseRender=render;
  render=function(){const r=baseRender();if(state.me?.role==="admin"&&state.page==="admin")setTimeout(mount,0);return r};
  if(state.me?.role==="admin")setTimeout(()=>loadCorrectionLinks().then(mount).catch(()=>{}),0);
})();