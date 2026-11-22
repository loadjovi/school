const sizes=["8","10","12","XS","S","M","L","XL","2L","3L","5L"];
export function createTshirtStockDetails({host,api,onReload,onLoans}){
 let state={items:[],openedItems:[],movements:[]},draft=null,requestId="",busy=false,root=null;
 const node=(tag,text)=>{const element=document.createElement(tag);if(text!==undefined)element.textContent=text;return element};
 let summary,opened,history,action,size,quantity,note,save,message;
 function init(){
  root=node("div");root.className="tshirt-stock-details";summary=node("p");summary.className="notice";
  root.append(summary,node("h3","已拆封團 T／志工借用"),node("p","與新團 T 分開管理；只列有紀錄的尺寸。志工洗淨歸還後，回到已拆封庫存。"));
  opened=node("div");root.append(opened);
  const loans=node("button","查看借用／歸還紀錄");loans.type="button";loans.addEventListener("click",onLoans);root.append(loans);
  const details=node("details"),form=node("form");details.append(node("summary","新增／盤點已拆封團 T"));form.className="opened-stock-form";
  action=node("select");action.name="action";for(const [value,label] of [["OPEN_FROM_NEW","從新團 T 拆封移入"],["SET_OPENED_COUNT","盤點既有已拆封團 T"]]){const option=node("option",label);option.value=value;action.append(option)}action.value="OPEN_FROM_NEW";
  size=node("select");size.name="size";size.required=true;const empty=node("option","請選擇尺寸");empty.value="";size.append(empty);for(const value of sizes){const option=node("option",value);option.value=value;size.append(option)}
  quantity=node("input");quantity.type="number";quantity.name="quantity";quantity.min="0";quantity.max="10000";quantity.step="1";quantity.inputMode="numeric";quantity.required=true;
  note=node("input");note.name="note";note.maxLength=300;note.placeholder="例如：活動志工備用（選填）";
  for(const [label,control] of [["操作",action],["尺寸",size],["數量",quantity],["備註",note]]){const wrap=node("label",label);wrap.append(control);form.append(wrap)}
  form.append(node("p","拆封移入會扣除新團 T；盤點只設定已拆封的在庫總數，不含借出中的件數。"));
  save=node("button","確認更新已拆封庫存");save.type="submit";message=node("p");message.setAttribute("role","status");form.append(save,message);details.append(form);root.append(details);
  form.addEventListener("input",()=>{draft??={items:state.items.map(x=>({...x})),openedItems:state.openedItems.map(x=>({...x}))};requestId=""});
  form.addEventListener("submit",async event=>{
   event.preventDefault();if(busy)return;const count=Number(quantity.value);
   if(!sizes.includes(size.value)||!quantity.value.trim()||!Number.isSafeInteger(count)||count<0||count>10000||action.value==="OPEN_FROM_NEW"&&count===0){message.textContent="請選擇尺寸並填寫正確件數；拆封移入至少 1 件。";return}
   const snapshot=draft||state,stock=snapshot.items.find(x=>x.key==="regular:"+size.value),old=snapshot.openedItems.find(x=>x.size===size.value);
   busy=true;for(const field of [action,size,quantity,note,save])field.disabled=true;message.textContent="正在更新庫存…";requestId||=crypto.randomUUID();let committed=false;
   try{
    await api("uniform-events/inventory",{method:"POST",body:JSON.stringify({action:action.value,size:size.value,quantity:count,note:note.value.trim(),requestId,stockEtag:stock?.etag??null,openedEtag:old?.etag??null})});
    committed=true;draft=null;requestId="";quantity.value="";note.value="";message.textContent="已更新已拆封庫存，並留下異動紀錄。";await onReload();
   }catch(error){message.textContent=(committed?"庫存已更新，請重新整理：":"更新未確認：")+error.message}
   finally{busy=false;for(const field of [action,size,quantity,note,save])field.disabled=false}
  });
  const log=node("details");log.append(node("summary","庫存異動紀錄"));history=node("div");log.append(history);root.append(log);host.replaceChildren(root);
 }
 function table(headers,rows){const grid=node("table"),head=node("thead"),tr=node("tr"),body=node("tbody");for(const header of headers)tr.append(node("th",header));head.append(tr);grid.append(head,body);for(const row of rows){const line=node("tr");for(const value of row)line.append(node("td",String(value)));body.append(line)}return grid}
 function render(data){
  state={items:data.items||[],openedItems:data.openedItems||[],movements:data.movements||[]};if(!root)init();else if(!host.contains(root))host.replaceChildren(root);host.hidden=false;
  const total=state.items.filter(x=>x.key.startsWith("regular:")).reduce((sum,x)=>sum+x.onHand,0),inStock=state.openedItems.reduce((sum,x)=>sum+x.onHand,0),borrowed=state.openedItems.reduce((sum,x)=>sum+x.borrowed,0);
  summary.textContent="新團 T 在庫 "+total+" 件｜已拆封在庫 "+inStock+" 件｜借出／送洗 "+borrowed+" 件";
  opened.replaceChildren(state.openedItems.length?table(["尺寸","已拆封在庫","借出／送洗"],state.openedItems.map(x=>[x.size,x.onHand+" 件",x.borrowed+" 件"])):node("p","目前尚無已拆封團 T 庫存或志工借用紀錄。"));
  history.replaceChildren(state.movements.length?table(["時間／異動","尺寸／件數","備註"],state.movements.map(x=>[new Date(x.at).toLocaleString("zh-TW",{timeZone:"Asia/Taipei"})+"｜"+x.action,x.sizes+(x.quantity===null?"":"（"+(x.quantity>0?"+":"")+x.quantity+" 件）"),x.note||"—"])):node("p","目前尚無庫存異動紀錄。"));
 }
 return {render,fail:error=>host.replaceChildren(node("p","已拆封庫存與異動紀錄讀取失敗："+error))};
}
