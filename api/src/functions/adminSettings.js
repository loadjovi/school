import { app } from "@azure/functions";
import { getAccess, json } from "../lib/auth.js";
import { emailConfigured } from "../lib/email.js";
import { getSystemSettings, saveSystemSettings } from "../lib/settings.js";

app.http("adminSettings",{
  methods:["GET","PATCH"],authLevel:"anonymous",route:"admin-settings",
  handler:async(request)=>{
    const a=await getAccess(request);
    if(!a.authenticated)return json({error:"Unauthorized"},401);
    if(a.role!=="admin")return json({error:"Forbidden"},403);

    if(request.method==="PATCH"){
      const body=await request.json();
      if(typeof body.emailNotificationsEnabled!=="boolean")return json({error:"emailNotificationsEnabled 必須為布林值"},400);
      const saved=await saveSystemSettings({emailNotificationsEnabled:body.emailNotificationsEnabled,updatedBy:a.email});
      return json({...saved,emailServiceConfigured:emailConfigured(),effectiveEmailEnabled:saved.emailNotificationsEnabled&&emailConfigured()});
    }

    const settings=await getSystemSettings();
    return json({...settings,emailServiceConfigured:emailConfigured(),effectiveEmailEnabled:settings.emailNotificationsEnabled&&emailConfigured()});
  }
});
