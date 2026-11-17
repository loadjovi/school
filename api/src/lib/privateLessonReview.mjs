export function validateParentLessonReview(ratingValue,reviewValue){
  const rating=Number(ratingValue||0),review=String(reviewValue??"").trim().slice(0,800);
  if(rating&&(!Number.isInteger(rating)||rating<1||rating>5))return {error:"老師評價必須為 1～5 顆星"};
  if(rating&&!review)return {error:"已選擇星等，請填寫老師教學評論後再確認完成上課"};
  if(review&&!rating)return {error:"若要留下老師教學評論，請先選擇 1～5 顆星"};
  return {rating,review};
}
