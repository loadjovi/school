import {app} from "@azure/functions";
import {getTenantContext,json} from "../lib/auth.js";
import {applyPaymentResolution,listPaymentResolutions} from "../lib/paymentResolution.js";
import {PaymentResolutionError} from "../lib/paymentResolutionRules.mjs";
app.http("paymentResolution",{methods:["GET","PATCH"],authLevel:"anonymous",route:"uniform-events/payment-resolution",handler:async request=>{
 const ctx=await getTenantContext(request);if(ctx.error)return ctx.error;
 try{return json(request.method==="GET"?{items:await listPaymentResolutions(ctx.schoolId,ctx.access)}:await applyPaymentResolution(ctx.schoolId,ctx.access,await request.json()))}
 catch(error){if(error instanceof PaymentResolutionError)return json({error:error.message},error.status);console.warn("Payment resolution not completed",{schoolId:ctx.schoolId,status:error.statusCode});return json({error:"處理結果尚未確認，請重新讀取申請紀錄，勿重複送出"},503)}
}});
