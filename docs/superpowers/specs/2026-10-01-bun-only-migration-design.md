# Bun-only migration — design

Date: 2026-10-01
Repo: Robbyfuu/claude-hud (fork of jarrodwatts/claude-hud, based on 0.8.0)

## Goal

Make the fork Bun-only: install, type-check, test, coverage, CI, release, runtime and docs all use Bun. Nobody runs `npm`, `npx` or Node to work on or use this fork.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Scope | Bun-only everywhere, Node support dropped | User choice. The fork's only consumer already runs `bun src/index.ts`. |
| Build | No build. Bun runs `src/*.ts` directly; `tsc` is used for type-checking only | Measured: `bun src/index.ts` 63 ms/run, `bun build` bundle 62 ms/run, `node dist/index.js` 162 ms/run. A bundle adds a build step and a versioned `dist/` for no speed gain. |
| Test runner | `bun test` running the existing `node:test` files (the `node:test` API is kept) | Measured: `bun test` already runs the current suite (1153 tests, 3.4 s); the failures are environmental (see Tests). No test rewrite: test files change only where needed (imports `../dist/` → `../src/`, node spawns → `process.execPath`, `build-output.test.js` removed, `setup-command.test.js` updated). |
| Coverage | `bun test --coverage` | Replaces `c8`. |
| Windows | Unsupported; WSL with the Linux instructions | User choice (Bun-only total). |
| Windows code in `src/` | Left untouched | Never runs on macOS/Linux; deleting it is an unrelated git refactor and the largest upstream-conflict source. Separate PR if wanted. |
| Bun version | `"packageManager": "bun@1.4.2"` in `package.json`, single source of truth | CI reads it; local dev is on 1.4.2. |

## Part 1 — Toolchain, tests and code

### `package.json`

| Field | Before | After |
|---|---|---|
| `main` | `dist/index.js` | `src/index.ts` |
| `files` | `dist/`, `src/`, `commands/`, `scripts/clean-dist.mjs`, `.claude-plugin/` | `src/`, `commands/`, `.claude-plugin/` |
| `scripts.build`, `scripts.dev` | `node scripts/clean-dist.mjs && tsc`, `tsc --watch` | removed |
| `scripts.typecheck` | — | `tsc --noEmit` run under Bun (`--bun`, so the `#!/usr/bin/env node` shebang of `tsc` is ignored). Exact invocation verified in the toolchain task; measured 0.08 s with `bun --bun node_modules/.bin/tsc`. |
| `scripts.test` | `npm run build && node --test` | `bun test` |
| `scripts.test:coverage` | `npm run build && c8 --reporter=text --reporter=lcov node --test` | `bun test --coverage --coverage-reporter=text --coverage-reporter=lcov` |
| `scripts.test:update-snapshots` | `UPDATE_SNAPSHOTS=1 npm test` | `UPDATE_SNAPSHOTS=1 bun test` |
| `scripts.test:stdin` | `npm run build && echo '…' \| node dist/index.js` | `echo '…' \| bun --env-file /dev/null src/index.ts` |
| `engines` | `{ "node": ">=18.0.0" }` | `{ "bun": ">=1.4.0" }` |
| `packageManager` | — | `bun@1.4.2` |
| `devDependencies` | `typescript`, `@types/node`, `c8` | `typescript`, `@types/bun` (pulls in the Node types) |

Lockfile: `package-lock.json` deleted, `bun.lock` added (text lockfile, committed).

Deleted: `dist/` (tracked files, `git rm -r`), `scripts/clean-dist.mjs`.

### `tsconfig.json`

Set `noEmit: true` and `types: ["bun"]`. Remove `outDir`, `declaration`, `declarationMap`, `sourceMap`. Keep `module`/`moduleResolution: NodeNext` (imports already use `.js` extensions; no churn). Drop `dist` from `exclude`.

### Tests

- All 34 test files that import `../dist/<x>.js` import `../src/<x>.js` instead. Bun resolves the `.js` specifier to the `.ts` file; this is verified in the tests task.
- `tests/integration.test.js` spawns `node dist/index.js` 12 times; those become `spawnSync(process.execPath, ["src/index.ts"], …)` so no test needs Node.
- `tests/build-output.test.js` asserts the compiled `dist/` output; it is deleted with `dist/`.
- `tests/setup-command.test.js` counts the `stty` snippet in `commands/setup.md` (3 today, 1 after the Windows/Node paths go) and gains a test that setup only offers Bun.
- Under `bun test` today (importing `dist/`): 1122 pass, 25 fail, 6 skip. The 25 failures and their fixes:
  1. **22 `countConfigs` / config-location tests**: Bun's `os.homedir()` reads `HOME` once at startup (measured: `HOME=/tmp/a bun -e "process.env.HOME='/tmp/changed'; os.homedir()"` → `/tmp/a`; Node → `/tmp/changed`). Tests set `process.env.HOME` at runtime. Fix: a `getHomeDir()` helper (named to avoid shadowing seven local `const homeDir` variables) in `src/claude-config-dir.ts` returning `process.env.HOME || os.homedir()`, replacing the 12 `os.homedir()` calls in `src/`. Same result in the real statusline.
  2. **`index entrypoint runs when executed directly`**: `src/index.ts:263` compares `process.argv[1]` with `import.meta.url`'s path. Fix: `if (import.meta.main) void main();`. The test runs `bun src/index.ts` as a real subprocess and asserts the same observable output it asserts today.
  3. **`loadConfig returns valid config structure`** (`tests/config.test.js:26`): the valid-layout list lacks `panel`. Add it.
  4. **`estimateSessionCost prices Claude 5 point releases like their base model`** (`tests/cost-coverage.test.js:165`): the test pins its clock to 2026-08-31 and failed only because Sonnet 5's introductory price ended 2026-09-01. Not a code bug; no change needed.
- Target: `bun test` with 0 failures.

## Part 2 — CI and plugin

### Workflows (`.github/workflows/`)

| File | Change |
|---|---|
| `ci.yml` | One job `test` on `ubuntu-latest`: `actions/checkout@v6` → `oven-sh/setup-bun@v2` with `bun-version-file: package.json` → `bun install --frozen-lockfile` → `bun run typecheck` → `bun run test:coverage`. Node 18/20 matrix and `windows-git` job removed. If `setup-bun` cannot read `packageManager`, pin `bun-version: 1.4.2` inline instead. |
| `build-dist.yml` | Deleted. |
| `release.yml` | Same Bun steps as CI (no separate build/test runs). Changelog extraction and `softprops/action-gh-release` unchanged. |
| `claude.yml` | Unchanged (no Node/npm). |

Also: `.github/dependabot.yml` `package-ecosystem: "npm"` → `"bun"`; `.github/pull_request_template.md` checklist → `bun test`, `bun run typecheck`.

### `commands/setup.md` (770 lines → ~400)

- Runtime: only `command -v bun`. If missing, stop and show the install command (`curl -fsSL https://bun.sh/install | bash`). No Node fallback.
- Generated command: always `bun --env-file /dev/null …/src/index.ts`. The `dist/index.js` branch is removed.
- Windows: PowerShell and Git Bash sections removed (ghost cleanup, backups, the ~150-line Node launcher). Replaced by one note: Windows is not supported; use WSL and follow the Linux instructions.
- `.claude-plugin/plugin.json` and `marketplace.json`: unchanged (no runtime references).

## Part 3 — Docs, upstream sync, rollout

### Docs

| File | Change |
|---|---|
| `README.md` | Requirements: Bun ≥ 1.4 on macOS/Linux, Windows via WSL. Remove the Windows Node.js LTS note (line 70). Development: `bun install && bun test`. |
| `README.zh.md` | Development commands and requirements only. |
| `CONTRIBUTING.md`, `TESTING.md`, `RELEASING.md`, `SUPPORT.md` | Commands and Node mentions → Bun. `TESTING.md` describes `bun test` and native coverage instead of `node --test` / `c8`. |
| `CLAUDE.md`, `CLAUDE.README.md` | Build commands → `bun install`, `bun run typecheck`, `bun test`, `echo '…' \| bun src/index.ts`. Runtime: Bun. New short "Upstream sync" section (below). |
| `.gitignore` | Remove `npm-debug.log*`; lockfile comment updated (`bun.lock` is committed). |
| `CHANGELOG.md` | `[Unreleased]` → `### Changed`: Bun-only toolchain and runtime. History untouched. |

### Upstream sync rule (documented in `CLAUDE.md`)

Merges from `jarrodwatts/claude-hud` will conflict in `package.json`, `package-lock.json`, `dist/`, the workflows and `commands/setup.md`. Resolution: keep ours for those files; take upstream for `src/`; rewrite `../dist/` → `../src/` in any new upstream test; re-run `bun install` to refresh `bun.lock`.

### Rollout on the user's machine

1. Worktree `quahog`: delete the npm-installed `node_modules`, run `bun install` (creates `bun.lock`).
2. Statusline: no change. `~/.claude/settings.json` already runs `bun --env-file /dev/null ~/Code/claude-hud/src/index.ts`, and the runtime has no dependencies; only `git pull` in `~/Code/claude-hud` after merge.
3. CI: on the PR, enable the fork's workflows with `gh workflow enable`. If GitHub requires the Actions-tab confirmation for forks, ask the user to click it.
4. Ruleset `protect-main`: once CI is green once, add the `test` check as required.

## Out of scope

- Removing Windows-specific code from `src/`.
- The pricing test `cost-coverage.test.js:165` (the test pins its clock to 2026-08-31 and failed only because Sonnet 5's introductory price ended 2026-09-01).
- Translating `README.zh.md` beyond commands and requirements.

## Done criteria

1. `bun install --frozen-lockfile` leaves the tree unchanged.
2. `bun run typecheck` reports 0 errors.
3. `bun test` has 0 failures.
4. `grep -rnE '\bnpm\b|\bnpx\b|node --test|node dist'` over the repo (excluding `node_modules`, `.git`, `.serena`, `docs/superpowers/` and `CHANGELOG.md` history) returns nothing.
5. The user's real `statusLine` command renders the panel after `git pull` in `~/Code/claude-hud`.
6. CI is green on the PR.

## Implementation tasks (for the plan)

1. Toolchain: `package.json`, `tsconfig.json`, `bun.lock`, delete `package-lock.json`, `dist/`, `scripts/clean-dist.mjs`.
2. Tests and code: `../dist/` → `../src/`, `getHomeDir()` helper, `import.meta.main`, `panel` in config test.
3. CI: workflows, dependabot, PR template.
4. Plugin: `commands/setup.md`.
5. Docs.

Every implementation brief must state: use Bun only, never `npm`, `npx`, `pnpm`, `yarn` or `node`.
