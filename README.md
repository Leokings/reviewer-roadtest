# Reviewer Roadtest

Reviewer Roadtest turns a first-time-user path, public API reads, and transaction receipts into a narrowly scoped, machine-readable report. Its first adapter tests [DeliveryOS](https://deliveryos-tau-wheat.vercel.app/) v4 on GenLayer Studionet.

The website is a public report viewer. The runner is a Playwright/Node test that runs locally or in GitHub Actions. The report JSON is the agent-facing API; no API key is needed to read it. A passing report is **not** a full security audit.

## First-time visitor

1. Open the website and choose **See the DeliveryOS roadtest**.
2. Read the four scoped claims and the checks supporting each one.
3. Open the linked job and transaction evidence. A transaction counts only when it is finalized **and** executed successfully.
4. Open the screenshot to see the browser-runner's first-visit path, and read **What this does not prove** before relying on the report.
5. Press **Refresh live reads** to check three public DeliveryOS endpoints again. This is a browser-side recheck, not a newly published CI report.

## For agents

Fetch /reports/deliveryos.json. Inspect overall, every claims[].status, claims[].check_ids, checks, evidence_model, and not_tested. Treat PASS as applying only to the named claims. The report is plain public JSON; /openapi.json and /llms.txt describe its use.

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

- The read-only v1 run does **not** sign a new transaction. It checks a previously recorded browser-originated transaction and a consensus-reviewed example.
- DeliveryOS operates the public API. Roadtest records exact response SHA-256 values but the API responses are not independent chain proof.
- The screenshot records what an automated browser observed. It is not a trustless proof of clicks.
- A full bilateral lifecycle, wallet compatibility matrix, mobile interactions, and security audit are outside the current claims.
- There is no hosted general-purpose test queue, custodial wallet, payment flow, or on-chain Roadtest verdict in this first release.

## Project boundary

The public website is static, the CI runner fetches and tests external evidence, and the JSON report remains inspectable. This first release intentionally does not put a deterministic CI status on GenLayer merely to decorate it with an on-chain badge. A future GenLayer contract would need validators to independently verify the underlying evidence and judge a genuinely subjective claim; a hash of this runner's report alone would not do that.

MIT licensed.
