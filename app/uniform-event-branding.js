// 同步所屬學校「系統品牌設定」的 primaryColor；不建立第二份團服色彩設定。
const DEFAULT="#245C49";
function rgb(hex){const n=parseInt(hex.slice(1),16);return [(n>>16)&255,(n>>8)&255,n&255]}
function hex(a){return "#"+a.map(n=>Math.round(n).toString(16).padStart(2,"0")).join("")}
function mix(a,b,t){const x=rgb(a),y=rgb(b);return hex(x.map((v,i)=>v*(1-t)+y[i]*t))}
function luminance(color){const x=rgb(color).map(n=>{const v=n/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return x[0]*.2126+x[1]*.7152+x[2]*.0722}
function contrast(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)}
function safePrimary(color){if(!/^#[0-9a-fA-F]{6}$/.test(String(color||"")))return DEFAULT;let c=color;for(let i=0;i<20&&contrast(c,"#ffffff")<4.5;i++)c=mix(c,"#000000",.12);return c}
function apply(color){
 const primary=safePrimary(color),root=document.documentElement;
 root.style.setProperty("--tenant-primary",primary);
 root.style.setProperty("--tenant-primary-dark",mix(primary,"#000000",.2));
 root.style.setProperty("--tenant-primary-soft",mix(primary,"#ffffff",.91));
 root.style.setProperty("--tenant-primary-text",mix(primary,"#000000",.5));
 root.style.setProperty("--tenant-focus",mix(primary,"#000000",.25));
}
async function loadTheme(){
 const schoolId=String(sessionStorage.getItem("school_context_id")||"").trim();
 const qs=new URLSearchParams();if(schoolId)qs.set("schoolId",schoolId);
 try{
  const r=await fetch("/api/branding?"+qs.toString(),{credentials:"same-origin",cache:"no-store"});
  if(!r.ok)throw Error("HTTP "+r.status);
  const data=await r.json();apply(data.primaryColor);
 }catch(e){apply(DEFAULT);console.warn("學校品牌色彩讀取失敗，使用預設主題",e)}
}
loadTheme();
