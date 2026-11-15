const normalize=value=>String(value||"").trim();

export const LAB_RICH_MENU_AUDIENCES=Object.freeze({
  UNBOUND:"unbound",
  PARENT:"parent",
  STAFF:"staff"
});

export function resolveLabRichMenuAudience({schoolId="",tenantRoles=[],studentCount=0,parentLinked=false}={}){
  const sid=normalize(schoolId).toLowerCase();
  const roles=Array.isArray(tenantRoles)?tenantRoles:[];
  const staff=roles.some(row=>{
    if(String(row?.status||"active")!=="active")return false;
    const role=normalize(row?.role),roleSchool=normalize(row?.schoolId).toLowerCase();
    return role==="globalAdmin"||(role==="schoolAdmin"&&Boolean(sid)&&roleSchool===sid);
  });
  if(staff)return LAB_RICH_MENU_AUDIENCES.STAFF;
  if(parentLinked||Number(studentCount)>0)return LAB_RICH_MENU_AUDIENCES.PARENT;
  return LAB_RICH_MENU_AUDIENCES.UNBOUND;
}

function uri(origin,path){
  const base=normalize(origin).replace(/\/+$/g,"");
  return `${base}/${String(path||"").replace(/^\/+/,"")}`;
}

function area(x,y,width,height,label,target){
  return {bounds:{x,y,width,height},action:{type:"uri",label,uri:target}};
}

function messageArea(x,y,width,height,label,text){
  return {bounds:{x,y,width,height},action:{type:"message",label,text}};
}

export function labRichMenuDefinition(audience,origin){
  if(audience===LAB_RICH_MENU_AUDIENCES.PARENT)return {
    size:{width:2500,height:1686},selected:true,name:"LAB 聖心弦樂－家長選單",chatBarText:"家長功能",
    areas:[
      messageArea(0,0,1250,843,"今日課程","今日課程"),
      messageArea(1250,0,1250,843,"最新公告","最新公告"),
      area(0,843,1250,843,"活動行事曆",uri(origin,"?line_menu=parent_activity_calendar")),
      area(1250,843,1250,843,"開啟家長平台",uri(origin,"?line_menu=parent_portal"))
    ]
  };
  if(audience===LAB_RICH_MENU_AUDIENCES.STAFF)return {
    size:{width:2500,height:1686},selected:true,name:"LAB 聖心弦樂－幹部選單",chatBarText:"幹部功能",
    areas:[
      messageArea(0,0,833,843,"今日課程","今日課程"),
      area(833,0,834,843,"活動行事曆",uri(origin,"?line_menu=staff_activity_calendar")),
      messageArea(1667,0,833,843,"最新公告","最新公告"),
      area(0,843,833,843,"點名管理",uri(origin,"?line_menu=staff_attendance")),
      area(833,843,834,843,"待辦事項",uri(origin,"?line_menu=staff_todos")),
      area(1667,843,833,843,"開啟幹部平台",uri(origin,"?line_menu=staff_portal"))
    ]
  };
  throw new Error("不支援的 LAB 圖文選單角色");
}
