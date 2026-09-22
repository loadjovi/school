(()=>{const q=new URLSearchParams(location.search),sid=String(q.get("onboardingSchoolId")||"").trim().toLowerCase(),role=String(q.get("onboardingRole")||"").trim();if(/^[a-z0-9-]{2,60}$/.test(sid)&&["schoolAdmin","teacher","parent"].includes(role)){sessionStorage.setItem("school_context_id",sid);sessionStorage.setItem("role_context",role)}})();
const state={me:null,students:[],student:null,page:"home",summary:null,practice:[],token:sessionStorage.getItem("google_id_token")||"",registrations:[],master:[],schoolOptions:[],parentSelfBind:{schoolId:"",schoolName:"",students:[],loading:false}};
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const grades=["一年級","二年級","三年級","四年級","五年級","六年級"],groups=["A","B","C","儲備"],instruments=["小提琴","中提琴","大提琴","低音提琴","其他"];
function opts(list,val){return list.map(x=>`<option value="${esc(x)}" ${x===val?"selected":""}>${esc(x)}</option>`).join("")}
function toast(msg){const t=$("toast");if(!t)return;t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),1800)}
async function api(url,options={}){const h={"Content-Type":"application/json"};if(state.token)h["X-Google-ID-Token"]=state.token;const schoolContext=sessionStorage.getItem("school_context_id")||"",roleContext=sessionStorage.getItem("role_context")||"";if(schoolContext)h["X-School-Id"]=schoolContext;if(roleContext)h["X-Role-Context"]=roleContext;Object.assign(h,options.headers||{});const r=await fetch(url,{...options,headers:h});const d=await r.json().catch(()=>({}));if(r.status===401){logout(false);throw new Error("登入已失效，請重新使用 Google 登入")};if(!r.ok)throw new Error(d.error||d.message||`HTTP ${r.status}`);return d}
function logout(reload=true){state.token="";state.me=null;state.students=[];state.student=null;sessionStorage.removeItem("google_id_token");sessionStorage.removeItem("school_context_id");sessionStorage.removeItem("role_context");if(window.google?.accounts?.id)google.accounts.id.disableAutoSelect();if(reload)renderLogin()}
async function boot(){if(!state.token){renderLogin();return}try{await loadProfile()}catch(e){renderLogin(e.message)}}
async function loadProfile(){
  state.me=await api("/api/me");
  const contexts=Array.isArray(state.me.contexts)?state.me.contexts:[];
  const chosen=sessionStorage.getItem("role_context")||"";
  if(!chosen&&state.me.role==="unassigned"&&!contexts.length){
    try{const d=await api("/api/school-options");state.schoolOptions=Array.isArray(d.items)?d.items:[]}catch{state.schoolOptions=[]}
    state.students=[];state.student=null;state.page="schoolSelect";render();return;
  }
  if(!chosen&&contexts.length>0&&(contexts.length>1||["unassigned","tenantPending"].includes(state.me.role))){
    state.me.role="contextSelector";state.me.capabilities={};state.me.activeContextKey="";
    state.students=[];state.student=null;state.page="contextSelect";render();return;
  }
  if(state.me.role==="contextDenied"){
    sessionStorage.removeItem("school_context_id");sessionStorage.removeItem("role_context");
    state.me.role="contextSelector";state.me.capabilities={};state.me.activeContextKey="";
    state.students=[];state.student=null;state.page="contextSelect";render();return;
  }
  if(["globalAdmin","tenantPending"].includes(state.me.role)){
    state.students=[];state.student=null;state.page=state.me.role==="globalAdmin"?"global":"home";render();return;
  }
  if(state.me.role==="admin"){
    state.page="admin";
    await loadAdmin();
    state.students=Array.isArray(state.master)?state.master:[];
    state.student=state.students[0]||null;
  }else{
    state.students=await api("/api/students");state.student=state.students[0]||null;
    if(["teacher","sectionTeacher","ensembleTeacher","comprehensiveTeacher","privateTeacher"].includes(state.me.role)||state.me?.capabilities?.teacherSettings)state.page="teacherHome";
    else state.page="home";
    if(state.me.role==="parent"&&state.student)await refreshStudent();
  }
  render()
}
async function loadAdmin(){const [r,m]=await Promise.all([api("/api/student-registration?status=pending"),api("/api/student-master")]);state.registrations=r.items||[];state.master=m.items||[]}
async function refreshStudent(){if(!state.student)return;const month=new Date().toISOString().slice(0,7);const[sum,logs]=await Promise.all([api(`/api/summary?studentId=${encodeURIComponent(state.student.studentId)}&month=${month}`),api(`/api/practice?studentId=${encodeURIComponent(state.student.studentId)}&month=${month}`)]);state.summary=sum;state.practice=logs.items||[]}
async function renderLogin(error=""){document.getElementById("app").innerHTML=`<div class="login-wrap"><div class="login-card"><div class="logo">🎻</div><h1>聖心小學弦樂團</h1><p>Google Gmail 登入版 v3<br>家長、老師與管理員共用入口</p>${error?`<div class="error">${esc(error)}</div>`:""}<div id="googleBtn" style="display:flex;justify-content:center;margin-top:18px"></div><div class="notice" style="margin-top:16px">第一次登入若尚未綁定學生，可直接填寫學生資料送交管理員確認。</div></div></div>`;try{const cfg=await fetch("/api/config").then(r=>r.json());if(!cfg.googleClientId){$("googleBtn").innerHTML='<div class="error">尚未設定 GOOGLE_CLIENT_ID</div>';return}let n=0;const wait=setInterval(()=>{n++;if(window.google?.accounts?.id){clearInterval(wait);google.accounts.id.initialize({client_id:cfg.googleClientId,callback:async res=>{state.token=res.credential;sessionStorage.setItem("google_id_token",state.token);try{await loadProfile()}catch(e){renderLogin(e.message)}}});google.accounts.id.renderButton($("googleBtn"),{theme:"outline",size:"large",shape:"pill",text:"signin_with",locale:"zh_TW",width:280})}else if(n>50){clearInterval(wait);$("googleBtn").innerHTML='<div class="error">Google 登入元件載入失敗</div>'}},100)}catch(e){$("googleBtn").innerHTML=`<div class="error">${esc(e.message)}</div>`}}
function roleText(){return({parent:"家長／學生",teacher:"老師",sectionTeacher:"分部老師",ensembleTeacher:"合奏老師",comprehensiveTeacher:"綜合課老師",privateTeacher:"個別課老師",admin:"學校管理員",globalAdmin:"Global 管理員",tenantPending:"學校建置中",contextSelector:"選擇身分",contextDenied:"請重新選擇身分",unassigned:"尚未綁定"}[state.me?.role]||"使用者")}
function navBtn(p,i,l){return `<button class="${state.page===p?"active":""}" onclick="go('${p}')"><span>${i}</span>${l}</button>`}
function nav(){const r=state.me.role;if(state.page==="contextSelect")return `<nav class="nav"><button></button><button></button><button></button><button></button></nav>`;if(r==="parent")return `<nav class="nav">${navBtn("home","🏠","首頁")}${navBtn("practice","⏱️","自主打卡")}${navBtn("record","📊","紀錄")}${navBtn("register","➕","新增學生")}</nav>`;if(r==="sectionTeacher")return `<nav class="nav">${navBtn("section","🎼","分部點名")}${navBtn("help","ℹ️","說明")}<button></button><button></button></nav>`;if(r==="privateTeacher")return `<nav class="nav">${navBtn("private","🎻","個別課")}${navBtn("help","ℹ️","說明")}<button></button><button></button></nav>`;if(r==="admin")return `<nav class="nav">${navBtn("admin","📈","Dashboard")}${navBtn("students","👥","學生主檔")}${navBtn("scores","🧮","考核")}${navBtn("help","ℹ️","說明")}</nav>`;return `<nav class="nav">${navBtn("home","🏠","登記")}${navBtn("help","ℹ️","說明")}<button></button><button></button></nav>`}
function shell(content){const multi=(state.me?.contexts||[]).length>1;const roleBadge=multi?`<button class="role" style="border:0;cursor:pointer" onclick="showContextSelector()" title="切換使用身分">${roleText()} ▾</button>`:`<span class="role">${roleText()}</span>`;const onboarding=state.me?.capabilities?.tenantOnboarding===true?`<div class="card" style="border:2px solid #f59e0b"><div class="notice"><b>🟠 Phase 4 隔離驗證模式</b><br>目前只操作「${esc(state.me?.schoolName||"第二校")}」的 Tenant 資料。這不是正式營運狀態，請依 Global Onboarding 清單完成角色隔離測試。</div></div>`:"";return `<div class="shell"><header class="top"><div class="brand">🎻 ${esc(state.me?.systemName||state.me?.schoolName||"聖心小學弦樂團")}</div><div class="sub">${state.me?.schoolName?esc(state.me.schoolName)+"｜":""}Google Gmail 登入版 v3</div><div class="userrow"><div><small>${esc(state.me.displayName||state.me.email)}</small>${roleBadge}</div><button class="logout" onclick="logout()">登出</button></div></header><main class="main">${onboarding}${content}</main>${nav()}</div>`}
function parentSelfBindPanel(){
  const b=state.parentSelfBind||{};
  if(!b.schoolId)return "";
  if(b.loading)return `<div class="card"><h2>👨‍👩‍👧 綁定家長身分</h2><div class="notice">正在讀取 ${esc(b.schoolName||"學校")} 學生清單…</div></div>`;
  const students=Array.isArray(b.students)?b.students:[];
  return `<div class="card"><button class="secondary" style="margin:0 0 12px" onclick="closeParentSelfBind()">← 取消綁定</button><h2>👨‍👩‍👧 綁定家長身分｜${esc(b.schoolName||"學校")}</h2>
    <div class="notice"><b>此功能僅提供該校 School Admin 綁定自己的家長身分。</b><br>綁定後，這個 Google 帳號會多出「${esc(b.schoolName||"學校")}｜家長」身分，可切換查看該學生的出勤、自主練習與個別課紀錄。</div>
    <label>家長姓名</label><input id="selfParentName" value="${esc(state.me?.displayName||"")}">
    <label>與學生關係</label><select id="selfParentRel"><option>父親</option><option>母親</option><option>監護人</option><option>家長</option><option>其他</option></select>
    <label>綁定學生</label><select id="selfParentStudent">${students.map(s=>`<option value="${esc(s.studentId)}">${esc(s.name||"未命名")}｜${esc(s.grade||"—")}｜${esc(s.groupName||"—")}團｜${esc(s.instrument||"—")}｜學號 ${esc(s.studentId)}</option>`).join("")}</select>
    <div class="check"><input id="selfParentConsent" type="checkbox"><div>我確認此 Google 帳號確實為上述學生之家長／監護人，並同意建立家長存取權限。</div></div>
    <button class="primary" onclick="saveParentSelfBind()">✅ 建立家長身分</button>
  </div>`;
}
function contextSelectorPage(){
  const contexts=Array.isArray(state.me?.contexts)?state.me.contexts:[];
  const active=sessionStorage.getItem("role_context")?String(state.me?.activeContextKey||""):"";
  if(!contexts.length)return `<div class="card hero"><h2>👤 尚無可用身分</h2><div class="notice">目前帳號尚未被授予任何平台或學校角色。</div></div>`;
  const cards=contexts.map(x=>{
    const usable=["active","onboarding"].includes(String(x.status||"active")),disabled=!usable&&x.type==="schoolAdmin",current=active===x.key;
    const hasParent=contexts.some(y=>y.type==="parent"&&String(y.schoolId||"")===String(x.schoolId||""));
    const bindParent=x.type==="schoolAdmin"&&usable&&!hasParent
      ?`<button class="secondary" style="width:100%;margin-top:10px" onclick="openParentSelfBind('${esc(x.schoolId||"")}','${esc(x.schoolName||"")}')">＋ 綁定為此校學生家長</button>`
      :"";
    const statusLabel=x.status==="setup"?"建置中":x.status==="onboarding"?"隔離驗證中":x.status==="inactive"?"停用":"可使用";
    return `<div class="card"><div class="student"><div><b style="font-size:17px">${esc(x.icon||"👤")} ${esc(x.label||x.role)}</b><div class="muted">${x.schoolName?esc(x.schoolName)+"｜":""}${esc(statusLabel)}</div></div>${current?`<span class="badge ok">目前身分</span>`:""}</div><button class="${disabled?"secondary":"primary"}" ${disabled?"disabled":""} onclick="selectIdentityContext('${esc(x.type)}','${esc(x.schoolId||"")}')">${disabled?"尚未開放":x.status==="onboarding"?"進入隔離測試":"使用此身分"}</button>${bindParent}</div>`;
  }).join("");
  return `<div class="card hero"><h2>👤 選擇使用身分</h2><div class="notice"><b>${esc(state.me?.displayName||state.me?.email)}</b><br>同一個 Google 帳號可以同時具有 Global、學校管理員、老師與家長身分。每次只啟用一個操作身分，避免權限混用。</div></div>`+cards+parentSelfBindPanel();
}
window.showContextSelector=function(){state.page="contextSelect";render()};
window.openParentSelfBind=async function(schoolId,schoolName){
  state.parentSelfBind={schoolId:String(schoolId||""),schoolName:String(schoolName||""),students:[],loading:true};
  render();
  try{
    const d=await api("/api/parent-self-bind",{headers:{"X-Role-Context":"schoolAdmin","X-School-Id":String(schoolId||"")}});
    state.parentSelfBind={schoolId:String(schoolId||""),schoolName:String(d.schoolName||schoolName||""),students:d.students||[],loading:false};
    render();
    setTimeout(()=>document.getElementById("selfParentStudent")?.scrollIntoView({behavior:"smooth",block:"center"}),50);
  }catch(e){
    state.parentSelfBind={schoolId:"",schoolName:"",students:[],loading:false};
    toast("❌ "+e.message);render();
  }
};
window.closeParentSelfBind=function(){state.parentSelfBind={schoolId:"",schoolName:"",students:[],loading:false};render()};
window.saveParentSelfBind=async function(){
  const b=state.parentSelfBind||{},studentId=document.getElementById("selfParentStudent")?.value,parentName=document.getElementById("selfParentName")?.value.trim(),relationship=document.getElementById("selfParentRel")?.value;
  if(!document.getElementById("selfParentConsent")?.checked){toast("請先確認家長／監護人關係");return}
  if(!studentId){toast("請選擇要綁定的學生");return}
  const s=(b.students||[]).find(x=>String(x.studentId)===String(studentId));
  if(!confirm(`確定將目前 Google 帳號綁定為「${s?.name||studentId}」的${relationship||"家長"}？\n\n綁定後，此帳號會取得該學生之家長資料存取權限。`))return;
  try{
    await api("/api/parent-self-bind",{method:"POST",headers:{"X-Role-Context":"schoolAdmin","X-School-Id":String(b.schoolId||"")},body:JSON.stringify({studentId,parentName,relationship,consent:true})});
    toast("✅ 家長身分已建立");
    state.parentSelfBind={schoolId:"",schoolName:"",students:[],loading:false};
    state.me=await api("/api/me");state.page="contextSelect";render();
  }catch(e){toast("❌ "+e.message)}
};
window.selectIdentityContext=function(type,schoolId){
  const t=String(type||""),sid=String(schoolId||"");
  if(!["global","schoolAdmin","teacher","parent"].includes(t))return;
  sessionStorage.setItem("role_context",t);
  if(t==="global")sessionStorage.removeItem("school_context_id");else if(sid)sessionStorage.setItem("school_context_id",sid);
  location.reload();
};
async function go(p){state.page=p;if(["home","practice","record"].includes(p)&&state.student)await refreshStudent();if(state.me.role==="admin"&&["admin","students"].includes(p))await loadAdmin();render()}
function scoreItem(n,s,v,c="ok"){return `<div class="item"><div><b>${esc(n)}</b><small>${esc(s)}</small></div><span class="badge ${c}">${esc(v)}</span></div>`}
function schoolSelectionPage(){
  const items=Array.isArray(state.schoolOptions)?state.schoolOptions:[];
  const rows=items.length?items.map(x=>{
    const testing=String(x.status||"")==="onboarding";
    return `<div class="card"><div class="student"><div><b style="font-size:17px">🏫 ${esc(x.schoolName||x.schoolId)}</b><div class="muted">${testing?"隔離驗證中":"正式啟用"}｜${esc(x.systemName||"")}</div></div><span class="badge ${testing?"warn":"ok"}">${testing?"測試":"可使用"}</span></div><button class="primary" onclick="chooseParentSchool('${esc(x.schoolId)}')">${testing?"進入測試並綁定":"選擇此學校"}</button></div>`;
  }).join(""):`<div class="card"><div class="notice">目前沒有可選擇的學校，請聯絡系統管理員。</div></div>`;
  return `<div class="card hero"><h2>🏫 第一次登入｜選擇學校</h2><div class="notice">請先選擇學生所屬學校。後續姓名與學號只會在該校學生主檔中比對，不會跨校查詢或綁定。</div></div>${rows}`;
}
window.chooseParentSchool=function(schoolId){
  const sid=String(schoolId||"").trim();
  if(!sid)return;
  sessionStorage.setItem("school_context_id",sid);
  sessionStorage.setItem("role_context","parent");
  location.reload();
};
window.clearParentSchoolSelection=function(){
  sessionStorage.removeItem("school_context_id");
  sessionStorage.removeItem("role_context");
  location.reload();
};
function registrationForm(){return `<div class="card"><h2>第一次登入｜綁定學生</h2><div class="notice"><b>綁定學校：${esc(state.me?.schoolName||"未指定學校")}</b><br>登入 Gmail：${esc(state.me.email)}<br>請填寫學生姓名與學號供系統比對。年級、班級、團別與樂器一律以目前學校的學生主檔為準，家長填寫內容不會修改學生資料。</div><button class="secondary" style="width:100%;margin:0 0 12px" onclick="clearParentSchoolSelection()">← 重新選擇學校</button><label>學生姓名</label><input id="rName" autocomplete="off" placeholder="請輸入學生完整姓名"><label>學生學號</label><input id="rStudentNo" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="請輸入 6 碼學生學號"><div class="check"><input id="rConsent" type="checkbox"><div>我確認此 Google 帳號為上述學生之家長／監護人，並同意建立家長存取權限。</div></div><button class="primary" onclick="submitRegistration()">送出綁定申請</button></div>`}
async function submitRegistration(){if(!$("rConsent").checked){toast("請先確認家長／監護人關係");return}const studentName=$("rName").value.trim(),studentNo=$("rStudentNo").value.trim();if(!studentName){toast("請填寫學生姓名");return}if(!studentNo){toast("請填寫學生學號");return}if(!/^\d{6}$/.test(studentNo)){toast("學號需為 6 碼數字");return}const body={studentName,studentNo,consent:true};try{await api("/api/student-registration",{method:"POST",body:JSON.stringify(body)});toast("✅ 已送出，等待管理員確認");state.page="home";render()}catch(e){toast("❌ "+e.message)}}
function home(){if(state.me.role==="unassigned")return registrationForm();if(!state.student)return `<div class="card"><div class="notice">目前帳號尚未綁定學生。</div></div>`;const s=state.summary||{},rate=Math.round((s.practiceRate||0)*1000)/10;return `<div class="card hero"><div class="student"><div class="studentleft"><div class="avatar">${esc(state.student.name?.[0]||"學")}</div><div><div class="name">${esc(state.student.name)}</div><div class="muted">${esc(state.student.groupName)}團｜${esc(state.student.instrument)}｜${esc(state.student.grade)}</div></div></div><div class="pill">${new Date().getMonth()+1}月</div></div><div class="grid"><div class="kpi"><b>${s.practiceQualifiedDays||0}</b><span>自主練習達標天數</span></div><div class="kpi"><b>${s.practiceMinutes||0}</b><span>累計練習分鐘</span></div><div class="kpi"><b>${s.sectionPresent||0} / ${s.sectionTotal||0}</b><span>分部團練</span></div><div class="kpi"><b>${s.privatePresent||0} / ${s.privateTotal||0}</b><span>個別課</span></div></div><div style="margin-top:12px;font-size:12px;font-weight:800">自主練習達標率 <span style="float:right">${rate}%</span></div><div class="progress"><i style="width:${Math.min(rate,100)}%"></i></div></div><div class="card"><h2>今天要做什麼？</h2><div class="notice">年級、團別與樂器資料由學生主檔管理，之後異動不會影響既有點名／練習紀錄。</div><button class="primary" onclick="go('practice')">立即自主練習打卡</button></div>`}
function calcMinutes(s,e){if(!s||!e)return 0;const[a,b]=s.split(":").map(Number),[c,d]=e.split(":").map(Number);let m=(c*60+d)-(a*60+b);if(m<0)m+=1440;return m}
function practicePage(){const today=new Date().toISOString().slice(0,10),logs=state.practice.slice(0,8);const history=logs.length?logs.map(x=>`<div class="item" style="align-items:flex-start"><div style="min-width:0;flex:1"><b>${esc(x.practiceDate)}｜${esc(x.practiceContent||"自主練習")}</b><small>${esc(x.startTime||"")}～${esc(x.endTime||"")}｜${Number(x.minutes||0)} 分鐘</small></div><div style="display:flex;align-items:center;gap:8px;flex-shrink:0"><span class="badge ${x.qualified?"ok":"bad"}">${x.qualified?"達標":"未達"}</span>${x.practiceId?`<button type="button" style="border:1px solid #c94b4b;background:#fff7f7;color:#a52a2a;border-radius:10px;padding:7px 9px;font-weight:800" onclick="deletePracticeRecord('${esc(x.practiceId)}','${esc(x.practiceDate)}','${esc(x.startTime||"")}','${esc(x.endTime||"")}',${Number(x.minutes||0)})">🗑️</button>`:""}</div></div>`).join(""):`<div class="notice">本月尚無紀錄。</div>`;return `<div class="card"><h2>自主練習打卡</h2><div class="notice">${esc(state.student?.name)}｜${esc(state.student?.groupName)}團｜${esc(state.student?.instrument)}</div><label>練習日期</label><input id="pDate" type="date" value="${today}"><div class="row2"><div><label>開始時間</label><input id="pStart" type="time" value="18:00" oninput="updateMinutes()"></div><div><label>結束時間</label><input id="pEnd" type="time" value="18:20" oninput="updateMinutes()"></div></div><div class="minutes"><div><div class="muted">本次練習時間</div><strong><span id="pMins">20</span> 分鐘</strong></div><span id="pQual" class="badge ok">✅ 已達標</span></div><label>練習內容／曲目</label><textarea id="pContent" rows="3"></textarea><label>練習重點</label><select id="pFocus"><option>音階／基本功</option><option>團練曲目</option><option>考試曲</option><option>節奏／視奏</option><option>其他</option></select><div class="check"><input id="pConfirm" type="checkbox"><div>家長確認：我確認學生已完成上述自主練習。</div></div><button class="primary" onclick="savePractice()">送出今天的打卡</button></div><div class="card"><h2>最近打卡</h2><div class="notice" style="margin-bottom:10px">如誤登日期或時間，可由家長移除錯誤紀錄；移除後會重新計算本月練習分鐘與達標天數。</div>${history}</div>`}
function updateMinutes(){const m=calcMinutes($("pStart").value,$("pEnd").value);$("pMins").textContent=m;$("pQual").className=`badge ${m>=15?"ok":"bad"}`;$("pQual").textContent=m>=15?"✅ 已達標":"⚠️ 未達 15 分鐘"}
async function savePractice(){if(!$("pConfirm").checked){toast("請先完成家長確認");return}const body={studentId:state.student.studentId,practiceDate:$("pDate").value,startTime:$("pStart").value,endTime:$("pEnd").value,practiceContent:$("pContent").value.trim(),focus:$("pFocus").value,parentConfirmed:true};try{await api("/api/practice",{method:"POST",body:JSON.stringify(body)});toast("✅ 自主練習已送出");await refreshStudent();render()}catch(e){toast("❌ "+e.message)}}
window.deletePracticeRecord=async function(practiceId,practiceDate,startTime,endTime,minutes){
  if(state.me?.role!=="parent"||!state.student)return;
  const detail=[practiceDate,[startTime,endTime].filter(Boolean).join("～"),minutes?minutes+" 分鐘":""].filter(Boolean).join("｜");
  if(!confirm("確定移除這筆自主練習紀錄？\n\n"+detail+"\n\n移除後，本月練習分鐘與達標天數會重新計算。"))return;
  try{
    await api("/api/practice",{method:"DELETE",body:JSON.stringify({studentId:state.student.studentId,practiceId})});
    toast("✅ 已移除自主練習紀錄");
    await refreshStudent();render();
  }catch(e){toast("❌ "+e.message)}
};
function recordPage(){const s=state.summary||{},m=Number(s.practiceMinutes||0);return `<div class="card hero"><h2>${esc(state.student?.name)}｜學習紀錄</h2><div class="muted">本學期學習與出勤紀錄</div><div class="grid" style="margin-top:14px"><div class="kpi"><b>${s.practiceQualifiedDays||0} 天</b><span>自主練習達標</span></div><div class="kpi"><b>${Math.floor(m/60)} 小時 ${m%60} 分</b><span>自主練習</span></div></div></div>`}
function sectionPage(){const today=new Date().toISOString().slice(0,10);return `<div class="card"><h2>分部團練點名</h2><label>上課日期</label><input id="sDate" type="date" value="${today}"><label>聲部</label><input id="sSection" value="${esc(state.me.section||"")}"></div><div class="card"><h2>學生名單</h2>${state.students.map(s=>`<div class="item"><div><b>${esc(s.name)}</b><small>${esc(s.groupName)}團｜${esc(s.instrument)}</small></div><select id="att_${s.studentId}" class="status-select"><option value="present">出席</option><option value="late">遲到</option><option value="leave">請假</option><option value="absent">缺席</option><option value="cancelled">停課</option></select></div>`).join("")}<button class="primary" onclick="saveSection()">儲存本次點名</button></div>`}
async function saveSection(){const items=state.students.map(s=>({studentId:s.studentId,status:$(`att_${s.studentId}`).value,minutes:$(`att_${s.studentId}`).value==="absent"?0:45}));try{await api("/api/section-attendance",{method:"POST",body:JSON.stringify({sessionDate:$("sDate").value,section:$("sSection").value,items})});toast("✅ 分部點名已儲存")}catch(e){toast("❌ "+e.message)}}
function privatePage(){const today=new Date().toISOString().slice(0,10);return `<div class="card"><h2>個別課紀錄</h2><label>學生</label><select id="iStudent">${state.students.map(s=>`<option value="${s.studentId}">${esc(s.name)}｜${esc(s.instrument)}</option>`).join("")}</select><label>上課日期</label><input id="iDate" type="date" value="${today}"><div class="row2"><div><label>狀態</label><select id="iStatus"><option value="present">出席</option><option value="late">遲到</option><option value="leave">請假</option><option value="absent">缺席</option></select></div><div><label>分鐘</label><input id="iMinutes" type="number" value="50"></div></div><label>課程內容</label><textarea id="iContent" rows="3"></textarea><button class="primary" onclick="savePrivate()">儲存個別課紀錄</button></div>`}
async function savePrivate(){try{await api("/api/private-lesson",{method:"POST",body:JSON.stringify({studentId:$("iStudent").value,lessonDate:$("iDate").value,status:$("iStatus").value,minutes:Number($("iMinutes").value||0),lessonContent:$("iContent").value})});toast("✅ 個別課紀錄已儲存")}catch(e){toast("❌ "+e.message)}}
function pendingCard(r){const matches=state.master.filter(s=>String(s.name||"").trim()===String(r.studentName||"").trim()&&String(s.studentId||"").trim()===String(r.studentNo||"").trim()),matched=matches.length===1?matches[0]:null;return `<div class="card"><h2>${esc(r.studentName)}｜待審核</h2><div class="notice">申請 Gmail：${esc(r.parentEmail)}<br>家長填寫：${esc(r.studentName)}｜學號 ${esc(r.studentNo||"未填學號")}<br>${matched?`系統比對：${esc(matched.grade)}｜${esc(matched.groupName)}團｜${esc(matched.instrument)}｜學號 ${esc(matched.studentId)}`:"⚠️ 無法唯一比對學生，請管理員指定正確學生。"}</div><label>對應學生主檔</label><select id="rm_${r.registrationId}"><option value="">請選擇學生</option>${state.master.map(s=>`<option value="${esc(s.studentId)}" ${matched&&s.studentId===matched.studentId?"selected":""}>${esc(s.name)}｜${esc(s.grade)}｜${esc(s.groupName)}團｜${esc(s.instrument)}</option>`).join("")}</select><div class="row2"><button class="primary" onclick="approveReg('${r.registrationId}')">核准綁定</button><button class="secondary" style="margin-top:14px" onclick="rejectReg('${r.registrationId}')">退回</button></div></div>`}
async function approveReg(id){const studentId=$(`rm_${id}`).value;if(!studentId){toast("請先指定正確學生");return}const body={registrationId:id,action:"approve",studentId};try{await api("/api/student-registration",{method:"PATCH",body:JSON.stringify(body)});toast("✅ 已核准並綁定");await loadAdmin();render()}catch(e){toast("❌ "+e.message)}}
async function rejectReg(id){if(!confirm("確定退回此登記？"))return;try{await api("/api/student-registration",{method:"PATCH",body:JSON.stringify({registrationId:id,action:"reject"})});toast("已退回");await loadAdmin();render()}catch(e){toast("❌ "+e.message)}}
function adminPage(){return `<div class="card hero"><h2>管理員 Dashboard</h2><div class="grid"><div class="kpi"><b>${state.master.length}</b><span>學生主檔</span></div><div class="kpi"><b>${state.registrations.length}</b><span>待審核</span></div><div class="kpi"><b>80%</b><span>考試</span></div><div class="kpi"><b>10/5/5</b><span>練習／個課／分部</span></div></div></div>${state.registrations.length?`<h2>待審核學生</h2>${state.registrations.map(pendingCard).join("")}`:`<div class="card"><div class="notice">目前沒有待審核資料。</div></div>`}`}
function studentEdit(s){return `<div class="card"><h2>${esc(s.name)} <span class="badge ${s.status==="active"?"ok":"warn"}">${esc(s.studentId)}</span></h2><label>姓名</label><input id="sn_${s.studentId}" value="${esc(s.name)}"><div class="row2"><div><label>年級</label><select id="sg_${s.studentId}">${opts(grades,s.grade)}</select></div><div><label>團別</label><select id="sgrp_${s.studentId}">${opts(groups,s.groupName)}</select></div></div><label>樂器</label><select id="si_${s.studentId}">${opts(instruments,s.instrument)}</select><div class="row2"><div><label>學年度</label><input id="sy_${s.studentId}" value="${esc(s.schoolYear||"")}"></div><div><label>狀態</label><select id="ss_${s.studentId}"><option value="active" ${s.status==="active"?"selected":""}>在團</option><option value="inactive" ${s.status==="inactive"?"selected":""}>停用／離團</option></select></div></div><button class="primary" onclick="saveStudent('${s.studentId}')">儲存異動</button></div>`}
function studentsPage(){return `<div class="card"><h2>學生主檔管理</h2><div class="notice">年級、團別、樂器皆可後續修改；每次異動會寫入 StudentHistory，不會改掉過去點名與練習紀錄。</div></div>${state.master.map(studentEdit).join("")||'<div class="card"><div class="notice">尚無學生主檔。之後可以匯入目前弦樂團名單。</div></div>'}`}
async function saveStudent(id){const body={studentId:id,name:$(`sn_${id}`).value,grade:$(`sg_${id}`).value,groupName:$(`sgrp_${id}`).value,instrument:$(`si_${id}`).value,schoolYear:$(`sy_${id}`).value,status:$(`ss_${id}`).value};try{await api("/api/student-master",{method:"PATCH",body:JSON.stringify(body)});toast("✅ 學生主檔已更新");await loadAdmin();render()}catch(e){toast("❌ "+e.message)}}
function helpPage(){return `<div class="card"><h2>系統說明</h2><div class="notice">Gmail 只用來辨識家長／老師／管理員；學生資料存在 StudentMaster。年級升級、A/B 團異動、換樂器時，只更新學生主檔即可。</div></div>`}
function render(){let c;if(state.page==="schoolSelect")c=schoolSelectionPage();else if(state.page==="contextSelect")c=contextSelectorPage();else if(state.me.role==="admin")c=state.page==="students"?studentsPage():state.page==="help"?helpPage():adminPage();else if(["teacher","sectionTeacher","ensembleTeacher","comprehensiveTeacher","privateTeacher"].includes(state.me.role)||state.me?.capabilities?.teacherSettings){if(state.page==="help")c=helpPage();else if(state.page==="private")c=privatePage();else if(state.page==="section")c=sectionPage();else c=home()}else if(state.page==="practice")c=practicePage();else if(state.page==="record")c=recordPage();else if(state.page==="register")c=registrationForm();else if(state.page==="help")c=helpPage();else c=home();document.getElementById("app").innerHTML=shell(c)}
boot();
