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
        self.assertNotIn('LINE_CHANNEL_ACCESS_TOKEN',oauth)
        self.assertFalse((ROOT/"api/src/functions/labLineLogin.js").exists())
        self.assertIn('lab-line-login',builder)
        self.assertIn('route:"line/lab-send-test"',oauth)
        self.assertIn('LAB_LINE_TEST_PARENT_EMAIL',oauth)
        self.assertIn('LAB_LINE_TEST_USER_ID',oauth)
        self.assertIn('LAB_LINE_MESSAGING_ACCESS_TOKEN',oauth)
        self.assertIn('binding.lineUserId!==allowedId',oauth)
        self.assertIn('email!==allowedEmail',oauth)
        self.assertIn('messages:[{type:"text",text:message}]',oauth)
        self.assertNotIn('message:body.message',oauth)
        self.assertIn('lab-line-test-send',builder)


if __name__=="__main__":
    unittest.main()
