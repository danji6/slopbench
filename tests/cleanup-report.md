# Test cleanup verification

Local measurements use pinned Bun 1.3.14. These are single-run observations, not runtime budgets.

| Run                | Before                                | After                                 |
| ------------------ | ------------------------------------- | ------------------------------------- |
| Default `bun test` | 2,972 cases / 312 files / 363.64 s    | 21 cases / 4 files / 0.156 s          |
| All Bun coverage   | 2,966 pass, 5 skip, 1 fail / 363.64 s | 2,954 pass, 5 skip, 0 fail / 288.44 s |
| Browser inventory  | 195 cases per browser / 28 specs      | 194 cases per browser / 29 specs      |

The complete Bun run is about 20.7% faster. Responsibility splits increase the file count to 333 while default discovery includes only four smoke files. No retained Bun file is orphaned or run twice.

## Per-feature inventory and timings

Case times sum the timings printed for individual cases, excluding setup/teardown outside cases. Command elapsed times include that overhead. Before columns apply the new ownership mapping to the original monolithic run.

| Feature         | Files before → after | Cases before → after | Case seconds before → after | New command seconds |
| --------------- | -------------------: | -------------------: | --------------------------: | ------------------: |
| `runtime`       |              74 → 90 |            749 → 743 |               0.647 → 0.745 |               1.197 |
| `integrations`  |              11 → 12 |              66 → 66 |               7.308 → 5.898 |               6.130 |
| `mcp`           |              32 → 33 |            158 → 158 |           293.175 → 216.203 |             216.480 |
| `skills`        |              24 → 24 |            158 → 158 |               3.439 → 2.904 |               3.350 |
| `shell`         |              19 → 24 |            428 → 425 |             46.062 → 45.522 |              46.090 |
| `providers`     |              13 → 13 |              94 → 92 |               2.222 → 2.318 |               2.620 |
| `sessions`      |              40 → 42 |            394 → 394 |               0.871 → 0.919 |               1.433 |
| `editor`        |              42 → 40 |            587 → 584 |               3.599 → 4.036 |               5.170 |
| `notifications` |                6 → 6 |              48 → 48 |               0.029 → 0.032 |               0.145 |
| `auth`          |                8 → 8 |              57 → 57 |               1.067 → 0.986 |               1.700 |
| `updates`       |               10 → 9 |              56 → 55 |               0.182 → 0.148 |               0.201 |
| `ui`            |              22 → 22 |              89 → 95 |               1.199 → 0.593 |               2.470 |
| `core`          |              11 → 10 |              88 → 84 |               0.844 → 0.829 |               1.141 |

## Pruning and consolidation

- Removed 18 low-value/redundant Bun cases: the frozen migration constants/empty registry (1), cap-error wording/formatting (4), token-tooltip formatting (2), exact CSS/HTML rendering (2), repeated sanitizer output equality (1), JSON wrapper round-trips (2), overlapping file-link history scenarios (3), and basic command/stdin/job-ID checks covered by stronger shell scenarios (3).
- Combined two stream-error tracking checks into one that verifies both error collection and unchanged output through the same pipeline, using shared finite-stream fixtures.
- Strengthened the remaining history scenarios to verify snapshots and unavailable placeholders with and without a workspace, preserving prose and asserting that history never rereads the filesystem.
- Replaced the code-appearance subprocess/pass-count wrapper with its seven existing UI tests. This exposes six previously hidden cases in the top-level count; it adds no new behavior coverage. Together with pruning/consolidation, reported Bun cases fall from 2,972 to 2,959.
- Removed the browser assertion for a chevron SVG's exact vertical position (one case in each browser), plus stale help-copy/CSS assertions inside retained interaction tests.
- Split stream, subagent, history, shell, provider, integration, session-duplication, catalog, and skill-folder groups by responsibility; extracted their fixtures without duplicating cases.
- Removed the throwaway launch/disconnect from backend MCP fixture setup. Tests still exercise real persistent connections and production shutdown/timeout behavior.
- Replaced fixed shell-startup/output sleeps with readiness checks. Retained waits that observe real terminal/process behavior and cancellation cleanup.

## Verification

- Both native `bun test` and `bun run test` discover only the same 21 smoke cases.
- All 13 feature commands ran a selected case successfully with only their own directory and smoke file in discovery. Direct-file invocation was also checked.
- An intentionally failing temporary feature test left smoke passing, failed its feature command, and stopped `test:all` before the next feature. The probe was removed.
- Full Bun logs match all 333 retained files exactly once. The five REA conformance skips are pre-existing and require `SLOPBENCH_REA_ROOT`.
- Native per-feature processes preserve the existing QuickJS preload on Bun 1.3.14; only UI uses file isolation for module mocks. The baseline bundling check failed in the monolith but now passes in the updates suite.
- Chromium: 188 passed in the initial full run; the six failures were stale labels/copy and a trigger auto-scroll race, all repaired and passed in a focused run. All 15 skills cases passed again after splitting folder coverage. All 194 retained Chromium cases are verified.
- All ten browser feature commands were checked for correct discovery. WebKit launch is blocked by missing host shared libraries on this Arch-based machine; its 194 cases remain configured for explicit runs on a supported host.
- CI/manual suite choices and the full Bun release gate use the shared dispatcher. Lint, typecheck, and production build pass. No production code, dependencies, or production timeout constants changed.

## Command simplification

Feature aliases now use `bun run tests <feature>` and
`bun run test:browser <feature>`. The dispatcher discovers directories and forwards
native flags, preserving fresh feature processes, UI isolation, smoke ownership,
and failure exit codes. Package scripts remain constant as suites are added.

On Bun 1.3.14, a filtered `test:all` invocation reached all 333 retained files once;
all ten browser feature selectors were checked using Playwright discovery. A
temporary failing case confirmed feature failure propagation, immediate full-run
failure, and unchanged default smoke discovery. The probe was removed. Runtime
filtering, full UI/integrations suites, lint, typecheck, and formatting also pass.
The full behavior and browser measurements above precede this command-only change.
