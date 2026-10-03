import { createHash } from "node:crypto";

// 正式規則：同一學生同一天的有效紀錄累計滿 20 分鐘，該日計為一個達標日。
// 不使用舊紀錄上的 qualified 布林值，避免原先 15 分鐘門檻繼續影響成績。
export const PRACTICE_QUALIFIED_MINUTES=20;

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

export function practiceDayTotals(rows=[]){
  const totals=new Map();
  for(const row of uniquePracticeRows(rows)){
    const date=String(row.eventDate||row.practiceDate||"").slice(0,10),minutes=Number(row.minutes||0);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(minutes)||minutes<=0)continue;
    totals.set(date,(totals.get(date)||0)+minutes);
  }
  return totals;
}

export function qualifiedPracticeDates(rows=[]){
  return new Set([...practiceDayTotals(rows)].filter(([,minutes])=>minutes>=PRACTICE_QUALIFIED_MINUTES).map(([date])=>date));
}
