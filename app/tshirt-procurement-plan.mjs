import {isCurrentTshirtStudent} from "./tshirt-roster-status.mjs";

export const TSHIRT_PLAN_SIZES=["8","10","12","XS","S","M","L","XL","2L","3L","5L"];
export const STAFF_CATEGORIES={CADRE_FIRST:"幹部首次公費",CADRE_EXTRA:"幹部自費加購",VOLUNTEER_EXTRA:"志工自費加購"};
export function currentTshirtTerm(now=new Date()){
 const [year,month]=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit"}).format(now).split("-").map(Number);
 return {schoolYear:year-1911-(month<8?1:0),semester:month>=2&&month<8?2:1};
}
export function tshirtTerm(schoolYear,semester){
 const year=Number(schoolYear),term=Number(semester);
 if(!Number.isSafeInteger(year)||year<100||year>200||![1,2].includes(term))throw Error("請確認學年度與學期");
 const start=term===1?`${year+1911}-08-01`:`${year+1912}-02-01`;
 const end=term===1?`${year+1912}-02-01`:`${year+1912}-08-01`;
 return {schoolYear:year,semester:term,start,end,label:`${year} 學年度${term===1?"上":"下"}學期`};
}
const groupOf=s=>String(s.groupName||s.group||"").trim().toUpperCase().replace(/\s/g,"").replace(/團$/,"").replace(/^儲備$/,"C");
const positive=v=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):0;
const day=value=>{
 if(!value||!Number.isFinite(Date.parse(value)))return "";
 return new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(value));
};
const within=(value,term)=>{const d=day(value);return !!d&&d>=term.start&&d<term.end};
const outstanding=status=>["PENDING","APPROVED","ORDERED","ARRIVED","READY_FOR_PICKUP"].includes(status);

// A read-only procurement snapshot. Size backfills never become repeat orders.
export function buildTshirtProcurementPlan({students=[],history=[],requests=[],stock=[],staffDemands=[],parentLoans=[],schoolYear,semester,extraBySize={}}){
 const term=tshirtTerm(schoolYear,semester),byHistory=new Map(history.map(x=>[String(x.studentId),x]));
 const current=students.filter(s=>isCurrentTshirtStudent(s)&&["A","B","C"].includes(groupOf(s)));
 const studentMap=new Map(current.map(s=>[String(s.studentId||s.id),s]));
 const rows=[],warnings=[];let excludedRequests=0,carryover=0;
 for(const student of current){
  const id=String(student.studentId||student.id),h=byHistory.get(id),group=groupOf(student);
  const issued=h?(h.historicalIssued===true||h.received===true||positive(h.issuedQuantity)>0):(["A","B"].includes(group)&&String(student.studentName||student.name||"").replace(/\s/g,"")!=="李沛臻");
  const handed=Boolean(h?.schoolIssuedAt)||h?.source==="PARENT_CONFIRMED_FIRST_PUBLIC";
  // A past physical handoff awaiting parent acknowledgement is not a new order.
  if((issued||handed)&&!within(h?.schoolIssuedAt||h?.receivedAt,term))continue;
  rows.push({type:"STUDENT_FIRST",category:"學生首次公費",person:String(student.studentName||student.name||id),studentId:id,group:group==="C"?"儲備團":group+" 團",size:String(h?.schoolIssuedSize||h?.receivedSize||h?.size||""),quantity:1,status:handed||issued?"已交付":"待首次發放",covered:handed||issued,ready:true,requestId:"",note:handed&&!issued?"學校已交付，待家長確認；不重複採購":""});
 }
 for(const request of requests){
  if(request.kind!=="regularUniform"||request.status==="CANCELLED")continue;
  const student=studentMap.get(String(request.studentId));
  if(!student){excludedRequests++;continue}
  const inTerm=within(request.createdAt,term),overdue=outstanding(request.status)&&(!day(request.createdAt)||day(request.createdAt)<term.start);
  if(!inTerm&&!overdue)continue;
  if(overdue)carryover++;
  const quantity=positive(request.quantity);
  if(!quantity){warnings.push("部分加購申請件數異常，請核對申請紀錄");continue}
  const covered=["ORDERED","ARRIVED","READY_FOR_PICKUP","FULFILLED"].includes(request.status);
  const ready=request.status==="APPROVED"&&request.paymentStatus==="VERIFIED";
  const labels={PENDING:"待審核",APPROVED:request.paymentStatus==="VERIFIED"?"已核帳，待採購":request.paymentStatus==="REPORTED_UNVERIFIED"?"待財務核帳":"待匯款",ORDERED:"已採購待到貨",ARRIVED:"已到貨",READY_FOR_PICKUP:"可領取",FULFILLED:"已領取"};
  rows.push({type:"STUDENT_EXTRA",category:"學生自費加購",person:String(student.studentName||student.name||request.studentId),studentId:String(request.studentId),group:groupOf(student)==="C"?"儲備團":groupOf(student)+" 團",size:String(request.size||""),quantity,status:labels[request.status]||"狀態待核對",covered,ready,requestId:request.id||"",note:overdue?"跨期未結案，併入目前需求":""});
 }
 const loanMap=new Map(parentLoans.map(x=>[String(x.parentEmail||"").toLowerCase(),x]));
 for(const demand of staffDemands){
  if(demand.status==="CANCELLED"||!STAFF_CATEGORIES[demand.category])continue;
  const inTerm=Number(demand.schoolYear)===term.schoolYear&&Number(demand.semester)===term.semester;
  const previous=Number(demand.schoolYear)<term.schoolYear||Number(demand.schoolYear)===term.schoolYear&&Number(demand.semester)<term.semester;
  if(!inTerm&&!(previous&&outstanding(demand.status)))continue;
  const quantity=positive(demand.quantity);if(!quantity)continue;
  if(!inTerm)carryover++;
  const physical=loanMap.get(String(demand.parentEmail||"").toLowerCase());
  const handed=demand.category==="CADRE_FIRST"&&physical?.status==="ISSUED_LIFETIME";
  const covered=handed||["ORDERED","ARRIVED","READY_FOR_PICKUP","FULFILLED"].includes(demand.status);
  rows.push({type:demand.category,category:STAFF_CATEGORIES[demand.category],person:demand.parentName||demand.parentEmail||"姓名待核對",studentId:demand.studentId||"",group:demand.category.startsWith("CADRE")?"幹部":"志工",size:demand.size||"",quantity,status:handed?"已領取（領用紀錄）":({PENDING:"待確認",APPROVED:demand.paymentStatus==="VERIFIED"||demand.category==="CADRE_FIRST"?"已確認，待採購":"待財務核帳",ORDERED:"已採購待到貨",ARRIVED:"已到貨",FULFILLED:"已處理完成"})[demand.status]||demand.status,covered,ready:demand.category==="CADRE_FIRST"||demand.paymentStatus==="VERIFIED",requestId:demand.id||"",note:!inTerm?"跨期未結案，併入目前需求":""});
 }
 for(const loan of parentLoans){
  if(loan.role!=="CADRE"||loan.status!=="ISSUED_LIFETIME"||!within(loan.issuedAt,term)||rows.some(x=>x.type==="CADRE_FIRST"&&staffDemands.some(d=>d.id===x.requestId&&d.parentEmail===loan.parentEmail)))continue;
  rows.push({type:"CADRE_FIRST",category:STAFF_CATEGORIES.CADRE_FIRST,person:loan.parentName||"家長",studentId:loan.studentId||"",group:"幹部",size:loan.size||"",quantity:1,status:"已領取（領用紀錄）",covered:true,ready:true,requestId:"",note:"本學期已完成首次領用，不重複採購"});
 }
 const incomingExtras=new Map();
 for(const request of requests){
  if(request.kind!=="regularUniform"||request.status!=="ORDERED"||!studentMap.has(String(request.studentId)))continue;
  if(!Array.isArray(request.procurementBreakdown)){
   if(positive(request.procurementQuantity)>positive(request.quantity))warnings.push("已採購備貨尚未分配尺碼，請先更正採購明細，避免重複下單");
   continue;
  }
  for(const part of request.procurementBreakdown){
   if(!TSHIRT_PLAN_SIZES.includes(part.size))continue;
   const surplus=Math.max(0,positive(part.quantity)-(part.size===request.size?positive(request.quantity):0));
   incomingExtras.set(part.size,(incomingExtras.get(part.size)||0)+surplus);
  }
 }
 const sizes=TSHIRT_PLAN_SIZES.map(size=>{
  const list=rows.filter(x=>x.size===size),inventory=stock.find(x=>x.key==="regular:"+size);
  const validStock=inventory&&[inventory.onHand,inventory.reserved??0,inventory.unavailable??0].every(n=>Number.isSafeInteger(n)&&n>=0)&&inventory.onHand>=(inventory.reserved||0)+(inventory.unavailable||0);
  const available=validStock?inventory.onHand-(inventory.reserved||0)-(inventory.unavailable||0):null;
  const sum=predicate=>list.filter(predicate).reduce((n,x)=>n+x.quantity,0);
  const first=sum(x=>x.type==="STUDENT_FIRST"),studentExtra=sum(x=>x.type==="STUDENT_EXTRA"),cadreFirst=sum(x=>x.type==="CADRE_FIRST"),cadreExtra=sum(x=>x.type==="CADRE_EXTRA"),volunteerExtra=sum(x=>x.type==="VOLUNTEER_EXTRA");
  const covered=sum(x=>x.covered),remaining=sum(x=>!x.covered),waiting=sum(x=>!x.covered&&!x.ready);
  const incoming=incomingExtras.get(size)||0;
  const stockUsed=available===null?null:Math.min(available,remaining);
  const need=available===null?(remaining?null:0):Math.max(0,remaining-available-incoming);
  const extra=Number.isSafeInteger(Number(extraBySize[size]))&&Number(extraBySize[size])>=0&&Number(extraBySize[size])<=100?Number(extraBySize[size]):0;
  return {size,first,studentExtra,cadreFirst,cadreExtra,volunteerExtra,total:first+studentExtra+cadreFirst+cadreExtra+volunteerExtra,covered,remaining,waiting,available,stockUsed,incoming,need,extra,order:need===null?null:need+extra};
 });
 const sum=fn=>rows.reduce((n,x)=>n+fn(x),0),unknown=rows.filter(x=>!TSHIRT_PLAN_SIZES.includes(x.size));
 const missingStock=sizes.filter(x=>x.need===null).map(x=>x.size);
 const extraUnits=sizes.reduce((n,x)=>n+x.extra,0);
 const need=missingStock.length?null:sizes.reduce((n,x)=>n+x.need,0);
 const waiting=sum(x=>!x.covered&&!x.ready?x.quantity:0),unknownUnits=unknown.filter(x=>!x.covered).reduce((n,x)=>n+x.quantity,0);
 if(unknownUnits)warnings.push(`${unknownUnits} 件待填寫尺寸，尚無法分配採購尺碼`);
 if(missingStock.length)warnings.push(`${missingStock.join("、")} 尺寸尚未完成庫存盤點`);
 if(waiting)warnings.push(`${waiting} 件待審核、匯款或財務核帳`);
 if(carryover)warnings.push(`${carryover} 筆跨期未結案需求已併入，請核對是否仍需購買`);
 return {term,rows,sizes,warnings:[...new Set(warnings)],currentCount:current.length,reserveCount:current.filter(s=>groupOf(s)==="C").length,firstUnits:sum(x=>x.type==="STUDENT_FIRST"?x.quantity:0),studentExtraUnits:sum(x=>x.type==="STUDENT_EXTRA"?x.quantity:0),staffUnits:sum(x=>STAFF_CATEGORIES[x.type]?x.quantity:0),totalUnits:sum(x=>x.quantity),coveredUnits:sum(x=>x.covered?x.quantity:0),waitingUnits:waiting,unknownUnits,missingStock,needUnits:need,extraUnits,orderUnits:need===null?null:need+extraUnits,canFinalize:!unknownUnits&&!missingStock.length&&!waiting&&!warnings.some(x=>/尚未分配尺碼/.test(x)),excludedRequests,carryover,loans:parentLoans.filter(x=>x.role==="VOLUNTEER"&&["BORROWED","WASHING"].includes(x.status))};
}

export function tshirtPlanCsv(plan,{supplierOnly=false,exportedAt=new Date().toISOString()}={}){
 const header=["資料類別","學期","尺寸","學生首次公費","學生自費加購","幹部首次公費","幹部自費加購","志工自費加購","需求合計","已採購或已交付","尚待供應","可用庫存","庫存抵用","尚需採購","另加備貨","規劃採購","待確認件數","姓名","學生ID","身分類別","需求件數","處理狀態","紀錄ID","備註","已採購備貨待到貨"];
 const lines=[header],notes=[...plan.warnings,`匯出時間 ${exportedAt}`,"首次需求依目前在團名冊；加購依所選學期及跨期未結案申請。歷史尺寸登錄不是加購。",`志工借用／送洗 ${plan.loans.length} 件另列，不自動增加新購需求。`].join("；");
 const summary=Array(header.length).fill("");summary[0]="總計";summary[1]=plan.term.label;
 for(const [index,key] of [[3,"firstUnits"],[4,"studentExtraUnits"],[8,"totalUnits"],[9,"coveredUnits"],[13,"needUnits"],[14,"extraUnits"],[15,"orderUnits"],[16,"waitingUnits"]])summary[index]=plan[key]??"待盤點";
 for(const [index,key] of [[5,"CADRE_FIRST"],[6,"CADRE_EXTRA"],[7,"VOLUNTEER_EXTRA"]])summary[index]=plan.rows.filter(x=>x.type===key).reduce((n,x)=>n+x.quantity,0);
 summary[21]=plan.canFinalize?"尺寸與款項已齊，請核對最低採購量":"資料待補齊，屬採購規劃";summary[23]=notes;lines.push(summary);
 for(const x of plan.sizes){
  const row=Array(header.length).fill("");row[0]="尺碼彙總";row[1]=plan.term.label;row[2]=x.size;
  [x.first,x.studentExtra,x.cadreFirst,x.cadreExtra,x.volunteerExtra,x.total,x.covered,x.remaining,x.available??"待盤點",x.stockUsed??"待盤點",x.need??"待盤點",x.extra,x.order??"待盤點",x.waiting].forEach((v,i)=>row[i+3]=v);
  row[23]=x.remaining&&x.available===null?"庫存未建檔不可視為 0":"";row[24]=x.incoming;lines.push(row);
 }
 if(!supplierOnly){
  for(const x of plan.rows){const row=Array(header.length).fill("");row[0]="需求明細";row[1]=plan.term.label;row[2]=x.size||"待填寫";row[17]=x.person;row[18]=x.studentId;row[19]=x.category;row[20]=x.quantity;row[21]=x.status;row[22]=x.requestId;row[23]=x.note;lines.push(row)}
  for(const x of plan.loans){const row=Array(header.length).fill("");row[0]="志工借用（不計新購）";row[1]=plan.term.label;row[2]=x.size;row[17]=x.parentName||"家長";row[18]=x.studentId;row[20]=1;row[21]=x.status==="WASHING"?"送洗中":"借用中";row[23]="使用既有衣服；歸還前不作可用庫存";lines.push(row)}
 }
 const cell=v=>{let s=String(v??"");if(/^[\s]*[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"'};
 return "\uFEFF"+lines.map(row=>row.map(cell).join(",")).join("\r\n");
}
