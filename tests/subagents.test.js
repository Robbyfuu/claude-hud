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
  selectPanelAgents,
} from '../src/subagents.js';

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
