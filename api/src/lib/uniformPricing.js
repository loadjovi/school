import {TableClient} from "@azure/data-tables";

export const defaultUniformPrices={regularUniform:400,competitionUniform:2625};
export const uniformTaxRate=kind=>validUniformKind(kind)?5:0;
export const validUniformKind=kind=>Object.hasOwn(defaultUniformPrices,kind);
export async function uniformPricingTable(){
 const table=TableClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING,"TenantUniformPrices");
 await table.createTable().catch(e=>{if(e.statusCode!==409)throw e});
 return table;
}
export async function getUniformPrice(schoolId,kind){
 if(!validUniformKind(kind))throw Error("Invalid uniform kind");
 const table=await uniformPricingTable();
 try{const row=await table.getEntity(schoolId,kind);return {unitPrice:row.unitPrice,basePrice:row.basePrice??(kind==="competitionUniform"?Math.round(row.unitPrice/1.05):row.unitPrice),taxRate:uniformTaxRate(kind),priceIncludesTax:kind==="regularUniform",etag:row.etag,updatedAt:row.updatedAt}}
 catch(e){if(e.statusCode===404)return {unitPrice:defaultUniformPrices[kind],basePrice:kind==="competitionUniform"?2500:400,taxRate:uniformTaxRate(kind),priceIncludesTax:kind==="regularUniform",etag:null,updatedAt:null};throw e}
}
