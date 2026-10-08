# Reviewer Roadtest

An independent, open-source tool for testing a public project's first-time-user path and publishing a narrowly scoped evidence report. The [website](https://reviewer-roadtest.vercel.app/) lets a person create a test plan and read a dated example report. Agents can read the same JSON and run the tester from this repository. No wallet or API key is needed to read a report.

The published example checks Reviewer Roadtest's own site. It is a self-check, **not** a certificate for other projects or a full security audit.

## First-time use

1. Open the website and choose **Create a Roadtest plan**.
2. Enter a public HTTPS homepage, its exact accessible headline, the public-example link text, and the heading expected after clicking that link. Download the JSON.
3. Run that plan from this repository, or have an agent run it in CI. Review the generated report and screenshot before publishing them.

## Run your own Roadtest

Requires Node 24 and Playwright Chromium:

~~~sh
npm ci
npx playwright install chromium
npm test
npm run roadtest -- path/to/my-project.json
~~~

The plan is also available as [a starter file](public/roadtest.template.json). The runner supports browser checks for visible headings, links, and buttons; one click followed by an expected visible result; uncaught page errors; and same-origin JSON/text HTTP assertions. Each check must support an explicit claim. The report includes exact response SHA-256 values and `not_tested` limitations. A failed or inconclusive assertion makes the command fail, so it can gate CI.

Do not put secrets in a plan or run plans from untrusted people in privileged CI. The runner deliberately does not accept arbitrary JavaScript, credentials, private evidence, or hosted anonymous jobs.

## For agents

Fetch [the report JSON](https://reviewer-roadtest.vercel.app/reports/roadtest.json), [OpenAPI](https://reviewer-roadtest.vercel.app/openapi.json), and [the agent guide](https://reviewer-roadtest.vercel.app/llms.txt). Inspect `overall`, every `claims[].status`, the supporting `checks`, `evidence_model`, and `not_tested`. A `PASS` applies only to the declared checks, not to the whole product.

An agent can edit a plan and run `npm run roadtest -- path/to/plan.json`. The public website is a plan builder and report viewer; it is **not** an on-demand execution API.

## GenLayer boundary

The [OnboardingRoadtest intelligent contract](contracts/OnboardingRoadtest.py) answers one subjective question: does a public landing page clearly explain the product, show a wallet-free result to inspect, and distinguish reads from signed writes? GenLayer validators independently fetch and judge the page. This assessment is separate from deterministic browser/HTTP checks. It does **not** attest the CI screenshot, transaction receipts, or overall software correctness.

Studionet contract: `0x565096782FE263BEFaDC65a0A5796dd2544116bB`. With your own authorized Studionet wallet, call `assess(unique_id, https://public-site.example/)`, wait for `FINALIZED`, inspect successful execution, and then read `get_assessment(unique_id)`. Never put a private key in the site, repository, or chat. The contract uses a pinned GenVM runner; lint, direct tests, and a real Studionet consensus run are part of this repository's evidence.

## What remains outside this release

- A hosted queue that executes arbitrary third-party URLs, with authentication, abuse controls, and safe browser isolation.
- Signed-wallet, transaction-specific, and multi-party workflows. The generic runner does not yet validate chain receipts.
- Independent on-chain verification of an entire browser/HTTP report; the current GenLayer verdict covers first-visit explanatory clarity only.

The site is static on Vercel. GitHub Actions runs the self-check on push and daily, commits the dated report even when it fails, and marks failing evidence red in CI. MIT licensed.
