import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const source=readFileSync(new URL("../app/tshirt-procurement-admin.js",import.meta.url),"utf8");
const loanSource=readFileSync(new URL("../app/tshirt-parent-loans.js",import.meta.url),"utf8");
const code=source.slice(source.indexOf("function staffStatus("),source.indexOf("async function saveChange("));
function render({canVerifyFinance=false}={}){
 const node=tag=>({tagName:tag.toUpperCase(),children:[],handlers:{},textContent:"",append(...items){this.children.push(...items)},replaceChildren(...items){this.children=items},addEventListener(name,fn){this.handlers[name]=fn}});
 const body=node("section"),row=(id,extra={})=>({id,parentName:id,category:"CADRE_EXTRA",size:"M",quantity:1,amount:400,schoolYear:115,semester:1,status:"APPROVED",paymentStatus:"AWAITING_TRANSFER",createdAt:"2026-11-20T00:00:00Z",...extra});
 const data={staffDemands:[row("awaiting"),row("supplement",{paymentStatus:"SUPPLEMENT_REPORTED",paymentResolution:{}}),row("refund",{paymentStatus:"REFUND_REQUESTED",paymentResolution:{}}),row("arrived",{status:"ARRIVED",paymentStatus:"VERIFIED"}),row("public",{category:"CADRE_FIRST",paymentStatus:"NOT_REQUIRED"})]};
 const calls=[];
 runInNewContext(code+";drawStaff()",{$:()=>body,data,plan:{term:{schoolYear:115,semester:1}},STAFF_CATEGORIES:{CADRE_EXTRA:"幹部自費",CADRE_FIRST:"首次公費"},canVerifyFinance,window:{paymentResolutionUI:{labels:{SUPPLEMENT_REPORTED:"已補款，待核帳",REFUND_REQUESTED:"待財務退款"},financeControls(){throw Error("operations must not mount finance controls")}}},document:{createElement:node},prompt:()=>"作業備註",saveChange:async(item,payload)=>calls.push({id:item.id,...payload})});
 const descendants=parent=>parent.children.flatMap(child=>[child,...descendants(child)]);
 return {body,nodes:descendants(body),calls};
}
test("operations never mount staff payment verification or adjustment forms, including for a finance verifier",()=>{
 for(const canVerifyFinance of [false,true]){
  const h=render({canVerifyFinance});
  assert.equal(h.nodes.some(node=>node.tagName==="FORM"),false);
  assert.equal(h.nodes.some(node=>/確認此筆已入帳|銀行查核|補送財務|通知家長/.test(node.textContent)),false);
  assert.ok(h.nodes.some(node=>node.textContent==="待財務核帳，完成後會自動納入採購。"));
  assert.ok(h.nodes.some(node=>node.textContent==="款項處理中，請由財務核帳區完成後再採購。"));
 }
});
test("operation controls still finish received demands and do not advance a held payment",async()=>{
 const h=render({canVerifyFinance:true}),completed=h.nodes.find(node=>node.textContent==="確認需求已處理完成");
 assert.ok(completed);await completed.handlers.click();assert.deepEqual(JSON.parse(JSON.stringify(h.calls)),[{id:"arrived",action:"UPDATE_DEMAND_STATUS",status:"FULFILLED",note:"作業備註"}]);
 for(const name of ["supplement","refund"]){
  const card=h.body.children.find(node=>node.children[0].textContent.startsWith(name+"｜"));
  assert.equal(card.children.some(node=>node.tagName==="BUTTON"),false);
 }
 const publicCard=h.body.children.find(node=>node.children[0].textContent.startsWith("public｜"));assert.ok(publicCard.children.some(node=>node.tagName==="BUTTON"&&node.textContent==="取消需求"));
});
test("parent loan operations retain issue and return inventory actions without financial tools",()=>{
 for(const action of ["ISSUE_CADRE","EDIT_CADRE_PENDING","CORRECT_CADRE_PENDING","RETURN","CORRECT_VOLUNTEER_SIZE"])assert.ok(loanSource.includes(action));
 assert.doesNotMatch(loanSource,/financeControls|VERIFY_DEMAND_PAYMENT|payment-notifications|SEND_REMINDER/);
});
