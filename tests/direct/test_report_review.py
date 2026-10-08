import sys
import hashlib
import json
from pathlib import Path

import pytest


CONTRACT_PATH = Path(__file__).resolve().parents[2] / "contracts" / "ReportReview.py"
HOST = "roadtest-store.public.blob.vercel-storage.com"
pytestmark = pytest.mark.skipif(
    sys.platform == "win32",
    reason="genlayer-test direct loader cannot unlink its open stdin temp file on Windows; Linux CI runs these cases",
)


def test_invalid_review_inputs_revert_before_web_fetch(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(str(CONTRACT_PATH), HOST)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("Review id must"):
        contract.review("x", f"https://{HOST}/reports/a.json", "a" * 64)
    with direct_vm.expect_revert("Use a public HTTPS URL"):
        contract.review("valid_id", "https://localhost/reports/a.json", "a" * 64)
    with direct_vm.expect_revert("published Roadtest"):
        contract.review("valid_id", f"https://{HOST}/reports/a.json", "wrong")
    assert contract.get_count() == 0


def test_unknown_review_is_not_fabricated(direct_deploy):
    contract = direct_deploy(str(CONTRACT_PATH), HOST)
    assert contract.get_count() == 0
    with pytest.raises(Exception, match="Unknown review id"):
        contract.get_review("missing_review")


def test_constructor_pins_public_blob_host(direct_vm, direct_deploy):
    with direct_vm.expect_revert("public Roadtest Blob host"):
        direct_deploy(str(CONTRACT_PATH), "example.org")


def test_review_rechecks_actual_assertions_and_stores_a_scoped_result(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(str(CONTRACT_PATH), HOST)
    direct_vm.sender = direct_alice
    site = "https://example.org/"
    screenshot = b"runner-screenshot-bytes"
    response = b'{"ok":true}'
    plan = {
        "site": site,
        "http_checks": [{"id": "api", "title": "API status", "path": "/status", "format": "json",
                         "assertions": [{"field": "ok", "equals": True}]}],
        "browser_checks": [{"id": "heading", "title": "Homepage visible", "type": "visible",
                            "role": "heading", "name": "Welcome"}],
        "claims": [{"id": "narrow", "text": "The public status endpoint returned ok and the runner saw Welcome.",
                    "checks": ["api", "heading"]}]
    }
    report = {
        "protocol": "ROADTEST_REPORT_V1", "project": {"site": site}, "plan": plan,
        "scope": "Only a public response and a runner observation", "not_tested": ["Wallet writes"],
        "checks": [
            {"id": "api", "title": "API status", "kind": "live-api", "result": "PASS",
             "evidence_url": site + "status", "response_sha256": hashlib.sha256(response).hexdigest()},
            {"id": "heading", "title": "Homepage visible", "kind": "browser-runner", "result": "PASS"}
        ],
        "claims": [{"id": "narrow", "text": plan["claims"][0]["text"], "check_ids": ["api", "heading"], "status": "PASS"}],
        "overall": "PASS", "screenshot": f"https://{HOST}/evidence/check.jpg",
        "screenshot_sha256": hashlib.sha256(screenshot).hexdigest()
    }
    report_body = json.dumps(report).encode()
    direct_vm.mock_web(r".*reports/check.json", {"status": 200, "body": report_body})
    direct_vm.mock_web(r".*example.org/status", {"status": 200, "body": response})
    direct_vm.mock_web(r".*evidence/check.jpg", {"status": 200, "body": screenshot})
    direct_vm.mock_llm(r".*UNTRUSTED_REPORT_EVIDENCE.*", json.dumps({"verdict": "SCOPED"}))
    contract.review("sample_review", f"https://{HOST}/reports/check.json", hashlib.sha256(report_body).hexdigest())
    stored = contract.get_review("sample_review")
    assert stored["verdict"] == "SCOPED"
    assert stored["http_rechecked"] == 1
    assert stored["browser_checks"] == 1
    assert stored["browser_proof"] == "RUNNER_ONLY"
    assert contract.get_count() == 1
