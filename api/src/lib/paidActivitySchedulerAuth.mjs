import {createHash,createPublicKey,timingSafeEqual,verify} from "node:crypto";

// This grant can only trigger the existing due-notice dispatcher. It cannot select
// schools, recipients, activities or message text and is never accepted by LAB.
const issuer="https://token.actions.githubusercontent.com";
const jwksUrl=issuer+"/.well-known/jwks";
const audience="https://lively-field-09afddc00.6.azurestaticapps.net";
const repository="loadjovi/school",repositoryId="1369594952",ownerId="230955742";
const ref="refs/heads/main";
const workflowRef=repository+"/.github/workflows/paid-activity-production-dispatch.yml@"+ref;
const subjects=new Set([
  "repo:"+repository+":ref:"+ref,
  "repo:loadjovi@"+ownerId+"/school@"+repositoryId+":ref:"+ref
]);
const digest=value=>createHash("sha256").update(value).digest();
const denied=status=>({authorized:false,status});
const production=env=>["","production"].includes(String(env.LAB_ENVIRONMENT||"").trim());
function jsonPart(encoded,max){
  if(!encoded||encoded.length>max||!/^[A-Za-z0-9_-]+$/.test(encoded))throw Error("Malformed token");
  const decoded=Buffer.from(encoded,"base64url");
  if(decoded.toString("base64url")!==encoded)throw Error("Malformed token encoding");
  const value=JSON.parse(decoded.toString("utf8"));
  if(!value||typeof value!=="object"||Array.isArray(value))throw Error("Malformed token object");
  return value;
}
function allowedClaims(claims,now){
  if(claims.iss!==issuer||claims.aud!==audience||!subjects.has(claims.sub)||claims.repository!==repository||
    claims.repository_id!==repositoryId||claims.repository_owner_id!==ownerId||claims.repository_owner!=="loadjovi"||
    claims.ref!==ref||claims.ref_type!=="branch"||claims.workflow_ref!==workflowRef||
    !["schedule","workflow_dispatch"].includes(claims.event_name)||claims.runner_environment!=="github-hosted")return false;
  const seconds=Math.floor(now/1000),skew=30;
  if(![claims.exp,claims.iat,claims.nbf].every(Number.isSafeInteger)||
    claims.iat>seconds+skew||claims.nbf>seconds+skew||claims.exp<=seconds-skew||
    claims.iat<seconds-600||claims.exp<=claims.iat||claims.exp-claims.iat>600||claims.nbf>claims.exp)return false;
  return typeof claims.jti==="string"&&claims.jti.length>0&&claims.jti.length<=200;
}

export function createPaidActivitySchedulerAuthorizer({fetchImpl=globalThis.fetch,now=Date.now,environment=()=>process.env}={}){
  let cache={keys:[],until:0},refreshing=null,lastRefresh=-Infinity;
  async function keys(kid){
    if(cache.until>now()&&cache.keys.some(key=>key.kid===kid))return cache.keys;
    // An unknown kid must not make arbitrary unauthenticated traffic fetch keys
    // repeatedly. A new legitimate rotation can retry on the next scheduler run.
    if(!refreshing&&now()-lastRefresh<30000)return cache.until>now()?cache.keys:[];
    if(!refreshing){
      lastRefresh=now();
      refreshing=(async()=>{
        const response=await fetchImpl(jwksUrl,{redirect:"error",headers:{accept:"application/json"},signal:AbortSignal.timeout(4000)});
        if(!response.ok)throw Error("Identity provider unavailable");
        const length=Number(response.headers?.get("content-length")||0);
        if(length>100000)throw Error("Key document too large");
        const text=await response.text();
        if(Buffer.byteLength(text)>100000)throw Error("Key document too large");
        const document=JSON.parse(text);
        if(!Array.isArray(document.keys)||!document.keys.length||document.keys.length>32)throw Error("Invalid keys");
        const valid=document.keys.filter(key=>key&&key.kty==="RSA"&&(!key.alg||key.alg==="RS256")&&(!key.use||key.use==="sig")&&
          typeof key.kid==="string"&&key.kid.length>0&&key.kid.length<=200&&key.e==="AQAB"&&
          typeof key.n==="string"&&/^[A-Za-z0-9_-]+$/.test(key.n)&&Buffer.from(key.n,"base64url").length>=256&&Buffer.from(key.n,"base64url").length<=1024&&
          !key.d&&(!key.key_ops||Array.isArray(key.key_ops)&&key.key_ops.includes("verify")));
        cache={keys:valid,until:now()+5*60*1000};
        return valid;
      })().finally(()=>{refreshing=null});
    }
    return refreshing;
  }
  return async function authorize(authorization){
    const env=environment(),secret=String(env.LINE_PAID_ACTIVITY_SCHEDULER_TOKEN||"");
    const supplied=typeof authorization==="string"?authorization:"";
    if(supplied.length>16000)return denied(401);
    if(secret&&timingSafeEqual(digest(supplied),digest("Bearer "+secret)))return {authorized:true,method:"shared-secret"};
    if(!production(env))return denied(secret?401:503);
    if(!supplied.startsWith("Bearer "))return denied(401);
    const token=supplied.slice(7),parts=token.split(".");let header,claims;
    try{
      if(parts.length!==3||parts[2].length>1400||!/^[A-Za-z0-9_-]+$/.test(parts[2]))return denied(401);
      header=jsonPart(parts[0],1500);claims=jsonPart(parts[1],12000);
      if(header.alg!=="RS256"||header.typ!=="JWT"||typeof header.kid!=="string"||!header.kid||header.kid.length>200||
        header.crit||header.jwk||header.jku||header.x5u||!allowedClaims(claims,now()))return denied(401);
    }catch{return denied(401)}
    let available;
    try{available=await keys(header.kid)}catch{return denied(503)}
    const matching=available.filter(key=>key.kid===header.kid);
    if(matching.length!==1)return denied(401);
    try{
      const key=createPublicKey({key:matching[0],format:"jwk"});
      const signature=Buffer.from(parts[2],"base64url");
      if(signature.toString("base64url")!==parts[2]||!verify("RSA-SHA256",Buffer.from(parts[0]+"."+parts[1]),key,signature))return denied(401);
      return {authorized:true,method:"github-oidc"};
    }catch{return denied(401)}
  };
}
export const authorizePaidActivityScheduler=createPaidActivitySchedulerAuthorizer();
