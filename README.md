<a href="https://nabat-injaz.vercel.app/"><img src="docs/assets/cover.svg" width="100%" alt="NABAT 1.1 — ivory, botanical green and a living identity. My INJAZ business competition work." /></a>

<p align="center"><b>English</b> · <a href="README.zh-CN.md">简体中文</a></p>
<p align="center"><a href="https://nabat-injaz.vercel.app/"><b>EXPLORE NABAT ↗</b></a> · <a href="https://chefzc.dev/school-gallery.html#project-nabat">THE LIVING EXHIBITION ↗</a> · <a href="docs/OPERATIONS.md">OPERATIONS GUIDE</a> · <a href="https://chefzc.dev/post.html?article=nabat">FIELD NOTES ↗</a></p>

# NABAT · Every plant, known.

**My INJAZ business competition work.** A small NFC / QR tag connects a plant to its identity, observations, care and the history that follows. **1.1.0 / Operations / Pilot.** Mobile field care and a native Windows workspace share the same authorised plant record.

Ivory, deep botanical green, chlorophyll and saffron; editorial type and precise instruments. The plant stays at the centre, from the first tag to the next pair of caring hands.

## 01 / A living record

| Workspace                 | What it does                                                                                                                |
| :------------------------ | :-------------------------------------------------------------------------------------------------------------------------- |
| **Plant identity**        | Stable NFC / QR links, public-safe passports, replacement labels and history that follows the plant.                        |
| **Mobile field care**     | Photos, observations and care records; an already-open authenticated page can retain pending care during a connection loss. |
| **Native Windows**        | WinUI 3 Operations Home, Today / maintenance, virtualised plant explorer and independent profile windows.                   |
| **Evidence & comparison** | Linked image comparison, actual-time history and analysis provenance; unavailable evidence remains unavailable.             |
| **Places & people**       | Location plans, plant pins, reviewed batches, shared tasks, team capabilities and accountable handovers.                    |
| **Tag Studio**            | Printable QR designs and NFC programming simulation; hardware write/read-back is a separate verification step.              |
| **Continuity**            | Scoped SQLite cache and durable care outbox, with retries, receipts and explicit conflict review.                           |

<img src="docs/assets/operations-home.png" width="100%" alt="Actual NABAT 1.1 native Windows Operations Home, using the synthetic NABAT Demo Hotel workspace" />

<details><summary><b>Tag Studio / 标签工坊</b></summary>

<img src="docs/assets/tag-studio.png" width="100%" alt="Actual native NABAT Tag Studio with synthetic plant identities and printable tags" />

</details>

<details><summary><b>Observation comparison / 观察对照</b></summary>

<img src="docs/assets/compare.png" width="100%" alt="Actual native NABAT observation comparison, with synthetic records explicitly labelled" />

</details>

These are captures of the actual running WinUI XAML content, excluding the operating system window frame. Botanical images and demonstration observations are **synthetic**; they are not measured plant results. The cover is an editable brand illustration using the original NABAT specimen and type.

## 02 / Start a collection

The **[public website](https://nabat-injaz.vercel.app/)** introduces NABAT. Register or sign in to use a private plant workspace. Photos remain private; public passports disclose only the explicitly enabled identity fields.

For a local, isolated demonstration, use Node.js 22.23 or newer:

```powershell
npm ci
npm run dev:operations
```

Open **http://127.0.0.1:3001** and choose **Explore the demo**. The script isolates the synthetic local database, storage and analysis provider from cloud credentials. Saved demonstration interactions persist.

The existing native Windows builds are in `windows/artifacts/`. Extract the whole x64 portable folder, not only its EXE. `windows/Start-Nabat.ps1` starts the isolated server and native app; [native build and package instructions](docs/OPERATIONS_RELEASE.md) describe the self-contained x64 / ARM64 folders and unsigned MSIX packages. Public downloadable release assets will be added when the GitHub publication completes.

## 03 / Care with context

- Identity survives a label replacement and an authorised ownership handover.
- A photo or care event is saved separately from analysis availability. An unavailable external provider does not become an invented score.
- Longitudinal signals require comparable provider/model/contract, usable observations and declared viewpoint/lighting. Health scores are heuristic estimates, not calibrated biological measurements.
- Roles and capabilities protect each private workspace. Windows sessions use OS-bound credential storage; pending work remains scoped to its original actor and workspace.
- Local continuity covers recent cached records and care replay. Uncached originals, new imports and a fresh offline private-web launch are separate limitations.

The existing Workspace Agent integration is configured, but its last established external trigger failure was HTTP 409. This repository does not claim that subscribed inference availability has recovered. Physical NFC writing, trusted signed installation, physical printing and ARM64 execution remain unverified.

## 04 / Build and verify

Web / API: Next.js 16, React 19, TypeScript, PostgreSQL and private media storage. Native client: WinUI 3, Windows App SDK 2.5.1, .NET 10 and SQLite. One shared domain API keeps identities and care history connected.

```powershell
npm test
npm run typecheck
npm run lint
npm run contract:check
npm run build
```

On **2026.10.09**, the existing TypeScript domain suite passed **67 tests**. The [1.1 acceptance record](docs/qa/operations/VERIFICATION.md), dated October 4, separately records 25 C# tests, eight browser checks and published x64 native rendering, process restart and cloud care acknowledgement. Those recorded native checks are not a new physical-hardware certification.

[Architecture](docs/ARCHITECTURE.md) · [Operations](docs/OPERATIONS.md) · [Deployment](docs/DEPLOYMENT.md) · [Original V1 technical notes](docs/TECHNICAL-V1.md) · [Asset provenance](docs/design/ASSETS.md)

## 05 / The INJAZ collection

**Made by ChefZC for the INJAZ business competition.**

[School exhibit ↗](https://chefzc.dev/school-gallery.html#project-nabat) · [Now 029 ↗](https://chefzc.dev/now.html#milestone-nabat) · [Botanical field notes ↗](https://chefzc.dev/post.html?article=nabat)

**Small care. Lasting change. — ChefZC**
