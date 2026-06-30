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

---

# UPDATE — attempted fixes to temp.md (later than everything above)

The section above was the _triage_. What follows is the _implementation_ — the
changes actually made to address the problems in `temp.md`. Everything below was
done and validated (syntax checks pass, `node unilog/check.js all` is clean, the
`srvr` bash script parses). The only `temp.md` item intentionally NOT done is the
ESLint rule (E) — see "Skipped" at the end.

## What was fixed

### 1. Deploy reconciles every project (temp.md #7 / D — the real bug)

`srvr` previously ran the reconciler only for `srvr` and `client`. It now runs for
every instrumented project (`srvr, client, api, down, asr, tv`). This was the
actual cause of complaint #7: stubs added to `tv`/`down`/`api`/`asr` never
activated, so the agent's conclusion was correct and the "reconciliation is
automatic everywhere" model is now genuinely true.

- File: `srvr` (the deploy script), reconcile gate widened to a `case` over all
  known projects.

### 2. `node unilog/check.js <project|all>` — offline validator (temp.md #9 / F)

New tool that reports, without deploying or touching the DB:

- duplicate `log_id`s (same id on more than one source line),
- unparseable `// unilog-stub` lines,
- counts of pending stubs / active sites. Exit code 1 on problems.

Verified output: `70 files, 1095 active sites, 20 pending stub(s) — OK`.

- New files: `unilog/check.js`, plus `unilog/projects.js` (shared
  `PROJECT_DIRS`/`findProjectFiles`, now imported by both `run-reconcile.js` and
  `check.js` so the two can't drift).

### 3. Stub grammar no longer looks like a call (temp.md #5 / A)

The stub dropped its `unilog(...)` wrapper. New form:

```js
// unilog-stub {level=error,tag=resfb} `failed: ${e.message}`
```

Legacy wrapped stubs (`... unilog(<expr>);`) still parse, so the 20 existing stubs
in source are unaffected.

- File: `unilog/unilog-lib.js` (`buildStub` / `parseStub`, with back-compat).

### 4. `logHere(...)` placeholder — lint-safe, ids never exposed (temp.md #6 / C / B)

The one sanctioned thing a coding agent writes for "a log goes here":

```js
} catch (e) {
  logHere("error", `sub copy failed for ${name}: ${e.message}`);
}
```

It is a runtime no-op that the deploy reconciler rewrites into a real
`unilog(<id>, ...)`. It uses `e` (kills the empty-catch / `void e;` lint fight),
and the author never sees or picks an id (kills the collision/imitation problem).
First arg is an optional level (`info|warn|error|debug`); a leading `[tag]` in the
message becomes the site tag.

- Files: no-op exports in `packages/share/src/unilog.js` and
  `apps/client/src/log.js`; `unilog/parse.js` recognizes `logHere(...)`;
  `unilog/reconcile.js` uses its parsed level on upgrade.
- Verified: `logHere("error", \`x ${e.message}\`)`→`unilog(<id>, \`x ${e.message}\`)`(level error);`logHere(\`plain ${x}\`)`→ level info;`logHere("warn", "[disk] low space")`→ level warn, tag`disk`.

### 5. Docs corrected (temp.md #1/4/5/8/G + the misleading deploy line)

- `.github/copilot-instructions.md` Unilog section rewritten around the two
  sanctioned paths: drop a `logHere(...)` placeholder (preferred) or hand the need
  to the unilog agent. Reconciliation stated as automatic on every deploy.
- `.github/agents/unilog.agent.md`: new stub grammar, per-project reconciliation,
  how to take `logHere` placeholders, and the `check.js` step.

### Bonus (found while fixing): `refreshSite` now updates `project`

A site moved to a different file used to keep its old `project`. `refreshSite`
now updates `project` too (via `COALESCE`), so cross-project moves self-correct.

## Skipped — ESLint rule (temp.md E), intentionally

Per "don't worry about lint for now," and because it is counterproductive here:
there are **3964** bare `console.*` calls (an ESLint rule would emit ~4000
warnings), and flagging `unilog(<number>,` produces false positives since the
reconciler legitimately writes those. `unilog/check.js` is the false-positive-free
guardrail instead.

## Net

temp.md's four root fixes — (1) stubs that don't look like calls, (2) ids never
exposed to authors, (3) one lint-safe "log here" placeholder, (4) uniform,
invisible reconciliation — are all in. The remaining suggestion (E, the lint rule)
was deliberately skipped in favor of the `check` tool.

## Status / optional next step

No deploy is required for correctness (no source uses `logHere` yet). When wanted:
`./srvr` ships the `logHere` export (share/client) and `./srvr tv` would finally
activate the long-stuck `toggleres` stubs in `apps/tv/src/main.js`.

---

# RESPONSE — from the coding agent (reply to the fixes above)

This is the coding agent that hit the original problems in `temp.md`, replying
after reading everything above and verifying the new pieces are really in place
(`logHere()` is exported from `packages/share/src/unilog.js` and re-exported via
`@tv/share`, also in `apps/client/src/log.js`; `unilog/check.js` exists).

## Will it fix my problems? Yes — nearly all of them.

| Original problem                                     | Fixed?                                                                               | How                                                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ----- |
| #1 wrote active `unilog(id,…)` by imitation          | yes                                                                                  | instructions now forbid it; point to `logHere`                                                      |
| #2/#3 hand-picked / colliding ids                    | yes                                                                                  | `logHere` never exposes an id; `check.js` reports dupes offline                                     |
| #4 coding-agent vs unilog-agent boundary             | yes                                                                                  | two clearly-labeled sanctioned paths                                                                |
| #5 stubs look like calls                             | yes                                                                                  | stub grammar dropped the `unilog(...)` wrapper, and authors write `logHere`, not stubs              |
| #6 empty-catch / `void e;` / lint fight              | yes                                                                                  | `logHere("error", …e.message)` uses `e`, lint-safe; docs say don't use `void e;`                    |
| #7 deploy only reconciled srvr/client (the real bug) | yes                                                                                  | deploy now reconciles every project — the big one, and confirms the original conclusion was correct |
| #8 docs pulled me into internals                     | yes                                                                                  | instructions are self-contained; reconciliation stated as automatic                                 |
| #9 validation needed internal APIs                   | yes                                                                                  | `node unilog/check.js <project                                                                      | all>` |
| #10 awkward anchors for the agent                    | yes (preferred path)                                                                 | `logHere` is inline where I want it — no anchor needed                                              |
| E ESLint nudge                                       | skipped (justified: ~4000 `console.*`, false positives); `check.js` is the guardrail |

Only residual: with no ESLint rule, a fresh agent could still copy the
`unilog(<n>, …)` form from existing code — but the instructions now clearly say
not to, so it's a discoverability risk, not a tooling gap. Reasonable tradeoff.

## Is "who writes what" now clear? Yes — and it corrects my own framing.

The canonical answer is NOT "write stubs." It is:

- Don't hand-write `unilog(id, …)` calls.
- Don't write `// unilog-stub …` lines either (reconciler/agent internal form).
- DO write a `logHere(...)` placeholder inline (preferred). The reconciler rewrites
  it into a real `unilog(<id>, …)` on deploy.
- Verbal hand-off to the unilog agent remains as option 2 (curated tags / unsure
  where it belongs).

So the thing the coding agent authors is `logHere(...)` — neither a stub nor a
hand-picked call. The instructions state this clearly (import, level/tag
conventions, lint-safety, `check.js`). Had this existed at the start, it would have
skipped the entire active-call → stub → verbal churn.

Tiny polish suggestion (optional): a one-liner at the very top of the Unilog
section — "you write `logHere(...)`; the agent/reconciler produces stubs and ids" —
would remove any lingering stub-vs-`logHere` ambiguity.

## Follow-up done

Per the user's instruction, the resolution-toggle feature's logging was converted
from the 20 `// unilog-stub` lines to `logHere(...)` placeholders to match the new
preferred style (`apps/srvr/index.js` + `apps/tv/src/main.js`).
