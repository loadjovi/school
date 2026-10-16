import {TableClient} from "@azure/data-tables";

const tableName="TenantFinanceAssignment";
const emailKey=email=>String(email||"").trim().toLowerCase();
let storedClient,created;
async function client(){
 if(!process.env.STORAGE_CONNECTION_STRING)throw Error("Storage unavailable");
 if(!storedClient)storedClient=TableClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING,tableName);
 if(!created)created=storedClient.createTable().catch(e=>{if(e.statusCode!==409){created=null;throw e}});
 await created;return storedClient;
}

export async function financeAssigned(schoolId,email){
 if(!process.env.STORAGE_CONNECTION_STRING||!schoolId||!email)return false;
 const table=await client();
 try{const row=await table.getEntity(schoolId,emailKey(email));return row.status==="active"}
 catch(e){if(e.statusCode===404)return false;throw e}
}

export async function financeAssignments(schoolId){
 const table=await client();
 const items=[];
 for await(const row of table.listEntities({queryOptions:{filter:`PartitionKey eq '${schoolId.replaceAll("'","''")}'`}}))
  items.push({email:row.rowKey,status:row.status,updatedAt:row.updatedAt,updatedBy:row.updatedBy});
 return items;
}

export async function setFinanceAssignment(schoolId,email,active,actor){
 const table=await client();
 const updatedAt=new Date().toISOString(),normalized=emailKey(email);
 await table.upsertEntity({partitionKey:schoolId,rowKey:normalized,status:active?"active":"inactive",updatedAt,updatedBy:actor},"Replace");
 return {email:normalized,status:active?"active":"inactive",updatedAt,updatedBy:actor};
}
