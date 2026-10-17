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
 table.className="tshirt-roster-table";
 head.innerHTML="<tr><th>學生</th><th>首次領用</th><th>尺寸</th><th>家長處理</th></tr>";table.appendChild(head);
 const tbody=document.createElement("tbody");
 for(const s of data){
  const name=String(s.name||s.studentName||""),group=normalizedGroup(s.groupName||s.group),unissued=group==="C"||name==="李沛臻";
  const tr=document.createElement("tr");
  const grade=currentGrade(s);
  const issuedGrade=unissued?"尚未領取":grade===null?"年級待確認":grade>1?(grade-1)+" 年級":"年級待確認";
  const studentId=String(s.studentId||s.id||"");
  const history=historicalSizes.get(studentId);
  const size=history&&history.historicalIssued===true&&history.size?String(history.size):"";
  const addCell=(label,primary,detail="")=>{
   const td=document.createElement("td"),caption=document.createElement("span"),main=document.createElement("strong");
   caption.className="tshirt-roster-label";caption.textContent=label;
   main.textContent=primary;td.append(caption,main);
   if(detail){const small=document.createElement("small");small.textContent=detail;td.append(small)}
   tr.append(td);return td;
  };
  const person=addCell("學生",name),badge=document.createElement("span");
  badge.className="tshirt-roster-group";badge.textContent=group==="C"?"儲備":group+"團";person.append(badge);
  addCell("首次領用",unissued?"尚未領取":"已領取",unissued?"保留免費資格":issuedGrade==="年級待確認"?"年級待核對":issuedGrade+"領取");
  addCell("尺寸",unissued?"待選擇":size||"待補登");
  const action=addCell("家長處理",unissued?"免費申請":size?"已登錄":"補登尺寸");
  action.className="tshirt-roster-action";
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
