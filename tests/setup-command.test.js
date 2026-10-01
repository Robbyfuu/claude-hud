import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('setup commands silence /dev/tty failures before opening the device', async () => {
  const setup = await readFile(new URL('../commands/setup.md', import.meta.url), 'utf8');

  assert.doesNotMatch(setup, /stty size <\/dev\/tty 2>\/dev\/null/);
  assert.equal(setup.match(/stty size 2>\/dev\/null <\/dev\/tty/g)?.length, 1);
});

test('setup only offers the Bun runtime', async () => {
  const setup = await readFile(new URL('../commands/setup.md', import.meta.url), 'utf8');

  assert.doesNotMatch(setup, /command -v node/);
  assert.doesNotMatch(setup, /dist\/index\.js/);
  assert.doesNotMatch(setup, /PowerShell/i);
  assert.doesNotMatch(setup, /\$env:|\$existingCommand|\$backupPath/i);
  assert.match(setup, /command -v bun/);
  assert.match(setup, /WSL/);
});

test('setup gates Windows before Step 0', async () => {
  const setup = await readFile(new URL('../commands/setup.md', import.meta.url), 'utf8');

  assert.ok(
    setup.indexOf('WSL') !== -1 && setup.indexOf('WSL') < setup.indexOf('## Step 0'),
    'the Windows/WSL gate must appear before Step 0',
  );
});
