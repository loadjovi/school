import { app } from "@azure/functions";
import { getTenantContext, json } from "../lib/auth.js";
import { ensureTenantTables, table, rowKey, listStudentMaster, tenantSchoolPartition, tenantStudentPartition } from "../lib/storage.js";

const gradeOrder=["一年級","二年級","三年級","四年級","五年級","六年級"];
function clean(v,max=40){return String(v||"").trim().slice(0,max)}
function nextGrade(grade){
  const i=gradeOrder.indexOf(grade);
  if(i<0)return null;
  if(i===gradeOrder.length-1)return null;
  return gradeOrder[i+1];
}
function viewStudent(e){return {studentId:e.rowKey,name:e.studentName,grade:e.grade,groupName:e.groupName,instrument:e.instrument,schoolYear:e.schoolYear||"",status:e.status||"active"}}
function buildPlan(items,{fromSchoolYear,toSchoolYear,promoteGrades,graduateSixth,includeBlankYear,studentIds}){
  const selectedSet=new Set(Array.isArray(studentIds)?studentIds.map(String):[]);
  const hasExplicitSelection=selectedSet.size>0;
  const changes=[];
  const skipped=[];
  for(const e of items){
    const old=viewStudent(e);
    if(old.status!=="active"){skipped.push({...old,reason:"非在團學生"});continue}
    if(hasExplicitSelection&&!selectedSet.has(old.studentId)){continue}
    if(fromSchoolYear){
      const year=String(old.schoolYear||"").trim();
      if(year!==fromSchoolYear&&!(includeBlankYear&&!year)){skipped.push({...old,reason:`學年度不是 ${fromSchoolYear}`});continue}
    }
    if(String(old.schoolYear||"").trim()===toSchoolYear){skipped.push({...old,reason:`已是 ${toSchoolYear} 學年度`});continue}
    const updated={...old,schoolYear:toSchoolYear};
    let changeType="school_year_update";
    if(promoteGrades){
      if(old.grade==="六年級"){
        if(graduateSixth){updated.status="inactive";changeType="academic_year_graduate"}
        else {skipped.push({...old,reason:"六年級未設定畢業處理"});continue}
      }else{
        const ng=nextGrade(old.grade);
        if(!ng){skipped.push({...old,reason:"年級資料無法判斷"});continue}
        updated.grade=ng;changeType="academic_year_promote";
      }
    }
    changes.push({old,updated,changeType});
  }
  return {changes,skipped};
}

app.http("academicYearPromotion",{
  methods:["POST"],authLevel:"anonymous",route:"academic-year-promotion",
  handler:async(request)=>{
    const context=await getTenantContext(request);if(context.error)return context.error;
    const {access,schoolId}=context;
    if(access.role!=="admin")return json({error:"Forbidden"},403);
    const body=await request.json();
    const action=clean(body.action||"preview",20).toLowerCase();
    const fromSchoolYear=clean(body.fromSchoolYear,12);
    const toSchoolYear=clean(body.toSchoolYear,12);
    const promoteGrades=body.promoteGrades!==false;
    const graduateSixth=body.graduateSixth!==false;
    const includeBlankYear=body.includeBlankYear===true;
    const studentIds=Array.isArray(body.studentIds)?body.studentIds:[];
    if(!["preview","apply"].includes(action))return json({error:"action 必須為 preview 或 apply"},400);
    if(!toSchoolYear)return json({error:"請填寫目標學年度"},400);
    if(fromSchoolYear&&fromSchoolYear===toSchoolYear)return json({error:"來源與目標學年度不可相同"},400);
    await ensureTenantTables();
    const items=await listStudentMaster("",schoolId);
    const plan=buildPlan(items,{fromSchoolYear,toSchoolYear,promoteGrades,graduateSixth,includeBlankYear,studentIds});
    const summary={
      totalStudents:items.length,
      affected:plan.changes.length,
      promoted:plan.changes.filter(x=>x.changeType==="academic_year_promote").length,
      graduated:plan.changes.filter(x=>x.changeType==="academic_year_graduate").length,
      yearOnly:plan.changes.filter(x=>x.changeType==="school_year_update").length,
      skipped:plan.skipped.length
    };
    const preview={summary,items:plan.changes.map(x=>({studentId:x.old.studentId,name:x.old.name,groupName:x.old.groupName,instrument:x.old.instrument,oldGrade:x.old.grade,newGrade:x.updated.grade,oldSchoolYear:x.old.schoolYear,newSchoolYear:x.updated.schoolYear,newStatus:x.updated.status,changeType:x.changeType})),skipped:plan.skipped};
    if(action==="preview")return json(preview);
    if(!body.confirmApply)return json({error:"正式執行需要 confirmApply=true"},400);
    if(plan.changes.length===0)return json({error:"沒有可執行的學生異動"},409);
    const now=new Date().toISOString();
    const batchId=rowKey("yearbatch");
    for(const c of plan.changes){
      const current=await table("tenantStudentMaster").getEntity(tenantSchoolPartition(schoolId),c.old.studentId);
      const before=viewStudent(current);
      current.grade=c.updated.grade;
      current.schoolYear=c.updated.schoolYear;
      current.status=c.updated.status;
      current.updatedAt=now;
      current.updatedBy=access.email;
      await table("tenantStudentMaster").updateEntity(current,"Merge");
      await table("tenantStudentHistory").createEntity({
        partitionKey:tenantStudentPartition(schoolId,c.old.studentId),
        rowKey:rowKey("hist"),
        schoolId,
        studentId:c.old.studentId,
        changeType:c.changeType,
        changedAt:now,
        changedBy:access.email,
        batchId,
        oldValue:JSON.stringify(before),
        newValue:JSON.stringify(viewStudent(current))
      });
    }
    try{
      await table("tenantAcademicYearBatch").createEntity({
        partitionKey:tenantSchoolPartition(schoolId),
        rowKey:batchId,
        schoolId,
        fromSchoolYear,
        toSchoolYear,
        promoteGrades,
        graduateSixth,
        includeBlankYear,
        affected:summary.affected,
        promoted:summary.promoted,
        graduated:summary.graduated,
        yearOnly:summary.yearOnly,
        executedAt:now,
        executedBy:access.email
      });
    }catch(e){console.error("academicYearBatch log failed",e?.message||String(e))}
    return json({ok:true,batchId,...preview});
  }
});
