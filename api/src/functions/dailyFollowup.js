import { app } from "@azure/functions";
import { getAccess, getStudentAliasInfo, json } from "../lib/auth.js";
import { ensureTables, table, listStudentMaster, getTeacherDirectory } from "../lib/storage.js";

function clean(v,max=120){return String(v||"").trim().slice(0,max)}
function taipeiDate(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())}
function studentView(e){return {studentId:String(e.rowKey||""),name:String(e.studentName||""),grade:String(e.grade||""),groupName:String(e.groupName||""),section:String(e.section||"待確認"),instrument:String(e.instrument||"")}}

async function canonicalId(id,cache){
  const key=String(id||"");
  if(cache.has(key))return cache.get(key);
  try{const a=await getStudentAliasInfo(key);const c=String(a.canonicalStudentId||key);cache.set(key,c);return c}catch{cache.set(key,key);return key}
}

async function teacherName(email,cache){
  const key=String(email||"").trim().toLowerCase();
  if(!key)return "";
  if(cache.has(key))return cache.get(key);
  try{
    const d=await getTeacherDirectory(key);
    const name=String(d?.teacherName||"").trim()||key;
    cache.set(key,name);return name;
  }catch{cache.set(key,key);return key}
}

async function collect(key,date,canonicalCache){
  const latest=new Map();
  for await (const e of table(key).listEntities({queryOptions:{filter:`eventDate eq '${date.replaceAll("'","''")}'`}})){
    const studentId=await canonicalId(e.partitionKey,canonicalCache);
    const row={
      studentId,eventDate:String(e.eventDate||date),classType:key==="ensemble"?"ensemble":"section",
      groupName:String(e.groupName||""),section:String(e.section||""),status:String(e.status||""),
      teacher:String(e.teacher||""),createdAt:String(e.createdAt||""),rowKey:String(e.rowKey||"")
    };
    const d=[studentId,row.eventDate,row.classType,row.groupName,row.section].join("|");
    const old=latest.get(d);
    const stamp=`${row.createdAt}|${row.rowKey}`;
    const oldStamp=old?`${old.createdAt}|${old.rowKey}`:"";
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
    const [section,ensemble]=await Promise.all([collect("section",date,canonicalCache),collect("ensemble",date,canonicalCache)]);
    const relevant=[...section,...ensemble].filter(x=>["leave","absent"].includes(x.status));
    const items=[];
    for(const r of relevant){
      const s=students.get(String(r.studentId))||{studentId:r.studentId,name:`學生 ${r.studentId}`,grade:"",groupName:r.groupName,section:r.section||"待確認",instrument:""};
      items.push({
        date:r.eventDate,classType:r.classType,studentId:r.studentId,name:s.name,grade:s.grade,
        groupName:r.groupName||s.groupName,section:r.classType==="ensemble"?"四分部合班":r.section||s.section||"待確認",
        instrument:s.instrument,status:r.status,teacherName:await teacherName(r.teacher,teacherCache),teacherEmail:r.teacher
      });
    }
    items.sort((x,y)=>String(x.classType).localeCompare(String(y.classType))||String(x.groupName).localeCompare(String(y.groupName),"zh-Hant")||String(x.section).localeCompare(String(y.section),"zh-Hant")||String(x.name).localeCompare(String(y.name),"zh-Hant"));
    return json({
      date,items,
      counts:{total:items.length,leave:items.filter(x=>x.status==="leave").length,absent:items.filter(x=>x.status==="absent").length,section:items.filter(x=>x.classType==="section").length,ensemble:items.filter(x=>x.classType==="ensemble").length}
    });
  }
});
