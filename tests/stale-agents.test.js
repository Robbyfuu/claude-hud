import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseTranscript } from '../src/transcript.js';

async function parse(entries) {
  const dir = await mkdtemp(path.join(tmpdir(), 'hud-stale-agents-'));
  const prev = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  try {
    const file = path.join(dir, 'transcript.jsonl');
    await writeFile(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
    return await parseTranscript(file);
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prev;
    await rm(dir, { recursive: true, force: true });
  }
}

const launch = (id, ts, input) => ({
  timestamp: ts,
  message: { content: [{ type: 'tool_use', id, name: 'Agent', input: { run_in_background: true, ...input } }] },
});
const sessionStart = (ts, source) => ({
  timestamp: ts,
  type: 'attachment',
  attachment: { type: 'hook_success', hookName: `SessionStart:${source}` },
});
const teammateIdle = (ts, name) => ({
  timestamp: ts,
  type: 'user',
  message: {
    role: 'user',
    content: `Another Claude session sent a message:\n<teammate-message teammate_id="${name}" color="blue">\n{"type":"idle_notification","from":"${name}"}\n</teammate-message>`,
  },
});

test('background agents launched before a resume are no longer running', async () => {
  const result = await parse([
    launch('a-old', '2024-01-01T00:00:00.000Z', { name: 'old' }),
    sessionStart('2024-01-01T01:00:00.000Z', 'resume'),
    launch('a-new', '2024-01-01T01:05:00.000Z', { name: 'new' }),
  ]);
  const byId = Object.fromEntries(result.agents.map((a) => [a.id, a]));
  assert.equal(byId['a-old'].status, 'completed');
  assert.equal(byId['a-old'].endTime?.toISOString(), '2024-01-01T01:00:00.000Z');
  assert.equal(byId['a-new'].status, 'running');
});

test('a compact does not end background agents (same process)', async () => {
  const result = await parse([
    launch('a-1', '2024-01-01T00:00:00.000Z', { name: 'one' }),
    sessionStart('2024-01-01T01:00:00.000Z', 'compact'),
  ]);
  assert.equal(result.agents[0].status, 'running');
});

test('a teammate idle notification completes the named background agent', async () => {
  const result = await parse([
    launch('a-1', '2024-01-01T00:00:00.000Z', { name: 'mapper' }),
    launch('a-2', '2024-01-01T00:00:01.000Z', { name: 'builder' }),
    teammateIdle('2024-01-01T00:03:00.000Z', 'mapper'),
  ]);
  const byId = Object.fromEntries(result.agents.map((a) => [a.id, a]));
  assert.equal(byId['a-1'].status, 'completed');
  assert.equal(byId['a-1'].endTime?.toISOString(), '2024-01-01T00:03:00.000Z');
  assert.equal(byId['a-2'].status, 'running');
});

test('an idle notification before the launch does not complete a relaunch with the same name', async () => {
  const result = await parse([
    teammateIdle('2024-01-01T00:00:00.000Z', 'mapper'),
    launch('a-1', '2024-01-01T00:01:00.000Z', { name: 'mapper' }),
  ]);
  assert.equal(result.agents[0].status, 'running');
});
