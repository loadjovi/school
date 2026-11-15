# 多校通知框架與聖心 DEMO 驗收

第一階段以聖心弦樂團 DEMO 驗收為準。程式測試使用六個模擬租戶和模擬服務驗證隔離。日後開通其他學校時，才為各校設定正式 LINE 與 Email。

## 逐校設定

學校 ID 大寫，連字號轉底線，例如 `SACRED_HEART`。各環境的 Azure 設定使用該環境的帳號與憑證。

| 設定前綴 | 逐校設定項 |
|---|---|
| `LINE_<SCHOOL_ID>_` | `CHANNEL_SECRET`、`CHANNEL_ACCESS_TOKEN`、`LOGIN_CHANNEL_ID`、`LOGIN_CHANNEL_SECRET`、`APP_ORIGIN`、`PARENT_RICH_MENU_ID`、`STAFF_RICH_MENU_ID` |
| `LINE_<SCHOOL_ID>_` | `FEE_COLLECTIONS_ENABLED=true` 開放收費專案。`PAYMENT_NOTIFICATIONS_ENABLED=true` 開放 LINE 核帳私訊。 |
| `ACS_EMAIL_<SCHOOL_ID>_` | `CONNECTION_STRING`、`SENDER` 選擇寄件服務與地址。`APP_URL` 可指定學校登入入口。`ENABLED=false` 停用此校對外郵件。 |

- 每校使用自己的 LINE 官方帳號。同一校的 Messaging API 與 LINE Login Channel 放在同一個 LINE Provider，並在 LINE Login 連結該校官方帳號。
- LINE Login 回呼使用 `<APP_ORIGIN>/api/line/tenant-login/<schoolId>/callback`。Messaging API Webhook 使用 `<APP_ORIGIN>/api/line/webhook/<schoolId>`。家長選單的今日課程、最新公告及活動行事曆按鈕使用同名文字訊息動作。平台入口可連到 `<APP_ORIGIN>/?schoolId=<schoolId>`。
- 新校在 Azure 設定後，由 Global 管理中心逐校預覽狀態及驗證啟用 LINE。Email 可由平台代管，但每校需明確配置寄件設定。若只填入部分 Email 設定，該校會停止寄送直到配對完整。
- 聖心以原有 LINE 群組與寄件設定相容既有流程。新校未設定的通道不會套用聖心帳號或郵件服務。兩種通知各自啟停。
- 收件人與帳務資料取自所屬學校。若家長先以 LINE 建立資料、後來連結 Gmail，Email 會送到該校驗證過的 Gmail。解除 LINE 連結也可保留 Gmail 登入及 Email 收件設定。

## 聖心 DEMO 驗收

1. 使用 `lineuat` 的獨立 LAB Storage。以既有聖心 DEMO 資料驗證家長登入、學生核准、LINE／Gmail 綁定、群組和圖文選單流程。辦理實際 LINE 驗收時只用獨立測試 LINE 官方帳號與測試收件人。
2. 以團 T、期末聚餐測試單核對匯款回報、補正、核帳與通知重試。個別課、家長核准、老師開通、團服及缺席郵件在自動測試中檢查寄件設定和內容，LAB 實站保留郵件抑制。
3. 確認聖心相容路徑與回退方式後，記錄驗收 SHA。其他學校需要啟用時，再按校執行 LINE Login、群組、選單、Email 和切回原設定的驗收。

## 回退

LINE 首先依校停用有問題的功能或停用該校 LINE。Email 可透過該校 `ENABLED=false` 停用。聖心沿用同一官方帳號時，舊 Webhook 和既有群組可繼續使用。共用服務異常時，可回退到切換前的正式 commit。
