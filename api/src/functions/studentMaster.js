import { app } from "@azure/functions";
import { getTenantContext, json } from "../lib/auth.js";
import { ensureTenantTables, table, rowKey, getStudentMaster, listStudentMaster, semesterLabel, tenantSchoolPartition, tenantStudentPartition, tenantTermPartition } from "../lib/storage.js";

const allowedGroups=new Set(["A","B","C","儲備"]);
const allowedGrades=new Set(["一年級","二年級","三年級","四年級","五年級","六年級"]);
const allowedInstruments=new Set(["小提琴","中提琴","大提琴","低音提琴","其他","待確認"]);
const allowedSections=new Set(["小提一部","小提二部","中提","大提","低音提","待確認"]);
function clean(v,max=100){return String(v||"").trim().slice(0,max)}
function defaultSection(instrument){if(instrument==="中提琴")return "中提";if(instrument==="大提琴")return "大提";if(instrument==="低音提琴")return "低音提";return "待確認"}
function view(e){return {studentId:e.rowKey,studentNo:e.studentNo||(/^\d{6}$/.test(String(e.rowKey))?String(e.rowKey):""),name:e.studentName,grade:e.grade,groupName:e.groupName,instrument:e.instrument,section:e.section||defaultSection(e.instrument),schoolYear:e.schoolYear||"",classCode:e.classCode||"",semester:e.semester||"",semesterName:e.semesterName||semesterLabel(e.semester),seatNo:e.seatNo||"",status:e.status||"active",inactiveReason:e.inactiveReason||"",inactiveForTerm:e.inactiveForTerm||"",replacedByStudentId:e.replacedByStudentId||null,updatedAt:e.updatedAt||null,updatedBy:e.updatedBy||null}}
function validate(x){
  if(x.studentName.length<2)return "請填寫學生姓名";
  if(!allowedGrades.has(x.grade))return "年級不正確";
  if(!allowedGroups.has(x.groupName))return "團別不正確";
  if(!allowedInstruments.has(x.instrument))return "樂器類別不正確";
  if(!allowedSections.has(x.section))return "分部不正確";
  if(!["active","inactive"].includes(x.status))return "狀態不正確";
  return "";
}

app.http("studentMaster",{
  methods:["GET","POST","PATCH"],authLevel:"anonymous",route:"student-master",
  handler:async(request)=>{
    const context=await getTenantContext(request);if(context.error)return context.error;
    const {access,schoolId}=context;
    if(access.role!=="admin")return json({error:"Forbidden"},403);
    await ensureTenantTables();
    if(request.method==="GET"){
      const status=clean(request.query.get("status"),20),items=await listStudentMaster(status,schoolId);
      return json({items:items.map(view)});
    }
    const body=await request.json();
    const studentName=clean(body.name||body.studentName,40),grade=clean(body.grade,20),groupName=clean(body.groupName,10),instrument=clean(body.instrument,20),schoolYear=clean(body.schoolYear,20),status=clean(body.status||"active",20),changeType=clean(body.changeType,40),changeNote=clean(body.changeNote,300),effectiveDate=clean(body.effectiveDate,10);
    const now=new Date().toISOString();
    if(request.method==="POST"){
      const section=clean(body.section||defaultSection(instrument),20),err=validate({studentName,grade,groupName,instrument,section,status});if(err)return json({error:err},400);
      const studentId=clean(body.studentNo||body.studentId,20).replace(/\.0$/,"");
      if(!/^\d{6}$/.test(studentId))return json({error:"請輸入 6 碼學號；學號將作為唯一 Student ID"},400);
      if(await getStudentMaster(studentId,schoolId))return json({error:"此學號已存在"},409);
      const semester=clean(body.semester,10);
      const entity={partitionKey:tenantSchoolPartition(schoolId),rowKey:studentId,schoolId,studentId,studentNo:studentId,studentName,grade,groupName,instrument,section,schoolYear,classCode:clean(body.classCode,20),semester,semesterName:semesterLabel(semester),seatNo:clean(body.seatNo,10),status,joinedAt:effectiveDate||now.slice(0,10),changeNote,createdAt:now,updatedAt:now,updatedBy:access.email};
      await table("tenantStudentMaster").createEntity(entity);
      const semesterEnrolled=body.addToSemester===true&&schoolYear&&["1","2"].includes(semester);
      if(semesterEnrolled){
        await table("tenantSemesterEnrollment").upsertEntity({partitionKey:tenantTermPartition(schoolId,schoolYear,semester),rowKey:studentId,schoolId,studentId,studentNo:studentId,studentName,grade,groupName,section,instrument,classCode:entity.classCode,seatNo:entity.seatNo,schoolYear,semester,semesterName:semesterLabel(semester),status:"enrolled",confirmedAt:now,confirmedBy:access.email,updatedAt:now},"Replace");
      }
      await table("tenantStudentHistory").createEntity({partitionKey:tenantStudentPartition(schoolId,studentId),rowKey:rowKey("hist"),schoolId,studentId,changeType:semesterEnrolled?"manual_create_and_enroll":"manual_create_by_student_no",schoolYear,semester,changedAt:now,changedBy:access.email,effectiveDate:effectiveDate||now.slice(0,10),note:changeNote,oldValue:"",newValue:JSON.stringify(view(entity))});
      return json({ok:true,student:view(entity),semesterEnrolled},201);
    }
    const studentId=clean(body.studentId,80);if(!studentId)return json({error:"缺少 studentId"},400);
    const old=await getStudentMaster(studentId,schoolId);if(!old)return json({error:"找不到學生主檔"},404);
    const nextStudentName=clean(body.name??body.studentName??old.studentName,40),nextGrade=clean(body.grade??old.grade,20),nextGroupName=clean(body.groupName??old.groupName,10),nextInstrument=clean(body.instrument??old.instrument,20),nextSchoolYear=clean(body.schoolYear??old.schoolYear,20),nextStatus=clean(body.status??old.status??"active",20);
    const section=clean(body.section??old.section??defaultSection(nextInstrument),20),err=validate({studentName:nextStudentName,grade:nextGrade,groupName:nextGroupName,instrument:nextInstrument,section,status:nextStatus});if(err)return json({error:err},400);
    const semester=clean(body.semester??old.semester,10),oldStatus=String(old.status||"active"),becameInactive=oldStatus!=="inactive"&&nextStatus==="inactive",becameActive=oldStatus==="inactive"&&nextStatus==="active";
    const entity={...old,studentNo:old.studentNo||(/^\d{6}$/.test(studentId)?studentId:""),studentName:nextStudentName,grade:nextGrade,groupName:nextGroupName,instrument:nextInstrument,section,schoolYear:nextSchoolYear,classCode:clean(body.classCode??old.classCode,20),semester,semesterName:semesterLabel(semester),seatNo:clean(body.seatNo??old.seatNo,10),status:nextStatus,updatedAt:now,updatedBy:access.email};
    await table("tenantStudentMaster").updateEntity(entity,"Merge");
    await table("tenantStudentHistory").createEntity({partitionKey:tenantStudentPartition(schoolId,studentId),rowKey:rowKey("hist"),schoolId,studentId,changeType:changeType|| (becameInactive?"leave_or_inactive":becameActive?"rejoin":"profile_update"),changedAt:now,changedBy:access.email,effectiveDate:effectiveDate||now.slice(0,10),note:changeNote,oldValue:JSON.stringify(view(old)),newValue:JSON.stringify(view(entity))});
    return json({ok:true,student:view(entity)});
  }
});
