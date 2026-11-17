(()=>{
 const modules=new Set(["fieldTrip","yearEndDinner","calendarActivity"]);
 const registrationModules=new Set(["fieldTrip","yearEndDinner"]);
 const today=()=>new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Taipei"});
 const day=value=>{if(!value)return "";const d=new Date(value);return Number.isNaN(d.getTime())?"":d.toLocaleDateString("sv-SE",{timeZone:"Asia/Taipei"})};
 const group=value=>{const name=String(value||"").trim().replace(/團$/ ,"").toUpperCase();return name==="儲備"||name==="預備"?"C":name};
 const key=item=>String(item.module)+":"+String(item.id);
 const version=item=>String(item.updatedAt||item.eventDate||item.startAt||item.id);
 function scope(me,students){
  const school=sessionStorage.getItem("school_context_id")||"sacred-heart";
  const who=String(me?.email||me?.parentEmail||"").trim().toLowerCase()||(students||[]).map(x=>x.studentId).sort().join(",");
  return "parent-activity-seen:"+school+":"+who;
 }
 function read(me,students){try{return JSON.parse(localStorage.getItem(scope(me,students))||"{}")||{}}catch{return {}}}
 function eligible(items,students,currentDay=today()){
  const groups=new Set((students||[]).map(x=>group(x.groupName||x.group)).filter(Boolean));
  return (items||[]).filter(x=>{
   if(!x.enabled||!modules.has(x.module)||(x.module==="yearEndDinner"&&x.feeStatus!=="PUBLISHED"))return false;
   const target=String(x.targetGroups||"ALL").split(",").map(group);
   if(!target.includes("ALL")&&!target.some(g=>groups.has(g)))return false;
   const end=x.module==="calendarActivity"?(x.endDate||x.eventDate):day(x.endAt||x.startAt);
   return end>=currentDay;
  });
 }
 function unseen(items,me,students){const seen=read(me,students);return eligible(items,students).filter(x=>seen[key(x)]!==version(x)).sort((a,b)=>String(b.updatedAt||"").localeCompare(String(a.updatedAt||""))||String(a.eventDate||a.startAt||"").localeCompare(String(b.eventDate||b.startAt||"")));}
 function registrationOpen(item,now=Date.now()){
  return (!item.openAt||Date.parse(item.openAt)<=now)&&(!item.closeAt||Date.parse(item.closeAt)>now);
 }
 function registrationTasks(items,registrations,students,now=Date.now()){
  if(!Array.isArray(registrations))return [];
  const active=(students||[]).filter(student=>student?.studentId&&student.status!=="inactive");
  if(!active.length)return [];
  const registered=new Set(registrations.map(item=>item.kind+":"+item.activityId));
  const today=new Date(now).toLocaleDateString("sv-SE",{timeZone:"Asia/Taipei"});
  return eligible(items,active,today).filter(item=>registrationModules.has(item.module)&&item.id&&
   !registered.has(key(item))&&registrationOpen(item,now)&&
   (item.module!=="yearEndDinner"||item.paymentOpen===true))
   .sort((a,b)=>(Date.parse(a.closeAt)||Infinity)-(Date.parse(b.closeAt)||Infinity)||
    String(a.startAt||"").localeCompare(String(b.startAt||"")));
 }
 function mark(item,me,students){const seen=read(me,students);seen[key(item)]=version(item);try{localStorage.setItem(scope(me,students),JSON.stringify(seen))}catch{}}
 function activityDate(item){const start=item.module==="calendarActivity"?item.eventDate:day(item.startAt),end=item.module==="calendarActivity"?(item.endDate||start):day(item.endAt||item.startAt);return start&&end&&end!==start?start+"～"+end:start||"日期待公告"}
 window.parentActivityNotice={unseen,mark,activityDate,key,registrationTasks,registrationOpen};
})();
