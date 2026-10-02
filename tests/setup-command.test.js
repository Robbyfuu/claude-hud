import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readSetup = () => readFile(new URL('../commands/setup.md', import.meta.url), 'utf8');

// Match the headings, not the cross-references the prose makes to them.
function windowsGitBashSection(setup) {
  const start = setup.indexOf('**Windows + Git Bash** (Platform:');
  const end = setup.indexOf('**Windows + PowerShell** (Platform:', start);
  assert.ok(start !== -1 && end > start, 'Windows + Git Bash section not found');
  return setup.slice(start, end);
}

test('setup commands silence /dev/tty failures before opening the device', async () => {
  const setup = await readSetup();

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

test('setup runs Bun without project bunfig.toml or .env', async () => {
  const setup = await readFile(new URL('../commands/setup.md', import.meta.url), 'utf8');
  const runs = setup.match(/"\{RUNTIME_PATH\}" [^\n']*/g) ?? [];

  assert.equal(runs.length, 3, 'statusLine command plus the two settings.json readers');
  for (const run of runs) {
    // A project's bunfig.toml preload would otherwise print into the statusline.
    assert.match(run, /^"\{RUNTIME_PATH\}" --config=\/dev\/null /, run);
  }
  assert.match(setup, /exec "\{RUNTIME_PATH\}" --config=\/dev\/null --env-file \/dev\/null /);
});

test('setup gates Windows before Step 0', async () => {
  const setup = await readFile(new URL('../commands/setup.md', import.meta.url), 'utf8');

  assert.ok(
    setup.indexOf('WSL') !== -1 && setup.indexOf('WSL') < setup.indexOf('## Step 0'),
    'the Windows/WSL gate must appear before Step 0',
  );
});

test('the Windows Git Bash statusline execs a cmd.exe shim, not the runtime', async () => {
  const gitBash = windowsGitBashSection(await readSetup());

  // A Git Bash shell killed mid-spawn strands its suspended child (#747); keep that a cmd.exe stub.
  assert.doesNotMatch(gitBash, /exec "\{RUNTIME_PATH\}"/);
  assert.match(
    gitBash,
    /exec "\$\{CLAUDE_CONFIG_DIR:-\$HOME\/\.claude\}\/plugins\/claude-hud\/statusline\.cmd"/,
  );
});

test('the Windows Git Bash command exports the raw terminal width', async () => {
  const gitBash = windowsGitBashSection(await readSetup());

  // statusline.mjs subtracts the padding itself.
  assert.match(gitBash, /export COLUMNS="\$cols"/);
  assert.doesNotMatch(gitBash, /export COLUMNS=\$\(\( cols > 4/);
});

test('the Windows Git Bash shim keeps the runtime path out of the printf format', async () => {
  const gitBash = windowsGitBashSection(await readSetup());

  // printf treats backslashes in its format as escapes; batch files need CRLF.
  assert.match(gitBash, /printf '@echo off\\r\\n"%s" "%%~dp0statusline\.mjs"\\r\\n' "\{RUNTIME_PATH_WIN\}"/);
});
