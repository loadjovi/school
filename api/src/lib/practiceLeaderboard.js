import { uniquePracticeRows } from "./practiceRecords.js";

const round2=value=>Math.round(value*100)/100;
// Match the tenant storage reader's handling of old rows without an explicit studentId.
const activityStudentId=row=>{
  const explicit=String(row.studentId||"").trim();
  if(explicit)return explicit;
  const partition=String(row.partitionKey||""),marker="|student|",index=partition.indexOf(marker);
  return index>=0?partition.slice(index+marker.length):partition;
};

export function practiceScoreMonths(today){
  const year=Number(String(today).slice(0,4)),month=Number(String(today).slice(5,7));
  if(month>=8)return [10,11,12].map(m=>`${year}-${String(m).padStart(2,"0")}`);
  if(month===1)return [10,11,12].map(m=>`${year-1}-${String(m).padStart(2,"0")}`);
  return [2,3,4,5].map(m=>`${year}-${String(m).padStart(2,"0")}`);
}

export function maskedStudentName(name){
  const chars=Array.from(String(name||"").trim());
  return chars.length?`${chars[0]}${"○".repeat(Math.max(1,chars.length-1))}`:"學生";
}

export function buildPracticeLeaderboard({students=[],rows=[],months=[],today,studentId,qualifiedMinutes=15,targetDays=30}){
  const includedMonths=months.filter(month=>month<=String(today).slice(0,7));
  const byMonth=new Map(includedMonths.map(month=>[month,{
    target:Math.max(1,Math.min(targetDays,month===String(today).slice(0,7)
      ?Number(String(today).slice(8,10))
      :new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).getDate()))
  }]));
  if(!includedMonths.length)return {includedMonths,participantCount:0,items:[],mine:null};
  const ranked=[];
  for(const student of students){
    const aliases=new Set((student.aliases||[]).map(String));
    const parentEmails=new Set((student.safeParentEmails||[]).map(x=>String(x).toLowerCase()));
    const seen=new Map();
    for(const row of rows){
      const id=activityStudentId(row),email=String(row.createdBy||"").trim().toLowerCase();
      if(!aliases.has(id)&&!(email&&parentEmails.has(email)))continue;
      const key=`${id}|${String(row.rowKey||"")}`;
      if(!seen.has(key))seen.set(key,row);
    }
    const valid=uniquePracticeRows([...seen.values()]).filter(row=>
      byMonth.has(String(row.eventDate||"").slice(0,7))&&String(row.eventDate||"")<=today&&Number(row.minutes||0)>0
    );
    if(!valid.length)continue;
    const qualified=new Set(valid.filter(row=>row.qualified===true||Number(row.minutes||0)>=qualifiedMinutes).map(row=>String(row.eventDate||"")));
    const qualifiedDays=qualified.size,minutes=valid.reduce((n,row)=>n+Number(row.minutes||0),0);
    const monthlyScores=includedMonths.map(month=>{
      const days=[...qualified].filter(date=>date.startsWith(month)).length;
      return round2(Math.min(days/byMonth.get(month).target,1)*10);
    });
    const score10=round2(monthlyScores.reduce((n,value)=>n+value,0)/includedMonths.length);
    ranked.push({studentId:String(student.studentId),name:String(student.name||""),score10,qualifiedDays,minutes});
  }
  ranked.sort((a,b)=>b.score10-a.score10||b.qualifiedDays-a.qualifiedDays||b.minutes-a.minutes||a.studentId.localeCompare(b.studentId));
  const selected=String(studentId||"");
  const myIndex=ranked.findIndex(x=>x.studentId===selected);
  const view=(x,index)=>({rank:index+1,name:x.studentId===selected?x.name:maskedStudentName(x.name),isMine:x.studentId===selected,score10:x.score10,qualifiedDays:x.qualifiedDays,minutes:x.minutes});
  return {
    includedMonths,
    participantCount:ranked.length,
    items:ranked.slice(0,5).map(view),
    mine:myIndex<0?null:view(ranked[myIndex],myIndex)
  };
}
