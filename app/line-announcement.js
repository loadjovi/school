const form=document.getElementById("announcement");
const status=document.getElementById("result");
const preview=document.getElementById("preview");
const send=document.getElementById("send");
let confirmed=null;
let revision=0;

async function request(body){
  const token=sessionStorage.getItem("google_id_token");
  const school=sessionStorage.getItem("school_context_id");
  const role=sessionStorage.getItem("role_context");
  const response=await fetch("/api/line/announcements",{credentials:"same-origin",
    method:body?"POST":"GET",cache:"no-store",
    headers:{"Content-Type":"application/json",...(token&&token!=="cookie-session"?{"X-Google-ID-Token":token}:{}),
      ...(school?{"X-School-Id":school}:{}),...(role?{"X-Role-Context":role}:{})},
    ...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||"公告服務暫時不可用");
  return data;
}

function clearPreview(){
  confirmed=null;
  send.hidden=true;
  status.textContent="";
}
form.addEventListener("input",event=>{
  revision+=1;
  if(event.target.name==="allSchool"&&event.target.checked)form.querySelectorAll('[name="group"]').forEach(input=>{input.checked=false});
  if(event.target.name==="group"&&event.target.checked)form.elements.allSchool.checked=false;
  clearPreview();
});

form.addEventListener("submit",async event=>{
  event.preventDefault();
  clearPreview();
  const data=new FormData(form);
  const draftRevision=revision;
  const body={action:"preview",roles:data.getAll("role"),groups:data.getAll("group"),allSchool:data.has("allSchool"),
    text:data.get("message"),requestId:crypto.randomUUID()};
  preview.disabled=true;
  try{
    const result=await request(body);
    if(revision!==draftRevision)return;
    confirmed={...body,action:"send",preview:result.preview};
    status.textContent=`符合 ${result.matched} 個帳號，可送 ${result.deliverable} 個 LINE，未綁定 ${result.unbound} 個帳號。`;
    send.hidden=result.deliverable===0;
  }catch(error){status.textContent=error.message}
  finally{preview.disabled=false}
});

send.addEventListener("click",async()=>{
  if(!confirmed)return;
  send.disabled=true;
  preview.disabled=true;
  try{
    const result=await request(confirmed);
    status.textContent=`LINE 已受理 ${result.accepted} 人，失敗 ${result.failed} 人。`+
      (result.failed?"可重試相同發送。":"");
    if(!result.failed){confirmed=null;send.hidden=true}
  }catch(error){status.textContent=error.message}
  finally{send.disabled=false;preview.disabled=false}
});

try{
  const data=await request();
  for(const group of data.groups){
    const label=document.createElement("label");
    const input=document.createElement("input");
    input.type="checkbox";input.name="group";input.value=group;
    const teamName={A:"A 團",B:"B 團",儲備:"儲備團"}[group]||group;
    label.append(input,teamName);
    document.getElementById("teams").append(label);
  }
  preview.disabled=false;
}catch(error){status.textContent=error.message}
