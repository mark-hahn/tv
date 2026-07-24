# Disabling approval prompts in Claude Code (including as root)

Goal: run Claude Code with no permission/approval prompts.

Verified against Claude Code **2.1.218** (native binary) on Linux, 2026-07-23.

---

## Do you even need this?

Setting `permissions.defaultMode: "bypassPermissions"` is normally all you need. It only
gets refused — with this error — when you are running as **uid 0**:

```
--dangerously-skip-permissions cannot be used with root/sudo privileges for security reasons
```

The guard in the binary is:

```js
typeof process.getuid === "function"
  && process.getuid() === 0
  && process.env.IS_SANDBOX !== "1"
  && !env.CLAUDE_CODE_BUBBLEWRAP
```

All four terms must hold for it to refuse. That gives a simple decision table:

| Environment | Refused? | Needs `IS_SANDBOX`? |
|---|---|---|
| **Windows (native)** | No — `process.getuid` is undefined on Windows, so the first term is false | **No.** Just set `defaultMode`. Running as Administrator makes no difference. |
| **WSL as a normal user** (default for Ubuntu/Debian distros) | No — uid is not 0 | **No.** Just set `defaultMode`. |
| **WSL as root** (`id -u` → 0) | Yes | Yes |
| **Linux as root** | Yes | Yes |

Check which case you're in:

```bash
id -u        # 0 means root; anything else means you don't need the IS_SANDBOX part
```

Note the guard keys on the **root user**, not the `/root` directory. Working in `/root` as a
non-root user does not trigger it.

---

## The fix

Edit `settings.json` (locations below) and add these two keys:

```json
{
  "env": {
    "IS_SANDBOX": "1"
  },
  "permissions": {
    "defaultMode": "bypassPermissions"
  }
}
```

Merge them into your existing settings — don't overwrite the file. A complete example:

```json
{
  "model": "opus",
  "theme": "light",
  "env": {
    "IS_SANDBOX": "1"
  },
  "permissions": {
    "defaultMode": "bypassPermissions"
  }
}
```

Restart Claude Code (or the VSCode extension host) to pick it up.

**Both keys are required when running as root.** `defaultMode` alone is still refused — the
root guard is applied to the settings-derived mode, not just the `--dangerously-skip-permissions`
CLI flag. The `env` block is applied early enough in startup to clear the guard. If you are
*not* root, omit the `env` block entirely.

### Settings file locations

| Platform | Path |
|---|---|
| Linux / WSL / macOS | `~/.claude/settings.json` |
| Windows (native) | `%USERPROFILE%\.claude\settings.json` — e.g. `C:\Users\you\.claude\settings.json` |

**WSL and Windows do not share this file.** WSL has its own `~/.claude/` inside the distro's
filesystem. Configure each one separately.

---

## Verify it worked

Run a command that would normally prompt, with `IS_SANDBOX` explicitly cleared from the shell
so you're testing the settings file and not a leftover env var:

```bash
env -u IS_SANDBOX claude -p 'Run this bash command and nothing else: touch /tmp/bypasstest.txt' < /dev/null
ls -la /tmp/bypasstest.txt && rm /tmp/bypasstest.txt
```

If the file exists, no approval was requested. On Windows PowerShell:

```powershell
claude -p 'Run this bash command and nothing else: New-Item -Path $env:TEMP\bypasstest.txt -ItemType File'
```

---

## Alternative: per-invocation instead of global

If you'd rather not make bypass the default for every session, skip the settings change and
set the env var only when you launch:

```bash
# Linux / WSL as root
IS_SANDBOX=1 claude --dangerously-skip-permissions
```

Or add a shell alias in `~/.bashrc` / `~/.zshrc`:

```bash
alias yolo='IS_SANDBOX=1 claude --dangerously-skip-permissions'
```

A shell alias only affects terminal launches — it will **not** apply to the VSCode extension
or desktop app, which don't run your shell's rc files. Use the settings-file method for those.

---

## VSCode extension: a separate, higher-priority override

Everything above governs the native `claude` binary's own settings resolution. The **VSCode
extension launches that binary itself**, and it does so with an explicit CLI flag:

```
claude ... --permission-mode default ...
```

A CLI flag beats `permissions.defaultMode` in any settings.json — user, project, or local. So
even with `~/.claude/settings.json` fully configured per above, the extension can still silently
force prompts back on. This is not the root guard; `IS_SANDBOX` has nothing to do with it.

Confirm this is what's happening by checking the running process's argv:

```bash
ps -eo pid,args | grep '/claude ' | grep -v grep
```

If you see `--permission-mode default`, the extension is overriding you. The flag's value comes
from two VSCode settings that live in **VSCode's own settings.json, not Claude's**:

```json
{
  "claudeCode.allowDangerouslySkipPermissions": true,
  "claudeCode.initialPermissionMode": "bypassPermissions"
}
```

`allowDangerouslySkipPermissions` must be `true` or bypass is unavailable regardless of the mode
value. These can also carry the env var, sparing you the settings.json `env` block on this path:

```json
{
  "claudeCode.environmentVariables": [
    { "name": "IS_SANDBOX", "value": "1" }
  ]
}
```

### Where to put it

VSCode settings resolve per-scope like Claude's do — Machine (all WSL/remote projects) vs.
Workspace (this folder only). For WSL, the file that applies machine-wide is:

```
~/.vscode-server/data/Machine/settings.json
```

(There is no `%USERPROFILE%` equivalent to check for native Windows VSCode — that installation
uses the regular User/Workspace settings UI or `settings.json` under
`%APPDATA%\Code\User\`.)

**`initialPermissionMode` only applies to new conversations.** A resumed/already-open
conversation keeps whatever mode it started with — reloading the window is not enough; start a
fresh conversation to see the effect.

### These settings do not reliably stay set

Observed in practice: these two keys reverted to `false` / `"default"` on their own (most likely
an extension update or a Settings Sync pull from the Windows side overwriting the WSL-side file).
`~/.claude/settings.json` was untouched and still correct — only the VSCode-side keys drifted.
If prompts resume after previously being fixed, re-check this file before re-diagnosing the root
guard from scratch; the `ps` argv check above tells you which layer regressed in about five
seconds.

---

## Notes and caveats

- **This is not a patch.** `IS_SANDBOX` is a branch Anthropic put in the guard deliberately so
  containerized and CI users running as root can opt out. The binary is unmodified, so this
  survives auto-updates. A patched binary would be overwritten by the next version bump.

- **What `IS_SANDBOX=1` actually asserts** is "this process is already contained," not merely
  "skip prompts." Claude Code reads it in three places: the root guard above, the sandbox
  enablement path, and a 529-retry branch. On a default install this changes nothing else —
  `sandbox.enabled` defaults to `false` and `bwrap` is typically not installed. It would only
  matter if you later install bubblewrap and set `sandbox.enabled: true`, at which point this
  env var would silently suppress that sandboxing. Latent, not current.

- **Understand what you're turning off.** With `bypassPermissions`, Claude executes file writes
  and shell commands with no confirmation, at whatever privilege the process has — as root,
  that's unrestricted. Appropriate for disposable VMs, containers, and test servers. Think
  twice on a machine holding anything you care about.

- **If it still refuses** after applying this, check for an org policy overriding you:
  ```
  /etc/claude-code/managed-settings.json          # Linux / WSL
  C:\ProgramData\ClaudeCode\managed-settings.json # Windows
  ```
  A `permissions.disableBypassPermissionsMode: "disable"` key there blocks bypass mode
  regardless of your user settings, and produces a different message: *"Bypass permissions mode
  was disabled by settings"* (or *"...by your organization policy"*). That one is not
  something to work around locally.
