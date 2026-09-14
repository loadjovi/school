import { app } from "@azure/functions";
import { getAccess, json } from "../lib/auth.js";
import { ensureTables, table, rowKey, getRegistrationsByEmail, listRegistrations } from "../lib/storage.js";

const allowedGroups=new Set(["A","B","C","儲備"]);
const allowedGrades=new Set(["一年級","二年級","三年級","四年級","五年級","六年級"]);
const allowedInstruments=new Set(["小提琴","中提琴","大提琴","低音提琴","其他"]);

function clean(v,max=100){return String(v||"").trim().slice(0,max)}
function view(e){
  return {
    registrationId:e.rowKey,
    parentEmail:e.parentEmail,
    parentName:e.parentName,
    relationship:e.relationship,
    studentName:e.studentName,
    grade:e.grade,
    groupName:e.groupName,
    instrument:e.instrument,
    status:e.status,
    studentId:e.studentId||null,
    createdAt:e.createdAt,
    reviewedAt:e.reviewedAt||null,
    reviewedBy:e.reviewedBy||null,
    note:e.note||""
  };
}

app.http("studentRegistration",{
  methods:["GET","POST","PATCH"],
  authLevel:"anonymous",
  route:"student-registration",
  handler:async(request)=>{
    const access=await getAccess(request);
    if(!access.authenticated)return json({error:"Unauthorized"},401);

    if(request.method==="GET"){
      if(access.role==="admin"){
        const status=clean(request.query.get("status"),20);
        const items=await listRegistrations(status);
        return json({items:items.map(view)});
      }
      const items=await getRegistrationsByEmail(access.email);
      return json({items:items.map(view)});
    }

    if(request.method==="POST"){
      if(["sectionTeacher","privateTeacher","admin"].includes(access.role))return json({error:"此帳號角色不可提交家長學生登記"},403);
      const body=await request.json();
      const studentName=clean(body.studentName,40);
      const grade=clean(body.grade,20);
      const groupName=clean(body.groupName,10);
      const instrument=clean(body.instrument,20);
      const parentName=clean(body.parentName||access.displayName,40);
      const relationship=clean(body.relationship,20);
      const consent=body.consent===true;

      if(studentName.length<2)return json({error:"請填寫學生姓名"},400);
      if(!allowedGrades.has(grade))return json({error:"請選擇正確年級"},400);
      if(!allowedGroups.has(groupName))return json({error:"請選擇正確團別"},400);
      if(!allowedInstruments.has(instrument))return json({error:"請選擇樂器類別"},400);
      if(!relationship)return json({error:"請填寫與學生關係"},400);
      if(!consent)return json({error:"請勾選資料使用確認"},400);

      const existing=await getRegistrationsByEmail(access.email);
      const duplicate=existing.find(x=>x.studentName===studentName&&x.grade===grade&&["pending","approved"].includes(x.status));
      if(duplicate)return json({error:"此學生已有待審核或已核准的登記資料"},409);

      await ensureTables();
      const registrationId=rowKey("reg");
      const entity={
        partitionKey:"REG",
        rowKey:registrationId,
        parentEmail:access.email,
        parentName,
        relationship,
        studentName,
        grade,
        groupName,
        instrument,
        status:"pending",
        consent:true,
        createdAt:new Date().toISOString(),
        googleSub:access.sub||""
      };
      await table("registrations").createEntity(entity);
      return json({ok:true,registration:view(entity)},201);
    }

    if(access.role!=="admin")return json({error:"Forbidden"},403);
    const body=await request.json();
    const registrationId=clean(body.registrationId,120);
    const action=clean(body.action,20).toLowerCase();
    const note=clean(body.note,300);
    if(!registrationId||!["approve","reject"].includes(action))return json({error:"缺少 registrationId 或 action"},400);

    await ensureTables();
    const regClient=table("registrations");
    let reg;
    try{reg=await regClient.getEntity("REG",registrationId)}catch(e){if(e.statusCode===404)return json({error:"找不到登記資料"},404);throw e}
    if(reg.status!=="pending")return json({error:"此登記已完成審核"},409);

    if(action==="reject"){
      reg.status="rejected";
      reg.reviewedAt=new Date().toISOString();
      reg.reviewedBy=access.email;
      reg.note=note;
      await regClient.updateEntity(reg,"Merge");
      return json({ok:true,status:"rejected"});
    }

    const suffix=(Date.now().toString().slice(-7)+Math.random().toString(36).slice(2,5)).toUpperCase();
    const studentId=`SH${suffix}`;
    await table("userStudentMap").createEntity({
      partitionKey:String(reg.parentEmail).toLowerCase(),
      rowKey:studentId,
      studentName:reg.studentName,
      grade:reg.grade,
      groupName:reg.groupName,
      instrument:reg.instrument,
      relationship:reg.relationship,
      status:"active",
      registrationId,
      createdAt:new Date().toISOString(),
      approvedBy:access.email
    });
    reg.status="approved";
    reg.studentId=studentId;
    reg.reviewedAt=new Date().toISOString();
    reg.reviewedBy=access.email;
    reg.note=note;
    await regClient.updateEntity(reg,"Merge");
    return json({ok:true,status:"approved",studentId});
  }
});
