# Testing Strategy

This project is small, runs in a terminal, and is mostly deterministic. The testing strategy focuses on fast, reliable checks that validate core behavior and provide a safe merge gate for PRs.

## Goals

- Validate core logic (parsing, aggregation, formatting) deterministically.
- Catch regressions in the HUD output without relying on manual review.
- Keep test execution fast (<5s) to support frequent contributor runs.

## Test Layers

1) Unit tests (fast, deterministic)
- Pure helpers: `getContextPercent`, `getModelName`, token/elapsed formatting.
- Render helpers: string assembly and truncation behavior.
- Transcript parsing: tool/agent/todo aggregation and session start detection.

2) Integration tests (CLI behavior)
- Run the CLI with a sample stdin JSON and a fixture transcript.
- Validate that the rendered output contains expected markers (model, percent, tool names).
- Keep assertions resilient to minor formatting changes (avoid strict full-line matching).

3) Golden-output tests (near-term)
- For known fixtures, compare the full output snapshot to catch subtle UI regressions.
- Update snapshots only when intentional output changes are made.

## What to Test First

- Transcript parsing (tool use/result mapping, todo extraction).
- Context percent calculation (including cache tokens).
- Truncation and aggregation (tools/todos/agents display logic).
- Malformed or partial input (bad JSON lines, missing fields).

## Fixtures

- Keep shared test data under `tests/fixtures/`.
- Use small JSONL files that capture one behavior each (e.g., basic tool flow, agent lifecycle, todo updates).

## Running Tests Locally

```bash
bun test
```

This runs the suite with Bun's test runner directly from `src/`; there is no build step.

To generate coverage:

```bash
bun run test:coverage
```

Coverage is native to Bun (`bun test --coverage`).

To update snapshots:

```bash
bun run test:update-snapshots
```

## CI Gate (recommended)

- `bun install --frozen-lockfile`
- `bun run typecheck`
- `bun test`

The provided GitHub Actions workflow runs `bun run test:coverage` on the Bun version pinned in `package.json` (`packageManager`, currently 1.4.2).

These steps should be required in PR checks to ensure new changes do not regress existing behavior.

## Contributing Expectations

- Add or update tests for behavior changes.
- Prefer unit tests for new helpers and integration tests for user-visible output changes.
- Keep tests deterministic and avoid time-dependent assertions unless controlled.
