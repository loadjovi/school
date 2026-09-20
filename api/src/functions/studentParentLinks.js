import { app } from "@azure/functions";
import { getTenantContext, getStudentAliasInfo, json } from "../lib/auth.js";
import { ensureTenantTables, table, getStudentMaster, rowKey, tenantParentPartition, tenantSchoolPartition, tenantStudentPartition } from "../lib/storage.js";

function clean(v,max=200){return String(v||"").trim().slice(0,max)}

async function registrationById(id,schoolId){
  const key=clean(id,160);
  if(!key)return null;
  try{return await table("tenantRegistrations").getEntity(tenantSchoolPartition(schoolId),key)}
  catch(e){if(e.statusCode===404)return null;throw e}
}

app.http("studentParentLinks",{
  methods:["GET","PATCH"],authLevel:"anonymous",route:"student-parent-links",
  handler:async(request)=>{
    const context=await getTenantContext(request);if(context.error)return context.error;
    const {access,schoolId}=context;
    if(access.role!=="admin")return json({error:"Forbidden"},403);
    await ensureTenantTables();

    if(request.method==="PATCH"){
      const body=await request.json();
      const originalParentEmail=clean(body.originalParentEmail,320).toLowerCase();
      const originalStudentId=clean(body.originalStudentId,120);
      const action=clean(body.action,40);
      if(!originalParentEmail||!originalStudentId)return json({error:"缺少原始家長 Gmail 或學生 ID"},400);

      if(action==="remove_binding"){
        let old;
        try{old=await table("tenantUserStudentMap").getEntity(tenantParentPartition(schoolId,originalParentEmail),originalStudentId)}
        catch(e){if(e.statusCode===404)return json({error:"找不到家長綁定，可能已經移除"},404);throw e}
        const alias=await getStudentAliasInfo(originalStudentId,schoolId);
        const studentId=alias.canonicalStudentId||originalStudentId;
        const now=new Date().toISOString();
        await table("tenantUserStudentMap").deleteEntity(tenantParentPartition(schoolId,originalParentEmail),originalStudentId);
        if(old.registrationId){
          const reg=await registrationById(old.registrationId,schoolId);
          if(reg&&String(reg.status||"")==="approved"){
            await table("tenantRegistrations").updateEntity({
              partitionKey:tenantSchoolPartition(schoolId),rowKey:String(old.registrationId),schoolId,
              status:"revoked",revokedAt:now,revokedBy:access.email,revokeReason:"parent_binding_removed"
            },"Merge");
          }
        }
        await table("tenantStudentHistory").createEntity({
          partitionKey:tenantStudentPartition(schoolId,studentId),rowKey:rowKey("hist"),schoolId,studentId,changeType:"parent_binding_removed",
          changedAt:now,changedBy:access.email,
          oldValue:JSON.stringify({parentEmail:originalParentEmail,studentId:originalStudentId,relationship:String(old.relationship||""),parentName:String(old.parentName||"")}),
          newValue:JSON.stringify(null),registrationId:String(old.registrationId||"")
        });
        return json({ok:true,removed:true,parentEmail:originalParentEmail,studentId,removedAt:now,removedBy:access.email});
      }

      const parentEmail=clean(body.parentEmail,320).toLowerCase();
      const targetStudentId=clean(body.studentId,20);
      const parentName=clean(body.parentName,80);
      const relationship=clean(body.relationship,30)||"家長";

      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail))return json({error:"家長 Gmail 格式不正確"},400);
      if(!/^\d{6}$/.test(targetStudentId))return json({error:"請選擇正式 6 碼學號的學生"},400);

      let old;
      try{old=await table("tenantUserStudentMap").getEntity(tenantParentPartition(schoolId,originalParentEmail),originalStudentId)}
      catch(e){if(e.statusCode===404)return json({error:"找不到原始家長綁定，請重新整理後再試"},404);throw e}

      const master=await getStudentMaster(targetStudentId,schoolId);
      if(!master||String(master.status||"active")==="inactive")return json({error:"目標學生不存在或已停用"},404);

      const now=new Date().toISOString();
      const next={
        partitionKey:tenantParentPartition(schoolId,parentEmail),rowKey:targetStudentId,schoolId,parentEmail,studentId:targetStudentId,
        relationship,
        parentName:parentName||String(old.parentName||""),
        status:"active",
        registrationId:String(old.registrationId||""),
        studentName:String(master.studentName||""),
        grade:String(master.grade||""),
        groupName:String(master.groupName||""),
        instrument:String(master.instrument||""),
        schoolYear:String(master.schoolYear||""),
        studentNo:targetStudentId,
        createdAt:String(old.createdAt||now),
        correctedAt:now,correctedBy:access.email
      };

      await table("tenantUserStudentMap").upsertEntity(next,"Merge");
      if(originalParentEmail!==parentEmail||originalStudentId!==targetStudentId){
        await table("tenantUserStudentMap").deleteEntity(tenantParentPartition(schoolId,originalParentEmail),originalStudentId);
      }

      if(old.registrationId){
        try{
          const reg=await table("tenantRegistrations").getEntity(tenantSchoolPartition(schoolId),String(old.registrationId));
          await table("tenantRegistrations").updateEntity({
            partitionKey:tenantSchoolPartition(schoolId),rowKey:String(old.registrationId),schoolId,
            parentEmail,parentName:parentName||String(reg.parentName||""),relationship,
            studentId:targetStudentId,studentName:String(master.studentName||""),
            grade:String(master.grade||""),groupName:String(master.groupName||""),
            instrument:String(master.instrument||""),schoolYear:String(master.schoolYear||""),
            correctedAt:now,correctedBy:access.email
          },"Merge");
        }catch(e){if(e.statusCode!==404)throw e}
      }

      const oldValue={parentEmail:originalParentEmail,studentId:originalStudentId,relationship:String(old.relationship||""),parentName:String(old.parentName||"")};
      const newValue={parentEmail,studentId:targetStudentId,relationship,parentName:parentName||String(old.parentName||"")};
      await table("tenantStudentHistory").createEntity({
        partitionKey:tenantStudentPartition(schoolId,targetStudentId),rowKey:rowKey("hist"),schoolId,studentId:targetStudentId,changeType:"parent_binding_correction",
        changedAt:now,changedBy:access.email,oldValue:JSON.stringify(oldValue),newValue:JSON.stringify(newValue),
        registrationId:String(old.registrationId||"")
      });

      return json({ok:true,item:{
        studentId:targetStudentId,sourceStudentId:targetStudentId,parentEmail,
        parentName:newValue.parentName,relationship,status:"active",
        registrationId:String(old.registrationId||""),correctedAt:now,correctedBy:access.email
      }});
    }

    const items=[];
    const seen=new Set();
    const sid=tenantSchoolPartition(schoolId).replaceAll("'","''");
    for await (const e of table("tenantUserStudentMap").listEntities({queryOptions:{filter:`schoolId eq '${sid}' and status eq 'active'`}})){
      const sourceStudentId=clean(e.rowKey,120);
      if(!sourceStudentId)continue;
      const alias=await getStudentAliasInfo(sourceStudentId,schoolId);
      const studentId=alias.canonicalStudentId||sourceStudentId;
      const parentEmail=clean(e.parentEmail,200).toLowerCase();
      const key=`${studentId}|${parentEmail}`;
      if(seen.has(key))continue;
      seen.add(key);
      const reg=await registrationById(e.registrationId,schoolId);
      items.push({
        studentId,
        sourceStudentId,
        parentEmail,
        parentName:clean(e.parentName||reg?.parentName,80),
        relationship:clean(e.relationship||reg?.relationship,30),
        status:clean(e.status||"active",20),
        registrationId:clean(e.registrationId,160),
        createdAt:clean(e.createdAt||reg?.createdAt,80)
      });
    }

    items.sort((a,b)=>String(a.studentId).localeCompare(String(b.studentId))||String(a.relationship).localeCompare(String(b.relationship),"zh-Hant")||String(a.parentEmail).localeCompare(String(b.parentEmail)));
    return json({items});
  }
});
