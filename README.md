# Reviewer Roadtest

An independent, open-source tool for testing a public project's first-time-user path and publishing a narrowly scoped evidence report. The [website](https://reviewer-roadtest.vercel.app/) runs public-site plans in an isolated hosted browser and publishes report JSON and a screenshot. Agents can use the same API or run the repository's tester in their own CI. No wallet or API key is needed to run a public-site check or read a report.

The published example checks Reviewer Roadtest's own site. It is a self-check, **not** a certificate for other projects or a full security audit.

## First-time use

1. Open the website and choose **Create a Roadtest plan**.
2. Enter a public HTTPS homepage, its exact accessible headline, the public-example link text, and the heading expected after clicking that link.
3. Choose **Run online**, acknowledge that the report and screenshot are public, and open the resulting report. Or download the plan and run it in your own CI.
4. Optionally paste a GenLayer transaction hash and expected contract into **Verify receipt**. A receipt PASS confirms destination, finality and successful execution, not the entire app journey.
5. Optionally request an on-chain review of a hosted report with a Studionet wallet. This is a signed write; reading a report needs no wallet.

## Run your own Roadtest

Requires Node 24 and Playwright Chromium:

~~~sh
npm ci
npx playwright install chromium
npm test
npm run roadtest -- path/to/my-project.json
~~~

The plan is also available as [a starter file](public/roadtest.template.json). The runner supports browser checks for visible headings, links, and buttons; one click followed by an expected visible result; uncaught page errors; and same-origin JSON/text HTTP assertions. Each check must support an explicit claim. The report includes exact response SHA-256 values and `not_tested` limitations. A failed or inconclusive assertion makes the command fail, so it can gate CI.

Do not put secrets in a plan or run plans from untrusted people in privileged CI. The hosted runner accepts only public HTTPS origins, exact browser roles/names and same-origin public response assertions. It does not accept arbitrary JavaScript, credentials, or private evidence. Hosted reports and screenshots are public.

## For agents

Fetch [the report JSON](https://reviewer-roadtest.vercel.app/reports/roadtest.json), [OpenAPI](https://reviewer-roadtest.vercel.app/openapi.json), and [the agent guide](https://reviewer-roadtest.vercel.app/llms.txt). POST a valid plan to `/api/run` for a hosted run and receive a public report URL and exact SHA-256. POST a hash, expected contract and network to `/api/receipt` to independently check a transaction. Inspect `overall`, every `claims[].status`, the supporting `checks`, `evidence_model`, and `not_tested`. A `PASS` applies only to the declared checks, not to the whole product.

An agent can also edit a plan and run `npm run roadtest -- path/to/plan.json`. On-chain reviews must be requested by an authorized signer through the site or GenLayer SDK; the API never holds a signing key.

## GenLayer boundary

The [OnboardingRoadtest intelligent contract](contracts/OnboardingRoadtest.py) answers one subjective question: does a public landing page clearly explain the product, show a wallet-free result to inspect, and distinguish reads from signed writes? GenLayer validators independently fetch and judge the page. This assessment is separate from deterministic browser/HTTP checks. It does **not** attest the CI screenshot, transaction receipts, or overall software correctness.

Studionet contract: `0x565096782FE263BEFaDC65a0A5796dd2544116bB`. With your own authorized Studionet wallet, call `assess(unique_id, https://public-site.example/)`, wait for `FINALIZED`, inspect successful execution, and then read `get_assessment(unique_id)`. Never put a private key in the site, repository, or chat. The contract uses a pinned GenVM runner; lint, direct tests, and a real Studionet consensus run are part of this repository's evidence.

The site's own clarity assessment returned `CLEAR` in this [finalized Studionet transaction](https://explorer-studio.genlayer.com/tx/0x845a158ae90faff007f8b62dad1d4827bf4614062e33363a361ad93ab4a51d52). It is also published as [assessment JSON](https://reviewer-roadtest.vercel.app/assessments/roadtest.json).

## Full-report consensus review

The [ReportReview intelligent contract](contracts/ReportReview.py) accepts the URL and SHA-256 of a hosted Roadtest report. Validators re-fetch the exact report bytes, its public HTTP assertions and screenshot bytes, recompute claim statuses, and judge whether claim wording exceeds the evidence. Browser clicks remain **runner testimony** and cannot be independently replayed by validators. An `SCOPED` verdict is not a security certificate or proof of the browser journey.

Studionet contract: `0x698551A62D7547884963Fcc8Df7208E0a04aD576`. Call `review(unique_id, report_url, lowercase_sha256)` with an authorized wallet, wait for `FINALIZED` and successful execution, then read `get_review(unique_id)`. A Vercel-hosted self-check was reviewed as `SCOPED` in [this finalized transaction](https://explorer-studio.genlayer.com/tx/0xb331b188d4b9167515294b23ad1346b2647f2bd074a2e4eb68ead20e30562f0d); [review metadata](public/reviews/roadtest.json) includes the report hash and evidence limits. The previous reviewer address is historical; new writes should use the address above.

## Boundaries

- A hosted run is synchronous and limited to five browser checks, five public reads, and two minutes. It is not an account-based queue or a full web crawler.
- Wallet-transaction checks require a user-supplied hash and expected contract. Roadtest does not initiate transactions in the target project or know whether the target's UI behaved correctly.
- The on-chain review checks report integrity and public evidence. It cannot prove browser clicks, private evidence, or broad software security.
- Anonymous hosted runs consume limited Vercel Sandbox and Blob quota. On Hobby, the service may stop accepting runs when free quotas are exhausted; never put sensitive data into a public plan.
- The hosted API accepts at most ten claims and rejects reports over 100 KB so its output fits the on-chain reviewer's input bound. An unpublished log-only WAF rule does not enforce a rate limit; abuse of the public runner remains an operational risk until a reviewed limit is published.

The site uses Vercel Functions, Sandbox and Blob. GitHub Actions runs the self-check on push and daily, commits the dated report even when it fails, and marks failing evidence red in CI. MIT licensed.
