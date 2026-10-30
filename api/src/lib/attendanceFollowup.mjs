import {createHash,randomUUID} from 'node:crypto';
import {canConfirmSchoolAbsence,designatedSchoolAbsenceApprover} from './schoolAbsenceApprover.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const attendanceFollowupPartition=(schoolId,date)=>String(schoolId)+'|'+date;
export function attendanceFollowupIdentity(date,row){return {followupId:hash([date,row.studentId,row.classType,row.groupName||'',row.section||'']),recordVersion:hash([row.rowKey||'',row.createdAt||'',row.status||''])}}
export function schoolAcknowledgement(saved,version,schoolId=''){
 const current=saved?.state==='acknowledged'&&saved.recordVersion===version;
 const active=current&&saved.acknowledgedRole==='school'&&canConfirmSchoolAbsence(schoolId,saved.acknowledgedBy);
 // A previous action by another authorised viewer remains in the audit and visible
 // as historical context, but it no longer resolves Sacred Heart's pending alert.
 return {state:active?'acknowledged':'pending',acknowledgedRole:active?'school':'',
  note:active?String(saved.note||''):'',acknowledgedAt:active?String(saved.acknowledgedAt||''):'',
  acknowledgedBy:active?String(saved.acknowledgedBy||''):'',
  adminAcknowledgedBy:current&&!active?String(saved.acknowledgedBy||''):'',
  adminAcknowledgedAt:current&&!active?String(saved.acknowledgedAt||''):'',
  requiredAcknowledgedBy:designatedSchoolAbsenceApprover(schoolId)};
}
export async function readAttendanceFollowups(client,schoolId,date){
 const partition=attendanceFollowupPartition(schoolId,date).replaceAll("'","''"),rows=new Map();
 for await(const row of client.listEntities({queryOptions:{filter:"PartitionKey eq '"+partition+"'"}}))if(row.kind==='state')rows.set(row.rowKey,row);
 return rows;
}
export async function acknowledgeSchoolAbsence({client,schoolId,date,target,actor,note=''}){
 if(!canConfirmSchoolAbsence(schoolId,actor))return {status:403,error:'僅指定的曾老師帳號可以完成缺席知悉確認'};
 if(!target||target.status!=='absent'||!['section','ensemble','comprehensive'].includes(target.classType))return {status:409,error:'缺席紀錄已異動，請重新整理後再確認'};
 const partitionKey=attendanceFollowupPartition(schoolId,date),rowKey=target.followupId;
 const saved=await client.getEntity(partitionKey,rowKey).catch(e=>{if(e.statusCode===404)return null;throw e});
 if(schoolAcknowledgement(saved,target.recordVersion,schoolId).state==='acknowledged')return {status:200,ok:true,alreadyAcknowledged:true};
 const at=new Date().toISOString(),fields={state:'acknowledged',recordVersion:target.recordVersion,studentId:target.studentId,classType:target.classType,groupName:target.groupName||'',section:target.section||'',date,acknowledgedAt:at,acknowledgedBy:String(actor||''),acknowledgedRole:'school',note:String(note||'').trim().slice(0,250)};
 await client.createEntity({partitionKey,rowKey:'audit_'+randomUUID().replaceAll('-',''),kind:'audit',...fields});
 const entry={partitionKey,rowKey,kind:'state',...fields};
 try{if(saved)await client.updateEntity(entry,'Replace',{etag:saved.etag});else await client.createEntity(entry)}catch(e){if([409,412].includes(e.statusCode))return {status:409,error:'其他校方人員剛更新此筆紀錄，請重新整理'};throw e}
 return {status:200,ok:true,acknowledgedAt:at,acknowledgedBy:fields.acknowledgedBy,message:'指定校方老師已確認知悉，缺席及成績紀錄保留'};
}
