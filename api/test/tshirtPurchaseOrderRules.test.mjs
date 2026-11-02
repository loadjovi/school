import test from "node:test";
import assert from "node:assert/strict";
import {normalizePurchaseOrderItems,validatePurchaseOrderInput} from "../src/lib/tshirtPurchaseOrderRules.mjs";

test("a confirmed vendor order accepts exact sizes and an acknowledged pending item",()=>{
 const result=validatePurchaseOrderInput({schoolYear:115,semester:1,items:[{size:"8",quantity:2},{size:"10",quantity:8},{size:"S",quantity:1},{size:"L",quantity:1}],pendingUnknownUnits:1,acknowledgePendingSize:true});
 assert.equal(result.total,12);assert.equal(result.pendingUnknownUnits,1);assert.deepEqual(result.items.at(-1),{size:"L",quantity:1});
});

test("purchase orders reject duplicates, fewer than ten pieces and silent exclusion of unknown sizes",()=>{
 assert.throws(()=>normalizePurchaseOrderItems([{size:"M",quantity:5},{size:"M",quantity:5}]),/不正確/);
 assert.throws(()=>normalizePurchaseOrderItems([{size:"M",quantity:9}]),/至少 10 件/);
 assert.throws(()=>validatePurchaseOrderInput({schoolYear:115,semester:1,items:[{size:"M",quantity:10}],pendingUnknownUnits:1}),/待填尺寸/);
});
