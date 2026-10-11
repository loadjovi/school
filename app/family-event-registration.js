const el=id=>document.getElementById(id);
const escape=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function authHeaders(){
 const token=sessionStorage.getItem("google_id_token")||"";
 const schoolId=sessionStorage.getItem("school_context_id")||"";
 const roleContext=sessionStorage.getItem("role_context")||"";
 return {...(token&&token!=="cookie-session"?{"X-Google-ID-Token":token}:{}),...(schoolId?{"X-School-Id":schoolId}:{}),...(roleContext?{"X-Role-Context":roleContext}:{})};
}
async function api(p,opts={}){
 const r=await fetch("/api/"+p,{...opts,credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json",...authHeaders(),...(opts.headers||{})}});
 const data=await r.json().catch(()=>({}));
 if(r.status===401)throw Error("401 登入驗證失敗：請返回平台首頁，重新以 Google 登入後再開啟報名頁面。");
 if(r.status===403)throw Error("403 報名未完成："+(data.error||"目前無法報名，請確認活動報名期間與學生資格。"));
 if(!r.ok)throw Error(data.error||"HTTP "+r.status);
 return data;
}
const events=new Map();let students=[];
el("switchParent").addEventListener("click",()=>{sessionStorage.setItem("role_context","parent");if(!sessionStorage.getItem("school_context_id"))sessionStorage.setItem("school_context_id","sacred-heart");location.reload()});
const status=s=>el("status").textContent=s;
for(let n=1;n<=20;n++)el("adults").add(new Option(n+" 位大人",n));
for(let n=0;n<=20;n++)el("children").add(new Option(n+" 位兒童",n));
function selected(){return [...document.querySelectorAll("input[name=student]:checked")].map(x=>x.value)}
function summary(){
 const count=selected().length,a=Number(el("adults").value),c=Number(el("children").value);
 const cfg=events.get(el("event").value);const rates=cfg&&["studentFee","firstAdultFee","extraAdultFee","extraChildFee"].every(k=>Number.isSafeInteger(cfg[k])&&cfg[k]>=0);
 const estimate=rates?(cfg.module==="yearEndDinner"?0:cfg.studentFee)*count+cfg.firstAdultFee+(a-1)*cfg.extraAdultFee+c*cfg.extraChildFee:null;
 el("summary").textContent="團員 "+count+" 位＋陪同大人 "+a+" 位＋其他兒童 "+c+" 位＝共 "+(count+a+c)+" 位。"+(estimate===null?"預估費用尚未設定。":"初步報價：NT$ "+estimate.toLocaleString("zh-TW")+"（僅供參考，非最終應繳金額）。")+(cfg?.module==="yearEndDinner"?" 報名成功後請依活動公布的收款資訊匯款，匯款仍須財務確認。":cfg?.paymentMode==="PAY_LATER"?" 本活動先確認報名人數，待主辦方通知後再匯款。":" 本活動可先報名，並依主辦方提供的資訊選擇立即匯款或稍後繳費；實際金額仍以通知為準。");
 const now=Date.now(),notYet=cfg?.openAt&&Date.parse(cfg.openAt)>now,ended=cfg?.closeAt&&Date.parse(cfg.closeAt)<now;
 el("submit").disabled=count<1||a<1||!el("event").value||!!notYet||!!ended;
 const windowNotice=notYet?"報名尚未開始，開放時間："+new Date(cfg.openAt).toLocaleString("zh-TW",{timeZone:"Asia/Taipei"}):ended?"報名已截止，截止時間："+new Date(cfg.closeAt).toLocaleString("zh-TW",{timeZone:"Asia/Taipei"}):"";
 el("summary").textContent+=(windowNotice?" "+windowNotice:"");
}
for(const id of ["adults","children","event"])el(id).addEventListener("change",summary);
el("students").addEventListener("change",summary);
async function load(){
 const [me,config,regs]=await Promise.all([api("me"),api("uniform-events/config"),api("uniform-events/family-registration")]);
 if(me.role!=="parent"){el("roleHelp").hidden=false;throw Error("目前角色為 "+(me.role||"未設定")+"，請先切換家長身分使用此頁面");}
 el("roleHelp").hidden=true;
 students=(me.students||[]).filter(x=>x.studentId);
 const active=(config.items||[]).filter(x=>x.enabled&&["fieldTrip","yearEndDinner"].includes(x.module));
 el("event").innerHTML="<option value=''>請選擇活動</option>"+active.map(x=>{
  const key=x.module+":"+x.id;events.set(key,x);return "<option value='"+escape(key)+"'>"+escape(x.title||x.module)+"</option>";
 }).join("");
 el("students").innerHTML="<strong>參加的弦樂團學生（至少勾選一位）</strong>"+students.map(x=>"<label><input type='checkbox' name='student' value='"+escape(x.studentId)+"'> "+escape(x.name||x.studentName||x.studentId)+"</label>").join("");
 if(!students.length)el("students").textContent="尚未綁定學生，無法報名";
 const rows=regs.items||[];
 el("registrations").innerHTML=rows.length?rows.map(x=>"<section><strong>"+escape(events.get(x.kind+":"+x.activityId)?.title||x.kind+" / "+x.activityId)+"</strong><p>團員 "+x.studentIds.length+" 位／大人 "+x.adults+" 位／其他兒童 "+x.extraChildren+" 位</p><p>報名："+escape(x.registrationStatus)+"　繳費："+escape(x.paymentStatus)+"</p></section>").join(""):"目前尚無報名紀錄";
 status("已載入 "+active.length+" 場開放活動、"+rows.length+" 筆家庭報名");
 summary();
}
el("registration").addEventListener("submit",async e=>{
 e.preventDefault();const ids=selected(),key=el("event").value;
 const cfg=events.get(key);if(!cfg||!ids.length||Number(el("adults").value)<1)return;
 if(!confirm("確定送出家庭報名？成功後將納入後台統計。"))return;
 try{
  await api("uniform-events/family-registration",{method:"POST",body:JSON.stringify({kind:cfg.module,activityId:cfg.id,studentIds:ids,adults:Number(el("adults").value),extraChildren:Number(el("children").value)})});
  status("報名成功，尚未繳費。");await load();
 }catch(err){status("報名失敗："+err.message)}
});
load().catch(e=>{status("讀取失敗："+e.message);el("roleHelp").hidden=false;el("submit").disabled=true});
