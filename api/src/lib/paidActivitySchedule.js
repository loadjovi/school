import {isPaidActivityOpen,collectingTrip,notifyPaidActivityOpened} from "./paidActivityLine.js";

const states = row => JSON.parse(row?.paidLineNotices || "{}");
const openingTime = activity => Date.parse(activity?.openAt || "");
const eligible = (activity,kind,now) => kind === "registration"
  ? isPaidActivityOpen(activity,now) : collectingTrip(activity);
const kinds = ["registration","payment"];
const leaseMs = 2 * 60 * 1000;
const nextAttempt = notice => notice.state==="queued" ? notice.at : notice.state==="sending" ? notice.leaseUntil : "";

function storedNotices(row, notices) {
  const {etag,timestamp,...data} = row;
  const due = Object.values(notices).map(nextAttempt).filter(Boolean).sort()[0];
  return {...data,paidLineNotices:JSON.stringify(notices),paidLineDueAt:due || ""};
}

export function paidActivitySchedule(row, previousRow, previous, activity, now) {
  const old = states(previousRow), notices = {};
  const opening = openingTime(activity);
  for (const kind of kinds) {
    if (!eligible(activity,kind,now)) continue;
    const saved = old[kind];
    if (saved && saved.state !== "queued" && !(saved.state==="sending" && opening>now)) {
      notices[kind] = saved;
      continue;
    }
    if (!saved && eligible(previous,kind,now) && !(kind==="registration" && opening>now)) continue;
    const at = new Date(Math.max(Number.isFinite(opening)?opening:now,now)).toISOString();
    notices[kind] = {key:saved?.key || row.updatedAt,at,state:"queued"};
  }
  return storedNotices(row,notices);
}

export async function dispatchPaidActivityNotices(table, row, now=Date.now()) {
  const notices = states(row), activity = JSON.parse(row.payload || "{}");
  const opening = openingTime(activity);
  const due = Object.entries(notices).filter(([,notice])=>Date.parse(nextAttempt(notice))<=now);
  if (!due.length || opening>now) return [];
  const selected = [];
  for (const [kind,notice] of due) {
    const withinRetryWindow = notice.state!=="sending" || now-Date.parse(notice.firstAttemptAt)<23*60*60*1000;
    if (eligible(activity,kind,now) && withinRetryWindow) {
      const claimed = {...notice,state:"sending",leaseUntil:new Date(now+leaseMs).toISOString(),
        firstAttemptAt:notice.firstAttemptAt || new Date(now).toISOString()};
      selected.push([kind,claimed]);
      notices[kind] = claimed;
    } else {
      notices[kind] = {...notice,state:"expired"};
    }
  }
  try {
    await table.updateEntity(storedNotices(row,notices),"Replace",{etag:row.etag});
  } catch (error) {
    if ([404,412].includes(error.statusCode)) return [];
    throw error;
  }
  if (!selected.length) return [];
  const current = await table.getEntity(row.partitionKey,row.rowKey).catch(error=>{
    if (error.statusCode === 404) return null;
    throw error;
  });
  if (!current) return [];
  const latest = JSON.parse(current.payload || "{}"), latestNotices = states(current);
  const results = [];
  for (const [kind,notice] of selected) {
    const actual = latestNotices[kind], checkedAt = Date.now();
    const result = actual?.key===notice.key && actual.state==="sending" && actual.leaseUntil===notice.leaseUntil &&
        eligible(latest,kind,checkedAt) && !(openingTime(latest)>checkedAt)
      ? await notifyPaidActivityOpened(row.partitionKey,latest,notice.key,kind) : {status:"expired"};
    results.push(result);
    if (actual?.key===notice.key && actual.state==="sending" && actual.leaseUntil===notice.leaseUntil) latestNotices[kind]={...actual,state:result.status};
  }
  try {
    await table.updateEntity(storedNotices(current,latestNotices),"Replace",{etag:current.etag});
  } catch (error) {
    if (![404,412].includes(error.statusCode)) throw error;
  }
  return results;
}
