const buttons=[...document.querySelectorAll("[data-view]")];const panels=[...document.querySelectorAll("[data-panel]")];function select(name){for(const b of buttons)b.setAttribute("aria-selected",String(b.dataset.view===name));for(const p of panels)p.hidden=p.dataset.panel!==name}buttons.forEach(b=>b.addEventListener("click",()=>select(b.dataset.view)));function mix(a,b,t){const x=parseInt(a.slice(1),16),y=parseInt(b.slice(1),16);return "#"+[16,8,0].map(n=>Math.round(((x>>n)&255)*(1-t)+((y>>n)&255)*t).toString(16).padStart(2,"0")).join("")}function luminance(c){const n=parseInt(c.slice(1),16),v=[16,8,0].map(k=>((n>>k)&255)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return .2126*v[0]+.7152*v[1]+.0722*v[2]}async function theme(){try{const schoolId=sessionStorage.getItem("school_context_id")||"";const q=new URLSearchParams();if(schoolId)q.set("schoolId",schoolId);const r=await fetch("/api/branding?"+q,{credentials:"same-origin"});if(!r.ok)return;const data=await r.json();let c=String(data.primaryColor||"");if(!/^#[0-9a-f]{6}$/i.test(c))return;for(let i=0;i<16&&1.05/(luminance(c)+.05)<4.5;i++)c=mix(c,"#000000",.13);document.documentElement.style.setProperty("--main",c);document.documentElement.style.setProperty("--soft",mix(c,"#ffffff",.91));document.documentElement.style.setProperty("--ink",mix(c,"#000000",.55))}catch(e){console.warn("Branding fallback",e)}}theme();

async function eligibleUniforms(){
 const status=document.getElementById("uniformEligibilityStatus"),regular=document.getElementById("regularUniformCard"),competition=document.getElementById("competitionUniformCard");
 regular.hidden=true;competition.hidden=true;
 try{
  const [studentsResponse,configsResponse]=await Promise.all([fetch("/api/students",{credentials:"same-origin",cache:"no-store"}),fetch("/api/uniform-events/config",{credentials:"same-origin",cache:"no-store"})]);
  if(!studentsResponse.ok||!configsResponse.ok)throw Error("學生資料 HTTP "+studentsResponse.status+"；模組設定 HTTP "+configsResponse.status);
  const studentData=await studentsResponse.json(),configData=await configsResponse.json();
  const students=Array.isArray(studentData)?studentData:(studentData.items||[]);
  const configs=configData.items||[];
  const active=module=>configs.some(x=>x.module===module&&x.id==="default"&&x.enabled===true);
  const isA=s=>["A","A團"].includes(String(s.groupName||s.group||"").trim().toUpperCase().replace(/\s/g,""));
  const aStudents=students.filter(isA);
  regular.hidden=!active("regularUniform");
  competition.hidden=!(active("competitionUniform")&&aStudents.length);
  if(aStudents.length)competition.querySelector("p").textContent="僅限已綁定的 A 團學生："+aStudents.map(x=>x.name||x.studentName||x.studentId).join("、")+"。租借、買斷、尺寸與歸還功能尚待家長端正式串接。";
  status.textContent=students.length?"已確認 "+students.length+" 位已綁定學生；團服依校方啟用狀態及學生團別顯示。":"目前無已綁定學生，團服申請功能不顯示。";
  if(!students.length){regular.hidden=true;competition.hidden=true}
 }catch(e){console.warn("家長團服資格查詢失敗",e);status.textContent="資格查詢失敗（"+e.message+"）。請確認預覽環境登入及 API 設定；暫不開放申請。"}
}
eligibleUniforms();
