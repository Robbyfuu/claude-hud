import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getHomeDir } from '../src/claude-config-dir.js';

test('getHomeDir reads HOME at call time', () => {
  const original = process.env.HOME;
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'hud-home-'));
  try {
    process.env.HOME = tmp;
    assert.equal(getHomeDir(), tmp);
  } finally {
    process.env.HOME = original;
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('getHomeDir falls back to os.homedir() when HOME is empty', () => {
  const original = process.env.HOME;
  try {
    process.env.HOME = '';
    assert.equal(getHomeDir(), os.homedir());
  } finally {
    process.env.HOME = original;
  }
});

test('the entrypoint runs when executed directly', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'hud-entry-'));
  try {
    const r = spawnSync(process.execPath, ['src/index.ts'], {
      env: { ...process.env, CLAUDE_CONFIG_DIR: tmp },
      input: '',
      timeout: 10_000,
      encoding: 'utf8',
    });
    assert.equal(r.error, undefined);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Initializing/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
