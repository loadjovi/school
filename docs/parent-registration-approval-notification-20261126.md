# 家長加入申請核准通知

核准學生家長關係後，使用既有、可去重的 LINE 核准通知卡。LINE 申請與 LINE 核准卡的結果不再被後續 Email 備援結果取代。

## 通知管道

- 新申請從伺服器已驗證的 `access.authProvider` 保存 `applicationAuthProvider`，不接受申請表單指定登入來源。
- LINE 申請、歷史 LINE 原生帳號，以及已經進入有效 LINE 核准通知流程的 Gmail 家長，回傳並保存 LINE 的實際結果，不再呼叫 Email 備援。
- 原 Gmail 家長沒有可用 LINE 綁定時，保留既有 Email 通知流程。
- 管道選擇不會建立 LINE 綁定或好友關係，不會略過現行的同校官方帳號、正式家長身分、核准學生關係與好友證據檢查。

## 畫面結果

| LINE 結果 | 管理員看到的提示 |
| --- | --- |
| accepted | 已核准並綁定；LINE 已受理，收件待確認 |
| pending_friend | 已核准並綁定；LINE 通知待確認本校官方帳號好友後補送 |
| pending / unconfirmed | 已核准並綁定；LINE 通知結果待確認 |
| not_bound / not_configured / failed | 保留核准成功，另顯示實際 LINE 綁定、設定或發送問題 |

`notification.channel` 與實際狀態會一併保存，重讀申請紀錄仍可辨識當次處理管道。API 受理不代表家長已收到或閱讀。LINE 好友補送仍由原有簽章驗證 webhook／OAuth 好友證據觸發，沿用核准證明、去重與重新檢查權限的機制。

核准寫入失敗、申請待審、退回或單純讀取申請，都不觸發核准通知。回歸測試使用隔離資料與模擬發送，沒有重送既有家長通知或修改正式學生與家長資料。

## 驗證

- 完整 Node 回歸測試：1,314 項通過。
- Functional LAB 隔離與來源一致性測試：24 項通過。
- 核准通知、LINE 核准證明、選單同步與前端結果顯示均有回歸案例；變更 JavaScript 語法檢查及 `git diff --check` 通過。
