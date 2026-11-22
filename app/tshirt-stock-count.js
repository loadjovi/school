const sizes=["8","10","12","XS","S","M","L","XL","2L","3L","5L"];

export function createTshirtStockCounter({host,api,onReload}){
 let form=null,dirty=false,saving=false,needsReload=false,message="",renderedSignature="",draftFields=[],saveControl=null;
 const node=(tag,text)=>{const element=document.createElement(tag);if(text!==undefined)element.textContent=text;return element};
 const signature=items=>JSON.stringify(items.filter(item=>item.key.startsWith("regular:")).map(item=>[item.key,item.onHand,item.reserved,item.unavailable,item.etag]).sort((a,b)=>a[0].localeCompare(b[0])));
 const currentText=(cell,stock)=>{cell.textContent=stock?stock.onHand+" 件":"待盤點";if(stock&&(stock.reserved||stock.unavailable))cell.append(node("small","保留 "+stock.reserved+"／不可用 "+stock.unavailable))};
 function render(items){
  if(dirty&&form){
   if(signature(items)!==renderedSignature){
    needsReload=true;const latest=new Map(items.map(item=>[item.key,item]));
    for(const field of draftFields){currentText(field.current,latest.get("regular:"+field.size));field.input.disabled=true}
    saveControl.disabled=true;form.querySelector("#tshirtStockCountStatus").textContent="庫存已有到貨、發放或借還異動；目前庫存已更新，請先重新讀取後再盤點。";
   }
   if(!host.contains(form))host.replaceChildren(form);return;
  }
  renderedSignature=signature(items);
  needsReload=false;const stocks=new Map(items.map(item=>[item.key,item])),fields=[];
  form=node("form");form.className="tshirt-stock-count";form.id="tshirtStockCountForm";
  const hint=node("p","新團 T 到貨自動入庫；僅實體盤點有差異時調整。空白不異動；0 表示無庫存。");hint.id="tshirtStockCountHint";
  const table=node("table"),head=node("thead"),header=node("tr"),body=node("tbody");
  for(const text of ["尺寸","新團 T 在庫","盤點數量"])header.append(node("th",text));head.append(header);table.append(head,body);
  for(const size of sizes){
   const stock=stocks.get("regular:"+size),row=node("tr"),label=node("th",size),current=node("td"),cell=node("td"),input=node("input");currentText(current,stock);
   label.scope="row";input.type="number";input.min="0";input.max="10000";input.step="1";input.inputMode="numeric";input.value=stock?String(stock.onHand):"";input.placeholder="待盤點";input.name="count-"+size;
   input.setAttribute("aria-label",size+" 尺寸盤點數量");input.setAttribute("aria-describedby",hint.id);
   cell.append(input);row.append(label,current,cell);body.append(row);fields.push({size,stock,input,current});
  }
  const actions=node("div"),save=node("button","一次儲存庫存"),reload=node("button","重新讀取庫存"),status=node("p",message);
  actions.className="tshirt-stock-count-actions";save.type="submit";reload.type="button";status.id="tshirtStockCountStatus";status.setAttribute("role","status");status.setAttribute("aria-live","polite");actions.append(save,reload);
  draftFields=fields;saveControl=save;
  form.append(hint,table,actions,status);form.addEventListener("input",()=>{dirty=true;message="";status.textContent="數量已修改，請按「一次儲存庫存」。"});
  const busy=value=>{saving=value;for(const field of fields)field.input.disabled=value||needsReload;save.disabled=value||needsReload;reload.disabled=value};
  reload.addEventListener("click",async()=>{if(saving)return;busy(true);try{dirty=false;message="";await onReload()}catch(error){status.textContent=error.message}finally{busy(false)}});
  form.addEventListener("submit",async event=>{
   event.preventDefault();if(saving||needsReload)return;
   const changes=[];
   for(const {size,stock,input} of fields){
    const raw=input.value.trim();if(raw==="")continue;
    const onHand=Number(raw);
    if(!/^\d+$/.test(raw)||!Number.isSafeInteger(onHand)||onHand>10000){status.textContent=size+" 尺寸請填 0～10000 的整數";input.focus();return}
    if(stock&&onHand===stock.onHand)continue;
    if(onHand<(stock?.reserved??0)+(stock?.unavailable??0)){status.textContent=size+" 尺寸不可少於已保留與不可用數量";input.focus();return}
    changes.push({size,onHand,etag:stock?.etag??null});
   }
   if(!changes.length){status.textContent="請先填寫或修改要盤點的數量。";return}
   dirty=true;busy(true);status.textContent="正在儲存全部盤點數量…";let saved=false;
   try{
    const result=await api("uniform-events/inventory",{method:"POST",body:JSON.stringify({type:"regularUniform",action:"BATCH_SET_COUNT",items:changes})});
    saved=true;dirty=false;message="已一次儲存 "+result.updated+" 個尺寸，採購總表會同步更新。";busy(false);await onReload();
    const feedback=host.querySelector("#tshirtStockCountStatus");if(feedback)feedback.textContent=message;
   }catch(error){needsReload=saved;message=(saved?"庫存已儲存，請重新讀取庫存：":"儲存未確認：")+error.message;status.textContent=message}
   finally{busy(false)}
  });
  host.replaceChildren(form);
 }
 return {render};
}
