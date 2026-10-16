// A 團比賽服：依去年紙本名單確認的班級。僅供展示與核對，尚非正式庫存／領用紀錄。
export const confirmedReceived=new Map([
 ["李婇寧","5A"],["張介輔","5D"],["林心澄","3A"],["黃禹閎","5C"],
 ["游宜橙","4A"],["陳祉瑄","4B"],["賴昺旭","5B"],["陳奕亘","5C"],
 ["張安侖","5C"],["李宥蓁","5D"],["吳定廩","4A"],["楊力萓","4D"]
]);
export const promotedClass=value=>{const m=/^([1-6])([A-Z])$/.exec(value||"");return m?String(Number(m[1])+1)+m[2]:"待核對"};
