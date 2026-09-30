import { createHash } from "node:crypto";

export function practiceSessionKey(row={}){
  const date=String(row.practiceDate||row.eventDate||"").trim();
  const start=String(row.startTime||"").trim();
  const end=String(row.endTime||"").trim();
  return date&&start&&end?JSON.stringify([date,start,end]):"";
}

export function practiceSessionId(schoolId,studentId,row){
  const key=practiceSessionKey(row);
  if(!key)throw new Error("練習日期與起訖時間不可空白");
  return `p_session_${createHash("sha256").update(JSON.stringify([schoolId,studentId,key])).digest("hex").slice(0,32)}`;
}

export function groupPracticeRows(rows=[]){
  const groups=new Map();
  const ordered=[...rows].sort((a,b)=>String(a.createdAt||"").localeCompare(String(b.createdAt||""))||String(a.rowKey||"").localeCompare(String(b.rowKey||"")));
  for(const [index,row] of ordered.entries()){
    const key=practiceSessionKey(row)||(row.rowKey?`row:${row.partitionKey||""}:${row.rowKey}`:`unknown:${index}`);
    if(!groups.has(key))groups.set(key,{record:row,duplicates:[]});
    else groups.get(key).duplicates.push(row);
  }
  return [...groups.values()];
}

export function uniquePracticeRows(rows=[]){return groupPracticeRows(rows).map(x=>x.record)}
