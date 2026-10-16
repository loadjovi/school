# 第二階段：Azure Functions 設定 API

## 已新增
- `api/src/functions/uniformEventConfig.js`
- `GET /api/uniform-events/config`：登入的學校管理員查全部設定；家長只查 enabled=true 設定
- `POST /api/uniform-events/config`：僅學校管理員可建立／更新，需帶 `id`、`module`、`enabled`
- 使用登入情境取得 schoolId，不接受客戶端任意指定 schoolId
- Table Storage 表名 `TenantUniformEventConfig`，可用 `UNIFORM_EVENT_CONFIG_TABLE` 環境變數覆寫
- 各學校資料以 PartitionKey 分隔；目前尚未建立活動報名及團服配發的寫入端點

## 安全與限制
- 不會自動匯入 A 團名單，也不會推定團服首次免費資格
- 活動建立時需指定費用、地點與時間
- 正式使用前需要加入學校後台設定畫面、家長畫面、完整 CRUD、角色測試、資料操作稽核與付款流程
- Azure Table Storage 的單筆設定 upsert 非跨筆交易；庫存與報名須另外設計併發防護
- 此 PR 尚未完成第二階段所有功能，不可合併正式 main

## 驗證清單
1. GitHub Actions syntax check、Oryx Azure Functions build
2. 未登入 GET/POST 回 401
3. 家長 POST 回 403；管理員 POST 可建立並讀取
4. 不同 schoolId 無法讀取或修改彼此設定
5. 活動費用負值及日期錯誤回 400
6. 正式站不受 PR Preview 部署影響
