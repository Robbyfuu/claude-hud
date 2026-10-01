import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AgentEntry, SubagentDetail } from './types.js';
import { getClaudeConfigDir } from './claude-config-dir.js';
import { sanitizeDisplayText } from './utils/sanitize.js';
import { createDebug } from './debug.js';

const debug = createDebug('subagents');

// Subagent transcripts live next to the session transcript:
//   <project>/<sessionId>.jsonl
//   <project>/<sessionId>/subagents/agent-<agentId>.jsonl
//   <project>/<sessionId>/subagents/agent-<agentId>.meta.json  ({ agentType, description, toolUseId, ... })
// The meta file's `toolUseId` is the id of the Agent/Task tool_use that spawned it.

const MAX_META_FILES = 500;
const MAX_TRANSCRIPT_BYTES = 32 * 1024 * 1024;
const MAX_NAME_LEN = 48;
const MAX_TARGET_LEN = 80;
const MAX_SKILLS = 8;
const MAX_AGENT_DEF_FILES = 400;

// Bookkeeping tools that say nothing about what the agent is doing.
const QUIET_TOOLS = new Set([
  'TodoWrite',
  'TaskCreate',
  'TaskUpdate',
  'TaskGet',
  'TaskList',
  'ToolSearch',
]);

interface ContentBlock {
  type?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
}

interface SubagentLine {
  type?: string;
  timestamp?: string;
  message?: {
    content?: ContentBlock[] | string;
    usage?: {
      input_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  toolUseResult?: { task?: { id?: unknown } };
}

interface TaskState {
  status: 'pending' | 'in_progress' | 'completed' | 'deleted';
}

function cleanName(value: unknown, maxLen = MAX_NAME_LEN): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = sanitizeDisplayText(value).trim();
  if (!cleaned) return undefined;
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen - 1)}…` : cleaned;
}

export function getSubagentsDir(transcriptPath: string): string {
  const dir = path.dirname(transcriptPath);
  const sessionId = path.basename(transcriptPath, '.jsonl');
  return path.join(dir, sessionId, 'subagents');
}

const teammateKey = (name: string): string => `name:${name}`;

/**
 * Maps spawning tool_use ids to subagent transcript paths. Background teammates'
 * metas carry no toolUseId, so they are keyed by teammate name instead; when a
 * name was reused, the most recently spawned meta wins.
 */
export function readSubagentIndex(subagentsDir: string): Map<string, string> {
  const index = new Map<string, string>();
  const teammateSpawnedAt = new Map<string, number>();
  let entries: string[];
  try {
    entries = fs.readdirSync(subagentsDir);
  } catch {
    return index;
  }

  let seen = 0;
  for (const name of entries) {
    if (!name.endsWith('.meta.json')) continue;
    if (++seen > MAX_META_FILES) break;
    try {
      const metaPath = path.join(subagentsDir, name);
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as { toolUseId?: unknown; name?: unknown };
      const transcript = path.join(subagentsDir, name.replace(/\.meta\.json$/, '.jsonl'));
      if (typeof meta.toolUseId === 'string' && meta.toolUseId) {
        index.set(meta.toolUseId, transcript);
      } else if (typeof meta.name === 'string' && meta.name) {
        const key = teammateKey(meta.name);
        const spawnedAt = fs.statSync(metaPath).mtimeMs;
        if (spawnedAt >= (teammateSpawnedAt.get(key) ?? -Infinity)) {
          teammateSpawnedAt.set(key, spawnedAt);
          index.set(key, transcript);
        }
      }
    } catch (err) {
      debug('Skipping unreadable subagent meta %s:', name, err instanceof Error ? err.message : err);
    }
  }
  return index;
}

export function describeToolTarget(toolName: string, input?: Record<string, unknown>): string | undefined {
  if (!input) return undefined;
  const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

  let target: string | undefined;
  switch (toolName) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit': {
      const file = str(input.file_path) ?? str(input.path) ?? str(input.notebook_path);
      target = file ? path.basename(file) : undefined;
      break;
    }
    case 'Glob':
    case 'Grep':
      target = str(input.pattern);
      break;
    case 'Bash':
      target = str(input.command)?.replace(/\s+/g, ' ').trim();
      break;
    case 'WebFetch': {
      const url = str(input.url);
      try {
        target = url ? new URL(url).hostname : undefined;
      } catch {
        target = url;
      }
      break;
    }
    case 'WebSearch':
      target = str(input.query);
      break;
    case 'Skill':
      target = str(input.skill);
      break;
    case 'Agent':
    case 'Task':
      target = str(input.subagent_type) ?? str(input.description);
      break;
    default:
      target = undefined;
  }
  return cleanName(target, MAX_TARGET_LEN);
}

function normalizeTaskStatus(status: unknown): TaskState['status'] | null {
  switch (status) {
    case 'pending':
    case 'not_started':
      return 'pending';
    case 'in_progress':
    case 'running':
      return 'in_progress';
    case 'completed':
    case 'complete':
    case 'done':
      return 'completed';
    case 'deleted':
      return 'deleted';
    default:
      return null;
  }
}

function readTail(filePath: string): string | null {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    if (stat.size <= MAX_TRANSCRIPT_BYTES) {
      return fs.readFileSync(filePath, 'utf8');
    }
    // Very long subagent runs: read only the tail. Early task-list entries may be
    // lost, which only affects the progress figure.
    const fd = fs.openSync(filePath, 'r');
    try {
      const buffer = Buffer.alloc(MAX_TRANSCRIPT_BYTES);
      fs.readSync(fd, buffer, 0, MAX_TRANSCRIPT_BYTES, stat.size - MAX_TRANSCRIPT_BYTES);
      const text = buffer.toString('utf8');
      return text.slice(text.indexOf('\n') + 1);
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    debug('Failed to read subagent transcript %s:', filePath, err instanceof Error ? err.message : err);
    return null;
  }
}

/** Parses one subagent transcript into the detail the panel shows. */
export function parseSubagentTranscript(filePath: string): SubagentDetail | null {
  const text = readTail(filePath);
  if (text === null) return null;

  const detail: SubagentDetail = { skills: [], todosDone: 0, todosTotal: 0, toolCount: 0 };
  const skills = new Set<string>();
  const pending = new Map<string, { name: string; target?: string }>();
  const tasks = new Map<string, TaskState>();
  const createdByToolUse = new Map<string, TaskState>();
  let todoWriteList: TaskState[] | null = null;

  for (const line of text.split('\n')) {
    // Cheap prefilter: only tool traffic and usage matter here.
    if (!line || (!line.includes('"tool_') && !line.includes('"usage"'))) continue;

    let entry: SubagentLine;
    try {
      entry = JSON.parse(line) as SubagentLine;
    } catch {
      continue;
    }

    const at = entry.timestamp ? new Date(entry.timestamp) : undefined;
    const hasTime = at !== undefined && !Number.isNaN(at.getTime());

    if (entry.type === 'assistant') {
      if (hasTime) detail.lastActivityAt = at;
      const usage = entry.message?.usage;
      if (usage) {
        const total = (usage.input_tokens ?? 0)
          + (usage.cache_creation_input_tokens ?? 0)
          + (usage.cache_read_input_tokens ?? 0);
        if (total > 0) detail.contextTokens = total;
      }
    }

    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (block.type === 'tool_use' && block.id && block.name) {
        const input = block.input ?? {};

        if (block.name === 'Skill') {
          const skill = cleanName(input.skill);
          if (skill) skills.add(skill);
        } else if (block.name === 'TaskCreate') {
          const task: TaskState = { status: normalizeTaskStatus(input.status) ?? 'pending' };
          createdByToolUse.set(block.id, task);
          if (typeof input.taskId === 'string' || typeof input.taskId === 'number') {
            tasks.set(String(input.taskId), task);
          }
          todoWriteList = null;
        } else if (block.name === 'TaskUpdate') {
          const id = typeof input.taskId === 'string' || typeof input.taskId === 'number' ? String(input.taskId) : '';
          const task = tasks.get(id);
          const status = normalizeTaskStatus(input.status);
          if (task && status) task.status = status;
        } else if (block.name === 'TodoWrite' && Array.isArray(input.todos)) {
          todoWriteList = (input.todos as Array<{ status?: unknown }>).map((todo) => ({
            status: normalizeTaskStatus(todo?.status) ?? 'pending',
          }));
        }

        if (!QUIET_TOOLS.has(block.name)) {
          const name = cleanName(block.name) ?? 'tool';
          const tool = { name, target: describeToolTarget(block.name, input) };
          detail.toolCount += 1;
          detail.lastTool = tool;
          pending.set(block.id, tool);
        }
      } else if (block.type === 'tool_result' && block.tool_use_id) {
        pending.delete(block.tool_use_id);
        const created = createdByToolUse.get(block.tool_use_id);
        const assignedId = entry.toolUseResult?.task?.id;
        if (created && (typeof assignedId === 'string' || typeof assignedId === 'number')) {
          tasks.set(String(assignedId), created);
        } else if (created) {
          // Older builds only report the id in the result text: "Task #8 created successfully".
          const resultLine = JSON.stringify(block);
          const match = resultLine.match(/Task #(\w+) created/);
          if (match) tasks.set(match[1], created);
        }
      }
    }
  }

  const taskList: TaskState[] = todoWriteList ?? Array.from(new Set([
    ...createdByToolUse.values(),
    ...tasks.values(),
  ]));
  const live = taskList.filter((task) => task.status !== 'deleted');
  detail.todosTotal = live.length;
  detail.todosDone = live.filter((task) => task.status === 'completed').length;

  const pendingTools = Array.from(pending.values());
  detail.currentTool = pendingTools[pendingTools.length - 1];
  detail.skills = Array.from(skills);
  return detail;
}

// --- Agent definitions (preloaded `skills:` frontmatter) ---------------------

function parseFrontmatter(text: string): { name?: string; skills: string[] } {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { skills: [] };
  const lines = match[1].split(/\r?\n/);
  let name: string | undefined;
  const skills: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const nameMatch = lines[i].match(/^name:\s*["']?([^"'#]+?)["']?\s*$/);
    if (nameMatch) {
      name = nameMatch[1].trim();
      continue;
    }
    const skillsMatch = lines[i].match(/^skills:\s*(.*)$/);
    if (!skillsMatch) continue;

    const inline = skillsMatch[1].trim();
    if (inline && inline !== '|' && inline !== '>') {
      // `skills: a, b` or `skills: [a, b]`
      for (const part of inline.replace(/^\[|\]$/g, '').split(',')) {
        const skill = part.trim().replace(/^["']|["']$/g, '');
        if (skill) skills.push(skill);
      }
    } else {
      // YAML list on the following lines
      for (let j = i + 1; j < lines.length; j++) {
        const item = lines[j].match(/^\s+-\s*["']?([^"'#]+?)["']?\s*$/);
        if (!item) break;
        skills.push(item[1].trim());
      }
    }
  }
  return { name, skills };
}

function listMarkdownFiles(dir: string, budget: { left: number }, depth = 0): string[] {
  if (depth > 3 || budget.left <= 0) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (--budget.left <= 0) break;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listMarkdownFiles(full, budget, depth + 1));
    } else if (entry.name.endsWith('.md')) {
      files.push(full);
    }
  }
  return files;
}

function agentDefinitionDirs(cwd: string | undefined, pluginName: string | undefined): string[] {
  const homeDir = os.homedir();
  const claudeDir = getClaudeConfigDir(homeDir);
  const dirs: string[] = [];

  if (pluginName) {
    // ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/agents
    const cacheDir = path.join(claudeDir, 'plugins', 'cache');
    try {
      for (const marketplace of fs.readdirSync(cacheDir)) {
        const pluginDir = path.join(cacheDir, marketplace, pluginName);
        try {
          for (const version of fs.readdirSync(pluginDir)) {
            dirs.push(path.join(pluginDir, version, 'agents'));
          }
        } catch {
          // plugin not in this marketplace
        }
      }
    } catch {
      // no plugin cache
    }
    return dirs;
  }

  // Project agents: walk up from cwd, closest first.
  if (cwd) {
    let current = path.resolve(cwd);
    for (let i = 0; i < 12; i++) {
      dirs.push(path.join(current, '.claude', 'agents'));
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  dirs.push(path.join(claudeDir, 'agents'));
  return dirs;
}

/** Skills preloaded by an agent definition's `skills:` frontmatter. */
export function readAgentDefinitionSkills(agentType: string, cwd?: string): string[] {
  const separator = agentType.lastIndexOf(':');
  const pluginName = separator > 0 ? agentType.slice(0, agentType.indexOf(':')) : undefined;
  const agentName = separator > 0 ? agentType.slice(separator + 1) : agentType;
  if (!agentName || agentName === 'general-purpose') return [];

  const budget = { left: MAX_AGENT_DEF_FILES };
  for (const dir of agentDefinitionDirs(cwd, pluginName)) {
    for (const file of listMarkdownFiles(dir, budget)) {
      let text: string;
      try {
        text = fs.readFileSync(file, 'utf8').slice(0, 16 * 1024);
      } catch {
        continue;
      }
      const frontmatter = parseFrontmatter(text);
      const definedName = frontmatter.name ?? path.basename(file, '.md');
      if (definedName === agentName) {
        return frontmatter.skills
          .map((skill) => cleanName(skill))
          .filter((skill): skill is string => Boolean(skill));
      }
    }
  }
  return [];
}

/**
 * Reads detail for the given agents (usually just the ones the panel shows).
 * Returns a map keyed by the agent's spawning tool_use id.
 */
export function readSubagentDetails(
  transcriptPath: string,
  agents: AgentEntry[],
  cwd?: string,
): Map<string, SubagentDetail> {
  const details = new Map<string, SubagentDetail>();
  if (!transcriptPath || agents.length === 0) return details;

  const index = readSubagentIndex(getSubagentsDir(transcriptPath));
  const definitionSkills = new Map<string, string[]>();

  for (const agent of agents) {
    const file = index.get(agent.id) ?? (agent.name ? index.get(teammateKey(agent.name)) : undefined);
    const parsed = file ? parseSubagentTranscript(file) : null;
    const detail: SubagentDetail = parsed ?? { skills: [], todosDone: 0, todosTotal: 0, toolCount: 0 };

    if (!definitionSkills.has(agent.type)) {
      definitionSkills.set(agent.type, readAgentDefinitionSkills(agent.type, cwd));
    }
    const preloaded = definitionSkills.get(agent.type) ?? [];
    detail.skills = Array.from(new Set([...preloaded, ...detail.skills])).slice(0, MAX_SKILLS);
    details.set(agent.id, detail);
  }
  return details;
}
