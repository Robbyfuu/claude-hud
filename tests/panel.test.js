import { test } from 'node:test';
import assert from 'node:assert/strict';
import { panelLines, formatCount } from '../src/render/panel.js';
import { createFrame } from '../src/render/frame.js';
import { mergeConfig } from '../src/config.js';
import { setLanguage } from '../src/i18n/index.js';
import { textWidth } from '../src/render/ansi.js';

function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function visibleWidth(str) {
  return Array.from(stripAnsi(str)).length;
}

// Terminal cells, so wide CJK and emoji count double.
const cellWidth = (str) => textWidth(stripAnsi(str));

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
  const plain = panelLines(createFrame(ctx, 200, NOW)).map(stripAnsi);
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

const RED = '38;2;255;122;150';
const AMBER = '38;2;245;194;107';
const DIM = '38;2;138;132;160';
const paceCtx = (usageData, now, display = { usagePace: true }) =>
  makeCtx({ usageData, config: mergeConfig({ lineLayout: 'panel', display }) }, now);
const usageLine = (ctx, now, name) =>
  panelLines(createFrame(ctx, 154, now)).find((l) => stripAnsi(l).includes(`│ ${name} `));

test('renderPanel marks a critical 5h pace with ▲ in red', () => {
  setLanguage('en');
  const NOW = Date.now();
  const ctx = paceCtx({ fiveHour: 60, sevenDay: 31, fiveHourResetAt: new Date(NOW + 4 * 3600_000), sevenDayResetAt: new Date(NOW + 3 * 86_400_000) }, NOW);
  const line = usageLine(ctx, NOW, '5 hours');
  assert.ok(line.includes(`\x1b[1;${RED}m60%▲`), stripAnsi(line));
  assert.ok(line.includes(`\x1b[${RED}m▇`), 'bar painted red');
});

test('renderPanel omits the pace marker at 100% even under a critical pace', () => {
  setLanguage('en');
  const NOW = Date.now();
  const ctx = paceCtx({ fiveHour: 100, sevenDay: 31, fiveHourResetAt: new Date(NOW + 4 * 3600_000), sevenDayResetAt: new Date(NOW + 3 * 86_400_000) }, NOW);
  const text = stripAnsi(usageLine(ctx, NOW, '5 hours'));
  assert.ok(text.includes('100%'), text);
  assert.ok(!text.includes('▲') && !text.includes('…'), text);
});

test('renderPanel keeps the pace marker intact in CJK mode below 100%', () => {
  setLanguage('zh-Hans');
  try {
    const NOW = Date.now();
    const ctx = paceCtx({ fiveHour: 62, sevenDay: 31, fiveHourResetAt: new Date(NOW + 4 * 3600_000), sevenDayResetAt: new Date(NOW + 3 * 86_400_000) }, NOW);
    const lines = panelLines(createFrame(ctx, 200, NOW)).map(stripAnsi);
    const line = lines.find((l) => l.includes('62%'));
    // Wide enough that the row itself is not cut; `62%▲` is 5 cells with ▲ counted double, so it must still fit.
    assert.ok(line?.includes('62%▲'), lines.join('\n'));
    assert.ok(!line.includes('…'), line);
  } finally {
    setLanguage('en');
  }
});

test('renderPanel marks a warning 5h pace with ▲ in amber', () => {
  setLanguage('en');
  const NOW = Date.now();
  // 47% after half the window projects to 94%: warning, not critical.
  const ctx = paceCtx({ fiveHour: 47, sevenDay: 31, fiveHourResetAt: new Date(NOW + 2.5 * 3600_000), sevenDayResetAt: new Date(NOW + 3 * 86_400_000) }, NOW);
  const line = usageLine(ctx, NOW, '5 hours');
  assert.ok(line.includes(`\x1b[1;${AMBER}m47%▲`), stripAnsi(line));
  assert.ok(line.includes(`\x1b[${AMBER}m▇`), 'bar painted amber');
});

test('renderPanel never lowers a red usage band to the amber of a warning pace', () => {
  setLanguage('en');
  const NOW = Date.now();
  // 92% with 20m left projects to ~99%: warning pace, but the band is already red.
  const ctx = paceCtx({ fiveHour: 92, sevenDay: 31, fiveHourResetAt: new Date(NOW + 20 * 60_000), sevenDayResetAt: new Date(NOW + 3 * 86_400_000) }, NOW);
  const line = usageLine(ctx, NOW, '5 hours');
  assert.ok(line.includes(`\x1b[1;${RED}m92%▲`), stripAnsi(line));
});

test('renderPanel shows no pace marker under 10% usage', () => {
  setLanguage('en');
  const NOW = Date.now();
  // 8% ten minutes in projects past 100%, but under 10% the projection is noise.
  const ctx = paceCtx({ fiveHour: 8, sevenDay: 31, fiveHourResetAt: new Date(NOW + 290 * 60_000), sevenDayResetAt: new Date(NOW + 3 * 86_400_000) }, NOW);
  const line = stripAnsi(usageLine(ctx, NOW, '5 hours'));
  assert.ok(!line.includes('▲'), line);
  assert.match(line, / 8% ↻ 4h 50m/);
});

test('renderPanel ignores pace when display.usagePace is off', () => {
  setLanguage('en');
  const NOW = Date.now();
  const usage = { fiveHour: 60, sevenDay: 31, fiveHourResetAt: new Date(NOW + 4 * 3600_000), sevenDayResetAt: new Date(NOW + 3 * 86_400_000) };
  for (const display of [{}, { usagePace: false }]) {
    const line = usageLine(paceCtx(usage, NOW, display), NOW, '5 hours');
    assert.ok(!stripAnsi(line).includes('▲'), stripAnsi(line));
    // Today's row: violet bar and value from the percentage bands.
    assert.ok(line.includes('\x1b[1;38;2;165;148;255m60%\x1b[0m'), stripAnsi(line));
  }
});

test('renderPanel grades the weekly pace against the 7-day window', () => {
  setLanguage('en');
  const NOW = Date.now();
  // 60% one day into the week projects to 420%. Against a 5h window the reset
  // is more than a window away, so there would be no pace at all.
  const ctx = paceCtx({ fiveHour: 5, sevenDay: 60, fiveHourResetAt: new Date(NOW + 2 * 3600_000), sevenDayResetAt: new Date(NOW + 6 * 86_400_000) }, NOW);
  const line = usageLine(ctx, NOW, 'weekly');
  assert.ok(line.includes(`\x1b[1;${RED}m60%▲`), stripAnsi(line));
});

const namedCtx = (sessionName, now, display = { showSessionName: true }) => {
  const ctx = makeCtx({ config: mergeConfig({ lineLayout: 'panel', display }) }, now);
  ctx.stdin.session_name = sessionName;
  return ctx;
};

test('renderPanel shows the session name in the session box title', () => {
  setLanguage('en');
  const NOW = Date.now();
  const plain = panelLines(createFrame(namedCtx('auth-fix', NOW), 154, NOW)).map(stripAnsi);
  assert.match(plain[0], /^╭─ session · auth-fix ─+╮ ╭─ usage /);
});

test('renderPanel truncates a long session name and keeps every line at the panel width', () => {
  setLanguage('en');
  const NOW = Date.now();
  const name = 'refactor-the-authentication-flow-and-token-refresh-'.repeat(4);
  for (const columns of [154, 100, 64]) {
    const lines = panelLines(createFrame(namedCtx(name, NOW), columns, NOW));
    const widths = new Set(lines.map(cellWidth));
    assert.deepEqual([...widths], [columns - 4], `columns ${columns}`);
    assert.match(stripAnsi(lines[0]), /^╭─ session · refactor-the-[^╮]*… ─╮/, `columns ${columns}`);
  }
});

test('renderPanel keeps every line at the panel width with a wide CJK and emoji session name', () => {
  setLanguage('en');
  const NOW = Date.now();
  const name = '日本語のセッション名🚀'.repeat(3);
  for (const columns of [100, 64]) {
    const lines = panelLines(createFrame(namedCtx(name, NOW), columns, NOW));
    assert.deepEqual([...new Set(lines.map(cellWidth))], [columns - 4], `columns ${columns}`);
    assert.match(stripAnsi(lines[0]), /^╭─ session · 日本語/, `columns ${columns}`);
  }
});

test('renderPanel sanitizes control and ANSI characters in the session name', () => {
  setLanguage('en');
  const NOW = Date.now();
  const lines = panelLines(createFrame(namedCtx('\x1b[31mauth\x07-fix‮\x1b]8;;http://x\x07', NOW), 154, NOW));
  assert.equal(new Set(lines.map(cellWidth)).size, 1);
  assert.match(stripAnsi(lines[0]), /^╭─ session · auth-fix ─+╮ /);
  assert.ok(!lines[0].includes('\x1b[31m') && !lines[0].includes('\x07') && !lines[0].includes('‮'));
});

test('renderPanel keeps the plain session title without the option or a usable name', () => {
  setLanguage('en');
  const NOW = Date.now();
  const cases = [
    namedCtx('auth-fix', NOW, {}),
    namedCtx('auth-fix', NOW, { showSessionName: false }),
    namedCtx(undefined, NOW),
    namedCtx('   ', NOW),
    namedCtx('\x1b[31m\x07', NOW),
  ];
  for (const ctx of cases) {
    const first = stripAnsi(panelLines(createFrame(ctx, 154, NOW))[0]);
    assert.match(first, /^╭─ session ─+╮ ╭─ usage /, JSON.stringify(ctx.stdin.session_name));
  }
});

const cacheCtx = (promptCache, now, inputTokens) => {
  const ctx = makeCtx({}, now);
  ctx.stdin.prompt_cache = promptCache;
  if (inputTokens !== undefined) ctx.stdin.context_window.current_usage = { input_tokens: inputTokens };
  return ctx;
};
const cacheLine = (ctx, now, columns = 154) =>
  panelLines(createFrame(ctx, columns, now)).find((l) => stripAnsi(l).includes('│ cache '));

test('renderPanel shows a warm cache countdown to expiry, dim while time remains', () => {
  setLanguage('en');
  const NOW = Date.now();
  const line = cacheLine(cacheCtx({ warm: true, hit_ratio: 0.92, expires_at: (NOW + 47 * 60_000) / 1000 }, NOW), NOW);
  assert.match(stripAnsi(line), /│ cache 92% ● 47m +│$/);
  assert.ok(line.includes(`\x1b[${DIM}m 47m`), stripAnsi(line));
});

test('renderPanel paints the cache countdown amber with at most 120 s left', () => {
  setLanguage('en');
  const NOW = Date.now();
  for (const secs of [90, 120]) {
    const line = cacheLine(cacheCtx({ warm: true, hit_ratio: 0.92, expires_at: NOW / 1000 + secs }, NOW), NOW);
    assert.ok(line.includes(`\x1b[${AMBER}m 2m`), `${secs}s: ${stripAnsi(line)}`);
  }
  const later = cacheLine(cacheCtx({ warm: true, hit_ratio: 0.92, expires_at: NOW / 1000 + 121 }, NOW), NOW);
  assert.ok(later.includes(`\x1b[${DIM}m 3m`), stripAnsi(later));
});

test('renderPanel shows no cache countdown when expires_at is past, missing or not finite', () => {
  setLanguage('en');
  const NOW = Date.now();
  // JSON.parse('1e400') is Infinity.
  for (const expires_at of [NOW / 1000 - 60, NOW / 1000, undefined, null, JSON.parse('1e400')]) {
    const line = stripAnsi(cacheLine(cacheCtx({ warm: true, hit_ratio: 0.92, expires_at }, NOW), NOW));
    assert.match(line, /│ cache 92% ● +│$/, String(expires_at));
  }
});

test('renderPanel shows no cache countdown for a finite but huge expires_at', () => {
  setLanguage('en');
  const NOW = Date.now();
  const line = stripAnsi(cacheLine(cacheCtx({ warm: true, hit_ratio: 0.92, expires_at: 1e300 }, NOW), NOW));
  assert.ok(!line.includes('NaN'), line);
  assert.match(line, /│ cache 92% ● +│$/);
});

test('renderPanel shows no cache countdown for an expires_at given in milliseconds', () => {
  setLanguage('en');
  const NOW = Date.now();
  const line = stripAnsi(cacheLine(cacheCtx({ warm: true, hit_ratio: 0.92, expires_at: NOW + 47 * 60_000 }, NOW), NOW));
  assert.match(line, /│ cache 92% ● +│$/);
});

test('renderPanel shows no cache countdown when warm is missing', () => {
  setLanguage('en');
  const NOW = Date.now();
  const line = stripAnsi(cacheLine(cacheCtx({ hit_ratio: 0.92, expires_at: (NOW + 47 * 60_000) / 1000 }, NOW), NOW));
  assert.match(line, /│ cache 92% ○ +│$/);
});

test('renderPanel shows the tokens a cold cache would rewrite, amber from 200k', () => {
  setLanguage('en');
  const NOW = Date.now();
  // A cold cache shows no countdown even with a future expires_at.
  const line = cacheLine(cacheCtx({ warm: false, hit_ratio: 0.4, expires_at: NOW / 1000 + 600 }, NOW, 300_000), NOW);
  assert.match(stripAnsi(line), /│ cache 40% ○ ↻300k +│$/);
  assert.ok(line.includes(`\x1b[${AMBER}m ↻300k`), stripAnsi(line));
});

test('renderPanel dims the cold cache rewrite below 200k tokens', () => {
  setLanguage('en');
  const NOW = Date.now();
  const line = cacheLine(cacheCtx({ warm: false, hit_ratio: 0.4 }, NOW, 50_000), NOW);
  assert.ok(line.includes(`\x1b[${DIM}m ↻50k`), stripAnsi(line));
});

test('renderPanel adds nothing to a cold cache row without context tokens', () => {
  setLanguage('en');
  const NOW = Date.now();
  const line = stripAnsi(cacheLine(cacheCtx({ warm: false, hit_ratio: 0.4 }, NOW, 0), NOW));
  assert.match(line, /│ cache 40% ○ +│$/);
});

test('renderPanel fits the cache row at the narrowest wide layout', () => {
  setLanguage('en');
  const NOW = Date.now();
  const warm = cacheCtx({ warm: true, hit_ratio: 1, expires_at: NOW / 1000 + 119 * 60 }, NOW);
  const cold = cacheCtx({ warm: false, hit_ratio: 1 }, NOW, 1_234_567);
  for (const [ctx, row] of [[warm, /│ cache 100% ● 1h 59m +│$/], [cold, /│ cache 100% ○ ↻1\.2M +│$/]]) {
    const lines = panelLines(createFrame(ctx, 116, NOW));
    assert.deepEqual([...new Set(lines.map(visibleWidth))], [112]);
    assert.match(stripAnsi(lines.find((l) => stripAnsi(l).includes('│ cache '))), row);
  }
});

test('renderPanel keeps the inline environment line free of cache details', () => {
  setLanguage('en');
  const NOW = Date.now();
  const ctx = cacheCtx({ warm: false, hit_ratio: 0.4, expires_at: NOW / 1000 + 600 }, NOW, 300_000);
  for (const columns of [100, 64]) {
    const plain = panelLines(createFrame(ctx, columns, NOW)).map(stripAnsi);
    const env = plain.find((l) => l.includes('environment  '));
    assert.match(env, /│ environment {2}2 CLAUDE\.md · 1 rules · 9 MCP · 17 hooks +│$/, `columns ${columns}`);
  }
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

// --- stalled running agents ---

function stallCtx(detail, now, status = 'running') {
  const ctx = makeCtx({}, now);
  ctx.transcript.agents = [
    { id: 'toolu_a1', type: 'nestjs-developer', description: 'Fix it', status, startTime: new Date(now - 3_600_000), ...(status === 'completed' ? { endTime: new Date(now - 1000) } : {}) },
  ];
  ctx.subagents = new Map([['toolu_a1', { skills: [], todosDone: 0, todosTotal: 0, toolCount: 1, ...detail }]]);
  return ctx;
}

const agentLine = (ctx, now, width = 154) =>
  panelLines(createFrame(ctx, width, now)).find((l) => stripAnsi(l).includes('nestjs-developer'));

test('renderPanel shows an amber idle duration for a running agent with no activity for 5+ minutes', () => {
  setLanguage('en');
  const NOW = Date.now();
  const line = agentLine(stallCtx({ lastActivityAt: new Date(NOW - 7 * 60_000) }, NOW), NOW);
  assert.match(stripAnsi(line), /idle 7m/);
  assert.ok(line.includes(`\x1b[${AMBER}midle 7m`));
});

test('renderPanel keeps thinking for a recently active agent', () => {
  setLanguage('en');
  const NOW = Date.now();
  const line = stripAnsi(agentLine(stallCtx({ lastActivityAt: new Date(NOW - 2 * 60_000) }, NOW), NOW));
  assert.match(line, /thinking…/);
  assert.doesNotMatch(line, /idle/);
});

test('renderPanel never calls an agent with a pending tool idle', () => {
  setLanguage('en');
  const NOW = Date.now();
  const detail = { currentTool: { name: 'Bash', target: 'bun test' }, lastActivityAt: new Date(NOW - 30 * 60_000) };
  const line = stripAnsi(agentLine(stallCtx(detail, NOW), NOW));
  assert.match(line, /Bash bun test/);
  assert.doesNotMatch(line, /idle/);
});

test('renderPanel shows no idle for a finished agent', () => {
  setLanguage('en');
  const NOW = Date.now();
  const line = stripAnsi(agentLine(stallCtx({ lastActivityAt: new Date(NOW - 30 * 60_000) }, NOW, 'completed'), NOW));
  assert.doesNotMatch(line, /idle/);
});

test('renderPanel keeps thinking when lastActivityAt is missing or invalid', () => {
  setLanguage('en');
  const NOW = Date.now();
  for (const detail of [{}, { lastActivityAt: new Date(NaN) }]) {
    const line = stripAnsi(agentLine(stallCtx(detail, NOW), NOW));
    assert.match(line, /thinking…/);
  }
});

test('renderPanel formats a long idle duration with hours', () => {
  setLanguage('en');
  const NOW = Date.now();
  const line = stripAnsi(agentLine(stallCtx({ lastActivityAt: new Date(NOW - 65 * 60_000) }, NOW), NOW));
  assert.match(line, /idle 1h 05m/);
});

test('renderPanel speaks Spanish for an idle agent', () => {
  setLanguage('es');
  try {
    const NOW = Date.now();
    const line = stripAnsi(agentLine(stallCtx({ lastActivityAt: new Date(NOW - 7 * 60_000) }, NOW), NOW));
    assert.match(line, /inactivo 7m/);
  } finally {
    setLanguage('en');
  }
});

test('renderPanel keeps the idle cell inside narrow layouts', () => {
  setLanguage('en');
  const NOW = Date.now();
  for (const width of [64, 100, 154]) {
    const lines = panelLines(createFrame(stallCtx({ lastActivityAt: new Date(NOW - 7 * 60_000) }, NOW), width, NOW));
    assert.equal(new Set(lines.map(cellWidth)).size, 1, `width ${width}: all lines share one width`);
    assert.ok(lines.some((l) => stripAnsi(l).includes('idle 7m')), `width ${width}: idle shown`);
  }
});

// --- short MCP tool names ---

const toolsLine = (toolCounts, now) => {
  const ctx = makeCtx({}, now);
  ctx.transcript.toolCounts = toolCounts;
  return panelLines(createFrame(ctx, 154, now)).map(stripAnsi).find((l) => l.includes('tools'));
};

test('renderPanel shortens an MCP tool name to its tool part in the tools row', () => {
  setLanguage('en');
  const NOW = Date.now();
  const line = toolsLine({ mcp__plugin_context_mode_context_mode__ctx_execute: 5, Bash: 3 }, NOW);
  assert.match(line, /ctx_execute 5/);
  assert.doesNotMatch(line, /plugin_context/);
  assert.match(line, /Bash 3/);
});

test('renderPanel keeps server:tool for MCP tools whose short names collide', () => {
  setLanguage('en');
  const NOW = Date.now();
  const line = toolsLine({ mcp__a__search: 4, mcp__b__search: 2, mcp__c__fetch: 1 }, NOW);
  assert.match(line, /a:search 4/);
  assert.match(line, /b:search 2/);
  assert.match(line, /fetch 1/);
  assert.doesNotMatch(line, /c:fetch/);
});

test('renderPanel shows the short MCP tool name in the NOW cell', () => {
  setLanguage('en');
  const NOW = Date.now();
  const line = stripAnsi(agentLine(stallCtx({ currentTool: { name: 'mcp__x__do_thing', target: 'now' } }, NOW), NOW));
  assert.match(line, /do_thing now/);
  assert.doesNotMatch(line, /mcp__|x:do_thing/);
});

// --- opaque worktree ids ---

function projectLine(worktree, now, icons) {
  const ctx = makeCtx({}, now);
  ctx.stdin.workspace = { project_dir: '/work/quahog', git_worktree: worktree };
  if (icons) ctx.config = mergeConfig({ lineLayout: 'panel', panel: { icons } });
  return panelLines(createFrame(ctx, 154, now)).map(stripAnsi).find((l) => l.includes('quahog'));
}

test('renderPanel drops an opaque UUID worktree name and keeps the glyph', () => {
  setLanguage('en');
  const NOW = Date.now();
  const line = projectLine('42254-ecedf77f-d4f7-4603-89c1-18dcf752e131', NOW);
  assert.match(line, /quahog ⎇ /);
  assert.doesNotMatch(line, /ecedf77f|42254/);
});

test('renderPanel keeps a readable worktree name', () => {
  setLanguage('en');
  const NOW = Date.now();
  assert.match(projectLine('feat-auth', NOW), /quahog ⎇ feat-auth/);
});

test('renderPanel shows only the nerd worktree glyph for a UUID worktree name', () => {
  setLanguage('en');
  const NOW = Date.now();
  const line = projectLine('42254-ecedf77f-d4f7-4603-89c1-18dcf752e131', NOW, 'nerd');
  assert.match(line, /quahog  /);
  assert.doesNotMatch(line, /ecedf77f|42254|⎇/);
});

test('renderPanel falls back to the full name for a bare MCP name with no tool part', () => {
  setLanguage('en');
  const NOW = Date.now();
  assert.match(toolsLine({ mcp__x: 2, Bash: 1 }, NOW), /mcp__x 2/);
  assert.match(toolsLine({ mcp__x__: 2, Bash: 1 }, NOW), /mcp__x__ 2/);
});

test('renderPanel keeps thinking when lastActivityAt is in the future', () => {
  setLanguage('en');
  const NOW = Date.now();
  const line = stripAnsi(agentLine(stallCtx({ lastActivityAt: new Date(NOW + 10 * 60_000) }, NOW), NOW));
  assert.match(line, /thinking…/);
  assert.doesNotMatch(line, /idle/);
});

test('renderPanel keeps thinking while a quiet tool call is pending', () => {
  setLanguage('en');
  const NOW = Date.now();
  const detail = { hasPendingTool: true, lastActivityAt: new Date(NOW - 10 * 60_000) };
  const line = stripAnsi(agentLine(stallCtx(detail, NOW), NOW));
  assert.match(line, /thinking…/);
  assert.doesNotMatch(line, /idle/);
});

test('renderPanel shows the whole short name of a long MCP tool in the NOW cell', () => {
  setLanguage('en');
  const NOW = Date.now();
  const name = 'mcp__plugin_context-mode_context-mode__ctx_execute';
  const line = stripAnsi(agentLine(stallCtx({ currentTool: { name } }, NOW), NOW));
  assert.match(line, /ctx_execute(?!\S)/);
});

test('renderPanel keeps the tool part after the first MCP separator', () => {
  setLanguage('en');
  const NOW = Date.now();
  assert.match(toolsLine({ mcp__srv__foo__bar: 3, Bash: 1 }, NOW), /foo__bar 3/);
  const collide = toolsLine({ mcp__a__x__y: 2, mcp__b__x__y: 1 }, NOW);
  assert.match(collide, /a:x__y 2/);
  assert.match(collide, /b:x__y 1/);
  assert.match(stripAnsi(agentLine(stallCtx({ currentTool: { name: 'mcp__srv__foo__bar' } }, NOW), NOW)), /foo__bar/);
});

test('formatCount picks the unit from the rounded value', () => {
  const cases = [
    [1_791_000_000, '1.8B'],
    [12_400_000_000, '12B'],
    [999_600, '1M'],
    [999_700_000, '1B'],
    [1_500_000, '1.5M'],
    [45_000, '45k'],
    [999_499, '999k'],
    [999_499_999, '999M'],
    [9_960_000, '10M'],
    [9_950_000, '10M'],
    [9_950_000_000, '10B'],
    [1_250_000, '1.3M'],
  ];
  for (const [input, expected] of cases) assert.equal(formatCount(input), expected, String(input));
});

test('renderPanel renders the provided panelAgents instead of recomputing the selection', () => {
  setLanguage('en');
  const NOW = Date.now();
  const ctx = stallCtx({}, NOW, 'completed');
  // Ended long past the retention window: recomputing at f.now would drop it.
  const stale = { ...ctx.transcript.agents[0], endTime: new Date(NOW - 3_600_000) };
  ctx.transcript.agents = [stale];
  assert.equal(agentLine(ctx, NOW), undefined);
  ctx.panelAgents = { shown: [stale], hiddenRunning: 0 };
  assert.ok(agentLine(ctx, NOW));
});

test('renderPanel falls back to the transcript start for the session duration, measured from f.now', () => {
  setLanguage('en');
  const NOW = Date.parse('2026-01-01T12:00:00.000Z'); // far from the real clock
  const ctx = makeCtx({}, NOW);
  ctx.stdin.cost = { ...ctx.stdin.cost, total_duration_ms: undefined };
  ctx.transcript.sessionStart = new Date(NOW - 65 * 60_000);
  assert.match(statsLine(ctx, NOW), /^│ 1h 5m · \$4\.82/);
});

// --- subagent share of tokens ---

const shareCtx = (main, sub, now) => {
  const ctx = makeCtx({ subagentTokens: sub }, now);
  ctx.transcript.sessionTokens = main;
  return ctx;
};
const tokensOf = (total) => ({ inputTokens: total, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 });
const runningLine = (ctx, now, columns = 154) =>
  panelLines(createFrame(ctx, columns, now)).map(stripAnsi).find((l) => /running|activo/.test(l));

test('renderPanel shows the subagent share of tokens next to the agent counts', () => {
  setLanguage('en');
  const NOW = Date.now();
  const line = runningLine(shareCtx(tokensOf(100), tokensOf(300), NOW), NOW);
  assert.match(line, /1 running · 1 done · 75% tokens by agents/);
  const raw = panelLines(createFrame(shareCtx(tokensOf(100), tokensOf(300), NOW), 154, NOW)).find((l) => l.includes('75% tokens'));
  assert.ok(raw.includes(`\x1b[${DIM}m · 75% tokens by agents`), stripAnsi(raw));
});

test('renderPanel shows no agent share without subagent tokens or without main tokens', () => {
  setLanguage('en');
  const NOW = Date.now();
  for (const ctx of [shareCtx(tokensOf(100), null, NOW), shareCtx(tokensOf(100), tokensOf(0), NOW), shareCtx(tokensOf(0), tokensOf(300), NOW)]) {
    assert.doesNotMatch(runningLine(ctx, NOW), /tokens by agents/);
  }
});

test('renderPanel speaks Spanish in the agent share', () => {
  setLanguage('es');
  try {
    const NOW = Date.now();
    assert.match(runningLine(shareCtx(tokensOf(100), tokensOf(300), NOW), NOW), /75% tokens de agentes/);
  } finally {
    setLanguage('en');
  }
});

test('renderPanel keeps every line one width with the agent share', () => {
  setLanguage('en');
  const NOW = Date.now();
  for (const width of [70, 100, 140]) {
    const lines = panelLines(createFrame(shareCtx(tokensOf(100), tokensOf(300), NOW), width, NOW));
    assert.equal(new Set(lines.map(cellWidth)).size, 1, `width ${width}`);
  }
});

// --- prompt-cache misses ---

test('renderPanel appends prompt-cache misses and rewritten tokens, amber from 200k', () => {
  setLanguage('en');
  const NOW = Date.now();
  const line = cacheLine(cacheCtx({ warm: true, hit_ratio: 0.92, expires_at: (NOW + 47 * 60_000) / 1000, misses: 3, miss_recache_tokens: 284_396 }, NOW), NOW);
  assert.match(stripAnsi(line), /cache 92% ● 47m · 3✗ 284k +│$/);
  assert.ok(line.includes(`\x1b[${AMBER}m · 3✗ 284k`), stripAnsi(line));
});

test('renderPanel dims prompt-cache misses below 200k rewritten tokens', () => {
  setLanguage('en');
  const NOW = Date.now();
  const line = cacheLine(cacheCtx({ warm: true, hit_ratio: 0.92, misses: 2, miss_recache_tokens: 50_000 }, NOW), NOW);
  assert.ok(line.includes(`\x1b[${DIM}m · 2✗ 50k`), stripAnsi(line));
});

test('renderPanel omits the miss token part when miss_recache_tokens is not a positive number', () => {
  setLanguage('en');
  const NOW = Date.now();
  for (const miss_recache_tokens of [undefined, 0, '5', null]) {
    const line = stripAnsi(cacheLine(cacheCtx({ warm: true, hit_ratio: 0.92, misses: 2, miss_recache_tokens }, NOW), NOW));
    assert.match(line, /cache 92% ● · 2✗ +│$/, String(miss_recache_tokens));
    assert.doesNotMatch(line, /2✗ \S/);
  }
});

test('renderPanel shows no cache misses for zero, negative, fractional or non-number counts', () => {
  setLanguage('en');
  const NOW = Date.now();
  for (const misses of [0, -1, 1.5, '3', null, undefined, JSON.parse('1e400')]) {
    const line = stripAnsi(cacheLine(cacheCtx({ warm: true, hit_ratio: 0.92, misses, miss_recache_tokens: 284_396 }, NOW), NOW));
    assert.doesNotMatch(line, /✗/, String(misses));
  }
});

test('renderPanel shows cache misses after the cold rewrite segment', () => {
  setLanguage('en');
  const NOW = Date.now();
  const line = stripAnsi(cacheLine(cacheCtx({ warm: false, hit_ratio: 0.4, misses: 1, miss_recache_tokens: 9_000 }, NOW, 300_000), NOW));
  assert.match(line, /cache 40% ○ ↻300k · 1✗ 9k/);
});

test('renderPanel keeps every line one width with cache misses at the minimum wide width', () => {
  setLanguage('en');
  const NOW = Date.now();
  const ctx = cacheCtx({ warm: true, hit_ratio: 0.92, expires_at: (NOW + 47 * 60_000) / 1000, misses: 12, miss_recache_tokens: 1_284_396 }, NOW);
  for (const width of [112, 154]) {
    const lines = panelLines(createFrame(ctx, width, NOW));
    assert.equal(new Set(lines.map(cellWidth)).size, 1, `width ${width}`);
  }
});

// --- API time ---

const modelLine = (apiMs, now) => {
  const ctx = makeCtx({}, now);
  if (apiMs !== undefined) ctx.stdin.cost.total_api_duration_ms = apiMs;
  return panelLines(createFrame(ctx, 154, now)).find((l) => stripAnsi(l).includes('Opus 5.5'));
};

test('renderPanel appends the API time to the model row, dim', () => {
  setLanguage('en');
  const NOW = Date.now();
  const line = modelLine(446_705, NOW);
  assert.match(stripAnsi(line), /Opus 5\.5 · 1M · API 7m/);
  assert.ok(line.includes(`\x1b[${DIM}m · API 7m`), stripAnsi(line));
});

test('renderPanel shows no API time under a minute, when missing, or when not a number', () => {
  setLanguage('en');
  const NOW = Date.now();
  for (const apiMs of [30_000, 59_999, undefined, '446705', null, NaN]) {
    assert.doesNotMatch(stripAnsi(modelLine(apiMs, NOW)), /API/, String(apiMs));
  }
});
