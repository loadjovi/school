import { app } from "@azure/functions";
import { getAccess, getStudentAliasInfo, json } from "../lib/auth.js";
import { ensureTables, table } from "../lib/storage.js";

function clean(v,max=200){return String(v||"").trim().slice(0,max)}

async function registrationById(id){
  const key=clean(id,160);
  if(!key)return null;
  try{return await table("registrations").getEntity("REG",key)}
  catch(e){if(e.statusCode===404)return null;throw e}
}

app.http("studentParentLinks",{
  methods:["GET"],authLevel:"anonymous",route:"student-parent-links",
  handler:async(request)=>{
    const access=await getAccess(request);
    if(!access.authenticated)return json({error:"Unauthorized"},401);
    if(access.role!=="admin")return json({error:"Forbidden"},403);
    await ensureTables();

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
