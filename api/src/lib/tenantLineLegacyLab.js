import {TableClient} from "@azure/data-tables";
import {getOrCreateTenantLineAccount,getTenantGoogleLink,lineHash,linkTenantGoogle} from "./tenantLineAccounts.js";
import {lineApi} from "./lineMessaging.mjs";

const legacyEmailKey=email=>"email_"+lineHash(email).slice(0,40);

async function readLegacy(tableName,partitionKey,rowKey) {
  const table=TableClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING,tableName);
  try{return await table.getEntity(partitionKey,rowKey)}
  catch(error){if(error.statusCode===404)return null;throw error}
}

export async function restoreLabGoogleLineLink(schoolId,channel,google,existing) {
  // An existing index (including the unlink marker) is authoritative.
  if(existing||process.env.LAB_ENVIRONMENT!=="functional-uat"||!google?.sub||!google.email||
    channel.schoolId!==schoolId||!channel.loginConfigured||!channel.botUserId)return existing;
  const email=google.email;
  try{
    const binding=await readLegacy(process.env.LINE_ACCOUNT_BINDING_TABLE||"TenantLineAccountBinding",schoolId,legacyEmailKey(email));
    const userId=binding?.lineUserId;
    if(binding?.status!=="ACTIVE"||binding.schoolId!==schoolId||binding.parentEmail!==email||
      !/^U[0-9a-f]{32}$/.test(userId||""))return null;
    const userHash=lineHash(userId),pairKey=lineHash(userHash+":"+email);
    const [legacyGoogle,legacyLine]=await Promise.all([
      readLegacy("LabParentIdentityLinks","IDENTITY","gmail_"+lineHash(email).slice(0,48)),
      readLegacy("LabParentIdentityLinks","IDENTITY","line_"+userHash.slice(0,48))
    ]);
    const matches=(row,kind)=>row?.status==="ACTIVE"&&row.kind===kind&&
      row.parentEmail===email&&row.lineUserIdHash===userHash&&row.pairKey===pairKey;
    if(!matches(legacyGoogle,"GMAIL")||!matches(legacyLine,"LINE")||binding.lineUserIdHash!==userHash)return null;

    // Check visibility to this school's currently configured Messaging API bot
    // before carrying over an ID from the older LAB provider.
    const profile=await lineApi("/v2/bot/profile/"+encodeURIComponent(userId),{
      method:"GET",accessToken:channel.accessToken
    });
    if(profile?.userId!==userId)return null;
    const account=await getOrCreateTenantLineAccount(schoolId,channel.botUserId,userId,profile.displayName||binding.lineDisplayName);
    return await linkTenantGoogle(schoolId,account,google,{requireAbsentGoogleLink:true});
  }catch(error){
    console.warn("Legacy LAB LINE binding could not be restored",{schoolId,status:error?.status||error?.statusCode});
    return await getTenantGoogleLink(schoolId,google.sub);
  }
}
