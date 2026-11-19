const $=id=>document.getElementById(id),form=$("announcement"),status=$("result"),preview=$("preview"),send=$("send");
let confirmed=null,revision=0,activities=[],optionsLoaded=false,loadingVersion=0,busy=false;
const mode=()=>form.querySelector('[name="audience"]:checked')?.value||"members";
const selectedActivity=()=>activities.find(x=>x.key===$("activityKey").value);
async function request(body){
  const token=sessionStorage.getItem("google_id_token"),school=sessionStorage.getItem("school_context_id"),role=sessionStorage.getItem("role_context");
  const response=await fetch("/api/line/announcements",{credentials:"same-origin",method:body?"POST":"GET",cache:"no-store",
    headers:{"Content-Type":"application/json",...(token&&token!=="cookie-session"?{"X-Google-ID-Token":token}:{}),...(school?{"X-School-Id":school}:{}),...(role?{"X-Role-Context":role}:{})},
    ...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||"LINE 通知中心暫時不可用");return data;
}
function clearPreview(){confirmed=null;$("recipientPreview").hidden=true;status.textContent=""}
function updateGroup(){
  const activity=selectedActivity();
  $("activityGroupStatus").textContent=!activity?"請選擇活動，確認本次通知的志工群組。":activity.bound?`已綁定：${activity.groupName}`:"此活動尚未綁定志工 LINE 群組。";
  $("createGroupCode").disabled=busy||!activity;$("createGroupCode").textContent=activity?.bound?"更換此活動的群組綁定":"產生群組綁定碼";
  $("unbindGroup").hidden=!activity?.bound;$("unbindGroup").disabled=busy;
}
function updateMode(){
  const group=mode()==="activityGroup";
  $("memberPanel").hidden=group;$("memberPanel").disabled=group||busy;
  $("activityPanel").hidden=!group;$("activityPanel").disabled=!group||busy;
  $("activityKey").required=group;updateGroup();
}
function setBusy(value){
  busy=value;form.querySelectorAll("input,select,textarea,button").forEach(element=>{element.disabled=value});
  updateMode();preview.disabled=value||!optionsLoaded;
}
function drawHistory(items){
  const host=$("history");host.replaceChildren();
  if(!items.length){host.textContent="尚無發送紀錄。";return}
  for(const item of items){
    const row=document.createElement("div");row.className="history-item";
    const title=document.createElement("b");title.textContent=item.label;
    const meta=document.createElement("small"),unit=item.audience==="activityGroup"?"個群組":"人";
    meta.textContent=`${new Date(item.updatedAt).toLocaleString("zh-TW",{timeZone:"Asia/Taipei"})}｜LINE 已受理 ${item.accepted} ${unit}｜失敗 ${item.failed} ${unit}`;
    const text=document.createElement("p");text.textContent=item.text;row.append(title,meta,text);host.append(row);
  }
}
async function loadOptions(){
  const version=++loadingVersion,selected=$("activityKey").value,selectedGroups=[...form.querySelectorAll('[name="group"]:checked')].map(x=>x.value),data=await request();if(version!==loadingVersion)return;
  $("siteName").textContent=data.schoolName||"學校平台";
  const teams=$("teams");teams.replaceChildren();
  for(const group of data.groups||[]){
    const label=document.createElement("label"),input=document.createElement("input");label.className="choice";input.type="checkbox";input.name="group";input.value=group;input.checked=selectedGroups.includes(group);
    label.append(input,({A:"A 團",B:"B 團",儲備:"儲備團"})[group]||group);teams.append(label);
  }
  activities=data.activities||[];const select=$("activityKey");select.replaceChildren(new Option("請先選擇活動",""));
  for(const activity of activities)select.append(new Option(activity.title+(activity.date?"｜"+activity.date.slice(0,10):"")+(activity.bound?"｜已綁定":""),activity.key));
  if(activities.some(x=>x.key===selected))select.value=selected;
  drawHistory(data.history||[]);optionsLoaded=true;updateMode();preview.disabled=busy;
}
form.addEventListener("input",event=>{
  revision++;clearPreview();
  if(event.target.name==="allSchool"&&event.target.checked)form.querySelectorAll('[name="group"]').forEach(input=>{input.checked=false});
  if(event.target.name==="group"&&event.target.checked)form.elements.allSchool.checked=false;
  if(["activityKey","audience"].includes(event.target.name)){$("bindingInstructions").hidden=true;updateMode()}
});
form.addEventListener("submit",async event=>{
  event.preventDefault();if(busy)return;clearPreview();
  const data=new FormData(form),draftRevision=revision,audience=mode();
  const body={action:"preview",audience,roles:audience==="members"?data.getAll("role"):[],groups:audience==="members"?data.getAll("group"):[],allSchool:data.has("allSchool"),activityKey:data.get("activityKey")||"",text:data.get("message"),requestId:crypto.randomUUID()};
  setBusy(true);
  try{
    const result=await request(body);if(revision!==draftRevision)return;
    confirmed={...body,action:"send",preview:result.preview};
    $("previewRecipient").textContent="收件對象："+result.targetLabel;
    $("previewCounts").textContent=audience==="activityGroup"?"訊息會發到上述 1 個 LINE 群組，由群內所有成員看到。":`符合 ${result.matched} 個帳號，可通知 ${result.deliverable} 個 LINE，未綁定 ${result.unbound} 個帳號。`;
    $("previewMessage").textContent=body.text;$("recipientPreview").hidden=false;send.hidden=result.deliverable===0;
  }catch(error){status.textContent=error.message}
  finally{setBusy(false)}
});
send.addEventListener("click",async()=>{
  if(!confirmed||busy)return;const snapshot=confirmed,draftRevision=revision;setBusy(true);
  try{
    const result=await request(snapshot);if(revision!==draftRevision)return;
    const unit=snapshot.audience==="activityGroup"?"個群組":"人";
    status.textContent=`LINE 已受理 ${result.accepted} ${unit}，失敗 ${result.failed} ${unit}。`+(result.failed?"可重試本次相同發送。":"")+(result.historySaved===false?"發送紀錄暫時無法儲存，請勿重複發送。":"");
    if(!result.failed){confirmed=null;$("recipientPreview").hidden=true}
    try{await loadOptions()}catch{$("history").textContent="發送紀錄暫時無法讀取。"}
  }catch(error){status.textContent=error.message}
  finally{setBusy(false)}
});
$("createGroupCode").addEventListener("click",async()=>{
  const activity=selectedActivity();if(!activity||busy)return;revision++;clearPreview();setBusy(true);
  try{
    const result=await request({action:"activity-binding-code",activityKey:activity.key});
    $("bindingCommand").value="#綁定活動通知 "+result.code;
    $("bindingExpiry").textContent="活動："+result.activityTitle+"｜有效期限："+new Date(result.expiresAt).toLocaleString("zh-TW",{timeZone:"Asia/Taipei"});
    $("bindingInstructions").hidden=false;
  }catch(error){status.textContent=error.message}
  finally{setBusy(false)}
});
$("refreshGroups").addEventListener("click",async()=>{
  if(busy)return;revision++;clearPreview();setBusy(true);
  try{await loadOptions();status.textContent="已更新活動與群組狀態，請核對群組名稱。"}catch(error){status.textContent=error.message}
  finally{setBusy(false)}
});
$("unbindGroup").addEventListener("click",async()=>{
  const activity=selectedActivity();if(!activity?.bound||busy||!confirm(`確定解除「${activity.title}」與「${activity.groupName}」的通知綁定？`))return;
  revision++;clearPreview();setBusy(true);
  try{await request({action:"activity-unbind",activityKey:activity.key});await loadOptions();$("bindingInstructions").hidden=true;status.textContent="已解除此活動的群組綁定。"}
  catch(error){status.textContent=error.message}
  finally{setBusy(false)}
});
try{await loadOptions()}catch(error){status.textContent=error.message}
