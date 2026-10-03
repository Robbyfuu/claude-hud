import * as fs from 'node:fs';
import * as path from 'node:path';
import { getClaudeConfigDir, getHomeDir } from './claude-config-dir.js';

export interface OtherSession {
  project: string;
  lastWriteAt: number;
  agentsActive: number;
}

const ACTIVE_MS = 15 * 60_000;
const AGENT_ACTIVE_MS = 2 * 60_000;
const TAIL_BYTES = 64 * 1024;
const MAX_SESSIONS = 20;

function readTail(file: string, size: number): string {
  const fd = fs.openSync(file, 'r');
  try {
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function lastCwd(file: string, size: number): string | undefined {
  try {
    const lines = readTail(file, size).split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const cwd = (JSON.parse(lines[i]) as { cwd?: unknown } | null)?.cwd;
        // A root cwd ("/") has no basename: keep looking for a nameable one.
        const base = typeof cwd === 'string' ? path.basename(cwd) : '';
        if (base) return base;
      } catch {
        // half-written or truncated line
      }
    }
  } catch {
    // unreadable transcript
  }
  return undefined;
}

function countActiveAgents(transcript: string, now: number): number {
  const dir = path.join(transcript.slice(0, -'.jsonl'.length), 'subagents');
  let count = 0;
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.jsonl')) continue;
      try {
        if (now - fs.statSync(path.join(dir, name)).mtimeMs < AGENT_ACTIVE_MS) count++;
      } catch {
        // vanished between readdir and stat
      }
    }
  } catch {
    // no subagents dir
  }
  return count;
}

export function readOtherSessions(currentTranscriptPath: string, now: number): OtherSession[] {
  const root = path.join(getClaudeConfigDir(getHomeDir()), 'projects');
  // Real paths, so a symlinked config dir can't make the current session look like another one.
  const real = (p: string): string => {
    try {
      return fs.realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  };
  const current = currentTranscriptPath ? real(currentTranscriptPath) : '';
  const sessions: OtherSession[] = [];
  let projectDirs: string[];
  try {
    projectDirs = fs.readdirSync(root);
  } catch {
    return [];
  }
  for (const projectDir of projectDirs) {
    const dir = path.join(root, projectDir);
    let files: string[];
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of files) {
      if (!name.endsWith('.jsonl')) continue;
      const file = path.join(dir, name);
      try {
        const st = fs.statSync(file);
        if (!st.isFile() || now - st.mtimeMs >= ACTIVE_MS) continue;
        // Only active candidates pay for a realpath.
        if (current && real(file) === current) continue;
        sessions.push({
          project: lastCwd(file, st.size) ?? projectDir,
          lastWriteAt: st.mtimeMs,
          agentsActive: countActiveAgents(file, now),
        });
      } catch {
        // skip unreadable entry
      }
    }
  }
  sessions.sort((a, b) => Number(b.agentsActive > 0) - Number(a.agentsActive > 0) || b.lastWriteAt - a.lastWriteAt);
  return sessions.slice(0, MAX_SESSIONS);
}
