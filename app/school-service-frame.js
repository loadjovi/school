// Keep supported tools inside the already authenticated school workspace.
(()=>{
 const query=new URLSearchParams(location.search),service=query.get('workspaceService'),schoolId=query.get('workspaceSchool');
 const frameIds={line:'awLineServiceFrame',fees:'awFeesServiceFrame',finance:'awFinanceServiceFrame'};
 let embedded=false;
 try{
  embedded=query.get('embedded')==='school'&&!!frameIds[service]&&window.parent!==window&&window.frameElement?.id===frameIds[service]&&window.parent.location.origin===location.origin&&/^[a-z0-9-]{2,60}$/.test(schoolId||'')&&sessionStorage.getItem('school_context_id')===schoolId;
 }catch{}
 if(!embedded)return;
 const activityPattern=/^(calendarActivity|fieldTrip|yearEndDinner):[A-Za-z0-9_-]{1,80}$/;
 document.documentElement.classList.add('school-service-embedded');
 document.documentElement.dataset.workspaceService=service;
 if(service==='line'&&activityPattern.test(query.get('fromActivity')||'')&&query.get('activitySchool')===schoolId)document.documentElement.classList.add('school-service-activity-return');

 document.addEventListener('click',event=>{
  if(event.defaultPrevented||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||event.button!=null&&event.button!==0)return;
  const link=event.target.closest?.('a[href]');
  if(!link||link.hasAttribute('download')||String(link.target||'').toLowerCase()==='_blank')return;
  let url;try{url=new URL(link.href,location.href)}catch{return}
  if(url.origin!==location.origin)return;
  const root=['/','/index.html'].includes(url.pathname),known=service==='line'?['backLink','returnActivityAfterSend'].includes(link.id):(service==='finance'?link.id==='uniformPlatformBack':link.id==='feePlatformBack');
  let activity;
  if(root&&url.searchParams.has('adminActivity')){
   activity=url.searchParams.get('adminActivity');
   if(service!=='line'||!activityPattern.test(activity||'')||url.searchParams.get('activitySchool')!==schoolId)return;
  }else if(known&&url.pathname==='/uniform-event-admin.html'){
   activity=url.searchParams.get('activity');
   if(service!=='line'||!activityPattern.test(activity||'')||url.searchParams.get('activitySchool')!==schoolId)return;
  }else if(!root)return;
  event.preventDefault();
  window.parent.postMessage({type:'school-service-return',service,schoolId,...(activity?{activity}:{})},location.origin);
 },true);

 const ready=()=>{
  const main=document.querySelector('main');
  let queued=false,lastHeight=0;
  const sendHeight=()=>{
   queued=false;
   // The document's scrollHeight is at least the iframe viewport, so it cannot
   // detect a collapsed preview. Measure the natural content instead.
   const rect=(main||document.body).getBoundingClientRect();
   if(rect.bottom<=0)return; // A hidden workspace must retain its last useful height.
   const height=Math.max(200,Math.ceil(rect.bottom+(window.scrollY||0)+2));
   if(!Number.isFinite(height)||height===lastHeight)return;
   lastHeight=height;
   window.parent.postMessage({type:'school-service-height',service,schoolId,height},location.origin);
  };
  const schedule=()=>{if(queued)return;queued=true;window.requestAnimationFrame(sendHeight)};
  if(typeof ResizeObserver==='function')new ResizeObserver(schedule).observe(main||document.body);
  window.addEventListener('resize',schedule);window.addEventListener('load',schedule);schedule();
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready,{once:true});else ready();
})();
