import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'hud-panel-'));
  const prev = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = path.join(dir, 'claude');
  try {
    return await fn(dir);
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prev;
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeJsonl(file, entries) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

const toolUse = (id, name, input, extra = {}) => ({
  type: 'assistant',
  timestamp: '2026-01-01T00:00:00.000Z',
  message: { content: [{ type: 'tool_use', id, name, input }], ...extra },
});
const toolResult = (id, toolUseResult) => ({
  type: 'user',
  timestamp: '2026-01-01T00:00:01.000Z',
  message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] },
  ...(toolUseResult ? { toolUseResult } : {}),
});

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

test('parseTranscript counts every tool use and maps task ids Claude Code assigns', async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, 'main.jsonl');
    const entries = [];
    for (let i = 0; i < 25; i++) {
      entries.push(toolUse(`b${i}`, 'Bash', { command: 'ls' }), toolResult(`b${i}`));
    }
    // A subagent already used ids 1-7 of the shared task list.
    entries.push(toolUse('c1', 'TaskCreate', { subject: 'first', description: 'x' }), toolResult('c1', { task: { id: '8' } }));
    entries.push(toolUse('c2', 'TaskCreate', { subject: 'second', description: 'x' }), toolResult('c2', { task: { id: '9' } }));
    entries.push(toolUse('u1', 'TaskUpdate', { taskId: '9', status: 'completed' }), toolResult('u1'));
    await writeJsonl(file, entries);

    const result = await parseTranscript(file);
    assert.equal(result.toolCounts.Bash, 25);
    assert.equal(result.tools.length, 20);
    assert.deepEqual(result.todos.map((todo) => todo.status), ['pending', 'completed']);
  });
});

test('parseTranscript does not count agent, todo and task-management tools in toolCounts', async () => {
  const entries = [
    toolUse('a1', 'Agent', { description: 'x' }),
    toolUse('a2', 'Task', { description: 'x' }),
    toolUse('t1', 'TodoWrite', { todos: [] }),
    toolUse('c1', 'TaskCreate', { subject: 'x' }),
    toolUse('u1', 'TaskUpdate', { taskId: '1', status: 'completed' }),
    toolUse('b1', 'Bash', { command: 'ls' }),
    toolUse('b2', 'Bash', { command: 'ls' }),
  ];
  await withTempDir(async (dir) => {
    const file = path.join(dir, 'main.jsonl');
    await writeJsonl(file, entries);
    assert.deepEqual({ ...(await parseTranscript(file)).toolCounts }, { Bash: 2 });
  });
});

test('parseTranscript counts tools named like Object.prototype members', async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, 'main.jsonl');
    await writeJsonl(file, [
      toolUse('p1', 'constructor', {}), toolResult('p1'),
      toolUse('p2', 'constructor', {}), toolResult('p2'),
      toolUse('p3', 'toString', {}), toolResult('p3'),
    ]);
    const { toolCounts } = await parseTranscript(file);
    assert.equal(toolCounts.constructor, 2);
    assert.equal(toolCounts.toString, 1);
    assert.deepEqual({ ...toolCounts }, { constructor: 2, toString: 1 });
  });
});
