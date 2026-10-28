const $=id=>document.getElementById(id);
let links=[],records=[],names=new Map();
let parentSearch="",parentRole="ALL";
const headers=()=>({"Content-Type":"application/json",...(window.uniformEventAuthHeaders?.()||{})});
async function call(path,options={}){
 const r=await fetch("/api/"+path,{credentials:"same-origin",cache:"no-store",...options,headers:{...headers(),...(options.headers||{})}});
 const d=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(d.error||"HTTP "+r.status);
 return d;
}
function displayTime(value){if(!value)return "—";const date=new Date(value);return Number.isNaN(date.getTime())?String(value):new Intl.DateTimeFormat("zh-TW",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).format(date)}
const loanStatus=x=>({REQUESTED:"已申請，尚未領取",ISSUED_LIFETIME:"已領取（終身一次）",BORROWED:"借用中",WASHING:"送洗中",RETURNED:"已歸還"})[x.status]||x.status;
function drawRecords(){
 const container=$("tshirtParentRecords");container.replaceChildren();
 const toolbar=document.createElement("div");toolbar.className="parent-loan-toolbar";
 const search=document.createElement("input");search.type="search";search.placeholder="搜尋家長、Email 或學生";search.setAttribute("aria-label","搜尋家長領用紀錄");search.value=parentSearch;
 const role=document.createElement("select");role.setAttribute("aria-label","篩選家長角色");
 for(const [value,label] of [["ALL","全部角色"],["CADRE","幹部"],["VOLUNTEER","志工"]])role.add(new Option(label,value));role.value=parentRole;
 toolbar.append(search,role);
 const list=document.createElement("div");list.className="parent-loan-list";
 const count=document.createElement("p");count.className="parent-loan-count";
 container.append(toolbar,count,list);
 function updateList(){
  const query=parentSearch.trim().toLocaleLowerCase();
  const filtered=records.filter(x=>(parentRole==="ALL"||x.role===parentRole)&&(!query||[x.parentName,x.parentEmail,names.get(String(x.studentId)),x.studentId].some(v=>String(v||"").toLocaleLowerCase().includes(query))));
  filtered.sort((a,b)=>(a.role===b.role?0:a.role==="CADRE"?-1:1)||String(a.parentName||a.parentEmail).localeCompare(String(b.parentName||b.parentEmail),"zh-TW"));
  count.textContent="顯示 "+filtered.length+"／"+records.length+" 位家長";
  list.replaceChildren();
  if(!filtered.length){const empty=document.createElement("p");empty.textContent=records.length?"找不到符合條件的家長。":"目前尚無家長領用或借還紀錄。";list.append(empty);return}
  for(const x of filtered){
   const details=document.createElement("details");details.className="parent-loan-record";
   const summary=document.createElement("summary"),name=document.createElement("strong"),meta=document.createElement("span"),status=document.createElement("span");
   name.textContent=x.parentName||x.parentEmail||"家長";
   meta.textContent=(x.role==="CADRE"?"幹部":"志工")+" · "+(x.size||"尺寸待補")+" · "+(names.get(String(x.studentId))||"學生姓名待補");
   status.className="parent-loan-status";status.textContent=loanStatus(x);
   summary.append(name,meta,status);details.append(summary);
   const body=document.createElement("dl");
   for(const [label,value] of [["申請時間",displayTime(x.requestedAt)],["更正原因",x.correctionReason],["家長 Email",x.parentEmail],["關聯學生",(names.get(String(x.studentId))||"姓名待補登")+"（"+x.studentId+"）"],["角色",x.role==="CADRE"?"幹部":"志工"],["尺寸",x.size||"—"],["目前狀態",loanStatus(x)],["領取時間",displayTime(x.issuedAt)],["歸還時間",displayTime(x.returnedAt)]]){
    const dt=document.createElement("dt"),dd=document.createElement("dd");dt.textContent=label;dd.textContent=String(value||"—");body.append(dt,dd)
   }
   details.append(body);
   if(x.role==="CADRE"){
    for(const [action,label] of (x.status==="REQUESTED"?[["ISSUE_CADRE","確認已領取（終身一次）"],["EDIT_CADRE_PENDING","修改申請尺寸"]]:x.status==="ISSUED_LIFETIME"?[["CORRECT_CADRE_PENDING","更正為已申請、尚未領取"]]:[])){
     const button=document.createElement("button");button.type="button";button.textContent=label;
     button.addEventListener("click",async()=>{
      let size=x.size,reason="";
      if(action==="EDIT_CADRE_PENDING"){size=prompt("請輸入團 T 尺寸：8、10、12、XS、S、M、L、XL、2L、3L、5L",x.size);if(size===null)return;size=size.trim().toUpperCase()}
      if(action==="CORRECT_CADRE_PENDING"){reason=prompt("請填寫更正原因（未實際領取，恢復採購需求）");if(!reason?.trim())return}
      if(!confirm(`${x.parentName||x.parentEmail}：${label}？`))return;
      button.disabled=true;
      try{await call("uniform-events/parent-loans",{method:"POST",body:JSON.stringify({parentEmail:x.parentEmail,parentName:x.parentName,studentId:x.studentId,size,action,reason,etag:x.etag})});await reload();window.dispatchEvent(new CustomEvent("tshirtParentLoansChanged"))}
      catch(error){alert(error.message);button.disabled=false}
     });details.append(button);
    }
   }
   list.append(details)
  }
 }
 search.addEventListener("input",()=>{parentSearch=search.value;updateList()});role.addEventListener("change",()=>{parentRole=role.value;updateList()});updateList();
 $("tshirtParentListStatus").textContent="幹部 "+records.filter(x=>x.role==="CADRE").length+" 位、志工 "+records.filter(x=>x.role!=="CADRE").length+" 位；點選人員可查看完整紀錄。";
}
function draw(){
 const student=$("tshirtParentStudent"),before=student.value,unique=new Map();
 for(const l of links){const key=String(l.studentId||"").trim();if(key&&!unique.has(key))unique.set(key,l)}
 student.replaceChildren(new Option("請選擇學生",""));
 for(const [id,l] of [...unique].sort((a,b)=>a[0].localeCompare(b[0])))student.add(new Option((names.get(id)||l.studentName||"姓名待補登")+"（"+id+"）",id));
 if([...student.options].some(o=>o.value===before))student.value=before;
 drawParents();
 drawRecords();
}
function drawParents(){
 const studentId=$("tshirtParentStudent").value,parent=$("tshirtParentSelect"),before=parent.value;
 const found=new Map();
 for(const l of links.filter(x=>x.studentId===studentId)){const email=String(l.parentEmail||"").toLowerCase();if(email&&!found.has(email))found.set(email,l)}
 parent.replaceChildren(new Option(studentId?"請選擇實際領用家長":"請先選擇學生",""));
 for(const [email,l] of found)parent.add(new Option((l.parentName||l.relationship||"家長")+"（"+email+"）",email));
 if([...parent.options].some(o=>o.value===before))parent.value=before;
 const record=records.find(x=>x.parentEmail===parent.value);
 if(record)$("tshirtParentFeedback").textContent="此家長現有紀錄："+({REQUESTED:"已申請，尚未領取；請在下方紀錄確認發放或更改尺寸",ISSUED_LIFETIME:"幹部終身已領取，不可重複",BORROWED:"志工借用中",WASHING:"志工送洗中",RETURNED:"志工已歸還，可再次借用"})[record.status];
 else $("tshirtParentFeedback").textContent=studentId?(parent.value?"請確認家長本人尺寸與操作後儲存。":found.size?"請選擇家長 Gmail。":"此學生尚無已核准的家長 Gmail 綁定。"):"請先選擇學生。";
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
  $("tshirtParentFeedback").textContent="已更新家長申請／領用紀錄";await reload();window.dispatchEvent(new CustomEvent("tshirtParentLoansChanged"));
 }catch(err){$("tshirtParentFeedback").textContent="儲存失敗："+err.message}
});
window.addEventListener("uniformAdminAuth",e=>{if(e.detail?.authenticated)reload()});
