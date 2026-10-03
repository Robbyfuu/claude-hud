---
description: Configure claude-hud as your statusline
allowed-tools: Bash, Read, Edit, AskUserQuestion
---

**Note**: Placeholders like `{RUNTIME_PATH}`, `{SOURCE}`, and `{GENERATED_COMMAND}` should be substituted with actual detected values.

**Platform gate**: If the environment `Platform:` is `win32`, stop setup now and tell the user that Windows is not supported natively. They should run Claude Code inside WSL (Windows Subsystem for Linux) and follow the Linux instructions. Do not run any command below on native Windows.

## Step 0: Detect Ghost Installation (Run First)

Check for inconsistent plugin state that can occur after failed installations:

**macOS/Linux**:
```bash
# Check 1: Cache exists?
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
CACHE_EXISTS=$(ls -d "$CLAUDE_DIR/plugins/cache"/*/claude-hud 2>/dev/null && echo "YES" || echo "NO")

# Check 2: Registry entry exists?
REGISTRY_EXISTS=$(grep -q "claude-hud" "$CLAUDE_DIR/plugins/installed_plugins.json" 2>/dev/null && echo "YES" || echo "NO")

# Check 3: Temp files left behind?
TEMP_FILES=$(ls -d "$CLAUDE_DIR/plugins/cache/temp_local_"* 2>/dev/null | head -1)

echo "Cache: $CACHE_EXISTS | Registry: $REGISTRY_EXISTS | Temp: ${TEMP_FILES:-none}"
```

### Interpreting Results

| Cache | Registry | Meaning | Action |
|-------|----------|---------|--------|
| YES | YES | Normal install (may still be broken) | Continue to Step 1 |
| YES | NO | Ghost install - cache orphaned | Clean up cache |
| NO | YES | Ghost install - registry stale | Clean up registry |
| NO | NO | Not installed | Continue to Step 1 |

If **temp files exist**, a previous install was interrupted. Clean them up.

### Cleanup Commands

If ghost installation detected, ask user if they want to reset. If yes:

**macOS/Linux**:
```bash
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"

# Remove orphaned cache (handles both direct and marketplace installs)
rm -rf "$CLAUDE_DIR/plugins/cache"/*/claude-hud

# Remove temp files from failed installs
rm -rf "$CLAUDE_DIR/plugins/cache/temp_local_"*

# Reset registry (removes ALL plugins - warn user first!)
# Only run if user confirms they have no other plugins they want to keep:
echo '{"version": 2, "plugins": {}}' > "$CLAUDE_DIR/plugins/installed_plugins.json"
```

After cleanup, tell user to run `/plugin install claude-hud` again followed by `/reload-plugins` — no restart needed. (Restart Claude Code only if the reinstall still misbehaves; the fresh session re-reads the plugin registry from scratch.)

### Linux: Cross-Device Filesystem Check

**On Linux only**, if install fails with `EXDEV: cross-device link not permitted`, check whether `/tmp` and home are on different filesystems:
```bash
[ "$(df --output=source ~ /tmp 2>/dev/null | tail -2 | uniq | wc -l)" = "2" ] && echo "CROSS_DEVICE"
```

The underlying Claude Code bug ([#14799](https://github.com/anthropics/claude-code/issues/14799)) has been fixed, so this mostly affects older Claude Code versions — suggest updating Claude Code first. If updating isn't an option and the check outputs `CROSS_DEVICE`, the workaround is:
```bash
mkdir -p ~/.cache/tmp && TMPDIR=~/.cache/tmp claude /plugin install claude-hud
```

---

## Step 1: Detect Platform and Runtime

**IMPORTANT**: Use the environment context value `Platform:` as your starting point. claude-hud runs on Bun and supports macOS and Linux only.

**Windows is not supported** (see the platform gate at the top). Run Claude Code inside WSL, install the plugin there, and follow the Linux instructions below. Do not generate a Windows-native command.

| Platform | Command Format |
|----------|----------------|
| `darwin` | bash (macOS instructions) |
| `linux` | bash (Linux instructions) |
| `win32` | not supported — use WSL and follow the Linux instructions |

---

**macOS/Linux** (Platform: `darwin` or `linux`):

1. Get plugin path (sorted by dotted numeric version, not modification time):
   ```bash
   ls -d "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/claude-hud/*/ 2>/dev/null | awk -F/ '{ print $(NF-1) "\t" $(0) }' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+[[:space:]]' | sort -t. -k1,1n -k2,2n -k3,3n -k4,4n | tail -1 | cut -f2-
   ```
   If empty, the plugin is not installed. Go back to Step 0 to check for ghost installation or EXDEV issues. If Step 0 was clean, ask the user to install via `/plugin install claude-hud` first.

2. Get runtime absolute path:
   ```bash
   command -v bun 2>/dev/null
   ```

   If empty, stop setup and explain that the current shell cannot find Bun, which claude-hud requires. Ask the user to install it:
   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```
   After installation, ask the user to restart their shell and re-run `/claude-hud:setup`.

3. Verify the runtime exists:
   ```bash
   ls -la {RUNTIME_PATH}
   ```
   If it doesn't exist, re-detect or ask user to verify their installation.

4. Source file: always `src/index.ts` (Bun runs the TypeScript source directly; there is no `dist/`).

5. Generate command (quotes around runtime path handle spaces):

   The command exports `COLUMNS` so the HUD knows the real terminal width.
   Claude Code pipes the subprocess stdout, so `process.stdout.columns` is
   unavailable at runtime. Since Claude Code v2.1.153, `COLUMNS` and `LINES`
   are set natively to the current terminal dimensions before the statusLine
   command runs, so the inherited `COLUMNS` value is the primary source. The
   `stty size </dev/tty` probe and the 120 fallback remain for older Claude
   Code versions where `COLUMNS` may be absent. The `- 4` accounts for Claude
   Code's input area padding (2 columns on each side).

   The grep pattern uses `[[:space:]]` rather than `\t` to match the tab
   separator emitted by awk. GNU grep (BRE/ERE) does **not** interpret
   `\t` as a tab character — it emits `warning: stray \ before t` and
   treats the pattern as literal `t`. With `\t` the regex would never match
   the awk output, `plugin_dir` would resolve to an empty string, and the
   command would exit without output, so no HUD would appear.
   Setup verification can hide this because some shells alias `grep` to
   alternatives (e.g. `ugrep`) that *do* expand `\t`, while the actual
   `statusLine` subprocess invokes `/usr/bin/grep`. `[[:space:]]` is a
   POSIX character class supported by both BSD grep (macOS default) and
   GNU grep (Linux default).

   Add `--config=/dev/null` and `--env-file /dev/null` so Bun ignores the current project's `bunfig.toml` (a `preload` there would print into the statusline) and its `.env` files:
   ```
   bash -c 'cols=${COLUMNS:-}; case "$cols" in ""|*[!0-9]*) cols=$(stty size 2>/dev/null </dev/tty | awk '"'"'{print $2}'"'"');; esac; case "$cols" in ""|*[!0-9]*) cols=120;; esac; export COLUMNS=$(( cols > 4 ? cols - 4 : 1 )); plugin_dir=$(ls -d "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/claude-hud/*/ 2>/dev/null | awk -F/ '"'"'{ print $(NF-1) "\t" $(0) }'"'"' | grep -E '"'"'^[0-9]+\.[0-9]+\.[0-9]+[[:space:]]'"'"' | sort -t. -k1,1n -k2,2n -k3,3n -k4,4n | tail -1 | cut -f2-); [ -n "$plugin_dir" ] || exit 0; exec "{RUNTIME_PATH}" --config=/dev/null --env-file /dev/null "${plugin_dir}{SOURCE}"'
   ```

**WSL (Windows Subsystem for Linux)**: Windows users must run Claude Code inside WSL and use the macOS/Linux instructions above. Ensure the plugin is installed in the Linux environment (`${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/...`), not the Windows side.

## Step 2: Test Command

Run the generated command. It should produce output (the HUD lines) within a few seconds.

- If it errors, do not proceed to Step 3.
- If it hangs for more than a few seconds, cancel and debug.
- This test catches issues like broken runtime binaries, missing plugins, or path problems.

## Step 2.5: Detect Existing Statusline and Create Backup

Before writing to `settings.json`, check whether a `statusLine` key already exists and protect the user's current configuration. This covers the existing-statusLine overwrite issue tracked in [#547](https://github.com/jarrodwatts/claude-hud/issues/547).

### 2.5.1: Read the existing statusLine

**macOS/Linux**:
```bash
SETTINGS="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"
EXISTING_COMMAND=""
EXISTING_COMMAND_PREVIEW=""

if [ -f "$SETTINGS" ]; then
  EXISTING_COMMAND=$("{RUNTIME_PATH}" --config=/dev/null -e '
const fs = require("fs");
const settingsPath = process.argv[1];

try {
  const text = fs.readFileSync(settingsPath, "utf8");
  if (text.trim() === "") process.exit(0);

  const json = JSON.parse(text);
  const command = json && json.statusLine && typeof json.statusLine.command === "string"
    ? json.statusLine.command
    : "";
  process.stdout.write(command);
} catch (error) {
  console.error("Unable to read statusLine.command from settings.json: " + error.message);
  process.exit(1);
}
' "$SETTINGS") || exit 1

  EXISTING_COMMAND_PREVIEW=$(printf '%s' "$EXISTING_COMMAND" | "{RUNTIME_PATH}" --config=/dev/null -e '
let value = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => { value += chunk; });
process.stdin.on("end", () => {
  const redacted = value
    .replace(/\b(Bearer)\s+["\x27]?[^"\x27\s]+/gi, "$1 [REDACTED]")
    .replace(/\b(Authorization\s*:\s*)["\x27]?[^"\x27\s]+/gi, "$1[REDACTED]")
    .replace(/\b(token|api[_-]?key|secret|password|pass|auth)(=|:)\s*["\x27]?[^"\x27\s]+/gi, "$1$2[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-[REDACTED]")
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{8,}\b/g, "[GITHUB_TOKEN_REDACTED]")
    .replace(/\s+/g, " ")
    .trim();

  process.stdout.write(redacted.length > 160 ? redacted.slice(0, 157) + "..." : redacted);
});
')
fi
```

### 2.5.2: Classify the existing statusline

If `EXISTING_COMMAND` is non-empty, classify it:

| Pattern in command | Classification | Source label |
|---|---|---|
| Contains `claude-hud` | **Reinstall** (own config) | `claude-hud` |
| Contains `claude-pace` | **Known project** | `claude-pace` |
| Contains `cc-statusline` or `ccstatusline` | **Known project** | `cc-statusline` |
| Contains `statusline.sh` or `statusline.js` or `statusline.py` | **Likely another statusline** | `statusline script` |
| Any other non-empty value | **Custom script** | `custom` |
| Empty / missing key | **Clean install** | (none) |

### 2.5.3: Create a timestamped backup

**Always** create a backup of `settings.json` before modifying it, regardless of whether a statusline exists. This protects against corruption (see [#315]) and gives users a recovery path.

**macOS/Linux**:
```bash
SETTINGS="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"
BACKUP_TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_PATH=""
if [ -f "$SETTINGS" ]; then
  BACKUP_PATH="${SETTINGS}.bak.${BACKUP_TIMESTAMP}"
  if cp "$SETTINGS" "$BACKUP_PATH"; then
    echo "Backup created: $BACKUP_PATH"
  else
    echo "Failed to create backup at: $BACKUP_PATH" >&2
    exit 1
  fi
fi
```

### 2.5.4: Prompt the user if a statusline exists

**If the statusline is empty (clean install)**: Skip this step. Proceed directly to Step 3.

**If the statusline is claude-hud (reinstall)**: Skip this step. The new command replaces the old one — this is an idempotent update. Proceed to Step 3.

**If the statusline belongs to a known project or is a custom script**: Use AskUserQuestion to ask the user what to do.

Use AskUserQuestion:
- header: "Existing statusline detected"
- question: "Found an existing statusLine in settings.json:\n\n  command preview: {REDACTED_COMMAND_PREVIEW}\n  source: {SOURCE_LABEL}\n\nWhat would you like to do?"
- options:
  - "Replace it with claude-hud (your current setup will be backed up)"
  - "Keep my current statusline and exit setup (settings stay unchanged)"
  - "Cancel setup without changing settings"

Set `{REDACTED_COMMAND_PREVIEW}` to `EXISTING_COMMAND_PREVIEW`. Use only the redacted/truncated preview in the prompt and normal output. Do not print the full previous command because it may contain tokens or secrets.

**If the user chooses "Keep" or "Cancel"**: Stop setup. The backup from 2.5.3 is still available if one was created. Tell the user:

> No changes were made to your settings. Your existing statusline is preserved. Setup created no settings mutation apart from the backup file at `{BACKUP_PATH}` if that value is set.

**If the user chooses "Replace"**: Proceed to Step 3. The backup from 2.5.3 ensures the previous configuration can be restored.

### 2.5.5: Save the previous command for potential restoration

Store the previous `statusLine.command` value in a file alongside the settings backup. This makes it easy to restore if the user later wants to switch back.

**macOS/Linux**:
```bash
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
if [ -n "$EXISTING_COMMAND" ]; then
  PREVIOUS_COMMAND_DIR="$CLAUDE_DIR/plugins/claude-hud"
  PREVIOUS_COMMAND_PATH="$PREVIOUS_COMMAND_DIR/previous-statusline.txt"
  mkdir -p "$PREVIOUS_COMMAND_DIR"
  chmod 700 "$PREVIOUS_COMMAND_DIR" 2>/dev/null || true
  if (
    umask 077
    printf '%s' "$EXISTING_COMMAND" > "$PREVIOUS_COMMAND_PATH"
  ); then
    chmod 600 "$PREVIOUS_COMMAND_PATH" 2>/dev/null || true
    echo "Previous statusline command saved to: $PREVIOUS_COMMAND_PATH"
  else
    echo "Failed to save previous statusline command to: $PREVIOUS_COMMAND_PATH" >&2
    exit 1
  fi
fi
```

---

## Step 3: Apply Configuration

Read the settings file and merge in the statusLine config, preserving all existing settings:
- `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json`

If the file doesn't exist, create it. If it contains invalid JSON, report the error and do not overwrite.
If a write fails with `File has been unexpectedly modified`, re-read the file and retry the merge once.

**A timestamped backup was already created in Step 2.5.3.** If Step 2.5.4 prompted the user and they chose "Keep" or "Cancel", do not reach this step — setup has already exited.

```json
{
  "statusLine": {
    "type": "command",
    "command": "{GENERATED_COMMAND}"
  }
}
```

**JSON safety**: Write `settings.json` with a real JSON serializer or editor API, not manual string concatenation.
If you must inspect the saved JSON manually, the embedded bash command must preserve escaped backslashes inside the awk fragment.
For example, the saved JSON should contain `\\$(NF-1)` and `\\$0`, not `\$(NF-1)` and `\$0`.

After successfully writing the config, tell the user:

> ✅ Config written. Claude Code reloads settings automatically — the HUD should appear below your input field after your next message in this session (no restart needed).
> If it doesn't show up after your next interaction, restart Claude Code (quit and run `claude` again) — older Claude Code versions require a restart to pick up statusLine changes.

Then continue directly to Step 4 in the same session.

**Note**: The generated command dynamically finds and runs the latest installed plugin version. Updates are automatic - no need to re-run setup after plugin updates. If the HUD suddenly stops working, re-run `/claude-hud:setup` to verify the plugin is still installed.

**Restoring a previous statusline**: If the user previously had a different statusline and wants to restore it, use the backup path printed in Step 2.5.3. The previous command is stored in `~/.claude/plugins/claude-hud/previous-statusline.txt`. To restore:
1. Find the most recent backup: `ls -t ~/.claude/settings.json.bak.* | head -1`
2. Copy it back: `cp ~/.claude/settings.json.bak.{timestamp} ~/.claude/settings.json`
3. The restored config applies automatically on the next interaction (restart Claude Code only if it doesn't).

## Step 4: Optional Features

After the statusLine is applied, ask the user if they'd like to enable additional HUD features beyond the default 2-line display.

Use AskUserQuestion:
- header: "Extras"
- question: "Enable any optional HUD features? (all hidden by default)"
- multiSelect: true
- options:
  - "Tools activity" — Shows running/completed tools (◐ Edit: file.ts | ✓ Read ×3)
  - "Agents & Todos" — Shows subagent status and todo progress
  - "Session info" — Shows session duration and config counts (CLAUDE.md, rules, MCPs)
  - "Session name" — Shows session slug or custom title from /rename
  - "Custom line" — Display a custom phrase in the HUD

**If user selects any options**, write `plugins/claude-hud/config.json` inside the Claude config directory (`${CLAUDE_CONFIG_DIR:-$HOME/.claude}`). Create directories if needed:

| Selection | Config keys |
|-----------|------------|
| Tools activity | `display.showTools: true` |
| Agents & Todos | `display.showAgents: true, display.showTodos: true` |
| Session info | `display.showDuration: true, display.showConfigCounts: true` |
| Session name | `display.showSessionName: true` |
| Custom line | `display.customLine: "<user's text>"` — ask user for the text (max 80 chars) |

Merge with existing config if the file already exists. Only write keys the user selected — don't write `false` for unselected items (defaults handle that).

**If user selects nothing** (or picks "Other" and says skip/none), do not create a config file. The defaults are fine.

### Step 4.5: Auto-Refresh (Optional)

Claude Code only re-runs the statusline after an interaction (a new assistant message, `/compact` finishing, a permission-mode change, or a vim-mode toggle). Time-based HUD data — session duration, usage reset countdowns, the prompt-cache countdown — therefore goes stale between messages. Claude Code supports an optional `refreshInterval` key (seconds, minimum 1) on the `statusLine` settings object that re-runs the command every N seconds.

Of those, only the usage reset countdown is shown by default — session duration and the prompt-cache countdown tick only if the user enabled them (e.g. "Session info" in Step 4, or via config). Mention this if the user seems unsure whether the timer is worth it.

Ask with AskUserQuestion:
- header: "Auto-refresh"
- question: "Re-run the HUD on a timer so time-based info (session duration, usage countdowns) stays current between messages?"
- options:
  - "Every 5 seconds (Recommended)" — Keeps countdowns fresh with negligible overhead
  - "Every 1 second" — Smoothest ticking; re-runs the HUD command far more often
  - "No timer" — HUD updates only after interactions (Claude Code's default)

**If the user picks an interval**, merge `refreshInterval: <N>` into the **existing** `statusLine` object in `settings.json` — preserve `type`, `command`, and any other keys. Follow the same rules as Step 3: real JSON serializer, retry once on a concurrent-modification error. Do not re-create the backup; the Step 2.5.3 backup already covers this session.

**If the user picks "Other" and gives a numeric interval** (e.g. "10" or "10 seconds"), use that value, clamped to a minimum of 1. Treat a non-numeric "Other" answer that declines (skip/none/no) like "No timer".

**If the user picks "No timer"**, do not write the key. If a `refreshInterval` key already exists in `statusLine` from a previous run and the user explicitly chose "No timer", remove it.

`refreshInterval` lives in `settings.json`, which Claude Code reloads automatically — ticking should start after the user's next interaction. If countdowns don't tick in the current session, tell the user it will take effect after a Claude Code restart; do not treat a non-ticking timer as a setup failure in Step 5.

Each refresh re-runs the full HUD command (runtime startup, transcript parse, git status), so 5 seconds is the recommended default; only suggest 1 second when the user wants visibly smooth countdowns.

---

## Step 5: Verify & Finish

Settings reload automatically, so the HUD can appear in the same session where setup was run — it renders after the user's next interaction (their answer to the question below counts as one). No restart is needed on current Claude Code versions.

Use AskUserQuestion:
- Question: "Setup complete! The HUD should appear below your input field. Is it working?"
- Options: "Yes, it's working" / "No, something's wrong"

**If yes**: Ask the user if they'd like to ⭐ star the claude-hud repository on GitHub to support the project. If they agree and `gh` CLI is available, first check whether their `gh` version supports `gh repo star`. If it does, run `gh repo star jarrodwatts/claude-hud`. Otherwise fall back to `gh api -X PUT /user/starred/jarrodwatts/claude-hud`. Only run the star command if they explicitly say yes.

**If no**: Debug systematically:

1. **Trigger an interaction, then restart if needed**:
    - Settings reload automatically, but the HUD only renders after the next interaction (a new message, `/compact` finishing, a permission-mode change) — sending any message should make it appear
    - If it still doesn't appear, restart Claude Code (quit and run `claude` again) — older Claude Code versions require a restart to pick up statusLine changes — then re-run `/claude-hud:setup` to verify
    - If you've already restarted, continue below

2. **Verify config was applied**:
   - Read settings file (`${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json`)
   - Check statusLine.command exists and looks correct
   - If command contains a hardcoded version path (not using the dynamic version-lookup command), it may be a stale config from a previous setup

3. **Test the command manually** and capture error output:
   ```bash
   {GENERATED_COMMAND} 2>&1
   ```

4. **Common issues to check**:

   **"command not found" or empty output**:
   - Runtime path might be wrong: `ls -la {RUNTIME_PATH}`
   - On macOS with mise/nvm/asdf: the absolute path may have changed after a runtime update
   - Symlinks may be stale: `command -v bun` often returns a symlink that can break after version updates
   - Solution: re-detect the runtime path (`command -v bun`), and verify with `realpath {RUNTIME_PATH}` (or `readlink -f {RUNTIME_PATH}`) to get the true absolute path

   **"No such file or directory" for plugin**:
   - Plugin might not be installed: `ls "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/claude-hud/`
   - Solution: reinstall plugin via marketplace

   **Permission denied**:
   - Runtime not executable: `chmod +x {RUNTIME_PATH}`

   **WSL confusion**:
   - If using WSL, ensure plugin is installed in Linux environment, not Windows
   - Check: `ls "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/claude-hud/`

5. **If still stuck**: Show the user the exact command that was generated and the error, so they can report it or debug further
