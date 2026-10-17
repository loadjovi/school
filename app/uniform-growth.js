// Build a read-only size timeline from parent-scoped requests and existing historical records.
// Pending purchases are shown as plans, never as items already received.
const requestLabels={PENDING:"待學校審核",APPROVED:"已核准，尚未領取",ORDERED:"已採購，尚未領取",ARRIVED:"已到貨，尚未領取",READY_FOR_PICKUP:"可領取，尚未確認實領",FULFILLED:"已完成領用"};
export function buildUniformGrowth(student,kind,tshirt,requests,paperClass,rosterUniform){
 const id=String(student.studentId||student.id||"");
 const entries=[];
 if(kind==="regularUniform"&&tshirt?.historicalIssued===true){
  const grade=tshirt.receivedGrade?`${tshirt.receivedGrade} 年級領用`:"領取年級待核對";
  entries.push({type:"baseline",size:tshirt.size||"",title:"首次團 T 領用",detail:grade,received:true,confirmed:false});
 }
 if(kind==="regularUniform"&&tshirt?.historicalIssued===false&&tshirt.size){
  entries.push({type:"sizeSurvey",size:tshirt.size,title:"預計購買團 T 尺寸",detail:"尚未領取；尺寸供後續採購統計使用。",received:false,confirmed:false});
 }
 if(kind==="competitionUniform"&&rosterUniform){
  const received=Boolean(paperClass);
  entries.push({type:"baseline",size:rosterUniform.size,style:rosterUniform.style,title:received?"已領用比賽服":"目前名單登記尺寸",detail:received?`${paperClass.slice(0,1)} 年級領取（${paperClass}）｜${rosterUniform.style}款 ${rosterUniform.size}`:`${rosterUniform.style}款 ${rosterUniform.size}｜領用紀錄待學校確認`,received,confirmed:received});
 }
 const relevant=requests.filter(r=>String(r.studentId)===id&&r.kind===kind&&r.status!=="CANCELLED")
  .sort((a,b)=>String(a.createdAt||"").localeCompare(String(b.createdAt||""))||String(a.id||"").localeCompare(String(b.id||"")));
 for(const r of relevant){
  const status=requestLabels[r.status]||"進度待確認";
  const purchase=r.acquisition==="PURCHASE"||/新購|加購|買斷|購買/.test(String(r.note||""));
  const title=r.acquisition==="PUBLIC"?"公費配發申請":r.acquisition==="RENTAL"?"租借申請":purchase?"新購／加購":"團服申請";
  entries.push({type:"purchase",size:r.size||"",style:r.style||"",title,detail:status,date:r.createdAt||"",received:r.status==="FULFILLED",confirmed:r.status==="FULFILLED",status:r.status});
 }
 const sized=entries.filter(e=>e.size);
 let comparison="";
 if(sized.length>=2){
  const last=sized.at(-1),previous=sized.at(-2);
  if(previous.size!==last.size)comparison=`${previous.received?"尺寸變化":"名單尺寸與申請尺寸"}：${previous.size} → ${last.size}${last.received?"（已完成領用）":"（新尺寸仍在申請／領取流程）"}`;
 }
 return {entries,comparison};
}
