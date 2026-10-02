# Contributing

Thanks for contributing to Claude HUD. This repo is small and fast-moving, so we optimize for clarity and quick review.

## Scope

The default HUD stays a two-line local statusline. New display stays opt-in unless it fixes a wrong default. Do not add onboarding steps.

We will not take:

- `extra-cmd` in `config.json`, or raw multiline extra-cmd output. The command stays on argv behind `CLAUDE_HUD_ALLOW_EXTRA_CMD`.
- Per-window `timeFormat` knobs. Use `display.timeFormat`.
- Per-metric color slots beyond the existing `colors.*` keys.
- Timer-based fade for Skills or MCP. Use `showTools`, `showSkills`, and `showMcp`.
- A hardcoded catalog of Anthropic-compatible proxies. Use `display.providerName`.
- OS disk or other system gauges. Use `extra-cmd`.
- A HUD-side guess for advisor or multi-iteration context double-count, or for local models that omit `context_window`. Those need a same-invocation stdin fixture from Claude Code.

## Development

```bash
bun install
bun run typecheck
bun test
```

There is no build step: Bun runs `src/` directly. `bun test` runs the suite with Bun's test runner, and `bun run test:coverage` adds coverage. `tests/golden.test.js` runs the CLI end to end for every case in `tests/golden/cases.mjs` and compares stdout with `tests/golden/expected.txt`. When a change is meant to alter output, run `UPDATE_SNAPSHOTS=1 bun test` and check the diff to `expected.txt` before committing it. Keep tests deterministic: pin the clock and use temp directories.

## Pull Requests

- Keep changes focused, and describe the problem and the fix.
- Add tests for behavior changes, or explain why they aren't needed.
- Treat any text from stdin, the transcript, git, or config as untrusted: sanitize it before it reaches the terminal.
- Add a row to both `README.md` and `README.zh.md` for any new config key.
- Run `bun run typecheck` and `bun test` before opening the PR.
- Avoid new dependencies.

Releases are cut by maintainers; see [RELEASING.md](RELEASING.md).
