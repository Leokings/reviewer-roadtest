import time

from gltest import get_contract_factory
from gltest.assertions import tx_execution_succeeded
from gltest.types import TransactionStatus, TransactionHashVariant
from gltest.utils import extract_contract_address
from gltest.clients import get_gl_client


def _finalized_receipt(initial):
    """Resume by hash after RPC disconnects; never send the write again."""
    tx_hash = initial.get("hash") or initial.get("tx_id")
    assert tx_hash and tx_hash.startswith("0x")
    client = get_gl_client()
    last_error = None
    for _ in range(60):
        try:
            current = client.get_transaction(transaction_hash=tx_hash)
            if current.get("status_name") == "FINALIZED":
                return current
            if current.get("status_name") == "CANCELED":
                raise AssertionError("Transaction was canceled: " + tx_hash)
        except AssertionError:
            raise
        except Exception as error:
            last_error = error
        time.sleep(3)
    raise AssertionError("Transaction did not reach FINALIZED: " + tx_hash) from last_error


def test_real_studionet_consensus_and_state():
    factory = get_contract_factory("OnboardingRoadtest")
    deploy_receipt = _finalized_receipt(factory.deploy_contract_tx(
        args=[], wait_transaction_status=TransactionStatus.ACCEPTED
    ))
    assert tx_execution_succeeded(deploy_receipt)
    contract = factory.build_contract(extract_contract_address(deploy_receipt))
    receipt = _finalized_receipt(contract.assess(
        args=["deliveryos_v4_first_visit", "https://deliveryos-tau-wheat.vercel.app/"]
    ).transact(wait_transaction_status=TransactionStatus.ACCEPTED))
    assert tx_execution_succeeded(receipt)
    assessment = contract.get_assessment(
        args=["deliveryos_v4_first_visit"]
    ).call(transaction_hash_variant=TransactionHashVariant.LATEST_FINAL)
    assert assessment["id"] == "deliveryos_v4_first_visit"
    assert assessment["landing_url"] == "https://deliveryos-tau-wheat.vercel.app/"
    assert assessment["verdict"] in ("CLEAR", "PARTIAL", "UNCLEAR")
    assert assessment["scope"] == "Public first-visit explanation only"
    assert contract.get_count(args=[]).call() == 1
    print("Studionet contract:", contract.address)
    print("Deployment receipt:", {key: deploy_receipt.get(key) for key in (
        "hash", "transaction_hash", "status", "status_name", "result_name"
    )})
    print("Assessment receipt:", {key: receipt.get(key) for key in (
        "hash", "transaction_hash", "status", "status_name", "result_name"
    )})
    print("Assessment:", assessment)
