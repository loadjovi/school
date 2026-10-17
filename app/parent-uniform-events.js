import {confirmedReceived} from "./competition-paper-receipts.js";
import "./parent-activity-notice.js";
import {buildUniformGrowth} from "./uniform-growth.js";
import {roster as competitionRoster} from "./competition-roster-data.js";
const competitionByName=new Map(competitionRoster.map(row=>[row[1],{style:row[2],size:row[3]}]));
const buttons=[...document.querySelectorAll("[data-view]")];const panels=[...document.querySelectorAll("[data-panel]")];function select(name){for(const b of buttons){const active=b.dataset.view===name;b.setAttribute("aria-selected",String(active));b.tabIndex=active?0:-1}for(const p of panels)p.hidden=p.dataset.panel!==name;document.getElementById("uniformRequestProgress").hidden=!["uniform","history"].includes(name)}buttons.forEach((b,i)=>{b.addEventListener("click",()=>select(b.dataset.view));b.addEventListener("keydown",e=>{if(!["ArrowRight","ArrowLeft","Home","End"].includes(e.key))return;e.preventDefault();const index=e.key==="Home"?0:e.key==="End"?buttons.length-1:(i+(e.key==="ArrowRight"?1:-1)+buttons.length)%buttons.length;select(buttons[index].dataset.view);buttons[index].focus()})});select("uniform");function mix(a,b,t){const x=parseInt(a.slice(1),16),y=parseInt(b.slice(1),16);return "#"+[16,8,0].map(n=>Math.round(((x>>n)&255)*(1-t)+((y>>n)&255)*t).toString(16).padStart(2,"0")).join("")}function luminance(c){const n=parseInt(c.slice(1),16),v=[16,8,0].map(k=>((n>>k)&255)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return .2126*v[0]+.7152*v[1]+.0722*v[2]}async function theme(){try{const schoolId=sessionStorage.getItem("school_context_id")||"";const q=new URLSearchParams();if(schoolId)q.set("schoolId",schoolId);const r=await fetch("/api/branding?"+q,{credentials:"same-origin"});if(!r.ok)return;const data=await r.json();let c=String(data.primaryColor||"");if(!/^#[0-9a-f]{6}$/i.test(c))return;for(let i=0;i<16&&1.05/(luminance(c)+.05)<4.5;i++)c=mix(c,"#000000",.13);document.documentElement.style.setProperty("--main",c);document.documentElement.style.setProperty("--soft",mix(c,"#ffffff",.91));document.documentElement.style.setProperty("--ink",mix(c,"#000000",.55))}catch(e){console.warn("Branding fallback",e)}}theme();

function parentAuthHeaders(){
 const token=sessionStorage.getItem("google_id_token")||"";
 const schoolId=sessionStorage.getItem("school_context_id")||"";
 const roleContext=sessionStorage.getItem("role_context")||"";
 return {...(token&&token!=="cookie-session"?{"X-Google-ID-Token":token}:{}),...(schoolId?{"X-School-Id":schoolId}:{}),...(roleContext?{"X-Role-Context":roleContext}:{})};
}
let growthStudents=[],growthRequests=[],growthTshirts=[],growthRequestsLoaded=false,growthTshirtsLoaded=false,growthTshirtsError="";
let publicUsedStudentIds=new Set(),historicalPublicStudentIds=new Set(),syncCompetitionPublicEligibility=()=>{};
function renderUniformGrowth(){
 const host=document.getElementById("uniformGrowth");if(!host)return;
 host.replaceChildren(element("h3","📈 孩子的團服成長紀錄"));
 if(!growthStudents.length){host.append(element("p","正在讀取孩子資料…","muted"));return}
 if(!growthRequestsLoaded){host.append(element("p","正在讀取團服申請…","muted"));return}
 host.append(element("p","依孩子與團服分開顯示；新購申請尚未等於已領用。","growth-note"));
 for(const student of growthStudents){
  const id=String(student.studentId||student.id||"");if(!id)continue;
  const name=student.name||student.studentName||id;
  const section=element("section",undefined,"growth-student");section.append(element("h4",name));
  const group=String(student.groupName||student.group||"").trim().toUpperCase().replace(/\s/g,"");
  const kinds=group==="A"||group==="A團"?["regularUniform","competitionUniform"]:["regularUniform"];
  for(const kind of kinds){
   const kindSection=element("div",undefined,"growth-kind"),label=kind==="regularUniform"?"🎽 團 T":"🏅 A 團比賽服";
   kindSection.append(element("h4",label));
   const tshirt=growthTshirts.find(x=>String(x.studentId)===id);
   const paperClass=kind==="competitionUniform"?confirmedReceived.get(String(name).trim()):"";
   const rosterUniform=kind==="competitionUniform"?competitionByName.get(String(name).trim()):null;
   const {entries,comparison}=buildUniformGrowth(student,kind,tshirt,growthRequests,paperClass,rosterUniform);
   if(!entries.length){kindSection.append(element("p",kind==="regularUniform"&&!growthTshirtsLoaded?"歷史領用資料載入中…":"目前沒有可顯示的歷史尺寸或新購紀錄。","muted"))}
   for(const entry of entries){
    const step=element("div",undefined,"growth-step");
    const date=entry.date?formatDate(entry.date).split(" ")[0]+"｜":"";
    step.append(element("strong",date+entry.title+(entry.size?"｜尺寸 "+entry.size:"")));
    step.append(element("p",entry.detail,"growth-note"));kindSection.append(step);
   }
   if(comparison)kindSection.append(element("p",comparison,"growth-change"));
   section.append(kindSection);
  }
  host.append(section);
 }
 if(growthTshirtsError)host.append(element("p","團 T 歷史紀錄暫時無法讀取："+growthTshirtsError,"hint"));
}
async function eligibleUniforms(){
 const status=document.getElementById("uniformEligibilityStatus"),regular=document.getElementById("regularUniformCard"),competition=document.getElementById("competitionUniformCard");
 regular.hidden=true;competition.hidden=true;
 try{
  const [studentsResponse,configsResponse]=await Promise.all([fetch("/api/students",{credentials:"same-origin",cache:"no-store",headers:parentAuthHeaders()}),fetch("/api/uniform-events/config",{credentials:"same-origin",cache:"no-store",headers:parentAuthHeaders()})]);
  if(!studentsResponse.ok||!configsResponse.ok)throw Error("學生資料 HTTP "+studentsResponse.status+"；模組設定 HTTP "+configsResponse.status);
  const studentData=await studentsResponse.json(),configData=await configsResponse.json();
  const students=Array.isArray(studentData)?studentData:(studentData.items||[]);
  growthStudents=students;renderUniformGrowth();
  const configs=configData.items||[];
  const active=module=>configs.some(x=>x.module===module&&x.id==="default"&&x.enabled===true);
  const isA=s=>["A","A團"].includes(String(s.groupName||s.group||"").trim().toUpperCase().replace(/\s/g,""));
  const aStudents=students.filter(isA);
  regular.hidden=!active("regularUniform");
  if(!regular.hidden)loadInlineSizes();
  competition.hidden=!(active("competitionUniform")&&aStudents.length);
  if(aStudents.length){
   const info=document.getElementById("competitionStudentInfo");info.replaceChildren();
   for(const st of aStudents){
    const name=String(st.name||st.studentName||"A 團學生").trim(),paperClass=confirmedReceived.get(name);
    const grade=paperClass?paperClass.slice(0,1):"";
    const registered=competitionByName.get(name);
    const size=registered?registered.style+"款 "+registered.size:(st.competitionSize||st.uniformSize||"名單尚無尺寸");
    const receipt=paperClass?"已領用 1 套（紙本確認）｜"+grade+" 年級領取（紙本 "+paperClass+"）":"領用待核對｜領取年級待確認";
    const p=document.createElement("p");p.textContent=name+"（"+st.studentId+"）｜A 團｜"+size+"｜"+receipt;info.append(p);
    if(["李旭恩","蘇聖翔","蔡昀潔"].includes(name)){
     const detail=document.createElement("p");detail.className="hint";detail.textContent="這位學生尚無本張紙本領用佐證；取得方式與領用狀態請由學校確認。";info.append(detail);
    }
   }
   if(!competition.hidden)renderCompetitionPurchase(aStudents);
  }
  status.textContent=students.length?"已找到 "+students.length+" 位孩子的資料。請先核對尺寸與領用紀錄，再提出申請。":"目前沒有已綁定的孩子，請先完成家長與學生綁定。";
  if(!students.length){regular.hidden=true;competition.hidden=true}
 }catch(e){console.warn("家長團服資格查詢失敗",e);status.textContent="資格查詢失敗（"+e.message+"）。請重新登入後再試；若持續失敗，請聯絡學校管理員。"}
}
eligibleUniforms();

let currentUniformPrices=null;
const uniformPricePromise=parentApi("uniform-events/prices").then(data=>{currentUniformPrices=data.items||{};return currentUniformPrices});
const TSHIRT_SIZES=["8","10","12","14","XS","S","M","L","XL","2L","3L","5L"];
async function loadInlineSizes(){
 const host=document.getElementById("inlineTshirtSizes"),status=document.getElementById("inlineTshirtStatus");
 host.replaceChildren();status.textContent="";
 const oldSummary=document.getElementById("tshirtRegisteredSummary");if(oldSummary)oldSummary.remove();
 try{
  const res=await fetch("/api/uniform-events/tshirt-historical-size",{credentials:"same-origin",cache:"no-store",headers:parentAuthHeaders()});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw Error(data.error||"HTTP "+res.status);
  growthTshirts=data.items||[];growthTshirtsLoaded=true;growthTshirtsError="";renderUniformGrowth();
  if(!data.items?.length){host.textContent="目前尚無已領取團 T 的歷史補登資料；未領取學生需由校方確認領用狀態。";return}
  const summary=document.createElement("div");summary.id="tshirtRegisteredSummary";host.parentElement.insertBefore(summary,host);
  for(const item of data.items){
   const grade=String(item.receivedGrade||"");
   const gradeLabel=grade?grade+"年級領取":"領取年級待確認";
   const line=document.createElement("p");line.textContent=(item.studentName||item.studentId)+"｜團 T："+(item.size||"待補登")+"｜"+(item.received===false?"未領取":"已領取 1 件")+"｜"+(item.received===false?(gradeLabel+"｜尚未領取"):gradeLabel)+"｜"+(item.size?"尺寸已登錄":"尺寸待補登");summary.append(line);
   const box=document.createElement("div");box.className="size-row";
   const title=document.createElement("strong");title.textContent=(item.studentName||item.studentId)+"｜"+(item.received===false?"未領取":"已領取 1 件");
   const label=document.createElement("label");label.textContent="團 T 尺寸";
   const sel=document.createElement("select");sel.setAttribute("aria-label",(item.studentName||item.studentId)+"的團 T 尺寸");
   sel.add(new Option("請選擇尺寸",""));for(const size of TSHIRT_SIZES)sel.add(new Option(size,size));
   sel.value=item.size||"";
   const save=document.createElement("button");save.type="button";save.textContent="儲存尺寸";
   const state=document.createElement("span");state.className="hint";state.style.marginLeft="8px";state.textContent=item.size?"已登錄 "+item.size:"待補登";
   save.addEventListener("click",async()=>{
    if(!sel.value){state.textContent="請先選擇尺寸";return}
    save.disabled=true;state.textContent="儲存中…";
    try{
     const resp=await fetch("/api/uniform-events/tshirt-historical-size",{method:"PATCH",credentials:"same-origin",headers:{"Content-Type":"application/json",...parentAuthHeaders()},body:JSON.stringify({studentId:item.studentId,size:sel.value,etag:item.etag})});
     const result=await resp.json().catch(()=>({}));
     if(!resp.ok)throw Error(result.error||"HTTP "+resp.status);
     state.textContent="尺寸已儲存";await loadInlineSizes();
    }catch(e){state.textContent="儲存失敗："+e.message}finally{save.disabled=false}
   });
   label.append(sel);
   const editor=document.createElement("div");editor.append(label,save,state);
   if(item.size){
    editor.hidden=true;
    const edit=document.createElement("button");edit.type="button";edit.textContent="修改尺寸";edit.addEventListener("click",()=>{editor.hidden=false;edit.hidden=true;sel.focus()});
    box.append(edit,editor);
   }else box.append(editor);
   host.append(box);
  }
  renderTshirtPurchase(data.items);
 }catch(e){growthTshirtsLoaded=true;growthTshirtsError=e.message;renderUniformGrowth();host.textContent="無法讀取尺寸補登資料";status.textContent=e.message}
}

function renderTshirtPurchase(items){
 const host=document.getElementById("inlineTshirtSizes");if(!host||!items.length)return;
 const panel=document.createElement("details");panel.className="action-details";
 const title=document.createElement("summary");title.textContent="🛍️ 我要加購團 T（第二件起）";
 const hint=document.createElement("p");hint.className="hint";hint.textContent="正在讀取團 T 單價；需經學校後台審核，核准前請勿匯款。團 T 與 A 團比賽服尺寸不共用。";
 const form=document.createElement("form");
 const studentLabel=document.createElement("label");studentLabel.textContent="申請學生";
 const student=document.createElement("select");student.required=true;for(const item of items)student.add(new Option((item.studentName||item.studentId)+"（"+item.studentId+"）",item.studentId));studentLabel.append(student);
 const sizeLabel=document.createElement("label");sizeLabel.textContent="加購團 T 尺寸";
 const size=document.createElement("select");size.required=true;size.add(new Option("請選擇尺寸",""));for(const x of TSHIRT_SIZES)size.add(new Option(x,x));sizeLabel.append(size);
 const countLabel=document.createElement("label");countLabel.textContent="加購件數";
 const count=document.createElement("select");for(let i=1;i<=5;i++)count.add(new Option(i+" 件",String(i)));countLabel.append(count);
 const total=document.createElement("p");const update=()=>{const price=currentUniformPrices?.regularUniform?.unitPrice;total.textContent=price?"目前預估金額：NT$ "+(Number(count.value)*price).toLocaleString("zh-TW")+"（核准時以當時價格為準）":"單價讀取中…"};count.addEventListener("change",update);update();
 const submit=document.createElement("button");submit.type="submit";submit.textContent="送出團 T 加購申請";
 const message=document.createElement("p");message.className="hint";message.setAttribute("role","status");
 form.append(studentLabel,sizeLabel,countLabel,total,submit,message);panel.append(title,hint,form);host.append(panel);submit.disabled=true;uniformPricePromise.then(prices=>{hint.textContent="目前每件 NT$"+Number(prices.regularUniform.unitPrice).toLocaleString("zh-TW")+"，已含 5% 稅額，不再額外加計。申請仍需學校審核；核准前請勿匯款。團 T 與 A 團比賽服尺寸不共用。";update();submit.disabled=false}).catch(()=>{hint.textContent="暫時無法讀取團 T 單價，請稍後重新整理。";total.textContent="價格未確認，暫停申請。"});
 form.addEventListener("submit",async e=>{
  e.preventDefault();if(!size.value)return;
  if(!confirm("確認送出團 T 加購需求？送出後仍需學校審核，並非已付款或已領取。"))return;
  submit.disabled=true;message.textContent="申請送出中…";
  try{
   const resp=await fetch("/api/uniform-events/requests",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json",...parentAuthHeaders()},body:JSON.stringify({kind:"regularUniform",studentId:student.value,size:size.value,quantity:Number(count.value),acquisition:"PURCHASE",note:"團 T 自費加購 "+count.value+" 件；價格以校方核准當時為準"})});
   const data=await resp.json().catch(()=>({}));if(!resp.ok)throw Error(data.error||"HTTP "+resp.status);
   message.textContent="團 T 加購申請已送出，等待學校審核。可在上方「我的團服申請進度」持續查詢。";submit.textContent="已送出";await loadUniformRequestProgress();
  }catch(error){message.textContent="送出失敗："+error.message;submit.disabled=false}
 });
}

function renderCompetitionPurchase(students){
 const host=document.getElementById("competitionPurchaseArea");host.replaceChildren();
 const purchase=document.createElement("details");purchase.className="action-details";
 const heading=document.createElement("summary");heading.textContent="確認 A 團比賽服取得方式／申請新尺寸";purchase.append(heading);host.append(purchase);
 const note=element("p","每位學生僅能申請一次公費配發；已領用或已有公費申請者，後續請選自費買斷。買斷送出後會顯示匯款帳戶。","hint");purchase.append(note);
 const form=document.createElement("form");
 const studentLabel=document.createElement("label");studentLabel.textContent="學生";
 const studentSelect=document.createElement("select");studentSelect.required=true;for(const st of students)studentSelect.add(new Option((st.studentName||st.name||"學生")+"（"+st.studentId+"）",st.studentId));studentLabel.append(studentSelect);
 const acquisitionLabel=document.createElement("label");acquisitionLabel.textContent="本次取得方式";
 const acquisition=document.createElement("select");acquisition.required=true;for(const option of [["請選擇取得方式",""],["公費配發｜送學校審核","PUBLIC"],["自費買斷｜顯示匯款帳戶","PURCHASE"]])acquisition.add(new Option(...option));acquisitionLabel.append(acquisition);
 const eligibility=element("p","正在確認公費申請資格…","hint");
 syncCompetitionPublicEligibility=()=>{
  const id=studentSelect.value,used=publicUsedStudentIds.has(String(id)),option=acquisition.querySelector('option[value="PUBLIC"]');
  option.disabled=!growthRequestsLoaded||used;
  eligibility.textContent=!growthRequestsLoaded?"正在確認公費申請資格；暫時只能選自費買斷。":used?"此學生已領用或已有公費申請紀錄，本次僅能選自費買斷。":"此學生尚無公費申請紀錄，可提出一次公費申請並等待學校審核。";
  if(option.disabled&&acquisition.value==="PUBLIC"){acquisition.value="";acquisition.dispatchEvent(new Event("change"))}
 };
 studentSelect.addEventListener("change",syncCompetitionPublicEligibility);syncCompetitionPublicEligibility();
 const styleLabel=document.createElement("label");styleLabel.textContent="款式";
 const styleSelect=document.createElement("select");for(const style of ["女","男"])styleSelect.add(new Option(style+"款",style));styleLabel.append(styleSelect);
 const sizeLabel=document.createElement("label");sizeLabel.textContent="這次需要的尺寸";
 const sizeSelect=document.createElement("select");sizeSelect.required=true;sizeLabel.append(sizeSelect);
 const sync=()=>{const sizes=styleSelect.value==="女"?["XS","S","M","L"]:["S","M","L","2L"];sizeSelect.replaceChildren(new Option("請選擇尺寸",""),...sizes.map(x=>new Option(x,x)))};styleSelect.addEventListener("change",sync);sync();
 const preview=element("p","請先選擇取得方式。","hint");
 const updatePreview=()=>{
  if(acquisition.value==="PUBLIC")preview.textContent="公費配發：送出後由學校審核，不需匯款；核准不代表已發放。";
  else if(acquisition.value==="PURCHASE")preview.textContent=currentUniformPrices?.competitionUniform?.unitPrice?"自費買斷：每套含稅 NT$ "+Number(currentUniformPrices.competitionUniform.unitPrice).toLocaleString("zh-TW")+"。送出後請在「我的團服申請進度」查看匯款帳號。":"自費買斷：正在讀取價格，暫不可送出。";
  else preview.textContent="請先選擇取得方式。";
 };
 acquisition.addEventListener("change",updatePreview);
 const button=document.createElement("button");button.type="submit";button.textContent="送出比賽服申請";
 const message=element("p","","hint");message.setAttribute("role","status");
 form.append(studentLabel,acquisitionLabel,eligibility,styleLabel,sizeLabel,preview,button,message);purchase.append(form);
 uniformPricePromise.then(updatePreview).catch(()=>{if(acquisition.value==="PURCHASE")preview.textContent="暫時無法讀取比賽服價格，請稍後重試。"});
 form.addEventListener("submit",async e=>{
  e.preventDefault();if(!sizeSelect.value||!acquisition.value)return;
  if(acquisition.value==="PUBLIC"&&(!growthRequestsLoaded||publicUsedStudentIds.has(String(studentSelect.value)))){message.textContent="此學生已有公費紀錄，後續請選自費買斷。";syncCompetitionPublicEligibility();return}
  if(acquisition.value==="PURCHASE"&&!Number.isSafeInteger(currentUniformPrices?.competitionUniform?.unitPrice)){message.textContent="價格尚未讀取完成，請稍後重試。";return}
  const isPurchase=acquisition.value==="PURCHASE";
  if(!confirm(isPurchase?"確認申請自費買斷？送出後可查看匯款帳戶，請依顯示金額匯款。":"確認送出公費配發申請？學校審核後才會安排後續領用。"))return;
  button.disabled=true;message.textContent="送出中…";
  try{
   const response=await fetch("/api/uniform-events/requests",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json",...parentAuthHeaders()},body:JSON.stringify({kind:"competitionUniform",studentId:studentSelect.value,style:styleSelect.value,size:sizeSelect.value,acquisition:acquisition.value,note:isPurchase?"家長選擇自費買斷；待匯款與學校核帳":"家長選擇公費配發；待校方審核資格與尺寸"})});
   const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||"HTTP "+response.status);
   message.textContent=isPurchase?"買斷申請已建立。請到上方「我的團服申請進度」查看應繳金額及匯款帳戶；匯款後請回報末五碼。":"公費申請已送交學校審核，可在「我的團服申請進度」查詢。";
   button.textContent="已送出";await loadUniformRequestProgress();
   if(isPurchase)document.getElementById("uniformRequestProgress")?.scrollIntoView({behavior:"smooth",block:"start"});
  }catch(error){message.textContent="申請未完成："+error.message;button.disabled=false}
 });
}


function formatDate(v){if(!v)return "";const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleString("zh-TW",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"})}
function element(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e}
async function parentApi(path,options={}){
 const response=await fetch("/api/"+path,{...options,credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json",...parentAuthHeaders(),...(options.headers||{})}});
 const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||"HTTP "+response.status);return data;
}
const uniformRequestStage={
 PENDING:{title:"待學校審核",next:"學校尚未核准，請等待審核結果。"},
 APPROVED:{title:"已核准，等待統一採購",next:"學校已核准申請。核准不代表已付款、已採購、到貨或可以領取；請留意後續通知。"},
 ORDERED:{title:"已統一採購，等待到貨",next:"學校已將此申請列入採購，尚未到貨。"},
 ARRIVED:{title:"已到貨，等待領取安排",next:"物品已到貨，學校尚未開放領取。"},
 READY_FOR_PICKUP:{title:"可以領取",next:"請依學校公布的時間與方式辦理領取。"},
 CANCELLED:{title:"申請已取消",next:"此申請已取消。如有疑問，請洽學校確認。"},
 FULFILLED:{title:"已完成領用",next:"此申請的領用流程已完成。"}
};
function requestStage(item){
 if(item.status==="READY_FOR_PICKUP"&&!item.stockReceivedAt)return {title:"待學校驗收入庫，暫不可領取",next:"學校尚未完成此筆團服的正式入庫確認，請等待後續通知。"};
 if(item.status==="READY_FOR_PICKUP"&&item.acquisition!=="PUBLIC"&&item.paymentStatus!=="VERIFIED")return {title:"待財務核帳，暫不可領取",next:"請等待學校確認入帳；核帳完成後再依學校通知領取。"};
 return uniformRequestStage[item.status]||{title:"狀態待確認",next:"請洽學校確認目前進度。"};
}
async function loadUniformRequestProgress(){
 const summary=document.getElementById("uniformRequestSummary"),history=document.getElementById("uniformRequestHistory");
 if(!summary||!history)return;
 summary.replaceChildren(element("p","正在更新申請進度…","muted"));
 try{
  const [result,me]=await Promise.all([parentApi("uniform-events/requests"),parentApi("me")]);
  if(me.role!=="parent")throw Error("請切換至家長身分後重新載入");
  if(!growthStudents.length){growthStudents=me.students||[];renderUniformGrowth()}
  const names=new Map((me.students||[]).map(x=>[String(x.studentId),x.name||x.studentName||x.studentId]));
  const requests=(result.items||[]).filter(x=>["regularUniform","competitionUniform"].includes(x.kind)).sort((a,b)=>String(b.updatedAt||b.createdAt||"").localeCompare(String(a.updatedAt||a.createdAt||"")));
  growthRequests=requests;publicUsedStudentIds=new Set((result.publicUsedStudentIds||[]).map(String));historicalPublicStudentIds=new Set((result.historicalPublicStudentIds||[]).map(String));growthRequestsLoaded=true;syncCompetitionPublicEligibility();renderUniformGrowth();
  summary.replaceChildren();history.replaceChildren();
  if(!requests.length){summary.append(element("p","目前沒有團服申請。送出後可在此查看學校審核與後續進度。","muted"));history.append(element("p","目前沒有團服申請紀錄。","muted"));return}
  const approved=requests.filter(x=>x.status==="APPROVED").length;
  summary.append(element("p",`共 ${requests.length} 筆團服申請${approved?`，其中 ${approved} 筆已核准`:""}。`));
  for(const item of requests){
   const stage=requestStage(item);
   const title=(item.kind==="regularUniform"?"團 T":"A 團比賽服")+"｜"+(names.get(String(item.studentId))||"學生 "+item.studentId);
   const card=element("div",undefined,"card");card.style.margin="10px 0";
   card.append(element("strong",title));
   const badge=element("span",stage.title,"status-pill");card.append(badge);
   card.append(element("p",item.kind==="competitionUniform"&&item.acquisition==="PUBLIC"?(item.status==="PENDING"?"公費配發｜等待學校審核資格與尺寸；無須匯款。":"公費配發｜不需匯款；請依學校通知辦理領用。"):item.kind==="competitionUniform"&&item.acquisition==="PURCHASE"?"自費買斷｜"+stage.next:stage.next,"hint"));
   if(item.kind==="competitionUniform"&&item.acquisition==="PUBLIC"&&item.status==="PENDING"&&historicalPublicStudentIds.has(String(item.studentId)))card.append(element("p","此學生已有公費領用紀錄；這筆重複申請無法核准。請在下方取消申請，若需新尺寸可改選自費買斷。","hint"));
   card.append(element("p",`尺寸：${item.size||"待確認"}${item.style?`｜${item.style}款`:""}｜件數：${item.quantity||1}｜申請時間：${formatDate(item.createdAt)||"—"}｜更新時間：${formatDate(item.updatedAt)||"—"}`,"muted"));
   if(item.status==="FULFILLED")card.append(element("p",`實際領取：${formatDate(item.issuedAt)||"日期待確認"}｜領取人：${item.receivedBy||"待核對"}｜件數：${item.issuedQuantity||item.quantity||1}`,"hint"));
   if(["APPROVED","ORDERED","ARRIVED","READY_FOR_PICKUP"].includes(item.status)&&item.acquisition!=="PUBLIC"){
    const payment=element("div",undefined,"payment-account");card.append(payment);
    if(Number.isSafeInteger(item.amount)&&item.amount>0){
     if(["REPORTED_UNVERIFIED","VERIFIED"].includes(item.paymentStatus)){
      payment.append(element("strong",item.paymentStatus==="VERIFIED"?"✅ 學校已確認入帳":"🕒 已回報匯款，等待學校核帳"));
      payment.append(element("p","本筆金額：NT$ "+item.amount.toLocaleString("zh-TW")));
      if(item.paymentStatus==="REPORTED_UNVERIFIED")payment.append(element("p","匯款回報已送出，請等待財務人員核對銀行入帳紀錄；無須重複匯款。","hint"));
     }else{
     payment.textContent="正在讀取匯款資訊…";
     parentApi("uniform-events/uniform-payment-account?kind="+encodeURIComponent(item.kind)+"&requestId="+encodeURIComponent(item.id)).then(data=>{
      if(!data.item){payment.textContent="學校尚未設定收款帳戶，請洽學校。";return}
      const b=data.item;payment.replaceChildren(element("strong","應繳金額：NT$ "+item.amount.toLocaleString("zh-TW")),element("p","銀行："+b.bankName+"（"+b.bankCode+"）｜戶名："+b.accountHolder),element("p","匯款帳號："+b.accountNumber));
      payment.append(element("p","付款狀態：待匯款"));
      const form=element("form",undefined,"uniform-transfer-form");
       form.append(element("p","完成匯款後，請在這裡回報匯款日期與帳號末五碼。"));
       const date=element("input"),lastFive=element("input");
       date.type="date";date.required=true;
       lastFive.type="text";lastFive.inputMode="numeric";lastFive.pattern="[0-9]{5}";lastFive.maxLength=5;lastFive.required=true;lastFive.placeholder="例如：12345";
       for(const [label,input] of [["匯款日期",date],["匯款帳號末五碼",lastFive]]){const row=element("label",label);row.append(input);form.append(row)}
       const submit=element("button","回報匯款，等待學校核帳");submit.type="submit";
       const message=element("p","","hint");message.setAttribute("role","status");
       form.append(submit,message);payment.append(form);
       form.addEventListener("submit",async event=>{
        event.preventDefault();
        if(!/^[0-9]{5}$/.test(lastFive.value.trim())||!date.value){message.textContent="請填寫匯款日期與正確的帳號末五碼。";return}
        if(!confirm("確認已完成匯款，並回報帳號末五碼？送出後仍需等待學校核帳。"))return;
        submit.disabled=true;message.textContent="正在回報…";
        try{
         await parentApi("uniform-events/uniform-transfer-report",{method:"POST",body:JSON.stringify({requestId:item.id,amount:item.amount,etag:item.etag,lastFive:lastFive.value.trim(),transferDate:date.value})});
         payment.replaceChildren(element("strong","應繳金額：NT$ "+item.amount.toLocaleString("zh-TW")),element("p","已回報匯款，等待學校核帳。","hint"));
         await loadUniformRequestProgress();
        }catch(error){message.textContent="回報失敗："+error.message+"。請重新整理後再試。";submit.disabled=false}
       });
     }).catch(()=>{payment.textContent="暫時無法讀取匯款資訊，請更新進度後重試。"});
     }
    }else payment.textContent="已核准，應繳金額尚待學校補正，請勿先匯款。";
   }
   if(item.cancelReason)card.append(element("p","取消原因："+item.cancelReason,"hint"));
   if(item.adjustmentReason)card.append(element("p","最近件數更正原因："+item.adjustmentReason,"hint"));
   if(item.status==="PENDING"){
    const controls=element("div");controls.style.cssText="display:flex;flex-wrap:wrap;gap:8px";
    const edit=element("button",item.kind==="regularUniform"?"修改尺寸／件數":"修改款式／尺寸");
    const cancel=element("button","取消這筆申請");
    for(const button of [edit,cancel]){button.type="button";button.style.cssText="padding:9px;border:1px solid var(--main);border-radius:8px;background:white;color:var(--main)";controls.append(button)}
    const message=element("p","","hint");message.setAttribute("role","status");
    edit.addEventListener("click",async()=>{
     let update={action:"EDIT",id:item.id,etag:item.etag};
     if(item.kind==="regularUniform"){
      const size=prompt("請輸入團 T 尺寸（8、10、12、14、XS、S、M、L、XL、2L、3L、5L）",item.size||"");if(size===null)return;
      const amount=prompt("請輸入正確件數（1–20 件；若全部不要，請按取消申請）",String(item.quantity||1));if(amount===null)return;
      update={...update,size:size.trim().toUpperCase(),quantity:Number(amount)};
     }else{
      const style=prompt("請輸入款式：男或女",item.style||"");if(style===null)return;
      const size=prompt("請輸入正確尺寸",item.size||"");if(size===null)return;
      update={...update,style:style.trim(),size:size.trim().toUpperCase()};
     }
     if(!confirm("確定更正這筆待審申請？"))return;
     edit.disabled=true;cancel.disabled=true;message.textContent="正在儲存…";
     try{await parentApi("uniform-events/requests",{method:"PATCH",body:JSON.stringify(update)});await loadUniformRequestProgress()}
     catch(e){message.textContent="更正失敗："+e.message;edit.disabled=false;cancel.disabled=false}
    });
    cancel.addEventListener("click",async()=>{
     if(!confirm("確定取消這筆待審申請？紀錄會保留，取消後不能恢復。"))return;
     edit.disabled=true;cancel.disabled=true;message.textContent="正在取消…";
     try{await parentApi("uniform-events/requests",{method:"PATCH",body:JSON.stringify({action:"CANCEL",id:item.id,etag:item.etag})});await loadUniformRequestProgress()}
     catch(e){message.textContent="取消失敗："+e.message;edit.disabled=false;cancel.disabled=false}
    });
    card.append(controls,message);
   }
   history.append(card);
  }
  const latest=requests[0],stage=requestStage(latest);
  const latestCard=element("div",undefined,"card");latestCard.style.margin="10px 0";
  latestCard.append(element("strong",(latest.kind==="regularUniform"?"團 T":"A 團比賽服")+"｜"+(names.get(String(latest.studentId))||"學生 "+latest.studentId)));
  latestCard.append(element("p","目前狀態："+stage.title));latestCard.append(element("p",stage.next,"hint"));
  latestCard.append(element("p","更新時間："+(formatDate(latest.updatedAt)||"—"),"muted"));summary.append(latestCard);
  {const button=element("button",`查看／管理 ${requests.length} 筆申請紀錄`);button.type="button";button.style.cssText="padding:9px;border:1px solid var(--main);border-radius:8px;background:white;color:var(--main)";button.addEventListener("click",()=>{select("history");history.scrollIntoView({behavior:"smooth",block:"start"})});summary.append(button)}
 }catch(e){summary.replaceChildren(element("p","申請進度讀取失敗："+e.message,"hint"));history.replaceChildren(element("p","團服申請紀錄讀取失敗："+e.message,"hint"))}
}
document.getElementById("refreshUniformRequests")?.addEventListener("click",loadUniformRequestProgress);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)loadUniformRequestProgress()});
loadUniformRequestProgress();
function appendActivityFeeBreakdown(card,config,registration){
 if(!config||!["fieldTrip","yearEndDinner"].includes(config.module))return;
 const currency=n=>"NT$ "+Number(n).toLocaleString("zh-TW");
 const rateKeys=["firstAdultFee","extraAdultFee","extraChildFee"];
 if(!rateKeys.every(k=>Number.isFinite(Number(config[k]))&&Number(config[k])>=0))return;
 const dinner=config.module==="yearEndDinner";
 const students=(registration.studentIds||[]).length,adults=Math.max(0,Number(registration.adults)||0),children=Math.max(0,Number(registration.extraChildren)||0);
 const studentRate=dinner?0:Number(config.studentFee||0),firstRate=Number(config.firstAdultFee),extraRate=Number(config.extraAdultFee),childRate=Number(config.extraChildFee);
 const lines=[["弦樂團學生",students,studentRate],["首位陪同者",Math.min(adults,1),firstRate],["第二位起陪同者",Math.max(adults-1,0),extraRate],["6 歲以下兒童（非團員）",children,childRate]];
 const wrap=element("div",undefined,"activity-fee-breakdown");wrap.style.margin="12px 0";wrap.style.padding="12px";wrap.style.border="1px solid #dbe1eb";wrap.style.borderRadius="8px";
 wrap.append(element("strong","本次報名費用明細（依學校活動設定）"));
 let total=0;
 for(const [label,count,rate] of lines){total+=count*rate;wrap.append(element("p",label+"："+count+" 位 × "+currency(rate)+"／位 = "+currency(count*rate)))}
 wrap.append(element("strong","應繳合計："+currency(total)));
 if(registration.estimatedAmount!=null&&Number(registration.estimatedAmount)!==total)wrap.append(element("p","注意：報名時登記金額為 "+currency(registration.estimatedAmount)+"，與目前費率試算不同，請先向學校確認。","hint"));
 card.append(wrap);
}
function activityPaymentLabel(item,config){
 if(item.paymentStatus==="NOT_OPEN")return config?.paymentOpen===true||config?.collectionOpen===true?"已開放匯款，待您回報":"尚未開放匯款";
 return {REPORTED_UNVERIFIED:"已回報匯款，待幹部核帳",VERIFIED:"已確認入帳"}[item.paymentStatus]||"待確認";
}
async function appendActivityPayment(card,item,match){
 if(!["fieldTrip","yearEndDinner"].includes(item.kind))return;
 if(["REPORTED_UNVERIFIED","VERIFIED"].includes(item.paymentStatus)){
  const box=element("div",undefined,"payment-account");
  box.append(element("strong",item.paymentStatus==="VERIFIED"?"✅ 學校已確認入帳":"🕒 已回報匯款，等待學校核帳"));
  if(item.transferReport?.amount)box.append(element("p","回報金額：NT$ "+Number(item.transferReport.amount).toLocaleString("zh-TW")));
  if(item.paymentStatus==="REPORTED_UNVERIFIED")box.append(element("p","學校正在核對銀行入帳紀錄；無須重複匯款或回報。","hint"));
  card.append(box);return;
 }
 if((item.kind==="fieldTrip"?match?.collectionOpen:match?.paymentOpen)!==true)return;
    const box=element("div",undefined,"payment-account");box.append(element("p","收款已開放。請先核對收款帳戶與應繳金額，完成匯款後填寫匯款日期、實際匯款金額及匯款帳號末五碼。"));
    const form=element("form"),amount=element("input"),last=element("input"),date=element("input"),message=element("p","","hint");
    amount.type="number";amount.min="1";amount.required=true;amount.value=String(item.transferReport?.amount||item.estimatedAmount||"");
    last.inputMode="numeric";last.pattern="[0-9]{5}";last.maxLength=5;last.required=true;last.placeholder="匯款帳號末五碼";
    date.type="date";date.required=true;
    for(const [label,input] of [["實際匯款金額",amount],["匯款帳號末五碼",last],["匯款日期",date]]){const l=element("label",label);l.style.display="block";l.style.marginBottom="12px";input.style.display="block";input.style.boxSizing="border-box";input.style.width="100%";input.style.marginTop="6px";l.append(input);form.append(l)}
    const submit=element("button","匯款完成回覆");submit.type="submit";form.append(submit,message);box.append(form);
    try{const accountPath=item.kind==="yearEndDinner"?"dinner-payment-account":"field-trip-payment-account";const result=await parentApi("uniform-events/"+accountPath+"?activityId="+encodeURIComponent(item.activityId));const b=result.item;if(!b)throw Error("活動尚未綁定帳戶");box.prepend(element("p","收款帳戶："+b.bankName+"（"+b.bankCode+"）｜"+b.accountHolder+"｜帳號："+b.accountNumber))}
    catch(e){submit.disabled=true;message.textContent="收款帳戶讀取失敗："+e.message}
    form.addEventListener("submit",async e=>{e.preventDefault();if(!confirm("確認已完成匯款，並送出匯款日期、金額及帳號末五碼供幹部核帳？"))return;submit.disabled=true;try{await parentApi("uniform-events/family-registration",{method:"PATCH",body:JSON.stringify({kind:item.kind,activityId:item.activityId,action:"REPORT_TRANSFER",amount:Number(amount.value),lastFive:last.value,transferDate:date.value})});message.textContent="已收到您的匯款回覆，待幹部核對款項。核帳完成後將更新繳費狀態。";await renderInlineActivities()}catch(err){message.textContent="回報失敗："+err.message;submit.disabled=false}});
 card.append(box);
}
async function renderInlineActivities(){
 const hosts={events:document.getElementById("inlineEventRegistration"),performance:document.getElementById("inlinePerformanceRegistration"),history:document.getElementById("inlineHistory")};
 try{
  const [me,config,registration]=await Promise.all([parentApi("me"),parentApi("uniform-events/config"),parentApi("uniform-events/family-registration")]);
  if(me.role!=="parent")throw Error("請切換至家長身分後重新載入");
  const students=(me.students||[]).filter(x=>x.studentId);
  const cfg=(config.items||[]).filter(x=>x.enabled===true && (x.module!=="yearEndDinner" || x.feeStatus==="PUBLISHED"));
  const notice=document.getElementById("newActivityNotice");
  const activityNotice=window.parentActivityNotice;
  function drawNotice(){
   const unseen=activityNotice?.unseen(cfg,me,students)||[];
   notice.replaceChildren();notice.hidden=!unseen.length;
   if(!unseen.length)return;
   notice.append(element("h2","🔔 新活動或活動更新（"+unseen.length+"）"),element("p","請留意活動日期與注意事項。點選後可直接查看活動。","muted"));
   for(const item of unseen.slice(0,3)){
    const button=element("button",(item.title||"活動")+"｜"+activityNotice.activityDate(item)+"　查看 ›","new-activity-link");button.type="button";
    button.addEventListener("click",()=>openActivity(item));notice.append(button);
   }
   if(unseen.length>3)notice.append(element("p","還有 "+(unseen.length-3)+" 筆，查看後會依序顯示。","hint"));
  }
  function openActivity(item){
   const category=item.module==="yearEndDinner"?"events":"performance";
   select(category);activityNotice.mark(item,me,students);drawNotice();
   const card=document.getElementById("activity_"+activityNotice.key(item));
   card?.scrollIntoView({behavior:"smooth",block:"start"});
   card?.querySelector("details.activity-details")?.setAttribute("open","");
  }
  const history=hosts.history;history.replaceChildren();
  if(!(registration.items||[]).length)history.append(element("p","目前沒有活動報名或付款紀錄。","muted"));
  for(const item of registration.items||[]){
   const match=cfg.find(x=>x.module===item.kind&&x.id===item.activityId);
   const card=element("div",undefined,"card");card.append(element("strong",match?.title||item.activityId));
   card.append(element("p","學生 "+(item.studentIds||[]).length+" 位｜陪同者 "+item.adults+" 位｜6 歲以下兒童（非團員） "+item.extraChildren+" 位"));
   card.append(element("p","報名："+(item.registrationStatus==="REGISTERED"?"已送出":item.registrationStatus)+"｜付款："+activityPaymentLabel(item,match)));
   if(item.estimatedAmount!=null)card.append(element("p","登記金額 NT$ "+Number(item.estimatedAmount).toLocaleString("zh-TW")));
   appendActivityFeeBreakdown(card,match,item);
   await appendActivityPayment(card,item,match);
   history.append(card);
  }
  const categories={events:["yearEndDinner"],performance:["fieldTrip","calendarActivity","performance","flashMob","schoolExchange","jointConcert"]};
  const normalizeGroup=value=>{const group=String(value||"").trim().replace(/團$/,"").toUpperCase();return group==="儲備"||group==="預備"?"C":group};
  const studentGroups=new Set(students.map(st=>normalizeGroup(st.groupName||st.group)).filter(Boolean));
  const forFamily=item=>{const groups=String(item.targetGroups||"ALL").split(",").map(normalizeGroup);return groups.includes("ALL")||groups.some(group=>studentGroups.has(group))};
  for(const [category,host] of Object.entries(hosts)){
   if(category==="history")continue;host.replaceChildren();
   const taipeiDay=value=>{if(!value)return "";const d=new Date(value);return Number.isNaN(d.getTime())?"":d.toLocaleDateString("sv-SE",{timeZone:"Asia/Taipei"})};
   const dateOf=item=>item.module==="calendarActivity"?item.eventDate:taipeiDay(item.startAt);
   const endOf=item=>item.module==="calendarActivity"?(item.endDate||item.eventDate):taipeiDay(item.endAt||item.startAt);
   const today=new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Taipei"});
   const items=cfg.filter(x=>categories[category].includes(x.module)&&forFamily(x)).sort((a,b)=>{
    const aUpcoming=endOf(a)>=today,bUpcoming=endOf(b)>=today;
    if(aUpcoming!==bUpcoming)return aUpcoming?-1:1;
    const aDate=dateOf(a),bDate=dateOf(b);
    return (aUpcoming?(aDate<today?today:aDate).localeCompare(bDate<today?today:bDate):bDate.localeCompare(aDate))||String(a.title||"").localeCompare(String(b.title||""),"zh-Hant");
   });
   if(!items.length){host.append(element("p",category==="performance"?"目前沒有此學生團別已啟用的演出或交流活動。":"目前沒有已開放的活動。","muted"));continue}
   for(const item of items){
    const card=element("article",undefined,"activity-event");card.id="activity_"+activityNotice.key(item);card.append(element("h3",item.title||"活動"));
    const start=item.module==="calendarActivity"?item.eventDate:item.module==="fieldTrip"?taipeiDay(item.startAt):formatDate(item.startAt);
    const end=item.module==="fieldTrip"?taipeiDay(item.endAt||item.startAt):item.endDate;
    const range=(item.module==="calendarActivity"||item.module==="fieldTrip")&&end&&end!==start?start+"～"+end:start;
    card.append(element("p",[range,item.timeLabel,item.location].filter(Boolean).join("｜"),"muted"));
    if(item.module==="calendarActivity"){
     card.append(element("p","免報名・免繳費","status-pill"));
     if(item.note){const noteDetails=element("details",undefined,"activity-details");noteDetails.append(element("summary","查看活動注意事項"));const note=element("p",item.note);note.style.whiteSpace="pre-wrap";noteDetails.append(note);card.append(noteDetails)}
     host.append(card);continue;
    }
    const already=(registration.items||[]).find(x=>x.kind===item.module&&x.activityId===item.id);
    if(already){card.append(element("p","已報名・"+activityPaymentLabel(already,item),"status-pill"));appendActivityFeeBreakdown(card,item,already);await appendActivityPayment(card,already,item);host.append(card);continue}
    if(!["yearEndDinner","fieldTrip"].includes(item.module)){card.append(element("p","活動資訊依校方公告。","hint"));host.append(card);continue}
    const now=Date.now();
    if(item.openAt&&Date.parse(item.openAt)>now){card.append(element("p","報名尚未開始，請於開放時間再回來查看。","status-pill"));host.append(card);continue}
    if(item.closeAt&&Date.parse(item.closeAt)<now){card.append(element("p","報名已於 "+formatDate(item.closeAt)+" 截止。收款開放僅供已報名家庭回報匯款；若需補報名，請聯絡學校延長報名期限。","status-pill"));host.append(card);continue}
    const action=element("details",undefined,"activity-details"),summary=element("summary",item.module==="yearEndDinner"?"我要報名餐會":"我要報名此活動");action.append(summary);const form=element("form");form.className="inline-activity-form";
    const studentWrap=element("fieldset");studentWrap.append(element("legend","參加學生"));
    for(const st of students){const label=element("label");const input=element("input");input.type="checkbox";input.value=st.studentId;label.append(input,document.createTextNode(" "+(st.name||st.studentName||st.studentId)));studentWrap.append(label)}
    const adults=element("select"),children=element("select");
    for(let i=1;i<=5;i++)adults.add(new Option(i+" 位陪同者",i));
    for(let i=0;i<=5;i++)children.add(new Option(i+" 位 6 歲以下兒童（非團員）",i));
    const adultLabel=element("label","陪同者人數（大人及 7 歲以上非團員）"),childLabel=element("label","6 歲以下兒童（非團員）數量");adultLabel.append(adults);childLabel.append(children);
    const total=element("p","","amount-summary");
    const dinner=item.module==="yearEndDinner";
    const rates=["firstAdultFee","extraAdultFee","extraChildFee"].every(k=>Number.isSafeInteger(item[k])&&item[k]>=0);
    const calc=()=>{const n=studentWrap.querySelectorAll("input:checked").length,a=Number(adults.value),c=Number(children.value);const amount=rates?(dinner?0:Number(item.studentFee||0)*n)+item.firstAdultFee+(a-1)*item.extraAdultFee+c*item.extraChildFee:null;total.textContent="團員 "+n+" 位＋陪同者 "+a+" 位＋6 歲以下兒童（非團員） "+c+" 位｜"+(amount===null?"費率尚未公布":"合計 NT$ "+amount.toLocaleString("zh-TW"));return amount};
    for(const input of [adults,children,studentWrap])input.addEventListener("change",calc);
    form.append(studentWrap,adultLabel,childLabel,total);
    let lastFive=null,transferDate=null,accountReady=!dinner;
    if(dinner){
     const bank=element("div","正在讀取幹部收款帳戶…","payment-account");form.append(bank);
     lastFive=element("input");lastFive.inputMode="numeric";lastFive.maxLength=5;lastFive.pattern="[0-9]{5}";lastFive.required=true;lastFive.placeholder="匯款帳號後五碼";
     const label=element("label","匯款帳號後五碼");label.append(lastFive);form.append(label);
     transferDate=element("input");transferDate.type="date";transferDate.required=true;
     const dateLabel=element("label","匯款日期");dateLabel.append(transferDate);form.append(dateLabel);
     try{const info=await parentApi("uniform-events/dinner-payment-account?activityId="+encodeURIComponent(item.id));const b=info.item;if(!b)throw Error("尚未設定收款帳戶");bank.replaceChildren();bank.append(element("strong","幹部收款帳戶"));bank.append(element("p",b.bankName+"（"+b.bankCode+"）｜戶名："+b.accountHolder));bank.append(element("p","帳號："+b.accountNumber));accountReady=true}
     catch(e){bank.textContent="目前尚未開放匯款："+e.message}
    }
    const submit=element("button",dinner?"確認報名並回報匯款":"確認報名");submit.type="submit";submit.disabled=!accountReady;
    const message=element("p","","hint");message.setAttribute("role","status");form.append(submit,message);
    form.addEventListener("submit",async e=>{
     e.preventDefault();const ids=[...studentWrap.querySelectorAll("input:checked")].map(x=>x.value);if(!ids.length){message.textContent="請先選擇參加學生";return}
     const amount=calc();if(dinner&&(amount===null||!/^[0-9]{5}$/.test(lastFive.value)||!transferDate.value)){message.textContent="請確認費用、匯款日期與帳號後五碼";return}
     if(!confirm("確認送出報名"+(dinner?"及匯款回報（待幹部核帳）":"")+"？"))return;
     submit.disabled=true;message.textContent="送出中…";
     try{await parentApi("uniform-events/family-registration",{method:"POST",body:JSON.stringify({kind:item.module,activityId:item.id,studentIds:ids,adults:Number(adults.value),extraChildren:Number(children.value),...(dinner?{lastFive:lastFive.value,transferDate:transferDate.value}:{})})});message.textContent="已送出，"+(dinner?"匯款待幹部核帳。":"報名成功。");await renderInlineActivities()}
     catch(err){message.textContent="送出失敗："+err.message;submit.disabled=false}
    });action.append(form);card.append(action);host.append(card);calc();
   }
  }
  drawNotice();
  if(!window.__parentActivityDeepLinkHandled){
   window.__parentActivityDeepLinkHandled=true;
   const query=new URLSearchParams(location.search),target=query.get("activity"),view=query.get("view");
   const item=cfg.find(x=>activityNotice.key(x)===target);
   if(item&&activityNotice.unseen([item],me,students).length)openActivity(item);
   else if(item){select(item.module==="yearEndDinner"?"events":"performance");document.getElementById("activity_"+target)?.scrollIntoView({behavior:"smooth",block:"start"})}
   else if(["events","performance","history","uniform"].includes(view))select(view);
  }
 }catch(e){for(const host of Object.values(hosts)){host.replaceChildren();host.append(element("p","資料讀取失敗："+e.message,"hint"))}}
}
renderInlineActivities();
