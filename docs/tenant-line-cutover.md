# 逐校 LINE 驗收與正式切換

驗收使用 Functional UAT 的 `lineuat` 部署、專用 Storage 與兩個測試 LINE 官方帳號。兩校各自的 Messaging API 與 LINE Login Channel 設在同一 LINE Provider，並在 LINE Login 設定連結該校官方帳號。各環境的 Azure 設定使用該環境的帳號與憑證。

以 `LINE_<SCHOOL_ID>_` 為前綴。學校 ID 大寫，連字號轉底線，例如 `LINE_SACRED_HEART_`。

| 設定 | 用途 |
|---|---|
| `CHANNEL_SECRET`、`CHANNEL_ACCESS_TOKEN` | Messaging API Webhook 驗證與回覆 |
| `LOGIN_CHANNEL_ID`、`LOGIN_CHANNEL_SECRET`、`APP_ORIGIN` | LINE Login 及本環境網站的 HTTPS Origin |
| `PARENT_RICH_MENU_ID`、`STAFF_RICH_MENU_ID` | 同一官方帳號內的個人圖文選單 ID。未綁定選單在該官方帳號設定為預設。 |
| `FEE_COLLECTIONS_ENABLED` | 設為 `true` 開放收費專案 |
| `PAYMENT_NOTIFICATIONS_ENABLED` | 設為 `true` 開放 LINE 核帳私訊 |

LINE Login 回呼為 `<APP_ORIGIN>/api/line/tenant-login/<schoolId>/callback`；Messaging API Webhook 為 `<APP_ORIGIN>/api/line/webhook/<schoolId>`。家長選單的今日課程、最新公告及活動行事曆按鈕使用同名文字訊息動作。開啟平台可連到 `<APP_ORIGIN>/?schoolId=<schoolId>`。

依序將憑證設定到 Azure、在 Global 管理中心的學校設定驗證並啟用、於 LINE Developers 驗證 Webhook，再使用該校測試家長和群組操作。更新任一學校的憑證後，由 Global 管理中心重新驗證該校設定。

## 合併前驗收

1. 同一測試 Gmail 分別與 A、B 校 LINE 登入綁定。兩校各自核准測試學生，核對兩種登入方式可使用同一校帳號。解除 A 校連結後，B 校綁定仍可使用。
2. 在家長的一對一聊天室各點一次「今日課程」「活動行事曆」「最新公告」，核對學校與團別。使用未核准的帳號與群組聊天室確認無學生資訊回覆。
3. 各校分別用待辦及缺席測試群組走綁定與測試通知。完成獨立帳號設定後，僅在驗收環境設定 `LAB_ALLOW_TENANT_LINE_ABSENCE=true`，實際登記測試學生缺席走完整通知。將 A 校簽章送至 B 校 Webhook、把 A 校登入流程送至 B 校回呼，以及解除一校 LINE 設定，確認學校隔離。
4. 用測試團 T 及聚餐專案回報匯款、退回補正、重新回報、核帳；以家長與未指派財務權限的管理員驗證核帳拒絕。重試同一通知並確認只有一筆 LINE 推播。
5. 記錄驗收 commit，核對 PR 與驗收的 SHA 相同。正式聖心沿用原帳號，先檢查 Webhook、群組及出勤，再開啟新登入與通知。第二校可獨立排程。

## 回退

帳務與 LINE 發送分開。通知異常時先關閉該校 `PAYMENT_NOTIFICATIONS_ENABLED`，帳務仍可操作。若其他 LINE 功能影響服務，可從 Global 停用該校 LINE。聖心切換時若驗證為同一官方帳號，舊 Webhook 與既有群組仍可沿用。共用服務異常時，回退到驗收前記錄的正式 commit。
