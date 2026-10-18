import importlib.util
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
PATH=ROOT/"scripts"/"prepare-functional-lab.py"
spec=importlib.util.spec_from_file_location("lab_prepare",PATH)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class FunctionalUATIsolationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workspace=tempfile.TemporaryDirectory(prefix="sh-functional-uat-")
        cls.lab=Path(cls.workspace.name)/"release"
        module.prepare(cls.lab)
    @classmethod
    def tearDownClass(cls):
        cls.workspace.cleanup()
    def test_every_handler_guarded(self):
        for file in (self.lab/"api/src/functions").glob("*.js"):
            body=file.read_text(encoding="utf-8")
            self.assertIn('assertLabIsolation();',body,file.name)
        self.assertTrue((self.lab/"api/src/functions/functionalLabReadiness.js").exists())
    def test_original_main_modules_not_modified(self):
        self.assertNotIn('assertLabIsolation();',(ROOT/"api/src/functions/config.js").read_text())
        self.assertIn('assertLabIsolation();',(self.lab/"api/src/functions/config.js").read_text())
    def test_storage_guard_present(self):
        s=(self.lab/"api/src/lib/storage.js").read_text()
        self.assertIn('assertLabIsolation();return process.env.STORAGE_CONNECTION_STRING',s)
    def test_email_disabled_regardless_of_acs_secret(self):
        s=(self.lab/"api/src/lib/email.js").read_text()
        self.assertIn('connectionString:""',s)
        self.assertNotIn('connectionString:clean(process.env.ACS_EMAIL_CONNECTION_STRING',s)
    def test_all_html_pages_labeled_nonproduction(self):
        count=0
        for file in (self.lab/"app").rglob("*.html"):
            if "</body>" not in file.read_text(encoding="utf-8"):continue
            count+=1
            text=file.read_text(encoding="utf-8")
            self.assertIn("functional-lab-banner.js",text,file.name)
            self.assertIn("noindex,nofollow",text,file.name)
        self.assertGreaterEqual(count,3)
    def test_guard_fails_closed_for_wrong_storage_or_missing_lab_env(self):
        lib=self.lab/"api/src/lib/labIsolation.mjs"
        script='import {assertLabIsolation} from '+repr(lib.as_uri())+';assertLabIsolation();'
        def result(values):
            env={**os.environ,**values}
            return subprocess.run(["node","--input-type=module","-e",script],env=env,capture_output=True,text=True)
        good={"LAB_ENVIRONMENT":"functional-uat","LAB_EXPECTED_STORAGE_ACCOUNT":"sacredlabuat01",
              "GOOGLE_CLIENT_ID":"test-client.apps.googleusercontent.com",
              "STORAGE_CONNECTION_STRING":"DefaultEndpointsProtocol=https;AccountName=sacredlabuat01;AccountKey=DUMMY;EndpointSuffix=core.windows.net"}
        self.assertEqual(result(good).returncode,0)
        self.assertNotEqual(result({**good,"LAB_ENVIRONMENT":"production"}).returncode,0)
        self.assertNotEqual(result({**good,"LAB_EXPECTED_STORAGE_ACCOUNT":"productionstore"}).returncode,0)
        self.assertNotEqual(result({**good,"STORAGE_CONNECTION_STRING":good["STORAGE_CONNECTION_STRING"].replace("sacredlabuat01","prodstore001")}).returncode,0)
        self.assertNotEqual(result({**good,"GOOGLE_CLIENT_ID":""}).returncode,0)
    def test_lab_release_contains_full_production_ui_and_api(self):
        self.assertTrue((self.lab/"app/parent-uniform-events.html").is_file())
        self.assertTrue((self.lab/"app/uniform-event-admin.html").is_file())
        self.assertTrue((self.lab/"api/src/functions/tshirtHistoricalSize.js").is_file())
        self.assertTrue((self.lab/"api/src/functions/uniformEventRequests.js").is_file())

if __name__=="__main__":
    unittest.main()
