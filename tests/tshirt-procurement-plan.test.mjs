import test from "node:test";
import assert from "node:assert/strict";
import {buildTshirtProcurementPlan as build,tshirtPlanCsv,currentTshirtTerm,tshirtTerm,TSHIRT_PLAN_SIZES} from "../app/tshirt-procurement-plan.mjs";
const student=(id,group="C",extra={})=>({studentId:id,studentName:"學生"+id,groupName:group,status:"active",...extra});
const inventory=()=>TSHIRT_PLAN_SIZES.map(size=>({key:"regular:"+size,onHand:0,reserved:0,unavailable:0}));
const args=()=>({schoolYear:115,semester:1,students:[student("111001"),student("111002"),student("111003","A")],history:[{studentId:"111001",historicalIssued:false,size:"8"},{studentId:"111002",historicalIssued:false,size:null},{studentId:"111003",historicalIssued:true,size:"M"}],stock:inventory()});
const request=(extra={})=>({id:"request-1",kind:"regularUniform",studentId:"111003",size:"L",quantity:2,status:"APPROVED",paymentStatus:"VERIFIED",createdAt:"2026-10-10T04:00:00Z",...extra});
test("all active reserve students need a first shirt, including unsized students; existing size backfills are not repeat orders",()=>{
 const p=build(args());assert.equal(p.reserveCount,2);assert.equal(p.firstUnits,2);assert.equal(p.totalUnits,2);assert.equal(p.unknownUnits,1);assert.equal(p.studentExtraUnits,0);assert.equal(p.needUnits,1);assert.equal(p.canFinalize,false);
 assert.equal(p.rows.some(x=>x.studentId==="111003"),false);
});
test("actual growth purchases add exact quantities to first shirts, while cancelled, former and future-term orders do not",()=>{
 const a=args();a.students.push(student("111004","C",{status:"inactive"}));a.requests=[request(),request({id:"cancel",status:"CANCELLED"}),request({id:"former",studentId:"111004"}),request({id:"future",createdAt:"2027-02-01T00:00:00Z"})];
 const p=build(a);assert.equal(p.totalUnits,4);assert.equal(p.studentExtraUnits,2);assert.equal(p.excludedRequests,1);assert.equal(p.rows.filter(x=>x.type==="STUDENT_EXTRA").length,1);
});
test("persisted first issue is authoritative, and a physical handoff pending acknowledgement never orders again",()=>{
 const a=args();a.history[0]={studentId:"111001",size:"8",historicalIssued:false,schoolIssuedAt:"2026-10-20T00:00:00Z",schoolIssuedSize:"8"};
 const p=build(a);assert.equal(p.firstUnits,2);assert.equal(p.coveredUnits,1);assert.equal(p.sizes[0].need,0);
 a.history[0].schoolIssuedAt="2026-06-20T00:00:00Z";assert.equal(build(a).firstUnits,1);
 a.history[0]={studentId:"111001",size:"8",historicalIssued:true};assert.equal(build(a).firstUnits,1);
});
test("stock subtracts reservations and unavailable garments; missing stock is unknown rather than zero",()=>{
 const a=args();a.history[1].size="8";a.stock[0]={key:"regular:8",onHand:5,reserved:2,unavailable:2};
 let p=build(a);assert.equal(p.sizes[0].available,1);assert.equal(p.needUnits,1);
 a.stock=a.stock.filter(x=>x.key!=="regular:8");p=build(a);assert.equal(p.needUnits,null);assert.deepEqual(p.missingStock,["8"]);assert.equal(p.canFinalize,false);
 a.stock=inventory();assert.equal(build(a).needUnits,2);
});
test("ordered customer pieces and extra stock in flight are not purchased twice",()=>{
 const a=args();a.history[1].size="8";a.requests=[request({size:"8",quantity:1,status:"ORDERED",procurementQuantity:10,procurementBreakdown:[{size:"8",quantity:6},{size:"10",quantity:4}]})];
 const p=build(a);assert.equal(p.totalUnits,3);assert.equal(p.coveredUnits,1);assert.equal(p.sizes[0].incoming,5);assert.equal(p.sizes[1].incoming,4);assert.equal(p.needUnits,0);
 a.requests[0].createdAt="2027-02-01T00:00:00Z";assert.equal(build(a).sizes[0].incoming,0);a.requests[0].createdAt="2026-10-10T04:00:00Z";
 a.requests[0].status="ARRIVED";a.stock[0].onHand=6;assert.equal(build(a).sizes[0].incoming,0);assert.equal(build(a).needUnits,0);
});
test("unpaid purchases remain visible in demand but cannot be presented as a final ready order",()=>{
 const a=args();a.history[1].size="10";a.requests=[request({paymentStatus:"AWAITING_TRANSFER"})];
 let p=build(a);assert.equal(p.waitingUnits,2);assert.equal(p.canFinalize,false);assert.match(p.warnings.join(" "),/核帳/);
 a.requests[0].paymentStatus="VERIFIED";assert.equal(build(a).canFinalize,true);
});
test("staff first, cadre add-ons and volunteer add-ons count separately; volunteer loans do not create purchase demand",()=>{
 const a=args();a.staffDemands=[{id:"f",parentEmail:"a@x.org",parentName:"幹部甲",category:"CADRE_FIRST",size:"M",quantity:1,schoolYear:115,semester:1,status:"APPROVED"},{id:"c",parentEmail:"a@x.org",parentName:"幹部甲",category:"CADRE_EXTRA",size:"L",quantity:2,schoolYear:115,semester:1,status:"APPROVED",paymentStatus:"VERIFIED"},{id:"v",parentEmail:"v@x.org",parentName:"志工乙",category:"VOLUNTEER_EXTRA",size:"S",quantity:3,schoolYear:115,semester:1,status:"APPROVED"}];
 a.parentLoans=[{parentEmail:"v@x.org",parentName:"志工乙",role:"VOLUNTEER",size:"M",status:"BORROWED"}];
 const p=build(a);assert.equal(p.staffUnits,6);assert.equal(p.totalUnits,8);assert.equal(p.loans.length,1);assert.equal(p.sizes.find(x=>x.size==="L").cadreExtra,2);assert.equal(p.sizes.find(x=>x.size==="S").volunteerExtra,3);assert.equal(p.waitingUnits,3);
});
test("cadre lifetime issue reconciles with the same parent across children and removes duplicate first demand",()=>{
 const a=args();a.staffDemands=[{id:"f",parentEmail:"a@x.org",parentName:"家長",category:"CADRE_FIRST",size:"M",quantity:1,schoolYear:115,semester:1,status:"APPROVED"}];
 a.parentLoans=[{parentEmail:"a@x.org",studentId:"111002",parentName:"家長",role:"CADRE",size:"M",status:"ISSUED_LIFETIME",issuedAt:"2026-10-20T00:00:00Z"}];
 let p=build(a);assert.equal(p.staffUnits,0);assert.equal(p.rows.some(x=>x.type==="CADRE_FIRST"),false);assert.equal(p.sizes.find(x=>x.size==="M").need,0);
 a.staffDemands=[];p=build(a);assert.equal(p.staffUnits,0);assert.equal(p.coveredUnits,0);
});
test("academic terms use Taipei time, include Jan in upper term, and carry overdue active orders only",()=>{
 assert.deepEqual(currentTshirtTerm(new Date("2026-07-31T16:00:00Z")),{schoolYear:115,semester:1});
 assert.deepEqual(currentTshirtTerm(new Date("2027-01-15T00:00:00Z")),{schoolYear:115,semester:1});
 assert.deepEqual(currentTshirtTerm(new Date("2027-01-31T16:00:00Z")),{schoolYear:115,semester:2});
 assert.equal(tshirtTerm(115,2).end,"2027-08-01");assert.throws(()=>tshirtTerm("abc",1));
 const a=args();a.requests=[request({createdAt:"2026-07-30T00:00:00Z"}),request({id:"old-fulfilled",status:"FULFILLED",createdAt:"2026-07-30T00:00:00Z"}),request({id:"boundary",createdAt:"2027-01-31T16:00:00Z"})];
 const p=build(a);assert.equal(p.studentExtraUnits,2);assert.equal(p.carryover,1);
});
test("extra stock is an explicit per-size draft and does not change customer demand or charge",()=>{
 const a=args();a.history[1].size="10";a.extraBySize={M:8};
 const p=build(a);assert.equal(p.needUnits,2);assert.equal(p.orderUnits,10);assert.equal(p.totalUnits,2);assert.equal(p.sizes.find(x=>x.size==="M").order,8);
});
test("one UTF-8 CSV contains totals, sizes, every demand and unknown-size follow-up; supplier CSV has no people",()=>{
 const a=args();a.students[0].studentName='=HYPERLINK("bad")';a.requests=[request()];
 const p=build(a),csv=tshirtPlanCsv(p,{exportedAt:"2026-10-25T16:00:00Z"});
 assert.equal(csv.charCodeAt(0),0xfeff);assert.match(csv,/需求明細/);assert.match(csv,/尺碼彙總/);assert.match(csv,/待填寫/);assert.match(csv,/"'=HYPERLINK/);assert.match(csv,/"2"/);
 const supplier=tshirtPlanCsv(p,{supplierOnly:true});assert.doesNotMatch(supplier,/111001|111003|HYPERLINK|需求明細/);assert.match(supplier,/資料待補齊/);
 assert.equal(csv.trim().split("\r\n").length,1+1+11+p.rows.length);
});

test("received staff are absent from procurement names, totals and CSV while separate add-ons remain",()=>{
 const a=args();
 const first={id:"first",parentEmail:" CADRE@example.com ",parentName:"已領取幹部",category:"CADRE_FIRST",size:"XL",quantity:1,schoolYear:115,semester:1,status:"APPROVED"};
 const extra={...first,id:"extra",category:"CADRE_EXTRA",parentName:"另購家長",quantity:2,paymentStatus:"VERIFIED"};
 a.parentLoans=[{parentEmail:"cadre@example.com",parentName:"已領取幹部",role:"CADRE",status:"ISSUED_LIFETIME",size:"XL",issuedAt:"2026-10-15T01:17:00Z"}];
 a.staffDemands=[first,extra,{...extra,id:"completed",parentName:"已完成志工",category:"VOLUNTEER_EXTRA",status:"FULFILLED",quantity:3}];
 const p=build(a);assert.equal(p.staffUnits,2);assert.equal(p.totalUnits,4);assert.equal(p.sizes.find(x=>x.size==="XL").cadreFirst,0);assert.equal(p.sizes.find(x=>x.size==="XL").cadreExtra,2);assert.equal(p.rows.filter(x=>x.type==="CADRE_FIRST").length,0);
 const csv=tshirtPlanCsv(p);assert.doesNotMatch(csv,/已領取幹部|已完成志工/);assert.match(csv,/另購家長/);
 assert.equal(a.parentLoans[0].status,"ISSUED_LIFETIME");assert.equal(a.staffDemands[0].status,"APPROVED");
 a.staffDemands=[];assert.equal(build(a).staffUnits,0);
});
