# NABAT 1.1 release process

Release channel: **pilot**, version **1.1.0**, API **operations/1.1**. The immediately runnable delivery is the self-contained x64 portable app. ARM64 and unsigned MSIX are packaging targets. Signing, physical NFC/printing and installed protocol/upgrade acceptance are deferred by the user's explicit instruction.

## Build and verify

```powershell
npm ci
npm run contract:check
npm run typecheck
npm run lint
npm test
npm run build
.\.tools\dotnet\dotnet.exe test windows/Nabat.Core.Tests/Nabat.Core.Tests.csproj -c Release
.\windows\build.ps1 -Architecture x64 -Package
.\windows\build.ps1 -Architecture arm64 -Package
```

For browser acceptance use the isolated `npm run dev:operations` server. Run Playwright with `E2E_EXTERNAL_SERVER=1` and `E2E_BASE_URL=http://127.0.0.1:3001`. Native render/restart acceptance is opt-in through `NABAT_UI_PROBE_DIR`; it captures only the app's XAML tree and stores test state in an ignored `.state` folder. `NABAT_UI_PROBE_RESUME=1` resumes the second real process. Neither flag belongs in an ordinary launch.

## Shared cloud release

The existing project is `nabat-injaz`, canonical origin `https://nabat-injaz.vercel.app`. 1.1 is deployed and its shared/native cloud checks passed; see the verification ledger. Keep the existing authentication/storage secrets, identity URLs and Workspace Agent settings. Do not add a paid provider or top-up. Use a separate ignored production environment file; do not print values or commit it.

Migrations 010–013 are additive Operations extensions, Viewer membership, ownership-transfer cleanup, maps/imports/programming history and plant outcome/label records. Rehearse them against an isolated production branch when available. This session had the direct database connection but no authenticated Neon branch-management tool; its documented fallback was a short, lock/statement-bounded transaction on the current database, followed by rollback and identical historical counts. It must not be described as a Neon branch rehearsal.

`npx tsx scripts/operations-cloud-check.ts` performs that rollback compatibility check. `--apply` first saves a Windows-account DPAPI-encrypted JSON data snapshot, then commits the additive migrations. The snapshot includes schema migration inventory and data; it is not a pg_dump archive, and full database restoration has not been rehearsed. Preserve the existing provider recovery/PITR policy and the source revision. Never rewrite already applied migration files.

Deploy the approved current source to the already linked Vercel project. Inspect READY and the canonical alias, then verify health, session, snapshot, public identity privacy, native bearer access, care/session replay and the retained owner Workspace Agent configuration. No observation or model call is needed for the deployment's schema/auth smoke check. The last verified external trigger returned HTTP 409; no release check can claim AI recovery without a successful actual job.

Rollback the application alias to the previously recorded deployment if smoke checks fail. Keep additive tables/data in place so pending care and operations history are preserved; destructive down-migrations are not the routine rollback path. Do not restore an old data backup over new user work without a separately reviewed recovery plan.

## Distribution and update

The builder writes `release-x64.json` / `release-arm64.json` with artifact hashes and honest signing/hardware flags. Runtime proof is recorded separately; compilation alone does not set it. Extract the entire portable ZIP, then run Nabat.Windows.exe. Keep data in the Windows profile when replacing binaries. The pilot uses manual updates; no automatic update server or fabricated download feed is provided.

A trusted MSIX release must use one approved publisher/certificate identity across upgrades and retain `NABAT.Operations`. Build/sign with the existing certificate thumbprint, verify trust and rehearse install, protocol launch, update, uninstall and retained-data policy on target hardware. No certificate was supplied or installed here. An unsigned package is not an install/trust proof.

The verification ledger records local/production evidence, artifact checks and external acceptance boundaries. GitHub CI and repository pushes are separate actions; this delivery does not infer that configured CI ran.
