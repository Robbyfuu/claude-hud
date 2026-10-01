# Upstream sync to 0.9.0 and the post-0.9.0 refactor — design

Date: 2026-10-01
Repo: Robbyfuu/claude-hud (fork of jarrodwatts/claude-hud, currently 0.8.0 + Bun-only toolchain)

## Goal

Bring the fork up to date with upstream without losing any fork feature:

1. Stage 1 — merge upstream up to the v0.9.0 release (`d46bbd7`).
2. Stage 2 — merge the post-0.9.0 refactor series (#784–#792, `upstream/main` = `6288889`) and port the fork features onto the new architecture.

The fork's only consumer runs `bun --config=/dev/null --env-file /dev/null ~/Code/claude-hud/src/index.ts` from `main`, with `lineLayout: "panel"`, `panel.icons: "nerd"` and the external usage snapshot (`display.externalUsageWritePath` / `externalUsagePath`). That statusline is the real user surface.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Integration method | Two `git merge` stages, one PR each | Keeps merge tracking with upstream, so future syncs stay ordinary merges. Rebase (rewrites published `main`) and re-implementing from a fresh upstream branch (force push, loses merge base) were rejected. |
| Panel fidelity | Output identical to today, except differences listed and approved by the user | User choice. Enforced with end-to-end golden fixtures captured before any merge (Stage 0). |
| Fork features kept | Panel layout (with subagent table, session token total, advice row), `es` locale, dead background agent detection, Bun-only toolchain, Bun-only `commands/setup.md`, `getHomeDir()`, `import.meta.main` entrypoint | All are in daily use or required by Bun. |
| Upstream launcher (`scripts/setup.mjs`, `scripts/statusline.mjs`) | Not adopted; deleted in the Stage 2 merge and added to the CLAUDE.md "keep ours" sync rule (like `dist/`) | The launcher only scans `<configDir>/plugins/cache/*/claude-hud/<semver>/`, so it never finds the dev checkout the user runs. `commands/setup.md` (ours) does not call it. |
| New upstream features | Taken as-is | All are opt-in and off by default: `display.usagePace`, `gitStatus.showWorktree`, `display.showCacheHitRate`, `display.showWeeklyCost`, `display.skillsMaxVisible`. Enabling any of them is out of scope. |
| Version | `0.9.0` in `package.json` and `.claude-plugin/plugin.json` after Stage 1 | Matches the upstream release being merged. |
| Intermediate commits | Only each PR head must be green; the Stage 2 merge commit may not type-check | The merge commit resolves conflicts mechanically; fork features are ported in the atomic commits that follow it. |

## Stage 0 — Panel characterization fixtures

Captured on the current fork code, before any merge, so they describe today's panel output.

- New fork-only files: `tests/panel-golden.test.js`, `tests/panel-golden/` (cases, expected output, transcript fixtures, a 12-line `freeze-time.mjs` identical in behavior to upstream's `tests/golden/freeze-time.mjs`). Fork-only paths never conflict with upstream.
- Each case spawns the real process: `spawnSync(process.execPath, ["--preload", "<freeze-time.mjs>", "src/index.ts"], …)` with stdin JSON, `HUD_FAKE_NOW`, `TZ=UTC`, `COLUMNS=<width>`, and a temp `HOME` / `CLAUDE_CONFIG_DIR` holding `plugins/claude-hud/config.json`, the session transcript and its `<session>/subagents/` directory (`agent-<id>.jsonl` + `agent-<id>.meta.json`).
- Width comes from `COLUMNS` in both the fork (`src/utils/terminal.ts:9`) and upstream (`src/utils/terminal.ts:12`), so the same fixture drives both.
- Output normalization, same as upstream's harness: `\x1b` → `\e`, temp path → `<BASE>`, NBSP → `<NBSP>`. `UPDATE_SNAPSHOTS=1` rewrites the expected file.
- Cases:
  1. wide (≥112 columns: three top boxes over the activity box)
  2. medium (76–111)
  3. narrow (<76: stacked boxes, two lines per agent)
  4. `language: "es"`
  5. `panel.icons: "nerd"`
  6. critical context with the advice row
  7. agent table with a running agent, a completed agent within retention, and a teammate linked by meta `name`
  8. the user's real shape: nerd icons + external usage snapshot + the `display.*` flags from the user's config
- Being end-to-end, the fixtures do not depend on `renderPanel`'s signature, so they stay valid after the Stage 2 rewrite.

## Stage 1 — Merge up to v0.9.0 (`d46bbd7`)

`git merge d46bbd7` reports 10 conflicting paths outside `dist/`. Resolution:

| Path | Resolution |
|---|---|
| `package.json` | Ours; `version` → `0.9.0` |
| `package-lock.json`, `dist/**` | Stay deleted (ours) |
| `commands/setup.md` | Ours |
| `CHANGELOG.md` | Union: upstream's 0.9.0 entries added to ours |
| `src/claude-config-dir.ts` | Upstream logic + our `getHomeDir()` |
| `src/config.ts` | Upstream logic + our `panel` block, `'panel'` layout and `'es'` language |
| `src/i18n/types.ts` | Union of upstream's new keys and our 36 `panel.*` keys |
| `src/transcript.ts` | Upstream logic + our `toolCounts`, TaskCreate id mapping, `AgentEntry.name`, idle-notification and `SessionStart:startup/resume` handling |
| `tests/cost-coverage.test.js`, `tests/version.test.js` | Upstream content with `../dist/` → `../src/` |

Also in Stage 1:

- Every new upstream test: `../dist/` → `../src/`; every `node … dist/index.js` spawn → `spawnSync(process.execPath, ["src/index.ts"], …)`.
- Every new upstream `os.homedir()` in `src/` → `getHomeDir()`.
- Every new upstream i18n key gets an `es.ts` translation (the `es` parity test in `tests/panel.test.js` requires it).
- `.claude-plugin/plugin.json` `version` → `0.9.0`.

**PR A gate:** `bun run typecheck` clean, `bun test` 0 failures, panel golden fixtures unchanged, real-surface check (below).

## Stage 2 — Merge `upstream/main` and port the fork

### Merge commit

- Conflicts in `src/` and `tests/`: take upstream (CLAUDE.md sync rule).
- `package.json`, `bun.lock`, `.github/workflows/**`, `commands/setup.md`: ours. `dist/**`: stays deleted.
- `scripts/setup.mjs`, `scripts/statusline.mjs` and any upstream test that exercises them: deleted.
- Fork-only files (`src/render/panel.ts`, `src/subagents.ts`, `src/i18n/es.ts`, `tests/panel.test.js`, `tests/stale-agents.test.js`, Stage 0 files) are kept as-is; the ports below make them compile again.

### Port commits (in order, one atomic commit each)

**1. Toolchain.**
- Tests: `../dist/` → `../src/`.
- `node` spawns → `process.execPath` + `src/index.ts`.
- Upstream golden harness (`tests/golden.test.js`): `node --import freeze-time.mjs dist/index.js` → `bun --preload freeze-time.mjs src/index.ts`. Its `git: 'clean'|'dirty'|'ahead'` states are verified under Bun here.
- `os.homedir()` in `src/` → `getHomeDir()`.
- Entrypoint `isSamePath(process.argv[1], …)` → `if (import.meta.main)`.
- `tests/build-output.test.js` removed if upstream re-added it.
- Stage 0 switches to upstream's `tests/golden/freeze-time.mjs`; our copy is deleted.

**2. Transcript** (`src/transcript.ts`, upstream single-pass `Parser`).
- `AgentEntry.name` from the Agent input `name`.
- `Entry.attachment.hookName`.
- In `Parser.line`: `SessionStart:startup` / `SessionStart:resume` set the last process start; `<teammate-message teammate_id="X">` user content with `idle_notification` is recorded. Compact and clear do not count.
- In `finish()`, after the queue-completion pass: a running background agent named `X` with `startTime <= idleAt` completes at `idleAt`; a running background agent with `startTime < lastProcessStartAt` completes at `lastProcessStartAt`.
- Session-wide `toolCounts` for non-sidechain `tool_use`, and `toolUseResult.task.id` → task index mapping. Upstream has neither today.
- `tests/stale-agents.test.js` must pass unchanged: `parseTranscript(path): Promise<TranscriptData>` keeps its signature.

**3. Config and i18n.**
- `LINE_LAYOUTS` gains `'panel'`.
- `HudConfig.panel` + `DEFAULT_CONFIG.panel` = `{ icons: 'none', maxAgents: 5, completedRetentionSeconds: 120 }`.
- Rules: `panel.icons` ∈ `{'nerd','none'}`; `panel.maxAgents` floored and clamped to [1, 20]; `panel.completedRetentionSeconds` floored and clamped to [0, 86400]. Same limits as today. A non-boolean key without a rule silently keeps its default, so all three need rules.
- `LANGUAGES` gains `'es'`; `es.ts` covers every `en` key.
- `README.md` and `README.zh.md` gain one option row per `panel.*` key (required by `tests/readme-options.test.js`).
- `tests/config.test.js` layout enum includes `'panel'`.

**4. Subagents.**
- `src/subagents.ts` adapted to the new types.
- Its reads (`readSubagentDetails`, `readSubagentTokenTotals`) join the `Promise.all` in `src/index.ts` when `lineLayout === 'panel'`.
- `needsTranscript` returns true for the panel layout.
- `RenderContext` gains `subagents?` and `subagentTokens?`.
- `StdinData` gains only `pr?`; upstream already has `version`, `output_style` and a superset of `prompt_cache`.
- Performance rule: upstream removed the transcript disk cache (#790), so every subagent JSONL is parsed on every render. Measure the panel render with the user's largest real session. Under 50 ms added: no change. Over 50 ms: stop and bring the decision to the user (a cache would undo an upstream design choice).

**5. Panel.**
- `src/render/index.ts` gains a `'panel'` branch that returns `panelLines(frame)` without `wrapToWidth`. `wrapToWidth` splits at `/ \| | │ /`, which matches box interiors.
- `src/render/panel.ts` is rewritten over `Frame`, reusing upstream helpers:
  - `contextUsage` (replaces `getContextPercent` / `getBufferedPercent`)
  - `contextBarAndValue`, `usageParts`, `quotaBar`, `formatQuotaPercent`, `getQuotaColor`
  - `formatResetTime(resetAt, mode, wallClock(display), f.now)`
  - `visibleWidth` / `textWidth`
- Upstream helpers exported instead of copied:
  - `truncateToWidth` (`ansi.ts`)
  - `shortModel` (`activity.ts`, replaces `formatAgentModel`)
  - `formatElapsed` (`activity.ts`)
- The fork's `src/render/width.ts` and `src/render/format-reset-time.ts` no longer exist after the merge, and nothing re-adds them.
- `tests/panel.test.js` ported to the new signatures; every existing test keeps its intent, none is dropped.
- Stage 0 fixtures must pass. Every remaining difference is listed (case, line, before/after) for user approval before PR B.

**PR B gate:** `bun run typecheck` clean, `bun test` 0 failures (including upstream's golden harness under Bun and the ported panel tests), Stage 0 fixtures pass or their differences are approved, performance rule satisfied, real-surface check.

## Verification and rollout

`~/Code/claude-hud` runs `main` live: a broken `main` breaks the user's statusline immediately. Nothing merges before it runs from the worktree.

| When | Check |
|---|---|
| Before each PR | 1. `bun run typecheck` and `bun test` with 0 failures<br>2. Panel golden fixtures<br>3. The exact `settings.json` command with the path pointed at the worktree's `src/index.ts`, the user's real `config.json`, and stdin carrying the transcript of a real session with subagents. Output inspected for box alignment, nerd icons and the agent table |
| After merge | `git -C ~/Code/claude-hud pull`, then confirm the live statusline in Claude Code |
| Live failure | `git revert -m 1 <merge>` on `main` + pull: back to the previous state in under a minute |

CLAUDE.md "Upstream sync" section: add `scripts/` to the keep-ours (deleted) list and `bun --preload` for the golden harness to the rewrite rules.

## Out of scope

- Proposing the panel layout upstream.
- Adopting upstream's setup launcher.
- Windows support.
- Enabling new upstream features in the user's `config.json`.

## Estimate

Stage 0 + Stage 1: about 3 hours. Stage 2: 1 to 1.5 days, half of it the panel port.
