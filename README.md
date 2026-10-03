# NABAT

**Every plant has a history. Give it an identity.**

A working V1 pilot repository for plant identity, longitudinal care and fleet operations. Next.js 16 / React 19 / strict TypeScript, one PostgreSQL schema, private photo storage, versioned vision and health services, NFC/QR provisioning and tenant-scoped access.

The selected connection is a **Business Workspace Agent with GPT-5.6 Luna**, a job-scoped MCP image/read-write interface and no Platform API key. Production remains in standby until its tools, published API channel, workspace token and intended allowance are verified. See [Workspace Agent setup](docs/WORKSPACE_AGENT.md). [Gateway tier routing and accounting](docs/GATEWAY.md) remains an inactive alternative; customer checkout is not connected.

## Run locally

Node.js 22.23 or newer is recommended; the development environment was verified on Windows with Node 22.23.1. No database installation or AI credentials are needed for development.

```powershell
cd E:\INJAZ
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The local Postgres adapter persists to `data/postgres`; uploads and a local signing secret persist under `data`. First launch applies migrations and creates the synthetic hotel workspace. The development analysis loop runs inside this web process. **Do not open the same PGlite directory in a second process.** Stop the web server before using local `db:migrate` / `db:seed` commands.

The lockfile and `.npmrc` preserve the peer-resolution policy used for this verified build; the bundled npm initially hit a peer-resolution crash without it. Use **Explore the demo**, or sign in:

| Role      | Email              | Password         |
| --------- | ------------------ | ---------------- |
| Owner     | `owner@nabat.demo` | `NabatDemo2026!` |
| Caretaker | `care@nabat.demo`  | `NabatDemo2026!` |

The demo contains 12 plants, four locations, six weeks of synthetic photo/score history, care events, assignments and alerts. Its IDs and initial scores are deterministic. Dates are relative to the initial seed date; records persist thereafter, so real test interactions change the demo. Generated photographs and development analysis are explicitly synthetic. Registration creates a separate account and workspace, with no access to the demo unless membership is granted.

## What works

- Marketing, registration/sign-in/sign-out, personal/business onboarding, workspace switching and durable sessions.
- Fleet dashboard, explanatory attention queue, paginated search/filter/table/card collection, plant record and living timeline.
- One-tap watering with pending/success/error states, idempotent retries, optional amount/notes/photo, movement and assignment history.
- Mobile capture/library, image preview and compression, upload progress, image validation, original preservation and thumbnail derivatives.
- Queued/processing/completed/failed analysis, durable leases, bounded retries, source-linked visual records and health snapshots; baseline and quality gates.
- Alerts with acknowledgement/resolution history, locations, team roles, settings, audit and ownership handover acceptance.
- Opaque NFC tokens, tag replacement/revocation, last interaction, downloadable SVG with an actual QR, public-safe identity presentation.
- English UI, Arabic navigation/action translations, locale-aware dates/numbers, RTL-safe layout, keyboard/native-dialog focus and reduced motion. Species/user content and some explanatory prose remain English; complete Arabic editorial translation is a next-stage item.
- PWA manifest/icons/service worker and a truthful offline reconnect screen. Offline care submission is an extension interface, not implemented background sync.

## Environment

| Variable                                     | Purpose                                                                                                                                       |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                               | Production PostgreSQL connection. Empty uses durable local PGlite.                                                                            |
| `NABAT_DATA_DIR`                             | Local data root, default `./data`.                                                                                                            |
| `APP_URL`                                    | Stable canonical origin used in printed QR/NFC URLs and write-origin validation. Production must be HTTPS.                                    |
| `SESSION_SECRET`                             | At least 32 random characters in production; signs expiring media/upload capabilities. Local development generates a persistent secret.       |
| `ENABLE_DEMO`                                | Explicitly `false` for production. Shared demo login is rejected in production.                                                               |
| `AI_PROVIDER`                                | `development`, `chatgpt-subscription`, or optional `gateway` / `openai` adapters. Selected production mode uses only the user's subscription. |
| `ANALYSIS_RUNTIME`                           | `external` for the selected local subscription worker; cloud upload/cron never call an AI billing provider in this mode.                      |
| `GATEWAY_VISION_MODEL`                       | Live-tested `openai/gpt-4.1-mini`; configurable. Vercel uses automatic OIDC. Other hosts may set `AI_GATEWAY_API_KEY`.                        |
| `BLOB_READ_WRITE_TOKEN`, `BLOB_STORE_ID`     | Private Vercel Blob storage. Token or runtime OIDC; never expose either credential in the browser.                                            |
| `OPENAI_API_KEY`                             | Server-only credential, required only for `openai`.                                                                                           |
| `OPENAI_VISION_MODEL`                        | Default `gpt-4.1-mini`; configurable compatible vision/structured-output model.                                                               |
| `S3_BUCKET`, `S3_REGION`                     | Private production object storage.                                                                                                            |
| `S3_ENDPOINT`                                | Optional S3-compatible endpoint; path-style addressing is used when supplied.                                                                 |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Least-privilege server storage credentials, or use the platform's supported role credentials.                                                 |
| `WORKER_SECRET`                              | At least 32 random characters for the authenticated `/api/worker` HTTP trigger.                                                               |
| `CRON_SECRET`                                | At least 32 random characters for Vercel's authenticated GET cron trigger.                                                                    |

CLI database/worker commands load `.env.local` through `@next/env`. Never commit credentials. The browser receives neither DB nor AI/storage credentials. The S3 adapter requests AES256 object encryption; a compatible provider must support it. Signed upload destinations are short-lived, single-use reservations. The server mediates uploads, so configure the hosting proxy/function to accept the compressed image payload. This is not a direct-to-S3 browser upload implementation.

## Database, seed and worker

```powershell
# Stop local dev first if using the same embedded database.
npm run db:migrate
npm run db:seed

# Dedicated production worker requires DATABASE_URL.
npm run worker
```

Production does not auto-run migrations or seed customer data. Run `db:migrate` as a release step with a migration role; give the runtime role only required DML/sequence privileges. Migrations acquire an advisory lock. The application uses tenant-aware authorization on every service path and composite tenant foreign keys. This V1 does not rely on PostgreSQL RLS; direct database access is restricted to server roles.

The production worker claims jobs with `FOR UPDATE SKIP LOCKED`, leases for five minutes and retries at most three times. Failed jobs retain their photo and can be retried from the profile. Run the continuous worker, or POST to `/api/worker` from your scheduler with `Authorization: Bearer <WORKER_SECRET>`. A request `after()` kick makes a newly uploaded observation start promptly, while the durable worker handles recovery and overdue-care sweeps.

## AI and scoring

The provider contract is in `src/domain/analysis/contract.ts`. A strict Zod schema validates normalized signals, per-signal confidence/evidence, overall confidence and comparability. Provider/model/prompt/contract versions are persisted. The user's selected production path uses their Business Premium subscription with the exact `gpt-6.1-sol` model through an authorized local worker; see [connection instructions and eligibility](docs/CHATGPT_SUBSCRIPTION.md). Vercel only queues work. Actual subscribed inference requires successful OAuth, permitted scope and account-specific model availability; its proof status is in the verification ledger. The optional Gateway adapter was separately live-tested with a generated asset, then disabled for the user's billing constraint. The direct OpenAI API-key adapter has not been separately exercised. See [official structured-output documentation](https://developers.openai.com/api/docs/guides/structured-outputs).

The development provider deterministically derives **fixture signals**, does not inspect photos, and says so in each record and the UI. Never interpret those results as plant measurements or diagnoses.

The health engine combines visual condition/stress, yellowing/browning/leaf-retention/canopy changes, confidence-weighted growth, watering/fertilising cadence and relocation. Comparison requires the same provider/model, usable image quality, confirmed similar viewpoint and at least six hours between captures; the last three comparable observations form the baseline. Scores are heuristic estimates, not calibrated biological measurements. Cross-engine/provider scores are not used as comparable deltas. Immutable analysis records and versioned score composition support future model evaluation and recalculation without replacing original evidence.

## NFC pilot setup

1. Set `APP_URL` to the permanent HTTPS origin before creating/printing tags. `localhost` links are only for desktop development; a phone must reach a deployed domain or a reachable test host.
2. Create a plant. Its internal UUID, human code and independent opaque tag token are distinct.
3. Open **Tags → Copy URL**. Encode **one NDEF URI/URL record** using a standard NFC writer app and an NFC sticker such as NTAG213/215/216 with sufficient capacity. NABAT provisions the URL; it does not claim cross-platform Web NFC writing.
4. Download **Print tag**. Print the 45×65 mm SVG at 100% scale, preserving the QR quiet zone. Scan the printed QR and compare the exact destination to the copied URL.
5. Attach the NFC sticker to the plant/pot. Avoid an ordinary tag directly on metal; use the appropriate tag hardware if needed. Test with the target iPhone and Android phone under their normal native reading conditions.
6. The same `/p/{token}` opens an authorized profile for a workspace member and an opted-in identity-only passport otherwise. Care requires membership. Retired tags explicitly stop working; replacements preserve plant identity/history.

Native behavior depends on the phone and tag; see [Apple background NFC reading](https://developer.apple.com/documentation/corenfc/adding-support-for-background-tag-reading) and [Android NFC documentation](https://developer.android.com/develop/connectivity/nfc/nfc). Physical encoding/tap verification remains a pilot hardware check: no physical NFC tag was supplied for this development run.

## Handover and team

An Owner requests a plant handover using a destination workspace ID. The receiving workspace's Owner accepts it in Settings. Plant identity, tags, care/photos/analyses/snapshots/alerts move atomically; the old workspace loses access, location is cleared and active caretaker assignment ends. Former caretaker personal names are not exposed to unrelated new members. Expiring media capabilities are bound to the current tenant, so a transfer invalidates old links immediately.

Team provisioning requires both the teammate's email and account ID from their private Settings, confirmed through your usual contact channel. This prevents granting access solely to an unverified claimed email. V1 has no email verification, password-reset email, automatic invitation delivery or billing checkout; those provider integrations are documented roadmap items, without fake buttons or dispatches.

## Verify

```powershell
npm run typecheck
npm run lint
npm test
npx playwright install chromium
npm run test:e2e
npm run format:check
npm audit
npm run build
```

Vitest uses an isolated `data/test-*` database. Playwright creates its own test account/workspace and checks onboarding, NFC, persistent care/details, upload/analysis, privacy, filters, mobile actions, RTL/reduced motion and tag retirement. Browser QA uses the Codex in-app browser against the actual app; design references and comparison evidence are in `docs/design` and `docs/qa`.

Production runtime requires the configured external database, private storage and HTTPS origin; use `npm start` after provisioning them. Development stays available through `npm run dev`, with no production safety bypass. See [deployment instructions](docs/DEPLOYMENT.md), [architecture](docs/ARCHITECTURE.md) and [verification evidence](docs/qa/VERIFICATION.md). Neon TLS/migrations, private Blob read/write/anonymous denial and Gateway structured vision were exercised against real cloud services. S3, Docker and physical NFC reading remain separate untested platform/hardware options.
