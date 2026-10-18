export const originalCompetitionRoster=[
 ["4A","林心澄","女","S","PUBLIC","小提琴"],
 ["4C","李旭恩","男","S","PENDING","大提琴"],
 ["4D","蘇聖翔","男","M","PENDING","中提琴"],
 ["5A","吳定廩","男","M","PUBLIC","大提琴"],
 ["5A","蔡昀潔","女","M","PENDING","中提琴"],
 ["5C","游宜橙","女","M","PURCHASE","小提琴"],
 ["5C","陳祉瑄","女","XS","PUBLIC","小提琴"],
 ["5D","楊力萓","女","S","PURCHASE","大提琴"],
 ["6A","李婇寧","女","M","PUBLIC","小提琴"],
 ["6B","賴昺旭","男","S","PUBLIC","中提琴"],
 ["6C","張安侖","男","L","PURCHASE","大提琴"],
 ["6C","黃禹閎","男","M","PURCHASE","小提琴"],
 ["6C","陳奕亘","男","L","PUBLIC","中提琴"],
 ["6D","張介輔","男","L","PUBLIC","小提琴"],
 ["6D","李宥蓁","女","L","PUBLIC","大提琴"]
];
const paperReceived=new Set(["李婇寧","張介輔","林心澄","黃禹閎","游宜橙","陳祉瑄","賴昺旭","陳奕亘","張安侖","李宥蓁","吳定廩","楊力萓"]);
export const nameKey=name=>String(name||"").trim().normalize("NFC").replace(/\s+/g,"");
const bases=new Map(originalCompetitionRoster.map(row=>[nameKey(row[1]),row]));

export function baseForStudent(student){
 const name=String(student.studentName||student.name||"").trim();
 const row=bases.get(nameKey(name));
 if(!row)return null;
 return {studentId:String(student.rowKey||student.studentId||""),studentName:name,
  originalClass:row[0],grade:String(student.grade||row[0]),
  style:row[2],size:row[3],acquisition:row[4],instrument:row[5],
  requestId:"",requestStatus:"",paymentStatus:"",
  received:paperReceived.has(nameKey(name)),source:"paper",
  appliedRequestAt:""};
}
const eligible=request=>request?.kind==="competitionUniform"&&request.status!=="CANCELLED";
export function latestCompetitionRequest(requests,id){
 return (requests||[]).filter(r=>eligible(r)&&String(r.studentId)===String(id))
 .sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||""))||String(b.updatedAt||"").localeCompare(String(a.updatedAt||""))||String(b.id||"").localeCompare(String(a.id||"")))[0]||null;
}
export function overlayMaster(old,request,student){
 if(!request)return old;
 const newStatus=request.status||"PENDING";
 return {...old,studentName:String(student.studentName||student.name||old.studentName),
  grade:String(student.grade||old.grade||""),instrument:String(student.instrument||old.instrument||""),
  style:request.style||old.style,size:request.size||old.size,
  acquisition:request.acquisition||old.acquisition,
  requestId:request.id||"",requestStatus:newStatus,
  paymentStatus:request.paymentStatus||"",
  // Changing a choice is not evidence that an item was physically handed over.
  received:old.received||newStatus==="FULFILLED",
  appliedRequestAt:request.updatedAt||request.createdAt||"",
  source:"parent_request"};
}
export const comparable=x=>JSON.stringify(["studentName","grade","style","size","acquisition","instrument","requestId","requestStatus","paymentStatus","received","appliedRequestAt","source"].map(k=>x[k]??""));
