import * as fs from 'node:fs';
import * as path from 'node:path';
import { getClaudeConfigJsonPath, getHomeDir } from './claude-config-dir.js';
import { sanitizeDisplayText } from './utils/sanitize.js';

/**
 * Authentication info for the current Claude Code login, derived from the
 * `oauthAccount` block Claude Code persists in ~/.claude.json, or
 * $CLAUDE_CONFIG_DIR/.claude.json when the config directory is overridden.
 *
 *   method: human-readable auth/plan label (e.g. "Claude Max 20x", "API Key")
 *   user:   account identifier (email local part, falling back to displayName)
 *   email:  full account email, only used to look up the claude-swap alias
 *   alias:  claude-swap (`cswap alias`) name of the active account, e.g. "trabajo"
 */
export interface AuthInfo {
  method: string | null;
  user: string | null;
  email?: string | null;
  alias?: string | null;
}

const EMPTY_AUTH_INFO: AuthInfo = { method: null, user: null };
const API_KEY_AUTH_INFO: AuthInfo = { method: 'API Key', user: null };
const AUTH_VALUE_MAX_LEN = 128;

function hasApiKey(env: NodeJS.ProcessEnv): boolean {
  return typeof env.ANTHROPIC_API_KEY === 'string' && env.ANTHROPIC_API_KEY.trim().length > 0;
}

// Strip ANSI sequences and control/bidi characters so values from
// claude.json can never smuggle escape sequences into the terminal.
function sanitizeValue(value: string): string {
  return sanitizeDisplayText(value).trim().slice(0, AUTH_VALUE_MAX_LEN);
}

function readString(obj: Record<string, unknown>, key: string): string | null {
  const value = obj[key];
  if (typeof value !== 'string') {
    return null;
  }
  const sanitized = sanitizeValue(value);
  return sanitized.length > 0 ? sanitized : null;
}

/**
 * Formats an organizationType value into a display label:
 * "claude_max" → "Claude Max", "claude_pro" → "Claude Pro".
 */
function formatOrgType(orgType: string): string {
  return orgType
    .split('_')
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Extracts a multiplier suffix from a rate-limit tier value:
 * "default_claude_max_20x" → "20x". Returns null when no tier is encoded.
 */
function extractTierSuffix(rateLimitTier: string): string | null {
  const match = /_(\d+x)$/i.exec(rateLimitTier);
  return match ? match[1] : null;
}

/**
 * Derives auth info from the parsed contents of claude.json.
 * Pure so it can be tested without touching the filesystem.
 */
export function deriveAuthInfo(claudeJson: unknown, env: NodeJS.ProcessEnv = process.env): AuthInfo {
  // ANTHROPIC_API_KEY takes precedence at runtime. oauthAccount can remain in
  // claude.json after a user switches to API-key authentication.
  if (hasApiKey(env)) {
    return API_KEY_AUTH_INFO;
  }

  const root = (claudeJson && typeof claudeJson === 'object')
    ? claudeJson as Record<string, unknown>
    : null;
  const account = (root?.oauthAccount && typeof root.oauthAccount === 'object')
    ? root.oauthAccount as Record<string, unknown>
    : null;

  if (!account) {
    return EMPTY_AUTH_INFO;
  }

  let method: string | null = null;
  const orgType = readString(account, 'organizationType');
  if (orgType) {
    method = formatOrgType(orgType);
    const rateLimitTier = readString(account, 'organizationRateLimitTier');
    const tier = rateLimitTier ? extractTierSuffix(rateLimitTier) : null;
    if (tier && !method.toLowerCase().includes(tier.toLowerCase())) {
      method += ` ${tier}`;
    }
  }

  const email = readString(account, 'emailAddress');
  const user = email ? email.split('@')[0] : readString(account, 'displayName');

  return { method, user, email };
}

/**
 * Cache of the two DERIVED fields, keyed on the source file's identity.
 *
 * The identity combines mtime, ctime, size, device, and inode so a replacement
 * or rapid rewrite cannot reuse a stale entry based on one timestamp alone.
 */
export function readAuthInfo(): AuthInfo {
  // An API key wins over whatever OAuth profile claude.json still holds.
  if (hasApiKey(process.env)) {
    return API_KEY_AUTH_INFO;
  }
  try {
    return deriveAuthInfo(JSON.parse(fs.readFileSync(getClaudeConfigJsonPath(getHomeDir()), 'utf8')));
  } catch {
    return EMPTY_AUTH_INFO;
  }
}

/**
 * claude-swap keeps its accounts in <backup root>/sequence.json: ~/.claude-swap-backup,
 * or $XDG_DATA_HOME/claude-swap on Linux.
 */
function getSwapSequencePaths(homeDir: string): string[] {
  const xdg = process.env.XDG_DATA_HOME?.trim();
  const xdgRoot = xdg && path.isAbsolute(xdg) ? xdg : path.join(homeDir, '.local', 'share');
  return [
    path.join(homeDir, '.claude-swap-backup', 'sequence.json'),
    path.join(xdgRoot, 'claude-swap', 'sequence.json'),
  ];
}

/**
 * Finds the claude-swap alias for the logged-in account. Matches on email, since
 * that is what Claude Code actually authenticates with, and falls back to the
 * account claude-swap marks active when no email is known.
 * Pure so it can be tested without touching the filesystem.
 */
export function deriveSwapAlias(sequenceJson: unknown, email: string | null): string | null {
  const root = (sequenceJson && typeof sequenceJson === 'object') ? sequenceJson as Record<string, unknown> : null;
  const accounts = (root?.accounts && typeof root.accounts === 'object') ? root.accounts as Record<string, unknown> : null;
  if (!accounts) return null;

  const records = Object.entries(accounts)
    .filter((entry): entry is [string, Record<string, unknown>] => !!entry[1] && typeof entry[1] === 'object');
  let match = email
    ? records.find(([, r]) => typeof r.email === 'string' && r.email.toLowerCase() === email.toLowerCase())
    : undefined;
  if (!match && !email) {
    const active = String(root?.activeAccountNumber ?? '');
    match = records.find(([num]) => num === active);
  }
  const alias = match ? match[1].alias : null;
  return typeof alias === 'string' ? sanitizeValue(alias) || null : null;
}

function readSwapAlias(email: string | null): string | null {
  for (const file of getSwapSequencePaths(getHomeDir())) {
    try {
      const alias = deriveSwapAlias(JSON.parse(fs.readFileSync(file, 'utf8')), email);
      if (alias) return alias;
    } catch {
      // Not installed here, or unreadable: try the next location.
    }
  }
  return null;
}

/** readAuthInfo plus the claude-swap alias of the active account. */
export function readAuthInfoWithAlias(): AuthInfo {
  const info = readAuthInfo();
  if (info.method === 'API Key') return info;
  return { ...info, alias: readSwapAlias(info.email ?? null) };
}

export function truncateUser(user: string, maxLength: number): string {
  if (maxLength <= 0 || user.length <= maxLength) {
    return user;
  }
  return `${user.slice(0, maxLength)}…`;
}

/**
 * Builds the standalone auth segment for the end of the first HUD line,
 * honoring the showAuth / showAuthUser / authUserLength display settings.
 * Returns e.g. "Claude Max 20x · yukinosh…", or null when nothing to show.
 */
export function formatAuthSegment(
  info: AuthInfo | null | undefined,
  display: { showAuth?: boolean; showAuthUser?: boolean; authUserLength?: number; showAccountAlias?: boolean } | undefined,
): string | null {
  if (!info) {
    return null;
  }

  const parts: string[] = [];
  if (display?.showAccountAlias && info.alias) {
    parts.push(info.alias);
  }
  if (display?.showAuth && info.method) {
    parts.push(info.method);
  }
  if (display?.showAuthUser && info.user) {
    parts.push(truncateUser(info.user, display?.authUserLength ?? 8));
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}
