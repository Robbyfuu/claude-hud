# CLAUDE.md

Claude HUD is a Claude Code plugin: a [status line](https://code.claude.com/docs/en/statusline) command that prints a two-line HUD (model, project, git, context, usage), plus opt-in lines for tools, agents, todos, and more.

## Build Commands

```bash
bun install                    # Install dependencies
bun run typecheck              # Type-check (no build step; Bun runs src/ directly)
bun test                       # Run the test suite
UPDATE_SNAPSHOTS=1 bun test    # Regenerate tests/golden/expected.txt after an intended output change

# Test with sample stdin data
echo '{"model":{"display_name":"Opus"},"context_window":{"used_percentage":45,"context_window_size":200000}}' | bun --env-file /dev/null src/index.ts
```

## How a render works

Claude Code runs the command after each message, `/compact`, a mode change, a rate-limit reset, or a prompt-cache expiry (debounced 300ms), plus on `refreshInterval` if set. Each run is a fresh process:

1. `stdin.ts` reads the payload. It targets Claude Code ≥ 2.1.260 and trusts its fields (`version`, `cost`, `prompt_cache`, `session_name`, `output_style`, `workspace.repo`, `rate_limits`) instead of deriving them.
2. `config.ts` loads `plugins/claude-hud/config.json` plus the per-directory `claude-hud.json` override. `DEFAULT_CONFIG` is the schema; a rules table validates each key.
3. `index.ts` gathers only what enabled elements need, in parallel: the transcript (`transcript.ts`), per-subagent detail from `<session>/subagents/*.jsonl` for the panel layout (`subagents.ts`; the shown-agent selection is computed once in `panel-agents.ts` and passed to render as `panelAgents`), git or jj (`git.ts`, `jj.ts`), the extra command, memory, auth, config counts, the usage snapshot, the cost ledger, and speed state. All I/O and state writes happen here.
4. `render/` turns that into lines without I/O. Each element has one implementation in `parts.ts`, `context.ts`, `usage.ts`, `vcs.ts`, `lines.ts`, and `activity.ts`. `expanded.ts` and `compact.ts` only arrange those parts, `panel.ts` draws the boxed `panel` layout (session/usage/environment boxes plus the agent table), and `ansi.ts` measures and wraps.

## Invariants

- The default HUD is two lines. New display is opt-in; see the scope section of CONTRIBUTING.md.
- Text from stdin, the transcript, git, or config is untrusted terminal input. Sanitize it (`utils/sanitize.ts`) before it's printed.
- Rendering is pure: the clock and terminal width are sampled once in `renderLines`.
- `tests/golden.test.js` pins end-to-end output. An output change must show up as a reviewed diff to `tests/golden/expected.txt`.
- There is no build step and no `dist/`. Bun runs `src/` directly.
- `README.md` and `README.zh.md` document every key in `DEFAULT_CONFIG`, and `tests/readme-options.test.js` enforces it.

## Setup

`/claude-hud:setup` (`commands/setup.md`) writes `statusLine.command` into the user's `settings.json`. The command finds the newest installed version at runtime and runs its `src/index.ts` with Bun, so plugin updates never need setup again. Plugins can't set `statusLine` themselves, so this step writes the user's `settings.json`.

## Dependencies

- **Runtime**: Bun 1.4+
- **Typecheck**: TypeScript 7 (type-check only), ES2022 target, NodeNext modules

## Upstream sync

Merges from `jarrodwatts/claude-hud` will conflict in `package.json`, `package-lock.json`, `dist/`, `scripts/`, the workflows, `commands/setup.md`, `commands/configure.md`, `README.md`, `README.zh.md`, `CHANGELOG.md`, `tsconfig.json` and `.gitignore`. Resolution: keep ours for `package.json`, `dist/`, `package-lock.json`, `scripts/`, the workflows and `commands/setup.md` (`dist/`, `package-lock.json` and `scripts/` stay deleted); for `commands/configure.md` take upstream plus the Panel and Español options; for the READMEs and `CHANGELOG.md` keep both sides plus the fork's rows and notes; for `tsconfig.json` and `.gitignore` keep ours and add anything new upstream needs. Keeping ours for the workflows must not resurrect a file upstream deleted: upstream #795 removed `.github/workflows/claude.yml` for security. For `src/`, take upstream for files the fork does not touch. The fork carries hunks in `src/transcript.ts` (`toolCounts`, dead-agent detection, task-id mapping), `src/types.ts` (incl. `panelAgents`), `src/config.ts` (panel rules, `es`), `src/i18n/*` (panel keys, `es`), `src/index.ts` (panel gather and `panel-agents.ts` selection, config-count gate, `getHomeDir`, `import.meta.main`), `src/render/index.ts` (panel branch) and the `export` additions in `src/render/activity.ts`, `src/render/ansi.ts` and `src/i18n/index.ts`: take upstream, then re-apply the fork hunks. `tests/panel-golden.test.js`, `tests/transcript-fork.test.js`, `tests/fork-config.test.js`, `tests/subagents.test.js` and `tests/bun-runtime.test.js` pin them. Also rewrite `../dist/` → `../src/` in any new upstream test; re-run `bun install` to refresh `bun.lock`. When taking upstream `src/`, keep our `getHomeDir()` (from `src/claude-config-dir.ts`) and `if (import.meta.main)` entrypoint in conflicting hunks; replace any new upstream `os.homedir()` call with `getHomeDir()` (Bun caches HOME at startup); and rewrite any new upstream test that spawns the built `dist/index.js` through Node to `spawnSync(process.execPath, ["src/index.ts"], …)`. The golden harness `tests/golden.test.js` spawns `bun --preload <freeze-time> src/index.ts` instead of `node --import <freeze-time> dist/index.js`.

Tests that pin `commands/setup.md` content (`tests/setup-command.test.js`) keep ours, like `setup.md` itself.

After keeping ours for a file, run `git log <merge-base>..<upstream> -- <file>` and port any upstream behavior fix on top of ours. The 0.9.0 sync lost the #759 fix this way.
