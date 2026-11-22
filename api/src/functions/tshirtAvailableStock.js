import {app} from "@azure/functions";
import {getTenantContext,json} from "../lib/auth.js";
import {safeAllocateTshirtAvailableStock} from "../lib/tshirtAvailableStock.js";

app.http("tshirtAvailableStock",{methods:["POST"],authLevel:"anonymous",route:"uniform-events/available-stock",handler:async request=>{
 const ctx=await getTenantContext(request);if(ctx.error)return ctx.error;
 if(ctx.access.role!=="admin")return json({error:"僅校方管理員可分配現有庫存"},403);
 try{
  const input=await request.json();
  if(!Array.isArray(input?.ids)||!input.ids.length||input.ids.length>20||new Set(input.ids).size!==input.ids.length||input.ids.some(id=>typeof id!=="string"||!/^[a-zA-Z0-9_-]{1,100}$/.test(id)))return json({error:"請重新載入申請資料"},400);
  const results=[];
  for(const id of input.ids)results.push({id,...await safeAllocateTshirtAvailableStock(ctx.schoolId,id,{actor:ctx.access.email,schoolName:ctx.tenant?.systemName||ctx.tenant?.schoolName})});
  return json({results});
 }catch(error){console.error("tshirtAvailableStock",error);return json({error:"現有庫存分配未確認，請重新整理後核對"},500)}
}});
