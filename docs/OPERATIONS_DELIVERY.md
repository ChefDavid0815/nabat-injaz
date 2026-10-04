# NABAT 1.1 delivery

- Web / shared cloud API: https://nabat-injaz.vercel.app (READY deployment dpl_GprRJGQekMn1oqpcA8QHjg4MDkE6).
- Run now: `windows/artifacts/x64/app/Nabat.Windows.exe`, or extract the entire x64 portable ZIP.
- Packages: `windows/artifacts/NABAT-1.1.0-x64-portable.zip`, `NABAT-1.1.0-arm64-portable.zip`, and each architecture's `-unsigned.msix`.
- Hash/structure checks: `docs/qa/operations/release-artifacts.json` and `windows/artifacts/release-x64.json` / `release-arm64.json`.
- Architecture: `docs/OPERATIONS.md`; release/update/rollback: `docs/OPERATIONS_RELEASE.md`; exact verification: `docs/qa/operations/VERIFICATION.md`.

67 TypeScript tests, 25 C# tests and 8 browser E2E checks passed, alongside type/lint/format/contract/build checks. The published x64 EXE passed native rendering, true process restart and SQLite-to-cloud care acknowledgement. The missing WinUI publish resource issue was repaired at the MSBuild publish target; ZIP/MSIX checks require App.xbf, MainWindow.xbf and Nabat.Windows.pri.

The 1.0 identity/photos/Agent configuration is retained. No additional model calls/credits were enabled for cloud release validation. Physical NFC, signing/trusted MSIX installation, physical printing and ARM64 execution remain unverified. Existing external Workspace Agent HTTP 409 is an independent availability limitation.
