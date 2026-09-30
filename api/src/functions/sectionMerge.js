import { app } from "@azure/functions";
import { getTenantContext, json } from "../lib/auth.js";
import { ensureTenantTables, table, tenantSchoolPartition, getTeacherDirectory, getTeacherProfile, listStudentMaster, listActivityRange } from "../lib/storage.js";
import { enforceScheduledCourse } from "./schoolSchedule.js";
import { listSectionMerges, sectionMergeKey, sectionMergeView, validMergeDate } from "../lib/sectionMerge.js";

const email=v=>String(v||"").trim().toLowerCase();
const clean=(v,max=100)=>String(v||"").trim().slice(0,max);
const assignments=profile=>{try{return JSON.parse(String(profile?.sectionAssignments||"[]"))}catch{return []}};
const assigned=(profile,group,section)=>assignments(profile).some(x=>String(x.groupName||x.group||"")===group&&String(x.section||"")===section);

app.http("sectionMerge",{
  methods:["GET","POST","PATCH"],authLevel:"anonymous",route:"section-merge",
  handler:async request=>{
    const context=await getTenantContext(request);if(context.error)return context.error;
    const {access:a,schoolId}=context;
    if(a.role!=="admin")return json({error:"僅學校管理員可安排校內併班"},403);
    await ensureTenantTables();
    if(request.method==="GET"){
      const date=clean(request.query.get("sessionDate"),20);
      if(date&&!validMergeDate(date))return json({error:"日期格式需為 YYYY-MM-DD"},400);
      return json({items:await listSectionMerges(schoolId,date)});
    }
    const body=await request.json(),sid=tenantSchoolPartition(schoolId);
    if(request.method==="PATCH"){
      if(body.action!=="cancel")return json({error:"不支援的異動"},400);
      const id=clean(body.mergeId,240);if(!id)return json({error:"缺少併班編號"},400);
      let row;try{row=await table("tenantSectionMerge").getEntity(sid,id)}catch(e){if(e.statusCode===404)return json({error:"找不到併班安排"},404);throw e}
      if(row.status!=="active")return json({error:"此安排已取消"},409);
      row.status="cancelled";row.cancelledAt=new Date().toISOString();row.cancelledBy=a.email;
      await table("tenantSectionMerge").updateEntity({partitionKey:sid,rowKey:id,status:row.status,cancelledAt:row.cancelledAt,cancelledBy:row.cancelledBy},"Merge",{etag:row.etag});
      return json({ok:true,item:sectionMergeView(row)});
    }
    const sessionDate=clean(body.sessionDate,20),groupName=clean(body.groupName,40),sourceSection=clean(body.sourceSection,60),targetSection=clean(body.targetSection,60);
    const absentTeacherEmail=email(body.absentTeacherEmail),receivingTeacherEmail=email(body.receivingTeacherEmail),reason=clean(body.reason,180);
    if(!validMergeDate(sessionDate)||!groupName||!sourceSection||!targetSection||sourceSection===targetSection||!reason||!absentTeacherEmail||!receivingTeacherEmail)return json({error:"請填寫日期、團別、不同的原／接課分部、兩位老師及併班原因"},400);
    if(absentTeacherEmail===receivingTeacherEmail)return json({error:"請假與接課老師不可相同"},400);
    const schedule=await enforceScheduledCourse(schoolId,sessionDate,"section",groupName);
    if(schedule.enforced&&!schedule.allowed)return json({error:schedule.reason},409);
    const [absent,receiving,absentProfile,receivingProfile,students,existing,attendance]=await Promise.all([
      getTeacherDirectory(absentTeacherEmail,schoolId),getTeacherDirectory(receivingTeacherEmail,schoolId),
      getTeacherProfile(absentTeacherEmail,schoolId),getTeacherProfile(receivingTeacherEmail,schoolId),
      listStudentMaster("active",schoolId),listSectionMerges(schoolId,sessionDate),listActivityRange("section",schoolId,"","",sessionDate)
    ]);
    if(absent?.status!=="active"||receiving?.status!=="active")return json({error:"兩位老師都必須是本校啟用中的老師"},400);
    if(!assigned(absentProfile,groupName,sourceSection)||!assigned(receivingProfile,groupName,targetSection))return json({error:"原分部與接課分部必須符合兩位老師目前的授課設定"},400);
    if(!students.some(x=>x.groupName===groupName&&x.section===sourceSection)||!students.some(x=>x.groupName===groupName&&x.section===targetSection))return json({error:"原分部與接課分部都需有在團學生"},400);
    const active=existing.filter(x=>x.status==="active"&&x.groupName===groupName);
    if(active.some(x=>x.sourceSection===sourceSection||x.sourceSection===targetSection||x.targetSection===sourceSection))return json({error:"此日期的原分部或接課分部已有併班安排，請先檢查或取消"},409);
    if(active.some(x=>x.targetSection===targetSection&&x.receivingTeacherEmail!==receivingTeacherEmail))return json({error:"接課分部已有不同老師的併班安排"},409);
    if(attendance.some(x=>x.groupName===groupName&&x.section===sourceSection))return json({error:"原分部已有點名紀錄，請先由校方確認後再調整，避免重算工時"},409);
    const id=sectionMergeKey(sessionDate,groupName,sourceSection),now=new Date().toISOString();
    let previous=null;try{previous=await table("tenantSectionMerge").getEntity(sid,id)}catch(e){if(e.statusCode!==404)throw e}
    const row={partitionKey:sid,rowKey:id,schoolId:sid,sessionDate,groupName,sourceSection,targetSection,absentTeacherEmail,absentTeacherName:String(absent.teacherName||absentTeacherEmail),receivingTeacherEmail,receivingTeacherName:String(receiving.teacherName||receivingTeacherEmail),reason,status:"active",createdAt:now,createdBy:a.email,cancelledAt:"",cancelledBy:""};
    if(previous)await table("tenantSectionMerge").updateEntity(row,"Replace",{etag:previous.etag});
    else await table("tenantSectionMerge").createEntity(row);
    return json({ok:true,item:sectionMergeView(row)},201);
  }
});
