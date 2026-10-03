import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readOtherSessions } from '../src/other-sessions.js';

const NOW = 1_800_000_000_000;
const MIN = 60_000;

async function withConfig(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'hud-other-'));
  const prev = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  try {
    return await fn(dir);
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prev;
    await rm(dir, { recursive: true, force: true });
  }
}

function touch(file, ageMs) {
  const t = (NOW - ageMs) / 1000;
  fs.utimesSync(file, t, t);
}

function session(root, projectDir, id, { lines, ageMs = MIN, cwd } = {}) {
  const dir = path.join(root, 'projects', projectDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.jsonl`);
  const body = lines ?? (cwd ? [JSON.stringify({ type: 'user', cwd })] : [JSON.stringify({ type: 'user' })]);
  fs.writeFileSync(file, body.join('\n') + '\n');
  touch(file, ageMs);
  return file;
}

function agent(transcript, name, ageMs) {
  const dir = transcript.replace(/\.jsonl$/, '') + '/subagents';
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.jsonl`);
  fs.writeFileSync(file, '{}\n');
  touch(file, ageMs);
}

test('recent session reports the basename of its last cwd', () =>
  withConfig((root) => {
    session(root, '-x-clay', 'a', { cwd: '/x/clay-academy' });
    const r = readOtherSessions('', NOW);
    assert.equal(r.length, 1);
    assert.equal(r[0].project, 'clay-academy');
    assert.equal(r[0].agentsActive, 0);
    assert.equal(r[0].lastWriteAt, NOW - MIN);
  }));

test('session older than 15 minutes is excluded', () =>
  withConfig((root) => {
    session(root, 'p', 'a', { cwd: '/x/old', ageMs: 30 * MIN });
    assert.deepEqual(readOtherSessions('', NOW), []);
  }));

test('current transcript is excluded', () =>
  withConfig((root) => {
    const cur = session(root, 'p', 'cur', { cwd: '/x/cur' });
    session(root, 'p', 'other', { cwd: '/x/other' });
    assert.deepEqual(readOtherSessions(cur, NOW).map((s) => s.project), ['other']);
  }));

test('counts only subagents written within 2 minutes', () =>
  withConfig((root) => {
    const f = session(root, 'p', 'a', { cwd: '/x/a' });
    agent(f, 'agent-1', MIN);
    agent(f, 'agent-2', 5 * MIN);
    assert.equal(readOtherSessions('', NOW)[0].agentsActive, 1);
  }));

test('falls back to the project dir name without cwd', () =>
  withConfig((root) => {
    session(root, '-Users-me-proj', 'a', {});
    assert.equal(readOtherSessions('', NOW)[0].project, '-Users-me-proj');
  }));

test('a root cwd keeps looking, then falls back to the project dir name', () =>
  withConfig((root) => {
    session(root, '-Users-me-proj', 'a', { lines: [JSON.stringify({ type: 'user', cwd: '/' })] });
    assert.equal(readOtherSessions('', NOW)[0].project, '-Users-me-proj');
    session(root, 'p2', 'b', { lines: [JSON.stringify({ type: 'user', cwd: '/x/real' }), JSON.stringify({ type: 'user', cwd: '/' })] });
    assert.ok(readOtherSessions('', NOW).some((s) => s.project === 'real'));
  }));

test('the current transcript is excluded when reached through a symlinked path', () =>
  withConfig((root) => {
    const cur = session(root, 'p', 'cur', { cwd: '/x/cur' });
    session(root, 'p', 'other', { cwd: '/x/other' });
    const link = path.join(path.dirname(root), `${path.basename(root)}-link`);
    fs.symlinkSync(root, link);
    try {
      const viaLink = path.join(link, 'projects', 'p', 'cur.jsonl');
      assert.deepEqual(readOtherSessions(viaLink, NOW).map((s) => s.project), ['other']);
    } finally {
      fs.unlinkSync(link);
    }
  }));

test('half-written last line falls back to the previous line cwd', () =>
  withConfig((root) => {
    session(root, 'p', 'a', {
      lines: [JSON.stringify({ cwd: '/x/prev' }), '{"cwd":"/x/half', ],
    });
    assert.equal(readOtherSessions('', NOW)[0].project, 'prev');
  }));

test('sessions with active agents come first, then most recent', () =>
  withConfig((root) => {
    session(root, 'p', 'recent', { cwd: '/x/recent', ageMs: 1 * MIN });
    session(root, 'p', 'older', { cwd: '/x/older', ageMs: 5 * MIN });
    const busy = session(root, 'p', 'busy', { cwd: '/x/busy', ageMs: 9 * MIN });
    agent(busy, 'agent-1', 30_000);
    assert.deepEqual(readOtherSessions('', NOW).map((s) => s.project), ['busy', 'recent', 'older']);
  }));

test('a future mtime counts as active', () =>
  withConfig((root) => {
    session(root, 'p', 'a', { cwd: '/x/future', ageMs: -5 * MIN });
    assert.equal(readOtherSessions('', NOW).length, 1);
  }));

test('missing projects dir gives an empty list', () =>
  withConfig(() => {
    assert.deepEqual(readOtherSessions('', NOW), []);
  }));

test('reads cwd from the tail of a 2 MB transcript', () =>
  withConfig((root) => {
    const filler = JSON.stringify({ cwd: '/x/head', pad: 'y'.repeat(1000) });
    const lines = Array.from({ length: 2000 }, () => filler);
    lines.push(JSON.stringify({ cwd: '/x/tail-proj' }));
    session(root, 'p', 'a', { lines });
    assert.equal(readOtherSessions('', NOW)[0].project, 'tail-proj');
  }));

test('returns every active session so the +N count stays exact', () =>
  withConfig((root) => {
    for (let i = 0; i < 25; i++) session(root, 'p', `s${i}`, { cwd: `/x/p${i}` });
    assert.equal(readOtherSessions('', NOW).length, 25);
  }));

test('a directory named like a subagent transcript is not counted as an agent', () =>
  withConfig((root) => {
    const file = session(root, 'p', 'a', { cwd: '/x/a' });
    agent(file, 'agent-real', MIN);
    const fake = path.join(file.replace(/\.jsonl$/, ''), 'subagents', 'agent-dir.jsonl');
    fs.mkdirSync(fake);
    touch(fake, MIN);
    assert.equal(readOtherSessions('', NOW)[0].agentsActive, 1);
  }));
