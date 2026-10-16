import {roster} from "./competition-roster-data.js";
import {confirmedReceived,promotedClass} from "./competition-paper-receipts.js";

const byId=id=>document.getElementById(id);
const sizes={"男":["S","M","L","2L"],"女":["XS","S","M","L"]};
const labels={RECEIVED:"已收回｜待確認送洗",WASHING:"送洗中｜待確認入庫",STOCKED:"已送洗｜已入庫",REJECTED:"不合格｜未入庫"};
const nameOf=student=>String(student.studentName||student.name||"").trim().normalize("NFC");
const rosterByName=new Map(roster.map(row=>[row[1].normalize("NFC"),row]));
let returns=[],issues=[],studentRows=new Map();
const headers=()=>({"Content-Type":"application/json",...(window.uniformEventAuthHeaders?.()||{})});
async function call(path,options={}){
 const response=await fetch("/api/"+path,{credentials:"same-origin",cache:"no-store",...options,headers:{...headers(),...(options.headers||{})}});
 const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||"HTTP "+response.status);return data;
}
function setSizes(style,preferred){
 const select=byId("competitionReturnSize");
 select.replaceChildren(...(sizes[style]||[]).map(size=>new Option(size,size)));
 if(preferred&&(sizes[style]||[]).includes(preferred))select.value=preferred;
}
function syncStudent(){
 const id=byId("competitionReturnStudent").value,entry=studentRows.get(id);
 const preview=byId("competitionReturnStudentSummary"),source=byId("competitionReturnSource"),issueField=byId("competitionFormalIssue");
 const historical=byId("competitionHistoricalSource"),submit=byId("competitionReturnSubmit");
 source.value="";issueField.value="";historical.hidden=true;submit.disabled=true;
 preview.dataset.state="";byId("competitionReturnMessage").textContent="";
 if(!entry){preview.textContent="請先選擇學生，系統將帶入登記的款式與尺寸。";return}
 const row=entry.row,issue=issues.find(item=>String(item.studentId)===id);
 const returned=returns.find(item=>String(item.studentId)===id&&(issue?item.sourceRequestId===issue.requestId:item.source==="HISTORICAL"));
 if(returned){preview.dataset.state="blocked";preview.textContent=entry.name+"已登記歸還（"+(labels[returned.status]||returned.status)+"），請到下方紀錄續辦。";return}
 if(issue){
  source.value="FORMAL";issueField.value=issue.requestId;
  preview.textContent=entry.name+"｜正式公費發放紀錄："+issue.style+"款 "+issue.size+"｜已依系統發放資料帶入。";
  submit.disabled=false;return;
 }
 if(!row){preview.dataset.state="blocked";preview.textContent=entry.name+"沒有比賽服登記資料，請先核對原公費領用。";return}
 if(row[4]!=="公費"||!confirmedReceived.has(row[1])){
  preview.dataset.state="blocked";
  preview.textContent=entry.name+"｜"+row[2]+"款 "+row[3]+"｜"+(row[4]==="買斷"?"登記為買斷，不適用公費歸還。":"公費領用尚未確認，請先核對。");return;
 }
 source.value="HISTORICAL";historical.hidden=false;
 byId("competitionReturnStyle").value=row[2];setSizes(row[2],row[3]);
 const klass=promotedClass(confirmedReceived.get(row[1]));
 preview.textContent=entry.name+"（"+klass+"）｜已確認公費領用："+row[2]+"款 "+row[3]+"。請核對實際交回的衣服。";
 submit.disabled=false;
}
byId("competitionReturnStudent").addEventListener("change",()=>{byId("competitionReturnEvidence").value="";syncStudent()});
byId("competitionReturnStyle").addEventListener("change",()=>{
 const id=byId("competitionReturnStudent").value,row=studentRows.get(id)?.row;
 setSizes(byId("competitionReturnStyle").value,row?.[2]===byId("competitionReturnStyle").value?row[3]:"");
});
setSizes("男");
const date=value=>value?new Date(value).toLocaleString("zh-TW",{timeZone:"Asia/Taipei",hour12:false}):"—";
function render(){
 const root=byId("competitionReturnRecords");root.replaceChildren();
 const sorted=[...returns].sort((a,b)=>String(b.receivedAt).localeCompare(String(a.receivedAt)));
 byId("competitionReturnListStatus").textContent="共 "+sorted.length+" 筆；待確認送洗 "+sorted.filter(x=>x.status==="RECEIVED").length+" 筆、舊紀錄待入庫 "+sorted.filter(x=>x.status==="WASHING").length+" 筆、已入庫 "+sorted.filter(x=>x.status==="STOCKED").length+" 筆。";
 if(!sorted.length){root.textContent="目前沒有正式歸還紀錄。";return}
 for(const item of sorted){
  const card=document.createElement("article");card.className="competition-return-card";
  const heading=document.createElement("strong");heading.textContent=(item.studentName||item.studentId)+"（"+item.studentId+"）｜"+item.style+"款 "+item.size;
  const state=document.createElement("p");state.textContent=labels[item.status]||item.status;
  const source=document.createElement("p");source.textContent=(item.source==="FORMAL"?"系統正式發放":"已確認歷史領用")+"｜收回 "+date(item.receivedAt)+(item.stockedAt?"｜入庫 "+date(item.stockedAt):"");
  card.append(heading,state,source);
  if(item.status==="STOCKED"){
   const operator=document.createElement("p");
   const account=item.stockedBy&&item.stockedBy!=="admin"?item.stockedBy:"";
   const display=item.stockedByLabel||item.stockedByName&&item.stockedByName.toLowerCase()!==account.toLowerCase()&&item.stockedByName||account||"舊紀錄未留存帳號";
   operator.textContent="入庫經辦："+display;
   card.append(operator);
  }
  if(item.sourceNote){const evidence=document.createElement("p");evidence.textContent="核對依據："+item.sourceNote;card.append(evidence)}
  const actions=document.createElement("div");actions.className="return-actions";
  const choices=["RECEIVED","WASHING"].includes(item.status)?[["ACCEPT","確認已完成送洗並入庫"],["REJECT","不合格，不入庫"]]:[];
  for(const [action,label] of choices){const button=document.createElement("button");button.type="button";button.textContent=label;button.addEventListener("click",()=>advance(item,action,button));actions.append(button)}
  card.append(actions);root.append(card);
 }
}
async function reload(){
 try{
  const [data,students]=await Promise.all([call("uniform-events/competition-returns"),call("students")]);
  returns=data.items||[];issues=data.issues||[];
  const list=Array.isArray(students)?students:students.items||[];
  studentRows=new Map();
  for(const student of list){
   if(!student.studentId)continue;
   const id=String(student.studentId),name=nameOf(student),row=rosterByName.get(name);
   if(row||issues.some(issue=>String(issue.studentId)===id))studentRows.set(id,{name,row});
  }
  const selected=byId("competitionReturnStudent").value;
  const select=byId("competitionReturnStudent");
  select.replaceChildren(new Option("請選擇學生",""));
  for(const [id,entry] of [...studentRows].sort((a,b)=>{
   const klass=value=>value.row?(confirmedReceived.has(value.row[1])?promotedClass(confirmedReceived.get(value.row[1])):value.row[0]):"Z";
   return klass(a[1]).localeCompare(klass(b[1]),"en",{numeric:true})||a[1].name.localeCompare(b[1].name,"zh-Hant");
  })){
   const row=entry.row,klass=row?(confirmedReceived.has(row[1])?promotedClass(confirmedReceived.get(row[1])):row[0]):"";
   const registered=row?row[2]+"款 "+row[3]:"正式發放";
   select.add(new Option(klass+" "+entry.name+"（"+id+"）｜"+registered,id));
  }
  if([...select.options].some(option=>option.value===selected))select.value=selected;
  render();syncStudent();
 }catch(error){byId("competitionReturnListStatus").textContent="讀取歸還紀錄失敗："+error.message;byId("competitionReturnStudentSummary").textContent="學生資料讀取失敗，請重新整理後再操作。"}
}
byId("competitionReturnForm").addEventListener("submit",async event=>{
 event.preventDefault();
 const id=byId("competitionReturnStudent").value,entry=studentRows.get(id),source=byId("competitionReturnSource").value;
 const message=byId("competitionReturnMessage"),button=event.submitter;
 if(!entry||!source){message.textContent="請先選擇可辦理公費歸還的學生。";return}
 const body=source==="FORMAL"?{action:"REGISTER",source,sourceRequestId:byId("competitionFormalIssue").value,confirmWashedAndStock:true}:
  {action:"REGISTER",source,studentId:id,style:byId("competitionReturnStyle").value,size:byId("competitionReturnSize").value,sourceNote:byId("competitionReturnEvidence").value.trim(),confirmWashedAndStock:true};
 if(source==="HISTORICAL"&&body.sourceNote.length<8){message.textContent="請填寫至少 8 字的領用及實物核對說明。";return}
 if(source==="HISTORICAL"&&(body.style!==entry.row[2]||body.size!==entry.row[3])&&!confirm("實際交回的款式或尺寸與學生登記資料不同，已於核對說明記錄原因並確認實物嗎？"))return;
 if(!confirm("確認 "+entry.name+" 已交回 "+(source==="FORMAL"?issues.find(issue=>issue.requestId===body.sourceRequestId)?.style+"款 "+issues.find(issue=>issue.requestId===body.sourceRequestId)?.size:body.style+"款 "+body.size)+" 的公費比賽服，且已完成送洗、可再次發放？確認後將直接入庫 1 件。"))return;
 button.disabled=true;message.textContent="正在登記歸還並入庫…";
 try{await call("uniform-events/competition-returns",{method:"POST",body:JSON.stringify(body)});message.textContent="已確認送洗並入庫 1 件。";await reload();byId("reload")?.click()}
 catch(error){message.textContent="登記未完成："+error.message;await reload()}
 finally{button.disabled=false;syncStudent()}
});
async function advance(item,action,button){
 let reason="";
 if(action==="REJECT"){reason=prompt("請填寫驗收不合格原因（不會入庫）","");if(reason===null)return}
 if(action==="REJECT"&&reason.trim().length<3){byId("competitionReturnMessage").textContent="請填寫至少 3 字的原因。";return}
 const label={ACCEPT:"確認此套比賽服已完成送洗、可再次發放？確認後將直接入庫，對應款式與尺寸的可用庫存增加 1 件。",REJECT:"確認標記為不合格？不會增加庫存。"}[action];
 if(!confirm(label))return;
 button.disabled=true;
 try{await call("uniform-events/competition-returns",{method:"POST",body:JSON.stringify({action,id:item.id,etag:item.etag,reason:reason.trim()})});byId("competitionReturnMessage").textContent=action==="ACCEPT"?"已確認完成送洗並入庫 1 件。":"歸還狀態已更新。";await reload();if(action==="ACCEPT")byId("reload")?.click()}
 catch(error){byId("competitionReturnMessage").textContent="操作結果未確認："+error.message;await reload()}
 finally{button.disabled=false}
}
window.addEventListener("uniformAdminAuth",event=>{if(event.detail?.authenticated)reload()});
