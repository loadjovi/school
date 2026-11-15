# Functional UAT LAB｜LINE Login、單人測試通知與發送稽核

更新日期：2026-11-11

## 安全邊界

- 功能只由 `scripts/prepare-functional-lab.py` 產生到獨立 Functional UAT LAB，不會在 Production `app/` 或 `api/` 註冊。
- LAB 使用獨立 Azure Static Web App 與獨立 Storage；`LAB_ENVIRONMENT`、`LAB_EXPECTED_STORAGE_ACCOUNT` 與 Connection String 的 AccountName 任一不符即停止服務。
- 正式 LINE Official Account 的 Webhook、正式家長綁定資料與正式通知流程不變。
- 共用 Production LINE 模組在 LAB 一律停用外部發送。唯一例外是 LAB 產生的單一測試 API，而且只能送給環境設定中的同一位測試家長與 LINE User ID。
- 不接受瀏覽器指定收件者或任意訊息；訊息內容固定於伺服器端。
- Token、Secret、完整 LINE User ID 與完整 Connection String 不得出現在前端、API 回應、稽核表或應用程式日誌。

## 已完成

1. LINE Login 採 state、nonce、PKCE、一次性交易與 ETag 防重放。
2. OAuth Callback 驗證 ID token、audience、nonce 與 LINE User ID 格式，再綁定目前已登入的 LAB 家長。
3. `POST /api/line/lab-send-test` 依序驗證：
   - Functional UAT LAB 設定；
   - 已登入家長身分；
   - 指定測試家長 Email；
   - 指定 LINE User ID；
   - 實際綁定目標完全相符；
   - 伺服器端 Messaging Access Token 已設定；
   - 原子化 rolling 60 秒發送限制。
4. 60 秒限制使用固定 Row Key、Create conflict 與 ETag Replace；同時請求只會有一個取得發送權。
5. LINE Push 設定 10 秒逾時與 `X-Line-Retry-Key`；HTTP 拒絕與網路／逾時未知分開記錄。
6. 建立 LAB 專用 `LabLineNotificationLog`，僅授權 School Admin 可查詢遮罩後資料。
7. 管理員頁面明確標示「LINE API 已接受」不代表家長已讀或實際送達。

## 發送狀態

| 狀態 | 意義 |
| --- | --- |
| `CREATED` | 已建立 LAB 發送紀錄，尚未呼叫 LINE |
| `SENDING` | 即將或正在呼叫 LINE API |
| `ACCEPTED` | LINE API 回傳 2xx；只代表受理 |
| `FAILED` | LINE API 明確回傳非 2xx |
| `UNKNOWN` | 網路逾時、例外或紀錄更新異常，不能判定 LINE 是否受理 |

稽核資料包含內部 Request ID、通知類型、遮罩家長、遮罩 LINE User ID、來源、狀態、LINE HTTP 狀態、錯誤代碼及時間；不保存 Token 或完整 LINE User ID。

## LAB 環境變數（只記名稱，不記值）

- `LAB_ENVIRONMENT`
- `LAB_EXPECTED_STORAGE_ACCOUNT`
- `STORAGE_CONNECTION_STRING`
- `LINE_LOGIN_CHANNEL_ID`
- `LINE_LOGIN_CHANNEL_SECRET`
- `LINE_LOGIN_REDIRECT_URI`
- `LAB_LINE_TEST_PARENT_EMAIL`
- `LAB_LINE_TEST_USER_ID`
- `LAB_LINE_MESSAGING_ACCESS_TOKEN`

## 驗證方式

- 靜態隔離測試：確認按鈕、OAuth、發送 API、稽核 API 與管理員畫面只存在於生成的 LAB Bundle。
- 安全規則測試：非白名單、未綁定、LINE User ID 不符、Token 未設定全部 fail closed。
- 並行測試：同一個全新或已過期的限流 Row 同時提出 12 個請求，只允許 1 個取得發送權。
- 結果測試：2xx＝`ACCEPTED`、非 2xx＝`FAILED`、逾時／網路例外＝`UNKNOWN`。
- CI 與模擬測試不呼叫真實 LINE；真實單人測試仍須另行取得授權，且只能使用指定 Roy 測試帳號。

## 尚未啟用

- 課程異動、加練、缺席、活動、團服、收費與每日摘要等正式業務通知。
- 廣播、群組通知或其他家長通知。
- Production 部署、PR 合併或正式 Webhook 變更。

上述項目必須另行完成通知偏好、去重、重試、退訂、權限與業務驗收後，才可提出上線評估。
