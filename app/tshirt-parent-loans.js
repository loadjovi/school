const $=id=>document.getElementById(id);
let links=[],records=[];
const headers=()=>({"Content-Type":"application/json",...(window.uniformEventAuthHeaders?.()||{})});
async function call(path,options={}){
 const r=await fetch("/api/"+path,{credentials:"same-origin",cache:"no-store",...options,headers:{...headers(),...(options.headers||{})}});
 const d=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(d.error||"HTTP "+r.status);
 return d;
}
function cell(tr,v){const td=document.createElement("td");td.textContent=String(v??"");tr.append(td)}
function draw(){
 const parent=$("tshirtParentSelect"),value=parent.value,unique=new Map();
 for(const l of links){const key=String(l.parentEmail||"").toLowerCase();if(!key)continue;if(!unique.has(key))unique.set(key,l)}
 parent.replaceChildren(new Option("請選擇家長",""));
 for(const [email,l] of unique)parent.add(new Option((l.parentName||"未提供姓名")+"（"+email+"）",email));
 parent.value=value;
 drawStudents();
 const container=$("tshirtParentRecords"),table=document.createElement("table"),head=document.createElement("tr");
 for(const title of ["家長","關聯學生","角色","尺寸","狀態","領取時間","歸還時間"]){const th=document.createElement("th");th.textContent=title;head.append(th)}
 table.append(head);
 for(const x of records){const tr=document.createElement("tr");for(const v of [x.parentName+"（"+x.parentEmail+"）",x.studentId,x.role==="CADRE"?"幹部":"志工",x.size,({ISSUED_LIFETIME:"終身已領取",BORROWED:"借用中",WASHING:"送洗中",RETURNED:"已洗淨歸還"})[x.status]||x.status,x.issuedAt||"",x.returnedAt||""])cell(tr,v);table.append(tr)}
 container.replaceChildren(table);
 $("tshirtParentListStatus").textContent="共 "+records.length+" 位家長有紀錄；同一家長只會有一筆目前狀態。";
}
function drawStudents(){
 const email=$("tshirtParentSelect").value,student=$("tshirtParentStudent"),before=student.value;
 student.replaceChildren(new Option("請選擇關聯學生",""));
 for(const l of links.filter(x=>String(x.parentEmail||"").toLowerCase()===email))student.add(new Option(l.studentId+"（"+(l.relationship||"家長")+"）",l.studentId));
 if([...student.options].some(o=>o.value===before))student.value=before;
 const record=records.find(x=>x.parentEmail===email);
 if(record)$("tshirtParentFeedback").textContent="此家長現有紀錄："+({ISSUED_LIFETIME:"幹部終身已領取，不可重複",BORROWED:"志工借用中",WASHING:"志工送洗中",RETURNED:"志工已歸還，可再次借用"})[record.status];
 else $("tshirtParentFeedback").textContent="此家長尚無領用紀錄。";
}
async function reload(){
 $("tshirtParentListStatus").textContent="正在查詢家長綁定與領用紀錄…";
 try{
  const [a,b]=await Promise.all([call("student-parent-links"),call("uniform-events/parent-loans")]);
  links=a.items||[];records=b.items||[];draw();
 }catch(e){$("tshirtParentListStatus").textContent="無法載入："+e.message}
}
$("tshirtParentSelect")?.addEventListener("change",drawStudents);
$("tshirtParentReload")?.addEventListener("click",reload);
$("tshirtParentLoanForm")?.addEventListener("submit",async e=>{
 e.preventDefault();
 const email=$("tshirtParentSelect").value,studentId=$("tshirtParentStudent").value,action=$("tshirtParentAction").value,size=$("tshirtParentSize").value;
 const link=links.find(x=>String(x.parentEmail||"").toLowerCase()===email&&x.studentId===studentId);
 if(!link){$("tshirtParentFeedback").textContent="請選擇有效的家長與學生綁定";return}
 const previous=records.find(x=>x.parentEmail===email);
 if(!confirm("確定為家長「"+(link.parentName||email)+"」執行 "+$("tshirtParentAction").selectedOptions[0].text+"？"))return;
 try{
  $("tshirtParentFeedback").textContent="正在儲存…";
  await call("uniform-events/parent-loans",{method:"POST",body:JSON.stringify({parentEmail:email,parentName:link.parentName,studentId,action,size,etag:previous?.etag||""})});
  $("tshirtParentFeedback").textContent="已更新家長領用紀錄";await reload();
 }catch(err){$("tshirtParentFeedback").textContent="儲存失敗："+err.message}
});
window.addEventListener("uniformAdminAuth",e=>{if(e.detail?.authenticated)reload()});
