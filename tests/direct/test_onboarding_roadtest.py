import sys
from pathlib import Path

import pytest


CONTRACT_PATH = Path(__file__).resolve().parents[2] / "contracts" / "OnboardingRoadtest.py"
pytestmark = pytest.mark.skipif(
    sys.platform == "win32",
    reason="genlayer-test direct loader cannot unlink its open stdin temp file on Windows; Linux CI runs these cases",
)


def test_invalid_inputs_fail_before_any_web_call(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(str(CONTRACT_PATH))
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("Assessment id must be"):
        contract.assess("a", "https://deliveryos-tau-wheat.vercel.app/")
    for url in (
        "http://deliveryos-tau-wheat.vercel.app/",
        "https://localhost/",
        "https://127.0.0.1/",
        "https://deliveryos-tau-wheat.vercel.app/path",
        "https://example.com@evil.test/",
        "https://example.com:443/",
    ):
        with direct_vm.expect_revert():
            contract.assess("valid_id", url)
    assert contract.get_count() == 0


def test_unknown_assessment_is_not_fabricated(direct_vm, direct_deploy):
    contract = direct_deploy(str(CONTRACT_PATH))
    assert contract.get_count() == 0
    with direct_vm.expect_revert("Unknown assessment id"):
        contract.get_assessment("missing_id")
    with direct_vm.expect_revert("Index out of range"):
        contract.get_id(0)
