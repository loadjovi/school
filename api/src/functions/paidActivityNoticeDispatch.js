import {app} from "@azure/functions";
import {TableClient} from "@azure/data-tables";
import {authorizePaidActivityScheduler} from "../lib/paidActivitySchedulerAuth.mjs";
import {json} from "../lib/auth.js";
import {dispatchPaidActivityNotices} from "../lib/paidActivitySchedule.js";

app.http("paidActivityNoticeDispatch",{
  methods:["POST"],route:"line/paid-activity-notices/dispatch",authLevel:"anonymous",
  handler:async request=>{
    const access=await authorizePaidActivityScheduler(request.headers.get("authorization"));
    if(!access.authorized)return json({error:access.status===503?"Scheduler identity service unavailable":"Unauthorized"},access.status);
    const table = TableClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING,
      process.env.UNIFORM_EVENT_CONFIG_TABLE || "TenantUniformEventConfig");
    const now = new Date().toISOString();
    const rows = [];
    try {
      for await (const row of table.listEntities({queryOptions:{filter:`paidLineDueAt gt '' and paidLineDueAt le '${now}'`}})) {
        rows.push(row);
        if (rows.length===4) break;
      }
    } catch (error) {
      if (error.statusCode===404) return json({processed:0});
      throw error;
    }
    const processed = await Promise.allSettled(rows.map(row=>dispatchPaidActivityNotices(table,row)));
    return json({processed:processed.filter(result=>result.status==="fulfilled").length,
      failed:processed.filter(result=>result.status==="rejected").length});
  }
});
