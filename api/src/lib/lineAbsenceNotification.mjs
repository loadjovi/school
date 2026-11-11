import {getLineNotificationTarget} from "./settings.js";
import {pushLineMessage} from "./lineMessaging.mjs";

const allowed=new Set(["section","ensemble","comprehensive","training"]);
const classLabel={section:"分部課",ensemble:"合奏課",comprehensive:"綜合課",training:"訓練／加練"};
const clean=(value,max=100)=>String(value||"").trim().slice(0,max);
// Normalize the confirmed duplicated teacher name in notification output only.
const cleanActorName=value=>clean(value,80).replace(/^陳宣文文$/u,"陳宣文");

export function lineAbsenceCandidates(items=[]){
  const unique=new Map();
  for(const item of items){
    if(String(item?.status||"")!=="absent"||!allowed.has(String(item?.classType||""))||!item?.studentId)continue;
    const key=[item.date,item.studentId,item.classType,item.groupName||"",item.classType==="section"?item.section||"":item.eventId||""].join("|");
    if(!unique.has(key))unique.set(key,item);
  }
  return [...unique.values()];
}

export function lineAbsenceMessage({date,items=[],actorName="",appUrl=""}={}){
  const students=lineAbsenceCandidates(items);
  if(!students.length)return "";
  const lines=[
    "🔴 學生缺席即時通知",
    `日期：${clean(date||students[0]?.date,20)}`,
    `新登記缺席：${students.length} 位`,
    ""
  ];
  students.forEach((item,index)=>{
    const course=item.classType==="training"&&item.eventTitle?`訓練／加練（${clean(item.eventTitle,50)}）`:classLabel[item.classType]||clean(item.classType,30);
    const parts=[clean(item.name,60),item.groupName?`${clean(item.groupName,20)}團`:"",clean(item.section,40),course].filter(Boolean);
    lines.push(`${index+1}. ${parts.join("｜")}`);
  });
  if(actorName)lines.push("",`點名人員：${cleanActorName(actorName)}`);
  lines.push("","請登入「聖心弦樂成長平台 → 出勤與請假」確認學生狀況。","本通知只在學生新標記為缺席時發送；請假、遲到與重複儲存不通知。");
  if(appUrl)lines.push(`平台：${clean(appUrl,350)}`);
  return lines.join("\n").slice(0,5000);
}

export async function dispatchLineAbsenceNotifications({schoolId,date,items=[],actorName=""}={}){
  const students=lineAbsenceCandidates(items);
  if(!students.length)return {sent:false,reason:"no_absence",count:0};
  if(process.env.LAB_ENVIRONMENT==="functional-uat")return {sent:false,reason:"lab_suppressed",count:students.length};
  const target=await getLineNotificationTarget(schoolId,"absence");
  if(!target.targetId)return {sent:false,reason:"not_bound",count:students.length};
  const text=lineAbsenceMessage({date,items:students,actorName,appUrl:process.env.PUBLIC_APP_URL||""});
  await pushLineMessage(target.targetId,text);
  return {sent:true,reason:"sent",count:students.length};
}
