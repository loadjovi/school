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
 const table=document.createElement("table"),head=document.createElement("thead");
 head.innerHTML="<tr><th>學生</th><th>團別</th><th>首次團 T</th><th>領取年級</th><th>尺寸</th><th>家長操作</th></tr>";table.appendChild(head);
 const tbody=document.createElement("tbody");
 for(const s of data){
  const name=String(s.name||s.studentName||""),group=normalizedGroup(s.groupName||s.group),unissued=group==="C"||name==="李沛臻";
  const tr=document.createElement("tr");
  const grade=currentGrade(s);
  const issuedGrade=unissued?"尚未領取":grade===null?"年級待確認":grade>1?(grade-1)+" 年級":"年級待確認";
  const studentId=String(s.studentId||s.id||"");
  const history=historicalSizes.get(studentId);
  const size=history&&history.historicalIssued===true&&history.size?String(history.size):"";
  for(const value of [name,group==="C"?"儲備團":group+" 團",unissued?"尚未領取（免費資格保留）":"已領取",issuedGrade,unissued?"待申請填寫":size||"未知／待補登",unissued?"首次免費申請":size?"尺寸已登錄":"歷史尺寸補登"]){
   const td=document.createElement("td");td.textContent=value;tr.appendChild(td);
  }
  tbody.appendChild(tr);
 }
 table.appendChild(tbody);body.replaceChildren(table);
 byId("tshirtRosterStatus").textContent="學生主檔共 "+students.length+" 位符合 A、B、儲備團；目前顯示 "+data.length+" 位。尺寸依家長已儲存的歷史尺寸紀錄顯示；未補登者仍標示待補登。"+(historyLoadError?" 歷史尺寸讀取失敗："+historyLoadError:"");
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
 const text=byId("requestSummary")?.textContent||"";
 byId("tshirtProcurementSummary").textContent="採購門檻：10 件。"+(text?" 目前申請統計："+text:" 尚未載入申請統計。")+" 請在「家長申請」核對實際有效需求。";
}
document.querySelectorAll("[data-tshirt-view]").forEach(b=>b.addEventListener("click",()=>{if(!views.has(b.dataset.tshirtView))return;selected=b.dataset.tshirtView;applyView()}));
document.querySelectorAll("[data-admin-tab]").forEach(b=>b.addEventListener("click",()=>queueMicrotask(applyView)));
byId("tshirtGroupFilter")?.addEventListener("change",renderRoster);
window.syncTshirtViews=applyView;
queueMicrotask(applyView);
