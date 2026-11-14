(()=>{
"use strict";
let status=null,busy=false,message="";
const escape=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));

async function request(method="GET"){
  const headers={};
  const token=String(state?.token||"");
  if(token)headers["X-Google-ID-Token"]=token;
  const roleContext=String(sessionStorage.getItem("role_context")||""),schoolId=String(sessionStorage.getItem("school_context_id")||"");
  if(roleContext)headers["X-Role-Context"]=roleContext;
  if(schoolId)headers["X-School-Id"]=schoolId;
  const response=await fetch("/api/line/lab-rich-menus",{method,headers,credentials:"same-origin"});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(body.error||`HTTP ${response.status}`);
  return body;
}

function host(){return document.getElementById("adminOperations")||document.querySelector(".main")}
function mount(){
  if(state?.me?.role!=="admin"||state?.page!=="admin")return;
  const root=host();if(!root)return;
  let panel=document.getElementById("labRichMenuAdmin");
  if(!panel){panel=document.createElement("section");panel.id="labRichMenuAdmin";panel.className="card";root.append(panel)}
  panel.innerHTML=`<h2>🧪 LAB LINE 角色選單</h2>
    <div class="notice">只建立家長／幹部個人選單，不會取代目前 OA Manager 的未綁定通用選單，也不會套用至其他家長。</div>
    <p>${status?.configured?"✅ 家長與幹部選單已建立，選單 ID 已保存在 LAB。":"尚未建立兩組 Messaging API 個人選單。"}</p>
    ${status?.updatedAt?`<p class="muted">最後設定：${escape(new Date(status.updatedAt).toLocaleString("zh-TW"))}</p>`:""}
    ${message?`<div class="notice">${escape(message)}</div>`:""}
    <button type="button" class="primary" id="labRichMenuSetup" ${busy||status?.configured?"disabled":""}>${busy?"建立中…":status?.configured?"已完成建立":"建立兩組 LAB 角色選單"}</button>`;
  panel.querySelector("#labRichMenuSetup")?.addEventListener("click",setup);
}

async function load(){try{status=await request();message=""}catch(error){message=error.message}mount()}
async function setup(){
  if(busy||!confirm("將在目前 LINE 官方帳號建立兩組 LAB 個人選單，並只嘗試套用至 Roy 白名單帳號。確定繼續？"))return;
  busy=true;message="";mount();
  try{
    const result=await request("POST");status=result;
    message=result.assigned?`已建立並套用「${result.audience==="staff"?"幹部":"家長"}選單」至 Roy LAB 帳號。`:`兩組選單已建立；目前帳號尚未符合個人選單指派條件。`;
  }catch(error){message=error.message}finally{busy=false;mount()}
}

function install(){
  if(typeof state==="undefined"||typeof render!=="function")return false;
  const base=render;render=function(){const result=base();setTimeout(()=>{mount();if(state?.me?.role==="admin"&&state?.page==="admin"&&status===null)load()},0);return result};
  mount();if(state?.me?.role==="admin"&&state?.page==="admin")load();return true;
}
let attempts=0,timer=setInterval(()=>{attempts++;if(install()||attempts>400)clearInterval(timer)},25);
})();
