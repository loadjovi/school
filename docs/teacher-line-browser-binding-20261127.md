# 老師 Gmail 與 LINE 綁定返回修正

## 問題

老師已使用 Gmail 進入教學首頁，但啟動 LINE 綁定後，返回頁可能顯示 `TCH-HTTP-401`。此檢查碼表示還原老師畫面的 `/api/me` 沒有取得可驗證的 Gmail 登入，不代表老師已被停用，也不能據此判定 LINE 帳號已完成配對。

來源程式的 Google 發起綁定需要在返回後讀取同一個 Gmail Cookie。手機自動啟動 LINE App 的往返會增加瀏覽器／分頁切換的變因；Google 憑證過期或 Cookie 無法讀取也會產生同一結果。未取得該手機的網路紀錄，無法斷定本次屬於哪一種原因。

若使用者改按一般「使用 LINE 登入」，尚未完成正式配對的 LINE 仍會顯示未綁定與身分選擇頁；這不是完成 Gmail 配對的替代方式。

## 調整

- 老師透過 Gmail 發起的綁定及好友重查，改用 LINE 官方支援的 `disable_auto_login=true`，以瀏覽器登入／授權流程減少自動切換 LINE App。一般 LINE 登入及其他身分沿用原流程。
- 離開老師平台前，先明確使用 Gmail Cookie 查詢 `/api/me`，核對同校、老師角色、Google 身分及 Gmail 都與目前登入者相同。
- 檢查失敗留在原老師畫面提供重試說明，不先離開平台，不改用其他 LINE 登入，也不清除現有帳號配對。
- 首頁與嵌入式「我的 LINE 綁定」皆適用；過期回應或途中切換身分不能啟動舊的授權。
- 返回後仍須核對 Gmail 與 LINE 名稱，按「確認綁定」；OAuth Cookie、state、PKCE、nonce 與目前老師名冊檢查照常執行。

官方行為依據：

- [LINE Login：自動登入失敗的處理](https://developers.line.biz/en/docs/line-login/how-to-handle-auto-login-failure/)
- [LINE Login：網頁整合與授權參數](https://developers.line.biz/en/docs/line-login/integrate-line-login/)

驗證使用隔離帳號與模擬 OAuth，未代替真人老師登入、綁定或發送通知。實際手機仍需由老師以原 Gmail 重試並確認配對。

## 驗證結果

- 全套 Node 功能測試：1,438／1,438 通過。
- Functional LAB Python 隔離測試：24／24 通過。
- 獨立審查：新增與相關前後端測試 67／67，登入與返回回歸 29／29 通過。
- 涵蓋 Cookie 缺失／過期、不同 Gmail／Google 身分、跨校、停用角色、網路及格式錯誤、途中切換身分、延遲 JSON 回應，以及一般 LINE 登入與其他身分流程不受影響。
- 異動 JavaScript 語法與 `git diff --check` 通過。
