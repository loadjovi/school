# 付費活動 LINE 排程

活動提前啟用時，系統會儲存通知排程。報名開放前，期末聚餐與其他付費活動的通知都會等候。分階段活動的收款通知也以活動報名起始時間為最早發送時間。派送器只讀取資料庫已到期的通知，不接受呼叫者指定學校、收件者或訊息。

## 正式區

`.github/workflows/paid-activity-production-dispatch.yml` 在 `main` 排程約每五分鐘呼叫正式區，也可由 GitHub Actions 的 Run workflow 手動執行。無須建立新的 Azure 長期密鑰。GitHub 排程可能因服務負載延遲；這是開放時間到後的通知處理，不保證準點或五分鐘內送達。

工作使用 GitHub 的短效 OIDC 身分。API 驗證固定 GitHub 簽章金鑰、正式區 audience、`loadjovi/school` 的不可變儲存庫及擁有者 ID、`main`、指定 workflow 路徑、事件與有效時間。僅允許 GitHub 託管 runner 的 schedule／workflow_dispatch；其他分支、PR、fork、workflow、過期或變造 token 均拒絕。既有與不可變格式的 subject 各有一個明確允許值，無萬用比對。LAB 不接受這條正式區 OIDC 路徑。

每次最多處理四筆到期活動，沿用原有租約與 LINE retry key 去重；有積壓時會在後續輪詢繼續處理。此工作不複製 LAB 資料，也不補發沒有排程紀錄的舊活動。既有尚未開放的活動可於核對內容後重新儲存，以登記後續通知。

上線後確認 GitHub Actions 的「Dispatch scheduled production activity notices」最近執行成功；回覆只記錄 processed／failed 數量，不輸出 token 或家長資料。未來若搬移儲存庫、改名、改主分支、修改 workflow 路徑或正式區網域，需同步審查並更新 API 明確信任條件。

GitHub OIDC 格式與 issuer／JWKS 參考：[GitHub 官方文件](https://docs.github.com/en/actions/reference/security/oidc)、[官方 OpenID 設定](https://token.actions.githubusercontent.com/.well-known/openid-configuration)。

## 既有 Logic App 或 LAB

原有密鑰授權仍可使用。若需要較密集的輪詢，按以下方式設定同環境的 Logic App：

1. 在 Azure Static Web Apps 的目標環境設定 `LINE_PAID_ACTIVITY_SCHEDULER_TOKEN`，使用至少 32 字元的隨機密鑰。各環境使用獨立密鑰。
2. 將 [Azure 部署範本](../deploy/paid-activity-line-scheduler.json) 部署至該環境對應的 Azure 資源群組。將 `applicationOrigin` 設為該環境的 HTTPS 網址，網址結尾省略斜線。以安全參數 `schedulerToken` 傳入同一組密鑰。
3. 檢查 Logic App 的執行歷程。派送端點回覆 200 代表已輪詢，活動通知可能在下一次輪詢才處理。
4. LAB 驗證只能使用獨立測試 LINE 官方帳號與收件者。勿使用正式區 token、帳號或資料。

兩種排程同時執行時仍共用既有租約與去重，無須重建活動或群組綁定。
