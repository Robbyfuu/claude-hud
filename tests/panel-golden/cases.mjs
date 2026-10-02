// Panel golden cases: each renders `bun src/index.ts` end to end with
// lineLayout "panel". Placeholders <PROJECT>, <TRANSCRIPT> and <HOME> are
// filled in by panel-golden.test.js.
export const NOW_MS = Date.parse('2026-10-01T12:00:00.000Z');
const NOW = NOW_MS / 1000;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function merge(base, patch) {
  if (!isObject(base) || !isObject(patch)) return patch;
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = v === undefined ? undefined : merge(base[k], v);
  return out;
}

const typical = {
  session_id: 'golden-session',
  transcript_path: '<TRANSCRIPT>',
  cwd: '<PROJECT>',
  workspace: { current_dir: '<PROJECT>', project_dir: '<PROJECT>', added_dirs: [] },
  model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' },
  version: '2.1.286',
  output_style: { name: 'default' },
  cost: {
    total_cost_usd: 1.2345,
    total_duration_ms: 3_600_000,
    total_api_duration_ms: 600_000,
    total_lines_added: 156,
    total_lines_removed: 23,
  },
  context_window: {
    total_input_tokens: 90_000,
    total_output_tokens: 1_200,
    context_window_size: 200_000,
    used_percentage: 45,
    remaining_percentage: 55,
    current_usage: {
      input_tokens: 8_000,
      output_tokens: 1_200,
      cache_creation_input_tokens: 2_000,
      cache_read_input_tokens: 80_000,
    },
  },
  exceeds_200k_tokens: false,
  rate_limits: {
    five_hour: { used_percentage: 25, resets_at: NOW + 5_400 },
    seven_day: { used_percentage: 41.2, resets_at: NOW + 3 * 86_400 + 3_600 },
  },
};

const panel = { lineLayout: 'panel' };

const USER_CONFIG = {
  lineLayout: 'panel',
  panel: { icons: 'nerd' },
  display: {
    externalUsageWritePath: '<HOME>/.claude/plugins/claude-hud/usage-snapshot.json',
    externalUsagePath: '<HOME>/.claude/plugins/claude-hud/usage-snapshot.json',
    showTools: true,
    showAgents: true,
    showTodos: true,
    showDuration: true,
    showConfigCounts: true,
    showSessionName: true,
  },
};

export default [
  { name: 'wide', stdin: typical, config: panel, columns: 140, git: 'clean' },
  { name: 'medium', stdin: typical, config: panel, columns: 100 },
  { name: 'narrow', stdin: typical, config: panel, columns: 70 },
  { name: 'unknown-width', stdin: typical, config: panel },
  { name: 'narrow-es', stdin: typical, config: { ...panel, language: 'es' }, columns: 70 },
  { name: 'nerd', stdin: typical, config: { ...panel, panel: { icons: 'nerd' } }, columns: 140 },
  {
    name: 'critical-advice',
    stdin: merge(typical, { context_window: { used_percentage: 92 }, prompt_cache: { warm: false } }),
    config: panel,
    columns: 140,
  },
  { name: 'no-transcript', stdin: typical, config: panel, columns: 140, transcript: null },
  { name: 'cjk', stdin: typical, config: panel, columns: 100, projectName: '日本語-プロジェクト' },
  {
    name: 'user-shape',
    stdin: merge(typical, { rate_limits: undefined }),
    config: USER_CONFIG,
    columns: 140,
    git: 'dirty',
    snapshot: true,
  },
];
