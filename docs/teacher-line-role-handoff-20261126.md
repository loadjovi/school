# 老師 Gmail 與 LINE 綁定返回流程

老師從 Gmail 登入後綁定 LINE，不應被切換成未配對的 LINE 身分，也不應進入家長的學生申請表。

## 原因與修正

- API 原本優先讀取 Google cookie，可能忽略畫面剛取得的 Google ID token；若舊 cookie 失效，還可能改用另一個既存 LINE session。現在明確提供的 Google 憑證優先，驗證失敗回到登入流程，不會換成另一個登入身分。`cookie-session` 與 `line-session` 仍各自指定登入方式。
- 手機 Google redirect 登入只返回首頁，新的分頁或瀏覽器沒有原 sessionStorage 時會遺失老師綁定畫面的返回資訊。現在 Google 按鈕以固定的 `teacher-account:<schoolId>` 或 `parent-account:<schoolId>` state 保留畫面目的地，POST handler 只接受這兩種校別格式並產生同來源路徑。
- 此 state 只控制返回畫面，不代表老師或家長權限。返回老師綁定前，仍檢查實際 Google 身分、同校範圍與有效老師名冊。
- 尚未配對 Gmail 的 LINE 帳號先選擇既有老師帳號或家長申請；選老師時使用原 Gmail 恢復老師綁定流程，只有明確選擇家長申請才顯示學生表單。
- 老師綁定仍使用 `mode: link` 與 `returnTo: teacher-account`，既有帳號配對確認、學校隔離與名冊權限不變。
- Gmail／學校身分切換後，較舊的返回請求與 LINE 授權啟動結果會取消，不會覆蓋新登入的身分、頁面或導向。正常失敗仍顯示原本的重試訊息。

## 驗證範圍

以實際來源程式的行為測試覆蓋新老師憑證與失效／不同帳號 cookie 並存、明確 Google 憑證失效時拒絕切換 LINE、LINE 指定登入、匿名自動偵測、停用與跨校老師名冊，以及手機 redirect 返回的固定 state。測試亦保留原 Google CSRF、token 驗證、親子關係及 LINE 配對驗證。

實機驗證：老師重新整理平台，使用老師名冊中的原 Gmail 登入，進入老師 LINE 通知的「綁定我的 LINE 帳號」，授權後核對 Gmail 與 LINE 並確認綁定。若由 LINE 未配對帳號進入，先選「我是老師，使用原 Gmail 繼續」。不需要填寫學生姓名或學號。

沒有更動正式學生、家長或老師資料，也沒有使用真人帳號發送測試通知。

發布前檢查：Node 功能測試 1,177／1,177 通過；LAB 隔離測試 24／24 通過；異動 JavaScript 語法與 `git diff --check` 通過。
