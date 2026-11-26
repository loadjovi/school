import {createLineAccountPanel} from "./line-account-panel.js?v=20261127-teacher-browser-binding";
import {createLineNotificationSettings} from "./line-notification-settings.js?v=20261123-notification-settings";
const $=id=>document.getElementById(id),form=$("announcement"),status=$("result"),preview=$("preview"),send=$("send");
let centerAdminReady=false,centerTab="send",accountPanel=null,accountReturnHandled=false,centerVersion=0;
let confirmed=null,revision=0,activities=[],schoolGroups=[],optionsLoaded=false,loadingVersion=0,busy=false;
const mode=()=>form.querySelector('[name="audience"]:checked')?.value||"members";
const selectedActivity=()=>activities.find(x=>x.key===$("activityKey").value);
function setupActivityReturn(){
  const query=new URLSearchParams(location.search),key=query.get("fromActivity"),school=query.get("activitySchool");
  if(!/^(calendarActivity|fieldTrip|yearEndDinner):[A-Za-z0-9_-]{1,80}$/.test(key||"")||school&&!/^[a-z0-9-]{2,60}$/.test(school))return;
  const target=new URLSearchParams(query.get("returnMode")==="workspace"?{adminActivity:key}:{task:"activity",activity:key});
  if(school)target.set("activitySchool",school);
  const href=(query.get("returnMode")==="workspace"?"/":"/uniform-event-admin.html")+"?"+target;
  $("backLink").href=href;$("backLink").textContent="← 返回原活動";
  $("returnActivityAfterSend").href=href;$("returnActivityAfterSend").hidden=false;$("activityReturnHint").hidden=false;
}
setupActivityReturn();
const teamName=group=>({A:"A 團",B:"B 團",儲備:"儲備團"})[group]||group;
const includesStaff=()=>mode()==="staff"||mode()==="members"&&form.elements.includeStaff.checked;
const staffGroupKey=()=>form.querySelector('[name="staffScope"]:checked')?.value==="school"?"school:teachers":"school:cadres";
const schoolGroupName=key=>schoolGroups.find(group=>group.key===key)?.title||({"school:teachers":"學校群組","school:cadres":"幹部群組","school:finance":"財務幹部群組"})[key]||"學校群組";
const schoolGroupLabel=key=>{const group=schoolGroups.find(group=>group.key===key);return schoolGroupName(key)+(group?.bound?"「"+group.groupName+"」":"（尚未綁定）")};
function selection(){
  const audience=mode(),members=audience==="members",group=audience==="activityGroup";
  const roles=members?[...form.querySelectorAll('[name="role"]:checked')].map(input=>input.value):[];
  const schoolGroupKeys=includesStaff()?[staffGroupKey()]:[];
  const allSchool=!members||form.querySelector('[name="groupScope"]:checked')?.value==="all";
  return {audience:group?"activityGroup":audience==="staff"?"schoolGroups":"members",roles,groups:members&&!allSchool?[...form.querySelectorAll('[name="group"]:checked')].map(input=>input.value):[],schoolGroupKeys,allSchool,activityKey:group?$("activityKey").value:""};
}
function updateSummary(){
  if(mode()==="activityGroup"){
    const activity=selectedActivity();
    $("audienceSummary").textContent=activity?.bound?`本次通知：${activity.title}的「${activity.groupName}」群組`:"本次通知：請先選擇已綁定的活動志工群組。";
    return;
  }
  const selected=selection(),parts=[];
  if(mode()==="members"){
    const roles=selected.roles.filter(role=>["parent","teacher"].includes(role)).map(role=>({parent:"家長",teacher:"老師"})[role]);
    if(!roles.length)parts.push("請勾選家長或老師");
    else if(!selected.allSchool&&!selected.groups.length)parts.push("請勾選團別");
    else parts.push((selected.allSchool?"所有團別":selected.groups.map(teamName).join("、"))+"的"+roles.join("與"));
  }
  if(includesStaff())parts.push(schoolGroupLabel(staffGroupKey()));
  $("audienceSummary").textContent="本次通知："+parts.join("；另通知");
}
async function request(body){
  const token=sessionStorage.getItem("google_id_token"),school=sessionStorage.getItem("school_context_id"),role=sessionStorage.getItem("role_context");
  const response=await fetch("/api/line/announcements",{credentials:"same-origin",method:body?"POST":"GET",cache:"no-store",
    headers:{"Content-Type":"application/json",...(token&&token!=="cookie-session"?{"X-Google-ID-Token":token}:{}),...(school?{"X-School-Id":school}:{}),...(role?{"X-Role-Context":role}:{})},
    ...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||"LINE 通知中心暫時不可用");return data;
}
async function centerApi(path,options={}){
  const token=sessionStorage.getItem("google_id_token"),school=sessionStorage.getItem("school_context_id"),role=sessionStorage.getItem("role_context");
  const response=await fetch(path,{...options,credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json",...(token&&token!=="cookie-session"?{"X-Google-ID-Token":token}:{}),...(school?{"X-School-Id":school}:{}),...(role?{"X-Role-Context":role}:{}),...(options.headers||{})}});
  const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||"LINE 設定暫時無法讀取");return data;
}
const groupSettings=createLineNotificationSettings({host:$("lineSettingsPanel"),api:centerApi,onChanged:async()=>{revision++;clearPreview();await loadOptions()}});
async function selectCenterTab(tab){
  if(!centerAdminReady||groupSettings.isBusy()||accountPanel?.isBusy())return;
  centerTab=["settings","account"].includes(tab)?tab:"send";
  $("lineSendPanel").hidden=centerTab!=="send";$("lineSettingsPanel").hidden=centerTab!=="settings";$("lineAccountPanel").hidden=centerTab!=="account";
  for(const button of document.querySelectorAll("[data-line-center-tab]"))button.setAttribute("aria-selected",String(button.dataset.lineCenterTab===centerTab));
  groupSettings.setActive(centerTab==="settings");
  if(centerTab==="settings")await groupSettings.load();
  if(centerTab==="account"&&accountPanel){
    const panel=accountPanel,params=new URLSearchParams(location.search),loaded=await panel.load(accountReturnHandled?undefined:params);
    if(!loaded||panel!==accountPanel||!centerAdminReady)return;
    accountReturnHandled=true;
    if(["line_link","line_error","line_friend"].some(name=>params.has(name))){for(const name of ["line_link","line_error","line_friend"])params.delete(name);params.set("tab","account");history.replaceState({},"",location.pathname+"?"+params)}
  }
}
function centerIdentityScope(){try{return ['school_context_id','role_context','google_id_token'].map(key=>sessionStorage.getItem(key)||'').join('|')}catch{return ''}}
async function initializeCenter(){
  const version=++centerVersion,scope=centerIdentityScope();
  const current=()=>version===centerVersion&&scope===centerIdentityScope();
  const options=loadOptions().catch(error=>{if(current())status.textContent=error.message});
  try{
    const me=await centerApi("/api/me");if(!current())return;if(me.role!=="admin")throw Error("僅限本校管理員使用群組與通知設定");
    accountPanel?.destroy();accountReturnHandled=false;
    accountPanel=createLineAccountPanel({host:$("lineAccountPanel"),api:centerApi,me,returnTo:"notification-center",navigate:url=>{if(window.parent!==window)window.parent.location.assign(url);else location.assign(url)},onChanged:async()=>{revision++;clearPreview();try{await loadOptions()}catch{}}});
    centerAdminReady=true;$("lineSettingsTab").disabled=false;$("lineAccountTab").disabled=false;
    const params=new URLSearchParams(location.search);const tab=["line_link","line_error","line_friend"].some(name=>params.has(name))?"account":params.get("tab")||centerTab;if(["settings","account"].includes(tab))await selectCenterTab(tab);
  }catch(error){if(current()){$("lineSettingsAuthStatus").textContent=error.message;status.textContent=error.message}}
  await options;
}
$("lineSendTab").addEventListener("click",()=>selectCenterTab("send"));
$("lineSettingsTab").addEventListener("click",()=>selectCenterTab("settings"));
$("lineAccountTab").addEventListener("click",()=>selectCenterTab("account"));
window.addEventListener("pagehide",()=>{centerVersion++;loadingVersion++;centerAdminReady=false;$("lineSettingsTab").disabled=true;$("lineAccountTab").disabled=true;groupSettings.setActive(false);accountPanel?.destroy()});
window.addEventListener("pageshow",event=>{if(event.persisted)void initializeCenter()});
function clearPreview(){confirmed=null;$("recipientPreview").hidden=true;$("deliveryReport").hidden=true;status.textContent=""}
function drawRecipients(host,items){
  host.replaceChildren();
  for(const item of items||[]){
    const row=document.createElement("p"),name=String(item.name||"LINE 帳號"),reference=String(item.reference||"").slice(0,6);
    const reason=item.httpStatus===429?"（額度或發送頻率限制）":[401,403].includes(item.httpStatus)?"（請檢查官方帳號設定）":item.httpStatus===400?"（對象或訊息遭拒絕）":item.status==="failed"?"（可重試）":"";
    row.textContent=(item.kind==="group"?"群組｜":"")+name+(reference?" · "+reference:"")+"｜"+(item.status==="email_accepted"?"Email 已受理，收件待確認":item.status==="accepted"?"API 已受理，收件待確認":item.status==="failed"?"API 發送失敗"+reason:"已綁定，尚未發送");
    row.style.overflowWrap="anywhere";host.append(row);
  }
}
function updateGroup(){
  const activity=selectedActivity();
  $("activityGroupStatus").textContent=!activity?"請選擇活動，確認本次通知的志工群組。":activity.bound?`已綁定：${activity.groupName}`:"此活動尚未綁定志工 LINE 群組。";
  $("createGroupCode").disabled=busy||!activity;$("createGroupCode").textContent=activity?.bound?"更換此活動的群組綁定":"產生群組綁定碼";
  $("unbindGroup").hidden=!activity?.bound;$("unbindGroup").disabled=busy;
}
function updateMode(){
  const audience=mode(),group=audience==="activityGroup",members=audience==="members";
  $("memberPanel").hidden=!members;$("memberPanel").disabled=!members||busy;
  $("includeStaffOption").hidden=!members;form.elements.includeStaff.disabled=!members||busy;
  $("staffPanel").hidden=!includesStaff();$("staffPanel").disabled=!includesStaff()||busy;
  const selected=members&&form.querySelector('[name="groupScope"]:checked')?.value==="selected";
  $("teams").hidden=!selected;form.querySelectorAll('[name="group"]').forEach(input=>{input.disabled=!selected||busy});
  $("activityPanel").hidden=!group;$("activityPanel").disabled=!group||busy;
  $("activityKey").required=group;$("messageLabel").textContent=(audience==="staff"?"2":"3")+"．輸入訊息";
  $("deliveryHint").textContent=group?"發送至此活動的志工 LINE 群組，群內所有成員皆可看到。":audience==="staff"?"發送至原有的多人 LINE 群組。":includesStaff()?"家長／個別老師收到個人訊息，幹部通知發到選定的群組。":"發送至個人 LINE 聊天室；同一個 LINE 只會收到一則。";
  $("receiptHint").textContent=group||audience==="staff"?"LINE API 受理不代表實際收件；請確認此校官方帳號仍在指定群組內。":"LINE API 受理不代表實際收件；個人收件者請加入本校官方帳號好友並確認未封鎖。";
  updateGroup();updateSummary();
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
    const meta=document.createElement("small"),unit=item.deliveryMode==="group"||["activityGroup","schoolGroups"].includes(item.audience)?"個群組":"人";
    meta.textContent=`${new Date(item.updatedAt).toLocaleString("zh-TW",{timeZone:"Asia/Taipei"})}｜`+(item.deliveryMode==="mixed"?`個人 API 受理 ${item.accepted-Number(item.groupAccepted||0)} 人｜群組 API 受理 ${Number(item.groupAccepted||0)} 個｜個人失敗 ${item.failed-Number(item.groupFailed||0)} 人｜群組失敗 ${Number(item.groupFailed||0)} 個`:`API 受理 ${item.accepted} ${unit}｜失敗 ${item.failed} ${unit}`)+(item.emailAccepted?"｜Email 受理 "+item.emailAccepted+" 人":"")+"｜實際收件未確認";
    const text=document.createElement("p");text.textContent=item.text;row.append(title,meta,text);
    if(item.recipientResults?.length){
      const details=document.createElement("details"),summary=document.createElement("summary"),list=document.createElement("div");summary.textContent=item.deliveryMode==="group"?"查看群組結果":item.deliveryMode==="mixed"?"查看個人與群組結果":"查看逐人結果";drawRecipients(list,item.recipientResults);details.append(summary,list);
      if(item.omittedRecipients){const omitted=document.createElement("p");omitted.textContent="另有 "+item.omittedRecipients+" 筆發送結果未列於本次明細。";details.append(omitted)}row.append(details);
    }else if(!["activityGroup","schoolGroups"].includes(item.audience)){const legacy=document.createElement("small");legacy.textContent=item.deliveryMode==="push"?"此筆紀錄沒有逐人受理結果。":"舊版批次紀錄，沒有逐人受理結果。";row.append(legacy)}
    host.append(row);
  }
}
async function loadOptions(){
  const version=++loadingVersion,selected=$("activityKey").value,selectedGroups=[...form.querySelectorAll('[name="group"]:checked')].map(x=>x.value),data=await request();if(version!==loadingVersion)return;
  $("siteName").textContent=data.schoolName||"學校平台";
  const teams=$("teams");teams.replaceChildren();
  for(const group of data.groups||[]){
    const label=document.createElement("label"),input=document.createElement("input");label.className="choice";input.type="checkbox";input.name="group";input.value=group;input.checked=selectedGroups.includes(group);
    label.append(input,teamName(group));teams.append(label);
  }
  schoolGroups=data.schoolGroups||[];
  activities=data.activities||[];const select=$("activityKey");select.replaceChildren(new Option("請先選擇活動",""));
  for(const activity of activities)select.append(new Option(activity.title+(activity.date?"｜"+activity.date.slice(0,10):"")+(activity.bound?"｜已綁定":""),activity.key));
  if(activities.some(x=>x.key===selected))select.value=selected;
  drawHistory(data.history||[]);optionsLoaded=true;updateMode();preview.disabled=busy;
}
form.addEventListener("input",event=>{
  revision++;clearPreview();
  if(["activityKey","audience"].includes(event.target.name))$("bindingInstructions").hidden=true;
  updateMode();
});
form.addEventListener("submit",async event=>{
  event.preventDefault();if(busy)return;clearPreview();
  const selected=selection(),draftRevision=revision,audience=selected.audience;
  if(mode()==="members"&&!selected.roles.some(role=>["parent","teacher"].includes(role))){status.textContent="請勾選要通知的家長或老師。";return}
  if(mode()==="members"&&!selected.allSchool&&!selected.groups.length){status.textContent="請至少勾選一個團別。";return}
  const body={action:"preview",...selected,text:$("message").value,requestId:crypto.randomUUID()};
  setBusy(true);
  try{
    const result=await request(body);if(revision!==draftRevision)return;
    confirmed={...body,action:"send",preview:result.preview};
    $("previewRecipient").textContent="收件對象："+result.targetLabel;
    $("previewCounts").textContent=audience==="activityGroup"||audience==="schoolGroups"?"訊息將送往上述 "+(result.groupDeliverable??result.deliverable)+" 個 LINE 群組。":`符合 ${result.matched} 個帳號，已綁定 ${result.memberDeliverable??result.deliverable} 個 LINE 帳號，未綁定 ${result.unbound} 個帳號。${result.groupDeliverable?"另通知 "+result.groupDeliverable+" 個 LINE 群組。":""}${result.lineFirst?"個人 LINE 未受理者改寄 Email。":""}`;
    drawRecipients($("previewRecipients"),result.recipients);
    $("previewMessage").textContent=body.text;$("recipientPreview").hidden=false;send.hidden=result.deliverable===0&&!(result.emailFallbackCandidates>0);
  }catch(error){status.textContent=error.message}
  finally{setBusy(false)}
});
send.addEventListener("click",async()=>{
  if(!confirmed||busy)return;const snapshot=confirmed,draftRevision=revision;setBusy(true);
  try{
    const result=await request(snapshot);if(revision!==draftRevision)return;
    const unit=["activityGroup","schoolGroups"].includes(snapshot.audience)?"個群組":"人";
    status.textContent=(result.deliveryMode==="mixed"?`個人 LINE API 已受理 ${result.accepted-result.groupAccepted} 人，Email 已受理 ${Number(result.emailAccepted||0)} 人，群組 API 已受理 ${result.groupAccepted} 個，個人失敗 ${result.failed-result.groupFailed} 人，群組失敗 ${result.groupFailed} 個；實際收件待確認。`:`LINE API 已受理 ${result.accepted} ${unit}，${result.lineFirst&&unit==="人"?"Email 已受理 "+Number(result.emailAccepted||0)+" 人，":""}失敗 ${result.failed} ${unit}；實際收件待確認。`)+(result.failed?"可重試本次相同發送。":"")+(result.fallbackStatus==="no_group_email_roster"?"群組沒有可核對的個人 Email 名單，無法備援寄信。":"")+(result.historySaved===false?"發送紀錄暫時無法儲存，請勿重複發送。":"");
    drawRecipients($("deliveryRecipients"),result.recipientResults);$("deliveryReport").hidden=!result.recipientResults?.length;
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
async function refreshGroups(){
  if(busy)return;revision++;clearPreview();setBusy(true);
  try{await loadOptions();status.textContent="已更新活動與群組狀態，請核對群組名稱。"}catch(error){status.textContent=error.message}
  finally{setBusy(false)}
}
$("refreshGroups").addEventListener("click",refreshGroups);
$("unbindGroup").addEventListener("click",async()=>{
  const activity=selectedActivity();if(!activity?.bound||busy||!confirm(`確定解除「${activity.title}」與「${activity.groupName}」的通知綁定？`))return;
  revision++;clearPreview();setBusy(true);
  try{await request({action:"activity-unbind",activityKey:activity.key});await loadOptions();$("bindingInstructions").hidden=true;status.textContent="已解除此活動的群組綁定。"}
  catch(error){status.textContent=error.message}
  finally{setBusy(false)}
});
await initializeCenter();
