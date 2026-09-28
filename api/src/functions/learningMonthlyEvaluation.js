import { app } from "@azure/functions";
import { getTenantContext, ensureStudentAccess, ensureSectionAccess, getStudentAliasInfo, json } from "../lib/auth.js";
import { ensureTenantTables, table, tenantStudentPartition, tenantSchoolPartition, getStudentMaster, listStudentMaster, listActivityRange, activityStudentId } from "../lib/storage.js";

const safe=v=>String(v||"").replaceAll("'","''");
const monthValue=v=>/^\d{4}-\d{2}$/.test(String(v||"").trim())?String(v).trim():new Date().toISOString().slice(0,7);
const teacherKey=v=>String(v||"teacher").toLowerCase().replace(/[^a-z0-9]/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"").slice(0,48)||"teacher";
const clampRating=v=>{const n=Number(v||0);return Number.isInteger(n)&&n>=1&&n<=5?n:0};
const round2=v=>Math.round(Number(v||0)*100)/100;

const view=e=>({
  studentId:String(e.studentId||""),
  month:String(e.evaluationMonth||""),
  evaluationMode:String(e.evaluationMode||"legacyMonthly"),
  attitude:Number(e.attitude||0),
  preparation:Number(e.preparation||0),
  progress:Number(e.progress||0),
  teamwork:Number(e.teamwork||0),
  score5:Number(e.score5||0),
  comment:String(e.comment||""),
  teacherName:String(e.teacherName||""),
  teacherEmail:String(e.teacherEmail||""),
  updatedAt:String(e.updatedAt||"")
});

function fallbackWindow(month){
  const [year,mm]=String(month||"").split("-").map(Number);
  if(!year)return null;
  if(mm===12)return {start:`${year}-10-01`,end:`${year}-12-31`,label:`${year} 上學期期末`};
  if(mm===5)return {start:`${year}-02-01`,end:`${year}-05-31`,label:`${year} 下學期期末`};
  return null;
}

async function listRows(schoolId,month,{fallbackOnly=false}={}){
  const rows=[],sid=safe(tenantSchoolPartition(schoolId)),m=safe(month);
  const filter=`schoolId eq '${sid}' and evaluationMonth eq '${m}'`;
  for await(const e of table("tenantLearningMonthlyEvaluation").listEntities({queryOptions:{filter}})){
    if(fallbackOnly&&String(e.evaluationMode||"")!=="semesterFallback")continue;
    rows.push(e);
  }
  return rows.sort((a,b)=>String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")));
}

async function completedPrivateForStudent(schoolId,studentId,start,end,rows){
  const alias=await getStudentAliasInfo(studentId,schoolId),ids=new Set((alias.aliases||[studentId]).map(String));
  return rows.filter(r=>ids.has(String(activityStudentId(r)))&&["teacher_completed","present","late"].includes(String(r.status||""))).length;
}

function aggregateRatings(ratings,isTeacher,email){
  const avg=key=>ratings.length?round2(ratings.reduce((n,x)=>n+Number(x[key]||0),0)/ratings.length):0;
  const score5=ratings.length?round2(ratings.reduce((n,x)=>n+Number(x.score5||0),0)/ratings.length):0;
  const mine=isTeacher?ratings.find(x=>String(x.teacherEmail||"").toLowerCase()===String(email||"").toLowerCase())||null:null;
  return {ratingCount:ratings.length,myRating:mine,ratings,average:{attitude:avg("attitude"),preparation:avg("preparation"),progress:avg("progress"),teamwork:avg("teamwork")},score5};
}

app.http("learningMonthlyEvaluation",{
  methods:["GET","POST"],authLevel:"anonymous",route:"learning-monthly-evaluation",
  handler:async request=>{
    const context=await getTenantContext(request);if(context.error)return context.error;
    const {access:a,schoolId}=context;
    await ensureTenantTables();
    const isTeacher=!!a.capabilities?.teacherSettings;

    if(request.method==="GET"){
      const rawMonth=String(request.query.get("month")||"").trim(),studentId=String(request.query.get("studentId")||"").trim();
      if(rawMonth&&!/^\d{4}-\d{2}$/.test(rawMonth))return json({error:"月份格式錯誤"},400);
      const month=monthValue(rawMonth),mode=String(request.query.get("mode")||"").trim();
      if(mode==="semesterFallback"){
        if(a.role!=="admin"&&(!isTeacher||!a.capabilities?.section))return json({error:"只有分部老師可查看學期末替代評量"},403);
        const window=fallbackWindow(month);if(!window)return json({error:"學期末評量月份僅支援 12 月或 5 月"},400);
        const rows=await listRows(schoolId,month,{fallbackOnly:true}),privateRows=await listActivityRange("privateLesson",schoolId,window.start,window.end);
        let students;
        if(a.role==="admin")students=(await listStudentMaster("active",schoolId)).map(x=>({studentId:String(x.rowKey),name:String(x.studentName||""),grade:String(x.grade||""),groupName:String(x.groupName||""),section:String(x.section||"待確認"),instrument:String(x.instrument||"")}));
        else students=(a.students||[]).filter(x=>x?.studentId&&ensureSectionAccess(a,x)).map(x=>({studentId:String(x.studentId),name:String(x.name||""),grade:String(x.grade||""),groupName:String(x.groupName||""),section:String(x.section||"待確認"),instrument:String(x.instrument||"")}));
        const seen=new Set();students=students.filter(x=>x.studentId&&!seen.has(x.studentId)&&(seen.add(x.studentId),true));
        const items=[];
        for(const s of students){
          const completed=await completedPrivateForStudent(schoolId,s.studentId,window.start,window.end,privateRows);
          const ratings=rows.filter(e=>String(e.studentId||"")===String(s.studentId)).map(view);
          items.push({...s,privateCompleted:completed,fallbackEligible:completed===0,...aggregateRatings(ratings,isTeacher,a.email)});
        }
        items.sort((x,y)=>Number(y.fallbackEligible)-Number(x.fallbackEligible)||String(x.groupName).localeCompare(String(y.groupName),"zh-Hant")||String(x.section).localeCompare(String(y.section),"zh-Hant")||String(x.name).localeCompare(String(y.name),"zh-Hant"));
        return json({month,mode:"semesterFallback",window,items,eligibleCount:items.filter(x=>x.fallbackEligible).length,privateLessonCount:items.filter(x=>!x.fallbackEligible).length});
      }

      const rows=await listRows(schoolId,month);
      let filtered=[];
      if(studentId){
        if(!ensureStudentAccess(a,studentId))return json({error:"無此學生存取權限"},403);
        filtered=rows.filter(e=>String(e.studentId||"")===studentId);
      }else{
        if(a.role!=="admin"&&!isTeacher)return json({error:"Forbidden"},403);
        const allowed=a.role==="admin"?null:new Set((a.students||[]).map(x=>String(x?.studentId||x||"")).filter(Boolean));
        filtered=rows.filter(e=>!allowed||allowed.has(String(e.studentId||"")));
      }
      const grouped=new Map();
      for(const e of filtered){const id=String(e.studentId||""),arr=grouped.get(id)||[];arr.push(view(e));grouped.set(id,arr)}
      const items=[...grouped.entries()].map(([studentId,ratings])=>({studentId,...aggregateRatings(ratings,isTeacher,a.email)}));
      return json({month,items,item:studentId?(items[0]||null):null});
    }

    const body=await request.json(),mode=String(body.mode||"").trim();
    if(mode!=="semesterFallback")return json({error:"每月老師正式評量已停用；只有未參加個課的學生，才在學期末由分部老師評量"},410);
    if(!isTeacher||a.role==="admin"||!a.capabilities?.section)return json({error:"只有分部老師可進行學期末替代評量"},403);
    const studentId=String(body.studentId||"").trim(),month=monthValue(body.month),window=fallbackWindow(month),score5=clampRating(body.score5),comment=String(body.comment||"").trim().slice(0,240);
    if(!studentId)return json({error:"缺少學生"},400);
    if(!window)return json({error:"學期末評量月份僅支援 12 月或 5 月"},400);
    if(!score5)return json({error:"請完成 1～5 級學期末評量"},400);
    if(!ensureStudentAccess(a,studentId))return json({error:"無此學生存取權限"},403);
    const master=await getStudentMaster(studentId,schoolId);if(!master)return json({error:"找不到學生資料"},404);
    const studentView={studentId:String(master.rowKey),groupName:String(master.groupName||""),section:String(master.section||"待確認")};
    if(!ensureSectionAccess(a,studentView))return json({error:"只有該學生的分部老師可進行學期末評量"},403);
    const privateRows=await listActivityRange("privateLesson",schoolId,window.start,window.end),completed=await completedPrivateForStudent(schoolId,studentId,window.start,window.end,privateRows);
    if(completed>0)return json({error:`此學生本學期已有 ${completed} 堂完成個課，期末 5% 將依正式月份每月完成個課次數換算（每月 4 次 = 5 分）後取學期平均，不需分部老師另評`},409);

    const now=new Date().toISOString(),email=String(a.email||"");
    const entity={
      partitionKey:tenantStudentPartition(schoolId,studentId),
      rowKey:`termfallback_${month.replace("-","")}_${teacherKey(email)}`,
      schoolId:tenantSchoolPartition(schoolId),studentId,studentName:String(master.studentName||""),
      evaluationMonth:month,evaluationMode:"semesterFallback",attitude:0,preparation:0,progress:0,teamwork:0,score5,comment,
      teacherName:String(a.displayName||email||"分部老師"),teacherEmail:email,updatedAt:now
    };
    await table("tenantLearningMonthlyEvaluation").upsertEntity(entity,"Replace");
    return json({ok:true,item:view(entity),score5});
  }
});
