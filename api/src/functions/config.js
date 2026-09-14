import { app } from "@azure/functions";
import { json } from "../lib/auth.js";
app.http("config",{methods:["GET"],authLevel:"anonymous",route:"config",handler:async()=>{
  return json({googleClientId:String(process.env.GOOGLE_CLIENT_ID||"")});
}});
