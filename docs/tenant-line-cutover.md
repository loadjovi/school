# 多校通知框架與聖心 DEMO 驗收

第一階段以聖心弦樂團 DEMO 驗收為準。程式測試使用六個模擬租戶和模擬服務驗證隔離。日後開通其他學校時，才為各校設定正式 LINE 與 Email。

## 逐校設定

LINE 選單依同校既有身分自動決定，不另建 LINE 人員角色：

| 狀態 | 選單 |
|---|---|
| 尚未綁定平台或尚無核准學生 | 沿用官方帳號預設三宮格 |
| 已登入且學生已核准的家長 | 原家長四格；套用 Facebook 新版後五格（保留原四功能並新增活動影音） |
| Global 已指派的同校 School Admin，或同校啟用中的老師 | 幹部／老師六格，優先於家長身分；新版將最後的幹部平台入口改為 Facebook 活動影音 |

LINE 與 Gmail 的一次身分配對仍需本人核對確認；名冊決定權限，選單外觀不授予後台或學生存取權。綁定完成會自動嘗試套用選單；LINE 登入及下一次 LINE 查詢也會依最新名冊更新。若缺少角色版型，只以該官方帳號的選單清單比對完整動作、網址及 schoolId，無歧義時自動沿用；不複製 LAB 連結，也不更改官方帳號預設三宮格。選單失敗與身分綁定分開顯示，無須重新綁定。Global 的版型 ID 調整收在進階設定，供全校共用版型維護使用。

學校 ID 大寫，連字號轉底線，例如 `SACRED_HEART`。各環境的 Azure 設定使用該環境的帳號與憑證。

| 設定前綴 | 逐校設定項 |
|---|---|
| `LINE_<SCHOOL_ID>_` | `CHANNEL_SECRET`、`CHANNEL_ACCESS_TOKEN`、`LOGIN_CHANNEL_ID`、`LOGIN_CHANNEL_SECRET`、`APP_ORIGIN`、`PARENT_RICH_MENU_ID`、`STAFF_RICH_MENU_ID` |
| `LINE_<SCHOOL_ID>_` | `PAYMENT_NOTIFICATIONS_ENABLED=true` 開放 LINE 核帳私訊。LAB 獨立收費專案 DEMO 已移除；日常核帳使用團服與活動原流程。 |
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


## Facebook 活動影音選單

Facebook 已啟用後，網址、圖片預覽與套用按鈕不再顯示於 Global 日常管理頁。既有網址、選單 ID、圖片及自動套用流程保留；需維護版型時，由 Global 透過受權限保護的 `POST /api/line/tenant-config/<schoolId>/menus/apply` 管理 API 處理。家長不需手動同步。

套用流程先驗證兩張隨程式發布的圖片（家長五格、幹部六格），建立或沿用相同版本的 Rich Menu，上傳圖片後才以 ETag 更新同校的兩個選單 ID 及 Facebook 目標。租約避免同校重複提交；失敗只清理本次新增資產，不刪既有版型。官方預設三格不變，也不批次改動任何使用者。既有 LINE 帳號下一次操作或自行同步時依同校名冊套用。

Facebook 按鈕使用固定同校路徑 `/api/line/facebook/<schoolId>?openExternalBrowser=1`，伺服器僅轉到該校已儲存且經驗證的 HTTPS Facebook 網址，不接受來訪者指定目的地。各校互不沿用目標；聖心的建議網址僅屬該校的維護資訊，不是其他學校的預設值。


## 家長不需手動同步

學生核准與 LINE 綁定完成後會自動套用家長選單；兩者先後順序不限。啟用 Facebook 新版的學校使用家長五個入口，尚未完成學生核准者維持預設三格。

管理員修正、移轉或移除家長學生關係後，也會在儲存成功後更新受影響帳號；幹部／老師身分仍優先使用六格。自動更新遇到暫時性失敗會重新讀取同校、同官方帳號的現有身分並重試一次；仍未完成時會保留學生核准及帳號配對，之後一般 LINE 查詢會再次依名冊更新。

家長與未核准帳號的畫面不再顯示手動同步選單；初次 Gmail／LINE 本人配對確認保留，查看狀態仍只有讀取。幹部／老師在其管理身分下保留手動更新入口。

## 老師 Gmail 與 LINE 綁定返回

老師從教學首頁開始綁定，使用後端驗證並保存的 `teacher-account` 固定返回目的地。授權後回到同校教學介面的 LINE 帳號核對畫面，保留身分切換與教學導覽；仍須本人核對 Gmail／LINE 並按確認綁定，不需填寫學生資料。

手機返回新分頁時，僅沿用與已驗證 Gmail 憑證雜湊一致的安全 Cookie，返回時重新檢查同校老師角色。失去 Gmail、授權逾時或取消時，顯示綁定或重新登入提示，不改用舊的未配對 LINE 身分顯示學生註冊。返回提示與本機暫存僅決定畫面，不授予學校、老師或學生權限。
