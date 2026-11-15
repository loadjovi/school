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

function area(x,y,label,target){
  return {bounds:{x,y,width:1250,height:843},action:{type:"uri",label,uri:target}};
}

export function labRichMenuDefinition(audience,origin){
  if(audience===LAB_RICH_MENU_AUDIENCES.PARENT)return {
    size:{width:2500,height:1686},selected:true,name:"LAB 聖心弦樂－家長選單",chatBarText:"家長功能",
    areas:[
      area(0,0,"今日課程",uri(origin,"?line_menu=parent_today_courses")),
      area(1250,0,"最新公告",uri(origin,"?line_menu=parent_announcements")),
      area(0,843,"活動行事曆",uri(origin,"?line_menu=parent_activity_calendar")),
      area(1250,843,"開啟家長平台",uri(origin,"?line_menu=parent_portal"))
    ]
  };
  if(audience===LAB_RICH_MENU_AUDIENCES.STAFF)return {
    size:{width:2500,height:1686},selected:true,name:"LAB 聖心弦樂－幹部選單",chatBarText:"幹部功能",
    areas:[
      area(0,0,"今日全團課程",uri(origin,"?line_menu=staff_today_courses")),
      area(1250,0,"點名管理",uri(origin,"?line_menu=staff_attendance")),
      area(0,843,"待辦事項",uri(origin,"?line_menu=staff_todos")),
      area(1250,843,"開啟幹部平台",uri(origin,"?line_menu=staff_portal"))
    ]
  };
  throw new Error("不支援的 LAB 圖文選單角色");
}
