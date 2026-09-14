# 聖心小學弦樂團｜Azure Static Web Apps Pilot

這個專案可以作為「線上自主練習打卡／分部點名／個別課紀錄」的 Azure Pilot。

## 架構

手機瀏覽器  
→ Azure Static Web Apps  
→ Microsoft Entra 登入  
→ Managed Azure Functions API  
→ Azure Table Storage

目前計分規則概念：
- 團別考試：80%
- 自主練習：10%
- 個別課：5%
- 分部團練：5%
- 自主練習單日 ≥ 15 分鐘視為達標

## 專案目錄

- `app/`：手機 Web 前端
- `api/`：Azure Functions Node.js v4 API
- `app/staticwebapp.config.json`：登入與路由保護
- `.github/workflows/`：GitHub Actions 範本
- `APP_SETTINGS.example.json`：Azure App Settings 範例

## Azure 部署步驟

### 1. 建立 GitHub Repository
把此專案全部上傳到一個新的 GitHub Repository，預設 branch 建議 `main`。

### 2. 建立 Azure Storage Account
建立一般用途 Storage Account。取得 Connection string。

不需要事先建立 Table；Pilot API 第一次存取時會嘗試建立：
- `PracticeLog`
- `SectionAttendance`
- `PrivateLesson`

### 3. 建立 Azure Static Web App
Azure Portal → Create resource → Static Web App。

建議：
- Deployment source：GitHub
- Branch：`main`
- App location：`app`
- API location：`api`
- Output location：留空

若由 Azure Portal 綁定 GitHub，Azure 通常會自動產生 GitHub Actions workflow。
若使用本專案內的 workflow，請在 GitHub Repository Secret 建立：

`AZURE_STATIC_WEB_APPS_API_TOKEN`

值為 Azure Static Web Apps 的 Deployment token。

### 4. 設定 Application settings
Azure Static Web App → Settings / Configuration（名稱依 Portal 畫面可能略有差異）

依 `APP_SETTINGS.example.json` 建立設定。

至少需要：
- `STORAGE_CONNECTION_STRING`
- `STUDENT_MAP_JSON`
- `SECTION_TEACHER_MAP_JSON`
- `PRIVATE_TEACHER_MAP_JSON`
- `ADMIN_EMAILS`
- `PRACTICE_QUALIFIED_MINUTES=15`
- `PRACTICE_TARGET_DAYS=30`

### 5. 修改帳號對應
不要直接使用 example.com。

例如家長：
```json
{
  "parent_real_email@domain.com": [
    {
      "studentId": "SH001",
      "name": "林心澄",
      "grade": "三年級",
      "groupName": "A",
      "instrument": "小提琴"
    }
  ]
}
```

### 6. 登入測試
本專案 `staticwebapp.config.json` 會要求所有頁面登入。

未登入使用者會被導向：
`/.auth/login/aad`

登入後由 API 的 `x-ms-client-principal` 判斷 Email，再決定：
- parent
- sectionTeacher
- privateTeacher
- admin

前端不能自行切換身分。

## 重要：校外家長登入

此 Pilot 使用 Azure Static Web Apps 內建 Microsoft Entra 驗證。

若家長不是學校 Microsoft Entra tenant 的帳號，正式版建議使用：
- Microsoft Entra External ID，或
- 自訂 OIDC Provider

Azure Static Web Apps 的 custom authentication 需要 Standard 方案。

## 個資與權限

正式給家長使用前，至少應完成：
1. 個資告知與用途說明。
2. 家長只可查自己孩子。
3. 分部老師只可查自己負責學生。
4. 個別課老師只可寫入自己授課學生。
5. 管理員名單需由學校控管。
6. 保留新增／修改者與時間。
7. 設定資料保留、離團停權及備份規則。

## 下一階段建議

Pilot 驗證後，把 `STUDENT_MAP_JSON` 這種環境變數式對應改成正式資料表：
- Users
- Students
- UserStudentMap
- TeacherStudentMap

並新增：
- 學期考試成績
- 80/10/5/5 自動加權
- A/B 團資格門檻
- Power BI Dashboard
- 每月家長學習月報
- 缺席／長期未打卡提醒
