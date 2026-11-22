// The school workspace owns the application shell. This document contains only its tools.
(()=>{
 const query=new URLSearchParams(location.search);
 if(query.get('workspaceService')==='finance')return;
 let inWorkspace=false;
 try{inWorkspace=window.parent!==window&&window.frameElement?.id==='awUniformFrame'}catch{}
 const embedded=query.get('embedded')==='school'||inWorkspace;
 if(!embedded)return;
 document.documentElement.classList.add('school-embedded');
 const returnToWorkspace=()=>window.parent.postMessage({type:'school-uniform-return'},location.origin);
 // Cover old cached root links too; downloads and links to other tools keep their own behavior.
 document.addEventListener('click',event=>{
  const link=event.target.closest?.('a[href]');
  if(!link||link.hasAttribute('download'))return;
  let url;try{url=new URL(link.href,location.href)}catch{return}
  if(url.origin!==location.origin||!['/','/index.html'].includes(url.pathname))return;
  if(window.parent===window)return;
  event.preventDefault();returnToWorkspace();
 },true);
 const ready=()=>{
  const back=document.getElementById('uniformPlatformBack');
  if(back){back.hidden=true;back.target='_top'}
  const send=()=>{
   const height=Math.max(document.body.scrollHeight,document.documentElement.scrollHeight);
   if(window.parent!==window)window.parent.postMessage({type:'school-uniform-height',height},location.origin);
  };
  if(typeof ResizeObserver==='function')new ResizeObserver(send).observe(document.body);
  window.addEventListener('load',send);send();
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready,{once:true});else ready();
})();
