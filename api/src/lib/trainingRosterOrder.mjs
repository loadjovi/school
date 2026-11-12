const sectionOrder=new Map([
  ["小提一部",0],
  ["小提二部",1],
  ["中提",2],
  ["大提",3],
  ["低音提",4]
]);

const chineseGradeOrder=new Map([
  ["一",1],
  ["二",2],
  ["三",3],
  ["四",4],
  ["五",5],
  ["六",6]
]);

const collator=new Intl.Collator("zh-Hant",{numeric:true,sensitivity:"base"});
const compact=value=>String(value||"").trim().replace(/\s+/g,"");

export function trainingSectionRank(value){
  const section=compact(value);
  if(sectionOrder.has(section))return sectionOrder.get(section);
  if(section.includes("小提一")||section.includes("小提琴一")||section.includes("第一小提"))return 0;
  if(section.includes("小提二")||section.includes("小提琴二")||section.includes("第二小提"))return 1;
  if(section.includes("中提"))return 2;
  if(section.includes("低音"))return 4;
  if(section.includes("大提"))return 3;
  return 5;
}

function gradeRank(value){
  const grade=compact(value);
  const chinese=grade.match(/([一二三四五六])年級/);
  if(chinese)return chineseGradeOrder.get(chinese[1]);
  const numeric=grade.match(/^([1-6])(?:年級|[A-Za-z]|$)/i);
  return numeric?Number(numeric[1]):99;
}

export function compareTrainingRoster(a,b){
  return trainingSectionRank(a?.section)-trainingSectionRank(b?.section)
    ||gradeRank(a?.grade)-gradeRank(b?.grade)
    ||collator.compare(String(a?.studentName||a?.name||""),String(b?.studentName||b?.name||""))
    ||collator.compare(String(a?.rowKey||a?.studentId||""),String(b?.rowKey||b?.studentId||""));
}

export function sortTrainingRoster(rows){
  return (Array.isArray(rows)?rows:[]).slice().sort(compareTrainingRoster);
}
