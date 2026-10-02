// End-to-end golden output for the panel layout: runs src/index.ts for every
// case in tests/panel-golden/cases.mjs and compares stdout with
// tests/panel-golden/expected.txt.
// Regenerate with `UPDATE_SNAPSHOTS=1 bun test tests/panel-golden.test.js`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, copyFile, readFile, readdir, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import cases, { NOW_MS } from './panel-golden/cases.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const goldenDir = path.join(root, 'tests', 'panel-golden');
const expectedPath = path.join(goldenDir, 'expected.txt');
const freezeTime = path.join(root, 'tests', 'golden', 'freeze-time.mjs');
const update = process.env.UPDATE_SNAPSHOTS === '1';

async function setUpGit(cwd, env, state) {
  const git = (...args) => execFileSync(
    'git',
    ['-c', 'user.name=Golden', '-c', 'user.email=golden@example.com', ...args],
    { cwd, env, stdio: 'ignore' },
  );
  git('init', '-q', '-b', 'main');
  git('commit', '-q', '--allow-empty', '-m', 'init');
  if (state !== 'dirty') return;
  await writeFile(path.join(cwd, 'tracked.txt'), 'one\n');
  git('add', 'tracked.txt');
  git('commit', '-q', '-m', 'add file');
  await writeFile(path.join(cwd, 'tracked.txt'), 'one\ntwo\nthree\n');
  await writeFile(path.join(cwd, 'untracked.txt'), 'new\n');
}

async function copyDir(from, to, filter = () => true) {
  await mkdir(to, { recursive: true });
  for (const name of await readdir(from)) {
    if (filter(name)) await copyFile(path.join(from, name), path.join(to, name));
  }
}

async function runCase(spec) {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), 'hud-panel-golden-')));
  try {
    const home = path.join(base, 'home');
    const configDir = path.join(home, '.claude');
    const project = path.join(home, 'dev', spec.projectName ?? 'my-project');
    const projectDir = path.join(configDir, 'projects', 'golden');
    const transcript = path.join(projectDir, 'golden-session.jsonl');
    await mkdir(project, { recursive: true });
    await mkdir(projectDir, { recursive: true });
    if (spec.transcript !== null) {
      await copyFile(path.join(goldenDir, 'golden-session.jsonl'), transcript);
      await copyDir(path.join(goldenDir, 'subagents'), path.join(projectDir, 'golden-session', 'subagents'));
      await copyDir(path.join(goldenDir, 'agents'), path.join(configDir, 'agents'), (n) => n.endsWith('.md'));
    }
    if (spec.setup) await spec.setup({ projectDir, transcript });
    const pluginDir = path.join(configDir, 'plugins', 'claude-hud');
    await mkdir(pluginDir, { recursive: true });
    if (spec.config) {
      await writeFile(
        path.join(pluginDir, 'config.json'),
        JSON.stringify(spec.config).replaceAll('<HOME>', home),
      );
    }
    if (spec.snapshot) {
      await writeFile(path.join(pluginDir, 'usage-snapshot.json'), JSON.stringify({
        updated_at: new Date(NOW_MS).toISOString(),
        five_hour: { used_percentage: 12, resets_at: new Date(NOW_MS + 2 * 3_600_000).toISOString() },
        seven_day: { used_percentage: 31, resets_at: new Date(NOW_MS + 3 * 86_400_000).toISOString() },
      }));
    }

    const env = {
      PATH: process.env.PATH,
      HOME: home,
      CLAUDE_CONFIG_DIR: configDir,
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      TZ: 'UTC',
      HUD_FAKE_NOW: String(NOW_MS),
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      ...(spec.columns ? { COLUMNS: String(spec.columns) } : {}),
    };
    if (spec.git) await setUpGit(project, env, spec.git);

    const input = JSON.stringify(spec.stdin)
      .replaceAll('<PROJECT>', project)
      .replaceAll('<TRANSCRIPT>', transcript);

    const stdout = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--preload', freezeTime, path.join(root, 'src', 'index.ts')], {
        cwd: project,
        env,
      });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`exit ${code}: ${err}`))));
      child.stdin.end(input);
    });

    const normalized = stdout
      .replaceAll(pathToFileURL(base).href, 'file://<BASE>')
      .replaceAll(base, '<BASE>')
      .replaceAll('\x1b', '\\e')
      .replaceAll(' ', '<NBSP>')
      .trimEnd();
    return { raw: stdout, normalized };
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

async function runAll(limit = 8) {
  const results = new Array(cases.length);
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < cases.length) {
      const i = next++;
      results[i] = await runCase(cases[i]);
    }
  }));
  return results;
}

let memo;
const runAllOnce = () => (memo ??= runAll());

function parseExpected(text) {
  const map = new Map();
  for (const block of text.split(/^### /m).slice(1)) {
    const newline = block.indexOf('\n');
    map.set(block.slice(0, newline), block.slice(newline + 1).replace(/\n+$/, ''));
  }
  return map;
}

test('panel golden output', async (t) => {
  const outputs = await runAllOnce();
  const actual = cases.map((c, i) => `### ${c.name}\n${outputs[i].normalized}\n`).join('\n');
  if (update) {
    await writeFile(expectedPath, actual);
    return;
  }

  const expected = parseExpected(await readFile(expectedPath, 'utf8').catch(() => ''));
  assert.deepEqual(
    [...expected.keys()],
    cases.map((c) => c.name),
    'case list changed; run UPDATE_SNAPSHOTS=1 bun test tests/panel-golden.test.js',
  );
  for (const [i, c] of cases.entries()) {
    await t.test(c.name, () => assert.equal(outputs[i].normalized, expected.get(c.name)));
  }
});

test('every panel line has the same width, sized to the terminal', async () => {
  const outputs = await runAllOnce();
  for (const [i, c] of cases.entries()) {
    const lines = outputs[i].raw.trimEnd().split('\n');
    const expected = Math.max(40, Math.min(180, (c.columns ?? 120) - 4));
    assert.deepEqual(lines.map((l) => Bun.stringWidth(l)), lines.map(() => expected), c.name);
  }
});

const jsonl = (...entries) => entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
const assistantUsage = (id, usage, extra = {}) => ({
  type: 'assistant',
  timestamp: '2026-10-01T11:30:00.000Z',
  ...extra,
  message: { id, role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'ok' }], usage },
});

test("main adds subagent token totals to the panel's session token total", async () => {
  // Main: 12k tokens, 9k read from cache. Subagent: 30k tokens, 6k from cache.
  // Sum: 42k tokens, 15k/42k = 36% cache. Either file alone shows 12k or 30k.
  const { raw } = await runCase({
    name: 'subagent-token-wiring',
    stdin: {
      session_id: 'golden-session',
      transcript_path: '<TRANSCRIPT>',
      cwd: '<PROJECT>',
      model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' },
      context_window: { context_window_size: 200_000, used_percentage: 10, current_usage: { input_tokens: 20_000 } },
    },
    config: { lineLayout: 'panel' },
    columns: 140,
    transcript: null,
    async setup({ projectDir, transcript }) {
      await writeFile(transcript, jsonl(assistantUsage('msg_main', {
        input_tokens: 1_000, output_tokens: 1_000, cache_creation_input_tokens: 1_000, cache_read_input_tokens: 9_000,
      })));
      const subagents = path.join(projectDir, 'golden-session', 'subagents');
      await mkdir(subagents, { recursive: true });
      await writeFile(path.join(subagents, 'agent-x.meta.json'), JSON.stringify({ toolUseId: 'toolu_x' }));
      await writeFile(path.join(subagents, 'agent-x.jsonl'), jsonl(assistantUsage('msg_sub', {
        input_tokens: 10_000, output_tokens: 10_000, cache_creation_input_tokens: 4_000, cache_read_input_tokens: 6_000,
      }, { isSidechain: true })));
    },
  });
  // eslint-disable-next-line no-control-regex
  const plain = raw.replace(/\x1b\[[0-9;]*m/g, '');
  const session = plain.split('\n').find((line) => line.includes(' tok'));
  assert.ok(session, `a token segment in:\n${plain}`);
  assert.match(session, /· 42k tok \(36% cache\)/);
});
