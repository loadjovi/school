import {app} from "@azure/functions";
import {getAccess,json} from "../lib/auth.js";
import {getTenantDirectory,listTenantAdmins,tenantIdValue,writeGlobalAudit} from "../lib/storage.js";
import {financeAssignments,setFinanceAssignment} from "../lib/financeAccess.js";

const emailValid=x=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x);
app.http("financeAssignments",{methods:["GET","PATCH"],authLevel:"anonymous",route:"finance-assignments",handler:async request=>{
 const access=await getAccess(request);
 if(!access.authenticated)return json({error:"Unauthorized"},401);
 if(access.role!=="globalAdmin"||access.capabilities?.globalAdmin!==true)return json({error:"僅 Global 管理員可指派財務權限"},403);
 try{
  const body=request.method==="PATCH"?await request.json():{};
  const schoolId=tenantIdValue(body.schoolId||new URL(request.url).searchParams.get("schoolId"));
  if(!schoolId||!await getTenantDirectory(schoolId))return json({error:"找不到學校"},404);
  if(request.method==="GET")return json({items:await financeAssignments(schoolId)});
  const email=String(body.email||"").trim().toLowerCase(),action=String(body.action||"");
  if(!emailValid(email)||!["grant","revoke"].includes(action))return json({error:"請選擇有效管理員與操作"},400);
  if(action==="grant"){
   const admins=await listTenantAdmins(schoolId,"active");
   if(!admins.some(x=>String(x.partitionKey).toLowerCase()===email))return json({error:"僅能指派此校已啟用的後台管理員"},409);
  }
  const item=await setFinanceAssignment(schoolId,email,action==="grant",access.email);
  await writeGlobalAudit({actorEmail:access.email,action:action==="grant"?"finance_grant":"finance_revoke",schoolId,targetEmail:email,details:{status:item.status}});
  return json({item});
 }catch(e){console.error("financeAssignments",e);return json({error:"財務權限設定失敗"},500)}
}});
