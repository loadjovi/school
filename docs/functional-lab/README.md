# 聖心弦樂成長平台｜真實功能驗證 LAB SOP

版本：2026-10-19（建置準備版；尚未完成 Azure 資源設定及實站驗收）

## 1. 三種環境，禁止混用
- Production：正式家長、老師、學校管理員，正式資料庫。
- LAB35：給幹部練習操作的純前端模擬，不接真正資料庫。
- **Functional UAT LAB**：完整複製 Production 的 app 和 Azure Functions API，登入及資料寫入皆使用獨立 LAB 專屬 Azure Static Web App、Storage Account 和 Google OAuth Web Client。

不要把 Azure Static Web Apps 的 PR Preview 當成隔離環境，也不得將正式 Storage Connection String、真實學生清單或正式部署 Token 放入 LAB。

## 2. Azure 一次性建置
1. 建立專用資源群組（例：rg-sh-orchestra-functional-uat）。
2. 建立獨立 Storage Account，名稱包含 lab / uat / test（例如 sacredlabuat01，依實際可用名稱調整）。
3. 建立另一個 Azure Static Web App（例如 swa-sh-orchestra-functional-uat），不是既有 Production 資源。
4. 在新 SWA → Configuration / Application settings 設定：
   - LAB_ENVIRONMENT = functional-uat
   - LAB_EXPECTED_STORAGE_ACCOUNT = 上一步全新 LAB Storage 的名稱
   - STORAGE_CONNECTION_STRING = 只有 LAB Storage 的連線字串
   - GOOGLE_CLIENT_ID = UAT 專用 Google OAuth Web Client ID
   - ADMIN_EMAILS = 已核准的 LAB 測試管理員 Gmail
   - STUDENT_MAP_JSON = {}
   - SECTION_TEACHER_MAP_JSON = {}
   - PRIVATE_TEACHER_MAP_JSON = {}
   - ACS_EMAIL_CONNECTION_STRING 及 ACS_EMAIL_SENDER = 不設定（建置也強制停用 email.js 發信）
5. 在新 SWA 取得部署 Token；到 GitHub loadjovi/school → Settings → Secrets and variables → Actions 設定：
   - AZURE_STATIC_WEB_APPS_API_TOKEN_SCHOOL_FUNCTIONAL_LAB = 新 SWA 的專用 Token。
6. Google Cloud Console → OAuth 2.0 Web client → Authorized JavaScript origins：新增新 LAB 實際網站的 https origin（不含路徑及結尾 /），把新 Client ID 填入 LAB GOOGLE_CLIENT_ID。
7. 其他設定一律以 LAB 專用值建立；不得直接貼上 Production Secret。

## 3. 從最新正式程式部署
1. GitHub → Actions → School Functional UAT LAB (manual, isolated) → Run workflow。
2. 從 Run workflow 選擇 main 或功能修正分支（fix/sop-*），以所選分支的 app + api 產生真實畫面 SOP LAB。
3. 先驗證專用 LAB token 不等於 Production token；再跑所有 LAB 隔離自動測試。
4. 只向獨立 SWA 部署。LAB API 所有路由在初始化時要求 LAB_ENVIRONMENT 正確、Storage AccountName 等於 LAB 專用名稱，否則 fail-closed。
5. 開啟新 LAB 網址的 /api/lab-readiness，核對 ready=true、environment=functional-uat、storageAccount 為新 LAB Storage 名稱。頁面須顯示「UAT 功能驗證 LAB」標記。
6. 若出現 Google 400 origin_mismatch，優先確認授權的 JavaScript origins 與 LAB 網域完全一致；**不要**用 Production OAuth 設定繞過。
7. GitHub 部署成功只代表程式上傳成功，必須檢查上列 readiness、實際登入、操作寫入都完成後，才宣告 LAB 可用。

## 4. 標準假資料（不要使用真實學生）
使用 LAB 管理員頁面建立：LAB 測試甲（A 團）、LAB 測試乙（B 團）、LAB 測試丙（儲備 C 團），以及測試管理員、老師、家長 Gmail，完成權限綁定。所有人物、事件、帳戶和金額以 UAT 假資料測試。不要從正式站匯入學號、姓名或財務紀錄。

## 5. SOP 驗證清單
| 編號 | 功能 | 家長／老師操作 | 學校後台驗收 |
|---|---|---|---|
| UAT01 | 帳號與綁定 | 家長登入只見自己的 LAB 子女 | 不同角色權限正確 |
| UAT02 | 出勤與請假 | 老師當日點名／家長請假 | 缺席與未完成點名提醒 |
| UAT03 | 自主練習 | 每日上傳、20 分鐘達標 | 月報與歷史紀錄 |
| UAT04 | 團 T | 儲備填尺寸、家長確認實收 | 待學校發放→學校交付→家長完成 |
| UAT05 | A 團比賽服 | 公費／買斷、尺寸與訂單 | 學生與尺寸名單、申請進度及 CSV |
| UAT06 | 活動 | 家長報名／取消或查看 | 報名名單與後台一致 |
| UAT07 | CSV | — | 匯出團 T、比賽服、活動之數量與狀態 |
| UAT08 | 學期與個課 | 老師個課完成、家長評分 | 狀態與分數正確 |
| UAT09 | 待辦事項 | 製造合法的缺席與漏點名情境 | 首頁待辦顯示與消除 |

每次測試保留「操作前→填寫→送出→後台結果→CSV」截圖，檔案命名 UAT04_01_家長填寫尺寸.png 等。SOP 每步必載明角色、路徑、按鈕、輸入、驗收結果及例外處理。

## 6. 資訊安全與交接
- 每次部署先完成 UAT 及回歸，再討論是否正式上線。Production 永不使用 UAT 資料。
- LAB 不寄正式通知、不可使用真實匯款帳戶；資料清除只針對 LAB Storage。
- 交接清單：LAB 網址、Azure Resource Group、獨立 Storage 名稱、Google OAuth Client 名稱、GitHub Actions Workflow、UAT 測試帳號保管方式、SOP Word／PDF、最近驗證結果。
- 不要在 SOP 附上 Access Key、Deployment Token、OAuth Client Secret、Storage connection string。
- 此文件是「準備版」，須在獨立 Azure 資源建好且用假資料實際操作截圖後，更新為「已驗收正式 SOP」。

## 八、SOP LAB：與 Production 共用真實畫面，支援重複產生及截圖

這不是另外畫的 LAB35 模擬界面。執行獨立 UAT Workflow 後，會將選定 GitHub 分支的完整 app 及 API 建置成真正的 SOP LAB；所有 JS、CSS 與原始介面程式碼保持相同。僅在 UAT 建置時增加環境標記（不修改 Production 畫面）。

**入口：** UAT 網站的 /sop-lab/，內含原始頁面捷徑、角色／操作案例、勾選及匯出 JSON 清單，以及 GitHub Commit SHA、原始畫面檔案雜湊。管理員從真實平台首頁操作同一個「團服與活動」路徑，不使用舊版獨立導航畫面代替。

**實際流程**：
1. 從 /sop-lab/ 進入目前驗證的真實家長、老師或學校後台畫面。Google 登入、授權及 API 都仍然運作在 UAT，使用獨立的假學生資料；SOP LAB 不假冒任何帳號。
2. 對照預期功能擷取「操作前 → 輸入 → 送出 → 後台結果 → CSV」畫面，記錄 UAT Commit SHA，勾選 SOP 清單。
3. 如果畫面不符合需求，透過 /sop-lab/「提報畫面差異」建立 Issue：角色、路徑、目前顯示、預期畫面及驗收條件，截圖不得含真實學生資料或登入 Token。
4. 從 main 建立 fix/sop-* 分支，**在共用的 app/ 或 api/ 原始碼直接修正**，而不是修改僅供 SOP 使用的展示頁。
5. GitHub Actions → School Functional UAT LAB (manual, isolated) → Run workflow → **Use workflow from 選修正分支**，先將修正分支部署到獨立 UAT LAB，驗證畫面、權限與資料流程。
6. 截圖確認及回歸測試通過後，再合併 PR 至 main，正式 Production CI/CD 才會跟著更新。
7. 想用最新正式版再次製作 SOP，手動執行 Workflow 選 main 即可。不是每次都要建立新的 UAT Storage/SWA。

**來源版本核對：** /sop-lab/source-manifest.json 保存 source_ref、source_commit 與原始 app/ HTML、JS、CSS SHA-256，供截圖紀錄及追查。各份 SOP 必須標示 GitHub Commit，避免舊截圖被誤認為新版。

**限制與安全：** 正式資料與 UAT 資料完全分離，仍須獨立 Static Web App、Storage Account 及 UAT Google OAuth 設定。Lab 不寄通知信。已建立 rg-sh-orchestra-uat 與 shorchestrauat01，但尚未完成 UAT Static Web App 時，GitHub 程式準備成功不代表網站已開通。SOP 核對勾選只保存在本機瀏覽器，按重設不會刪除實際資料；若需清空 UAT Storage，必須另依安全審核執行。
