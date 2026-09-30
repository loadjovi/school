import { ensureTenantTables, table, tenantSchoolPartition } from "./storage.js";

const safe=v=>String(v||"").replaceAll("'","''");
export const validMergeDate=v=>{
  const value=String(v||"");if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const [year,month,day]=value.split("-").map(Number),date=new Date(Date.UTC(year,month-1,day));
  return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day;
};
export const sectionMergeKey=(date,group,source)=>"merge_"+Buffer.from(JSON.stringify([date,group,source]),"utf8").toString("base64url");

export function sectionMergeView(e){return {
  mergeId:String(e.rowKey||""),sessionDate:String(e.sessionDate||""),groupName:String(e.groupName||""),
  sourceSection:String(e.sourceSection||""),targetSection:String(e.targetSection||""),
  absentTeacherEmail:String(e.absentTeacherEmail||""),absentTeacherName:String(e.absentTeacherName||""),
  receivingTeacherEmail:String(e.receivingTeacherEmail||""),receivingTeacherName:String(e.receivingTeacherName||""),
  reason:String(e.reason||""),status:String(e.status||"active"),createdAt:String(e.createdAt||""),
  createdBy:String(e.createdBy||""),cancelledAt:String(e.cancelledAt||""),cancelledBy:String(e.cancelledBy||"")
}}

export async function listSectionMerges(schoolId,sessionDate=""){
  await ensureTenantTables();
  const parts=[`PartitionKey eq '${safe(tenantSchoolPartition(schoolId))}'`];
  if(sessionDate)parts.push(`sessionDate eq '${safe(sessionDate)}'`);
  const rows=[];
  for await(const e of table("tenantSectionMerge").listEntities({queryOptions:{filter:parts.join(" and ")}}))rows.push(sectionMergeView(e));
  return rows.sort((a,b)=>b.sessionDate.localeCompare(a.sessionDate)||b.createdAt.localeCompare(a.createdAt));
}

export function receivingMerges(items,date,group,section,email){
  return items.filter(x=>x.status==="active"&&x.sessionDate===date&&x.groupName===group&&x.targetSection===section&&x.receivingTeacherEmail===email);
}
