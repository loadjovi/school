# Google Gmail 登入版 v2

此版本將家長／老師登入改為 Google Identity Services，不再要求 Azure / Microsoft Entra 帳號。

## 核心流程

Google 登入 → 前端取得 Google ID token → Azure Functions 驗證 token → 依 Gmail 綁定學生／老師／管理員 → Azure Table Storage。

## Azure Static Web App 環境變數

- `GOOGLE_CLIENT_ID`：Google OAuth 2.0 Web Client ID。
- `STUDENT_MAP_JSON`：家長 Gmail 與學生對應。
- `SECTION_TEACHER_MAP_JSON`：分部老師 Gmail 與學生對應。
- `PRIVATE_TEACHER_MAP_JSON`：個別課老師 Gmail 與學生對應。
- `ADMIN_EMAILS`：管理員 Gmail，以逗號分隔。
- 原有 Storage 與計分設定沿用。

## Google Cloud Console

建立 OAuth 2.0 Client ID（Web application），Authorized JavaScript origins 加入：

`https://lively-field-09afddc00.6.azurestaticapps.net`

取得 Client ID 後，填入 Azure Static Web App 的環境變數 `GOOGLE_CLIENT_ID`。

正式自訂網域上線後，也要把自訂網域加入 Authorized JavaScript origins。
