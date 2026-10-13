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
  if(aStudents.length){const info=document.getElementById("competitionStudentInfo");info.replaceChildren();for(const st of aStudents){const p=document.createElement("p");p.textContent=(st.name||st.studentName||"A 團學生")+"（"+st.studentId+"）｜A 團｜正式領用紀錄待核對";info.append(p)}if(!competition.hidden)renderCompetitionPurchase(aStudents)}
  status.textContent=students.length?"已確認 "+students.length+" 位已綁定學生；團服依校方啟用狀態及學生團別顯示。":"目前無已綁定學生，團服申請功能不顯示。";
  if(!students.length){regular.hidden=true;competition.hidden=true}
 }catch(e){console.warn("家長團服資格查詢失敗",e);status.textContent="資格查詢失敗（"+e.message+"）。請確認預覽環境登入及 API 設定；暫不開放申請。"}
}
eligibleUniforms();

const TSHIRT_SIZES=["8","10","12","14","XS","S","M","L","XL","2L","3L","5L"];
async function loadInlineSizes(){
 const host=document.getElementById("inlineTshirtSizes"),status=document.getElementById("inlineTshirtStatus");
 host.replaceChildren();status.textContent="";
 try{
  const res=await fetch("/api/uniform-events/tshirt-historical-size",{credentials:"same-origin",cache:"no-store",headers:parentAuthHeaders()});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw Error(data.error||"HTTP "+res.status);
  if(!data.items?.length){host.textContent="目前沒有需要補登歷史尺寸的團 T 紀錄。";return}
  for(const item of data.items){
   const box=document.createElement("div");box.className="size-row";
   const title=document.createElement("strong");title.textContent=(item.studentName||item.studentId)+"｜已領取 1 件";
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
   label.append(sel);box.append(title,label,save,state);host.append(box);
  }
 }catch(e){host.textContent="無法讀取尺寸補登資料";status.textContent=e.message}
}

function renderCompetitionPurchase(students){
 const host=document.getElementById("competitionPurchaseArea");host.replaceChildren();
 const heading=document.createElement("h3");heading.textContent="自費加購比賽服";host.append(heading);
 const note=document.createElement("p");note.className="hint";note.textContent="孩子成長需要更換尺寸時可提出加購需求。參考價格 NT$2,625（含稅），送出僅為待審申請，不代表付款或已扣庫存。";host.append(note);
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

async function renderInlineActivities(){
 const hosts={events:document.getElementById("inlineEventRegistration"),performance:document.getElementById("inlinePerformanceRegistration")};
 const setText=(host,msg)=>{host.replaceChildren();const p=document.createElement("p");p.className="muted";p.textContent=msg;host.append(p)};
 try{
  const [meRes,configRes]=await Promise.all([fetch("/api/me",{credentials:"same-origin",headers:parentAuthHeaders()}),fetch("/api/uniform-events/config",{credentials:"same-origin",headers:parentAuthHeaders()})]);
  if(!meRes.ok||!configRes.ok)throw Error("活動資料讀取失敗（"+meRes.status+"／"+configRes.status+"）");
  const me=await meRes.json(),data=await configRes.json();
  const students=me.students||[];
  const cfg=(data.items||[]).filter(x=>x.enabled===true);
  const categories={events:["yearEndDinner","fieldTrip"],performance:["performance","flashMob","schoolExchange","jointConcert"]};
  for(const [category,host] of Object.entries(hosts)){
   host.replaceChildren();
   const items=cfg.filter(x=>categories[category].includes(x.module));
   if(!items.length){setText(host,"目前沒有已開放的"+(category==="events"?"報名活動。":"演出或交流活動。"));continue}
   for(const item of items){
    const card=document.createElement("div");card.className="card";
    const title=document.createElement("strong");title.textContent=item.title||item.name||"活動";
    card.append(title);
    const details=document.createElement("p");details.className="muted";
    const dates=[item.eventAt||item.startAt||item.date,item.location||item.venue].filter(Boolean);
    details.textContent=dates.join("｜")||"活動詳情依學校公告";card.append(details);
    const notice=document.createElement("p");notice.className="hint";
    notice.textContent=category==="events"?"活動報名與付款依學校公告辦理。":"演出參與及回覆依學校公告辦理。";card.append(notice);
    if(["yearEndDinner","fieldTrip"].includes(item.module)){
     const form=document.createElement("form");
     const studentWrap=document.createElement("div");studentWrap.textContent="參加學生：";
     for(const st of students){const label=document.createElement("label");label.style.display="block";const check=document.createElement("input");check.type="checkbox";check.value=st.studentId;label.append(check,document.createTextNode(" "+(st.name||st.studentName||st.studentId)));studentWrap.append(label)}
     const adults=document.createElement("select");for(let i=1;i<=20;i++)adults.add(new Option(i+" 位陪同大人",i));
     const children=document.createElement("select");for(let i=0;i<=20;i++)children.add(new Option(i+" 位其他兒童",i));
     const btn=document.createElement("button");btn.type="submit";btn.textContent="確認報名";
     const msg=document.createElement("p");msg.className="hint";msg.setAttribute("role","status");
     form.append(studentWrap,document.createTextNode("陪同大人"),adults,document.createTextNode("其他兒童"),children,btn,msg);
     form.addEventListener("submit",async e=>{
      e.preventDefault();const ids=[...studentWrap.querySelectorAll("input:checked")].map(x=>x.value);
      if(!ids.length){msg.textContent="請先選擇參加學生";return}
      if(!confirm("確定送出家庭報名？報名不代表已繳費。"))return;
      btn.disabled=true;
      try{const response=await fetch("/api/uniform-events/family-registration",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json",...parentAuthHeaders()},body:JSON.stringify({kind:item.module,activityId:item.id,studentIds:ids,adults:Number(adults.value),extraChildren:Number(children.value)})});const result=await response.json().catch(()=>({}));if(!response.ok)throw Error(result.error||"HTTP "+response.status);msg.textContent="已送出報名；付款尚待確認。"}catch(e){msg.textContent="報名失敗："+e.message;btn.disabled=false}
     });card.append(form);
    }
    host.append(card);
   }
  }
 }catch(e){for(const host of Object.values(hosts))setText(host,e.message)}
}
renderInlineActivities();
