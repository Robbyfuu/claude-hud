import * as os from 'node:os';
import * as path from 'node:path';

// Bun's os.homedir() caches HOME at startup, so read the env var at call time.
export function getHomeDir(): string {
  return process.env.HOME || os.homedir();
}

function expandHomeDirPrefix(inputPath: string, homeDir: string): string {
  if (inputPath === '~') {
    return homeDir;
  }
  if (inputPath.startsWith('~/') || inputPath.startsWith('~\\')) {
    return path.join(homeDir, inputPath.slice(2));
  }
  return inputPath;
}

export function getClaudeConfigDir(homeDir: string): string {
  const envConfigDir = process.env.CLAUDE_CONFIG_DIR?.trim();
  if (!envConfigDir) {
    return path.join(homeDir, '.claude');
  }
  return path.resolve(expandHomeDirPrefix(envConfigDir, homeDir));
}

export function getClaudeConfigJsonPath(homeDir: string): string {
  return `${getClaudeConfigDir(homeDir)}.json`;
}

export function getHudPluginDir(homeDir: string): string {
  return path.join(getClaudeConfigDir(homeDir), 'plugins', 'claude-hud');
}
