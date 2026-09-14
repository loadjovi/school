(()=>{
  const ua=navigator.userAgent||"";
  const isIOS=/iPhone|iPad|iPod/i.test(ua);
  const isAndroid=/Android/i.test(ua);
  const isLine=/\bLine\//i.test(ua);
  const isSocial=/FBAN|FBAV|Instagram|MicroMessenger|Twitter|Messenger/i.test(ua);
  const isIOSWebView=isIOS&&/AppleWebKit/i.test(ua)&&!/Safari/i.test(ua);
  const isAndroidWebView=isAndroid&&(/;\s*wv\)/i.test(ua)||/\bwv\b/i.test(ua));
  const embedded=isLine||isSocial||isIOSWebView||isAndroidWebView;

  function cleanUrl(){
    const u=new URL(location.href);
    u.searchParams.delete("openExternalBrowser");
    u.searchParams.delete("openInAppBrowser");
    return u.toString();
  }
  function lineExternalUrl(){
    const u=new URL(cleanUrl());
    u.searchParams.set("openExternalBrowser","1");
    return u.toString();
  }
  window.copyOrchestraUrl=async()=>{
    const url=cleanUrl();
    try{await navigator.clipboard.writeText(url);alert("網址已複製，請貼到 Safari 或 Chrome 開啟。")}
    catch{
      const t=document.createElement("textarea");t.value=url;document.body.appendChild(t);t.select();document.execCommand("copy");t.remove();alert("網址已複製，請貼到 Safari 或 Chrome 開啟。");
    }
  };

  if(embedded){
    const platform=isIOS?"Safari":isAndroid?"Chrome":"外部瀏覽器";
    const action=isLine
      ?`<a class="primary" style="display:block;text-align:center;text-decoration:none" href="${lineExternalUrl()}">用 ${platform} 開啟</a>`
      :`<button class="primary" onclick="copyOrchestraUrl()">複製網址，用 ${platform} 開啟</button>`;
    document.getElementById("app").innerHTML=`
      <div class="login-wrap"><div class="login-card">
        <div class="logo">🎻</div>
        <h1>聖心小學弦樂團</h1>
        <p>Google Gmail 登入</p>
        <div class="error" style="margin-top:16px"><b>目前是在 App 內建瀏覽器中開啟</b><br><br>Google 為保護帳號，不支援在 LINE、Facebook、Instagram 等內建 WebView 進行登入，因此可能只看到白畫面。</div>
        <div class="notice" style="margin-top:12px">請改用 <b>${platform}</b> 開啟本系統，再按「使用 Google 帳戶登入」。${isLine?"<br><br>下方按鈕會要求 LINE 改用外部瀏覽器開啟。":""}</div>
        ${action}
        <button class="secondary" style="width:100%;margin-top:10px" onclick="copyOrchestraUrl()">複製網站網址</button>
      </div></div>`;
    return;
  }

  const app=document.createElement("script");
  app.src="/app-v3.js";app.defer=true;
  app.onload=()=>{const b=document.createElement("script");b.src="/batch-upgrade.js";b.defer=true;document.body.appendChild(b)};
  document.body.appendChild(app);
})();
