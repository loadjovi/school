const $=id=>document.getElementById(id);
function headers(){const token=sessionStorage.getItem("google_id_token")||"",school=sessionStorage.getItem("school_context_id")||"",role=sessionStorage.getItem("role_context")||"";return {"Content-Type":"application/json",...(token&&token!=="cookie-session"?{"X-Google-ID-Token":token}:{}),...(school?{"X-School-Id":school}:{}),...(role?{"X-Role-Context":role}:{})}}
async function api(path,options={}){const r=await fetch("/api/"+path,{...options,credentials:"same-origin",cache:"no-store",headers:headers()});const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||"HTTP "+r.status);return data}
const line=(tag,value)=>{const el=document.createElement(tag);el.textContent=value;return el};
function reviewCard(item,type){
 const card=line("div","");card.className="item";
 const report=item.transferReport||{},amount=Number(report.amount||item.amount||0);
 card.append(line("strong",(type==="uniform"?(item.kind==="regularUniform"?"團 T":"A 團比賽服"):item.kind==="yearEndDinner"?"期末聚餐":"交流／快閃活動")+"｜"+(type==="uniform"?item.studentId:item.parentEmail)));
 const expected=type==="uniform"?item.amount:report.expectedAmount;
 const detail=line("div",`應繳 NT$ ${Number(expected||0).toLocaleString("zh-TW")}｜回報 NT$ ${amount.toLocaleString("zh-TW")}｜家長回報匯款日期 ${report.transferDate||"未提供"}｜匯出帳號末五碼 ${report.lastFive||"未提供"}`);detail.className="details";card.append(detail);
 const form=document.createElement("form"),dateLabel=line("label","銀行實際入帳日期"),date=document.createElement("input");date.type="date";date.required=true;dateLabel.append(date);
 const noteLabel=line("label","核帳備註（請記錄銀行查核依據）"),note=document.createElement("textarea");note.required=true;note.maxLength=300;note.rows=2;noteLabel.append(note);
 const button=line("button","確認已入帳"),status=line("p","");button.type="submit";status.setAttribute("role","status");form.append(dateLabel,noteLabel,button,status);card.append(form);
 if(!Number.isSafeInteger(expected)||expected<=0||amount!==expected){button.disabled=true;status.textContent="回報與應繳金額不同，請先查明差額，不可直接核帳。"}
 form.addEventListener("submit",async e=>{e.preventDefault();if(!confirm("已比對銀行入帳日期、金額及末五碼，確認這筆款項已實際入帳？"))return;button.disabled=true;status.textContent="核帳中…";try{
  if(type==="uniform")await api("uniform-events/uniform-transfer-report",{method:"PATCH",body:JSON.stringify({requestId:item.id,etag:item.etag,amount,bankPostedAt:date.value,note:note.value.trim()})});
  else await api("uniform-events/family-registration",{method:"PATCH",body:JSON.stringify({kind:item.kind,activityId:item.activityId,registrationId:item.id,action:"VERIFY_PAYMENT",amount,bankPostedAt:date.value,note:note.value.trim()})});
  status.textContent="已確認入帳";await load();
 }catch(error){status.textContent="核帳失敗："+error.message;button.disabled=false}});
 return card;
}
async function load(){try{
 const [uniform,family]=await Promise.all([api("uniform-events/requests"),api("uniform-events/family-registration")]);
 const u=(uniform.items||[]).filter(x=>x.paymentStatus==="REPORTED_UNVERIFIED"),f=(family.items||[]).filter(x=>x.paymentStatus==="REPORTED_UNVERIFIED");
 $("uniformRows").replaceChildren(...(u.length?u.map(x=>reviewCard(x,"uniform")):[line("p","目前沒有待核對的團服匯款。")]));
 $("familyRows").replaceChildren(...(f.length?f.map(x=>reviewCard(x,"family")):[line("p","目前沒有待核對的活動匯款。")]));
 $("status").textContent=`待核帳：團服 ${u.length} 筆、活動 ${f.length} 筆。`;
 }catch(e){$("status").textContent="載入失敗："+e.message;$("status").className="error"}
}
$("reload").onclick=load;
try{const me=await api("me");if(me.role!=="admin"||me.capabilities?.financeVerifier!==true)throw Error("此帳號尚未被指派此校財務權限。請由 Global 管理中心指定後重新登入。");$("financeContent").hidden=false;await load()}catch(e){$("status").textContent=e.message;$("status").className="error"}
