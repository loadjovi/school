const byId=id=>document.getElementById(id);
const sizes={"男":["S","M","L","2L"],"女":["XS","S","M","L"]};
const labels={RECEIVED:"已收回｜待送洗",WASHING:"送洗中｜待驗收",STOCKED:"驗收合格｜已入庫",REJECTED:"驗收不合格｜未入庫"};
let returns=[],issues=[];
const headers=()=>({"Content-Type":"application/json",...(window.uniformEventAuthHeaders?.()||{})});
async function call(path,options={}){
 const r=await fetch("/api/"+path,{credentials:"same-origin",cache:"no-store",...options,headers:{...headers(),...(options.headers||{})}});
 const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||"HTTP "+r.status);return data;
}
function syncSource(){
 const historical=byId("competitionReturnSource").value==="HISTORICAL";
 byId("competitionHistoricalSource").hidden=!historical;
 byId("competitionFormalSource").hidden=historical;
 byId("competitionFormalIssue").required=!historical;
}
function syncSizes(){
 const select=byId("competitionReturnSize"),before=select.value;
 select.replaceChildren(...sizes[byId("competitionReturnStyle").value].map(size=>new Option(size,size)));
 if([...select.options].some(option=>option.value===before))select.value=before;
}
byId("competitionReturnSource").addEventListener("change",syncSource);
byId("competitionReturnStyle").addEventListener("change",syncSizes);
syncSource();syncSizes();
function date(value){return value?new Date(value).toLocaleString("zh-TW",{timeZone:"Asia/Taipei",hour12:false}):"—"}
function render(){
 const select=byId("competitionFormalIssue"),before=select.value;
 select.replaceChildren(new Option("請選擇已發放的公費比賽服",""));
 for(const issue of issues)select.add(new Option(issue.studentName+"（"+issue.studentId+"）｜"+issue.style+"款 "+issue.size+"｜"+date(issue.issuedAt),issue.requestId));
 if([...select.options].some(option=>option.value===before))select.value=before;
 const root=byId("competitionReturnRecords");root.replaceChildren();
 const sorted=[...returns].sort((a,b)=>String(b.receivedAt).localeCompare(String(a.receivedAt)));
 byId("competitionReturnListStatus").textContent="共 "+sorted.length+" 筆；待送洗 "+sorted.filter(x=>x.status==="RECEIVED").length+" 筆、待驗收 "+sorted.filter(x=>x.status==="WASHING").length+" 筆、已入庫 "+sorted.filter(x=>x.status==="STOCKED").length+" 筆。";
 if(!sorted.length){root.textContent="目前沒有正式歸還紀錄。";return}
 for(const item of sorted){
  const card=document.createElement("article");card.className="competition-return-card";
  const heading=document.createElement("strong");heading.textContent=(item.studentName||item.studentId)+"（"+item.studentId+"）｜"+item.style+"款 "+item.size;
  const state=document.createElement("p");state.textContent=labels[item.status]||item.status;
  const source=document.createElement("p");source.textContent=(item.source==="FORMAL"?"系統正式發放":"紙本歷史領用")+"｜收回 "+date(item.receivedAt)+(item.stockedAt?"｜入庫 "+date(item.stockedAt):"");
  card.append(heading,state,source);
  if(item.sourceNote){const evidence=document.createElement("p");evidence.textContent="核對依據："+item.sourceNote;card.append(evidence)}
  const actions=document.createElement("div");actions.className="return-actions";
  const choices=item.status==="RECEIVED"?[["WASHING","確認送洗"],["REJECT","判定不合格"]]:item.status==="WASHING"?[["ACCEPT","驗收合格並入庫"],["REJECT","驗收不合格"]]:[];
  for(const [action,label] of choices){const button=document.createElement("button");button.type="button";button.textContent=label;button.addEventListener("click",()=>advance(item,action,button));actions.append(button)}
  card.append(actions);root.append(card);
 }
}
async function reload(){
 try{
  const [data,students]=await Promise.all([call("uniform-events/competition-returns"),call("students")]);
  returns=data.items||[];issues=data.issues||[];
  const options=byId("competitionReturnStudentOptions");options.replaceChildren();
  for(const student of (Array.isArray(students)?students:students.items||[])){
   if(!student.studentId)continue;
   const option=document.createElement("option");option.value=String(student.studentId);option.label=(student.studentName||student.name||"")+"（"+student.studentId+"）";options.append(option);
  }
  render();
 }catch(error){byId("competitionReturnListStatus").textContent="讀取歸還紀錄失敗："+error.message}
}
byId("competitionReturnForm").addEventListener("submit",async event=>{
 event.preventDefault();
 const source=byId("competitionReturnSource").value,message=byId("competitionReturnMessage"),button=event.submitter;
 const body=source==="FORMAL"?{action:"REGISTER",source,sourceRequestId:byId("competitionFormalIssue").value}:{action:"REGISTER",source,studentId:byId("competitionReturnStudentId").value.trim(),style:byId("competitionReturnStyle").value,size:byId("competitionReturnSize").value,sourceNote:byId("competitionReturnEvidence").value.trim()};
 if(source==="HISTORICAL"&&(!body.studentId||body.sourceNote.length<8)){message.textContent="請填學號及至少 8 字的紙本領用核對說明。";return}
 if(!confirm("確認已實際收回這套公費比賽服？此步驟只登記歸還，送洗及驗收合格後才會入庫。"))return;
 button.disabled=true;message.textContent="正在登記歸還…";
 try{await call("uniform-events/competition-returns",{method:"POST",body:JSON.stringify(body)});message.textContent="已登記收回，請安排送洗；目前尚未增加庫存。";await reload()}
 catch(error){message.textContent="登記未完成："+error.message;await reload()}
 finally{button.disabled=false}
});
async function advance(item,action,button){
 let reason="";
 if(action==="REJECT"){reason=prompt("請填寫驗收不合格原因（不會入庫）","");if(reason===null)return}
 if(action==="REJECT"&&reason.trim().length<3){byId("competitionReturnMessage").textContent="請填寫至少 3 字的原因。";return}
 const label={WASHING:"確認已送洗？",ACCEPT:"確認這套比賽服已清洗且驗收合格，立即增加對應款式與尺寸的可用庫存 1 件？",REJECT:"確認標記驗收不合格？不會增加庫存。"}[action];
 if(!confirm(label))return;
 button.disabled=true;
 try{await call("uniform-events/competition-returns",{method:"POST",body:JSON.stringify({action,id:item.id,etag:item.etag,reason:reason.trim()})});byId("competitionReturnMessage").textContent=action==="ACCEPT"?"已驗收合格並入庫 1 件。":"歸還狀態已更新。";await reload();if(action==="ACCEPT")byId("reload")?.click()}
 catch(error){byId("competitionReturnMessage").textContent="操作結果未確認："+error.message;await reload()}
 finally{button.disabled=false}
}
window.addEventListener("uniformAdminAuth",event=>{if(event.detail?.authenticated)reload()});
