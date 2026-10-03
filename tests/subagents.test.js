import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mergeConfig } from '../src/config.js';
import { getHomeDir, getHudPluginDir } from '../src/claude-config-dir.js';
import {
  parseSubagentTranscript,
  readAgentDefinitionSkills,
  readSubagentDetails,
  getSubagentsDir,
  readSubagentTokenTotals,
} from '../src/subagents.js';
import { selectPanelAgents } from '../src/panel-agents.js';

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

test('selectPanelAgents keeps running agents first and drops stale completed ones', () => {
  const now = Date.parse('2026-01-01T01:00:00.000Z');
  const at = (s) => new Date(now - s * 1000);
  const agents = [
    { id: 'old', status: 'completed', startTime: at(900), endTime: at(600) },
    { id: 'recent', status: 'completed', startTime: at(300), endTime: at(30) },
    { id: 'r1', status: 'running', startTime: at(100) },
    { id: 'r2', status: 'running', startTime: at(50) },
  ];
  const config = mergeConfig({ panel: { maxAgents: 2 } });
  assert.deepEqual(selectPanelAgents(agents, config, now).shown.map((a) => a.id), ['r1', 'r2']);

  const roomy = mergeConfig({ panel: { maxAgents: 5 } });
  assert.deepEqual(selectPanelAgents(agents, roomy, now).shown.map((a) => a.id), ['r1', 'r2', 'recent']);

  const tight = mergeConfig({ panel: { maxAgents: 1 } });
  const result = selectPanelAgents(agents, tight, now);
  assert.deepEqual(result.shown.map((a) => a.id), ['r2']);
  assert.equal(result.hiddenRunning, 1);
});

test('parseSubagentTranscript reads tasks, skills, current tool and context size', async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, 'agent-x.jsonl');
    await writeJsonl(file, [
      toolUse('t1', 'TaskCreate', { subject: 'a', description: 'a' }),
      toolResult('t1', { task: { id: '8' } }),
      toolUse('t2', 'TaskCreate', { subject: 'b', description: 'b' }),
      toolResult('t2', { task: { id: '9' } }),
      toolUse('t3', 'TaskUpdate', { taskId: '8', status: 'completed' }),
      toolResult('t3'),
      toolUse('t4', 'Skill', { skill: 'humanizer:humanizer' }),
      toolResult('t4'),
      toolUse('t5', 'Edit', { file_path: '/p/src/kids/monthly-days.service.ts' }, {
        usage: { input_tokens: 10, cache_read_input_tokens: 41_836, cache_creation_input_tokens: 7_107, output_tokens: 99 },
      }),
    ]);
    const detail = parseSubagentTranscript(file);
    assert.equal(detail.todosDone, 1);
    assert.equal(detail.todosTotal, 2);
    assert.deepEqual(detail.skills, ['humanizer:humanizer']);
    assert.deepEqual(detail.currentTool, { name: 'Edit', target: 'monthly-days.service.ts' });
    assert.equal(detail.contextTokens, 48_953);
    assert.equal(detail.toolCount, 2);
  });
});

test('parseSubagentTranscript falls back to TodoWrite lists', async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, 'agent-y.jsonl');
    await writeJsonl(file, [
      toolUse('t1', 'TodoWrite', { todos: [
        { content: 'a', status: 'completed' },
        { content: 'b', status: 'in_progress' },
        { content: 'c', status: 'pending' },
        { content: 'd', status: 'pending' },
      ] }),
      toolResult('t1'),
    ]);
    const detail = parseSubagentTranscript(file);
    assert.equal(detail.todosDone, 1);
    assert.equal(detail.todosTotal, 4);
    assert.equal(detail.currentTool, undefined);
  });
});

test('readAgentDefinitionSkills reads YAML-list and comma-separated skills', async () => {
  await withTempDir(async (dir) => {
    const project = path.join(dir, 'project');
    await mkdir(path.join(project, '.claude', 'agents'), { recursive: true });
    await writeFile(
      path.join(project, '.claude', 'agents', 'nestjs.md'),
      '---\nname: nestjs-developer\ndescription: x\nskills:\n  - nestjs-best-practices\n  - typeorm\n---\nbody\n',
    );
    await mkdir(path.join(dir, 'claude', 'agents'), { recursive: true });
    await writeFile(
      path.join(dir, 'claude', 'agents', 'reviewer.md'),
      '---\nname: reviewer\nskills: code-review, security\n---\n',
    );
    assert.deepEqual(readAgentDefinitionSkills('nestjs-developer', path.join(project, 'src')), ['nestjs-best-practices', 'typeorm']);
    assert.deepEqual(readAgentDefinitionSkills('reviewer', project), ['code-review', 'security']);
    assert.deepEqual(readAgentDefinitionSkills('general-purpose', project), []);
  });
});

test('readSubagentDetails maps agents to transcripts through meta.json toolUseId', async () => {
  await withTempDir(async (dir) => {
    const transcriptPath = path.join(dir, 'projects', 'p', 'sess.jsonl');
    await writeJsonl(transcriptPath, []);
    const subagentsDir = getSubagentsDir(transcriptPath);
    assert.equal(subagentsDir, path.join(dir, 'projects', 'p', 'sess', 'subagents'));
    await writeJsonl(path.join(subagentsDir, 'agent-abc.jsonl'), [
      toolUse('s1', 'Skill', { skill: 'testing-strategy' }),
      toolResult('s1'),
      toolUse('s2', 'Read', { file_path: '/p/test/kids.e2e-spec.ts' }),
    ]);
    await writeFile(
      path.join(subagentsDir, 'agent-abc.meta.json'),
      JSON.stringify({ agentType: 'test-writer', description: 'e2e', toolUseId: 'toolu_spawn' }),
    );
    const details = readSubagentDetails(transcriptPath, [
      { id: 'toolu_spawn', type: 'test-writer', status: 'running', startTime: new Date() },
      { id: 'toolu_unknown', type: 'other', status: 'running', startTime: new Date() },
    ], dir);
    assert.deepEqual(details.get('toolu_spawn').skills, ['testing-strategy']);
    assert.deepEqual(details.get('toolu_spawn').currentTool, { name: 'Read', target: 'kids.e2e-spec.ts' });
    assert.equal(details.get('toolu_unknown').toolCount, 0);
  });
});

test('readSubagentDetails maps background teammates through meta.json name', async () => {
  await withTempDir(async (dir) => {
    const transcriptPath = path.join(dir, 'projects', 'p', 'sess.jsonl');
    await writeJsonl(transcriptPath, []);
    const subagentsDir = getSubagentsDir(transcriptPath);
    // Teammate metas carry no toolUseId; the Agent `name` input is the only link.
    await writeJsonl(path.join(subagentsDir, 'agent-ak3-t5-old.jsonl'), [
      toolUse('o1', 'Grep', { pattern: 'stale' }),
    ]);
    await writeFile(
      path.join(subagentsDir, 'agent-ak3-t5-old.meta.json'),
      JSON.stringify({ agentType: 'k3-t5', name: 'k3-t5', taskKind: 'in_process_teammate' }),
    );
    const older = new Date(Date.now() - 60_000);
    await utimes(path.join(subagentsDir, 'agent-ak3-t5-old.meta.json'), older, older);
    await writeJsonl(path.join(subagentsDir, 'agent-ak3-t5-new.jsonl'), [
      toolUse('s1', 'Skill', { skill: 'tdd' }),
      toolResult('s1'),
      toolUse('s2', 'Edit', { file_path: '/p/src/monthly-days.service.ts' }),
    ]);
    await writeFile(
      path.join(subagentsDir, 'agent-ak3-t5-new.meta.json'),
      JSON.stringify({ agentType: 'k3-t5', name: 'k3-t5', taskKind: 'in_process_teammate' }),
    );
    const details = readSubagentDetails(transcriptPath, [
      { id: 'toolu_spawn', type: 'nestjs-developer', name: 'k3-t5', status: 'running', startTime: new Date() },
    ], dir);
    assert.deepEqual(details.get('toolu_spawn').skills, ['tdd']);
    assert.deepEqual(details.get('toolu_spawn').currentTool, { name: 'Edit', target: 'monthly-days.service.ts' });
  });
});

const usageLine = (id, input, output, cacheCreation, cacheRead, cacheCreationOneHour = 0) => ({
  type: 'assistant',
  message: {
    id,
    content: [],
    usage: {
      input_tokens: input,
      output_tokens: output,
      cache_creation_input_tokens: cacheCreation,
      cache_read_input_tokens: cacheRead,
      cache_creation: { ephemeral_1h_input_tokens: cacheCreationOneHour },
    },
  },
});

test('readSubagentTokenTotals sums token usage across subagent transcripts', async () => {
  await withTempDir(async (dir) => {
    const transcriptPath = path.join(dir, 'projects', 'p', 'sess.jsonl');
    await writeJsonl(transcriptPath, []);
    const subagentsDir = getSubagentsDir(transcriptPath);
    await writeJsonl(path.join(subagentsDir, 'agent-a.jsonl'), [
      usageLine('msg_a1', 10, 20, 30, 40),
      usageLine('msg_a1', 10, 20, 30, 40), // dual-logged duplicate
      usageLine('msg_a2', 1, 2, 3, 4),
    ]);
    await writeJsonl(path.join(subagentsDir, 'agent-b.jsonl'), [usageLine('msg_b1', 100, 200, 300, 400, 250)]);
    await mkdir(path.join(subagentsDir, 'agent-broken.jsonl'));
    assert.deepEqual(await readSubagentTokenTotals(transcriptPath), {
      inputTokens: 111,
      outputTokens: 222,
      cacheCreationTokens: 333,
      cacheReadTokens: 444,
    });
  });
});

test('readSubagentTokenTotals returns null without subagent transcripts', async () => {
  await withTempDir(async (dir) => {
    const transcriptPath = path.join(dir, 'projects', 'p', 'sess.jsonl');
    await writeJsonl(transcriptPath, []);
    assert.equal(await readSubagentTokenTotals(transcriptPath), null);
    const subagentsDir = getSubagentsDir(transcriptPath);
    await mkdir(subagentsDir, { recursive: true });
    await writeFile(path.join(subagentsDir, 'agent-a.meta.json'), '{}');
    assert.equal(await readSubagentTokenTotals(transcriptPath), null);
  });
});

test('readSubagentTokenTotals ignores an empty transcript path instead of reading ./subagents', async () => {
  await withTempDir(async (dir) => {
    await writeJsonl(path.join(dir, 'subagents', 'agent-a.jsonl'), [usageLine('msg_1', 1, 1, 1, 1)]);
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      assert.equal(await readSubagentTokenTotals(''), null);
    } finally {
      process.chdir(cwd);
    }
  });
});

test('readSubagentDetails tolerates a truncated transcript line and an invalid meta file', async () => {
  await withTempDir(async (dir) => {
    const transcriptPath = path.join(dir, 'projects', 'p', 'sess.jsonl');
    await writeJsonl(transcriptPath, []);
    const subagentsDir = getSubagentsDir(transcriptPath);
    await writeJsonl(path.join(subagentsDir, 'agent-a.jsonl'), [
      toolUse('s1', 'Read', { file_path: '/p/one.ts' }),
      toolResult('s1'),
      toolUse('s2', 'Edit', { file_path: '/p/two.ts' }),
    ]);
    fs.appendFileSync(path.join(subagentsDir, 'agent-a.jsonl'), '{"type":"assistant","message":{"con');
    await writeFile(
      path.join(subagentsDir, 'agent-a.meta.json'),
      JSON.stringify({ agentType: 'x', toolUseId: 'toolu_a' }),
    );
    await writeJsonl(path.join(subagentsDir, 'agent-b.jsonl'), [toolUse('s3', 'Read', { file_path: '/p/b.ts' })]);
    await writeFile(path.join(subagentsDir, 'agent-b.meta.json'), '{not json');
    const details = readSubagentDetails(transcriptPath, [
      { id: 'toolu_a', type: 'x', status: 'running', startTime: new Date() },
      { id: 'toolu_b', type: 'x', status: 'running', startTime: new Date() },
    ], dir);
    assert.equal(details.get('toolu_a').toolCount, 2);
    // The invalid meta leaves agent-b unmapped: toolu_b gets an empty detail, not agent-b's transcript.
    assert.equal(details.get('toolu_b').toolCount, 0);
  });
});

const tokenCachePath = (subagentsDir) => path.join(
  getHudPluginDir(getHomeDir()),
  'subagent-tokens',
  `${createHash('sha1').update(subagentsDir).digest('hex').slice(0, 16)}.json`,
);

test('readSubagentTokenTotals reuses cached tokens for unchanged subagent transcripts', async () => {
  await withTempDir(async (dir) => {
    const transcriptPath = path.join(dir, 'projects', 'p', 'sess.jsonl');
    await writeJsonl(transcriptPath, []);
    const subagentsDir = getSubagentsDir(transcriptPath);
    await writeJsonl(path.join(subagentsDir, 'agent-a.jsonl'), [usageLine('msg_a1', 10, 20, 30, 40)]);
    assert.equal((await readSubagentTokenTotals(transcriptPath)).inputTokens, 10);
    const cacheFile = tokenCachePath(subagentsDir);
    const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    cache.files['agent-a.jsonl'].tokens.inputTokens = 777;
    fs.writeFileSync(cacheFile, JSON.stringify(cache));
    assert.equal((await readSubagentTokenTotals(transcriptPath)).inputTokens, 777);
  });
});

test('readSubagentTokenTotals re-parses a subagent transcript whose size changed', async () => {
  await withTempDir(async (dir) => {
    const transcriptPath = path.join(dir, 'projects', 'p', 'sess.jsonl');
    await writeJsonl(transcriptPath, []);
    const subagentsDir = getSubagentsDir(transcriptPath);
    const file = path.join(subagentsDir, 'agent-a.jsonl');
    await writeJsonl(file, [usageLine('msg_a1', 10, 20, 30, 40)]);
    assert.equal((await readSubagentTokenTotals(transcriptPath)).inputTokens, 10);
    fs.appendFileSync(file, JSON.stringify(usageLine('msg_a2', 5, 5, 5, 5)) + '\n');
    assert.equal((await readSubagentTokenTotals(transcriptPath)).inputTokens, 15);
  });
});

test('readSubagentTokenTotals ignores a corrupt cache file', async () => {
  await withTempDir(async (dir) => {
    const transcriptPath = path.join(dir, 'projects', 'p', 'sess.jsonl');
    await writeJsonl(transcriptPath, []);
    const subagentsDir = getSubagentsDir(transcriptPath);
    await writeJsonl(path.join(subagentsDir, 'agent-a.jsonl'), [usageLine('msg_a1', 10, 20, 30, 40)]);
    const cacheFile = tokenCachePath(subagentsDir);
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, '{not json');
    assert.equal((await readSubagentTokenTotals(transcriptPath)).inputTokens, 10);
  });
});

test('readSubagentTokenTotals ignores cache entries smuggled through a __proto__ key', async () => {
  await withTempDir(async (dir) => {
    const transcriptPath = path.join(dir, 'projects', 'p', 'sess.jsonl');
    await writeJsonl(transcriptPath, []);
    const subagentsDir = getSubagentsDir(transcriptPath);
    const file = path.join(subagentsDir, 'agent-a.jsonl');
    await writeJsonl(file, [usageLine('msg_a1', 10, 20, 30, 40)]);
    const { size, mtimeMs } = fs.statSync(file);
    const bad = `{"size":${size},"mtimeMs":${mtimeMs},"tokens":{"inputTokens":"\\u001b[31mX","outputTokens":-5,"cacheCreationTokens":0,"cacheReadTokens":"7"}}`;
    const cacheFile = tokenCachePath(subagentsDir);
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, `{"version":1,"files":{"__proto__":{"size":1,"mtimeMs":1,"tokens":{"inputTokens":1,"outputTokens":1,"cacheCreationTokens":1,"cacheReadTokens":1},"agent-a.jsonl":${bad}}}}`);
    assert.deepEqual(await readSubagentTokenTotals(transcriptPath), {
      inputTokens: 10,
      outputTokens: 20,
      cacheCreationTokens: 30,
      cacheReadTokens: 40,
    });
    assert.doesNotMatch(fs.readFileSync(cacheFile, 'utf8'), /__proto__/);
  });
});

test('readSubagentDetails tolerates a non-string agent type', async () => {
  await withTempDir(async (dir) => {
    const transcriptPath = path.join(dir, 'projects', 'p', 'sess.jsonl');
    await writeJsonl(transcriptPath, []);
    const details = readSubagentDetails(transcriptPath, [
      { id: 'toolu_a', type: 5, status: 'running', startTime: new Date() },
    ], dir);
    assert.ok(details.get('toolu_a'));
  });
});

test('parseSubagentTranscript skips null content blocks', async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, 'agent-x.jsonl');
    await writeJsonl(file, [{
      type: 'assistant',
      timestamp: '2026-01-01T00:00:00.000Z',
      message: { content: [null, 'text', { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/p/a.ts' } }] },
    }]);
    const detail = parseSubagentTranscript(file);
    assert.equal(detail.toolCount, 1);
  });
});


test('readAgentDefinitionSkills ignores a plugin name that escapes the plugin cache', async () => {
  await withTempDir(async (dir) => {
    // <claude>/plugins/cache/<marketplace>/<plugin>/<version>/agents; ../../../../outside from <marketplace> reaches <claude>/outside
    await mkdir(path.join(dir, 'claude', 'plugins', 'cache', 'mkt'), { recursive: true });
    const leak = path.join(dir, 'claude', 'plugins', 'outside', 'v1', 'agents');
    await mkdir(leak, { recursive: true });
    await writeFile(path.join(leak, 'secret.md'), '---\nname: secret-agent\nskills: [LEAKED]\n---\n');
    const skills = readAgentDefinitionSkills('../../outside:secret-agent', dir);
    assert.ok(!skills.includes('LEAKED'));
    assert.deepEqual(readAgentDefinitionSkills('../../outside:secret-agent', dir), []);
  });
});

const at = (iso, entry) => ({ ...entry, timestamp: iso });

test('parseSubagentTranscript advances lastActivityAt on a tool_result entry', async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, 'agent-act.jsonl');
    await writeJsonl(file, [
      at('2026-01-01T00:00:00.000Z', toolUse('t1', 'Bash', { command: 'sleep 360' })),
      at('2026-01-01T00:06:00.000Z', toolResult('t1')),
    ]);
    const detail = parseSubagentTranscript(file);
    assert.equal(detail.lastActivityAt.toISOString(), '2026-01-01T00:06:00.000Z');
  });
});

test('parseSubagentTranscript reports hasPendingTool for quiet tools without a currentTool', async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, 'agent-quiet.jsonl');
    await writeJsonl(file, [toolUse('t1', 'TodoWrite', { todos: [] })]);
    const quiet = parseSubagentTranscript(file);
    assert.equal(quiet.currentTool, undefined);
    assert.equal(quiet.hasPendingTool, true);

    await writeJsonl(file, [toolUse('t1', 'TodoWrite', { todos: [] }), toolResult('t1')]);
    assert.equal(parseSubagentTranscript(file).hasPendingTool, false);

    await writeJsonl(file, [toolUse('t2', 'Bash', { command: 'ls' })]);
    const loud = parseSubagentTranscript(file);
    assert.equal(loud.hasPendingTool, true);
    assert.equal(loud.currentTool.name, 'Bash');
  });
});

test('parseSubagentTranscript keeps a long MCP tool name whole', async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, 'agent-mcp.jsonl');
    const name = 'mcp__plugin_context-mode_context-mode__ctx_execute';
    await writeJsonl(file, [toolUse('t1', name, {})]);
    assert.equal(parseSubagentTranscript(file).currentTool.name, name);
  });
});

test('parseSubagentTranscript takes the last line timestamp even when the prefilter skips it', async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, 'agent-last.jsonl');
    await writeJsonl(file, [
      at('2026-01-01T00:00:00.000Z', toolUse('t1', 'Bash', { command: 'ls' })),
      at('2026-01-01T00:00:00.000Z', toolResult('t1')),
      { type: 'user', timestamp: '2026-01-01T00:06:00.000Z', message: { role: 'user', content: 'keep going' } },
    ]);
    const detail = parseSubagentTranscript(file);
    assert.equal(detail.lastActivityAt.toISOString(), '2026-01-01T00:06:00.000Z');
  });
});

test('parseSubagentTranscript reads the last line\'s own timestamp, not one nested in its content', async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, 'agent-nested.jsonl');
    await writeJsonl(file, [
      at('2026-01-01T00:00:00.000Z', toolUse('t1', 'Bash', { command: 'ls' })),
      at('2026-01-01T00:00:00.000Z', toolResult('t1')),
      {
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: 'log', meta: { timestamp: '2025-06-01T00:00:00.000Z' } }] },
        timestamp: '2026-01-01T00:06:00.000Z',
      },
    ]);
    const detail = parseSubagentTranscript(file);
    assert.equal(detail.lastActivityAt.toISOString(), '2026-01-01T00:06:00.000Z');
  });
});

test('readSubagentTokenTotals does not cache a non-empty transcript that parsed to zero tokens', async () => {
  await withTempDir(async (dir) => {
    const transcriptPath = path.join(dir, 'projects', 'p', 'sess.jsonl');
    await writeJsonl(transcriptPath, []);
    const subagentsDir = getSubagentsDir(transcriptPath);
    await writeJsonl(path.join(subagentsDir, 'agent-a.jsonl'), [{ type: 'user', message: { role: 'user', content: 'hello' } }]);
    await writeJsonl(path.join(subagentsDir, 'agent-b.jsonl'), [usageLine('msg_b1', 10, 20, 30, 40)]);
    assert.equal((await readSubagentTokenTotals(transcriptPath)).inputTokens, 10);
    const cache = JSON.parse(fs.readFileSync(tokenCachePath(subagentsDir), 'utf8'));
    assert.equal('agent-a.jsonl' in cache.files, false);
    assert.equal('agent-b.jsonl' in cache.files, true);
  });
});

async function cacheKeyScenario(mutate) {
  return withTempDir(async (dir) => {
    const transcriptPath = path.join(dir, 'projects', 'p', 'sess.jsonl');
    await writeJsonl(transcriptPath, []);
    const subagentsDir = getSubagentsDir(transcriptPath);
    const file = path.join(subagentsDir, 'agent-a.jsonl');
    await writeJsonl(file, [usageLine('msg_a1', 10, 20, 30, 40)]);
    fs.utimesSync(file, 1_700_000_000, 1_700_000_000); // whole-second mtime so it can be restored exactly
    await readSubagentTokenTotals(transcriptPath);
    const cacheFile = tokenCachePath(subagentsDir);
    const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    cache.files['agent-a.jsonl'].tokens.inputTokens = 777; // sentinel: shows up only on a cache hit
    fs.writeFileSync(cacheFile, JSON.stringify(cache));
    const before = fs.statSync(file);
    mutate(file, before);
    return (await readSubagentTokenTotals(transcriptPath)).inputTokens;
  });
}

test('readSubagentTokenTotals re-parses when only the mtime changed', async () => {
  const input = await cacheKeyScenario((file, st) => {
    fs.utimesSync(file, st.atime, new Date(st.mtimeMs + 5000));
  });
  assert.equal(input, 10);
});

test('readSubagentTokenTotals re-parses when only the size changed', async () => {
  const input = await cacheKeyScenario((file, st) => {
    fs.appendFileSync(file, '\n');
    fs.utimesSync(file, 1_700_000_000, 1_700_000_000);
  });
  assert.equal(input, 10);
});
