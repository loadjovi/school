const $=id=>document.getElementById(id);
let links=[],records=[],names=new Map();
const headers=()=>({"Content-Type":"application/json",...(window.uniformEventAuthHeaders?.()||{})});
async function call(path,options={}){
 const r=await fetch("/api/"+path,{credentials:"same-origin",cache:"no-store",...options,headers:{...headers(),...(options.headers||{})}});
 const d=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(d.error||"HTTP "+r.status);
 return d;
}
function cell(tr,v){const td=document.createElement("td");td.textContent=String(v??"");tr.append(td)}
function draw(){
 const student=$("tshirtParentStudent"),before=student.value,unique=new Map();
 for(const l of links){const key=String(l.studentId||"").trim();if(key&&!unique.has(key))unique.set(key,l)}
 student.replaceChildren(new Option("請選擇學生",""));
 for(const [id,l] of [...unique].sort((a,b)=>a[0].localeCompare(b[0])))student.add(new Option((names.get(id)||l.studentName||"姓名待補登")+"（"+id+"）",id));
 if([...student.options].some(o=>o.value===before))student.value=before;
 drawParents();
 const container=$("tshirtParentRecords"),table=document.createElement("table"),head=document.createElement("tr");
 for(const title of ["家長","關聯學生","角色","尺寸","狀態","領取時間","歸還時間"]){const th=document.createElement("th");th.textContent=title;head.append(th)}
 table.append(head);
 for(const x of records){const tr=document.createElement("tr");for(const v of [x.parentName+"（"+x.parentEmail+"）",(names.get(x.studentId)||"姓名待補登")+"（"+x.studentId+"）",x.role==="CADRE"?"幹部":"志工",x.size,({ISSUED_LIFETIME:"終身已領取",BORROWED:"借用中",WASHING:"送洗中",RETURNED:"已洗淨歸還"})[x.status]||x.status,x.issuedAt||"",x.returnedAt||""])cell(tr,v);table.append(tr)}
 container.replaceChildren(table);
 $("tshirtParentListStatus").textContent="共 "+records.length+" 位家長有紀錄；同一家長只會有一筆目前狀態。";
}
function drawParents(){
 const studentId=$("tshirtParentStudent").value,parent=$("tshirtParentSelect"),before=parent.value;
 const found=new Map();
 for(const l of links.filter(x=>x.studentId===studentId)){const email=String(l.parentEmail||"").toLowerCase();if(email&&!found.has(email))found.set(email,l)}
 parent.replaceChildren(new Option(studentId?"請選擇實際領用家長":"請先選擇學生",""));
 for(const [email,l] of found)parent.add(new Option((l.parentName||l.relationship||"家長")+"（"+email+"）",email));
 if([...parent.options].some(o=>o.value===before))parent.value=before;
 const record=records.find(x=>x.parentEmail===parent.value);
 if(record)$("tshirtParentFeedback").textContent="此家長現有紀錄："+({ISSUED_LIFETIME:"幹部終身已領取，不可重複",BORROWED:"志工借用中",WASHING:"志工送洗中",RETURNED:"志工已歸還，可再次借用"})[record.status];
 else $("tshirtParentFeedback").textContent=studentId?(found.size?"請選擇家長 Gmail。":"此學生尚無已核准的家長 Gmail 綁定。"):"請先選擇學生。";
}

async function reload(){
 $("tshirtParentListStatus").textContent="正在查詢家長綁定與領用紀錄…";
 try{
  const [a,b,students]=await Promise.all([call("student-parent-links"),call("uniform-events/parent-loans"),call("students")]);
  links=a.items||[];records=b.items||[];const roster=Array.isArray(students)?students:(students.items||[]);names=new Map(roster.map(x=>[String(x.studentId||""),String(x.studentName||x.name||"").trim()]));draw();
 }catch(e){$("tshirtParentListStatus").textContent="無法載入："+e.message}
}
$("tshirtParentStudent")?.addEventListener("change",drawParents);
$("tshirtParentSelect")?.addEventListener("change",drawParents);
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
