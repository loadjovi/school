"""Install data reset/recovery and private-lesson examples ONLY in a LAB build."""
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATES = ROOT / "scripts" / "functional-lab"


def install(api_root: Path, lab_app: Path):
    lib = api_root / "src" / "lib"
    for name in ("lab-data-engine.mjs", "lab-data-tools.mjs", "lab-private-fixtures.mjs"):
        shutil.copyfile(TEMPLATES / name, lib / name)
    source = (ROOT / "api/src/lib/storage.js").read_text(encoding="utf-8").split("const names={", 1)[1].split("};", 1)[0]
    definitions = []
    protected = {"tenantDirectory", "tenantUserRole", "tenantMigration"}
    labels = {
        "tenantPractice": "自主練習紀錄", "tenantSection": "分部課點名", "tenantEnsemble": "合奏課點名",
        "tenantComprehensive": "團體活動點名", "tenantPrivateLesson": "個課紀錄與家長回覆",
        "tenantRegistrations": "學生與家長申請", "tenantStudentMaster": "學生主檔", "tenantUserStudentMap": "家長綁定",
        "tenantStudentHistory": "學生異動紀錄", "tenantSemesterEnrollment": "學期名單", "tenantAcademicYearBatch": "學年度匯入批次",
        "tenantTeacherDirectory": "老師帳號", "tenantTeacherProfile": "老師權限及學生綁定", "tenantTeacherSupport": "短期支援老師",
        "tenantSectionMerge": "分部併班", "tenantSchedule": "固定課表", "tenantScheduleException": "停課與復課",
        "tenantScheduleState": "課表啟用狀態", "tenantCalendarEvent": "加練比賽演出與其他活動",
        "tenantTrainingAttendance": "加練點名", "tenantPracticeFeedback": "練習回饋", "tenantPracticeMonthlyEvaluation": "自主練習月評量",
        "tenantLearningMonthlyEvaluation": "學習表現月評量",
    }
    for key, env, default in re.findall(r'(\w+):process\.env\.(\w+)\|\|"([^"]+)"', source):
        if key.startswith("tenant") and key not in protected:
            definitions.append({"env": env, "default": default, "label": labels.get(key, default)})
    for env, name, label in [
        ("UNIFORM_EVENT_CONFIG_TABLE", "TenantUniformEventConfig", "團服與活動設定"),
        ("TENANT_ATTENDANCE_FOLLOWUP_TABLE", "TenantAttendanceFollowup", "缺席行政追蹤"),
        ("", "TenantTshirtHistoricalIssue", "團 T 首次領用"),
        ("", "TenantTshirtParentLoans", "幹部志工領用與借還"),
        ("", "TenantTshirtStaffDemand", "幹部志工加購需求"),
        ("", "TenantUniformEventRequest", "團服申請與核帳"),
        ("", "TenantUniformInventory", "團服庫存與收發紀錄"),
        ("", "TenantCompetitionUniformMaster", "比賽服學生設定"),
        ("", "TenantUniformPrices", "團服價格"),
        ("", "TenantFamilyEventRegistration", "活動報名與核帳"),
        ("", "TenantUniformPaymentAccounts", "團服收款設定"),
        ("", "TenantEventPaymentAccounts", "活動收款設定"),
        ("", "TenantPaymentAccountTemplates", "收款帳戶範本"),
    ]:
        definitions.append({"env": env, "default": name, "label": label})
    catalog = "const definitions=" + json.dumps(definitions, ensure_ascii=False) + ";\n"
    catalog += '''export function labDataTables(){
 const protectedNames=new Set(["TenantFinanceAssignment","TenantUniformEventAudit","SopLabDataOperations",
 process.env.TENANT_DIRECTORY_TABLE||"TenantDirectory",process.env.TENANT_USER_ROLE_TABLE||"TenantUserRole",
 process.env.TENANT_MIGRATION_TABLE||"TenantMigration",process.env.SYSTEM_SETTINGS_TABLE||"SystemSettings",
 process.env.USER_IDENTITY_TABLE||"UserIdentity",process.env.GLOBAL_AUDIT_LOG_TABLE||"GlobalAuditLog",
 process.env.SCHOOL_ACCESS_LOG_TABLE||"SchoolAccessLog"]);
 const result=new Map();
 for(const item of definitions){const name=(item.env&&process.env[item.env])||item.default;
  if(protectedNames.has(name))throw Error("LAB 清空資料表設定與保留設定衝突");
  result.set(name,{name,label:item.label});
 }
 return [...result.values()];
}
'''
    (lib / "lab-data-tables.mjs").write_text(catalog, encoding="utf-8")
    shutil.copyfile(TEMPLATES / "lab-data-ui.js", lab_app / "sop-lab/data-tools.js")
