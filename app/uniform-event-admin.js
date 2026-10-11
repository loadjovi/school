const el=id=>document.getElementById(id);
async function api(path,options={}){const r=await fetch("/api/"+path,{credentials:"same-origin",headers:{"Content-Type":"application/json"},...options});const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||"HTTP "+r.status);return data}
let cachedRequests=[],cachedStock=[];
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function show(id,data){el(id).textContent=JSON.stringify(data,null,2)}
function table(id,rows,columns,actions=false){
 const header=columns.map(([key,label])=>"<th>"+esc(label)+"</th>").join("");
 const body=rows.map((r,i)=>"<tr>"+columns.map(([key])=>"<td>"+esc(r[key])+"</td>").join("")+(actions?"<td><select data-index='"+i+"'><option value=''>選擇操作</option><option value='APPROVED'>核准</option><option value='CANCELLED'>取消</option><option value='PENDING'>待處理</option></select><button type='button' data-update='"+i+"'>更新</button></td>":"")+"</tr>").join("");
 el(id).innerHTML=rows.length?"<table><thead><tr>"+header+(actions?"<th>狀態管理</th>":"")+"</tr></thead><tbody>"+body+"</tbody></table>":"<p>目前沒有資料</p>";
}
function csv(name,rows,keys){
 const cell=v=>'"'+String(v??"").replace(/"/g,'""')+'"';
 const content="\uFEFF"+[keys.join(","),...rows.map(row=>keys.map(k=>cell(row[k])).join(","))].join("\r\n");
 const blob=new Blob([content],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");
 a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),500);
}
async function load(){const values=await Promise.all([api("uniform-events/config"),api("uniform-events/requests"),api("uniform-events/inventory")]);show("settings",values[0]);
 cachedRequests=values[1].items||[];cachedStock=values[2].items||[];
 const counts=cachedRequests.reduce((a,x)=>(a[x.status]=(a[x.status]||0)+1,a),{});
 el("requestSummary").textContent="申請共 "+cachedRequests.length+" 筆；待處理 "+(counts.PENDING||0)+" 筆；核准 "+(counts.APPROVED||0)+" 筆";
 table("requests",cachedRequests,[["studentId","學生ID"],["kind","項目"],["size","尺寸"],["status","狀態"],["createdAt","建立時間"]],true);
 table("stock",cachedStock,[["key","類別與尺寸"],["onHand","現有"],["reserved","保留"],["unavailable","不可用"]])}
async function start(){try{const me=await api("me");if(me.role!=="admin")throw Error("僅限管理員");el("status").textContent="已驗證管理員："+(me.displayName||me.email||"");await load()}catch(e){el("status").textContent=e.message;el("config").querySelector("button").disabled=true}}
el("reload").onclick=()=>load().catch(e=>el("status").textContent=e.message);
el("config").onsubmit=async e=>{e.preventDefault();try{const f=new FormData(e.target);const module=f.get("module");const item={module,id:String(f.get("id")),enabled:f.get("enabled")==="true"};for(const key of ["openAt","closeAt"])if(f.get(key))item[key]=new Date(f.get(key)).toISOString();if(["fieldTrip","yearEndDinner"].includes(module)){item.title=String(f.get("title"));item.location=String(f.get("location"));if(f.get("startAt"))item.startAt=new Date(f.get("startAt")).toISOString();for(const key of ["studentFee","firstAdultFee","extraAdultFee","extraChildFee"])item[key]=Number(f.get(key)||0)}if(!confirm("確定儲存設定？"))return;await api("uniform-events/config",{method:"POST",body:JSON.stringify(item)});await load();el("status").textContent="設定已儲存"}catch(e){el("status").textContent="儲存失敗："+e.message}};
start();
el("requests").addEventListener("click",async e=>{
 const i=e.target.dataset.update;if(i===undefined)return;
 const row=cachedRequests[Number(i)],select=el("requests").querySelector("select[data-index='"+i+"']");
 const status=select?.value;if(!row||!status)return;
 if(!confirm("確定將這筆申請改為 "+status+"？"))return;
 try{await api("uniform-events/requests",{method:"PATCH",body:JSON.stringify({id:row.id,etag:row.etag,status})});await load();el("status").textContent="申請狀態已更新"}
 catch(err){el("status").textContent="更新失敗："+err.message}
});
el("inventoryForm").onsubmit=async e=>{
 e.preventDefault();const f=new FormData(e.target),type=String(f.get("type")),style=String(f.get("style"));
 const data={type,style,size:String(f.get("size")),action:String(f.get("action")),amount:Number(f.get("amount"))};
 if(type==="competitionUniform"&&!style){el("status").textContent="比賽服必須選男款或女款";return}
 if(!Number.isSafeInteger(data.amount)||data.amount===0){el("status").textContent="數量須為非零整數";return}
 if(!confirm("庫存操作將寫入資料庫，確認已核對實體數量？"))return;
 try{await api("uniform-events/inventory",{method:"POST",body:JSON.stringify(data)});await load();el("status").textContent="庫存已更新"}
 catch(err){el("status").textContent="庫存更新失敗："+err.message}
};
el("exportRequests").onclick=()=>csv("uniform-event-requests.csv",cachedRequests,["id","kind","studentId","activityId","style","size","quantity","acquisition","freeEligibility","status","createdAt","updatedAt"]);
el("exportStock").onclick=()=>csv("uniform-inventory.csv",cachedStock,["key","onHand","reserved","unavailable"]);
