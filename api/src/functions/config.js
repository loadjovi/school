import { app } from "@azure/functions";
import { getTenantContext, json } from "../lib/auth.js";
import { getSystemSettings, saveSystemSettings } from "../lib/settings.js";

function emailConfigured(){
  return !!(
    String(process.env.ACS_EMAIL_CONNECTION_STRING||"").trim() &&
    String(process.env.ACS_EMAIL_SENDER||"").trim()
  );
}

app.http("config",{methods:["GET"],authLevel:"anonymous",route:"config",handler:async()=>{
  return json({googleClientId:String(process.env.GOOGLE_CLIENT_ID||"")});
}});

app.http("adminSettings",{
  methods:["GET","PATCH"],authLevel:"anonymous",route:"admin-settings",
  handler:async(request)=>{
    const context=await getTenantContext(request);if(context.error)return context.error;
    const {access:a,schoolId}=context;
    if(a.role!=="admin")return json({error:"Forbidden"},403);

    if(request.method==="PATCH"){
      const body=await request.json();
      if(typeof body.emailNotificationsEnabled!=="boolean")return json({error:"emailNotificationsEnabled 必須為布林值"},400);
      const saved=await saveSystemSettings({emailNotificationsEnabled:body.emailNotificationsEnabled,updatedBy:a.email,schoolId});
      return json({...saved,emailServiceConfigured:emailConfigured(),effectiveEmailEnabled:saved.emailNotificationsEnabled&&emailConfigured()});
    }

    const settings=await getSystemSettings(schoolId);
    return json({...settings,emailServiceConfigured:emailConfigured(),effectiveEmailEnabled:settings.emailNotificationsEnabled&&emailConfigured()});
  }
});
