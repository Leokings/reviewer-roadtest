from gltest import get_contract_factory
from gltest.assertions import tx_execution_succeeded


def test_real_studionet_consensus_and_state():
    factory = get_contract_factory("OnboardingRoadtest")
    contract = factory.deploy(args=[])
    receipt = contract.assess(
        args=["deliveryos_v4_first_visit", "https://deliveryos-tau-wheat.vercel.app/"]
    ).transact()
    assert tx_execution_succeeded(receipt)
    assessment = contract.get_assessment(args=["deliveryos_v4_first_visit"]).call()
    assert assessment["id"] == "deliveryos_v4_first_visit"
    assert assessment["landing_url"] == "https://deliveryos-tau-wheat.vercel.app/"
    assert assessment["verdict"] in ("CLEAR", "PARTIAL", "UNCLEAR")
    assert assessment["scope"] == "Public first-visit explanation only"
    assert contract.get_count(args=[]).call() == 1
    print("Studionet contract:", contract.address)
    print("Assessment:", assessment)
