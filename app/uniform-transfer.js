const $=id=>document.getElementById(id);
const headers=()=>({"Content-Type":"application/json",...(sessionStorage.getItem("google_id_token")&&sessionStorage.getItem("google_id_token")!=="cookie-session"?{"X-Google-ID-Token":sessionStorage.getItem("google_id_token")}:{}),...(sessionStorage.getItem("school_context_id")?{"X-School-Id":sessionStorage.getItem("school_context_id")}:{}),...(sessionStorage.getItem("role_context")?{"X-Role-Context":sessionStorage.getItem("role_context")}: {})});
let due=null,etag=null;
async function api(path,options={}){const r=await fetch("/api/uniform-events/"+path,{credentials:"same-origin",cache:"no-store",headers:headers(),...options});const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||"HTTP "+r.status);return data}
const params=new URLSearchParams(location.search);if(params.get("requestId")){$("order").value=params.get("requestId");if(["regularUniform","competitionUniform"].includes(params.get("kind")))$("kind").value=params.get("kind");}
$("lookup").onclick=async()=>{due=null;etag=null;$("details").hidden=true;$("status").textContent="查詢中…";try{
 const requestId=$("order").value.trim(),kind=$("kind").value;
 const data=await api("uniform-payment-account?kind="+encodeURIComponent(kind)+"&requestId="+encodeURIComponent(requestId));
 if(!data.item)throw Error("此項目尚未設定收款帳戶");
 const req=await api("requests");const item=(req.items||[]).find(x=>x.id===requestId&&x.kind===kind);
 if(!item||!["APPROVED","ORDERED","ARRIVED","READY_FOR_PICKUP"].includes(item.status)||!Number.isSafeInteger(item.amount)||item.amount<=0)throw Error("申請單尚未完成金額核定");
 due=item.amount;etag=item.etag;
 const b=data.item;$("account").textContent="銀行："+b.bankName+"（"+b.bankCode+"）｜戶名："+b.accountHolder+"｜帳號："+b.accountNumber;
 $("amount").textContent="應繳金額：NT$ "+due.toLocaleString("zh-TW")+"｜狀態："+(data.paymentStatus||"待匯款");
 $("details").hidden=data.paymentStatus==="REPORTED_UNVERIFIED"||data.paymentStatus==="VERIFIED";
 $("status").textContent=$("details").hidden?"此筆已有匯款回報或已核帳，不可重複提交。":"請先完成匯款，再填寫後五碼";
}catch(e){$("status").textContent="查詢失敗："+e.message}};
$("submit").onclick=async()=>{if(due===null||!etag)return;const lastFive=$("lastFive").value.trim(),transferDate=$("date").value;if(!/^[0-9]{5}$/.test(lastFive)||!transferDate){$("status").textContent="請填寫匯款日期及正確的後五碼";return}if(!confirm("已完成匯款，確認回報後五碼？這不代表財務已核帳。"))return;
 $("submit").disabled=true;try{const data=await api("uniform-transfer-report",{method:"POST",body:JSON.stringify({requestId:$("order").value.trim(),amount:due,etag,lastFive,transferDate})});$("details").hidden=true;$("status").textContent=data.paymentStatus==="REPORTED_UNVERIFIED"?"已回報匯款，等待財務核帳":"已送出"}catch(e){$("status").textContent="回報失敗："+e.message}finally{$("submit").disabled=false}};
