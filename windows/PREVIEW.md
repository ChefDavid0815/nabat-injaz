# NABAT 1.1 — Operations

This is the 1.1.0 pilot software build. Open **Nabat.Windows.exe** from the fully extracted portable folder. Its WinUI 3 interface and .NET runtime are included; a .NET SDK is not required to run the published app.

For the local demonstration, run `npm run dev:operations` from the source repository, then choose **Open local demo**. `windows/Start-Nabat.ps1` starts the local server and opens the x64 app. All demo plants, observation signals and floor plans are synthetic. The server deliberately isolates cloud database, storage and model credentials.

To connect to NABAT cloud, use its permanent HTTPS origin and the same existing NABAT account. The shared 1.1 API and migrations **010–013** are deployed at **https://nabat-injaz.vercel.app**. Cloud release checks verified native bearer sign-in, shared snapshots, captured care replay, maintenance progress and private-workspace denial. Existing 1.0 plant identities, photos and Workspace Agent settings were preserved.

Home, Today/Maintenance, virtualized Plant Explorer, independent profiles, comparison, floor plans, analytics/reports, team operations, photo Import Review and Tag Studio are available. Explorer supports server paging/sorting, Ctrl/Shift selection, grouping, named views, column layout and reviewed bulk actions. Care is saved to SQLite before cloud replay; pending records survive a process restart. Settings exposes retry and export for records requiring review. Photos/imports, state-changing batches, maps and new sessions require a connection.

Use Ctrl+K for commands, Ctrl+N for a plant, Ctrl+F for Explorer, Ctrl+Shift+T for Today, Ctrl+Shift+A for Alerts and Ctrl+, for Settings. Main and supported child window contexts are restored. Tray residency and Windows notifications are opt-in.

The **MSIX is unsigned** because no signing certificate was supplied. It is a valid packaging artifact, not a trusted-installation proof. No certificate was installed and no security setting was changed. The portable executable is the immediate local run path. ARM64 was compiled/packaged; ARM64 execution was not tested on this x64 computer. Updates in this pilot use a freshly extracted portable folder or a future consistently signed MSIX; local data is stored separately in the Windows profile.

The NFC simulator encodes an NDEF URL, reads it back and records an explicitly simulated programming event. The PC/SC adapter targets ACR122U-compatible commands and writable NFC Forum Type 2 tags; **no physical readers or tags were tested**. Physical programming requires an active identity and reachable HTTPS resolver. Simulated success never claims an RF write or phone tap.

SVG/PNG tag and A4 exports are available. Print/PDF uses the Windows print workflow. Physical printer output, installed protocol activation, trusted upgrade/uninstall and actual system notification delivery remain external acceptance steps. Arabic navigation/actions and RTL layout are present; provider/user text and some technical metadata remain in their source language. High-contrast mappings are implemented; OS-wide contrast and maximum text scale need device acceptance.

The existing Workspace Agent configuration is preserved. Its last verified production trigger returned an external HTTP 409 availability rejection; synthetic local analysis is not evidence that cloud AI has recovered.

See `docs/OPERATIONS.md`, `docs/OPERATIONS_RELEASE.md` and `docs/qa/operations/VERIFICATION.md` in the source repository for architecture, release steps and exact evidence boundaries.
