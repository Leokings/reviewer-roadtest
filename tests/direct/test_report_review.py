import sys
from pathlib import Path

import pytest


CONTRACT_PATH = Path(__file__).resolve().parents[2] / "contracts" / "ReportReview.py"
HOST = "roadtest-store.public.blob.vercel-storage.com"
pytestmark = pytest.mark.skipif(
    sys.platform == "win32",
    reason="genlayer-test direct loader cannot unlink its open stdin temp file on Windows; Linux CI runs these cases",
)


def test_invalid_review_inputs_revert_before_web_fetch(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(str(CONTRACT_PATH), args=[HOST])
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("Review id must"):
        contract.review("x", f"https://{HOST}/reports/a.json", "a" * 64)
    with direct_vm.expect_revert("published Roadtest"):
        contract.review("valid_id", "https://localhost/reports/a.json", "a" * 64)
    with direct_vm.expect_revert("published Roadtest"):
        contract.review("valid_id", f"https://{HOST}/reports/a.json", "wrong")
    assert contract.get_count() == 0


def test_unknown_review_is_not_fabricated(direct_deploy):
    contract = direct_deploy(str(CONTRACT_PATH), args=[HOST])
    assert contract.get_count() == 0
    with pytest.raises(Exception, match="Unknown review id"):
        contract.get_review("missing_review")


def test_constructor_pins_public_blob_host(direct_vm, direct_deploy):
    with direct_vm.expect_revert("public Roadtest Blob host"):
        direct_deploy(str(CONTRACT_PATH), args=["example.org"])
