# Bun-only Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the claude-hud fork Bun-only: no build, no `dist/`, no Node, no npm.

**Architecture:** Bun runs `src/*.ts` directly. `tsc` runs only as a type-checker under Bun. The existing `node:test` suite runs under `bun test` and imports `src/` instead of `dist/`.

**Tech Stack:** Bun 1.4.2, TypeScript 7 (`tsc --noEmit`), `bun test` with `node:test` / `node:assert`, GitHub Actions with `oven-sh/setup-bun@v2`.

**Spec:** `docs/superpowers/specs/2026-10-01-bun-only-migration-design.md`

## Global Constraints

- Never run `npm`, `npx`, `pnpm`, `yarn` or `node`. Use `bun install`, `bun run <script>`, `bun test`, `bunx --bun <bin>`.
- Bun version: `"packageManager": "bun@1.4.2"`; `"engines": { "bun": ">=1.4.0" }`.
- Work only in `/Users/roberto/orca/workspaces/claude-hud/quahog` (branch `Robbyfuu/quahog`). Never touch `~/.claude/settings.json`, `~/.claude/plugins/claude-hud/config.json` or `~/Code/claude-hud`.
- Code, comments, docs and commit messages in English. Commit format `type(scope): what and why`. No `Co-Authored-By` lines.
- Windows-specific code in `src/` (`windows-git-worker.ts`, `win32` branches) stays untouched.
- Known failure that must stay as is: `estimateSessionCost prices Claude 5 point releases like their base model` (`tests/cost-coverage.test.js:165`).

## Review Focus

1. **A machine without Node** (CI runner set up only with Bun): no test may spawn `node`; anything spawned uses `process.execPath`. Task 2 replaces the 12 `spawnSync("node", ["dist/index.js"], …)` calls; Task 5's grep check catches leftovers.
2. **`HOME` unset or empty**: `homeDir()` must fall back to `os.homedir()`, not return `""`. Task 2 adds `homeDir falls back to os.homedir() when HOME is empty`.
3. **Importing `src/index.ts` must not run `main()`**: `import.meta.main` is false on import. The ~35 tests in `tests/index.test.js` that import `main` would hang or double-render otherwise; Task 2 runs that file on its own.
4. **Lockfile drift**: CI uses `bun install --frozen-lockfile`. Task 1 checks that it leaves the tree clean.
5. **Old statusline commands pointing at `dist/index.js`** break after this change. Task 5's CHANGELOG entry says to re-run `/claude-hud:setup`.

---

### Task 1: Toolchain on Bun

**Files:**
- Modify: `package.json`, `tsconfig.json`
- Create: `bun.lock` (generated)
- Delete: `package-lock.json`, `scripts/clean-dist.mjs`, `node_modules/` (regenerated)

**Interfaces:**
- Produces: scripts `typecheck`, `test`, `test:coverage`, `test:update-snapshots`, `test:stdin` (used by Tasks 2–5 and CI).

- [ ] **Step 1: Record the baseline.** Run `bun test 2>&1 | tail -4`. Expected: `1122 pass`, `6 skip`, `25 fail`.
- [ ] **Step 2: Edit `package.json`** exactly per the spec table "Part 1 — `package.json`": `main: "src/index.ts"`, `files: ["src/", "commands/", ".claude-plugin/"]`, remove `build` and `dev`, add `typecheck`, rewrite `test`, `test:coverage`, `test:update-snapshots`, `test:stdin` (keep its JSON payload byte-for-byte, pipe into `bun --env-file /dev/null src/index.ts`), `engines` and `packageManager` per Global Constraints, `devDependencies`: `typescript` (keep `^7.0.2`) and `@types/bun`; remove `@types/node` and `c8`.
  - `typecheck` must run tsc under Bun so its `#!/usr/bin/env node` shebang is ignored. Try `bunx --bun tsc --noEmit` first; if it does not resolve the local binary, use `bun --bun node_modules/.bin/tsc --noEmit`.
- [ ] **Step 3: Edit `tsconfig.json`**: add `"noEmit": true`, set `"types": ["bun"]`, remove `outDir`, `declaration`, `declarationMap`, `sourceMap`, and remove `"dist"` from `exclude`. Keep `module`/`moduleResolution: "NodeNext"`.
- [ ] **Step 4: Reinstall with Bun.** `rm -rf node_modules package-lock.json scripts/clean-dist.mjs && bun install`. Expected: `bun.lock` created, `@types/bun` installed.
- [ ] **Step 5: Verify.**
  - `bun run typecheck` → exit 0, no output.
  - `bun install --frozen-lockfile && git status --short bun.lock` → no change to `bun.lock`.
  - `bun test 2>&1 | tail -4` → same counts as Step 1 (the tests still import the committed `dist/`).
- [ ] **Step 6: Commit.** `git add -A package.json package-lock.json tsconfig.json bun.lock scripts/clean-dist.mjs && git commit -m "build: switch toolchain to Bun (bun.lock, bun test, tsc --noEmit)"`

### Task 2: Tests and code run from `src/`

**Files:**
- Modify: `src/claude-config-dir.ts`, `src/index.ts:263-275`, the 12 `os.homedir()` call sites (`src/daily-cost.ts:51`, `src/speed-tracker.ts:41`, `src/transcript.ts:449,472`, `src/subagents.ts:367`, `src/config.ts:421,435`, `src/version.ts:237`, `src/config-reader.ts:376,494`, `src/context-cache.ts:51`, `src/auth.ts:224`)
- Modify: every `tests/*.test.js` importing `../dist/`, `tests/integration.test.js` (12 `spawnSync("node", ["dist/index.js"], …)`), `tests/index.test.js:160-185`, `tests/config.test.js:33`, `tests/core.test.js` (new `homeDir` test)
- Delete: `dist/` (`git rm -r dist`), `tests/build-output.test.js` (it asserts compiled output that no longer exists)

**Interfaces:**
- Consumes: `bun test` from Task 1.
- Produces: `export function homeDir(): string` in `src/claude-config-dir.ts`.

- [ ] **Step 1: Point tests at `src/`.** Replace `../dist/` with `../src/` in all test imports (keep the `.js` specifiers; Bun resolves them to `.ts`). In `tests/integration.test.js` replace `spawnSync("node", ["dist/index.js"], …)` with `spawnSync(process.execPath, ["src/index.ts"], …)` (12 sites; keep options unchanged). `git rm -r dist tests/build-output.test.js`.
- [ ] **Step 2: Run to see the red.** `bun test 2>&1 | grep -E "^\(fail\)" | sort -u`. Expected: the 22 `countConfigs` / `Issue #3` failures, `index entrypoint runs when executed directly`, `loadConfig returns valid config structure`, and the cost failure. Any other failure is caused by Step 1; fix it before continuing.
- [ ] **Step 3: Write failing test** `homeDir falls back to os.homedir() when HOME is empty` in `tests/core.test.js`: with `process.env.HOME = ''`, `homeDir()` equals `os.homedir()`; with `process.env.HOME = '/tmp/hud-home'`, it equals `'/tmp/hud-home'`. Restore `HOME` in `finally`. Run `bun test tests/core.test.js -t "homeDir falls back"` → FAIL (`homeDir` not exported).
- [ ] **Step 4: Implement `homeDir(): string`** in `src/claude-config-dir.ts` as `process.env.HOME || os.homedir()`, with a one-line comment that Bun's `os.homedir()` caches `HOME` at startup. Replace the 12 call sites (keep each module's existing local `homeDir`/dependency names; only the call changes). Run `bun test tests/core.test.js tests/config.test.js` → the 22 HOME failures and the new test pass.
- [ ] **Step 5: Entrypoint test first.** Rewrite `index entrypoint runs when executed directly` in `tests/index.test.js` to run `spawnSync(process.execPath, ["src/index.ts"], { env: { ...process.env, CLAUDE_CONFIG_DIR: dir }, input: "" , encoding: "utf8" })` from the temp config dir it already creates, and assert `stdout` includes `[claude-hud] Initializing...`. Run `bun test tests/index.test.js -t "entrypoint"` → confirm the result. If it already passes with the old `argv` check, still do Step 6: the `argv` comparison is what the spec replaces.
- [ ] **Step 6: Implement** `if (import.meta.main) { void main(); }` in place of `src/index.ts:263-275`; remove the now-unused `scriptPath`, `argvPath`, `isSamePath` and their imports if nothing else uses them. Run `bun test tests/index.test.js` → all pass (also confirms importing `main` does not auto-run it).
- [ ] **Step 7: Config test.** In `tests/config.test.js:33` add `'panel'` to `validLineLayouts`. Run `bun test tests/config.test.js` → pass.
- [ ] **Step 8: Verify.** `bun run typecheck` → exit 0. `bun test 2>&1 | tail -4` → exactly 1 fail (the cost test).
- [ ] **Step 9: Commit** in two commits: `git commit -m "test: run the suite from src/ under bun test"` (test imports, integration spawn, build-output test, `dist/` removal), then `git commit -m "fix: read HOME at call time and detect the entrypoint with import.meta.main"` (src changes + their tests).

### Task 3: CI on Bun

**Files:**
- Modify: `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `.github/dependabot.yml`, `.github/pull_request_template.md`
- Delete: `.github/workflows/build-dist.yml`

**Interfaces:**
- Consumes: scripts `typecheck`, `test:coverage` from Task 1.
- Produces: CI job id `test` (the required check added to the ruleset after merge).

- [ ] **Step 1: `ci.yml`**: keep `on:` as is; one job `test` on `ubuntu-latest` with steps `actions/checkout@v6`, `oven-sh/setup-bun@v2` (`with: bun-version-file: package.json`), `bun install --frozen-lockfile`, `bun run typecheck`, `bun run test:coverage`. Remove the Node matrix and the `windows-git` job. Check the `setup-bun` docs (Context7 or its README) that `bun-version-file: package.json` reads `packageManager`; if not, use `bun-version: 1.4.2`.
- [ ] **Step 2: `release.yml`**: replace the `setup-node` + four `npm` steps with the same setup-bun, install, typecheck and `test:coverage` steps. Leave the changelog extraction and release steps unchanged.
- [ ] **Step 3:** delete `build-dist.yml`; `dependabot.yml` `package-ecosystem: "bun"`; PR template checklist `bun test` and `bun run typecheck`.
- [ ] **Step 4: Verify** each YAML parses: `for f in .github/workflows/*.yml .github/dependabot.yml; do bun -e "Bun.YAML.parse(await Bun.file('$f').text())" && echo "ok $f"; done` → one `ok` per file. `grep -rnE "npm|node-version|setup-node" .github` → nothing.
- [ ] **Step 5: Commit.** `git commit -m "ci: run CI and releases on Bun; drop the dist build workflow"`

### Task 4: Plugin setup is Bun-only

**Files:**
- Modify: `commands/setup.md`, `tests/setup-command.test.js`

**Interfaces:**
- Consumes: runtime entry `src/index.ts` (Task 2).

- [ ] **Step 1: Write failing tests** in `tests/setup-command.test.js`: change the expected count of `stty size 2>/dev/null </dev/tty` from `3` to `1` (only the Bun macOS/Linux command remains); add `setup only offers the Bun runtime` asserting `setup` does not match `/command -v node/`, `/dist\/index\.js/` or `/PowerShell/`, and matches `/command -v bun/` and `/WSL/`.
- [ ] **Step 2: Run** `bun test tests/setup-command.test.js` → FAIL (count is 3; node/dist/PowerShell present).
- [ ] **Step 3: Edit `commands/setup.md`** per spec "Part 2 — `commands/setup.md`": runtime detection is only `command -v bun`, stopping with `curl -fsSL https://bun.sh/install | bash` when missing; the generated command is always the current Bun form at line ~180 (`--env-file /dev/null` + `src/index.ts`); remove the Node command (~185), the `dist/index.js` branch, and every Windows/PowerShell/Git Bash section (Step 0 Windows checks and cleanup, Step 1 Windows + Git Bash and Windows + PowerShell including the Node launcher, Step 2.5 Windows blocks, Windows troubleshooting). Add one note in Step 1: Windows is not supported; use WSL and follow the Linux instructions. Keep step numbering and all macOS/Linux content intact.
- [ ] **Step 4: Run** `bun test tests/setup-command.test.js` → PASS. `wc -l commands/setup.md` → roughly 400.
- [ ] **Step 5: Commit.** `git commit -m "feat(setup): require Bun and drop the Node and Windows setup paths"`

### Task 5: Docs and final checks

**Files:**
- Modify: `README.md`, `README.zh.md`, `CONTRIBUTING.md`, `TESTING.md`, `RELEASING.md`, `SUPPORT.md`, `CLAUDE.md`, `CLAUDE.README.md`, `.gitignore`, `CHANGELOG.md`

**Interfaces:**
- Consumes: script names from Task 1; CI job from Task 3.

- [ ] **Step 1: Edit docs** per spec "Part 3 — Docs" table. `CLAUDE.md` gets the Bun build commands, `Runtime: Bun 1.4+` under Dependencies, the file-structure line for `src/index.ts`, and a new `## Upstream sync` section with the spec's resolution rule verbatim. `CHANGELOG.md` `[Unreleased]` gains `### Changed` with: `Bun-only toolchain and runtime: no dist/ build, tests run with bun test, setup requires Bun (Windows via WSL). Statusline commands that point at dist/index.js must re-run /claude-hud:setup.` `.gitignore`: remove `npm-debug.log*` and update the lockfile comment.
- [ ] **Step 2: Verify docs-backed tests.** `bun test tests/readme-options.test.js` → pass.
- [ ] **Step 3: Final grep (spec done criterion 4).** `grep -rnE '\bnpm\b|\bnpx\b|node --test|node dist' . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.serena --exclude-dir=docs --exclude=CHANGELOG.md` → no output. Also `git grep -n "dist/" -- src tests commands` → no references to the removed build output.
- [ ] **Step 4: Full verification.** `bun install --frozen-lockfile` (tree unchanged), `bun run typecheck` (exit 0), `bun test 2>&1 | tail -4` (exactly 1 fail: the cost test).
- [ ] **Step 5: Commit.** `git commit -m "docs: document the Bun-only toolchain and upstream sync rule"`

### Task 6: Rollout (architect only, not delegated)

- [ ] Push `Robbyfuu/quahog`, open the PR against `main`, run `gh workflow enable ci.yml --repo Robbyfuu/claude-hud`; if the fork still needs the Actions-tab confirmation, ask the user.
- [ ] CI job `test` green on the PR; merge only after the user says so.
- [ ] `cd ~/Code/claude-hud && git pull`; run the user's real `statusLine` command with a sample payload → panel renders.
- [ ] Add `test` as a required status check to ruleset `protect-main` (id `24280425`) and read the rules back.
