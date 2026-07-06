# Plan: Add "Editor" Action to Log Pane

## Goal

Add an "Editor" action to the log pane's actions dropdown that opens the selected log event's source file in VS Code at the specific line where the log call exists.

## Overview

The log pane already has actions like "Hide Sites", "Unhide Sites", "Delete" that use Vite dev server endpoints. We'll follow the same pattern to add an "Editor" action that communicates with VS Code.

## Components to Modify

### 1. Client Side (`apps/client/src/components/log.vue`)

#### A. Add "Editor" option to actions dropdown

- Location: Line ~127 in the `<select>` element with `v-model="actionSel"`
- Add new option after existing actions:
  ```html
  <option value="editor">Editor</option>
  ```

#### B. Handle the "editor" action in `onAction()` method

- Location: Line ~800 in the `onAction()` async method
- Add new handler after existing action handlers:
  ```javascript
  else if (act === "editor") await this.openInEditor();
  ```

#### C. Implement `openInEditor()` method

- Location: Add new method in the `methods` section (around line 900)
- Logic:
  ```javascript
  async openInEditor() {
    // Get selected events (not sites - we need src_line from the event)
    const selected = this.table
      .getRows()
      .filter((r) => this.selectedIds.has(r.getData().id))
      .map((r) => r.getData());

    // Validate: exactly one event selected
    if (selected.length === 0) {
      this.flash("No event selected");
      return;
    }
    if (selected.length > 1) {
      this.flash("Only one event should be selected");
      return;
    }

    const event = selected[0];
    const { src_file, src_line, log_id } = event;

    // Validate: must have file and line
    if (!src_file || src_line == null) {
      this.flash("Event missing source location");
      return;
    }

    // Call Vite endpoint
    try {
      const res = await fetch("/__unilog/open-editor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          file: src_file,
          line: src_line,
          logId: log_id
        }),
      });
      const data = await res.json();
      if (data.ok) {
        this.flash(`Opened ${src_file}:${src_line}`);
      } else {
        this.flash(`Failed: ${data.error}`);
      }
    } catch (err) {
      this.flash(`Failed: ${err?.message || err}`);
    }
  }
  ```

### 2. Vite Dev Server (`apps/client/vite.config.js`)

#### A. Extend `unilogHideEndpoint()` plugin

- Location: Line ~47 in the `configureServer()` method
- Current code handles `/hide`, `/unhide`, `/delete` modes
- Add new mode check:
  ```javascript
  const mode = url.startsWith("/hide")
    ? "hide"
    : url.startsWith("/unhide")
      ? "unhide"
      : url.startsWith("/delete")
        ? "delete"
        : url.startsWith("/open-editor")
          ? "open-editor"
          : null;
  ```

#### B. Handle "open-editor" mode

- After mode detection, add separate handler for open-editor:
  ```javascript
  if (mode === "open-editor" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const { file, line } = body;

      if (!file || line == null) {
        res.statusCode = 400;
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            ok: false,
            error: "Missing file or line",
          }),
        );
        return;
      }

      // Build absolute path
      const { spawn } = await import("node:child_process");
      const filePath = `/root/apps/tv/${file}`;

      // Use VS Code CLI: code --goto file:line
      const proc = spawn("code", ["--goto", `${filePath}:${line}`], {
        stdio: "ignore",
        detached: true,
      });

      proc.unref(); // Don't wait for VS Code to exit

      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          ok: false,
          error: String(err?.message || err),
        }),
      );
    }
    return;
  }
  ```

## Data Flow

1. User selects one event in the log table
2. User selects "Editor" from actions dropdown
3. `onAction()` is called, which calls `openInEditor()`
4. `openInEditor()` validates selection (exactly one event)
5. Extracts `src_file` and `src_line` from selected event
6. POSTs to `/__unilog/open-editor` with `{ file, line }`
7. Vite middleware receives request
8. Spawns `code --goto /root/apps/tv/{file}:{line}` command
9. VS Code opens the file at the specified line and selects it
10. Response sent back to client with success/failure
11. Client shows flash message

## Technical Details

### VS Code CLI

- The `code` command is available in the PATH when running in a VS Code terminal
- Syntax: `code --goto <file>:<line>[:<column>]`
- The `--goto` flag opens the file and jumps to the specified line
- By default, VS Code will also select/highlight the line
- Since we're in a remote SSH session, the `code` command automatically connects to the running VS Code instance

### Spawn Options

- Use `stdio: "ignore"` to avoid hanging on stdout/stderr
- Use `detached: true` and `unref()` to let the process run independently
- This allows the HTTP response to return immediately

### Error Handling

- Invalid selection (0 or >1 events): show toast, no server call
- Missing src_file/src_line: show toast, no server call
- Server error (spawn fails, etc.): show toast with error message
- Success: show toast confirming file:line opened

## Ambiguities & Questions

### 1. ✅ Multiple Events with Same Site

**Issue**: User can select multiple events that all reference the same log_site (same file:line).

**Resolution**: Instructions say "if there is more than one events selected", not "more than one site", so we enforce exactly one event selection regardless of whether multiple events share the same site.

### 2. ✅ VS Code Instance Detection

**Issue**: In a remote SSH workspace, there might be complexities with `code` command.

**Resolution**: The `code` command in an SSH session automatically communicates with the local VS Code instance via the Remote-SSH extension. No special handling needed.

### 3. ✅ File Path Format

**Issue**: The `src_file` field in events is workspace-relative (e.g., `apps/client/src/log.vue`).

**Resolution**: Prepend `/root/apps/tv/` to make it absolute. VS Code accepts absolute paths.

### 4. ⚠️ Dev-Only Restriction

**Issue**: Like "Hide" and "Delete" actions, "Editor" only makes sense in development with Vite running.

**Resolution**: Since the endpoint is on the Vite dev server, it's automatically dev-only. We could add a check like `if (!import.meta.env.DEV)` in the client, but it's optional since the endpoint won't exist in production anyway.

### 5. ✅ Column Selection

**Issue**: Should clicking happen when user selects the line column vs message column?

**Resolution**: The action is in the dropdown, not column-specific, so it works regardless of which cell was clicked. No ambiguity.

## Contradictions

**None identified.** The instructions are clear and align well with the existing architecture.

## Impossibilities

**None identified.** All requirements are technically feasible:

- ✅ Vite can spawn processes
- ✅ VS Code CLI is available in remote SSH environments
- ✅ Client can make fetch requests to Vite endpoints
- ✅ Event data includes all necessary fields (src_file, src_line)

## Suggestions

### 1. Keyboard Shortcut

Could add a keyboard shortcut (e.g., Ctrl+E or Enter) to open the selected event in editor without using the dropdown.

### 2. Double-Click to Open

Could make double-clicking an event row open it in the editor directly.

### 3. Open Site vs Event

Currently, the plan opens based on the selected event. We could alternatively have two actions:

- "Editor (Event)" - opens the file:line of the selected event
- "Editor (Site)" - uses `selectSites()` logic to get unique sites and open

But the instructions say to work with events, so the current plan is correct.

### 4. Alt+Click on File Column

Following the pattern of Alt+Click copying to clipboard, we could add Ctrl+Alt+Click on the File column to open in editor. But this might conflict with the existing Ctrl+Alt behavior (load into header filter).

### 5. Visual Feedback

When opening in editor, we could briefly highlight the row in a different color (like the pink flash for clipboard copy) to confirm the action.

## Testing Plan

1. Start Vite dev server: `cd apps/client && pnpm run dev`
2. Open client in browser
3. Navigate to log pane
4. **Test: No selection**
   - Don't select any events
   - Choose "Editor" from actions dropdown
   - Verify toast says "No event selected"
5. **Test: Multiple selections**
   - Select 2+ events (Ctrl+click)
   - Choose "Editor"
   - Verify toast says "Only one event should be selected"
6. **Test: Valid selection**
   - Select exactly one event
   - Choose "Editor"
   - Verify VS Code opens the correct file and jumps to the correct line
   - Verify the line is selected/highlighted
   - Verify toast says "Opened {file}:{line}"
7. **Test: Missing source info**
   - If any events exist with null src_file/src_line, select one
   - Choose "Editor"
   - Verify toast says "Event missing source location"

## Implementation Order

1. Add endpoint to vite.config.js (backend first for easier testing)
2. Test endpoint with curl:
   ```bash
   curl -X POST http://localhost:5173/__unilog/open-editor \
     -H "Content-Type: application/json" \
     -d '{"file":"apps/client/src/components/log.vue","line":100}'
   ```
3. Add dropdown option to log.vue
4. Implement openInEditor() method
5. Manual testing with browser
6. Verify line selection/highlighting works correctly

## File Changes Summary

- ✏️ `apps/client/vite.config.js` - Add open-editor endpoint handling
- ✏️ `apps/client/src/components/log.vue` - Add "Editor" action and handler

No new files needed. No extension or WSL script needed (VS Code CLI handles everything).
