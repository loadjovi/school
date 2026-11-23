import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const htmlAttributes=path=>read(path).match(/<html\b[^>]*>/i)?.[0]||"";

test("production entrypoints explicitly open the validated payment controls without relying on the LAB generator",()=>{
 for(const page of ["app/index.html","app/uniform-event-admin.html","app/parent-uniform-events.html","app/finance-review.html"]){
  assert.match(htmlAttributes(page),/\bdata-payment-resolution="true"/,page);
  assert.doesNotMatch(read(page),/functional-lab-banner\.js|\/sop-lab\//,page);
 }
 assert.match(htmlAttributes("app/index.html"),/\bdata-line-first-notifications="true"/);
 assert.match(htmlAttributes("app/uniform-event-admin.html"),/\bdata-line-uat-finance-retry="true"/);
});

test("production deploys source app and API rather than an isolated LAB build or its generated fixtures",()=>{
 const workflow=read(".github/workflows/azure-static-web-apps-lively-field-09afddc00.yml");
 assert.match(workflow,/app_location:\s*"app"/);
 assert.match(workflow,/api_location:\s*"api"/);
 assert.doesNotMatch(workflow,/app_location:\s*\.?functional-lab-build|api_location:\s*\.?functional-lab-build|prepare-functional-lab\.py[^\n]*--line-uat/);
});
