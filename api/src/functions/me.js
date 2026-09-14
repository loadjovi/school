
import { app } from "@azure/functions";
import { getAccess, json } from "../lib/auth.js";
app.http("me",{methods:["GET"],authLevel:"anonymous",route:"me",handler:async(request)=>{
  const a=getAccess(request);
  if(!a.authenticated)return json({error:"Unauthorized"},401);
  return json({email:a.email,displayName:a.displayName,role:a.role,section:a.section||null});
}});
