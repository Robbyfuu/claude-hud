import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { renderPanel, selectPanelAgents } from '../src/render/panel.js';
import {
  parseSubagentTranscript,
  readAgentDefinitionSkills,
  readSubagentDetails,
  getSubagentsDir,
  readSubagentTokenTotals,
} from '../src/subagents.js';
import { parseTranscript } from '../src/transcript.js';
import { setLanguage, t } from '../src/i18n/index.js';

function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function visibleWidth(str) {
  return Array.from(stripAnsi(str)).length;
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

function makeCtx(overrides = {}) {
  const now = Date.now();
  return {
    stdin: {
      model: { display_name: 'Opus 5.5 (1M context)' },
      cwd: '/work/clay-academy',
      context_window: {
        context_window_size: 1_000_000,
        used_percentage: 54,
        current_usage: { input_tokens: 10, cache_creation_input_tokens: 20_000, cache_read_input_tokens: 519_990 },
      },
      cost: { total_cost_usd: 4.82, total_duration_ms: (7 * 3600 + 11 * 60) * 1000, total_lines_added: 312, total_lines_removed: 48 },
      version: '2.1.270',
      prompt_cache: { warm: true, hit_ratio: 0.91 },
    },
    transcript: {
      tools: [],
      toolCounts: { Bash: 16, Edit: 1, Write: 1 },
      skills: [],
      mcpServers: [],
      mcpErrors: [],
      agents: [
        { id: 'toolu_a1', type: 'nestjs-developer', description: 'Fix K3 Task 1 review findings', status: 'running', startTime: new Date(now - 156_000) },
        { id: 'toolu_a2', type: 'code-reviewer', description: 'Review K3 Task 1 diff', status: 'completed', startTime: new Date(now - 232_000), endTime: new Date(now - 40_000) },
      ],
      todos: [
        { content: 'one', status: 'completed' },
        { content: 'two', status: 'in_progress' },
        { content: 'three', status: 'pending' },
      ],
    },
    subagents: new Map([
      ['toolu_a1', {
        skills: ['nestjs-best-practices', 'typeorm'],
        todosDone: 3,
        todosTotal: 5,
        currentTool: { name: 'Edit', target: 'monthly-days.service.ts' },
        toolCount: 9,
        contextTokens: 48_000,
      }],
    ]),
    claudeMdCount: 2,
    rulesCount: 1,
    mcpCount: 9,
    hooksCount: 17,
    sessionDuration: '7h 11m',
    gitStatus: { branch: 'feat/kids-monthly-days-selection', isDirty: true, ahead: 2, behind: 0 },
    usageData: {
      fiveHour: 5,
      sevenDay: 31,
      fiveHourResetAt: new Date(now + 2 * 3600_000),
      sevenDayResetAt: new Date(now + 3 * 86_400_000),
    },
    memoryUsage: null,
    config: mergeConfig({ lineLayout: 'panel' }),
    extraLabel: null,
    ...overrides,
  };
}

test('renderPanel draws three boxes over the activity box on wide terminals', () => {
  setLanguage('en');
  const lines = renderPanel(makeCtx(), 154);
  const plain = lines.map(stripAnsi);

  const widths = new Set(lines.map(visibleWidth));
  assert.equal(widths.size, 1, `all lines share one width, got ${[...widths].join(', ')}`);
  assert.ok([...widths][0] <= 150);

  assert.match(plain[0], /╭─ session ─+╮ ╭─ usage ─+╮ ╭─ environment ─+╮/);
  assert.ok(plain.some((l) => l.includes('Opus 5.5 · 1M')));
  assert.ok(plain.some((l) => l.includes('feat/kids-monthly-days-selection ● ↑2')));
  assert.ok(plain.some((l) => l.includes('$4.82') && l.includes('+312') && l.includes('−48')));
  assert.ok(plain.some((l) => l.includes('54%') && l.includes('540k/1M')));
  assert.ok(plain.some((l) => l.includes('CLAUDE.md') && l.includes('rules')));
  assert.ok(plain.some((l) => l.includes('Bash 16')));

  const agentRow = plain.find((l) => l.includes('nestjs-developer'));
  assert.ok(agentRow, 'running agent row');
  assert.match(agentRow, /Fix K3 Task 1 review findings/);
  assert.match(agentRow, /nestjs-best-practices \+1/);
  assert.match(agentRow, /60% 3\/5/);
  assert.match(agentRow, /Edit monthly-days/);
  assert.match(agentRow, /48k/);

  const doneRow = plain.find((l) => l.includes('code-reviewer'));
  assert.match(doneRow, /✓ code-reviewer/);
  assert.match(doneRow, /done/);
  assert.match(plain.find((l) => l.includes('running ·')), /1 running · 1 done/);
});

test('renderPanel stacks boxes and uses two lines per agent on narrow terminals', () => {
  setLanguage('en');
  const lines = renderPanel(makeCtx(), 64);
  for (const line of lines) {
    assert.ok(visibleWidth(line) <= 60, `line fits: ${stripAnsi(line)}`);
  }
  const plain = lines.map(stripAnsi);
  assert.ok(plain.some((l) => l.includes('╭─ session')));
  assert.ok(plain.some((l) => l.includes('╭─ usage')));
  assert.ok(plain.some((l) => l.includes('environment  2 CLAUDE.md')));
  const nameIndex = plain.findIndex((l) => l.includes('nestjs-developer'));
  assert.match(plain[nameIndex + 1], /Fix K3 Task 1 review findings → Edit/);
});

test('renderPanel flags a critical context with /compact and handles missing data', () => {
  setLanguage('en');
  const ctx = makeCtx({ usageData: null, gitStatus: null });
  ctx.stdin.context_window.used_percentage = 91;
  ctx.transcript.agents = [];
  ctx.transcript.toolCounts = {};
  const plain = renderPanel(ctx, 140).map(stripAnsi);
  assert.ok(plain.some((l) => l.includes('91%') && l.includes('/compact')));
  assert.ok(plain.some((l) => l.includes('no git')));
  assert.ok(plain.some((l) => l.includes('no activity yet')));
  assert.ok(!plain.some((l) => l.includes('AGENT')));
});

const statsLine = (ctx) => renderPanel(ctx, 154).map(stripAnsi).find((l) => l.includes('$4.82'));

test('renderPanel shows the session token total and cache share between cost and lines', () => {
  setLanguage('en');
  const ctx = makeCtx();
  ctx.transcript.sessionTokens = { inputTokens: 10_000, outputTokens: 40_000, cacheCreationTokens: 50_000, cacheReadTokens: 900_000 };
  assert.match(statsLine(ctx), /\$4\.82 · 1M tok \(90% cache\) · \+312 −48/);
});

test('renderPanel adds subagent tokens to the session total and cache share', () => {
  setLanguage('en');
  const ctx = makeCtx({
    subagentTokens: { inputTokens: 0, outputTokens: 100_000, cacheCreationTokens: 0, cacheReadTokens: 400_000 },
  });
  ctx.transcript.sessionTokens = { inputTokens: 10_000, outputTokens: 40_000, cacheCreationTokens: 50_000, cacheReadTokens: 900_000 };
  assert.match(statsLine(ctx), /\$4\.82 · 1\.5M tok \(87% cache\) · \+312/);
});

test('renderPanel omits the cache share when no tokens were read from cache', () => {
  setLanguage('en');
  const ctx = makeCtx();
  ctx.transcript.sessionTokens = { inputTokens: 5_000, outputTokens: 7_000, cacheCreationTokens: 0, cacheReadTokens: 0 };
  assert.match(statsLine(ctx), /\$4\.82 · 12k tok · \+312/);
});

test('renderPanel omits the token segment without token data', () => {
  setLanguage('en');
  assert.match(statsLine(makeCtx()), /\$4\.82 · \+312/);
  const empty = makeCtx({ subagentTokens: null });
  empty.transcript.sessionTokens = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
  assert.match(statsLine(empty), /\$4\.82 · \+312/);
});

// Session box rows between its top and bottom border (wide layout: boxes share lines).
const topBoxRows = (plain) => plain.findIndex((l) => l.startsWith('╰')) - 1;
const adviceCtx = (percent, warm, inputTokens = 10) => {
  const ctx = makeCtx();
  ctx.stdin.context_window.used_percentage = percent;
  ctx.stdin.context_window.current_usage = { input_tokens: inputTokens };
  ctx.stdin.prompt_cache = { warm, hit_ratio: 0.9 };
  return ctx;
};

test('renderPanel shows no advice row below the thresholds with a warm cache', () => {
  setLanguage('en');
  const plain = renderPanel(adviceCtx(54, true, 659_000), 154).map(stripAnsi);
  assert.equal(topBoxRows(plain), 4);
  assert.ok(!plain.some((l) => l.includes('new session')));
});

test('renderPanel advises a new session in red at the critical context threshold', () => {
  setLanguage('en');
  const lines = renderPanel(adviceCtx(87, true), 154);
  assert.ok(lines.some((l) => l.includes('\x1b[38;2;255;122;150m↻ new session · context 87%')));
});

test('renderPanel advises a new session in amber when a cold cache would rewrite a large context', () => {
  setLanguage('en');
  const lines = renderPanel(adviceCtx(54, false, 659_000), 154);
  assert.ok(lines.some((l) => l.includes('\x1b[38;2;245;194;107m↻ new session · cold cache, rewrites 659k')));
});

test('renderPanel advises a new session soon in amber at the warning context threshold', () => {
  setLanguage('en');
  const lines = renderPanel(adviceCtx(72, true), 154);
  assert.ok(lines.some((l) => l.includes('\x1b[38;2;245;194;107m↻ new session soon · context 72%')));
});

test('renderPanel shows only the highest-priority advice', () => {
  setLanguage('en');
  const advice = (ctx) => renderPanel(ctx, 154).map(stripAnsi).filter((l) => l.includes('↻ new session'));
  const critical = advice(adviceCtx(90, false, 900_000));
  assert.equal(critical.length, 1);
  assert.match(critical[0], /↻ new session · context 90%/);
  const cold = advice(adviceCtx(75, false, 750_000));
  assert.equal(cold.length, 1);
  assert.match(cold[0], /↻ new session · cold cache, rewrites 750k/);
});

test('renderPanel ignores a cold cache below 200k context tokens', () => {
  setLanguage('en');
  const plain = renderPanel(adviceCtx(54, false, 199_999), 154).map(stripAnsi);
  assert.ok(!plain.some((l) => l.includes('new session')));
  assert.equal(topBoxRows(plain), 4);
});

test('renderPanel only treats an explicit warm: false as a cold cache', () => {
  setLanguage('en');
  for (const warm of [null, undefined]) {
    const plain = renderPanel(adviceCtx(54, warm, 659_000), 154).map(stripAnsi);
    assert.ok(!plain.some((l) => l.includes('new session')), `warm: ${warm}`);
  }
});

test('renderPanel grows every wide top box to fit the advice row', () => {
  setLanguage('en');
  const lines = renderPanel(adviceCtx(87, true), 154);
  const widths = new Set(lines.map(visibleWidth));
  assert.equal(widths.size, 1, `all lines share one width, got ${[...widths].join(', ')}`);
  const plain = lines.map(stripAnsi);
  assert.equal(topBoxRows(plain), 5);
  assert.match(plain[6], /^╰─+╯ ╰─+╯ ╰─+╯$/);
});

test('renderPanel shows the advice row in medium and narrow layouts', () => {
  setLanguage('en');
  const medium = renderPanel(adviceCtx(87, true), 100);
  assert.equal(new Set(medium.map(visibleWidth)).size, 1);
  assert.ok(medium.map(stripAnsi).some((l) => l.includes('↻ new session · context 87%')));
  const narrow = renderPanel(adviceCtx(87, true), 64).map(stripAnsi);
  assert.ok(narrow.some((l) => l.includes('↻ new session · context 87%')));
});

test('renderPanel uses Nerd Font icons only when enabled', () => {
  const withIcons = renderPanel(makeCtx({ config: mergeConfig({ lineLayout: 'panel', panel: { icons: 'nerd' } }) }), 154).join('\n');
  const without = renderPanel(makeCtx(), 154).join('\n');
  assert.ok(withIcons.includes('\uE0A0'));
  assert.ok(!without.includes('\uE0A0'));
});

test('renderPanel speaks Spanish', () => {
  setLanguage('es');
  try {
    const plain = renderPanel(makeCtx(), 154).map(stripAnsi).join('\n');
    assert.match(plain, /╭─ sesión/);
    assert.match(plain, /╭─ consumo/);
    assert.match(plain, /AGENTE/);
    assert.match(plain, /1 activo · 1 listo/);
  } finally {
    setLanguage('en');
  }
});

test('renderPanel speaks Spanish in the token segment and advice row', () => {
  setLanguage('es');
  try {
    const render = (ctx) => renderPanel(ctx, 154).map(stripAnsi).join('\n');
    const critical = adviceCtx(87, true);
    critical.transcript.sessionTokens = { inputTokens: 10_000, outputTokens: 40_000, cacheCreationTokens: 50_000, cacheReadTokens: 900_000 };
    const plain = render(critical);
    assert.match(plain, /1M tok \(90% caché\)/);
    assert.match(plain, /↻ nueva sesión · contexto 87%/);
    assert.match(render(adviceCtx(54, false, 659_000)), /↻ nueva sesión · caché fría, reescribe 659k/);
    assert.match(render(adviceCtx(72, true)), /↻ nueva sesión pronto · contexto 72%/);
  } finally {
    setLanguage('en');
  }
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
      cacheCreationOneHourTokens: 250,
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
