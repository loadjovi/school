const buttons=[...document.querySelectorAll("[data-view]")];const panels=[...document.querySelectorAll("[data-panel]")];function select(name){for(const b of buttons)b.setAttribute("aria-selected",String(b.dataset.view===name));for(const p of panels)p.hidden=p.dataset.panel!==name}buttons.forEach(b=>b.addEventListener("click",()=>select(b.dataset.view)));function mix(a,b,t){const x=parseInt(a.slice(1),16),y=parseInt(b.slice(1),16);return "#"+[16,8,0].map(n=>Math.round(((x>>n)&255)*(1-t)+((y>>n)&255)*t).toString(16).padStart(2,"0")).join("")}function luminance(c){const n=parseInt(c.slice(1),16),v=[16,8,0].map(k=>((n>>k)&255)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return .2126*v[0]+.7152*v[1]+.0722*v[2]}async function theme(){try{const schoolId=sessionStorage.getItem("school_context_id")||"";const q=new URLSearchParams();if(schoolId)q.set("schoolId",schoolId);const r=await fetch("/api/branding?"+q,{credentials:"same-origin"});if(!r.ok)return;const data=await r.json();let c=String(data.primaryColor||"");if(!/^#[0-9a-f]{6}$/i.test(c))return;for(let i=0;i<16&&1.05/(luminance(c)+.05)<4.5;i++)c=mix(c,"#000000",.13);document.documentElement.style.setProperty("--main",c);document.documentElement.style.setProperty("--soft",mix(c,"#ffffff",.91));document.documentElement.style.setProperty("--ink",mix(c,"#000000",.55))}catch(e){console.warn("Branding fallback",e)}}theme();

function parentAuthHeaders(){
 const token=sessionStorage.getItem("google_id_token")||"";
 const schoolId=sessionStorage.getItem("school_context_id")||"";
 const roleContext=sessionStorage.getItem("role_context")||"";
 return {...(token&&token!=="cookie-session"?{"X-Google-ID-Token":token}:{}),...(schoolId?{"X-School-Id":schoolId}:{}),...(roleContext?{"X-Role-Context":roleContext}:{})};
}
async function eligibleUniforms(){
 const status=document.getElementById("uniformEligibilityStatus"),regular=document.getElementById("regularUniformCard"),competition=document.getElementById("competitionUniformCard");
 regular.hidden=true;competition.hidden=true;
 try{
  const [studentsResponse,configsResponse]=await Promise.all([fetch("/api/students",{credentials:"same-origin",cache:"no-store",headers:parentAuthHeaders()}),fetch("/api/uniform-events/config",{credentials:"same-origin",cache:"no-store",headers:parentAuthHeaders()})]);
  if(!studentsResponse.ok||!configsResponse.ok)throw Error("學生資料 HTTP "+studentsResponse.status+"；模組設定 HTTP "+configsResponse.status);
  const studentData=await studentsResponse.json(),configData=await configsResponse.json();
  const students=Array.isArray(studentData)?studentData:(studentData.items||[]);
  const configs=configData.items||[];
  const active=module=>configs.some(x=>x.module===module&&x.id==="default"&&x.enabled===true);
  const isA=s=>["A","A團"].includes(String(s.groupName||s.group||"").trim().toUpperCase().replace(/\s/g,""));
  const aStudents=students.filter(isA);
  regular.hidden=!active("regularUniform");
  if(!regular.hidden)loadInlineSizes();
  competition.hidden=!(active("competitionUniform")&&aStudents.length);
  if(aStudents.length){const info=document.getElementById("competitionStudentInfo");info.replaceChildren();for(const st of aStudents){const p=document.createElement("p");p.textContent=(st.name||st.studentName||"A 團學生")+"（"+st.studentId+"）｜A 團｜"+(String(st.studentId)==="112068"?"S｜公費｜已領取":(["李旭恩","蘇聖翔","蔡昀潔"].includes(String(st.name||st.studentName||"").trim())?({"李旭恩":"男 S","蘇聖翔":"男 M","蔡昀潔":"女 M"}[String(st.name||st.studentName||"").trim()]+"｜公費／自費待確認｜領用狀態待核對"):((st.competitionSize||st.uniformSize||"已確認尺寸待同步")+"｜公費｜已領取")));const receivedGrade=st.competitionReceivedGrade||st.competitionGradeAtReceipt||st.competitionReceiptGrade||"";const receiptLabel=receivedGrade?(String(receivedGrade).includes("年級")?String(receivedGrade):String(receivedGrade)+"年級")+(currentGradeException?"（目前）":"領取"):"領取年級待確認";p.textContent=p.textContent.replace("｜已領取","｜已領取 1 套｜"+receiptLabel+"｜資料已確認").replace("｜領用狀態待核對","｜領用狀態待核對｜"+receiptLabel);info.append(p);if(["李旭恩","蘇聖翔","蔡昀潔"].includes(String(st.name||st.studentName||"").trim())){const label=document.createElement("label");label.textContent="請確認比賽服費用來源：";const select=document.createElement("select");select.append(new Option("請選擇公費或自費",""),new Option("公費","PUBLIC"),new Option("自費買斷","SELF"));label.append(select);const detail=document.createElement("p");detail.className="hint";detail.setAttribute("role","status");select.addEventListener("change",()=>{p.textContent=(st.name||st.studentName)+"（"+st.studentId+"）｜A 團｜"+({"李旭恩":"男 S","蘇聖翔":"男 M","蔡昀潔":"女 M"}[String(st.name||st.studentName).trim()])+"｜"+(select.value==="PUBLIC"?"公費（待校方核對）":select.value==="SELF"?"自費買斷（待校方核對）":"公費／自費待確認")+"｜領用狀態待核對｜"+receiptLabel;detail.textContent=select.value==="SELF"?"自費買斷 NT$2,625（含稅）。目前尚未完成收款帳戶與匯款後五碼串接，請勿先匯款。":select.value==="PUBLIC"?"已選擇公費；正式領用紀錄仍須由學校確認。":""});info.append(label,detail)}}if(!competition.hidden)renderCompetitionPurchase(aStudents)}
  status.textContent=students.length?"已確認 "+students.length+" 位已綁定學生；團服依校方啟用狀態及學生團別顯示。":"目前無已綁定學生，團服申請功能不顯示。";
  if(!students.length){regular.hidden=true;competition.hidden=true}
 }catch(e){console.warn("家長團服資格查詢失敗",e);status.textContent="資格查詢失敗（"+e.message+"）。請確認預覽環境登入及 API 設定；暫不開放申請。"}
}
eligibleUniforms();

const TSHIRT_SIZES=["8","10","12","14","XS","S","M","L","XL","2L","3L","5L"];
async function loadInlineSizes(){
 const host=document.getElementById("inlineTshirtSizes"),status=document.getElementById("inlineTshirtStatus");
 host.replaceChildren();status.textContent="";
 const oldSummary=document.getElementById("tshirtRegisteredSummary");if(oldSummary)oldSummary.remove();
 try{
  const res=await fetch("/api/uniform-events/tshirt-historical-size",{credentials:"same-origin",cache:"no-store",headers:parentAuthHeaders()});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw Error(data.error||"HTTP "+res.status);
  if(!data.items?.length){host.textContent="目前尚無已領取團 T 的歷史補登資料；未領取學生需由校方確認領用狀態。";return}
  const summary=document.createElement("div");summary.id="tshirtRegisteredSummary";host.parentElement.insertBefore(summary,host);
  for(const item of data.items){
   const explicitGrade=item.receivedGrade||item.gradeAtReceipt||item.receiptGrade||item.receivedAtGrade||"";
   const currentGrade=String(item.currentGrade||item.grade||item.gradeLevel||item.className||item.class||"");
   const group=String(item.groupName||item.group||item.team||"").trim().toUpperCase().replace(/\s/g,"");
   const currentGradeNumber=Number((currentGrade.match(/[1-6]/)||[])[0]);
   const currentGradeException=/李沛臻/.test(String(item.studentName||""))||/儲備|預備|RESERVE/i.test(group);
   const inferredGrade=item.received!==false&&!currentGradeException&&["A","A團","B","B團"].includes(group)&&currentGradeNumber>1?String(currentGradeNumber-1):"";
   const grade=currentGradeException?(currentGradeNumber?String(currentGradeNumber):""):explicitGrade||inferredGrade;
   const gradeLabel=grade?(String(grade).includes("年級")?String(grade):String(grade)+"年級")+"領取":"領取年級待確認";
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
 }catch(e){host.textContent="無法讀取尺寸補登資料";status.textContent=e.message}
}

function renderTshirtPurchase(items){
 const host=document.getElementById("inlineTshirtSizes");if(!host||!items.length)return;
 const panel=document.createElement("section");panel.className="card";
 const title=document.createElement("h3");title.textContent="🛍️ 自費加購團 T（第二件起）";
 const hint=document.createElement("p");hint.className="hint";hint.textContent="每件 NT$400。此處僅送出加購需求，需經學校後台審核；尚未完成匯款與核帳前，請勿先匯款。團 T 與 A 團比賽服尺寸不共用。";
 const form=document.createElement("form");
 const studentLabel=document.createElement("label");studentLabel.textContent="申請學生";
 const student=document.createElement("select");student.required=true;for(const item of items)student.add(new Option((item.studentName||item.studentId)+"（"+item.studentId+"）",item.studentId));studentLabel.append(student);
 const sizeLabel=document.createElement("label");sizeLabel.textContent="加購團 T 尺寸";
 const size=document.createElement("select");size.required=true;size.add(new Option("請選擇尺寸",""));for(const x of TSHIRT_SIZES)size.add(new Option(x,x));sizeLabel.append(size);
 const countLabel=document.createElement("label");countLabel.textContent="加購件數";
 const count=document.createElement("select");for(let i=1;i<=5;i++)count.add(new Option(i+" 件",String(i)));countLabel.append(count);
 const total=document.createElement("p");const update=()=>total.textContent="預估金額：NT$ "+(Number(count.value)*400).toLocaleString("zh-TW");count.addEventListener("change",update);update();
 const submit=document.createElement("button");submit.type="submit";submit.textContent="送出團 T 加購申請";
 const message=document.createElement("p");message.className="hint";message.setAttribute("role","status");
 form.append(studentLabel,sizeLabel,countLabel,total,submit,message);panel.append(title,hint,form);host.append(panel);
 form.addEventListener("submit",async e=>{
  e.preventDefault();if(!size.value)return;
  if(!confirm("確認送出團 T 加購需求？送出後仍需學校審核，並非已付款或已領取。"))return;
  submit.disabled=true;message.textContent="申請送出中…";
  try{
   const resp=await fetch("/api/uniform-events/requests",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json",...parentAuthHeaders()},body:JSON.stringify({kind:"regularUniform",studentId:student.value,size:size.value,quantity:Number(count.value),acquisition:"PURCHASE",note:"團 T 自費加購 "+count.value+" 件，每件 NT$400；待校方審核"})});
   const data=await resp.json().catch(()=>({}));if(!resp.ok)throw Error(data.error||"HTTP "+resp.status);
   message.textContent="團 T 加購申請已送出，等待學校後台審核。";submit.textContent="已送出";
  }catch(error){message.textContent="送出失敗："+error.message;submit.disabled=false}
 });
}

function renderCompetitionPurchase(students){
 const host=document.getElementById("competitionPurchaseArea");host.replaceChildren();
 const heading=document.createElement("h3");heading.textContent="自費買斷／加購比賽服";host.append(heading);
 const note=document.createElement("p");note.className="hint";note.textContent="公費領用資料由校方核對；若改為自費買斷或因成長需要加購，價格 NT$2,625（含稅）。目前此表單僅建立待審申請，尚未串接收款帳戶與匯款後五碼核帳，請勿先行匯款。";host.append(note);
 const form=document.createElement("form");
 const studentLabel=document.createElement("label");studentLabel.textContent="學生";
 const studentSelect=document.createElement("select");studentSelect.required=true;for(const st of students)studentSelect.add(new Option((st.studentName||st.name||"學生")+"（"+st.studentId+"）",st.studentId));studentLabel.append(studentSelect);
 const styleLabel=document.createElement("label");styleLabel.textContent="款式";
 const styleSelect=document.createElement("select");for(const style of ["女","男"])styleSelect.add(new Option(style+"款",style));styleLabel.append(styleSelect);
 const sizeLabel=document.createElement("label");sizeLabel.textContent="新尺寸";
 const sizeSelect=document.createElement("select");sizeSelect.required=true;sizeLabel.append(sizeSelect);
 const sync=()=>{const sizes=styleSelect.value==="女"?["XS","S","M","L"]:["S","M","L","2L"];sizeSelect.replaceChildren(new Option("請選擇尺寸",""),...sizes.map(x=>new Option(x,x)))};styleSelect.addEventListener("change",sync);sync();
 const button=document.createElement("button");button.type="submit";button.textContent="送出自費加購申請";
 const message=document.createElement("p");message.className="hint";message.setAttribute("role","status");
 form.append(studentLabel,styleLabel,sizeLabel,button,message);host.append(form);
 form.addEventListener("submit",async e=>{
  e.preventDefault();if(!sizeSelect.value)return;
  if(!confirm("確認提出自費加購需求？此為待審申請，尚未付款或領用。"))return;
  button.disabled=true;message.textContent="送出中…";
  try{
   const response=await fetch("/api/uniform-events/requests",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json",...parentAuthHeaders()},body:JSON.stringify({kind:"competitionUniform",studentId:studentSelect.value,style:styleSelect.value,size:sizeSelect.value,acquisition:"PURCHASE",note:"家長因成長需求提出自費加購，待校方確認金額與採購"})});
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(data.error||"HTTP "+response.status);
   message.textContent="申請已送出，狀態：待學校審核。尚未付款或發放。";button.textContent="已送出";
  }catch(error){message.textContent="申請未完成："+error.message;button.disabled=false}
 });
}


function formatDate(v){if(!v)return "";const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleString("zh-TW",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"})}
function element(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e}
async function parentApi(path,options={}){
 const response=await fetch("/api/"+path,{...options,credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json",...parentAuthHeaders(),...(options.headers||{})}});
 const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||"HTTP "+response.status);return data;
}
function appendActivityFeeBreakdown(card,config,registration){
 if(!config||!["fieldTrip","yearEndDinner"].includes(config.module))return;
 const currency=n=>"NT$ "+Number(n).toLocaleString("zh-TW");
 const rateKeys=["firstAdultFee","extraAdultFee","extraChildFee"];
 if(!rateKeys.every(k=>Number.isFinite(Number(config[k]))&&Number(config[k])>=0))return;
 const dinner=config.module==="yearEndDinner";
 const students=(registration.studentIds||[]).length,adults=Math.max(0,Number(registration.adults)||0),children=Math.max(0,Number(registration.extraChildren)||0);
 const studentRate=dinner?0:Number(config.studentFee||0),firstRate=Number(config.firstAdultFee),extraRate=Number(config.extraAdultFee),childRate=Number(config.extraChildFee);
 const lines=[["弦樂團學生",students,studentRate],["首位陪同大人",Math.min(adults,1),firstRate],["第二位起陪同大人",Math.max(adults-1,0),extraRate],["其他兒童",children,childRate]];
 const wrap=element("div",undefined,"activity-fee-breakdown");wrap.style.margin="12px 0";wrap.style.padding="12px";wrap.style.border="1px solid #dbe1eb";wrap.style.borderRadius="8px";
 wrap.append(element("strong","本次報名費用明細（依學校活動設定）"));
 let total=0;
 for(const [label,count,rate] of lines){total+=count*rate;wrap.append(element("p",label+"："+count+" 位 × "+currency(rate)+"／位 = "+currency(count*rate)))}
 wrap.append(element("strong","應繳合計："+currency(total)));
 if(registration.estimatedAmount!=null&&Number(registration.estimatedAmount)!==total)wrap.append(element("p","注意：報名時登記金額為 "+currency(registration.estimatedAmount)+"，與目前費率試算不同，請先向學校確認。","hint"));
 card.append(wrap);
}
async function appendFieldTripPayment(card,item,match){
 if(item.kind!=="fieldTrip"||match?.collectionOpen!==true||item.paymentStatus==="VERIFIED")return;
    const box=element("div",undefined,"payment-account");box.append(element("p","第二階段收款已開放。請先核對收款帳戶與應繳金額，完成匯款後填寫匯款日期、實際匯款金額及匯款帳號末五碼。"));
    const form=element("form"),amount=element("input"),last=element("input"),date=element("input"),message=element("p","","hint");
    amount.type="number";amount.min="1";amount.required=true;amount.value=String(item.transferReport?.amount||item.estimatedAmount||"");
    last.inputMode="numeric";last.pattern="[0-9]{5}";last.maxLength=5;last.required=true;last.placeholder="匯款帳號末五碼";
    date.type="date";date.required=true;
    for(const [label,input] of [["實際匯款金額",amount],["匯款帳號末五碼",last],["匯款日期",date]]){const l=element("label",label);l.style.display="block";l.style.marginBottom="12px";input.style.display="block";input.style.boxSizing="border-box";input.style.width="100%";input.style.marginTop="6px";l.append(input);form.append(l)}
    const submit=element("button","匯款完成回覆");submit.type="submit";form.append(submit,message);box.append(form);
    try{const result=await parentApi("uniform-events/field-trip-payment-account?activityId="+encodeURIComponent(item.activityId));const b=result.item;if(!b)throw Error("活動尚未綁定帳戶");box.prepend(element("p","收款帳戶："+b.bankName+"（"+b.bankCode+"）｜"+b.accountHolder+"｜帳號："+b.accountNumber))}
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
  const history=hosts.history;history.replaceChildren();
  if(!(registration.items||[]).length)history.append(element("p","目前沒有活動報名或付款紀錄。","muted"));
  for(const item of registration.items||[]){
   const match=cfg.find(x=>x.module===item.kind&&x.id===item.activityId);
   const card=element("div",undefined,"card");card.append(element("strong",match?.title||item.activityId));
   card.append(element("p","學生 "+(item.studentIds||[]).length+" 位｜大人 "+item.adults+" 位｜其他兒童 "+item.extraChildren+" 位"));
   const states={NOT_OPEN:"尚未開放付款",REPORTED_UNVERIFIED:"已回報匯款，待幹部核帳",VERIFIED:"已確認入帳"};
   card.append(element("p","報名："+(item.registrationStatus==="REGISTERED"?"已送出":item.registrationStatus)+"｜付款："+(states[item.paymentStatus]||item.paymentStatus)));
   if(item.estimatedAmount!=null)card.append(element("p","登記金額 NT$ "+Number(item.estimatedAmount).toLocaleString("zh-TW")));
   appendActivityFeeBreakdown(card,match,item);
   await appendFieldTripPayment(card,item,match);
   history.append(card);
  }
  const categories={events:["yearEndDinner"],performance:["fieldTrip","performance","flashMob","schoolExchange","jointConcert"]};
  for(const [category,host] of Object.entries(hosts)){
   if(category==="history")continue;host.replaceChildren();
   const items=cfg.filter(x=>categories[category].includes(x.module));
   if(!items.length){host.append(element("p","目前沒有已開放的活動。","muted"));continue}
   for(const item of items){
    const card=element("div",undefined,"card");card.append(element("h3",item.title||"活動"));
    card.append(element("p",[formatDate(item.startAt),item.location].filter(Boolean).join("｜"),"muted"));
    const already=(registration.items||[]).find(x=>x.kind===item.module&&x.activityId===item.id);
    if(already){card.append(element("p","此活動已送出報名。"));appendActivityFeeBreakdown(card,item,already);await appendFieldTripPayment(card,already,item);host.append(card);continue}
    if(!["yearEndDinner","fieldTrip"].includes(item.module)){card.append(element("p","活動資訊依校方公告。","hint"));host.append(card);continue}
    const form=element("form");form.className="inline-activity-form";
    const studentWrap=element("fieldset");studentWrap.append(element("legend","參加學生"));
    for(const st of students){const label=element("label");const input=element("input");input.type="checkbox";input.value=st.studentId;label.append(input,document.createTextNode(" "+(st.name||st.studentName||st.studentId)));studentWrap.append(label)}
    const adults=element("select"),children=element("select");
    for(let i=1;i<=5;i++)adults.add(new Option(i+" 位大人",i));
    for(let i=0;i<=5;i++)children.add(new Option(i+" 位其他兒童",i));
    const adultLabel=element("label","陪同大人數量"),childLabel=element("label","其他兒童數量");adultLabel.append(adults);childLabel.append(children);
    const total=element("p","","amount-summary");
    const dinner=item.module==="yearEndDinner";
    const rates=["firstAdultFee","extraAdultFee","extraChildFee"].every(k=>Number.isSafeInteger(item[k])&&item[k]>=0);
    const calc=()=>{const n=studentWrap.querySelectorAll("input:checked").length,a=Number(adults.value),c=Number(children.value);const amount=rates?(dinner?0:Number(item.studentFee||0)*n)+item.firstAdultFee+(a-1)*item.extraAdultFee+c*item.extraChildFee:null;total.textContent="團員 "+n+" 位＋大人 "+a+" 位＋其他兒童 "+c+" 位｜"+(amount===null?"費率尚未公布":"合計 NT$ "+amount.toLocaleString("zh-TW"));return amount};
    for(const input of [adults,children,studentWrap])input.addEventListener("change",calc);
    form.append(studentWrap,adultLabel,childLabel,total);
    let lastFive=null,accountReady=!dinner;
    if(dinner){
     const bank=element("div","正在讀取幹部收款帳戶…","payment-account");form.append(bank);
     lastFive=element("input");lastFive.inputMode="numeric";lastFive.maxLength=5;lastFive.pattern="[0-9]{5}";lastFive.required=true;lastFive.placeholder="匯款帳號後五碼";
     const label=element("label","匯款帳號後五碼");label.append(lastFive);form.append(label);
     try{const info=await parentApi("uniform-events/dinner-payment-account?activityId="+encodeURIComponent(item.id));const b=info.item;if(!b)throw Error("尚未設定收款帳戶");bank.replaceChildren();bank.append(element("strong","幹部收款帳戶"));bank.append(element("p",b.bankName+"（"+b.bankCode+"）｜戶名："+b.accountHolder));bank.append(element("p","帳號："+b.accountNumber));accountReady=true}
     catch(e){bank.textContent="目前尚未開放匯款："+e.message}
    }
    const submit=element("button",dinner?"確認報名並回報匯款":"確認報名");submit.type="submit";submit.disabled=!accountReady;
    const message=element("p","","hint");message.setAttribute("role","status");form.append(submit,message);
    form.addEventListener("submit",async e=>{
     e.preventDefault();const ids=[...studentWrap.querySelectorAll("input:checked")].map(x=>x.value);if(!ids.length){message.textContent="請先選擇參加學生";return}
     const amount=calc();if(dinner&&(amount===null||!/^[0-9]{5}$/.test(lastFive.value))){message.textContent="請確認費用與匯款帳號後五碼";return}
     if(!confirm("確認送出報名"+(dinner?"及匯款回報（待幹部核帳）":"")+"？"))return;
     submit.disabled=true;message.textContent="送出中…";
     try{await parentApi("uniform-events/family-registration",{method:"POST",body:JSON.stringify({kind:item.module,activityId:item.id,studentIds:ids,adults:Number(adults.value),extraChildren:Number(children.value),...(dinner?{lastFive:lastFive.value}:{})})});message.textContent="已送出，"+(dinner?"匯款待幹部核帳。":"報名成功。");await renderInlineActivities()}
     catch(err){message.textContent="送出失敗："+err.message;submit.disabled=false}
    });card.append(form);host.append(card);calc();
   }
  }
 }catch(e){for(const host of Object.values(hosts)){host.replaceChildren();host.append(element("p","資料讀取失敗："+e.message,"hint"))}}
}
renderInlineActivities();
