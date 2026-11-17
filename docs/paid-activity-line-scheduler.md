# 付費活動 LINE 排程

活動提前啟用時，系統會儲存通知排程。報名開放前，期末聚餐與其他付費活動的通知都會等候。分階段活動的收款通知也以活動報名起始時間為最早發送時間。到期後由同環境的 Logic App 呼叫派送 API。

1. 在 Azure Static Web Apps 的目標環境設定 `LINE_PAID_ACTIVITY_SCHEDULER_TOKEN`，使用至少 32 字元的隨機密鑰。各環境使用獨立密鑰。
2. 將 [Azure 部署範本](../deploy/paid-activity-line-scheduler.json) 部署至該環境對應的 Azure 資源群組。將 `applicationOrigin` 設為該環境的 HTTPS 網址，網址結尾省略斜線。以安全參數 `schedulerToken` 傳入同一組密鑰。
3. 檢查 Logic App 的執行歷程。派送端點回覆 200 時代表已輪詢，活動通知可能在下一次每分鐘輪詢才被處理。
4. 既有活動若已啟用、且報名時間尚未到，再儲存一次可登記此活動的 LINE 排程。使用新的 LAB 測試活動，分別在開放前及開放後確認家長 LINE 收件。
