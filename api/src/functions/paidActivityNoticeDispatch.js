import {app} from "@azure/functions";
import {TableClient} from "@azure/data-tables";
import {createHash,timingSafeEqual} from "node:crypto";
import {json} from "../lib/auth.js";
import {dispatchPaidActivityNotices} from "../lib/paidActivitySchedule.js";

const digest = value => createHash("sha256").update(value).digest();
app.http("paidActivityNoticeDispatch",{
  methods:["POST"],route:"line/paid-activity-notices/dispatch",authLevel:"anonymous",
  handler:async request=>{
    const secret = process.env.LINE_PAID_ACTIVITY_SCHEDULER_TOKEN || "";
    if (!secret) return json({error:"Scheduler not configured"},503);
    const supplied = request.headers.get("authorization") || "";
    if (!timingSafeEqual(digest(supplied),digest("Bearer "+secret))) return json({error:"Unauthorized"},401);
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
