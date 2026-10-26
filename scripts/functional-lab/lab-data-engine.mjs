import {createHash} from "node:crypto";

export const RESET_STORAGE_ACCOUNT="shorchestrauat01";
export function assertLabDataAccess(ready,context){
  if(!ready?.ready||ready.environment!=="functional-uat"||ready.storageAccount!==RESET_STORAGE_ACCOUNT)
    throw Object.assign(Error("僅允許獨立 LAB 資料庫執行此操作"),{statusCode:503});
  if(context?.access?.role!=="admin"||!String(context?.access?.email||""))
    throw Object.assign(Error("僅 LAB 學校管理員可管理測試資料"),{statusCode:403});
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(context.schoolId||"")))
    throw Object.assign(Error("學校情境不完整"),{statusCode:403});
}
export function ownsLabRow(row,schoolId){
  const pk=String(row.partitionKey||"");
  return (!row.schoolId||row.schoolId===schoolId)&&(pk===schoolId||pk.startsWith(schoolId+"|"));
}
export function cleanLabRow(row){
  return Object.fromEntries(Object.entries(row).filter(([key,value])=>!["etag","timestamp"].includes(key)&&value!==undefined).sort(([a],[b])=>a.localeCompare(b)));
}
export function labDataFingerprint(tables){
  const normalized=Object.entries(tables).sort(([a],[b])=>a.localeCompare(b)).map(([name,rows])=>[
    name,rows.map(cleanLabRow).sort((a,b)=>(a.partitionKey+"|"+a.rowKey).localeCompare(b.partitionKey+"|"+b.rowKey))
  ]);
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}
export function labDataCount(tables){return Object.values(tables).reduce((n,rows)=>n+rows.length,0)}
export async function clearLabData({repository,schoolId,planToken,actor}){
  const tables=await repository.capture();
  if(labDataFingerprint(tables)!==planToken)
    throw Object.assign(Error("資料已異動，請重新讀取清除範圍後再操作"),{statusCode:409});
  const total=labDataCount(tables);
  if(!total)return {ok:true,total:0,deleted:0,message:"目前 LAB 已是空白，沒有刪除資料"};
  for(const rows of Object.values(tables))for(const row of rows)
    if(!ownsLabRow(row,schoolId)||!row.etag)throw Error("清除範圍或資料版本無法驗證");
  // Backup must be durable AND readable before the first row can be deleted.
  const backup=await repository.saveBackup(tables);
  await repository.audit("lab.data.reset.start",{backupId:backup.id,total,actor});
  let deleted=0;
  try{
    for(const [name,rows] of Object.entries(tables))for(const row of rows){
      if(!ownsLabRow(row,schoolId)||!row.etag)throw Error("清除範圍或資料版本無法驗證");
      await repository.remove(name,row);deleted++;
    }
    const remaining=labDataCount(await repository.capture());
    if(remaining)throw Error("清除期間有其他操作新增或異動資料，請重新讀取；備份可還原");
    await repository.audit("lab.data.reset.complete",{backupId:backup.id,total,deleted,actor});
    return {ok:true,total,deleted,backup,message:"LAB 測試資料已清空；學校、管理員登入設定與操作稽核保留"};
  }catch(error){
    return {ok:false,partial:true,total,deleted,backup,error:"清空未完成："+error.message+"。清除前備份已保留，可使用還原功能。"};
  }
}
export async function restoreLabData({repository,schoolId,backupId,actor}){
  const backup=await repository.readBackup(backupId);
  if(backup.schoolId!==schoolId||labDataFingerprint(backup.tables)!==backup.fingerprint)
    throw Error("備份所屬學校或完整性驗證失敗");
  const current=await repository.capture(),expected=new Map();
  for(const [name,rows] of Object.entries(backup.tables))for(const row of rows){
    if(!ownsLabRow(row,schoolId))throw Error("備份包含非目前學校資料");
    expected.set([name,row.partitionKey,row.rowKey].join("|"),cleanLabRow(row));
  }
  // A restore fills missing rows only. New practice work is never overwritten.
  const present=new Set();
  for(const [name,rows] of Object.entries(current))for(const row of rows){
    const key=[name,row.partitionKey,row.rowKey].join("|"),old=expected.get(key);
    if(!old||JSON.stringify(old)!==JSON.stringify(cleanLabRow(row)))
      throw Object.assign(Error("LAB 已有清空後的新資料或修改，為避免覆蓋練習成果，本次不還原"),{statusCode:409});
    present.add(key);
  }
  await repository.audit("lab.data.restore.start",{backupId,total:expected.size,actor});
  let restored=0;
  for(const [name,rows] of Object.entries(backup.tables))for(const row of rows){
    if(present.has([name,row.partitionKey,row.rowKey].join("|")))continue;
    await repository.insert(name,cleanLabRow(row));restored++;
  }
  if(labDataFingerprint(await repository.capture())!==backup.fingerprint)
    throw Error("還原後資料與備份不一致，請暫停其他操作後重試");
  await repository.audit("lab.data.restore.complete",{backupId,restored,actor});
  return {ok:true,restored,total:expected.size,message:"已還原清空前的 LAB 測試資料"};
}
