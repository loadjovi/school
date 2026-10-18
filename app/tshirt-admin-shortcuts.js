// 團 T 後台：功能圖示切換及學生主檔核對（只讀，不寫入歷史領用）。
const byId=id=>document.getElementById(id);
let selected="students",students=[],rosterLoaded=false,historicalSizes=new Map(),historyLoadError="";
const views=new Set(["students","requests","procurement","inventory","parents","reports"]);
function regularActive(){return document.querySelector('[data-admin-tab="regularUniform"]')?.getAttribute("aria-selected")==="true"}
function applyView(){
 if(!regularActive()||byId("tshirtShortcutPanel")?.hidden)return;
 for(const button of document.querySelectorAll("[data-tshirt-view]"))button.setAttribute("aria-pressed",String(button.dataset.tshirtView===selected));
 for(const panel of document.querySelectorAll('[data-admin-view="regularUniform"][data-tshirt-panel]'))panel.hidden=panel.dataset.tshirtPanel!==selected;
 const req=byId("uniformRequestsPanel"),stock=byId("uniformInventoryPanel");
 if(req?.dataset.adminView==="regularUniform")req.hidden=selected!=="requests";
 if(stock?.dataset.adminView==="regularUniform")stock.hidden=selected!=="inventory";
 if(selected==="procurement")renderProcurement();
 if(selected==="students")loadRoster();
}
function normalizedGroup(value){
 const x=String(value||"").trim().toUpperCase().replace(/\\s/g,"");
 if(x==="A"||x==="A團")return "A";
 if(x==="B"||x==="B團")return "B";
 if(["C","C團","儲備","儲備團"].includes(x))return "C";
 return "";
}
function currentGrade(student){
 const raw=[student.grade,student.gradeName,student.className,student.class,student.classroom,student.gradeClass].filter(v=>v!==undefined&&v!==null).map(String);
 for(const value of raw){
  const match=value.match(/(?:^|[^0-9])([1-6])(?:年級|年|[A-Za-z班]|$)/);
  if(match)return Number(match[1]);
  const chinese=value.match(/([一二三四五六])年級/);
  if(chinese)return "一二三四五六".indexOf(chinese[1])+1;
 }
 return null;
}
function renderRoster(){
 const filter=byId("tshirtGroupFilter").value,body=byId("tshirtRosterTable");
 const data=students.filter(s=>filter==="ALL"||normalizedGroup(s.groupName||s.group)===filter);
 const counts=new Map(),missing=[];
 for(const s of data){
  const size=historicalSizes.get(String(s.studentId||s.id||""))?.size;
  if(size)counts.set(size,(counts.get(size)||0)+1);else missing.push(String(s.name||s.studentName||""));
 }
 const sizes=["8","10","12","XS","S","M","L","XL","2L","3L","5L"];
 byId("tshirtRosterSizeSummary").textContent="目前尺寸統計（僅已登錄）："+(sizes.filter(size=>counts.has(size)).map(size=>size+"："+counts.get(size)+" 人").join("、")||"尚無")+"。待填寫 "+missing.length+" 人"+(missing.length?"："+missing.join("、"):"。")+" 此表僅供尺寸規劃，不代表已申請或已領取。";
 const table=document.createElement("table"),head=document.createElement("thead");
 table.className="tshirt-roster-table";
 head.innerHTML="<tr><th>學生</th><th>首次領用</th><th>尺寸</th><th>家長處理</th></tr>";table.appendChild(head);
 const tbody=document.createElement("tbody");
 for(const s of data){
  const name=String(s.name||s.studentName||""),group=normalizedGroup(s.groupName||s.group);
  const tr=document.createElement("tr");
  const grade=currentGrade(s);
  const studentId=String(s.studentId||s.id||"");
  const history=historicalSizes.get(studentId);
  // Stored receipt confirmation wins over any assumption based on the current group.
  const unissued=history?history.historicalIssued!==true:(group==="C"||name==="李沛臻");
  const issuedGrade=unissued?"尚未領取":history?.receivedAt?"家長確認："+new Date(history.receivedAt).toLocaleDateString("zh-TW",{timeZone:"Asia/Taipei"}):grade===null?"年級待確認":grade>1?(grade-1)+" 年級":"年級待確認";
  const size=history?.size?String(history.size):"";
  const addCell=(label,primary,detail="")=>{
   const td=document.createElement("td"),caption=document.createElement("span"),main=document.createElement("strong");
   caption.className="tshirt-roster-label";caption.textContent=label;
   main.textContent=primary;td.append(caption,main);
   if(detail){const small=document.createElement("small");small.textContent=detail;td.append(small)}
   tr.append(td);return td;
  };
  const person=addCell("學生",name),badge=document.createElement("span");
  badge.className="tshirt-roster-group";badge.textContent=group==="C"?"儲備":group+"團";person.append(badge);
  addCell("首次領用",unissued?(history?.schoolIssuedAt?"學校已交付":"尚未領取"):"已領取",unissued?(history?.schoolIssuedAt?"待家長確認收到；已預留首次公費資格":"保留首次公費資格"):issuedGrade==="年級待確認"?"年級待核對":issuedGrade+"領取");
  addCell("尺寸",size||"待填寫");
  const action=addCell("家長處理",history?.source==="PARENT_CONFIRMED_FIRST_PUBLIC"?"雙方確認完成":history?.schoolIssuedAt?"學校已發放，待家長確認":!unissued?(size?"已領取｜尺寸已登錄":"已領取｜尺寸待核對"):size?"待學校發放":"待家長填寫尺寸",history?.receivedAt?"家長確認："+new Date(history.receivedAt).toLocaleDateString("zh-TW",{timeZone:"Asia/Taipei"}):history?.schoolIssuedAt?"學校交付："+new Date(history.schoolIssuedAt).toLocaleDateString("zh-TW",{timeZone:"Asia/Taipei"})+"｜交付對象："+(history.schoolHandoffTo||"未記錄"):unissued?"尚未領取，保留首次免費資格":"歷史領用已確認，不需重新發放");
  action.className="tshirt-roster-action";
  if(history?.source==="PARENT_SIZE_SURVEY"&&history.historicalIssued!==true&&size&&!history.schoolIssuedAt){
   const details=document.createElement("details"),summary=document.createElement("summary");
   summary.textContent="📦 確認學校已發放";details.append(summary);
   const label=document.createElement("label");label.textContent="實際交付對象";
   const recipient=document.createElement("input");recipient.type="text";recipient.maxLength=100;
   recipient.placeholder="例如：學生本人／家長姓名";recipient.setAttribute("aria-label",name+" 的團 T 實際交付對象");
   label.append(recipient);
   const confirmButton=document.createElement("button");confirmButton.type="button";confirmButton.textContent="確認交付 1 件（"+size+"）";
   const feedback=document.createElement("span");feedback.className="hint";feedback.setAttribute("role","status");
   confirmButton.addEventListener("click",async()=>{
    const to=recipient.value.trim();
    if(!to){feedback.textContent="請填寫實際交付對象";recipient.focus();return}
    if(!window.confirm("請核對："+name+" 已實際領到團 T "+size+" 尺寸 1 件，交付對象："+to+"。送出後將等待家長確認收到，確定嗎？"))return;
    confirmButton.disabled=true;feedback.textContent="正在登記學校交付…";
    try{
     const headers=typeof window.uniformEventAuthHeaders==="function"?window.uniformEventAuthHeaders():{};
     const response=await fetch("/api/uniform-events/tshirt-historical-size",{method:"PATCH",credentials:"same-origin",cache:"no-store",headers:{...headers,"Content-Type":"application/json"},
      body:JSON.stringify({studentId,action:"SCHOOL_CONFIRM_HANDOFF",etag:history.etag,issuedSize:size,quantity:1,handoffTo:to,confirmedIssued:true})});
     const result=await response.json().catch(()=>({}));
     if(!response.ok)throw Error(result.error||("HTTP "+response.status));
     await loadRoster();
     byId("tshirtRosterStatus").textContent=name+" 已記錄學校交付團 T（"+size+"）1 件，待家長確認收到。";
    }catch(error){feedback.textContent="發放確認失敗："+error.message;confirmButton.disabled=false}
   });
   details.append(label,confirmButton,feedback);action.append(details);
  }
  if(size&&!history?.schoolIssuedAt&&history?.source!=="PARENT_CONFIRMED_FIRST_PUBLIC"){
   const reset=document.createElement("button");
   reset.type="button";reset.textContent="退回待填寫";
   reset.title="保留領用紀錄，讓家長重新填寫團 T 尺寸";
   reset.addEventListener("click",async()=>{
    if(!confirm(`將 ${name} 的團 T 尺寸 ${size} 退回待填寫？已領取紀錄會保留。`))return;
    reset.disabled=true;
    try{
     const headers=typeof window.uniformEventAuthHeaders==="function"?window.uniformEventAuthHeaders():{};
     const response=await fetch("/api/uniform-events/tshirt-historical-size",{method:"PATCH",credentials:"same-origin",headers:{...headers,"Content-Type":"application/json"},body:JSON.stringify({studentId,action:"RESET_SIZE",etag:history.etag})});
     const result=await response.json().catch(()=>({}));
     if(!response.ok)throw Error(result.error||`HTTP ${response.status}`);
     await loadRoster();
     byId("tshirtRosterStatus").textContent=`${name} 的團 T 尺寸已退回待填寫；原有領用紀錄保留。`;
    }catch(error){alert(`重設失敗：${error.message}`);reset.disabled=false}
   });
   action.append(reset);
  }
  tbody.appendChild(tr);
 }
 table.appendChild(tbody);body.replaceChildren(table);
 byId("tshirtRosterStatus").textContent="顯示 "+data.length+" 位團員（主檔共 "+students.length+" 位）。尺寸依家長已儲存的紀錄顯示；待補登者請家長於平台填寫。"+(historyLoadError?" 歷史尺寸讀取失敗："+historyLoadError:"");
}
async function loadRoster(){
 rosterLoaded=true;
 try{
  const headers=typeof window.uniformEventAuthHeaders==="function"?window.uniformEventAuthHeaders():{};
  const [rosterResult,historyResult]=await Promise.allSettled([
   fetch("/api/students",{credentials:"same-origin",cache:"no-store",headers}),
   fetch("/api/uniform-events/tshirt-historical-size",{credentials:"same-origin",cache:"no-store",headers})
  ]);
  if(rosterResult.status!=="fulfilled")throw rosterResult.reason;
  const r=rosterResult.value;
  if(!r.ok)throw Error("學生主檔讀取失敗（HTTP "+r.status+"）");
  historicalSizes=new Map();historyLoadError="";
  if(historyResult.status==="fulfilled"&&historyResult.value.ok){
   const history=await historyResult.value.json();
   for(const item of history.items||[])if(item.studentId)historicalSizes.set(String(item.studentId),item);
  }else historyLoadError=historyResult.status==="rejected"?String(historyResult.reason):"HTTP "+historyResult.value.status;
  const data=await r.json(),list=Array.isArray(data)?data:(data.items||[]);
  students=list.filter(s=>normalizedGroup(s.groupName||s.group));
  if(!students.length){byId("tshirtRosterStatus").textContent="學生主檔沒有可辨識的 A、B、儲備團資料，請核對團別欄位。";return}
  renderRoster();
 }catch(e){rosterLoaded=false;byId("tshirtRosterStatus").textContent=e.message}
}
function renderProcurement(){
 if(typeof window.renderTshirtProcurementSummary==="function")window.renderTshirtProcurementSummary();
}
document.querySelectorAll("[data-tshirt-view]").forEach(b=>b.addEventListener("click",()=>{if(!views.has(b.dataset.tshirtView))return;selected=b.dataset.tshirtView;applyView()}));
document.querySelectorAll("[data-admin-tab]").forEach(b=>b.addEventListener("click",()=>queueMicrotask(applyView)));
byId("tshirtGroupFilter")?.addEventListener("change",renderRoster);
window.syncTshirtViews=applyView;
queueMicrotask(applyView);
