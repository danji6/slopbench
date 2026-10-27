# Testing

Run the smallest set that exercises the behavior you changed:

```sh
bun test                           # Critical smoke checks
bun run tests integrations         # Feature coverage, including its smoke cases
bun run tests runtime -t 'claim'    # Filter a feature by test name
bun run test:all                   # All Bun tests, including smoke
bun run test:browser skills        # Only this feature's browser tests
bun run test:browser               # All Chromium and WebKit tests
bun run tests --help               # List available suites
```

`scripts/test.ts` is a thin dispatcher to native Bun and Playwright commands.
It discovers feature directories automatically; adding a suite needs no package
script. `bun run tests smoke`, `bun run tests all`, and `bun run tests browser`
also work. Full Bun runs use a fresh process per feature and stop on failure.
Native flags pass through to each selected suite, including during `all` runs.
Use separate output paths for per-suite reports to avoid overwriting them.
When filtering `all` by name, add `--pass-with-no-tests` to allow suites without
matches.

For one file, explicitly enable feature discovery (add `--isolate` for UI files):

```sh
bun test --path-ignore-patterns '**/browser/**' ./tests/features/integrations/configuration.test.ts
```

Bun combines positional file filters with **OR**, so appending a filename to a
feature command does not narrow it. Use the direct-file command above, or pass
`-t` to filter test names.

## Ownership

Tests belong to their primary feature, across client, backend, and sidecar code.
An import of another feature does not require its entire suite. Shared fixtures
live in `helpers/`, `setup/`, and `fixtures/`; browser fixtures stay in `browser/`.

| Suite           | Behavior                                                                 | Browser command              |
| --------------- | ------------------------------------------------------------------------ | ---------------------------- |
| `runtime`       | Streams, retries, history, tools, approvals, subagents, commands         | `test:browser runtime`       |
| `integrations`  | Manifest discovery, activation, credentials, linked context              | `test:browser integrations`  |
| `mcp`           | Protocol, transports, catalogs, brokers, durable operations              | `test:browser mcp`           |
| `skills`        | Skill libraries, imports, verification, agent homes, file transitions    | `test:browser skills`        |
| `shell`         | Command policy, terminal output, jobs, watchers, streaming               | —                            |
| `providers`     | Connections, model discovery, SDK request adaptation, cache usage        | `test:browser providers`     |
| `sessions`      | Agents, folders, search, message projections, navigation                 | `test:browser sessions`      |
| `editor`        | Markdown, completion, source editing, interpreter, evaluation workers    | `test:browser editor`        |
| `notifications` | Delivery, queues, approvals, service worker                              | `test:browser notifications` |
| `auth`          | Authentication, account security, origins, rate limits                   | `test:browser auth`          |
| `updates`       | Installation, upgrades, rollback, migration deployment, runtime bundling | —                            |
| `ui`            | Shared primitives, scrolling, appearance, reusable forms                 | `test:browser ui`            |
| `core`          | Shared path authorization, attachments, bounded reads, errors            | —                            |

Use `bun run tests <suite>` for every suite in the table. Each command selects only
its `features/<suite>/` directory and its existing `smoke/<suite>.test.ts`, if any.
Smoke cases have one owner and run once in `test:all`.

## Adding and maintaining tests

Follow the risk-based policy in [AGENTS.md](../AGENTS.md). Reuse or extend existing
cases before adding new ones. Keep distinct authorization, data integrity,
concurrency, lifecycle, and regression checks. Avoid tests that only freeze CSS,
copy, constants, or a library's behavior.

Default discovery excludes `features/` and `browser/`. Put new comprehensive
tests in their feature directory; new features do not automatically expand smoke.
The full command runs features in fresh Bun processes to avoid dependencies on
cross-feature module state. The UI suite also uses native file isolation for its
module mocks. Other suites preserve Bun 1.3's evaluator preload, which is not
compatible with reloading its WASM dependencies between isolated files. Keep DOM
setup scoped to files that need it; evaluator initialization remains unchanged.

Prefer readiness signals to fixed sleeps. Real process, HTTP, timer, and browser
checks remain useful when they exercise additional behavior. Keep them in the
appropriate opt-in suite, using local fixtures instead of deployment credentials.
The five existing REA conformance cases require `SLOPBENCH_REA_ROOT` pointing to
a local toolkit; otherwise they remain explicitly skipped.

## CI

PRs run smoke, lint, typecheck, and build. Manual CI dispatch selects a Bun suite
(`smoke`, a feature, or `all`) and can independently enable all browser tests.
Only browser runs install Chromium/WebKit dependencies. Tagged releases run
`test:all` before publishing.

For local browser runs, install the supported browsers and host dependencies with
`bun x playwright install --with-deps chromium webkit`. Browser flags pass through,
for example `bun run test:browser editor --project chromium --workers 2`.
