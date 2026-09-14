import { app } from "@azure/functions";
import { getAccess, getStudentAliasInfo, json } from "../lib/auth.js";
import { ensureTables, table, listStudentMaster, getTeacherDirectory } from "../lib/storage.js";

function clean(v,max=80){return String(v||"").trim().slice(0,max)}
function monthRange(month){
  const m=/^\d{4}-\d{2}$/.test(month)?month:new Date().toISOString().slice(0,7);
  return {month:m,start:`${m}-01`,end:`${m}-31`};
}
function studentView(e){
  return {studentId:e.rowKey,name:e.studentName,grade:e.grade,groupName:e.groupName,instrument:e.instrument,section:e.section||"待確認",schoolYear:e.schoolYear||"",status:e.status||"active"};
}
async function listRange(key,start,end,allowedIds){
  const latest=new Map();
  const filter=`eventDate ge '${start}' and eventDate le '${end}'`;
  for await (const e of table(key).listEntities({queryOptions:{filter}})){
    const studentId=String(e.partitionKey);
    if(allowedIds&&!allowedIds.has(studentId))continue;
    const row={
      studentId,
      eventDate:String(e.eventDate||""),
      classType:String(e.classType||key),
      groupName:String(e.groupName||""),
      section:String(e.section||""),
      status:String(e.status||""),
      minutes:Number(e.minutes||0),
      teacher:String(e.teacher||""),
      createdAt:String(e.createdAt||"")
    };
    const dedupeKey=[row.studentId,row.eventDate,row.classType,row.groupName,row.section].join("|");
    const old=latest.get(dedupeKey);
    if(!old||row.createdAt>=old.createdAt)latest.set(dedupeKey,row);
  }
  return [...latest.values()];
}
function blank(){return {present:0,late:0,leave:0,absent:0,cancelled:0,total:0,attended:0}}
function add(bucket,status){
  if(status in bucket)bucket[status]++;
  if(status!=="cancelled")bucket.total++;
  if(status==="present"||status==="late")bucket.attended++;
}

app.http("attendanceReport",{
  methods:["GET"],authLevel:"anonymous",route:"attendance-report",
  handler:async(request)=>{
    const a=await getAccess(request);
    if(!a.authenticated)return json({error:"Unauthorized"},401);
    const isTeacher=!!a.capabilities?.teacherSettings;
    if(a.role!=="admin"&&!isTeacher)return json({error:"Forbidden"},403);
    const {month,start,end}=monthRange(clean(request.query.get("month"),12));
    await ensureTables();

    let students;
    if(a.role==="admin"){
      students=(await listStudentMaster("active")).map(studentView);
    }else{
      students=(a.students||[]).filter(x=>x?.studentId).map(x=>({
        studentId:String(x.studentId),name:x.name,grade:x.grade,groupName:x.groupName,instrument:x.instrument,section:x.section||"待確認",schoolYear:x.schoolYear||"",status:x.status||"active"
      }));
    }
    const byId=new Map(students.map(s=>[String(s.studentId),s]));
    const allowedIds=new Set(byId.keys());
    const [sectionRows,ensembleRows,privateRows]=await Promise.all([
      listRange("section",start,end,allowedIds),
      listRange("ensemble",start,end,allowedIds),
      listRange("privateLesson",start,end,allowedIds)
    ]);
    const records=[...sectionRows,...ensembleRows,...privateRows].sort((a,b)=>String(b.eventDate).localeCompare(String(a.eventDate))||String(b.createdAt).localeCompare(String(a.createdAt)));
    const agg=new Map();
    for(const s of students)agg.set(String(s.studentId),{...s,sectionStats:blank(),ensembleStats:blank(),privateStats:blank(),overall:blank()});
    for(const r of records){
      const x=agg.get(String(r.studentId));if(!x)continue;
      const key=r.classType==="ensemble"?"ensembleStats":r.classType==="private"||r.classType==="privateLesson"?"privateStats":"sectionStats";
      add(x[key],r.status);add(x.overall,r.status);
    }
    const items=[...agg.values()].map(x=>({...x,attendanceRate:x.overall.total?Math.round(x.overall.attended/x.overall.total*1000)/10:null})).sort((a,b)=>String(a.groupName).localeCompare(String(b.groupName),"zh-Hant")||String(a.section).localeCompare(String(b.section),"zh-Hant")||String(a.name).localeCompare(String(b.name),"zh-Hant"));
    return json({month,start,end,items,records});
  }
});

function taipeiDate(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())}
async function canonicalDailyId(id,students,cache){
  const key=String(id||"");
  if(students.has(key))return key;
  if(cache.has(key))return cache.get(key);
  try{const a=await getStudentAliasInfo(key);const c=String(a.canonicalStudentId||key);cache.set(key,c);return c}catch{cache.set(key,key);return key}
}
async function dailyTeacherName(email,cache){
  const key=String(email||"").trim().toLowerCase();
  if(!key)return "";
  if(cache.has(key))return cache.get(key);
  try{const d=await getTeacherDirectory(key);const name=String(d?.teacherName||"").trim()||key;cache.set(key,name);return name}catch{cache.set(key,key);return key}
}
async function collectDaily(key,date){
  const latest=new Map();
  for await (const e of table(key).listEntities({queryOptions:{filter:`eventDate eq '${date.replaceAll("'","''")}'`}})){
    const rawStudentId=String(e.partitionKey||"");
    const row={rawStudentId,eventDate:String(e.eventDate||date),classType:key==="ensemble"?"ensemble":"section",groupName:String(e.groupName||""),section:String(e.section||""),status:String(e.status||""),teacher:String(e.teacher||""),createdAt:String(e.createdAt||""),rowKey:String(e.rowKey||"")};
    const d=[rawStudentId,row.eventDate,row.classType,row.groupName,row.section].join("|");
    const old=latest.get(d),stamp=`${row.createdAt}|${row.rowKey}`,oldStamp=old?`${old.createdAt}|${old.rowKey}`:"";
    if(!old||stamp>=oldStamp)latest.set(d,row);
  }
  return [...latest.values()];
}

app.http("dailyFollowup",{
  methods:["GET"],authLevel:"anonymous",route:"daily-followup",
  handler:async(request)=>{
    const a=await getAccess(request);
    if(!a.authenticated)return json({error:"Unauthorized"},401);
    if(a.role!=="admin")return json({error:"Forbidden"},403);
    const date=clean(request.query.get("date")||taipeiDate(),20);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return json({error:"日期格式不正確"},400);
    await ensureTables();

    const masters=await listStudentMaster();
    const students=new Map(masters.map(e=>[String(e.rowKey),studentView(e)]));
    const canonicalCache=new Map(),teacherCache=new Map();
    const [sectionRows,ensembleRows]=await Promise.all([collectDaily("section",date),collectDaily("ensemble",date)]);
    const raw=[...sectionRows,...ensembleRows].filter(x=>["leave","absent"].includes(x.status));
    const latest=new Map();
    for(const r of raw){
      const studentId=await canonicalDailyId(r.rawStudentId,students,canonicalCache),row={...r,studentId};
      const k=[studentId,row.eventDate,row.classType,row.groupName,row.section].join("|");
      const old=latest.get(k),stamp=`${row.createdAt}|${row.rowKey}`,oldStamp=old?`${old.createdAt}|${old.rowKey}`:"";
      if(!old||stamp>=oldStamp)latest.set(k,row);
    }

    const items=[];
    for(const r of latest.values()){
      const s=students.get(String(r.studentId))||{studentId:r.studentId,name:`學生 ${r.studentId}`,grade:"",groupName:r.groupName,section:r.section||"待確認",instrument:""};
      items.push({date:r.eventDate,classType:r.classType,studentId:r.studentId,name:s.name,grade:s.grade,groupName:r.groupName||s.groupName,section:r.classType==="ensemble"?"四分部合班":r.section||s.section||"待確認",instrument:s.instrument,status:r.status,teacherName:await dailyTeacherName(r.teacher,teacherCache),teacherEmail:r.teacher});
    }
    items.sort((x,y)=>String(x.classType).localeCompare(String(y.classType))||String(x.groupName).localeCompare(String(y.groupName),"zh-Hant")||String(x.section).localeCompare(String(y.section),"zh-Hant")||String(x.name).localeCompare(String(y.name),"zh-Hant"));
    return json({date,scope:"00:00-23:59",items,counts:{total:items.length,leave:items.filter(x=>x.status==="leave").length,absent:items.filter(x=>x.status==="absent").length,section:items.filter(x=>x.classType==="section").length,ensemble:items.filter(x=>x.classType==="ensemble").length}});
  }
});
