import { table, tenantIdValue } from "./storage.js";

export const TENANT_ISOLATION_DATASETS=[
  {key:"tenantStudentMaster",label:"學生主檔",kind:"school"},
  {key:"tenantRegistrations",label:"家長申請",kind:"school"},
  {key:"tenantUserStudentMap",label:"家長綁定",kind:"parent"},
  {key:"tenantStudentHistory",label:"學生異動",kind:"student"},
  {key:"tenantSemesterEnrollment",label:"學期名單",kind:"term"},
  {key:"tenantTeacherDirectory",label:"老師帳號",kind:"school"},
  {key:"tenantTeacherProfile",label:"老師權限",kind:"school"},
  {key:"tenantAcademicYearBatch",label:"學年度批次",kind:"school"},
  {key:"tenantPractice",label:"自主練習",kind:"student"},
  {key:"tenantSection",label:"分部課",kind:"student"},
  {key:"tenantEnsemble",label:"合奏課",kind:"student"},
  {key:"tenantComprehensive",label:"綜合課",kind:"student"},
  {key:"tenantPrivateLesson",label:"個別課",kind:"student"}
];

function validTenantPartition(entity,schoolIds,kind){
  const schoolId=tenantIdValue(entity.schoolId),partition=String(entity.partitionKey||"");
  if(!schoolId||!schoolIds.has(schoolId))return {valid:false,schoolId};
  if(kind==="school")return {valid:partition===schoolId,schoolId};
  return {valid:partition.startsWith(`${schoolId}|${kind}|`),schoolId};
}

export async function scanTenantIsolation(schoolIdsInput){
  const schoolIds=schoolIdsInput instanceof Set?schoolIdsInput:new Set((schoolIdsInput||[]).map(tenantIdValue).filter(Boolean));
  const byTable=[],bySchool={};let rows=0,invalid=0;
  for(const definition of TENANT_ISOLATION_DATASETS){
    let count=0,bad=0;
    for await(const entity of table(definition.key).listEntities()){
      count++;const result=validTenantPartition(entity,schoolIds,definition.kind);
      if(!result.valid)bad++;
      else bySchool[result.schoolId]=Number(bySchool[result.schoolId]||0)+1;
    }
    rows+=count;invalid+=bad;byTable.push({key:definition.key,label:definition.label,rows:count,invalid:bad});
  }
  let roleRows=0,invalidRoles=0;
  for await(const role of table("tenantUserRole").listEntities()){
    roleRows++;
    const roleName=String(role.role||""),schoolId=String(role.schoolId||""),rowKey=String(role.rowKey||""),status=String(role.status||"");
    const validStatus=["active","inactive"].includes(status);
    const validRole=roleName==="globalAdmin"
      ?schoolId==="*"&&rowKey==="GLOBAL"
      :roleName==="schoolAdmin"&&schoolIds.has(tenantIdValue(schoolId))&&tenantIdValue(rowKey)===tenantIdValue(schoolId);
    const valid=validStatus&&validRole;
    if(!valid)invalidRoles++;
  }
  rows+=roleRows;invalid+=invalidRoles;byTable.push({key:"tenantUserRole",label:"Tenant 權限",rows:roleRows,invalid:invalidRoles});
  return {rows,invalid,byTable,bySchool};
}
