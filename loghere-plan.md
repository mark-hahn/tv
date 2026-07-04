# logHere Param-Object Plan

## Summary of the change

The `logHere(...)` placeholder gains a structured first argument — a plain-object
param block — that carries `lvl`, `tag`, `grp`, and `typ`. Variadic message args
follow. This replaces the previous "optional level literal as first arg" convention.

New signature:

```js
logHere({ lvl, tag, grp, typ }, ...msgArgs);

// minimal — all defaults:
logHere({}, "message");

// level + tag:
logHere({ lvl: "warn", tag: "disk" }, "low space");

// level only, no tag:
logHere({ lvl: "error" }, `failed: ${e.message}`);

// single named group:
logHere({ grp: "playback" }, `started ${showId}`);

// multiple groups, with a type for new ones:
logHere({ grp: ["playback", "errors"], typ: "feature" }, `crash in ${fn}`);

// no message args → reconciler emits "<missing>":
logHere({});
```

All param-object properties must be **static string literals** (or an array of
string literals for `grp`). The reconciler reads them at deploy-time via AST; it
cannot evaluate expressions. Any property with a dynamic value is silently ignored
and the default is used instead.

---

## Files to change

### 1. `packages/share/src/unilog.js`

Update the comment block above `logHere` to document the new signature. The
function body stays `{}` (runtime no-op — the reconciler replaces the call).

### 2. `apps/client/src/log.js`

Same doc-comment update as above.

### 3. `unilog/parse.js` — detection logic

The `logHere` block in `findLogCalls` currently:

- reads the first arg as an optional level StringLiteral
- treats all remaining args as the message

New detection:

```
if first arg is ObjectExpression → new-style
  extract from properties:
    lvl  → level (default "info" if missing or not a valid level literal)
    tag  → tag   (default null)
    grp  → group names: StringLiteral → [name], ArrayExpression of StringLiterals → [name, ...]
    typ  → group type string (default null)
  msgArgs = n.arguments.slice(1)

else if first arg is StringLiteral with value in LEVELS → old-style (backward compat)
  level = a0.value
  msgArgs = n.arguments.slice(1)

else → old-style, level = "info", msgArgs = n.arguments
```

The hit record for new-style logHere gains two extra fields:

```js
{
  kind: "old",          // same kind — treated as an upgrade site
  level,
  tag,
  grpNames: string[],   // NEW — named groups from grp property
  grpTyp:  string|null, // NEW — group type for new groups
  argsText: [...],
  firstLiteral: bool,
  // ...existing fields
}
```

`argExpr` construction (in `reconcile.js` `buildArgs`): if `msgArgs` is empty,
use `'"<missing>"'` as argExpr. No `[tag]` stripping needed for new-style logHere
calls — tag comes directly from the param object.

### 4. `unilog/reconcile.js`

**`scanText` / `reconcileText`**

The `creates` array entries currently carry: `{ kind, level, tag, argExpr, srcLine }`.
Add two new fields:

```js
{
  (kind, level, tag, argExpr, srcLine, grpNames, grpTyp);
}
```

These flow from the parsed logHere hit through `astSites` → `upgrades` → `creates`.

**`buildArgs`** — no change needed for the new-style path because tag is already
extracted in parse.js. It continues to strip `[tag]` from the first literal for
all other old-style calls (backward compat).

**`reconcileFilesWithDb`**

The `createSiteFn` receives a `site` object. The site now includes `grpNames` and
`grpTyp`. The driver (`run-reconcile.js`) resolves group names to IDs before (or
during) the site-creation call. Two options:

- **Option A (preferred):** pass `grpNames` + `grpTyp` through to `createSiteFn`
  and have the driver do the lookup/create. The reconcile.js pure-core signature
  stays unchanged (it just passes extra fields through `creates`).
- **Option B:** resolve names to IDs inside `reconcileFilesWithDb` by adding a
  `findOrCreateGroupFn` callback. More testable, but more complex.

Suggestion: Option A. The driver already has all the DB-access helpers.

### 5. `unilog/run-reconcile.js`

**`createSiteFn(site)`** needs to handle `site.grpNames` and `site.grpTyp`:

1. If `site.grpNames` is non-empty, for each name:
   - call a new helper `ensureNamedGroup(name, typ)` that returns a group_id
   - the helper first tries to look up an existing group by description == name
   - if found, return its group_id (do NOT update its group_type)
   - if not found, create a new group with description=name, groupType=typ
2. Collect the named group ids plus the run's task group id into `allGroupIds`
3. Pass `allGroupIds` to the site-creation call (both HTTPS and ssh paths)

**`ensureNamedGroup(name, typ)`**:

- HTTPS path: new endpoint `POST /api/unilog/find-or-create-group`
  body: `{ description, groupType }` → response: `{ id, created: bool }`
  If the group already exists, server returns it without changing group_type.
- SSH path: `SELECT group_id FROM log_groups WHERE description = '<name>' LIMIT 1`
  If found → use it. If not → INSERT with typ and return new id.

### 6. `apps/srvr/src/unilogDb.js`

New export:

```js
// Find a group by description. Returns group_id or null.
export function findGroupByDescription(description) { ... }

// Find or create a group. Never changes group_type of existing groups.
// Returns { id, created }.
export const findOrCreateGroup = db.transaction(({ description, groupType }) => {
  const existing = findGroupByDescription(description);
  if (existing != null) return { id: existing, created: false };
  const id = createGroup({ groupType, description });
  return { id, created: true };
});
```

### 7. HTTPS endpoint in `apps/srvr/index.js` (or the unilog API routes file)

New route:

```
POST /api/unilog/find-or-create-group
body: { description: string, groupType?: string }
response: { id: number, created: boolean }
```

For pre-existing groups this is a read. For new groups this is a write. The
existing `/api/unilog/group` only creates; the new endpoint is find-or-create.

### 8. `.github/copilot-instructions.md`

Update the Unilog Debugging section:

- Replace the old `logHere` signature examples with new param-object form
- Show minimal call, level call, tag call, group call
- Retain the `[tag]` note for old-style (upgraded) log calls but clarify it does
  not apply to new-style logHere
- Update the description of what each property does

### 9. ~~`.github/agents/unilog.agent.md`~~ (deleted)

Update section (a) "A `logHere(...)` placeholder already in the source" to
document the new signature.

---

## Reconciliation flow (end to end with new features)

```
developer writes:
  logHere({ lvl: "warn", tag: "disk", grp: "health" }, `low space on ${drive}`);

parse.js extracts:
  level = "warn", tag = "disk", grpNames = ["health"], grpTyp = null
  argsText = [`\`low space on ${drive}\``]

reconcile.js creates site record:
  { kind:"upgrade", level:"warn", tag:"disk", argExpr:"`low space on ${drive}`",
    grpNames:["health"], grpTyp:null, srcLine:N }

run-reconcile.js createSiteFn:
  taskGid = ensureGroup()   // the deploy run's task group (already existing logic)
  healthGid = ensureNamedGroup("health", null)
    → tries HTTPS POST /api/unilog/find-or-create-group { description:"health" }
    → found (or created) → returns id
  POST /api/unilog/sites [{ ...site, groupIds: [taskGid, healthGid] }]
  → returns { ids: [412] }

reconcile.js rewrites:
  logHere({ lvl: "warn", tag: "disk", grp: "health" }, `low space on ${drive}`)
  →  unilog(412, `low space on ${drive}`)
```

---

## Ambiguities and questions

1. **`grp` lookup key**: `log_groups.description` has no UNIQUE constraint. If two
   groups share a name (description), `findGroupByDescription` would return the
   first one (by group_id). Suggestion: treat description as effectively unique for
   named groups. The schema could add a partial unique index, but that's a schema
   migration — out of scope here. Documenting the behavior is sufficient.

2. **`grp` with no `typ` on a pre-existing group**: the instruction says "for
   pre-existing groups do not change their group_type." The find-or-create logic
   handles this correctly: on lookup hit, ignore `typ`.

3. **Backward compatibility with old `logHere` calls**: currently no `logHere(...)`
   calls exist in source (all prior ones were reconciled to `unilog(...)` on
   deploy). The parse.js change should still handle the old "level as first string
   arg" form so old-style calls in un-deployed branches work. This is safe to add
   as a fallback branch.

4. **Static-only constraint**: `lvl`, `tag`, `grp`, `typ` must be string literals
   in the param object. A dynamic value like `{ lvl: someVar }` cannot be read at
   reconcile time. The parser will silently fall back to the default for any
   property that isn't a static literal. This is intentional and should be
   documented.

5. **Empty param object `{}`**: the instruction says the minimal call is
   `logHere({}, "message")`. The parser must accept an empty ObjectExpression and
   apply all defaults. This is the most common case for simple info logs.

6. **`grp` as a string vs array**: `grp` can be a single string `"name"` or an
   array `["name1", "name2"]`. Parse.js must handle both AST shapes:
   StringLiteral → `[value]`; ArrayExpression of StringLiterals → `[values]`.
   Array elements that are not StringLiterals are skipped.

7. **The `<missing>` sentinel for no-message calls**: `logHere({})` with no message
   args should produce `unilog(N, "<missing>")`. The reconciler emits the string
   literal `"<missing>"` as argExpr. A note: this is an unusual case; normally a
   log without a message is a bug.

8. **The deploy task group vs named groups**: each new site is always linked to
   both the run's task group (deploy provenance) AND any named groups from `grp`.
   Named groups do not replace the task group.

9. **`[tag]` stripping in messages**: for new-style logHere calls, `buildArgs`
   should NOT strip a `[tag]` from the first message literal, since tag is explicit
   in the param object. The stripping logic in `buildArgs` should be bypassed for
   new-style logHere hits. Clarification needed: should the tag-extraction from
   `[tag]` in message literals continue for other old-style call upgrades
   (console.log, log(), loge())? Current answer: yes, that path is unchanged.

---

## Suggestions

- Consider adding a `// unilog-stub` syntax extension for `grp`/`typ` in parallel
  (e.g. `{level=warn,tag=disk,grp=health}`). Not strictly required since
  `logHere` covers the same cases, but would make the two authoring paths
  symmetric.

- The `findGroupByDescription` function could be exposed as a CLI query to list
  group IDs by name — handy for the unilog agent when it wants to add a site to
  an existing group.

- For the SSH fallback in `ensureNamedGroup`, the lookup is a single `SELECT`.
  This is safe to run without stopping tv-srvr (reads only). Only the INSERT (new
  group) needs the srvr stopped. Current `ensureSrvrStopped()` is called before
  any write — that logic is already correct.
