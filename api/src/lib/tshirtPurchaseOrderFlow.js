import {TableClient} from "@azure/data-tables";

export const tshirtClaimKey=(type,id)=>"claim:"+type+":"+Buffer.from(String(id)).toString("base64url");
export async function activeTshirtClaim(schoolId,type,id){
 const table=TableClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING,"TenantTshirtPurchaseOrders");
 try{const row=await table.getEntity(schoolId,tshirtClaimKey(type,id));return row.active===true?row:null}
 catch(error){if(error.statusCode===404)return null;throw error}
}
