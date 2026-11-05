import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const api=readFileSync(new URL("../api/src/functions/tshirtParentLoans.js",import.meta.url),"utf8");
const ui=readFileSync(new URL("../app/tshirt-parent-loans.js",import.meta.url),"utf8");
const admin=readFileSync(new URL("../app/uniform-event-admin.js",import.meta.url),"utf8");
const html=readFileSync(new URL("../app/uniform-event-admin.html",import.meta.url),"utf8");
const panelStart=html.indexOf('id="tshirtParentsPanel"');
const panel=html.slice(panelStart,html.indexOf('data-tshirt-panel="students"',panelStart));

test("active volunteer loan has one direct clean-return action instead of a hidden washing workflow",()=>{
 new vm.Script(ui,{filename:"tshirt-parent-loans.js"});
 assert.match(ui,/確認洗淨歸還並回庫存/);
 assert.match(ui,/action:"RETURN"/);
 assert.match(ui,/同尺寸可用庫存會增加 1 件/);
 assert.match(ui,/每次借用只能回庫存一次/);
 assert.doesNotMatch(panel,/<option value="MARK_WASHING">/);
 assert.doesNotMatch(panel,/<option value="RETURN">/);
 assert.match(panel,/使用後由家長洗淨再交回/);
 assert.match(panel,/同尺寸庫存才會加回 1 件/);
 assert.match(html,/tshirt-parent-loans\.js\?v=20261105-volunteer-return-stock/);
 assert.match(html,/uniform-event-admin\.js\?v=20261105-volunteer-return-stock/);
 assert.match(admin,/addEventListener\("tshirtParentLoansChanged",\(\)=>load\(\)\)/);
});

test("volunteer borrow and return share a durable inventory ledger and update stock once",()=>{
 assert.match(api,/TableClient\.fromConnectionString\(conn,"TenantUniformInventory"\)/);
 assert.match(api,/"tshirt-loan:"\+Buffer\.from\(email\)\.toString\("base64url"\)/);
 assert.match(api,/status:"BORROWED"/);
 assert.match(api,/onHand:before\.onHand-1/);
 assert.match(api,/status:"RETURNED"/);
 assert.match(api,/onHand:before\.onHand\+1/);
 assert.match(api,/ledger\?\.status==="RETURNED"/);
 assert.match(api,/idempotent:true,operation:"RETURN"/);
 assert.match(api,/submitTransaction/);
});

test("clean return accepts both current and legacy washing states, while size correction moves tracked stock",()=>{
 assert.match(api,/action==="RETURN"&&!\["BORROWED","WASHING"\]\.includes\(old\.status\)/);
 assert.match(api,/oldAfter=\{\.\.\.oldBefore,onHand:oldBefore\.onHand\+1\}/);
 assert.match(api,/newAfter=\{\.\.\.newBefore,onHand:newBefore\.onHand-1\}/);
 assert.match(api,/legacyLoan:!ledger/);
 assert.match(api,/before:previous,after:next,stock:stockResult/);
});
