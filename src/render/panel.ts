import * as path from 'node:path';
import type { HudConfig } from '../config.js';
import type { AgentEntry, RenderContext, SubagentDetail } from '../types.js';
import { getBufferedPercent, getContextPercent, getModelName, getTotalTokens, stripContextSuffix } from '../stdin.js';
import { getCanonicalLanguage, interpolate, t } from '../i18n/index.js';
import type { MessageKey } from '../i18n/types.js';
import { sanitizeDisplayText } from '../utils/sanitize.js';
import { formatResetTime } from './format-reset-time.js';
import { formatAgentModel } from './agents-line.js';
import { codePointCellWidth, isCjkAmbiguousWide } from './width.js';
import { RESET } from './colors.js';

// "panel" layout: boxed session / usage / environment panes over an activity
// pane with a per-agent table. Every line is sized to the terminal width
// up front, so render() prints these lines as-is instead of wrapping them.

const PALETTE = {
  border: '#3A3150',
  fg: '#D8D4E6',
  bright: '#F1EEF9',
  dim: '#8A84A0',
  faint: '#2E2740',
  violet: '#A594FF',
  pink: '#F67EC8',
  cyan: '#6FE3F2',
  green: '#8BE0A4',
  amber: '#F5C26B',
  red: '#FF7A96',
  agent: '#CFC6FF',
  doneBar: '#3F6B50',
} as const;

const NERD_ICONS = {
  model: '\uF2DB', // nf-fa-microchip
  folder: '\uF07B', // nf-fa-folder
  branch: '\uE0A0', // powerline branch
  clock: '\uF017', // nf-fa-clock_o
  pr: '\uF407', // nf-oct-git_pull_request
  worktree: '\uF126', // nf-fa-code_fork
  reset: '\uF021', // nf-fa-refresh
} as const;

// Braille spinner: present in virtually every terminal font.
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
// Lower 7/8 block: stacked bar rows keep a hairline gap instead of fusing
// into one block the way full blocks (█) do.
const BAR_CELL = '▇';
const DEFAULT_WIDTH = 120;
const MAX_PANEL_WIDTH = 180;
// Claude Code pads the status line; keep clear of the right edge.
const EDGE_MARGIN = 4;
const WIDE_MIN = 112;
const MEDIUM_MIN = 76;
const MAX_COMPLETED_SHOWN = 2;

// ---------------------------------------------------------------------------
// Styled text

interface Seg {
  text: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
}
type Line = Seg[];

const s = (text: string, color?: string, bold = false): Seg => ({ text, color, bold });
const sp = (n: number): Seg => ({ text: ' '.repeat(Math.max(0, n)) });

let ambiguousWide = false;

function cellWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    width += codePointCellWidth(ch.codePointAt(0) ?? 0, ambiguousWide);
  }
  return width;
}

function lineWidth(line: Line): number {
  return line.reduce((sum, seg) => sum + cellWidth(seg.text), 0);
}

function truncate(line: Line, max: number): Line {
  if (max <= 0) return [];
  if (lineWidth(line) <= max) return line;
  const out: Line = [];
  let used = 0;
  const budget = max - 1; // room for the ellipsis
  for (const seg of line) {
    let text = '';
    for (const ch of seg.text) {
      const w = codePointCellWidth(ch.codePointAt(0) ?? 0, ambiguousWide);
      if (used + w > budget) break;
      text += ch;
      used += w;
    }
    if (text) out.push({ ...seg, text });
    if (text.length < seg.text.length) {
      out.push({ ...seg, text: '…' });
      return out;
    }
  }
  return out;
}

function fit(line: Line, width: number, align: 'left' | 'right' = 'left'): Line {
  const cut = truncate(line, width);
  const pad = sp(width - lineWidth(cut));
  return align === 'right' ? [pad, ...cut] : [...cut, pad];
}

function hexToSgr(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `38;2;${r};${g};${b}`;
}

function toAnsi(line: Line): string {
  let out = '';
  for (const seg of line) {
    if (!seg.text) continue;
    const codes: string[] = [];
    if (seg.bold) codes.push('1');
    if (seg.italic) codes.push('3');
    if (seg.color) codes.push(hexToSgr(seg.color));
    out += codes.length > 0 ? `\x1b[${codes.join(';')}m${seg.text}${RESET}` : seg.text;
  }
  return out;
}

function clean(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? sanitizeDisplayText(value).trim() || fallback : fallback;
}

// ---------------------------------------------------------------------------
// Formatting helpers

function bar(percent: number, width: number, color: string, track: string = PALETTE.faint): Seg[] {
  const safe = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  // Any usage at all shows at least one cell; only a full 100% fills the bar.
  let filled = Math.round((safe / 100) * width);
  if (safe > 0) filled = Math.max(1, filled);
  if (safe < 100) filled = Math.min(width - 1, filled);
  return [s(BAR_CELL.repeat(filled), color), s(BAR_CELL.repeat(Math.max(0, width - filled)), track)];
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const totalSecs = Math.floor(ms / 1000);
  if (totalSecs < 60) return `${totalSecs}s`;
  const mins = Math.floor(totalSecs / 60);
  if (mins < 60) return `${mins}m ${String(totalSecs % 60).padStart(2, '0')}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${String(mins % 60).padStart(2, '0')}m`;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

function formatWindowSize(size: number): string {
  if (size >= 1_000_000) return `${+(size / 1_000_000).toFixed(1)}M`;
  return `${Math.round(size / 1000)}k`;
}

function formatWeeklyReset(resetAt: Date | null, now: Date): string {
  if (!resetAt) return '';
  const diff = resetAt.getTime() - now.getTime();
  if (diff <= 0) return '';
  if (diff < 24 * 3600 * 1000) return formatResetTime(resetAt, 'relative');
  const locale = getCanonicalLanguage();
  const weekday = resetAt.toLocaleDateString(locale, { weekday: 'short' }).replace(/\.$/, '');
  const time = resetAt.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${weekday} ${time}`;
}

function quotaColor(percent: number, base: string): string {
  if (percent >= 90) return PALETTE.red;
  if (percent >= 75) return PALETTE.amber;
  return base;
}

function label(key: MessageKey): string {
  return t(key);
}

// ---------------------------------------------------------------------------
// Boxes

function box(title: string, titleColor: string, rows: Line[], width: number, height: number): string[] {
  const inner = Math.max(1, width - 4);
  let titleText = title;
  if (cellWidth(titleText) > width - 6) {
    titleText = toPlain(truncate([s(titleText)], Math.max(1, width - 6)));
  }
  const fill = Math.max(1, width - 5 - cellWidth(titleText));
  const top: Line = [
    s('╭─ ', PALETTE.border),
    s(titleText, titleColor, true),
    s(` ${'─'.repeat(fill)}╮`, PALETTE.border),
  ];
  const out = [toAnsi(top)];
  for (let i = 0; i < height; i++) {
    const row = rows[i] ?? [];
    out.push(toAnsi([s('│ ', PALETTE.border), ...fit(row, inner), s(' │', PALETTE.border)]));
  }
  out.push(toAnsi([s(`╰${'─'.repeat(Math.max(0, width - 2))}╯`, PALETTE.border)]));
  return out;
}

function toPlain(line: Line): string {
  return line.map((seg) => seg.text).join('');
}

function sideBySide(columns: string[][]): string[] {
  const height = Math.max(...columns.map((c) => c.length));
  const out: string[] = [];
  for (let i = 0; i < height; i++) {
    out.push(columns.map((c) => c[i] ?? '').join(' '));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pane contents

function withIcon(ctx: RenderContext, icon: keyof typeof NERD_ICONS, color: string, rest: Line): Line {
  if (ctx.config?.panel?.icons !== 'nerd') return rest;
  return [s(NERD_ICONS[icon], color), sp(1), ...rest];
}

function projectLabel(ctx: RenderContext): string {
  const cwd = ctx.stdin.workspace?.project_dir ?? ctx.stdin.cwd ?? ctx.stdin.workspace?.current_dir;
  if (!cwd) return '';
  const levels = ctx.config?.pathLevels ?? 1;
  if (levels === 'full') return clean(cwd);
  const parts = path.resolve(cwd).split(path.sep).filter(Boolean);
  return clean(parts.slice(-levels).join('/'), '/');
}

function sessionRows(ctx: RenderContext): Line[] {
  const { stdin } = ctx;
  const rawName = clean(getModelName(stdin), 'Claude');
  const suffix = rawName.match(/\(([^)]*)\bcontext\b[^)]*\)/i);
  const size = stdin.context_window?.context_window_size ?? 0;
  const windowLabel = suffix ? suffix[1].trim() : (size > 0 ? formatWindowSize(size) : '');
  const effort = typeof stdin.effort === 'string' ? stdin.effort : stdin.effort?.level ?? undefined;

  const modelRow: Line = [s(stripContextSuffix(rawName) || rawName, PALETTE.bright, true)];
  if (windowLabel) modelRow.push(s(` · ${windowLabel}`, PALETTE.dim));
  if (effort) modelRow.push(s(` · ${clean(effort)}`, PALETTE.dim));

  const projectRow: Line = [s(projectLabel(ctx) || '—', PALETTE.bright)];
  const addedDirs = stdin.workspace?.added_dirs?.length ?? 0;
  if (addedDirs > 0) projectRow.push(s(` +${addedDirs}`, PALETTE.dim));
  if (stdin.workspace?.git_worktree) {
    const worktreeGlyph = ctx.config?.panel?.icons === 'nerd' ? NERD_ICONS.worktree : '⎇';
    projectRow.push(s(` ${worktreeGlyph} ${clean(stdin.workspace.git_worktree)}`, PALETTE.dim));
  }

  const git = ctx.gitStatus;
  let branchRow: Line;
  if (git) {
    branchRow = [s(clean(git.branch, 'HEAD'), PALETTE.pink)];
    if (git.isDirty) branchRow.push(s(' ●', PALETTE.amber));
    if (git.ahead > 0) branchRow.push(s(` ↑${git.ahead}`, PALETTE.dim));
    if (git.behind > 0) branchRow.push(s(` ↓${git.behind}`, PALETTE.dim));
    const pr = stdin.pr?.number;
    if (typeof pr === 'number') {
      const approved = stdin.pr?.review_state === 'approved';
      branchRow.push(s(` #${pr}`, approved ? PALETTE.green : PALETTE.dim));
    }
  } else {
    branchRow = [s(label('panel.noGit'), PALETTE.dim)];
  }

  const cost = stdin.cost;
  const durationMs = cost?.total_duration_ms;
  const duration = typeof durationMs === 'number' && durationMs > 0
    ? formatDuration(durationMs).replace(/ \d+s$/, '')
    : ctx.sessionDuration;
  const statsRow: Line = [s(duration || '—', PALETTE.bright)];
  if (typeof cost?.total_cost_usd === 'number') {
    statsRow.push(s(' · ', PALETTE.dim), s(`$${cost.total_cost_usd.toFixed(2)}`, PALETTE.amber));
  }
  const added = cost?.total_lines_added ?? 0;
  const removed = cost?.total_lines_removed ?? 0;
  if (added > 0 || removed > 0) {
    statsRow.push(s(' · ', PALETTE.dim), s(`+${added}`, PALETTE.green), s(` −${removed}`, PALETTE.red));
  }

  return [
    withIcon(ctx, 'model', PALETTE.violet, modelRow),
    withIcon(ctx, 'folder', PALETTE.pink, projectRow),
    withIcon(ctx, 'branch', PALETTE.pink, branchRow),
    withIcon(ctx, 'clock', PALETTE.dim, statsRow),
  ];
}

function usageRows(ctx: RenderContext, innerWidth: number): Line[] {
  const display = ctx.config?.display;
  const labels = [label('panel.context'), label('panel.fiveHour'), label('panel.weekly'), label('panel.tasks')];
  const labelWidth = Math.min(12, Math.max(...labels.map(cellWidth)));
  // Leave ~14 cells after the value for the reset time or token count.
  const barWidth = Math.max(6, Math.min(24, innerWidth - labelWidth - 1 - 1 - 5 - 1 - 14));

  const row = (name: string, barSegs: Seg[], value: Seg, extra: Line): Line => [
    ...fit([s(name, PALETTE.dim)], labelWidth),
    sp(1),
    ...barSegs,
    sp(1),
    ...fit([value], 5, 'right'),
    sp(1),
    ...extra,
  ];
  const empty = (): Seg[] => [s(BAR_CELL.repeat(barWidth), PALETTE.faint)];
  const resetGlyph = ctx.config?.panel?.icons === 'nerd' ? NERD_ICONS.reset : '↻';

  // Context
  const autoCompactWindow = display?.autoCompactWindow ?? null;
  const percent = display?.autocompactBuffer === 'disabled'
    ? getContextPercent(ctx.stdin, autoCompactWindow)
    : getBufferedPercent(ctx.stdin, autoCompactWindow);
  const warning = display?.contextWarningThreshold ?? 70;
  const critical = display?.contextCriticalThreshold ?? 85;
  const ctxColor = percent >= critical ? PALETTE.red : percent >= warning ? PALETTE.amber : PALETTE.cyan;
  const windowSize = typeof autoCompactWindow === 'number' && autoCompactWindow > 0
    ? autoCompactWindow
    : ctx.stdin.context_window?.context_window_size ?? 0;
  const tokens = getTotalTokens(ctx.stdin);
  const ctxExtra: Line = percent >= critical
    ? [s(label('panel.compact'), PALETTE.red, true)]
    : windowSize > 0 ? [s(`${formatCount(tokens)}/${formatWindowSize(windowSize)}`, PALETTE.dim)] : [];
  const contextRow = row(labels[0], bar(percent, barWidth, ctxColor), s(`${percent}%`, ctxColor, true), ctxExtra);

  // Usage windows
  const usage = ctx.usageData;
  const now = new Date();
  const windowRow = (name: string, value: number | null | undefined, base: string, reset: string): Line => {
    if (typeof value !== 'number') return row(name, empty(), s('—', PALETTE.dim), []);
    const pct = Math.round(Math.min(100, Math.max(0, value)));
    const color = quotaColor(pct, base);
    return row(name, bar(pct, barWidth, color), s(`${pct}%`, color, true), reset ? [s(`${resetGlyph} ${reset}`, PALETTE.dim)] : []);
  };
  const fiveHourRow = windowRow(
    labels[1],
    usage?.fiveHour,
    PALETTE.violet,
    formatResetTime(usage?.fiveHourResetAt ?? null, 'relative'),
  );
  const weeklyRow = windowRow(
    labels[2],
    usage?.sevenDay,
    PALETTE.pink,
    formatWeeklyReset(usage?.sevenDayResetAt ?? null, now),
  );

  // Main-session task list
  const todos = ctx.transcript.todos ?? [];
  const done = todos.filter((todo) => todo.status === 'completed').length;
  let tasksRow: Line;
  if (todos.length === 0) {
    tasksRow = row(labels[3], empty(), s('—', PALETTE.dim), []);
  } else {
    const current = todos.find((todo) => todo.status === 'in_progress');
    tasksRow = row(
      labels[3],
      bar((done / todos.length) * 100, barWidth, PALETTE.green),
      s(`${done}/${todos.length}`, PALETTE.green, true),
      current ? [s(clean(current.content), PALETTE.dim)] : [],
    );
  }

  return [contextRow, fiveHourRow, weeklyRow, tasksRow];
}

function environmentCounts(ctx: RenderContext): Array<[string, number]> {
  return [
    ['CLAUDE.md', ctx.claudeMdCount],
    [label('panel.rules'), ctx.rulesCount],
    ['MCP', ctx.mcpCount],
    [label('panel.hooks'), ctx.hooksCount],
  ];
}

function environmentRows(ctx: RenderContext, innerWidth: number): Line[] {
  const counts = environmentCounts(ctx);
  const cell = Math.max(8, Math.floor((innerWidth - 2) / 2));
  const pair = (a: [string, number], b: [string, number]): Line => [
    ...fit([s(a[0], PALETTE.dim)], cell - 3),
    ...fit([s(String(a[1]), PALETTE.bright, true)], 3, 'right'),
    sp(2),
    ...fit([s(b[0], PALETTE.dim)], cell - 3),
    ...fit([s(String(b[1]), PALETTE.bright, true)], 3, 'right'),
  ];

  const rows: Line[] = [pair(counts[0], counts[1]), pair(counts[2], counts[3])];

  const cache = ctx.stdin.prompt_cache;
  if (cache && typeof cache.hit_ratio === 'number') {
    rows.push([
      s(label('panel.cache'), PALETTE.dim),
      sp(1),
      s(`${Math.round(cache.hit_ratio * 100)}%`, PALETTE.bright, true),
      sp(1),
      cache.warm ? s('●', PALETTE.green) : s('○', PALETTE.dim),
    ]);
  } else {
    rows.push([]);
  }

  const meta: Line = [];
  if (ctx.stdin.version) meta.push(s(`v${clean(ctx.stdin.version)}`, PALETTE.dim));
  const style = clean(ctx.stdin.output_style?.name ?? ctx.outputStyle);
  if (style && style !== 'default') {
    if (meta.length > 0) meta.push(s(' · ', PALETTE.dim));
    meta.push(s(style, PALETTE.dim));
  }
  rows.push(meta);
  return rows;
}

function environmentInline(ctx: RenderContext): Line {
  const line: Line = [s(label('panel.environment'), PALETTE.dim), sp(2)];
  environmentCounts(ctx).forEach(([name, count], i) => {
    if (i > 0) line.push(s(' · ', PALETTE.dim));
    line.push(s(String(count), PALETTE.bright, true), s(` ${name}`, PALETTE.dim));
  });
  return line;
}

// ---------------------------------------------------------------------------
// Agents

export function selectPanelAgents(
  agents: AgentEntry[],
  config: Pick<HudConfig, 'panel'> | undefined,
  now: number,
): { shown: AgentEntry[]; hiddenRunning: number } {
  const maxAgents = config?.panel?.maxAgents ?? 5;
  const retentionMs = (config?.panel?.completedRetentionSeconds ?? 120) * 1000;

  const running = agents.filter((agent) => agent.status === 'running');
  const runningShown = running.slice(-maxAgents);
  const completedSlots = Math.min(MAX_COMPLETED_SHOWN, maxAgents - runningShown.length);
  const completed = completedSlots > 0
    ? agents
      .filter((agent) => {
        const end = agent.endTime?.getTime();
        return agent.status === 'completed' && end !== undefined && now - end <= retentionMs;
      })
      .slice(-completedSlots)
    : [];

  return { shown: [...runningShown, ...completed], hiddenRunning: running.length - runningShown.length };
}

/** Fits as many skills as possible, then "+N" for the rest. */
function fitSkills(skills: string[], width: number, color: string): Line {
  if (skills.length === 0) return [s('—', PALETTE.dim)];
  for (let count = skills.length; count >= 1; count--) {
    const rest = skills.length - count;
    const suffix = rest > 0 ? ` +${rest}` : '';
    const text = skills.slice(0, count).join(' · ');
    if (cellWidth(text) + cellWidth(suffix) <= width) {
      return rest > 0 ? [s(text, color), s(suffix, PALETTE.dim)] : [s(text, color)];
    }
  }
  const suffix = skills.length > 1 ? ` +${skills.length - 1}` : '';
  return [...truncate([s(skills[0], color)], width - cellWidth(suffix)), s(suffix, PALETTE.dim)];
}

interface AgentCells {
  agent: Line;
  task: Line;
  skills: (width: number) => Line;
  progress: Line;
  now: Line;
  tokens: Line;
  time: Line;
}

function agentCells(agent: AgentEntry, detail: SubagentDetail | undefined, now: number): AgentCells {
  const running = agent.status === 'running';
  const glyph = running
    ? s(SPINNER[Math.floor(now / 1000) % SPINNER.length], PALETTE.amber)
    : s('✓', PALETTE.green);
  const rawType = clean(agent.type, 'agent');
  const name = clean(agent.name) || rawType.slice(rawType.lastIndexOf(':') + 1) || 'agent';

  const task: Line = [s(clean(agent.description, '—'), running ? PALETTE.bright : PALETTE.dim)];
  const model = formatAgentModel(agent.model);
  if (model) task.push(s(` · ${model}`, PALETTE.dim));

  const skills = (width: number): Line => fitSkills(detail?.skills ?? [], width, running ? PALETTE.green : PALETTE.dim);

  let progress: Line;
  const total = detail?.todosTotal ?? 0;
  if (total > 0 && detail) {
    const pct = Math.round((detail.todosDone / total) * 100);
    const color = running ? PALETTE.violet : PALETTE.doneBar;
    progress = [
      ...bar(pct, 10, color),
      sp(1),
      ...fit([s(`${pct}%`, running ? PALETTE.violet : PALETTE.dim, running)], 4, 'right'),
      sp(1),
      s(`${detail.todosDone}/${total}`, PALETTE.dim),
    ];
  } else if (running) {
    progress = [s(label('panel.noPlan'), PALETTE.dim)];
    if (detail && detail.toolCount > 0) {
      progress.push(s(` · ${interpolate(label('panel.uses'), { count: detail.toolCount })}`, PALETTE.dim));
    }
  } else {
    progress = [s(BAR_CELL.repeat(10), PALETTE.doneBar), sp(1), s(label('panel.done'), PALETTE.green)];
  }

  let nowCell: Line;
  if (!running) {
    nowCell = [s('—', PALETTE.dim)];
  } else if (detail?.currentTool) {
    nowCell = [s(detail.currentTool.name, PALETTE.bright)];
    if (detail.currentTool.target) nowCell.push(s(` ${detail.currentTool.target}`, PALETTE.dim));
  } else {
    nowCell = [s(label('panel.thinking'), PALETTE.dim)];
  }

  const start = agent.startTime.getTime();
  const end = agent.endTime?.getTime() ?? now;
  return {
    agent: [glyph, sp(1), s(name, running ? PALETTE.agent : PALETTE.dim, running)],
    task,
    skills,
    progress,
    now: nowCell,
    tokens: [s(detail?.contextTokens ? formatCount(detail.contextTokens) : '—', PALETTE.dim)],
    time: [s(formatDuration(Math.max(0, end - start)) || '—', PALETTE.dim)],
  };
}

type ColumnKey = keyof AgentCells;

interface Column {
  key: ColumnKey;
  header: MessageKey;
  width: number; // 0 = flexible
  align?: 'right';
}

const COLUMN_GAP = 2;
const TASK_MIN = 20;
const NOW_MIN = 14;

function planColumns(innerWidth: number): Column[] | null {
  const column = (key: ColumnKey, width: number): Column => {
    const headers: Record<ColumnKey, MessageKey> = {
      agent: 'panel.col.agent',
      task: 'panel.col.task',
      skills: 'panel.col.skills',
      progress: 'panel.col.progress',
      now: 'panel.col.now',
      tokens: 'panel.col.tokens',
      time: 'panel.col.time',
    };
    const align = key === 'tokens' || key === 'time' ? 'right' : undefined;
    return { key, header: headers[key], width, align };
  };
  const layout = (skills: number | null, withTokens: boolean, withNow: boolean): Column[] => [
    column('agent', 20),
    column('task', 0),
    ...(skills ? [column('skills', skills)] : []),
    column('progress', 19),
    ...(withNow ? [column('now', 0)] : []),
    ...(withTokens ? [column('tokens', 5)] : []),
    column('time', 7),
  ];
  // Most to least detailed; the first one whose flexible columns fit wins.
  const candidates = [
    layout(24, true, true),
    layout(24, false, true),
    layout(16, false, true),
    layout(null, false, true),
    layout(null, false, false),
  ];

  for (const columns of candidates) {
    const fixed = columns.reduce((sum, c) => sum + c.width, 0) + COLUMN_GAP * (columns.length - 1);
    const flex = innerWidth - fixed;
    const hasNow = columns.some((c) => c.key === 'now');
    if (flex < TASK_MIN + (hasNow ? NOW_MIN : 0)) continue;
    const taskWidth = hasNow ? Math.max(TASK_MIN, Math.min(flex - NOW_MIN, Math.round(flex * 0.58))) : flex;
    return columns.map((c) => {
      if (c.key === 'task') return { ...c, width: taskWidth };
      if (c.key === 'now') return { ...c, width: flex - taskWidth };
      return c;
    });
  }
  return null;
}

function agentTable(ctx: RenderContext, innerWidth: number, now: number): Line[] {
  const { shown, hiddenRunning } = selectPanelAgents(ctx.transcript.agents ?? [], ctx.config, now);
  if (shown.length === 0) return [];

  const lines: Line[] = [[s('┈'.repeat(innerWidth), PALETTE.faint)]];
  const columns = planColumns(innerWidth);

  if (columns) {
    const header: Line = [];
    columns.forEach((c, i) => {
      if (i > 0) header.push(sp(COLUMN_GAP));
      header.push(...fit([s(label(c.header), PALETTE.dim)], c.width, c.align));
    });
    lines.push(header);
    for (const agent of shown) {
      const cells = agentCells(agent, ctx.subagents?.get(agent.id), now);
      const row: Line = [];
      columns.forEach((c, i) => {
        if (i > 0) row.push(sp(COLUMN_GAP));
        const cell = c.key === 'skills' ? cells.skills(c.width) : cells[c.key];
        row.push(...fit(cell, c.width, c.align));
      });
      lines.push(row);
    }
  } else {
    // Narrow terminals: two lines per agent.
    for (const agent of shown) {
      const cells = agentCells(agent, ctx.subagents?.get(agent.id), now);
      const right: Line = [...cells.progress, sp(2), ...cells.time];
      const leftWidth = Math.max(8, innerWidth - lineWidth(right) - 1);
      lines.push([...fit(cells.agent, leftWidth), sp(1), ...truncate(right, innerWidth - leftWidth - 1)]);
      const detailLine: Line = agent.status === 'running'
        ? [...cells.task, s(' → ', PALETTE.dim), ...cells.now]
        : cells.task;
      lines.push([sp(2), ...truncate(detailLine, innerWidth - 2)]);
    }
  }

  if (hiddenRunning > 0) {
    lines.push([s(interpolate(label('panel.moreAgents'), { count: hiddenRunning }), PALETTE.dim)]);
  }
  return lines;
}

function activityRows(ctx: RenderContext, innerWidth: number, includeEnvironment: boolean, now: number): Line[] {
  const agents = ctx.transcript.agents ?? [];
  const runningCount = agents.filter((a) => a.status === 'running').length;
  const doneCount = agents.length - runningCount;

  const right: Line = [];
  if (agents.length > 0) {
    const runningKey: MessageKey = runningCount === 1 ? 'panel.agentsRunningOne' : 'panel.agentsRunning';
    const doneKey: MessageKey = doneCount === 1 ? 'panel.agentsDoneOne' : 'panel.agentsDone';
    right.push(s(interpolate(label(runningKey), { count: runningCount }), runningCount > 0 ? PALETTE.bright : PALETTE.dim));
    right.push(s(` · ${interpolate(label(doneKey), { count: doneCount })}`, PALETTE.dim));
  }

  const counts = Object.entries(ctx.transcript.toolCounts ?? {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const toolsLabel = label('panel.tools');
  const leftBudget = innerWidth - lineWidth(right) - (right.length > 0 ? 2 : 0);
  const left: Line = [s(toolsLabel, PALETTE.dim), sp(2)];
  if (counts.length === 0) {
    left.push(s(label('panel.noActivity'), PALETTE.dim));
  } else {
    let used = lineWidth(left);
    for (let i = 0; i < counts.length; i++) {
      const [name, count] = counts[i];
      const shortName = name.startsWith('mcp__') ? name.split('__').slice(1).join(':') : name;
      const item: Line = [s(clean(shortName), PALETTE.fg), sp(1), s(String(count), PALETTE.cyan, true)];
      const remaining = counts.length - i - 1;
      const moreWidth = remaining > 0 ? cellWidth(`  +${remaining}`) : 0;
      const itemWidth = lineWidth(item) + (i > 0 ? 2 : 0);
      if (used + itemWidth + moreWidth > leftBudget) {
        left.push(s(`  +${counts.length - i}`, PALETTE.dim));
        break;
      }
      if (i > 0) left.push(sp(2));
      left.push(...item);
      used += itemWidth;
    }
  }

  const firstLine = right.length > 0
    ? [...fit(left, innerWidth - lineWidth(right)), ...right]
    : left;

  const rows: Line[] = [firstLine];
  if (includeEnvironment) rows.push(environmentInline(ctx));
  rows.push(...agentTable(ctx, innerWidth, now));
  return rows;
}

// ---------------------------------------------------------------------------

export function renderPanel(ctx: RenderContext, terminalWidth: number | null): string[] {
  ambiguousWide = isCjkAmbiguousWide();
  const now = Date.now();
  const columns = terminalWidth ?? DEFAULT_WIDTH;
  const width = Math.max(40, Math.min(MAX_PANEL_WIDTH, ctx.config?.maxWidth ?? MAX_PANEL_WIDTH, columns - EDGE_MARGIN));

  const titles = {
    session: label('panel.session'),
    usage: label('panel.usage'),
    environment: label('panel.environment'),
    activity: label('panel.activity'),
  };

  let top: string[];
  let environmentInActivity = false;

  if (width >= WIDE_MIN) {
    const available = width - 2;
    const sessionWidth = Math.round((available * 1.2) / 3.4);
    const envWidth = Math.max(32, Math.round((available * 0.85) / 3.4));
    const usageWidth = available - sessionWidth - envWidth;
    top = sideBySide([
      box(titles.session, PALETTE.violet, sessionRows(ctx), sessionWidth, 4),
      box(titles.usage, PALETTE.cyan, usageRows(ctx, usageWidth - 4), usageWidth, 4),
      box(titles.environment, PALETTE.pink, environmentRows(ctx, envWidth - 4), envWidth, 4),
    ]);
  } else if (width >= MEDIUM_MIN) {
    const available = width - 1;
    const sessionWidth = Math.floor(available * 0.47);
    const usageWidth = available - sessionWidth;
    top = sideBySide([
      box(titles.session, PALETTE.violet, sessionRows(ctx), sessionWidth, 4),
      box(titles.usage, PALETTE.cyan, usageRows(ctx, usageWidth - 4), usageWidth, 4),
    ]);
    environmentInActivity = true;
  } else {
    top = [
      ...box(titles.session, PALETTE.violet, sessionRows(ctx), width, 4),
      ...box(titles.usage, PALETTE.cyan, usageRows(ctx, width - 4), width, 4),
    ];
    environmentInActivity = true;
  }

  const activity = activityRows(ctx, width - 4, environmentInActivity, now);
  return [...top, ...box(titles.activity, PALETTE.amber, activity, width, activity.length)];
}
