import {TableClient} from "@azure/data-tables";

export const defaultUniformPrices={regularUniform:400,competitionUniform:2625};
export const validUniformKind=kind=>Object.hasOwn(defaultUniformPrices,kind);
export async function uniformPricingTable(){
 const table=TableClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING,"TenantUniformPrices");
 await table.createTable().catch(e=>{if(e.statusCode!==409)throw e});
 return table;
}
export async function getUniformPrice(schoolId,kind){
 if(!validUniformKind(kind))throw Error("Invalid uniform kind");
 const table=await uniformPricingTable();
 try{const row=await table.getEntity(schoolId,kind);return {unitPrice:row.unitPrice,etag:row.etag,updatedAt:row.updatedAt}}
 catch(e){if(e.statusCode===404)return {unitPrice:defaultUniformPrices[kind],etag:null,updatedAt:null};throw e}
}
