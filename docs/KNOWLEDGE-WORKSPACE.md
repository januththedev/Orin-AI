# Knowledge workspace

The new browser workspace uses Clerk identity, Neon Postgres, curated Markdown RAG,
provider credential pools, and explicit Balanced/Best routing. No production
credentials or infrastructure are created by this change.

## Run locally

```bash
npm ci
npm run dev:demo
```

Open http://127.0.0.1:5173. Visit `/#home` to preview the public landing page; the live build uses that page at `/` and opens the workspace at `/#chat`. The clearly labeled demo injects an in-memory repository
and a local administrator **only in the loopback development API**. It produces
explicitly labeled deterministic answers. Demo data resets on restart. Do not use
real provider keys in the demo. Production cannot enable this bypass using an
environment variable, request field, header, or cookie.

For the real services, copy `.env.example` to `.env.local`, configure the values
below, run the migration on a Neon development branch, and run `npm run dev`.
Both development commands start Vite and its API together. This application does
not require a Next.js migration.

## Configuration

| Variable                     | Purpose                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`               | Neon connection string, server only                                                                    |
| `TOKEN_ENCRYPTION_KEY`       | Existing encryption secret, at least 32 random characters; back up securely                            |
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk's public browser key                                                                             |
| `CLERK_ISSUER_URL`           | Exact Clerk issuer, e.g. `https://your-instance.clerk.accounts.dev`                                    |
| `ORIN_AUTHORIZED_PARTIES`    | Comma-separated allowed frontend origins; include the actual preview URL and localhost for development |
| `CLERK_JWT_AUDIENCE`         | Optional audience if your session tokens configure one                                                 |
| `ORIN_ADMIN_CLERK_IDS`       | Exact Clerk subject IDs allowed to administer the workspace                                            |
| `ORIN_WORKER_SECRET`         | Separate random secret, minimum 32 characters, shared only with the scheduler                          |

Name and email are optional verified JWT custom claims. Identity always uses the
verified Clerk `sub`; users are never linked by matching an email. Clerk sessions
must have a session ID, valid signature, expiry, issuer, and authorized party.
Removing a user from the server admin allowlist removes admin access.

All browser data access goes through the backend. Database credentials are never
exposed to browser code. The frontend obtains a short-lived Clerk session token
using the SDK; it does not persist bearer credentials itself.

```bash
npm run db:migrate
```

The additive, transactional SQL migration enables `vector` and adds normalized
accounts, conversations, messages, request deduplication, configuration/jobs, and
knowledge chunks. Legacy tables remain untouched. Use a restricted database role
and a Neon branch to verify the migration before production.

## Providers

Open **Administration → Providers**, add a key, label it, and assign a quota pool.
Keys are AES-GCM encrypted using the server encryption key; only their masked
suffixes leave the backend. The same provider account should use the same pool,
even when it has several API keys. Removing or rotating a key is supported by
adding a replacement and disabling/deleting the old key.

Adapters:

- OpenRouter: generation, embeddings, reranking, typed decisions.
- Groq: generation.
- Vercel AI Gateway: generation.
- NVIDIA NIM: text embeddings and the NVIDIA retrieval reranking API.

For NIM reranking, configure a model supported by the adapter's fixed NVIDIA
reranking endpoint. A model requiring a different vendor-specific endpoint needs
an adapter extension; arbitrary admin-supplied base URLs are deliberately absent.
Check each model's required dimensions, input types, terms, and free-access rules.
The adapter endpoints and schemas are implemented but require live credential
validation in your accounts before public rollout.

**Models & routing** discovers provider catalog entries and lets administrators
review service type, free access, context size, reasoning support, and eligibility.
Unknown prices are blocked. Groq/NIM free account quotas must be confirmed by the
administrator because the generic model catalog does not prove an account's tier.
OpenRouter generation also sends a zero-price provider constraint. External
provider auto top-ups and paid usage should be disabled: application-side catalog
checks cannot guarantee a provider's bill when prices or account plans change.

Models restricted to public data require the user's session-only opt-in under
Settings → Provider data policies. NVIDIA models on OpenRouter are automatically
marked as restricted. This is a policy gate, not a detector of confidential text.
Users must comply with the endpoint's actual terms.

### Failover

- 401 disables the key and tries another eligible credential.
- 402/429 cool down the entire quota pool, respecting Retry-After.
- 403/404 cool down that provider/model route.
- Network errors and 5xx temporarily demote a credential and permit fallback.
- 400/422 stop retries: rotating a key cannot repair an invalid request.
- Candidate context limits and Thinking capabilities are checked before sending.
- Up to three generation attempts share one deadline; retrieval and decisions
  have shorter budgets. OpenRouter's implicit provider fallbacks are disabled.
- Real upstream SSE content is forwarded as it arrives. After the first content
  delta, a provider failure preserves an interrupted answer; it never silently
  appends another provider's text. Before content begins, normal failover applies.

Stop waiting cancels the browser connection. The server can finish and save the
answer; reopen the conversation to inspect it. Pending database messages older
than two minutes are marked interrupted when that conversation is read again.

## Knowledge workflow

1. Upload `.md`/`.markdown` (up to 500 KB) or paste content.
2. Index it. Work runs in batches of eight chunks with durable job leases.
3. Review the Markdown and test published retrieval in the Retrieval lab.
4. Publish explicitly. Only published document versions are searched.
5. Edit a reviewed document as a new version; its previous published version stays live until the replacement is indexed and published.
6. Restore an indexed prior version through the review dialog, or archive a document to remove it from future retrieval.

Headings and fenced code are preserved. Oversized indivisible sections are
rejected with a request to split them; they are not silently truncated. Duplicate
content is rejected. Raw Markdown, titles, chunk IDs, versions, and sources remain
in Neon. AI-generated documents require human verification before publication.

Embeddings and reranking can use NIM or OpenRouter. Set an embedding **space ID**
representing an exact model/version/preprocessing/dimension combination. Provider
failover is allowed only inside that space. A differently trained model requires
a separate index; it cannot query the old vectors. This version indexes each
uploaded document into one space. Automatic dual indexing is not implemented.

If embeddings are unavailable, indexing can complete with keywords only. The
publish dialog requires explicit acknowledgement of that limitation. Hybrid
retrieval combines keyword and semantic ranks with reciprocal rank fusion,
optionally reranks twenty candidates, and supplies up to six passages within a
context budget. Reranking failure falls back to the fused rank.

Retrieved text is placed in the actual model context as untrusted reference data.
Sources are persisted with the answer and open in an inspection drawer. Citation
IDs are checked structurally; this is **not** proof that every cited claim follows
from the source. No accuracy percentage is claimed before a held-out evaluation.

## Decision model and evaluations

An eligible OpenRouter decision model uses the Decisions API (not Chat Completions)
to assess whether references are useful and whether the task concerns coding.
Invalid/unavailable decision responses fall back to conservative rules. Decisions
cannot override auth, provider policies, free-access eligibility, or Thinking.

Thinking off selects Balanced. Thinking on requires reasoning support and raises
quality weights. Scores use available local screening, exact external benchmark
mappings, observed latency/reliability, and uncertainty penalties. Missing external
scores remain unknown. Task classification is recorded for inspection; specialized
per-task ranking and a calibrated post-answer factual-support judge are future
extensions, not active quality guarantees.

Generation discovery includes anonymous/stealth models. Zero-priced candidates are
queued for four synthetic checks: arithmetic, simple grounding, unknown-answer
handling, and JSON output. A 75% pass threshold enables routing. This small screen
is a basic admission check, **not a reliable general-intelligence or trilingual
accuracy benchmark**. Administrators can disable a model or review it manually.
A larger held-out, reviewed evaluation dataset is required before claiming the
RAG accuracy target from the plan. Non-generation models currently need manual
configuration/review of capabilities and embedding compatibility.

Artificial Analysis integration accepts an encrypted data API key and exact
administrator-supplied model IDs. It does not guess benchmark identities from names.
Scores retain attribution and update time. Confirm the benchmark configuration
matches the model/version/reasoning mode you mapped.

## Scheduler

Deploy `worker/scheduler.js` with the adjacent Wrangler configuration. Configure
`ORIN_WORKSPACE_URL` and set the same `ORIN_WORKER_SECRET` on both services. Cron
calls one authenticated, bounded tick each minute. Durable leases prevent duplicate
indexing. Catalog refreshes are due every 30 minutes; benchmarks every 12 hours.
Each screening case runs in its own tick. Snapshot failures keep previous data;
price changes or catalog metadata changes require screening/review again.

The worker has source/configuration in this repository; it has not been deployed.
Vercel's once-daily Hobby cron is not used for frequent refreshes. Without the
worker, indexing, discovery, and evaluation can still be initiated in the admin UI.

## Existing chat history

No automated email linking or destructive migration occurs. First establish the
old Orin UID and the new Clerk user ID through an operator-verified identity check.

```bash
npm run history:import -- OLD_ORIN_UID user_CLERK_ID
npm run history:import -- OLD_ORIN_UID user_CLERK_ID --apply
```

The first invocation is a dry run. The importer merges profile history and v2
conversation records, deduplicates message IDs, copies history using deterministic
IDs, and leaves originals intact. It refuses a legacy query that reaches its
500-record limit so a larger account is not silently truncated. Previously
discarded messages require another backup; they cannot be reconstructed.

The new UI paginates conversation titles and message history. It does not store a
whole user's chats in one mutable JSON blob. A request ID prevents a repeated
submission from generating duplicate saved messages. Failed and interrupted
answers remain distinguishable from completed answers.

## Deployment and rollback

The public `/api/workspace` URL rewrites into the existing admin function with a
separate Clerk-authenticated dispatcher. This retains the repository's twelve-
function deployment contract. The new workspace executes its provider adapters
locally in this backend; legacy `/api/chat` still uses the external Orin Router.
The external Router repository and other products were not modified.

Legacy legal/download/device/voice routes remain available during migration. Their
legacy authentication is retained; a Clerk-to-device approval bridge and a redesign
of those legacy screens are not included. Set `VITE_LEGACY_WORKSPACE=1` and rebuild
to restore the previous browser workspace while retaining the additive new tables.

Before public rollout: configure Clerk/Neon, migrate a development branch, verify
actual provider APIs/account limits, import verified existing identities, deploy
the scheduler, and run the domain evaluation. No production data, credentials,
deployment, or account settings were changed by the local implementation.

## Verification

```bash
npm run check
npm run build
npx playwright install chromium
npm run verify:workspace
npm run verify:landing
npm run test:e2e
```

Postgres integration tests use PGlite with the real pgvector extension, exercising
the migration and parameterized SQL locally. Browser verification walks through
Markdown upload/index/publication, retrieval, sources, chat restoration, themes,
and mobile navigation using the explicit demo. It does not measure live model
accuracy or validate third-party credentials.

If Chromium is preinstalled elsewhere, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` for
`verify:workspace`. Screenshots default to `/tmp/orin-workspace-qa`; set `ORIN_QA_DIR`
for another path. Do not commit browser artifacts or real credentials.
