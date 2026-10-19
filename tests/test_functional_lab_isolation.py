import importlib.util
import hashlib
import json
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

    def test_sop_lab_uses_identical_real_production_javascript_and_css(self):
        for original in (ROOT/"app").rglob("*"):
            if not original.is_file() or original.suffix.lower() not in (".js",".css"):
                continue
            actual=self.lab/"app"/original.relative_to(ROOT/"app")
            self.assertEqual(actual.read_bytes(),original.read_bytes(),
                             "SOP LAB must not repaint the production view: "+str(original))
    def test_sop_lab_source_manifest_is_reproducible(self):
        location=self.lab/"app/sop-lab/source-manifest.json"
        manifest=json.loads(location.read_text(encoding="utf-8"))
        self.assertEqual(manifest["source_repository"],"loadjovi/school")
        self.assertEqual(manifest["purpose"],"sop-lab")
        for name,digest in manifest["source_file_hashes"].items():
            self.assertEqual(hashlib.sha256((ROOT/"app"/name).read_bytes()).hexdigest(),digest)
        for page in ("index.html","parent-uniform-events.html","uniform-event-admin.html"):
            self.assertIn(page,manifest["source_file_hashes"])
    def test_real_screen_shortcuts_never_rebuild_a_fake_school_ui(self):
        hub=(self.lab/"app/sop-lab/index.html").read_text(encoding="utf-8")
        self.assertIn('href="/"',hub)
        self.assertIn('href="/parent-uniform-events.html"',hub)
        self.assertIn('href="/uniform-event-admin.html"',hub)
        self.assertNotIn("localStorage.setItem('google_id_token'",hub)
        self.assertTrue((self.lab/"app/sop-lab/scenarios.json").is_file())
        scenarios=json.loads((self.lab/"app/sop-lab/scenarios.json").read_text(encoding="utf-8"))
        self.assertGreaterEqual(len(scenarios),6)
    def test_manual_workflow_deploys_selected_branch_and_never_production_token(self):
        flow=(ROOT/".github/workflows/school-functional-uat-lab.yml").read_text(encoding="utf-8")
        self.assertIn("github.ref_name",flow)
        self.assertNotIn("ref: main",flow)
        self.assertIn('if [[ "$LAB_TOKEN" == "$PROD_TOKEN" ]]',flow)
        self.assertIn("AZURE_STATIC_WEB_APPS_API_TOKEN_SCHOOL_FUNCTIONAL_LAB",flow)
    def test_sop_fixtures_api_exists_only_in_generated_lab(self):
        api=self.lab/"api/src/functions/sopLabFixtures.js"
        self.assertTrue(api.is_file())
        self.assertFalse((ROOT/"api/src/functions/sopLabFixtures.js").exists())
        src=api.read_text(encoding="utf-8")
        self.assertIn('assertLabIsolation()',src)
        self.assertIn('context.access.role!=="admin"',src)
        self.assertIn('body?.confirmation!=="CREATE_SOP_FIXTURES"',src)
        self.assertIn('await client.createEntity(entry)',src)
        self.assertIn('e.statusCode===409',src)
        self.assertIn('TenantStudentMaster',src)
        self.assertIn('TenantTshirtHistoricalIssue',src)
        self.assertIn('TenantUniformEventRequest',src)
        self.assertIn('TenantUniformEventConfig',src)
        result=subprocess.run(["node","--check",str(api)],capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)

    def test_sop_seed_uses_real_same_tab_authentication_not_cookie_only(self):
        src=(self.lab/"app/sop-lab/sop.js").read_text(encoding="utf-8")
        self.assertIn('sessionStorage.getItem("google_id_token")',src)
        self.assertIn('sessionStorage.getItem("school_context_id")',src)
        self.assertIn('sessionStorage.getItem("role_context")',src)
        self.assertIn('"X-Google-ID-Token":token',src)
        self.assertIn('"X-School-Id":schoolId',src)
        self.assertIn('"X-Role-Context":role',src)
        self.assertIn('fetch("/api/me",{headers',src)
        self.assertIn('if(access.role!=="admin")',src)
        self.assertIn('headers,body:JSON.stringify({confirmation:"CREATE_SOP_FIXTURES"})',src)
        self.assertNotIn('localStorage.setItem("google_id_token"',src)
        self.assertNotIn('location.href+"?token="',src)
        self.assertNotIn('localStorage.setItem("google_id_token"',src)
        banner=(self.lab/"app/functional-lab-banner.js").read_text(encoding="utf-8")
        self.assertIn('link.href="/sop-lab/"',banner)
        self.assertIn('badge.style.pointerEvents="auto"',banner)
        self.assertIn('location.pathname.startsWith("/sop-lab/")',banner)

    def test_tshirt_fixture_uses_operable_canonical_lifecycle_and_safe_repair(self):
        src=(self.lab/"api/src/functions/sopLabFixtures.js").read_text(encoding="utf-8")
        self.assertIn('source:complete?"PARENT_CONFIRMED_FIRST_PUBLIC":"PARENT_SIZE_SURVEY"',src)
        self.assertIn('issuedQuantity:complete?1:0',src)
        self.assertIn('base.schoolIssuedSize=s.size',src)
        self.assertIn('base.schoolIssuedQuantity=1',src)
        self.assertIn('base.schoolHandoffTo="SOP 虛構家長"',src)
        self.assertIn('base.received=true',src)
        self.assertIn('base.receivedAt="2026-10-15T11:00:00.000Z"',src)
        self.assertIn('JSON.stringify(old)!==JSON.stringify(originalShirtFixture(s))',src)
        self.assertIn('updateEntity({...item,updatedAt:new Date().toISOString()},"Replace",{etag:current.etag})',src)
        self.assertIn('if(e.statusCode===412)return "existing"',src)
        self.assertIn('for(const module of ["regularUniform","competitionUniform"])',src)
        self.assertIn('await put(events,config)',src)
        self.assertNotIn('upsertEntity(',src)
        self.assertFalse((ROOT/"api/src/functions/sopLabFixtures.js").exists())
        result=subprocess.run(["node","--check",str(self.lab/"api/src/functions/sopLabFixtures.js")],
                             capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)

    def test_lab_parent_binding_isolated_and_self_only(self):
        api=self.lab/"api/src/functions/sopLabParentBinding.js"
        self.assertTrue(api.is_file())
        self.assertFalse((ROOT/"api/src/functions/sopLabParentBinding.js").exists())
        src=api.read_text(encoding="utf-8")
        for field in [
            'assertLabIsolation()', 'ready.environment!=="functional-uat"',
            'ready.storageAccount!==process.env.LAB_EXPECTED_STORAGE_ACCOUNT',
            'if(ctx.access.role!=="admin")',
            'const schoolId=ctx.schoolId,email=String(ctx.access.email||"").trim().toLowerCase()',
            'tenantParentPartition(schoolId,email)', 'const fixtures=new Map',
            'if(body?.confirmation!=="BIND_MY_LAB_PARENT"||!fixtures.has(studentId))',
            's.updatedBy!=="SOP_LAB_FIXTURE"',
            'parentEmail:email,parentName:"LAB 測試家長"',
            'bindingSource:"sop_lab_fixture_self_binding"',
            'maps.createEntity(link)', 'if(old.status==="active")',
            'changeType:"sop_lab_test_parent_binding"'
        ]:
            self.assertIn(field,src)
        self.assertNotIn('body.parentEmail',src)
        self.assertNotIn('upsertEntity(',src)
        result=subprocess.run(["node","--check",str(api)],capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)

    def test_sop_parent_ui_requires_explicit_choice_and_switches_roles(self):
        js=(self.lab/"app/sop-lab/sop.js").read_text(encoding="utf-8")
        html=(self.lab/"app/sop-lab/index.html").read_text(encoding="utf-8")
        for text in ["lab-parent-student","lab-parent-refresh","lab-parent-bind","lab-parent-switch"]:
            self.assertIn(text,html)
        for text in ['labParentRequest("POST"', '"BIND_MY_LAB_PARENT"',
                     'sessionStorage.setItem("role_context","parent")',
                     'sessionStorage.setItem("school_context_id",schoolId)',
                     'if(!verified?.bound||!verified.available)']:
            self.assertIn(text,js)
        result=subprocess.run(["node","--check",str(self.lab/"app/sop-lab/sop.js")],
                              capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)

    def test_sop_hub_javascript_syntax(self):
        result=subprocess.run(["node","--check",str(self.lab/"app/sop-lab/sop.js")],
                              capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)

if __name__=="__main__":
    unittest.main()
