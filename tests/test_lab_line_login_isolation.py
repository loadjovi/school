"""Static safety regression checks for LAB-only LINE Login integration."""
import pathlib
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]

class LabLineLoginIsolationTests(unittest.TestCase):
    def test_oauth_only_in_lab_generator(self):
        oauth=(ROOT/"scripts/lab-line-login-function.js").read_text()
        builder=(ROOT/"scripts/prepare-functional-lab.py").read_text()
        self.assertIn('fn_dir.joinpath("labLineLogin.js")',builder)
        self.assertIn('assertLabIsolation',oauth)
        self.assertIn('process.env.LAB_ENVIRONMENT==="functional-uat"',oauth)
        self.assertIn('route:"line/login/callback"',oauth)
        self.assertIn('route:"line/login/finish"',oauth)
        self.assertIn('bot_prompt:"aggressive"',oauth)
        self.assertIn('code_challenge_method:"S256"',oauth)
        self.assertIn('await consume(row)',oauth)
        self.assertIn('row.parentEmail!==ctx.access.email',oauth)
        self.assertIn('row.schoolId!==ctx.schoolId',oauth)
        self.assertIn('https://api.line.me/friendship/v1/status',oauth)
        self.assertIn('friendStatusTableName="LabLineFriendStatus"',oauth)
        self.assertIn('parentCoverageKey',oauth)
        self.assertIn('await saveFriendStatus',oauth)
        self.assertNotIn('LINE_CHANNEL_ACCESS_TOKEN',oauth)
        self.assertFalse((ROOT/"api/src/functions/labLineLogin.js").exists())
        self.assertIn('lab-line-login',builder)
        self.assertIn('route:"line/lab-send-test"',oauth)
        self.assertIn('LAB_LINE_TEST_PARENT_EMAIL',oauth)
        self.assertIn('LAB_LINE_TEST_USER_ID',oauth)
        self.assertIn('LAB_LINE_MESSAGING_ACCESS_TOKEN',oauth)
        self.assertIn('validateLabRecipient({email,allowedEmail,allowedLineUserId:allowedId,binding',oauth)
        self.assertIn('messages:[{type:"text",text:labSingleTestMessage()}]',oauth)
        self.assertNotIn('message:body.message',oauth)
        self.assertIn('lab-line-test-send',builder)
        self.assertIn('labLineStudentCoverage.js',builder)
        self.assertIn('lab-line-student-coverage.js',builder)

    def test_line_can_authenticate_parent_without_a_binding_code(self):
        oauth=(ROOT/"scripts/lab-line-login-function.js").read_text()
        session=(ROOT/"scripts/lab-line-session.mjs").read_text()
        builder=(ROOT/"scripts/prepare-functional-lab.py").read_text()
        self.assertIn('route:"line/auth/start"',oauth)
        self.assertIn('route:"line/auth/finish"',oauth)
        self.assertIn('route:"line/auth/session"',oauth)
        self.assertIn('route:"line/auth/logout"',oauth)
        self.assertIn('kind:isAuth?"AUTH_TICKET":"TICKET"',oauth)
        self.assertIn('HttpOnly; Secure; SameSite=Lax',session)
        self.assertIn('tableName="LabLineAuthSessions"',session)
        self.assertIn('getLabLineIdentity(request)',builder)
        self.assertIn('lineParentOnly=identity.authProvider==="line"',builder)
        self.assertIn('使用 LINE 登入（家長）',builder)
        production="\n".join(path.read_text() for path in (ROOT/"api/src").rglob("*.js"))
        self.assertNotIn('route:"line/auth/start"',production)
        self.assertFalse((ROOT/"api/src/functions/labLineLogin.js").exists())
        self.assertFalse((ROOT/"api/src/lib/labLineSession.mjs").exists())

    def test_line_student_binding_reuses_exact_gmail_match_and_approval_flow(self):
        registration=(ROOT/"api/src/functions/studentRegistration.js").read_text()
        builder=(ROOT/"scripts/prepare-functional-lab.py").read_text()
        self.assertIn('if(!/^\\d{6}$/.test(studentNo))',registration)
        self.assertIn('if(clean(matched.studentName,40)!==studentName)',registration)
        self.assertIn('status:"pending"',registration)
        self.assertIn('if(access.role!=="admin")',registration)
        self.assertIn('ensureLabLineParentBinding({request,schoolId,parentEmail:access.email})',builder)
        self.assertNotIn('ensureLabLineParentBinding',registration)
        self.assertIn('LINE（${esc(state.me.displayName||"家長")}）',builder)
        self.assertIn('學生綁定申請已送出 ✅',builder)
        self.assertIn('核准前不會開放學生資料',builder)
        self.assertIn('authProvider:e.authProvider||"google"',builder)
        self.assertIn('學號需為 6 碼數字',registration)

    def test_line_parent_login_cannot_gain_teacher_or_admin_contexts(self):
        builder=(ROOT/"scripts/prepare-functional-lab.py").read_text()
        self.assertIn('if(!lineParentOnly&&(globalRole||schoolRoles.length))',builder)
        self.assertIn('const directory=!lineParentOnly&&roleTenantAvailable?',builder)
        self.assertIn('if(a.authProvider==="line")return;',builder)
        self.assertIn('if(a.authProvider!=="line")try{tenantRoles=',builder)
        self.assertIn('if(a.authProvider!=="line")try{await saveUserIdentity(a)}',builder)

    def test_single_recipient_endpoint_never_accepts_browser_target_or_message(self):
        oauth=(ROOT/"scripts/lab-line-login-function.js").read_text()
        send=oauth.split('app.http("labLineSendTestNotification"',1)[1]
        self.assertNotIn("request.json()",send)
        self.assertNotIn("body.to",send)
        self.assertNotIn("body.message",send)
        self.assertIn("validateLabRecipient",send)
        self.assertIn("binding,tokenConfigured:Boolean(token)",send)
        self.assertIn("to:allowedId",send)
        self.assertIn("labSingleTestMessage()",send)
        self.assertIn("AbortSignal.timeout(10000)",send)
        self.assertLess(send.index("validateLabRecipient"),send.index("reserveRollingWindow"))
        self.assertLess(send.index("reserveRollingWindow"),send.index("createNotificationRecord"))
        self.assertLess(send.index("createNotificationRecord"),send.index('fetch("https://api.line.me/v2/bot/message/push"'))

    def test_production_webhook_has_no_lab_sender_or_ledger(self):
        webhook=(ROOT/"api/src/functions/lineWebhook.js").read_text()
        self.assertIn('route:"line/webhook"',webhook)
        self.assertNotIn("line/lab-send-test",webhook)
        self.assertNotIn("line/lab-notification-log",webhook)
        self.assertNotIn("LAB_LINE_TEST_PARENT_EMAIL",webhook)
        self.assertNotIn("LAB_LINE_MESSAGING_ACCESS_TOKEN",webhook)
        self.assertNotIn("LabLineNotificationLog",webhook)

    def test_rolling_limit_is_atomic_and_has_parallel_regressions(self):
        oauth=(ROOT/"scripts/lab-line-login-function.js").read_text()
        safety=(ROOT/"scripts/lab-line-notification-safety.mjs").read_text()
        tests=(ROOT/"tests/lab-line-notification-safety.test.mjs").read_text()
        self.assertIn("reserveRollingWindow",oauth)
        self.assertIn('partitionKey:"LAB_SEND_RATE"',oauth)
        self.assertIn('"Replace",{etag}',oauth)
        self.assertIn("status===409||status===412",safety)
        self.assertIn("parallel first-send requests",tests)
        self.assertIn("parallel expired-slot requests",tests)

    def test_masked_ledger_is_lab_only_and_admin_only(self):
        oauth=(ROOT/"scripts/lab-line-login-function.js").read_text()
        builder=(ROOT/"scripts/prepare-functional-lab.py").read_text()
        ui=(ROOT/"scripts/lab-line-notification-log.js").read_text()
        self.assertIn('notificationTableName="LabLineNotificationLog"',oauth)
        for state in ("CREATED","SENDING","ACCEPTED","FAILED","UNKNOWN"):
            self.assertIn(state,(ROOT/"scripts/lab-line-notification-safety.mjs").read_text())
        self.assertIn('ctx.access.role!=="admin"',oauth)
        self.assertIn('ctx.access.capabilities?.tenantAdmin!==true',oauth)
        self.assertIn("maskEmail(email)",oauth)
        self.assertIn("maskLineUserId(lineUserId)",oauth)
        self.assertNotIn("parentEmail:",oauth.split("async function createNotificationRecord",1)[1].split("async function updateNotificationRecord",1)[0])
        self.assertIn("lab-line-notification-log.js",builder)
        self.assertIn("LINE API 已接受不代表家長已讀或實際送達",ui)
        self.assertFalse((ROOT/"app/lab-line-notification-log.js").exists())
        self.assertFalse((ROOT/"api/src/lib/labLineNotificationSafety.mjs").exists())

    def test_access_token_never_enters_frontend_response_or_log(self):
        oauth=(ROOT/"scripts/lab-line-login-function.js").read_text()
        browser=(ROOT/"scripts/lab-line-notification-log.js").read_text()
        send=oauth.split('app.http("labLineSendTestNotification"',1)[1]
        self.assertNotIn("LAB_LINE_MESSAGING_ACCESS_TOKEN",browser)
        self.assertNotIn("jsonBody:token",send)
        self.assertNotIn("console.log(token",send)
        self.assertNotIn("console.error(token",send)
        self.assertNotIn("e?.message",send)
        self.assertIn('headers:{"Authorization":"Bearer "+token',send)

    def test_line_acceptance_is_not_reported_as_delivery_or_read(self):
        oauth=(ROOT/"scripts/lab-line-login-function.js").read_text()
        self.assertIn("這不代表已讀",oauth)
        self.assertIn("LINE API 回應狀態未知",oauth)
        self.assertIn("LINE API 拒絕發送",oauth)
        self.assertIn("markNotificationUnknown",oauth)

    def test_lab_workflow_runs_new_security_tests(self):
        flow=(ROOT/".github/workflows/school-functional-uat-lab.yml").read_text()
        self.assertIn("test_lab_line_login_isolation.py",flow)
        self.assertIn("lab-line-notification-safety.test.mjs",flow)
        self.assertIn("phase1-fee-integration.test.mjs",flow)
        self.assertIn("lab-line-auth-rules.test.mjs",flow)


if __name__=="__main__":
    unittest.main()
