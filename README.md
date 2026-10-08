# Reviewer Roadtest

Reviewer Roadtest turns a first-time-user path, public API reads, and transaction receipts into a narrowly scoped, machine-readable report. Its first adapter tests [DeliveryOS](https://deliveryos-tau-wheat.vercel.app/) v4 on GenLayer Studionet.

The website is a public report viewer. The runner is a Playwright/Node test that runs locally or in GitHub Actions. The report JSON is the agent-facing API; no API key is needed to read it. A passing report is **not** a full security audit.

A separate GenLayer Intelligent Contract assesses one genuinely subjective question: whether a first-time visitor can understand the product, find a real example without a wallet, and understand why signing is needed for writes. Validators independently fetch the public landing page and compare their categorical judgments. This result is displayed separately from the CI report.

## First-time visitor

1. Open the website and choose **See the DeliveryOS roadtest**.
2. Read the four scoped claims and the checks supporting each one.
3. Open the linked job and transaction evidence. A transaction counts only when it is finalized **and** executed successfully.
4. Open the screenshot to see the browser-runner's first-visit path, and read **What this does not prove** before relying on the report.
5. Press **Refresh live reads** to check three public DeliveryOS endpoints again. This is a browser-side recheck, not a newly published CI report.

## For agents

Fetch /reports/deliveryos.json. Inspect overall, every claims[].status, claims[].check_ids, checks, evidence_model, and not_tested. Treat PASS as applying only to the named claims. Fetch /assessments/deliveryos.json for the separate GenLayer verdict, contract address, and finalized transaction. Both are plain public JSON; /openapi.json and /llms.txt describe them.

An agent running its own tests can install this repository, adapt configs/deliveryos.json and the check adapter in lib/checks.mjs, then run npm run roadtest. The current runner is **DeliveryOS-specific**; adding a target requires defining and reviewing its assertions, not merely changing a URL.

## Reproduce

Requires Node 24 and Playwright Chromium:

~~~sh
npm ci
npx playwright install chromium
npm test
npm run roadtest
npm run serve
~~~

In a second terminal, run node tests/site.mjs. The live runner writes public/reports/deliveryos.json and public/evidence/deliveryos-first-visit.png. The browser test writes desktop/mobile screenshots under ignored test-results/.

GitHub Actions runs the unit tests, browser/HTTP Roadtest, and report viewer check. A dated report is committed even if the live assertions fail or become inconclusive, and the workflow becomes red. The site therefore does not silently preserve a stale green result after a failed scheduled run.

## Evidence boundaries

- The read-only v1 run does **not** sign a new transaction. It checks a previously recorded create-job transaction and a consensus-reviewed example. DeliveryOS describes that earlier transaction as browser-originated, but the receipt alone cannot prove where it was signed.
- DeliveryOS operates the public API. Roadtest records exact response SHA-256 values but the API responses are not independent chain proof.
- The screenshot records what an automated browser observed. It is not a trustless proof of clicks.
- The GenLayer contract judges server-rendered landing-page text, not a full interactive browser session. Its CLEAR verdict is about the explanation, not software correctness.
- A full bilateral lifecycle, wallet compatibility matrix, mobile interactions, and security audit are outside the current claims.
- There is no hosted general-purpose test queue, custodial wallet, payment flow, or GenLayer verdict covering the entire CI report in this first release.

## Project boundary

The public website is static, the CI runner fetches and tests external evidence, and the JSON report remains inspectable. The GenLayer contract is limited to the qualitative first-visit question; it does not put a deterministic CI status on-chain merely to decorate it with a badge. A future consensus verifier for transaction or browser evidence would need independent checks beyond a hash of this runner's report.

## GenLayer contract

Studionet chain 61999 contract: 0x565096782FE263BEFaDC65a0A5796dd2544116bB. The DeliveryOS assessment ID is deliveryos_v4_first_visit. Its [assessment transaction](https://explorer-studio.genlayer.com/tx/0x38d03824869fffcfdf1ede69e6189ed77939e215fd632acac8c7cb73647d3acc) is FINALIZED with MAJORITY_AGREE and successful leader execution; a fresh contract read returned CLEAR. The source is contracts/OnboardingRoadtest.py.

An agent with its own authorized Studionet wallet can request an assessment of a public HTTPS landing-page root:

~~~sh
genlayer network set studionet
genlayer write 0x565096782FE263BEFaDC65a0A5796dd2544116bB assess --args my_unique_review_01 https://example.com/
~~~

Save the returned transaction hash, wait for FINALIZED, check successful execution, then call get_assessment with the chosen ID. Do not put a private key in a website, repository, or chat. Assessments are public and immutable by ID. The caller pays no GEN on Studionet, but the service is rate-limited.

The pinned runner header is the first line of the contract. GenVM lint and a full Studionet consensus integration test passed. Direct-mode tests are included, but the current genlayer-test 0.29.2 runner expects a removed GenVM release asset; CI supplies the renamed official runner archive to exercise them.

MIT licensed.
