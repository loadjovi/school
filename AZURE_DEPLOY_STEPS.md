# Azure Portal 快速操作順序

1. GitHub 建立一個新的 Repository。
2. 將 ZIP 解壓後的「全部內容」放到 Repository root。
3. Azure Portal 建立 Storage Account。
4. 複製 Storage Account Connection string。
5. Azure Portal 建立 Static Web App，連到 GitHub Repository。
6. Build 設定：
   - app_location = app
   - api_location = api
   - output_location = 空白
7. 到 Static Web App 的 Application settings，加入 APP_SETTINGS.example.json 內的設定。
8. 將 example.com 帳號改成實際測試家長／老師帳號。
9. Push 到 main，等待 GitHub Actions 綠色通過。
10. 開啟 Azure Static Web Apps 網址測試登入與打卡。

Pilot 建議先用：
- 1 位家長
- 1 位 A 團學生
- 1 位分部老師
- 1 位個別課老師
- 1 位管理員

測試兩週後再擴大。
