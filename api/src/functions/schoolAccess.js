import { app } from "@azure/functions";
import { TableClient, TableServiceClient } from "@azure/data-tables";
import { getAccess, getStudentAliasInfo, json } from "../lib/auth.js";
import { ensureTables, table, listStudentMaster, getTeacherDirectory } from "../lib/storage.js";

const settingsTableName=()=>process.env.SYSTEM_SETTINGS_TABLE||"SystemSettings";
const conn=()=>process.env.STORAGE_CONNECTION_STRING;
let settingsReady=false;

function clean(v,max=120){return String(v||"").trim().slice(0,max)}
function taipeiDate(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())}
function normalizeEmails(list=[]){
  const values=Array.isArray(list)?list:String(list||"").split(/[\n,;]+/);
  return [...new Set(values.map(x=>String(x||"").trim().toLowerCase()).filter(x=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)))].sort();
}
async function ensureSettings(){
  if(settingsReady)return;
  if(!conn())throw new Error("STORAGE_CONNECTION_STRING 未設定");
  const service=TableServiceClient.fromConnectionString(conn());
  try{await service.createTable(settingsTableName())}catch(e){if(e.statusCode!==409)throw e}
  settingsReady=true;
}
function settingsClient(){return TableClient.fromConnectionString(conn(),settingsTableName())}
async function getSchoolEmails(){
  await ensureSettings();
  try{
    const e=await settingsClient().getEntity("SYSTEM","schoolAccess");
    let list=[];
    try{list=JSON.parse(String(e.emailsJson||"[]"))}catch{list=[]}
    return normalizeEmails(list);
  }catch(e){
    if(e.statusCode===404)return [];
    throw e;
  }
}
async function saveSchoolEmails(emails,updatedBy=""){
  await ensureSettings();
  const list=normalizeEmails(emails);
  const entity={partitionKey:"SYSTEM",rowKey:"schoolAccess",emailsJson:JSON.stringify(list),updatedAt:new Date().toISOString(),updatedBy:clean(updatedBy,160)};
  await settingsClient().upsertEntity(entity,"Merge");
  return {emails:list,updatedAt:entity.updatedAt,updatedBy:entity.updatedBy};
}
async function isSchoolViewer(email){return (await getSchoolEmails()).includes(String(email||"").trim().toLowerCase())}

function studentView(e){
  return {studentId:e.rowKey,name:e.studentName,grade:e.grade,groupName:e.groupName,instrument:e.instrument,section:e.section||"待確認",schoolYear:e.schoolYear||"",status:e.status||"active"};
}
async function canonicalId(id,students,cache){
  const key=String(id||"");
  if(students.has(key))return key;
  if(cache.has(key))return cache.get(key);
  try{const a=await getStudentAliasInfo(key);const c=String(a.canonicalStudentId||key);cache.set(key,c);return c}catch{cache.set(key,key);return key}
}
async function teacherName(email,cache){
  const key=String(email||"").trim().toLowerCase();
  if(!key)return "";
  if(cache.has(key))return cache.get(key);
  try{const d=await getTeacherDirectory(key);const name=String(d?.teacherName||"").trim()||key;cache.set(key,name);return name}catch{cache.set(key,key);return key}
}
async function collectDaily(key,date){
  const latest=new Map();
  for await (const e of table(key).listEntities({queryOptions:{filter:`eventDate eq '${date.replaceAll("'","''")}'`}})){
    const rawStudentId=String(e.partitionKey||"");
    const classType=key==="ensemble"?"ensemble":key==="comprehensive"?"comprehensive":"section";
    const row={rawStudentId,eventDate:String(e.eventDate||date),classType,groupName:String(e.groupName||""),section:String(e.section||""),status:String(e.status||""),teacher:String(e.teacher||""),createdAt:String(e.createdAt||""),rowKey:String(e.rowKey||"")};
    const k=[rawStudentId,row.eventDate,row.classType,row.groupName,row.section].join("|");
    const old=latest.get(k),stamp=`${row.createdAt}|${row.rowKey}`,oldStamp=old?`${old.createdAt}|${old.rowKey}`:"";
    if(!old||stamp>=oldStamp)latest.set(k,row);
  }
  return [...latest.values()];
}

app.http("schoolAccessAdmin",{
  methods:["GET","PATCH"],authLevel:"anonymous",route:"school-access",
  handler:async(request)=>{
    const a=await getAccess(request);
    if(!a.authenticated)return json({error:"Unauthorized"},401);
    if(a.role!=="admin")return json({error:"Forbidden"},403);
    if(request.method==="PATCH"){
      const body=await request.json();
      if(!Array.isArray(body.emails))return json({error:"emails 必須為陣列"},400);
      const raw=body.emails.map(x=>String(x||"").trim()).filter(Boolean);
      const emails=normalizeEmails(raw);
      if(emails.length!==new Set(raw.map(x=>x.toLowerCase())).size)return json({error:"請確認所有校方帳號皆為有效 Email"},400);
      return json(await saveSchoolEmails(emails,a.email));
    }
    const emails=await getSchoolEmails();
    return json({emails});
  }
});

app.http("schoolAccessSelf",{
  methods:["GET"],authLevel:"anonymous",route:"school-access-self",
  handler:async(request)=>{
    const a=await getAccess(request);
    if(!a.authenticated)return json({error:"Unauthorized"},401);
    const allowed=a.role!=="admin"&&await isSchoolViewer(a.email);
    return json({allowed,email:a.email,role:allowed?"school":a.role});
  }
});

app.http("schoolFollowup",{
  methods:["GET"],authLevel:"anonymous",route:"school-followup",
  handler:async(request)=>{
    const a=await getAccess(request);
    if(!a.authenticated)return json({error:"Unauthorized"},401);
    const schoolAllowed=await isSchoolViewer(a.email);
    if(a.role!=="admin"&&!schoolAllowed)return json({error:"Forbidden"},403);
    const date=clean(request.query.get("date")||taipeiDate(),20);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return json({error:"日期格式不正確"},400);
    await ensureTables();

    const masters=await listStudentMaster();
    const students=new Map(masters.map(e=>[String(e.rowKey),studentView(e)]));
    const canonicalCache=new Map(),teacherCache=new Map();
    const [sectionRows,ensembleRows,comprehensiveRows]=await Promise.all([
      collectDaily("section",date),collectDaily("ensemble",date),collectDaily("comprehensive",date)
    ]);
    const latest=new Map();
    for(const r of [...sectionRows,...ensembleRows,...comprehensiveRows]){
      const studentId=await canonicalId(r.rawStudentId,students,canonicalCache),row={...r,studentId};
      const k=[studentId,row.eventDate,row.classType,row.groupName,row.section].join("|");
      const old=latest.get(k),stamp=`${row.createdAt}|${row.rowKey}`,oldStamp=old?`${old.createdAt}|${old.rowKey}`:"";
      if(!old||stamp>=oldStamp)latest.set(k,row);
    }

    const items=[];
    for(const r of latest.values()){
      const s=students.get(String(r.studentId))||{studentId:r.studentId,name:`學生 ${r.studentId}`,grade:"",groupName:r.groupName,section:r.section||"待確認",instrument:""};
      items.push({date:r.eventDate,classType:r.classType,studentId:r.studentId,name:s.name,grade:s.grade,groupName:r.groupName||s.groupName,section:r.classType==="ensemble"?"四分部合班":r.section||s.section||"待確認",instrument:s.instrument,status:r.status,teacherName:await teacherName(r.teacher,teacherCache)});
    }
    const order={absent:0,leave:1,late:2,present:3,cancelled:4};
    items.sort((x,y)=>(order[x.status]??9)-(order[y.status]??9)||String(x.classType).localeCompare(String(y.classType))||String(x.groupName).localeCompare(String(y.groupName),"zh-Hant")||String(x.section).localeCompare(String(y.section),"zh-Hant")||String(x.name).localeCompare(String(y.name),"zh-Hant"));
    const count=status=>items.filter(x=>x.status===status).length;
    return json({date,scope:"00:00-23:59",readOnly:true,items,counts:{total:items.length,present:count("present"),late:count("late"),leave:count("leave"),absent:count("absent"),cancelled:count("cancelled"),followup:count("leave")+count("absent")}});
  }
});
