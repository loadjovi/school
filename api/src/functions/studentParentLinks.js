import { app } from "@azure/functions";
import { getAccess, getStudentAliasInfo, json } from "../lib/auth.js";
import { ensureTables, table, getStudentMaster, rowKey } from "../lib/storage.js";

function clean(v,max=200){return String(v||"").trim().slice(0,max)}

async function registrationById(id){
  const key=clean(id,160);
  if(!key)return null;
  try{return await table("registrations").getEntity("REG",key)}
  catch(e){if(e.statusCode===404)return null;throw e}
}

app.http("studentParentLinks",{
  methods:["GET","PATCH"],authLevel:"anonymous",route:"student-parent-links",
  handler:async(request)=>{
    const access=await getAccess(request);
    if(!access.authenticated)return json({error:"Unauthorized"},401);
    if(access.role!=="admin")return json({error:"Forbidden"},403);
    await ensureTables();

    if(request.method==="PATCH"){
      const body=await request.json();
      const originalParentEmail=clean(body.originalParentEmail,320).toLowerCase();
      const originalStudentId=clean(body.originalStudentId,120);
      const parentEmail=clean(body.parentEmail,320).toLowerCase();
      const targetStudentId=clean(body.studentId,20);
      const parentName=clean(body.parentName,80);
      const relationship=clean(body.relationship,30)||"家長";

      if(!originalParentEmail||!originalStudentId)return json({error:"缺少原始家長 Gmail 或學生 ID"},400);
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail))return json({error:"家長 Gmail 格式不正確"},400);
      if(!/^\d{6}$/.test(targetStudentId))return json({error:"請選擇正式 6 碼學號的學生"},400);

      let old;
      try{old=await table("userStudentMap").getEntity(originalParentEmail,originalStudentId)}
      catch(e){if(e.statusCode===404)return json({error:"找不到原始家長綁定，請重新整理後再試"},404);throw e}

      const master=await getStudentMaster(targetStudentId);
      if(!master||String(master.status||"active")==="inactive")return json({error:"目標學生不存在或已停用"},404);

      const now=new Date().toISOString();
      const next={
        partitionKey:parentEmail,rowKey:targetStudentId,
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

      await table("userStudentMap").upsertEntity(next,"Merge");
      if(originalParentEmail!==parentEmail||originalStudentId!==targetStudentId){
        await table("userStudentMap").deleteEntity(originalParentEmail,originalStudentId);
      }

      if(old.registrationId){
        try{
          const reg=await table("registrations").getEntity("REG",String(old.registrationId));
          await table("registrations").updateEntity({
            partitionKey:"REG",rowKey:String(old.registrationId),
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
      await table("studentHistory").createEntity({
        partitionKey:targetStudentId,rowKey:rowKey("hist"),changeType:"parent_binding_correction",
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
    for await (const e of table("userStudentMap").listEntities({queryOptions:{filter:"status eq 'active'"}})){
      const sourceStudentId=clean(e.rowKey,120);
      if(!sourceStudentId)continue;
      const alias=await getStudentAliasInfo(sourceStudentId);
      const studentId=alias.canonicalStudentId||sourceStudentId;
      const parentEmail=clean(e.partitionKey,200).toLowerCase();
      const key=`${studentId}|${parentEmail}`;
      if(seen.has(key))continue;
      seen.add(key);
      const reg=await registrationById(e.registrationId);
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
