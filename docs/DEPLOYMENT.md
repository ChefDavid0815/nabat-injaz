# Production deployment

The repository produces a Next.js standalone build. The NABAT Vercel project is `nabat-injaz`, with canonical URL `https://nabat-injaz.vercel.app`, Node 22, Frankfurt functions, Neon PostgreSQL and a private Vercel Blob store. Cloud resources are linked only to this project. Live verification evidence is recorded in `docs/qa/VERIFICATION.md`.

## Vercel release

The selected production route is the Business Workspace Agent with GPT-5.6 Luna. `AI_PROVIDER=workspace-agent` and `ANALYSIS_RUNTIME=workspace-agent` use the scoped configuration in [Workspace Agent setup](WORKSPACE_AGENT.md). Its tools and credential are configured, but real trigger attempts currently return a provider-side HTTP 409 availability rejection. Native preview runs; unattended photo analysis is not yet proven. Gateway and direct subscription inference are inactive. The MCP endpoint returns 404 when Workspace Agent mode is not selected.

The earlier experiment used `AI_PROVIDER=chatgpt-subscription` with `ANALYSIS_RUNTIME=external`. Its direct OAuth plan-sharing eligibility was not established for Business, and it is not the selected connection route. See [experimental subscription setup and eligibility](CHATGPT_SUBSCRIPTION.md).

See [Gateway tiers and accounting](GATEWAY.md) for future tier routing and budget behaviour.

- Production requires `DATABASE_URL`, `APP_URL`, `SESSION_SECRET` (32+ characters), `ENABLE_DEMO=false`, `BLOB_READ_WRITE_TOKEN`, `AI_PROVIDER=gateway`, `GATEWAY_MODEL_FREE`, `WORKER_SECRET` and `CRON_SECRET`. Signing/worker secrets are sensitive Vercel variables. Gateway uses automatic runtime OIDC; no provider API key is required.
- `openai/gpt-4.1-mini` was the accessible vision model tested under this account's free Gateway allowance. Higher tiers are catalog-verified configuration slots, not proven paid model access. No credits were purchased or auto top-up enabled. Changes between models start a new comparison baseline.
- Pull production variables into an ignored, separate file such as `.env.vercel.production`; keep production DB credentials out of local development's `.env.local`. Verify TLS certificates. Run migrations once with the production environment, then initialize the species catalog with `ensureSpecies()`. Never seed the shared demo on the live DB.
- Upload and explicit retry responses schedule one plant-scoped analysis via Next.js `after()`. Authorized profile polling can recover eligible jobs; Postgres leases prevent duplicate claims. The daily 03:00 UTC cron calls the bearer-authenticated GET `/api/worker`, recovering up to 25 jobs within a time budget and creating overdue alerts in one query. POST uses `WORKER_SECRET`; cron GET uses `CRON_SECRET`. Both reject ordinary sessions.
- The API exports a 300-second function duration; each model call times out at 90 seconds and has no SDK automatic retries. DB jobs retry up to three attempts. Daily Hobby cron is recovery rather than an always-running queue: larger unattended batches need the included continuous PostgreSQL worker or a more frequent authorized scheduler.
- Prepared mobile uploads are capped at 4 MB to stay within Vercel's 4.5 MB function payload limit. Media remains private; the application checks expiring tenant-bound HMAC links and proxies Blob bytes. Blob object URLs are never public photo URLs.
- Run `npm ci`, typecheck/lint/tests/build, then `vercel deploy --prod --yes --scope <your-team>`. Inspect READY status and the canonical hostname, then verify registration → workspace → plant → care → photo → real analysis → health → public NFC privacy on that hostname.

## Infrastructure

Use PostgreSQL, a private S3 bucket (or compatible encrypted store), a Node 22 host/reverse proxy with HTTPS, and a continuous worker or secret-authenticated scheduler. Keep the canonical `APP_URL` stable: printed tags depend on it. Do not point customer tags to a preview URL.

1. Copy `.env.example` to the host's secret environment configuration. Set `NODE_ENV=production`, `ENABLE_DEMO=false`, `DATABASE_URL`, HTTPS `APP_URL`, long random `SESSION_SECRET` / `WORKER_SECRET`, production storage settings, and explicit `AI_PROVIDER`.
2. Use a separate migration principal where supported. Run `npm ci`, then `npm run db:migrate`. Run no demo seed on a live customer database.
3. `npm run build`, then `npm start` behind HTTPS. For standalone packaging, copy `public`, `.next/static` and `db` beside `.next/standalone/server.js` as in the Dockerfile.
4. Start `npm run worker` with the same database/storage/AI environment. The external worker requires PostgreSQL; it refuses a second local PGlite connection.
5. Register the first owner, create the organisation and locations, add team members by confirmed account ID/email, and create the first real plant.
6. Check `/api/health`, upload a real photo, confirm queued→processing→completed, review evidence/score provenance, verify public privacy and an unauthorized account rejection, then encode/test the actual NFC/QR tag.

Production refuses the embedded DB, an HTTP/missing canonical URL, missing/short signing secret and enabled shared demo. Private media requires Blob or S3 configuration. There is no production safety bypass. Use development mode for a local fixture environment.

## Docker / Compose option

The Dockerfile has `web` and `worker` targets. Compose provisions a private-network PostgreSQL service, runs migrations once, then starts web/worker. S3 remains an external private store. No container deployment was executed on this development host.

Create `.env.production` with the application environment, and a local `.env` containing a randomly generated **hex-only** `POSTGRES_PASSWORD` (so it is safe in a connection URI). Keep both ignored by Git. Use your container platform's secret facility when available.

```sh
docker compose up --build -d
docker compose logs -f web worker
```

Terminate TLS at your reverse proxy, forwarding the original host/origin consistently with `APP_URL`. Web listens on port 3000. Set an upload body limit appropriate to the application's 10 MB server limit and compressed-client flow. Configure HTTPS HSTS on the proxy once the production domain is working. Protect `/api/worker` with its configured bearer secret; the ordinary application session is not enough to invoke it.

## Storage and operations

- Bucket is private: no public ACL or static public media origin. Grant runtime only GetObject/PutObject to the NABAT key prefix and use encryption supported by the provider.
- Keep originals/derivatives and database backups coordinated. Protect signing secrets and rotate them deliberately: rotation expires active media/upload links without changing NFC identities.
- Back up PostgreSQL using the host/provider's supported process and rehearse restoration. PGlite local data is not the production backup strategy.
- Monitor failed/stale jobs, request IDs, provider error counts and queue age. A worker retry does not invent a successful result.
- Plan an orphan-object lifecycle sweep for objects written before a failed DB transaction. Use conservative age windows and database references; do not delete live plant history.
- Run typecheck/lint/tests/build and the deployment smoke paths on upgrades. Core Web Vitals, throughput, physical device installability and real AI quality were not inferred from a successful build.

## Platform option

The Node application can run on a managed Next.js host such as Vercel, with external PostgreSQL/private storage and a separately hosted worker or scheduler. Link only a new, explicitly selected NABAT project. Set secrets through the platform, run migrations as a release job and test body/time limits against real capture payloads. Do not enable local data fallback in a serverless filesystem. See [Next.js self-hosting documentation](https://nextjs.org/docs/app/guides/self-hosting) for the standalone deployment foundation.
