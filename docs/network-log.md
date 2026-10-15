# Network-library log (host side)

The Engine writes a network-library log (iroh and noq-proto structured events) that is
independent of the business log: own configuration, queue, directory, budget, state, control
and export source. Upgrading the Engine alone does not turn it on. The host must configure it
before the process subscriber is installed.

## Coverage boundary

Only structured events from the reviewed iroh 1.3.0 and noq-proto 1.3.0 call sites are covered.
Events from the `log` crate (noq-udp), quinn, raw qlog and TLS key logs are not collected. A
missing file or a zero counter is therefore not proof that no packet arrived. There is no
pre-hello correlation between the two ends of a pairing.

## Configuration order

`NetworkLogHost.configureBeforeInstall` (iOS) and `NetworkLogHost.configureBeforeInstall`
(Android) run immediately before `installProcessObservability` in every process that hosts an
Engine. Their outcome is recorded separately and only affects the network status:

| Process | Role |
| --- | --- |
| iOS main app | `mobile_app` |
| iOS keyboard extension (`ExtensionP2pClient`) | `keyboard_extension` |
| Android process whose Engine was started by the JS runtime or its diagnostics | `mobile_app` |
| Android process whose Engine was started natively (service recovery, boot) | `background_service` |

The iOS share extension hands off through the App Group and does not host an Engine, so it has
no role. On Android the first install fixes the role of the process; later starts keep the first
configuration (`AlreadyInstalled` is not an error).

## Budgets are not a product default yet

The Engine has no default budget. A release build currently passes none, so the Engine reports
`NotConfigured`. Debug builds use fixed test parameters (8 KiB per record, 1,024 queued records,
4 MiB per file, 16 MiB per run, 64 MiB for the root, 7 days). They are test values, not a product
commitment. Choosing the release values is a product decision; the only place to change is
`NetworkLogHost.budget` on each platform.

## JS API

`uc-engine` exposes `getNetworkLogStatus`, `startNetworkLogCapture`, `stopNetworkLogCapture`,
`prepareNetworkLogExport` and `releaseNetworkLogExport`. Each returns `{ ok: true, value }` or
`{ ok: false, error, configuration }`; `notConfigured`, `notInstalled` and `unsupported` stay
distinct and are never reported as zero events. Native bodies run off the UI thread.

## Diagnostic package

The package gets its own `logs/network/<role>/<run>/` entries and a `collection.networkLogs`
manifest section.

- Only the exporting process is flushed (`flushScope: currentProcessOnly`,
  `otherProcessesFlushed: false`). The keyboard extension is never woken for logs; its earlier
  runs are listed when their files exist.
- Native code stages an allowlist of files (`run.json`, `network.<date>.<seq>.jsonl`) into a
  private temporary directory and hashes the copy. `lease.lock`, `.cleanup.lock`, links and any
  other file are skipped and counted, never exported.
- Each file records the staged size and SHA-256 and an `engineCheck` against the Engine's flush
  report: `exact`, `appendedAfterSnapshot` (the live writer added bytes), `mismatch` or
  `notReported`.
- Files are copied byte for byte. They are not passed through the app log redaction, because the
  Engine filters at the source and rewriting would invalidate the listed hash.
- A failed flush, an unreadable file or a `mismatch` marks the section `partial` and adds the
  `networkLogsIncomplete` warning. `notConfigured` and `unsupported` are states, not failures.

## Retention

The log root is `<private data>/logs/network` (iOS `<AppGroup>/p2p/data/logs/network`, Android
`filesDir/uc-engine/logs/network`). The app-log cleaners, cache clearing and the clipboard share
cache do not touch it. The Engine owns its retention and garbage collection.
