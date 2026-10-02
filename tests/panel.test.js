import { test } from 'node:test';
import assert from 'node:assert/strict';
import { panelLines } from '../src/render/panel.js';
import { createFrame } from '../src/render/frame.js';
import { mergeConfig } from '../src/config.js';
import { setLanguage } from '../src/i18n/index.js';

function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function visibleWidth(str) {
  return Array.from(stripAnsi(str)).length;
}

function makeCtx(overrides = {}, now = Date.now()) {
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
  const NOW = Date.now();
  const lines = panelLines(createFrame(makeCtx({}, NOW), 154, NOW));
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
  const NOW = Date.now();
  const lines = panelLines(createFrame(makeCtx({}, NOW), 64, NOW));
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
  const NOW = Date.now();
  const ctx = makeCtx({ usageData: null, gitStatus: null }, NOW);
  ctx.stdin.context_window.used_percentage = 91;
  ctx.transcript.agents = [];
  ctx.transcript.toolCounts = {};
  const plain = panelLines(createFrame(ctx, 140, NOW)).map(stripAnsi);
  assert.ok(plain.some((l) => l.includes('91%') && l.includes('/compact')));
  assert.ok(plain.some((l) => l.includes('no git')));
  assert.ok(plain.some((l) => l.includes('no activity yet')));
  assert.ok(!plain.some((l) => l.includes('AGENT')));
});

const statsLine = (ctx, now) => panelLines(createFrame(ctx, 154, now)).map(stripAnsi).find((l) => l.includes('$4.82'));

test('renderPanel shows the session token total and cache share between cost and lines', () => {
  setLanguage('en');
  const NOW = Date.now();
  const ctx = makeCtx({}, NOW);
  ctx.transcript.sessionTokens = { inputTokens: 10_000, outputTokens: 40_000, cacheCreationTokens: 50_000, cacheReadTokens: 900_000 };
  assert.match(statsLine(ctx, NOW), /\$4\.82 · 1M tok \(90% cache\) · \+312 −48/);
});

test('renderPanel adds subagent tokens to the session total and cache share', () => {
  setLanguage('en');
  const NOW = Date.now();
  const ctx = makeCtx({
    subagentTokens: { inputTokens: 0, outputTokens: 100_000, cacheCreationTokens: 0, cacheReadTokens: 400_000 },
  }, NOW);
  ctx.transcript.sessionTokens = { inputTokens: 10_000, outputTokens: 40_000, cacheCreationTokens: 50_000, cacheReadTokens: 900_000 };
  assert.match(statsLine(ctx, NOW), /\$4\.82 · 1\.5M tok \(87% cache\) · \+312/);
});

test('renderPanel omits the cache share when no tokens were read from cache', () => {
  setLanguage('en');
  const NOW = Date.now();
  const ctx = makeCtx({}, NOW);
  ctx.transcript.sessionTokens = { inputTokens: 5_000, outputTokens: 7_000, cacheCreationTokens: 0, cacheReadTokens: 0 };
  assert.match(statsLine(ctx, NOW), /\$4\.82 · 12k tok · \+312/);
});

test('renderPanel omits the token segment without token data', () => {
  setLanguage('en');
  const NOW = Date.now();
  assert.match(statsLine(makeCtx({}, NOW), NOW), /\$4\.82 · \+312/);
  const empty = makeCtx({ subagentTokens: null }, NOW);
  empty.transcript.sessionTokens = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
  assert.match(statsLine(empty, NOW), /\$4\.82 · \+312/);
});

// Session box rows between its top and bottom border (wide layout: boxes share lines).
const topBoxRows = (plain) => plain.findIndex((l) => l.startsWith('╰')) - 1;
const adviceCtx = (percent, warm, inputTokens, now) => {
  const ctx = makeCtx({}, now);
  ctx.stdin.context_window.used_percentage = percent;
  ctx.stdin.context_window.current_usage = { input_tokens: inputTokens };
  ctx.stdin.prompt_cache = { warm, hit_ratio: 0.9 };
  return ctx;
};

test('renderPanel shows no advice row below the thresholds with a warm cache', () => {
  setLanguage('en');
  const NOW = Date.now();
  const plain = panelLines(createFrame(adviceCtx(54, true, 659_000, NOW), 154, NOW)).map(stripAnsi);
  assert.equal(topBoxRows(plain), 4);
  assert.ok(!plain.some((l) => l.includes('new session')));
});

test('renderPanel advises a new session in red at the critical context threshold', () => {
  setLanguage('en');
  const NOW = Date.now();
  const lines = panelLines(createFrame(adviceCtx(87, true, 10, NOW), 154, NOW));
  assert.ok(lines.some((l) => l.includes('\x1b[38;2;255;122;150m↻ new session · context 87%')));
});

test('renderPanel advises a new session in amber when a cold cache would rewrite a large context', () => {
  setLanguage('en');
  const NOW = Date.now();
  const lines = panelLines(createFrame(adviceCtx(54, false, 659_000, NOW), 154, NOW));
  assert.ok(lines.some((l) => l.includes('\x1b[38;2;245;194;107m↻ new session · cold cache, rewrites 659k')));
});

test('renderPanel advises a new session soon in amber at the warning context threshold', () => {
  setLanguage('en');
  const NOW = Date.now();
  const lines = panelLines(createFrame(adviceCtx(72, true, 10, NOW), 154, NOW));
  assert.ok(lines.some((l) => l.includes('\x1b[38;2;245;194;107m↻ new session soon · context 72%')));
});

test('renderPanel shows only the highest-priority advice', () => {
  setLanguage('en');
  const NOW = Date.now();
  const advice = (ctx) => panelLines(createFrame(ctx, 154, NOW)).map(stripAnsi).filter((l) => l.includes('↻ new session'));
  const critical = advice(adviceCtx(90, false, 900_000, NOW));
  assert.equal(critical.length, 1);
  assert.match(critical[0], /↻ new session · context 90%/);
  const cold = advice(adviceCtx(75, false, 750_000, NOW));
  assert.equal(cold.length, 1);
  assert.match(cold[0], /↻ new session · cold cache, rewrites 750k/);
});

test('renderPanel ignores a cold cache below 200k context tokens', () => {
  setLanguage('en');
  const NOW = Date.now();
  const plain = panelLines(createFrame(adviceCtx(54, false, 199_999, NOW), 154, NOW)).map(stripAnsi);
  assert.ok(!plain.some((l) => l.includes('new session')));
  assert.equal(topBoxRows(plain), 4);
});

test('renderPanel only treats an explicit warm: false as a cold cache', () => {
  setLanguage('en');
  const NOW = Date.now();
  for (const warm of [null, undefined]) {
    const plain = panelLines(createFrame(adviceCtx(54, warm, 659_000, NOW), 154, NOW)).map(stripAnsi);
    assert.ok(!plain.some((l) => l.includes('new session')), `warm: ${warm}`);
  }
});

test('renderPanel grows every wide top box to fit the advice row', () => {
  setLanguage('en');
  const NOW = Date.now();
  const lines = panelLines(createFrame(adviceCtx(87, true, 10, NOW), 154, NOW));
  const widths = new Set(lines.map(visibleWidth));
  assert.equal(widths.size, 1, `all lines share one width, got ${[...widths].join(', ')}`);
  const plain = lines.map(stripAnsi);
  assert.equal(topBoxRows(plain), 5);
  assert.match(plain[6], /^╰─+╯ ╰─+╯ ╰─+╯$/);
});

test('renderPanel shows the advice row in medium and narrow layouts', () => {
  setLanguage('en');
  const NOW = Date.now();
  const medium = panelLines(createFrame(adviceCtx(87, true, 10, NOW), 100, NOW));
  assert.equal(new Set(medium.map(visibleWidth)).size, 1);
  assert.ok(medium.map(stripAnsi).some((l) => l.includes('↻ new session · context 87%')));
  const narrow = panelLines(createFrame(adviceCtx(87, true, 10, NOW), 64, NOW)).map(stripAnsi);
  assert.ok(narrow.some((l) => l.includes('↻ new session · context 87%')));
});

test('renderPanel uses Nerd Font icons only when enabled', () => {
  const NOW = Date.now();
  const nerd = makeCtx({ config: mergeConfig({ lineLayout: 'panel', panel: { icons: 'nerd' } }) }, NOW);
  const withIcons = panelLines(createFrame(nerd, 154, NOW)).join('\n');
  const without = panelLines(createFrame(makeCtx({}, NOW), 154, NOW)).join('\n');
  assert.ok(withIcons.includes('\uE0A0'));
  assert.ok(!without.includes('\uE0A0'));
});

test('renderPanel speaks Spanish', () => {
  setLanguage('es');
  try {
    const NOW = Date.now();
    const plain = panelLines(createFrame(makeCtx({}, NOW), 154, NOW)).map(stripAnsi).join('\n');
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
    const NOW = Date.now();
    const render = (ctx) => panelLines(createFrame(ctx, 154, NOW)).map(stripAnsi).join('\n');
    const critical = adviceCtx(87, true, 10, NOW);
    critical.transcript.sessionTokens = { inputTokens: 10_000, outputTokens: 40_000, cacheCreationTokens: 50_000, cacheReadTokens: 900_000 };
    const plain = render(critical);
    assert.match(plain, /1M tok \(90% caché\)/);
    assert.match(plain, /↻ nueva sesión · contexto 87%/);
    assert.match(render(adviceCtx(54, false, 659_000, NOW)), /↻ nueva sesión · caché fría, reescribe 659k/);
    assert.match(render(adviceCtx(72, true, 10, NOW)), /↻ nueva sesión pronto · contexto 72%/);
  } finally {
    setLanguage('en');
  }
});
