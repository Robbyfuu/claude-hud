# Upstream sync to 0.9.0 and the post-0.9.0 refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the fork to upstream 0.9.0 (PR A) and then onto upstream's refactored architecture (PR B) without changing what the user's `panel` statusline shows, except for differences the user approves.

**Architecture:** Stage 0 freezes today's panel output in end-to-end golden fixtures. Stage 1 is an ordinary `git merge d46bbd7`. Stage 2 is `git merge upstream/main` resolved mechanically (take upstream `src/`/`tests/`), followed by one atomic commit per ported fork feature. Fork-only behavior is tested in fork-only test files, so future upstream merges do not conflict on tests.

**Tech Stack:** Bun 1.4.2 (runtime, `bun test`, `bunx --bun tsc --noEmit`), TypeScript 7 type-check only, `node:test` API in test files.

**Spec:** `docs/superpowers/specs/2026-10-01-upstream-sync-0.9-design.md`

## Global Constraints

- Worktree: `/Users/roberto/orca/workspaces/claude-hud/quahog`, branch `Robbyfuu/quahog`. Remote `upstream` = jarrodwatts/claude-hud (already fetched); `origin` = Robbyfuu/claude-hud.
- Bun only: `bun`, `bunx`, `bun test`. Never `npm`, `npx`, `node`.
- Commands: type-check `bun run typecheck`; tests `bun test`; one file `bun test tests/<file>`; snapshots `UPDATE_SNAPSHOTS=1 bun test tests/<file>`.
- Tests keep the `node:test` / `node:assert/strict` API and import source as `../src/<x>.js`. No test imports `../dist/`. Spawned processes use `process.execPath` with `src/index.ts`.
- In `src/`, `os.homedir()` is called only inside `getHomeDir()` in `src/claude-config-dir.ts`. Every other home lookup calls `getHomeDir()`.
- The entrypoint is `if (import.meta.main) void main();` in `src/index.ts`.
- `dist/`, `package-lock.json`, `scripts/clean-dist.mjs`, `scripts/setup.mjs`, `scripts/statusline.mjs` stay deleted. `package.json`, `bun.lock`, `.github/workflows/**`, `commands/setup.md` keep the fork's version.
- Panel config: `panel.icons` ∈ `'nerd' | 'none'` (default `'none'`); `panel.maxAgents` floored, clamped to [1, 20] (default 5); `panel.completedRetentionSeconds` floored, clamped to [0, 86400] (default 120).
- Code, identifiers, comments, docs and commit messages in English. Conventional commit format (`fix(scope): what and why`). No `Co-Authored-By` trailer.
- Never regenerate a golden `expected.txt` to make a failing comparison pass, except the first capture in Task 1 and differences the user approved in Task 10.
- Never push, open a PR, or touch `~/Code/claude-hud` without explicit user confirmation in the conversation.

## Review Focus

1. **Wide characters inside boxes.** The width engine changes from the fork's `width.ts` to upstream's `ansi.ts`. A CJK project name must not break box borders: every panel line has the same width. → Task 1 asserts this for every case, and the `cjk` case covers it.
2. **Fresh session.** With `lineLayout: "panel"` and a transcript file that does not exist yet, the boxes render with no agents and nothing crashes. → Task 1, case `no-transcript`.
3. **Unknown terminal width.** With `COLUMNS` unset and stdout not a TTY, the panel renders at the 120-column default, which makes it 116 wide. → Task 1, case `unknown-width`.
4. **Subagent files written mid-flight.** A truncated last JSONL line or an invalid `meta.json` must not crash the render or drop the other agents' details. → Task 8, test `readSubagentDetails tolerates a truncated transcript line and an invalid meta file`.
5. **Spanish at narrow width.** Longer translated labels are truncated and the borders stay intact. → Task 1, case `narrow-es`.

---

### Task 1: Panel golden fixtures (Stage 0, on today's code)

**Files:**
- Create: `tests/panel-golden.test.js`
- Create: `tests/panel-golden/cases.mjs`, `tests/panel-golden/expected.txt` (generated), `tests/panel-golden/freeze-time.mjs`
- Create: `tests/panel-golden/golden-session.jsonl`, `tests/panel-golden/subagents/agent-a1.jsonl`, `tests/panel-golden/subagents/agent-a1.meta.json`, `tests/panel-golden/subagents/agent-t1.jsonl`, `tests/panel-golden/subagents/agent-t1.meta.json`, `tests/panel-golden/agents/nestjs-developer.md`

**Interfaces:**
- Produces: `bun test tests/panel-golden.test.js`, which every later task runs as the fidelity gate. Case names are the 10 below and must not change after this task.

- [ ] **Step 1: Write the fixtures**

  `freeze-time.mjs`: byte-identical copy of `git show upstream/main:tests/golden/freeze-time.mjs`.

  `golden-session.jsonl`: one main-session transcript, timestamps relative to `NOW_MS = Date.parse('2026-10-01T12:00:00.000Z')`. It holds:
  - assistant messages with `usage`, including cache reads, so the token total and cache share render
  - `Bash` ×3, `Edit` ×1, `Read` ×2 tool uses
  - a `TodoWrite` with 5 todos, 2 completed
  - an `Agent` tool_use `toolu_a1` (`subagent_type: "nestjs-developer"`, `model: "claude-sonnet-5-5"`, description), still running
  - an `Agent` tool_use `toolu_c1` with its tool_result 60 s before NOW, so it is completed inside the 120 s retention
  - an `Agent` tool_use `toolu_t1` with `run_in_background: true` and `name: "reviewer"`, async-launched, so it is a running teammate

  Shape every line after the existing fixtures in `tests/stale-agents.test.js` and `tests/panel.test.js`.

  `subagents/agent-a1.meta.json` = `{"toolUseId":"toolu_a1"}`. `agent-a1.jsonl` has a `TaskCreate`/`TaskUpdate` pair, one `Skill` use and a running `Edit` with assistant usage. `agent-t1.meta.json` = `{"name":"reviewer"}`, and `agent-t1.jsonl` has one `Read` with usage.

  `agents/nestjs-developer.md`: frontmatter `skills: [nestjs-best-practices, tdd]`.

- [ ] **Step 2: Write `cases.mjs`**

  Export `NOW_MS` (value above) and a default array of `{ name, stdin, config, columns?, git?, projectName?, transcript?, snapshot? }`.

  Base stdin: copy the `typical` object from `git show upstream/main:tests/golden/cases.mjs`, with `transcript_path: '<TRANSCRIPT>'` and `cwd: '<PROJECT>'`. Base config: `{ lineLayout: 'panel' }`.

  | name | overrides |
  |---|---|
  | `wide` | `columns: 140`, `git: 'clean'` |
  | `medium` | `columns: 100` |
  | `narrow` | `columns: 70` |
  | `unknown-width` | no `columns` |
  | `narrow-es` | `columns: 70`, `config.language: 'es'` |
  | `nerd` | `columns: 140`, `config.panel: { icons: 'nerd' }` |
  | `critical-advice` | `columns: 140`, `context_window.used_percentage: 92`, `prompt_cache: { warm: false }` |
  | `no-transcript` | `columns: 140`, `transcript: null` (the stdin path points at a file that is not created) |
  | `cjk` | `columns: 100`, `projectName: '日本語-プロジェクト'` |
  | `user-shape` | `columns: 140`, `git: 'dirty'`, stdin without `rate_limits`, `snapshot: true`, config = the user's (below) |

  The `user-shape` config is the user's real `~/.claude/plugins/claude-hud/config.json` with paths replaced by placeholders:

  ```js
  { lineLayout: 'panel', panel: { icons: 'nerd' },
    display: { externalUsageWritePath: '<HOME>/.claude/plugins/claude-hud/usage-snapshot.json',
      externalUsagePath: '<HOME>/.claude/plugins/claude-hud/usage-snapshot.json',
      showTools: true, showAgents: true, showTodos: true, showDuration: true,
      showConfigCounts: true, showSessionName: true } }
  ```

- [ ] **Step 3: Write `tests/panel-golden.test.js`**

  Copy the structure of `git show upstream/main:tests/golden.test.js`: `setUpGit`, `runCase`, `runAll`, `parseExpected` and the output normalization. Change only these points:
  - **Process:** `spawn(process.execPath, ['--preload', <path of tests/panel-golden/freeze-time.mjs>, path.join(root, 'src', 'index.ts')], { cwd: project, env })`.
  - **Transcript:** copy it to `<configDir>/projects/golden/golden-session.jsonl`, unless `transcript: null`. Copy `subagents/*` to `<configDir>/projects/golden/golden-session/subagents/` and `agents/*.md` to `<configDir>/agents/`.
  - **Placeholders:** replace `<HOME>` in the JSON-serialized config, and `<PROJECT>`/`<TRANSCRIPT>` in stdin.
  - **Snapshot:** with `snapshot: true`, write `<home>/.claude/plugins/claude-hud/usage-snapshot.json` = `{ updated_at: new Date(NOW_MS).toISOString(), five_hour: { used_percentage: 12, resets_at: <NOW+2h ISO> }, seven_day: { used_percentage: 31, resets_at: <NOW+3d ISO> } }`.
  - **Messages and platform:** the case-list-changed message says `UPDATE_SNAPSHOTS=1 bun test tests/panel-golden.test.js`. There is no win32 skip.
  - **Raw output:** `runCase` returns `{ raw, normalized }`.

  Two tests:

  ```js
  test('panel golden output', async (t) => { /* same compare/update logic as upstream golden.test.js */ });

  test('every panel line has the same width, sized to the terminal', async () => {
    for (const [i, c] of cases.entries()) {
      const lines = outputs[i].raw.trimEnd().split('\n');
      const expected = Math.max(40, Math.min(180, (c.columns ?? 120) - 4));
      assert.deepEqual(lines.map((l) => Bun.stringWidth(l)), lines.map(() => expected), c.name);
    }
  });
  ```

  Both tests share one `runAll()`; memoize it at module level.

- [ ] **Step 4: Run and verify it fails**

  Run: `bun test tests/panel-golden.test.js`
  Expected: `panel golden output` FAILS with "case list changed" (`expected.txt` is missing). The width test PASSES. If the width test fails for a case, stop and report that case's widths: it means today's panel already misaligns there, and the user decides.

- [ ] **Step 5: Capture and inspect**

  Run: `UPDATE_SNAPSHOTS=1 bun test tests/panel-golden.test.js && bun test tests/panel-golden.test.js`
  Expected: PASS.

  Then open `tests/panel-golden/expected.txt` and confirm that:
  - `wide` shows three top boxes over the activity box.
  - The agent table lists `nestjs-developer` (with skills `nestjs-best-practices`, `tdd`), the completed agent, and `reviewer`.
  - `critical-advice` shows the advice row.
  - `narrow-es` is in Spanish.
  - `nerd` shows glyphs.
  - `user-shape` shows 12% / 31% from the snapshot.

- [ ] **Step 6: Check determinism and the suite**

  Run: `bun test tests/panel-golden.test.js` twice more, then `bun test` and `bun run typecheck`.
  Expected: all PASS, with 0 failures.

- [ ] **Step 7: Commit**

  ```bash
  git add tests/panel-golden.test.js tests/panel-golden
  git commit -m "test(panel): freeze today's panel output in end-to-end golden fixtures"
  ```

---

### Task 2: Merge upstream v0.9.0 (Stage 1)

**Files:**
- Modify (conflicts): `CHANGELOG.md`, `commands/setup.md`, `package.json`, `package-lock.json`, `src/claude-config-dir.ts`, `src/config.ts`, `src/i18n/types.ts`, `src/transcript.ts`, `tests/cost-coverage.test.js`, `tests/version.test.js`, `dist/**`
- Modify: new upstream tests `tests/cache-hit-rate.test.js`, `tests/claude-config-dir.test.js`, `tests/usage-pace.test.js`, `tests/usage-pace-render.test.js`
- Modify: `src/i18n/es.ts`, `.claude-plugin/plugin.json`
- Delete: `tests/build-output.test.js`

**Interfaces:**
- Consumes: Task 1's `bun test tests/panel-golden.test.js`.
- Produces: `main`-ready branch at 0.9.0. The fork's module layout is unchanged (`src/render/lines/`, `panel.ts`, `subagents.ts`).

- [ ] **Step 1: Start the merge**

  Run: `git merge --no-ff d46bbd7 -m "Merge upstream v0.9.0 (d46bbd7)"`
  Expected: CONFLICT in the 10 non-`dist/` paths listed above, plus modify/delete on `dist/**` and `tests/build-output.test.js`.

- [ ] **Step 2: Resolve the conflicts**

  | Path | Resolution |
  |---|---|
  | `dist/**`, `package-lock.json`, `tests/build-output.test.js` | `git rm` (they stay deleted) |
  | `package.json`, `commands/setup.md` | `git checkout --ours`, then set `"version": "0.9.0"` in `package.json` |
  | `CHANGELOG.md` | Keep both sides: upstream's 0.9.0 section plus the fork's entries |
  | `src/claude-config-dir.ts` | Upstream's code plus the fork's `getHomeDir()` |
  | `src/config.ts` | Upstream's code plus the fork's `'panel'` layout, `PanelIconMode`, the `panel` block (type, default, validation), `'es'` in `validateLanguage`, and the returned `panel` |
  | `src/i18n/types.ts` | Union of both key sets, and `Language` keeps `"es"` |
  | `src/transcript.ts` | Both sides' logic. Set `TRANSCRIPT_CACHE_VERSION = 22`: it was 19 in the fork and 21 upstream, and both changed the parsed output |
  | `tests/cost-coverage.test.js`, `tests/version.test.js` | Upstream's content with `../dist/` replaced by `../src/`, plus the fork's pinned `now` in the Claude 5 point-release test |

  In every merged `src/` file, a new `os.homedir()` (for example the `usagePath` rule in `config.ts`) becomes `getHomeDir()`.

- [ ] **Step 3: Verify the invariants, then commit the merge**

  Run: `git grep -n "os.homedir()" -- src; git grep -ln "dist/" -- tests`
  Expected: the only `os.homedir()` is inside `getHomeDir` in `src/claude-config-dir.ts`. The test hits are limited to the 4 new upstream test files.

  ```bash
  git add -A && git commit --no-edit
  ```

- [ ] **Step 4: Point the new upstream tests at `src/`**

  In the 4 new test files, replace `../dist/` with `../src/`. Replace any `node`/`dist/index.js` spawn with `spawnSync(process.execPath, ["src/index.ts"], …)`.

  Run: `bun test tests/cache-hit-rate.test.js tests/claude-config-dir.test.js tests/usage-pace.test.js tests/usage-pace-render.test.js`
  Expected: PASS.

  ```bash
  git commit -am "test: run the 0.9.0 upstream tests from src under Bun"
  ```

- [ ] **Step 5: Translate the new keys to Spanish**

  Add `format.elapsed`, `label.cacheHitRate` and `label.week` to `src/i18n/es.ts`, keeping every `{placeholder}` from `en.ts`.

  Run: `bun test tests/panel.test.js`
  Expected: PASS, including `the Spanish locale covers every English message key`.

  ```bash
  git commit -am "feat(i18n): translate the 0.9.0 labels to Spanish"
  ```

- [ ] **Step 6: Bump the version**

  Set `"version": "0.9.0"` in `.claude-plugin/plugin.json`, and in any other file `git grep -n '"version": "0.8.0"'` finds.

  ```bash
  git commit -am "release: 0.9.0"
  ```

- [ ] **Step 7: Run the gate**

  Run: `bun run typecheck && bun test`
  Expected: typecheck clean, 0 failures. In particular, `tests/panel-golden.test.js` PASSES unchanged.

---

### Task 3: PR A real-surface check and handoff

**Files:** none changed.

- [ ] **Step 1: Run the user's exact statusline command against the worktree**

  Copy the `statusLine.command` from `~/.claude/settings.json` and change only the script path to `/Users/roberto/orca/workspaces/claude-hud/quahog/src/index.ts`. Pipe in a stdin JSON whose `transcript_path` is the newest `~/.claude/projects/*/*.jsonl` that has a sibling `<session>/subagents/` directory. Run it with `COLUMNS=140`.

  Expected:
  - The boxes are aligned.
  - Nerd glyphs show.
  - The agent table lists the agents from that session.
  - No `[claude-hud] Error`.

- [ ] **Step 2: Report and ask before publishing**

  Show the user the output and the commit list (`git log --oneline origin/main..HEAD`). Ask them to confirm the push and PR A ("Sync with upstream v0.9.0"). Push and run `gh pr create -R Robbyfuu/claude-hud` only after they confirm.

- [ ] **Step 3: Live check after the user merges PR A**

  With the user's go-ahead, run `git -C ~/Code/claude-hud pull --ff-only`, then ask the user to confirm the live statusline. If it is broken, the rollback is `git revert -m 1 <merge sha>` on `main` followed by a pull.

---

### Task 4: Merge `upstream/main` (Stage 2, mechanical resolution)

**Files:**
- Modify: every conflicting path
- Delete: `scripts/setup.mjs`, `scripts/statusline.mjs`, and every fork-modified test that upstream deleted
- Modify: `CLAUDE.md`, `README.md`, `README.zh.md`, `CONTRIBUTING.md`, `TESTING.md`, `SUPPORT.md`, `CLAUDE.README.md`

**Interfaces:**
- Consumes: PR A merged into `origin/main`.
- Produces: a merge commit with upstream's `src/` and `tests/`, plus the untouched fork-only files: `src/render/panel.ts`, `src/subagents.ts`, `src/i18n/es.ts`, `tests/panel.test.js`, `tests/stale-agents.test.js`, `tests/panel-golden*`. This commit does not type-check; Tasks 5–9 fix that.

- [ ] **Step 1: Update the branch and start the merge**

  Run: `git fetch origin upstream && git merge --ff-only origin/main && git merge --no-ff upstream/main -m "Merge upstream/main (post-0.9.0 refactor #784-#792)"`
  Expected: CONFLICT (about 50 paths).

- [ ] **Step 2: Resolve the conflicts**

  - `src/**` and `tests/**`: `git checkout --theirs`. Paths upstream deleted and the fork modified (`tests/core.test.js`, `tests/context-cache.test.js`, `src/render/lines/**`, `src/render/width.ts`, `src/render/format-reset-time.ts`, and so on): `git rm`.
  - `tests/setup-command.test.js`: `git checkout --ours`. Upstream's version tests the launcher.
  - `package.json`, `bun.lock`, `.github/workflows/**`, `commands/setup.md`: `git checkout --ours`.
  - `dist/**`, `package-lock.json`, `scripts/**`: `git rm`.
  - `CHANGELOG.md`: keep both sides.
  - Docs:
    - Take upstream's version, then replace npm/node commands with the scripts from the fork's `package.json` (`bun install`, `bun test`, `bun run typecheck`).
    - Drop Windows/Node setup notes.
    - Keep the fork's `README.md`/`README.zh.md` panel section and the `es` mention in the `language` row. Task 7 adds the `panel.*` option rows.
    - `CLAUDE.md`: take upstream's architecture section, then add `panel.ts` and `subagents.ts` to its file tree. Keep the fork's Build Commands, Dependencies and Upstream sync sections.
    - In Upstream sync, add `scripts/` (stays deleted) to the keep-ours list. Add a rewrite rule: `tests/golden.test.js` spawns `bun --preload <freeze-time> src/index.ts`.

- [ ] **Step 3: Verify the fork-only files survived, then commit**

  Run: `git status --short | grep -v '^M ' ; ls src/render/panel.ts src/subagents.ts src/i18n/es.ts tests/panel.test.js tests/stale-agents.test.js tests/panel-golden.test.js scripts 2>&1`
  Expected: no unmerged paths. The six fork files exist. `scripts` does not exist.

  ```bash
  git add -A && git commit --no-edit
  ```

---

### Task 5: Port the Bun toolchain onto the refactor

**Files:**
- Modify: `src/claude-config-dir.ts`, `src/index.ts`, `src/auth.ts`, `src/config-reader.ts`, `src/config.ts`, `src/daily-cost.ts`
- Modify: every test file that matches `git grep -ln "dist/" -- tests`, and `tests/golden.test.js`
- Modify: `tests/panel-golden.test.js`
- Delete: `tests/build-output.test.js` (if upstream re-added it), `tests/panel-golden/freeze-time.mjs`
- Create: `tests/bun-runtime.test.js`

**Interfaces:**
- Produces: `getHomeDir(): string` exported from `src/claude-config-dir.ts`.

- [ ] **Step 1: Write the failing test**

  `tests/bun-runtime.test.js`:

  ```js
  test('getHomeDir reads HOME at call time', () => { /* set process.env.HOME to a temp path; assert getHomeDir() === it; restore */ });
  test('getHomeDir falls back to os.homedir() when HOME is empty', () => { /* HOME=''; assert.equal(getHomeDir(), os.homedir()) */ });
  test('the entrypoint runs when executed directly', () => {
    const r = spawnSync(process.execPath, ['src/index.ts'], { env: { ...process.env, CLAUDE_CONFIG_DIR: tmp }, input: '', timeout: 10_000, encoding: 'utf8' });
    assert.equal(r.error, undefined); assert.equal(r.status, 0); assert.match(r.stdout, /Initializing/);
  });
  ```

- [ ] **Step 2: Run it and verify it fails**

  Run: `bun test tests/bun-runtime.test.js`
  Expected: FAIL, `getHomeDir` is not exported.

- [ ] **Step 3: Implement**

  - Add `export function getHomeDir(): string { return process.env.HOME || os.homedir(); }` to `src/claude-config-dir.ts`.
  - Replace every other `os.homedir()` in `src/` with `getHomeDir()`.
  - In `src/index.ts`, replace the `isSamePath(process.argv[1], …)` block with `if (import.meta.main) void main();` and drop the imports that become unused.

- [ ] **Step 4: Fix the tests and the golden harness**

  - Every `../dist/` import becomes `../src/`.
  - Every `node`/`dist/index.js` spawn becomes `process.execPath` with `src/index.ts`.
  - `tests/golden.test.js` spawns `[process.execPath, '--preload', <filesystem path of tests/golden/freeze-time.mjs>, path.join(root, 'src', 'index.ts')]`.
  - Delete `tests/build-output.test.js`.
  - `tests/panel-golden.test.js` preloads `tests/golden/freeze-time.mjs`; delete the fork's copy.

- [ ] **Step 5: Run the gate**

  Run: `bun test tests/bun-runtime.test.js tests/golden.test.js && bun test; bun run typecheck`
  Expected:
  - `bun-runtime` and upstream's `golden.test.js` PASS against upstream's `expected.txt` unchanged. If `golden.test.js` differs under Bun, stop and report the diff. Do not regenerate it.
  - `bun test` failures are limited to `tests/panel.test.js`, `tests/stale-agents.test.js` and `tests/panel-golden.test.js`.
  - Typecheck errors are limited to `src/render/panel.ts`, `src/subagents.ts` and `src/i18n/es.ts`.

- [ ] **Step 6: Commit**

  ```bash
  git add -A && git commit -m "build: run the refactored upstream code and tests on Bun"
  ```

---

### Task 6: Port the fork's transcript behavior into upstream's single-pass `Parser`

**Files:**
- Modify: `src/transcript.ts`, `src/types.ts`
- Rename: `tests/stale-agents.test.js` → `tests/transcript-fork.test.js`
- Modify: `tests/panel.test.js` (move one test out)

**Interfaces:**
- Produces:
  - `AgentEntry.name?: string`
  - `TranscriptData.toolCounts?: Record<string, number>`
  - `parseTranscript(transcriptPath: string): Promise<TranscriptData>` (signature unchanged)

- [ ] **Step 1: Move the tests**

  `git mv tests/stale-agents.test.js tests/transcript-fork.test.js`. Move the test `parseTranscript counts every tool use and maps task ids Claude Code assigns` from `tests/panel.test.js` into it, unchanged.

- [ ] **Step 2: Run them and verify they fail**

  Run: `bun test tests/transcript-fork.test.js`
  Expected: FAIL. Background agents stay `running` after a resume or idle notification, and `toolCounts` is undefined.

- [ ] **Step 3: Implement in upstream's `Parser`**

  The reference logic is `git show a4cc0f3:src/transcript.ts`, lines 530–540, 745–805 and 975–995.
  - `Entry.attachment` gains `hookName?: string`.
  - The `Agent`/`Task` tool_use sets `name` from `input.name`.
  - In `Parser.line`, for entries with a valid timestamp:
    - `attachment.hookName` of `SessionStart:startup` or `SessionStart:resume` updates the last process start. Compact and clear do not count.
    - A `user` string content containing `<teammate-message teammate_id="X"` and `idle_notification` records `(X, at)`.
    - Every non-sidechain `tool_use` increments `toolCounts[name]`.
    - `toolUseResult.task.id` maps into `taskIndex`.
  - In `finish()`, after the queue-completion pass and before the `endTime` → `completed` status pass:
    - A running background agent named X with `startTime <= at` gets `endTime = at`.
    - A running background agent with `startTime < lastProcessStart` gets `endTime = lastProcessStart`.

- [ ] **Step 4: Run them and verify they pass**

  Run: `bun test tests/transcript-fork.test.js tests/transcript.test.js tests/golden.test.js`
  Expected: PASS. Upstream's `expected.txt` is unchanged.

- [ ] **Step 5: Commit**

  ```bash
  git add -A && git commit -m "fix(transcript): end dead background agents and count tool uses in the single-pass parser"
  ```

---

### Task 7: Port the panel config, the `es` locale and the panel labels

**Files:**
- Modify: `src/config.ts`, `src/i18n/types.ts`, `src/i18n/index.ts`, `src/i18n/en.ts`, `src/i18n/zh-Hans.ts`, `src/i18n/zh-Hant.ts`, `src/i18n/es.ts`, `README.md`, `README.zh.md`, `tests/config.test.js`
- Create: `tests/fork-config.test.js`
- Modify: `tests/panel.test.js` (move two tests out)

**Interfaces:**
- Produces:
  - `LineLayoutType` includes `'panel'`.
  - `HudConfig['panel']: { icons: 'nerd' | 'none'; maxAgents: number; completedRetentionSeconds: number }`.
  - `Language` includes `'es'`.
  - `MessageKey` includes the 36 `panel.*` keys from `git show a4cc0f3:src/i18n/types.ts`.

- [ ] **Step 1: Move the tests**

  Move `mergeConfig accepts panel layout and validates panel options` and `the Spanish locale covers every English message key` from `tests/panel.test.js` into `tests/fork-config.test.js`, unchanged. In `tests/config.test.js`, add `'panel'` to the line-layout enum list.

- [ ] **Step 2: Run them and verify they fail**

  Run: `bun test tests/fork-config.test.js tests/config.test.js`
  Expected: FAIL. `lineLayout: 'panel'` falls back to `'expanded'`, and `panel` is missing from the merged config.

- [ ] **Step 3: Implement**

  - **`config.ts`:**
    - `LINE_LAYOUTS` gains `'panel'`.
    - Add `PANEL_ICONS = ['nerd', 'none'] as const`.
    - Add the `panel` block to `HudConfig` and `DEFAULT_CONFIG` with the defaults from Global Constraints.
    - Add `RULES` entries: `'panel.icons': oneOf(PANEL_ICONS)`, plus floor-then-clamp rules for `panel.maxAgents` [1, 20] and `panel.completedRetentionSeconds` [0, 86400].
    - `LANGUAGES` gains `'es'`.
  - **`i18n/`:**
    - `Language` and `CanonicalLanguage` gain `"es"`, and `index.ts` `locales` and `CANONICAL` map `es`.
    - Add the `panel.*` keys and values to `types.ts`, `en.ts`, `zh-Hans.ts` and `zh-Hant.ts`. Take the values from `git show a4cc0f3:src/i18n/<file>`.
    - In `es.ts`, drop `label.estimatedCost`, which upstream removed. `es` keys must equal `en` keys.
  - **READMEs:** in `README.md` and `README.zh.md`, add one options-table row per key: `panel.icons`, `panel.maxAgents`, `panel.completedRetentionSeconds`. Use the fork's row text from `git show a4cc0f3:README.md`.

- [ ] **Step 4: Run them and verify they pass**

  Run: `bun test tests/fork-config.test.js tests/config.test.js tests/readme-options.test.js tests/i18n.test.js`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add -A && git commit -m "feat(config): accept the panel layout, its options and the es locale on the new config rules"
  ```

---

### Task 8: Port subagent details and wire them into `main`

**Files:**
- Modify: `src/subagents.ts`, `src/types.ts`, `src/index.ts`, `src/render/panel.ts` (only to import `selectPanelAgents` from its new home)
- Create: `tests/subagents.test.js`
- Modify: `tests/panel.test.js` (move tests out)

**Interfaces:**
- Consumes: `AgentEntry.name` (Task 6) and `HudConfig['panel']` (Task 7).
- Produces, all from `src/subagents.ts`:
  - `selectPanelAgents(agents: AgentEntry[], config: HudConfig, now: number): { shown: AgentEntry[]; hiddenRunning: number }`. It moves here from `panel.ts`.
  - `readSubagentDetails(transcriptPath: string, agents: AgentEntry[], cwd?: string): Map<string, SubagentDetail>`
  - `readSubagentTokenTotals(transcriptPath: string): Promise<SessionTokenUsage | null>`
- Produces in `types.ts`:
  - `SubagentDetail`, copied from `git show a4cc0f3:src/types.ts`
  - `RenderContext.subagents?: Map<string, SubagentDetail>`
  - `RenderContext.subagentTokens?: SessionTokenUsage | null`
  - `StdinData.pr?: { number?: number | null; url?: string | null; review_state?: string | null } | null`

- [ ] **Step 1: Move the tests and add the review-focus test**

  Move the 9 tests from `tests/panel.test.js` into `tests/subagents.test.js`: `selectPanelAgents …`, `parseSubagentTranscript …` ×2, `readAgentDefinitionSkills …`, `readSubagentDetails …` ×2 and `readSubagentTokenTotals …` ×3. Import from `../src/subagents.js`. Then add:

  ```js
  test('readSubagentDetails tolerates a truncated transcript line and an invalid meta file', async () => {
    // agent-a.meta.json valid → agent-a.jsonl ends with a half-written JSON line;
    // agent-b.meta.json contains "{not json".
    // assert: no throw; details.get('toolu_a') has the toolCount of its complete lines; details.has('toolu_b') === false
  });
  ```

- [ ] **Step 2: Run them and verify they fail**

  Run: `bun test tests/subagents.test.js`
  Expected: FAIL, because `selectPanelAgents` is not exported from `subagents.ts` (and the compile errors from Task 5 remain).

- [ ] **Step 3: Implement**

  - Move `selectPanelAgents` into `subagents.ts`; `panel.ts` imports it from there.
  - Add the types listed under Interfaces.
  - Fix `subagents.ts` imports against upstream modules.
  - In `src/index.ts`:
    - `needsTranscript` returns true when `config.lineLayout === 'panel'`.
    - `readSubagentTokenTotals(stdin.transcript_path ?? '')` joins the existing `Promise.all` when the layout is panel; otherwise it resolves to `null`.
    - After `transcript` resolves, set `subagents = readSubagentDetails(path, selectPanelAgents(transcript.agents, config, now).shown, stdin.cwd)`.
    - Pass `subagents` and `subagentTokens` into the context given to `render`.

  `readSubagentDetails` needs the transcript's agents, so it runs after the `Promise.all`. The spec's "join the Promise.all" applies only to the token totals.

- [ ] **Step 4: Run them and verify they pass**

  Run: `bun test tests/subagents.test.js tests/index.test.js`
  Expected: PASS.

- [ ] **Step 5: Measure the performance rule**

  Write a scratchpad script that does not get committed. It picks the `~/.claude/projects/*/<session>` with the largest total `subagents/*.jsonl` size, then runs `readSubagentTokenTotals` + `readSubagentDetails` (on all its agents) 20 times under `bun`. It prints the median in ms and the file count.

  Expected: median < 50 ms. If it is ≥ 50 ms, stop and report the numbers to the user. Do not add a cache.

- [ ] **Step 6: Commit**

  ```bash
  git add -A && git commit -m "feat(subagents): read per-agent details and token totals for the panel on the new gather step"
  ```

---

### Task 9: Rebuild the panel on `Frame` and upstream helpers

**Files:**
- Modify: `src/render/panel.ts`, `src/render/index.ts`, `src/render/activity.ts` (exports only), `src/render/ansi.ts` (exports only, if needed), `tests/panel.test.js`

**Interfaces:**
- Consumes:
  - `Frame` and `createFrame(ctx, columns, now)` from `src/render/frame.ts`
  - `selectPanelAgents` (Task 8), `RenderContext.subagents`/`subagentTokens` (Task 8), `HudConfig['panel']` (Task 7)
- Produces: `panelLines(f: Frame): string[]` in `src/render/panel.ts`, which replaces `renderPanel(ctx, terminalWidth)`.

- [ ] **Step 1: Port `tests/panel.test.js`**

  Replace every `renderPanel(ctx, width)` with `panelLines(createFrame(ctx, width, NOW))`, where `NOW` is the clock each test already pins. Keep every assertion. After Tasks 6–8 moved tests out, 19 tests remain: the `renderPanel …` group.

- [ ] **Step 2: Run them and verify they fail**

  Run: `bun test tests/panel.test.js tests/panel-golden.test.js`
  Expected: FAIL, `panelLines` is not exported.

- [ ] **Step 3: Implement**

  - `render/index.ts`: when `ctx.config?.lineLayout === 'panel'`, return `panelLines(frame).map((l) => `${RESET}${l}`)` before the `wrapToWidth` step.
  - In `panel.ts`, rebuild the panel on `Frame`:
    - Columns are `f.width ?? 120`. Panel width stays `max(40, min(180, maxWidth ?? 180, columns - 4))`.
    - The clock is `f.now`, so no `Date.now()` and no `new Date()` without an argument.
  - Replace the deleted fork helpers with upstream's:
    - context percent/buffered → `contextUsage(f)` (`derive.ts`)
    - `formatResetTime` → `src/render/time.ts`
    - `formatAgentModel` → `shortModel`, exported from `activity.ts`
    - `codePointCellWidth`/`isCjkAmbiguousWide` → `textWidth`/`visibleWidth` from `ansi.ts`
    - model name / token totals → the matching `src/stdin.ts` exports
  - Do not re-create `width.ts` or `format-reset-time.ts`.

- [ ] **Step 4: Run them and verify they pass**

  Run: `bun test tests/panel.test.js && bun test tests/panel-golden.test.js`
  Expected: `panel.test.js` PASSES. `panel-golden` PASSES unchanged. If `panel-golden` fails, do not update the snapshot. Save the per-case diff to `docs/superpowers/plans/2026-10-02-panel-diffs.md` (case, line, before, after), and treat the task as done with diffs pending Task 10.

- [ ] **Step 5: Run the gate and commit**

  Run: `bun run typecheck && bun test`
  Expected: typecheck clean, 0 failures apart from `panel-golden` cases listed in the diff report.

  ```bash
  git add -A && git commit -m "feat(render): rebuild the panel layout on Frame and the shared width engine"
  ```

---

### Task 10: PR B verification, diff approval and handoff

**Files:**
- Modify (only after approval): `tests/panel-golden/expected.txt`
- Delete: `docs/superpowers/plans/2026-10-02-panel-diffs.md` once it is resolved

- [ ] **Step 1: Get approval for the diffs**

  If the diff report exists, show it to the user case by case. For each difference they reject, fix `panel.ts` and re-run Task 9 Step 4. Once every remaining difference is approved, run `UPDATE_SNAPSHOTS=1 bun test tests/panel-golden.test.js` and commit `test(panel): accept approved panel output changes from the render port`.

- [ ] **Step 2: Run the full gate**

  Run: `bun run typecheck && bun test && git grep -n "os.homedir()" -- src && git grep -ln "dist/" -- tests`
  Expected: clean, 0 failures, a single `os.homedir()` (inside `getHomeDir`), and no `dist/` test imports.

- [ ] **Step 3: Check the real surface**

  Repeat Task 3 Step 1 against this branch.

- [ ] **Step 4: Report and ask before publishing**

  Show the output, the Task 8 performance numbers and `git log --oneline origin/main..HEAD`. Ask for confirmation before pushing and opening PR B ("Sync with upstream refactor #784–#792"). After the user merges it, repeat Task 3 Step 3.
