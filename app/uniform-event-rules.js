// 聖心弦樂成長平台：團服與活動模組共用規則（獨立模組，尚未接入正式 UI/API）
export const SCHOOL_ID = "sacred-heart";
export const SHIRT_SIZES = [
  ["8",29,35,50],["10",32,38,54],["12",35,42,58],["XS",39,45,62],
  ["S",42,48,65],["M",45,51,70],["L",48,53,72],["XL",51,56,75],
  ["2L",54,59,78],["3L",57,61,80],["5L",60,66,83]
].map(([size,shoulder,chestFlat,length])=>({size,shoulder,chestFlat,length}));
export const REGULAR_UNIFORM = Object.freeze({freeFirstQuantity:1,additionalPrice:400,minProductionQuantity:10});
export const COMPETITION_UNIFORM = Object.freeze({group:"A",unitPrice:2625,femaleSizes:["XS","S","M","L"],maleSizes:["S","M","L","2L"]});
export const COMPETITION_ROSTER = [
["4A","林心澄","小一","小提","S","女","RENTAL"],
["4C","李旭恩","大提","大提","S","男","PENDING"],
["4D","蘇聖翔","中提","中提","M","男","PENDING"],
["5A","吳定廩","大提","大提","M","男","RENTAL"],
["5A","蔡昀潔","中提","中提","M","女","PENDING"],
["5C","游宜橙","小二","小提","M","女","PURCHASE"],
["5C","陳祉瑄","小二","小提","XS","女","RENTAL"],
["5D","楊力萓","大提","大提","S","女","PURCHASE"],
["6A","李婇寧","小一","小提","M","女","RENTAL"],
["6B","賴昺旭","中提","中提","S","男","RENTAL"],
["6C","張安侖","大提","大提","L","男","PURCHASE"],
["6C","黃禹閎","小二","小提","M","男","PURCHASE"],
["6C","陳奕亘","中提","中提","L","男","RENTAL"],
["6D","張介輔","小一","小提","L","男","RENTAL"],
["6D","李宥蓁","大提","大提","L","女","RENTAL"]
].map(([className,name,section,instrument,size,style,acquisition])=>({className,name,section,instrument,size,style,acquisition}));
export function freeEligibility(history) {
  // Unknown history is never interpreted as unused entitlement.
  if (!Array.isArray(history) || history.some(x=>x?.verification==="PENDING")) return "PENDING";
  return history.some(x=>x?.type==="REGULAR" && x?.free===true && x?.delivered===true) ? "USED" : "AVAILABLE";
}
export function availableStock(onHand,reserved,unavailable=0) {
  return Math.max(0,Number(onHand||0)-Number(reserved||0)-Number(unavailable||0));
}
export function purchaseSuggestion(demandBySize,stockBySize,inboundBySize={}) {
  const shortages={};
  for (const [size,needed] of Object.entries(demandBySize)) {
    const s=stockBySize[size]||{};
    const usable=availableStock(s.onHand,s.reserved,s.unavailable);
    shortages[size]=Math.max(0,Number(needed||0)-usable-Number(inboundBySize[size]||0));
  }
  const total=Object.values(shortages).reduce((a,b)=>a+b,0);
  return {shortages,total,extraForMinimum:total===0?0:Math.max(0,REGULAR_UNIFORM.minProductionQuantity-total)};
}
export function activityTotal({students=0,firstAdults=0,extraAdults=0,extraChildren=0},{studentFee=0,firstAdultFee=0,extraAdultFee=0,extraChildFee=0}) {
  return students*studentFee+firstAdults*firstAdultFee+extraAdults*extraAdultFee+extraChildren*extraChildFee;
}
