// Resolve A-group competition-uniform requests against the student master.
// Keep the paper roster intact for historical handover verification.
export const normalizedStudentName=value=>String(value||"").trim().normalize("NFC").replace(/\s+/g,"");
const requestTime=row=>String(row.updatedAt||row.createdAt||"");
const activeRequest=row=>row&&row.kind==="competitionUniform"&&row.status!=="CANCELLED";
const statusNames={
 PENDING:"待學校審核",APPROVED:"已核准",ORDERED:"已採購",
 ARRIVED:"已到貨",READY_FOR_PICKUP:"待領取",FULFILLED:"已完成領用"
};
function applicationText(row){
 const stage=statusNames[row.status]||"流程待確認";
 if(row.acquisition==="PUBLIC")return row.status==="PENDING"?"公費待審核":"公費配發｜"+stage;
 if(row.acquisition==="PURCHASE"){
  const payment=String(row.paymentStatus||"");
  if(payment==="VERIFIED")return "買斷｜已核帳";
  if(payment==="REPORTED_UNVERIFIED")return "買斷｜待核帳";
  if(payment==="AWAITING_TRANSFER")return "買斷｜待匯款";
  return "買斷｜"+stage;
 }
 if(row.acquisition==="RENTAL")return "租借｜"+stage;
 return "取得方式待確認｜"+stage;
}
export function reconcileCompetitionRoster(roster,studentMasters,requests){
 const names=new Map();
 for(const student of Array.isArray(studentMasters)?studentMasters:[]){
  const name=normalizedStudentName(student.name||student.studentName);
  const id=String(student.studentId||student.id||"").trim();
  if(!name||!id)continue;
  if(!names.has(name))names.set(name,new Set());
  names.get(name).add(id);
 }
 const byStudent=new Map();
 for(const request of Array.isArray(requests)?requests:[]){
  if(!activeRequest(request))continue;
  const id=String(request.studentId||"").trim();
  if(!id)continue;
  if(!byStudent.has(id))byStudent.set(id,[]);
  byStudent.get(id).push(request);
 }
 for(const items of byStudent.values())items.sort((a,b)=>
  requestTime(b).localeCompare(requestTime(a))||String(b.id||"").localeCompare(String(a.id||""))
 );
 return roster.map(row=>{
  const ids=names.get(normalizedStudentName(row[1]));
  const matched=ids?.size===1;
  const id=matched?[...ids][0]:null;
  const latest=id?byStudent.get(id)?.[0]:null;
  const current=latest&&["PUBLIC","PURCHASE","RENTAL","PENDING"].includes(latest.acquisition)?latest:null;
  const undecided=!current&&row[4]==="待確認";
  const choice=current
   ?(current.acquisition==="PUBLIC"?"公費配發":current.acquisition==="PURCHASE"?"自費買斷":current.acquisition==="RENTAL"?"租借":"待確認")
   :row[4];
  return {
   row,studentId:id,
   ambiguous:ids?.size>1,
   linked:Boolean(current),
   choice,
   detail:current?applicationText(current):undecided?"尚無正式申請，待家長選擇":"原始登記紀錄（未連結新申請）",
   requestStatus:current?.status||"",
   requestId:current?.id||"",
   style:current?.style||row[2],
   size:current?.size||row[3],
   undecided,
   changedSize:Boolean(current&&(current.style!==row[2]||current.size!==row[3]))
  };
 });
}
