(()=>{
  const DEFAULTS={siteName:"聖心小學弦樂團",schoolName:"輔大聖心國小",loginSubtitle:"家長、老師與管理員共用入口",logoAlt:"聖心 Logo",primaryColor:"#245C49",logoUrl:"/api/branding-logo?schoolId=sacred-heart&v=default",updatedAt:""};
  const GLOBAL_DEFAULTS={siteName:"校務整合平台",schoolName:"Global 管理中心",loginSubtitle:"跨校營運、權限與服務治理",logoAlt:"Global Logo",primaryColor:"#3155A4",logoUrl:"/api/global-branding-logo?v=default",updatedAt:""};
  function activeSchoolId(){return String(state.me?.schoolId||sessionStorage.getItem("school_context_id")||"").trim()}
  function tenantDefaults(){
    const sid=activeSchoolId();
    if(!sid||sid==="sacred-heart")return DEFAULTS;
    const schoolName=String(state.me?.schoolName||"學校"),siteName=String(state.me?.systemName||schoolName+" 弦樂團");
    return {...DEFAULTS,siteName,schoolName,logoAlt:schoolName+" Logo",primaryColor:"#3155A4",logoUrl:"/api/branding-logo?schoolId="+encodeURIComponent(sid)+"&v=default"};
  }
  state.branding={...tenantDefaults(),...(state.branding||{})};
  state.globalBranding={...GLOBAL_DEFAULTS,...(state.globalBranding||{})};
  state.brandingAdmin=state.brandingAdmin||{loading:false,error:""};
  let selectedLogoFile=null,previewObjectUrl="";

  function brand(){return state.me?.role==="globalAdmin"?{...GLOBAL_DEFAULTS,...(state.globalBranding||{})}:{...tenantDefaults(),...(state.branding||{})}}
  function hexRgb(hex){
    const m=/^#([0-9a-f]{6})$/i.exec(String(hex||""));if(!m)return null;
    const n=parseInt(m[1],16);return [(n>>16)&255,(n>>8)&255,n&255];
  }
  function mix(hex,target,amount){
    const a=hexRgb(hex),b=hexRgb(target);if(!a||!b)return hex;
    const x=a.map((v,i)=>Math.round(v+(b[i]-v)*amount));
    return `#${x.map(v=>v.toString(16).padStart(2,"0")).join("")}`;
  }
  function patchShellBrand(){
    const b=brand(),top=document.querySelector(".top");if(!top)return;
    const brandEl=top.querySelector(".brand");
    if(brandEl){
      brandEl.innerHTML=`<span style="width:42px;height:42px;border-radius:10px;background:#fff;display:inline-flex;align-items:center;justify-content:center;overflow:hidden;flex:0 0 42px">${logoImg("","style=\"width:40px;height:40px;object-fit:contain;display:block\"")}</span><span>${esc(b.siteName||DEFAULTS.siteName)}</span>`;
    }
    let sub=top.querySelector(":scope > .sub");
    if(b.schoolName){
      if(!sub){sub=document.createElement("div");sub.className="sub";brandEl?.insertAdjacentElement("afterend",sub)}
      if(sub)sub.textContent=b.schoolName;
    }else if(sub)sub.remove();
  }
  function applyTheme(){
    const b=brand(),color=/^#[0-9A-Fa-f]{6}$/.test(String(b.primaryColor||""))?b.primaryColor:DEFAULTS.primaryColor;
    const root=document.documentElement;
    root.style.setProperty("--green",color);
    root.style.setProperty("--green2",mix(color,"#000000",.16));
    root.style.setProperty("--mint",mix(color,"#ffffff",.91));
    root.style.setProperty("--text",mix(color,"#000000",.52));
    const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.setAttribute("content",color);
    document.title=b.siteName||DEFAULTS.siteName;
    patchShellBrand();
  }
  function logoImg(cls="",extra=""){const b=brand();return `<img class="${cls}" src="${esc(b.logoUrl)}" alt="${esc(b.logoAlt||"學校 Logo")}" ${extra} onerror="this.style.display='none';this.parentElement?.classList?.add('logo-fallback')">`}
  function patchLogin(){
    const card=document.querySelector(".login-card");if(!card)return;
    const b=brand(),logo=card.querySelector(".logo"),h1=card.querySelector("h1"),p=card.querySelector("p");
    if(logo){logo.style.width="92px";logo.style.height="92px";logo.style.borderRadius="20px";logo.style.background="transparent";logo.style.overflow="hidden";logo.style.padding="0";logo.innerHTML=logoImg("","style=\"width:100%;height:100%;object-fit:contain;display:block\"")}
    if(h1)h1.textContent=b.siteName;
    if(p)p.textContent=b.loginSubtitle||"";
  }
  async function loadBranding(){
    try{
      const sid=activeSchoolId(),qs=new URLSearchParams({_:String(Date.now())});if(sid)qs.set("schoolId",sid);
      const r=await fetch("/api/branding?"+qs.toString(),{cache:"no-store"});
      if(!r.ok)throw new Error(`HTTP ${r.status}`);
      state.branding={...tenantDefaults(),...await r.json()};state.brandingAdmin.error="";
    }catch(e){state.brandingAdmin.error=e.message||String(e);state.branding={...tenantDefaults(),...(state.branding||{})}}
    applyTheme();patchLogin();patchShellBrand();return state.branding;
  }
  window.reloadBranding=loadBranding;
  window.applyActiveBranding=function(){applyTheme();return brand()};
  window.setGlobalBranding=function(v){state.globalBranding={...GLOBAL_DEFAULTS,...(v||{})};applyTheme();return state.globalBranding};
  window.previewBrandingColor=function(value){
    if(!/^#[0-9A-Fa-f]{6}$/.test(String(value||"")))return;
    state.branding={...tenantDefaults(),...brand(),primaryColor:value};applyTheme();
  };

  const baseRenderLogin=renderLogin;
  renderLogin=async function(error=""){
    const r=await baseRenderLogin(error);applyTheme();patchLogin();return r;
  };

  const baseShell=shell;
  shell=function(content){
    const b=brand();
    let html=baseShell(content);
    const replacement=`<div class="brand" style="display:flex;align-items:center;gap:9px"><span style="width:42px;height:42px;border-radius:10px;background:#fff;display:inline-flex;align-items:center;justify-content:center;overflow:hidden;flex:0 0 42px">${logoImg("","style=\"width:40px;height:40px;object-fit:contain;display:block\"")}</span><span>${esc(b.siteName)}</span></div>${b.schoolName?`<div class="sub">${esc(b.schoolName)}</div>`:""}`;
    const brandAndSub=/<div class="brand"[^>]*>[\s\S]*?<\/div><div class="sub"[^>]*>[\s\S]*?<\/div>/;
    if(brandAndSub.test(html))html=html.replace(brandAndSub,replacement);
    else{
      const brandOnly=/<div class="brand"[^>]*>[\s\S]*?<\/div>/;
      if(brandOnly.test(html))html=html.replace(brandOnly,replacement);
    }
    return html;
  };

  function readAsDataUrl(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onerror=()=>reject(new Error("讀取 Logo 失敗"));r.onload=()=>resolve(String(r.result||""));r.readAsDataURL(file)})}
  window.previewBrandingLogo=function(input){
    const f=input?.files?.[0];selectedLogoFile=null;
    if(previewObjectUrl){URL.revokeObjectURL(previewObjectUrl);previewObjectUrl=""}
    if(!f)return;
    if(!["image/png","image/jpeg","image/webp"].includes(f.type)){input.value="";toast("❌ Logo 只支援 PNG、JPG、WebP");return}
    if(f.size>2*1024*1024){input.value="";toast("❌ Logo 檔案需小於 2MB");return}
    selectedLogoFile=f;previewObjectUrl=URL.createObjectURL(f);
    const img=document.getElementById("brandingPreview");if(img)img.src=previewObjectUrl;
  };
  window.saveBrandingAdmin=async function(){
    if(state.brandingAdmin.loading)return;
    // 先讀取使用者目前輸入值，再切換 loading 畫面。
    // 舊流程會先 mountBrandingAdmin()，因此把尚未儲存的名稱重畫成舊值後才送 API。
    const payload={
      siteName:String(document.getElementById("brandSiteName")?.value||"").trim(),
      schoolName:String(document.getElementById("brandSchoolName")?.value||"").trim(),
      loginSubtitle:String(document.getElementById("brandSubtitle")?.value||"").trim(),
      logoAlt:String(document.getElementById("brandLogoAlt")?.value||"").trim(),
      primaryColor:document.getElementById("brandColor")?.value||DEFAULTS.primaryColor
    };
    if(!payload.siteName){toast("❌ 網站名稱不可空白");return}
    if(!payload.schoolName){toast("❌ 學校名稱不可空白");return}
    state.brandingAdmin.loading=true;state.brandingAdmin.error="";mountBrandingAdmin();
    try{
      const saved=await api("/api/branding",{method:"PATCH",body:JSON.stringify(payload)});
      if(String(saved?.siteName||"").trim()!==payload.siteName||String(saved?.schoolName||"").trim()!==payload.schoolName){
        throw new Error("品牌名稱儲存驗證失敗，請重新操作");
      }
      state.branding={...tenantDefaults(),...state.branding,...saved};applyTheme();patchLogin();patchShellBrand();
      if(selectedLogoFile){
        const dataUrl=await readAsDataUrl(selectedLogoFile);
        await api("/api/branding-logo",{method:"POST",body:JSON.stringify({dataUrl})});
      }
      const fresh=await loadBranding();
      if(String(fresh?.siteName||"").trim()!==payload.siteName){
        throw new Error("品牌設定已送出，但重新讀取仍不是新名稱");
      }
      selectedLogoFile=null;if(previewObjectUrl){URL.revokeObjectURL(previewObjectUrl);previewObjectUrl=""}
      render();patchShellBrand();
      toast("✅ 已更新網站名稱："+payload.siteName);
    }catch(e){state.brandingAdmin.error=e.message||String(e);toast("❌ "+(e.message||e))}
    state.brandingAdmin.loading=false;mountBrandingAdmin();
  };
  window.restoreDefaultBrandingLogo=async function(){
    if(!confirm("確定要恢復此校的系統預設 Logo？"))return;
    state.brandingAdmin.loading=true;mountBrandingAdmin();
    try{await api("/api/branding-logo",{method:"DELETE"});await loadBranding();toast("✅ 已恢復預設 Logo");render()}catch(e){state.brandingAdmin.error=e.message||String(e);toast("❌ "+(e.message||e))}
    state.brandingAdmin.loading=false;mountBrandingAdmin();
  };

  function mountBrandingAdmin(){
    if(state.me?.role!=="admin"||state.page!=="admin")return;
    const main=document.querySelector(".main");if(!main)return;
    let root=document.getElementById("brandingAdminPanel");if(!root){root=document.createElement("div");root.id="brandingAdminPanel";main.prepend(root)}
    const b=brand();
    root.innerHTML=`<div class="card"><h2>🎨 系統品牌設定</h2><div class="notice">首頁名稱、學校名稱、Logo 與主題色都由後台管理。主題色選擇時會立即預覽，按儲存後登入頁與登入後頁首會同步套用。</div>${state.brandingAdmin.error?`<div class="error" style="margin-top:10px">${esc(state.brandingAdmin.error)}</div>`:""}<div style="display:flex;gap:14px;align-items:center;margin-top:14px"><div style="width:92px;height:92px;border:1px solid var(--line);border-radius:18px;background:#fff;display:grid;place-items:center;overflow:hidden"><img id="brandingPreview" src="${esc(b.logoUrl)}" alt="${esc(b.logoAlt)}" style="width:88px;height:88px;object-fit:contain"></div><div style="flex:1"><b>目前 Logo</b><small style="display:block;color:var(--muted);margin-top:4px">PNG／JPG／WebP，最大 2MB</small><input type="file" accept="image/png,image/jpeg,image/webp" onchange="previewBrandingLogo(this)" ${state.brandingAdmin.loading?"disabled":""}></div></div><label>網站名稱</label><input id="brandSiteName" value="${esc(b.siteName)}" maxlength="80"><label>學校名稱</label><input id="brandSchoolName" value="${esc(b.schoolName)}" maxlength="120"><label>登入頁說明文字</label><input id="brandSubtitle" value="${esc(b.loginSubtitle)}" maxlength="160"><div class="row2"><div><label>Logo 替代文字</label><input id="brandLogoAlt" value="${esc(b.logoAlt)}" maxlength="120"></div><div><label>主題色（即時預覽）</label><input id="brandColor" type="color" value="${esc(/^#[0-9A-Fa-f]{6}$/.test(b.primaryColor)?b.primaryColor:DEFAULTS.primaryColor)}" style="height:48px;padding:6px" oninput="previewBrandingColor(this.value)"></div></div><button class="primary" onclick="saveBrandingAdmin()" ${state.brandingAdmin.loading?"disabled":""}>${state.brandingAdmin.loading?"正在儲存…":"💾 儲存品牌設定"}</button><button class="secondary" style="width:100%;margin-top:8px" onclick="restoreDefaultBrandingLogo()" ${state.brandingAdmin.loading?"disabled":""}>↩️ 恢復此校預設 Logo</button><div class="notice" style="margin-top:10px">系統會自動使用 <b>SystemSettings / SYSTEM / BRANDING</b> 保存文字與主題色設定；Logo 存在同一個 Azure Storage Account 的 <b>branding</b> Blob Container。</div></div>`;
  }

  const baseRender=render;
  render=function(){const r=baseRender();applyTheme();patchShellBrand();if(state.me?.role==="admin"&&state.page==="admin")setTimeout(mountBrandingAdmin,0);return r};
  loadBranding();
  if(state.me?.role==="admin"&&state.page==="admin")setTimeout(mountBrandingAdmin,0);
})();