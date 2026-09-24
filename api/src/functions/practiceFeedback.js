import { app } from "@azure/functions";
import { getTenantContext, ensureStudentAccess, json } from "../lib/auth.js";
import { ensureTenantTables, table, tenantStudentPartition, tenantSchoolPartition, getStudentMaster } from "../lib/storage.js";

const safe=v=>String(v||"").replaceAll("'","''");
const currentMonth=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit"}).format(new Date()).slice(0,7);
const monthValue=v=>/^\d{4}-\d{2}$/.test(String(v||"").trim())?String(v).trim():currentMonth();
const view=e=>({
  studentId:String(e.studentId||""),
  month:String(e.feedbackMonth||""),
  level:Number(e.level||0),
  comment:String(e.comment||""),
  teacherName:String(e.teacherName||""),
  teacherEmail:String(e.teacherEmail||""),
  updatedAt:String(e.updatedAt||"")
});

async function listRows(schoolId,{studentId="",month=""}={}){
  const client=table("tenantPracticeFeedback"),items=[];
  const parts=[];
  if(studentId)parts.push(`PartitionKey eq '${safe(tenantStudentPartition(schoolId,studentId))}'`);
  else parts.push(`schoolId eq '${safe(tenantSchoolPartition(schoolId))}'`);
  if(month)parts.push(`feedbackMonth eq '${safe(month)}'`);
  for await(const e of client.listEntities({queryOptions:{filter:parts.join(" and ")}}))items.push(e);
  return items.sort((a,b)=>String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")));
}

app.http("practiceFeedback",{
  methods:["GET","POST"],authLevel:"anonymous",route:"practice-feedback",
  handler:async(request)=>{
    const context=await getTenantContext(request);if(context.error)return context.error;
    const {access:a,schoolId}=context;
    await ensureTenantTables();

    if(request.method==="GET"){
      const studentId=String(request.query.get("studentId")||"").trim();
      const month=String(request.query.get("month")||"").trim();
      if(month&&!/^\d{4}-\d{2}$/.test(month))return json({error:"月份格式錯誤"},400);

      if(studentId){
        if(!ensureStudentAccess(a,studentId))return json({error:"無此學生存取權限"},403);
        const rows=await listRows(schoolId,{studentId,month});
        return json({items:rows.map(view),latest:rows.length?view(rows[0]):null});
      }

      const isTeacher=!!a.capabilities?.teacherSettings;
      if(a.role!=="admin"&&!isTeacher)return json({error:"Forbidden"},403);
      const allowed=a.role==="admin"?null:new Set((a.students||[]).map(x=>String(x?.studentId||x||"")).filter(Boolean));
      const rows=(await listRows(schoolId,{month})).filter(e=>!allowed||allowed.has(String(e.studentId||"")));
      return json({items:rows.map(view)});
    }

    const isTeacher=!!a.capabilities?.teacherSettings;
    if(!isTeacher||a.role==="admin")return json({error:"只有教學老師可提供鼓勵回饋"},403);

    const body=await request.json();
    const studentId=String(body.studentId||"").trim();
    const month=monthValue(body.month);
    const level=Number(body.level||0);
    const comment=String(body.comment||"").trim().slice(0,120);
    if(!studentId)return json({error:"缺少學生"},400);
    if(!Number.isInteger(level)||level<1||level>5)return json({error:"鼓勵等級需為 1～5"},400);
    if(!ensureStudentAccess(a,studentId))return json({error:"無此學生存取權限"},403);
    const master=await getStudentMaster(studentId,schoolId);
    if(!master)return json({error:"找不到學生資料"},404);

    const now=new Date().toISOString();
    const entity={
      partitionKey:tenantStudentPartition(schoolId,studentId),
      rowKey:`month_${month}`,
      schoolId:tenantSchoolPartition(schoolId),
      studentId,
      studentName:String(master.studentName||""),
      feedbackMonth:month,
      level,
      comment,
      teacherName:String(a.displayName||a.email||"老師"),
      teacherEmail:String(a.email||""),
      updatedAt:now
    };
    await table("tenantPracticeFeedback").upsertEntity(entity,"Replace");
    return json({ok:true,item:view(entity)});
  }
});
