import { app } from "@azure/functions";
import { getTenantContext, ensureStudentAccess, json } from "../lib/auth.js";
import { ensureTenantTables, table, tenantStudentPartition, tenantSchoolPartition, getStudentMaster } from "../lib/storage.js";

const safe=v=>String(v||"").replaceAll("'","''");
const monthValue=v=>/^\d{4}-\d{2}$/.test(String(v||"").trim())?String(v).trim():new Date().toISOString().slice(0,7);
const teacherKey=v=>String(v||"teacher").toLowerCase().replace(/[^a-z0-9]/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"").slice(0,48)||"teacher";
const view=e=>({
  studentId:String(e.studentId||""),
  month:String(e.evaluationMonth||""),
  rating:Number(e.rating||0),
  comment:String(e.comment||""),
  teacherName:String(e.teacherName||""),
  teacherEmail:String(e.teacherEmail||""),
  updatedAt:String(e.updatedAt||"")
});

async function listRows(schoolId,month){
  const rows=[],sid=safe(tenantSchoolPartition(schoolId)),m=safe(month);
  const filter=`schoolId eq '${sid}' and evaluationMonth eq '${m}'`;
  for await(const e of table("tenantPracticeMonthlyEvaluation").listEntities({queryOptions:{filter}}))rows.push(e);
  return rows.sort((a,b)=>String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")));
}

app.http("practiceMonthlyEvaluation",{
  methods:["GET","POST"],authLevel:"anonymous",route:"practice-monthly-evaluation",
  handler:async(request)=>{
    const context=await getTenantContext(request);if(context.error)return context.error;
    const {access:a,schoolId}=context;
    await ensureTenantTables();
    const isTeacher=!!a.capabilities?.teacherSettings;
    const month=monthValue(request.method==="GET"?request.query.get("month"):undefined);

    if(request.method==="GET"){
      const rawMonth=String(request.query.get("month")||"").trim();
      if(rawMonth&&!/^\d{4}-\d{2}$/.test(rawMonth))return json({error:"月份格式錯誤"},400);
      const rows=await listRows(schoolId,month);
      const allowed=a.role==="admin"?null:new Set((a.students||[]).map(x=>String(x?.studentId||x||"")).filter(Boolean));
      if(a.role!=="admin"&&!isTeacher)return json({error:"Forbidden"},403);
      const filtered=rows.filter(e=>!allowed||allowed.has(String(e.studentId||"")));
      const grouped=new Map();
      for(const e of filtered){
        const id=String(e.studentId||"");
        const arr=grouped.get(id)||[];arr.push(view(e));grouped.set(id,arr);
      }
      const items=[...grouped.entries()].map(([studentId,ratings])=>{
        const avg=ratings.length?ratings.reduce((n,x)=>n+Number(x.rating||0),0)/ratings.length:0;
        const mine=ratings.find(x=>String(x.teacherEmail||"").toLowerCase()===String(a.email||"").toLowerCase())||null;
        return {studentId,averageRating:Math.round(avg*100)/100,ratingCount:ratings.length,myRating:mine,ratings};
      });
      return json({month,items});
    }

    if(!isTeacher||a.role==="admin")return json({error:"只有教學老師可進行月評比"},403);
    const body=await request.json();
    const studentId=String(body.studentId||"").trim();
    const evalMonth=monthValue(body.month);
    const rating=Number(body.rating||0);
    const comment=String(body.comment||"").trim().slice(0,200);
    if(!studentId)return json({error:"缺少學生"},400);
    if(!Number.isInteger(rating)||rating<1||rating>5)return json({error:"老師月評需為 1～5 級"},400);
    if(!ensureStudentAccess(a,studentId))return json({error:"無此學生存取權限"},403);
    const master=await getStudentMaster(studentId,schoolId);
    if(!master)return json({error:"找不到學生資料"},404);

    const now=new Date().toISOString(),email=String(a.email||"");
    const entity={
      partitionKey:tenantStudentPartition(schoolId,studentId),
      rowKey:`eval_${evalMonth.replace("-","")}_${teacherKey(email)}`,
      schoolId:tenantSchoolPartition(schoolId),
      studentId,
      studentName:String(master.studentName||""),
      evaluationMonth:evalMonth,
      rating,
      comment,
      teacherName:String(a.displayName||email||"老師"),
      teacherEmail:email,
      updatedAt:now
    };
    await table("tenantPracticeMonthlyEvaluation").upsertEntity(entity,"Replace");
    return json({ok:true,item:view(entity)});
  }
});
