# Unilog problems — triage of temp.md against current code

Read `temp.md` and cross-checked every complaint against the **current** code. The
key finding: the agent's most-criticized complaint (#7) was actually **correct** —
so this may indeed be partly an instructions problem.

## The crux: complaint #7 / D is a real bug, today

The deploy script only reconciles `srvr` and `client`:

```bash
# srvr line ~204
if [[ "$project" == "srvr" || "$project" == "client" ]]; then
  node "$ROOT_DIR/unilog/run-reconcile.js" "$project"
fi
```

So stubs added to `tv`, `down`, `api`, or `asr` **never activate on their own
deploy** — exactly what the agent concluded. When you told it "reconciliation runs
automatically, don't touch it," that was true for `srvr`/`client` but **not** for
the project it was actually working in (`apps/tv/src/main.js`). The agent then
"fixed" the deploy script, you reverted it, but the underlying gap is genuinely
there. `run-reconcile.js` already supports every project (`PROJECT_DIRS` + `all`) —
the deploy script just doesn't call it for them.

## Triage of the 10 complaints

**Real tooling gaps (still true now):**

- **#7/D** — deploy reconciles only srvr/client (verified above).
- **#2/3** — hand-picked ids can ship with duplicates. _Partly_ fixed: cross-project
  dedup was just added, but it only runs for projects the deploy actually
  reconciles — so tv/down/api/asr still ship dupes silently.
- **#6** — no lint-safe "log goes here" placeholder; `void e;` / empty-catch fights
  ESLint.
- **#9/F** — no `node unilog/check <project>` to validate stubs/dupes without
  deploying.

**Instruction/doc problems (the "telling it wrong" hunch):**

- **#1/4/5/8/G** — the agent imitated `unilog(42, …)` and read internals because
  nothing it was editing said "you never write these; hand off to the unilog
  agent." The `copilot-instructions.md` Unilog section + the unilog agent file now
  state this, but the active-call form still visually invites imitation.
- The agent doc line _"deploy the file (e.g. `./srvr srvr`) so the reconciler
  activates them"_ is misleading for non-srvr/client projects.

**Design suggestions (bigger changes):**

- **A/B** — change stub grammar so it doesn't contain `unilog(`, and never expose
  ids to authors.
- **C** — a sanctioned `logHere(...)` placeholder.
- **E** — an ESLint rule flagging `console.log` / hand-written `unilog(<number>,`.

## Recommendation (highest leverage, lowest risk first)

1. **Make the deploy reconcile every project it deploys** (3-line change to `srvr`),
   so the "it's automatic" model becomes _true_ everywhere. Also extends the new
   dedup protection to all projects.
2. **Add `node unilog/check <project>`** (no deploy) reporting unparseable stubs +
   duplicate ids.
3. **Fix the misleading doc lines** in the unilog agent file.

Items A/B/C/E are real improvements but are larger design changes worth sign-off
before touching the stub grammar / adding repo-wide ESLint rules.

## Open questions for you

- Do 1–3 now?
- Tackle the stub-grammar/ESLint redesign (A/B/C/E), or leave for a separate pass?
