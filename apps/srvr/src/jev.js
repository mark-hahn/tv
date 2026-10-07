// Questions for TypeSafe's jev model, or with the pane's LLM box ticked for
// Claude, from the client's jev pane.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  query,
  listSessions,
  deleteSession,
} from "@anthropic-ai/claude-agent-sdk";
import { logHere, unilog} from "@tv/share"
import { getAllTvdbSync } from "./tvdb.js";
import { SRVR_DATA_DIR } from "./srvrPaths.js";
import { setGlobalMessage } from "./messaging.js";
import { makeShowsTool } from "./jevTool.js";

const JEV_KEY_FILE = "/root/dev/apps/tv/jev-key.txt";
const JEV_KEY = (await readFile(JEV_KEY_FILE, "utf8")).trim();
const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const JEV_MODEL = "jev-latest";
// The API allows 80 requests a second; 40 at once ran 160 shows in 1 s.
const JEV_WORKERS = 40;
// A 429 or 529 is retried after 0.5 s, doubling each time.
const JEV_RETRIES = 8;
// TypeSafe's price for jev input; output is free.
const JEV_USD_PER_MTOK = 0.042;
// The most of a show's cast and crew it gets; the biggest have 182 and 103.
const JEV_CAST_MAX = 10;
const JEV_CREW_MAX = 5;
// Crew types first in a show's crew, as in the info pane's infobox.
const JEV_CREW_PREF = ["Creator", "Producer", "Executive Producer", "Writer"];
// Dollars spent on jev queries by LA date, {"2026-10-06": 0.0612}.
const JEV_COST_FILE = path.join(SRVR_DATA_DIR, "jev-cost.json");
const jevCost = JSON.parse(await readFile(JEV_COST_FILE, "utf8"));

// Adds a query's cost to today's total. Returns that cost and this month's
// total so far.
const addCost = async (inputTokens) => {
  const cost = (inputTokens * JEV_USD_PER_MTOK) / 1e6;
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Los_Angeles",
  });
  jevCost[today] = (jevCost[today] ?? 0) + cost;
  await writeFile(JEV_COST_FILE, JSON.stringify(jevCost, null, 2) + "\n");
  return { cost, monthCost: monthCost() };
};

// Jev's spending so far this LA month.
export const monthCost = () => {
  const month = new Date()
    .toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
    .slice(0, 7);
  let total = 0;
  for (const [date, c] of Object.entries(jevCost))
    if (date.startsWith(month)) total += c;
  return total;
};

// The request for one yes/no question about one state.
const request = (state, instructions) => ({
  model: JEV_MODEL,
  state,
  questions: { answer: { type: "noul", instructions } },
});

// A request's whole answer from the API.
const systemOne = async (request) => {
  const body = JSON.stringify(request);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(JEV_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${JEV_KEY}`,
        "Content-Type": "application/json",
      },
      body,
    });
    if ((res.status === 429 || res.status === 529) && attempt < JEV_RETRIES) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      continue;
    }
    if (!res.ok) throw new Error(`typesafe ${res.status}: ${await res.text()}`);
    return res.json();
  }
};

// The state jev gets for one show: everything the info pane's infobox shows,
// plus the rest of the record worth asking about. Empty fields are left out;
// unrelated detail costs jev accuracy.
const showState = (s) => {
  const crewPref = (c) => {
    const i = JEV_CREW_PREF.indexOf(c.type);
    return i < 0 ? JEV_CREW_PREF.length : i;
  };
  const crewNames = new Set();
  const crew = [...(s.crew ?? [])]
    .sort((a, b) => crewPref(a) - crewPref(b))
    .filter((c) => !crewNames.has(c.name) && crewNames.add(c.name))
    .slice(0, JEV_CREW_MAX)
    .map((c) => `${c.type}: ${c.name}`);
  const actors = [...(s.characters ?? [])]
    .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999))
    .slice(0, JEV_CAST_MAX)
    .map((c) => (c.character ? `${c.actor} as ${c.character}` : c.actor));
  const collections = [
    s.inToTry && "To Try",
    s.inContinue && "Continue",
    s.inMark && "Mark",
    s.inLinda && "Linda",
  ].filter(Boolean);
  const tv_show = {
    name: s.name,
    overview: s.overview,
    comment: s.comment,
    firstAired: s.firstAired,
    lastAired: s.lastAired,
    nextAired: s.nextAired,
    status: s.status,
    seasons: s.seasonCount,
    episodes: s.episodeCount,
    episodesWatched: s.watchedCount,
    lastWatched: s.lastPlayedDate?.slice(0, 10),
    lastWatchedEpisode: s.lastPlayedEpisode,
    averageEpisodeMinutes: s.averageRuntime,
    originalCountry: s.originalCountry,
    originalLanguage: s.originalLanguage,
    originalNetwork: s.originalNetwork?.name ?? s.originalNetwork,
    genres: s.genres,
    sitcom: s.sitcom,
    crew,
    // Not "cast": that is an SQL keyword, and these are a table's columns
    // for Claude's shows_sql tool.
    actors,
    imdbRating: parseFloat(s.imdbRatings) || null,
    imdbVotes: s.imdbReviewers,
    rottenTomatoesCriticsSlashAudience: s.rottenRatings,
    inLibrary: s.inLibrary !== false,
    collections,
    addedToLibrary: s.dateCreated?.slice(0, 10),
    videoQuality: s.quality ? `${s.quality}p` : null,
  };
  for (const [k, v] of Object.entries(tv_show))
    if (v == null || v === "" || (Array.isArray(v) && v.length === 0))
      delete tv_show[k];
  return { tv_show };
};

// Claude runs as a Claude Code session, through the Agent SDK's own copy of
// the CLI, so it bills the Max subscription on the login in
// ~/.claude/.credentials.json, as the finance app's server/src/agent.js does.
//
// Upgrading the SDK, when hdrmsg shows "Old Cli" (its bundled CLI is too old
// for LLM_MODEL): the SDK's version tracks its CLI's, 0.3.N carrying CLI
// 2.1.N. In apps/srvr run `pnpm add @anthropic-ai/claude-agent-sdk@latest`,
// keep zod on a version the SDK's package.json accepts (`npm view
// @anthropic-ai/claude-agent-sdk@latest dependencies peerDependencies`), then
// `./srvr srvr`. "Old Cli" clears on the next query that works.
const LLM_MODEL = "claude-opus-5-5";
const LLM_EFFORT = "high";
// Turns for a question with the shows_sql tool: each query is one.
const LLM_MAX_TURNS = 12;
// Red in hdrmsg: "Old Cli" when the SDK's bundled CLI is too old for
// LLM_MODEL, "$LLM" while the plan's limits are used up.
const LLM_MSG_POS = 2010;
const OLD_CLI_RE = /does not support this model/;
const LLM_SYSTEM =
  "You answer questions about a person's TV shows. A single show comes as " +
  "JSON in a <shows> block ahead of the question. For many shows you get " +
  "the sql tool over a table of them instead: look up only what the " +
  "question needs, and do sorting, counting and totals in SQL rather than " +
  "over rows you fetch. To judge what shows are about, read their overview. " +
  "When the user asks you to select, filter or pick out shows, also call the " +
  "select tool with them, which filters the user's show list to them. " +
  "Answer from the data, and from what you know of the shows where the data " +
  "says nothing. Be brief. Markdown is rendered.";
// Added for Auto, which gives Claude the jev tool too.
const LLM_SYSTEM_JEV =
  " For a question about what shows are about (their story, themes, " +
  "setting or tone), call the jev tool first instead of searching overviews " +
  "with SQL: it reads every show's full record. Its scores above about 0.8 " +
  "are reliable; check the ones below that with SQL and what you know, drop " +
  "the loose fits, and add shows you know belong that it missed.";
// The lowest Jev score the jev tool hands Claude.
const JEV_TOOL_MIN = 0.3;

// A stray ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN would quietly move the
// session to API billing.
const llmEnv = () => {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
};

// Calls fail once the plan's limits are used up, or bill usage credits if
// those are on. Only a rate_limit_event says so; each one sets or clears $LLM.
const noteLimits = (info) => {
  if (!info) return;
  if (info.isUsingOverage || info.status === "rejected")
    setGlobalMessage({
      id: "LlmLimits",
      text: "$LLM",
      color: "red",
      position: LLM_MSG_POS + 1,
    });
  else setGlobalMessage({ id: "LlmLimits", action: "hide" });
};

// One question to Claude. Show puts the one show's record in the prompt; In
// Lib and All Shows give Claude the shows_sql tool over a table of the shows,
// which keeps the prompt small however many there are. on() gets the request
// as {input}, then Claude's text as {text} pieces and each tool call as
// {tool, args}, while the question runs.
// A new conversation ends every older one: Resume only ever continues the
// latest, so their saved sessions are deleted. They are all tv-srvr's, kept
// for its working directory.
const dropOldSessions = async (keep) => {
  const dir = process.cwd();
  for (const s of await listSessions({ dir }))
    if (s.sessionId !== keep) await deleteSession(s.sessionId, { dir });
};

// resume is the session id of an earlier answer, for the pane's Resume: the
// question then continues that conversation.
const llmQuery = async (text, mode, shows, on, auto, resume) => {
  const sorted = [...shows].sort((a, b) => a.name.localeCompare(b.name));
  const states = sorted.map((s) => showState(s).tv_show);
  const many = mode === "In Lib" || mode === "All Shows";
  // What Auto's jev tool spent, in real money, recorded like any Jev query.
  let jevCost = 0;
  const jevScore = async (question) => {
    const { inputTokens, results } = await scoreShows(sorted, question);
    jevCost += (await addCost(inputTokens)).cost;
    return results.filter((r) => r.noul >= JEV_TOOL_MIN);
  };
  const showsTool = many
    ? makeShowsTool(states, auto ? { jevScore, jevMin: JEV_TOOL_MIN } : {})
    : null;
  const system = LLM_SYSTEM + (showsTool && auto ? LLM_SYSTEM_JEV : "");
  let prompt = text;
  if (mode === "Show")
    prompt = `<shows>\n${JSON.stringify(states)}\n</shows>\n\n${text}`;
  if (showsTool)
    prompt =
      `The sql tool's table holds ${states.length} shows: ` +
      `${mode === "In Lib" ? "the library" : "every show, in the library or not"}.` +
      `\n\n${text}`;
  const options = {
    model: LLM_MODEL,
    systemPrompt: system,
    // No built-in tools, settings or CLAUDE.md: they would add ~25K tokens.
    tools: [],
    settingSources: [],
    // Kept, so a later question can resume it. Claude Code saves it under
    // ~/.claude/projects for tv-srvr's working directory.
    persistSession: true,
    ...(resume && { resume }),
    maxTurns: 1,
    effort: LLM_EFFORT,
    env: llmEnv(),
    strictMcpConfig: true,
  };
  if (showsTool) {
    options.mcpServers = showsTool.mcpServers;
    options.allowedTools = showsTool.allowedTools;
    options.maxTurns = LLM_MAX_TURNS;
  }
  const input = {
    model: LLM_MODEL,
    effort: LLM_EFFORT,
    maxTurns: options.maxTurns,
    systemPrompt: system,
    ...(resume && { resume }),
    prompt: showsTool ? prompt : text,
    ...(mode === "Show" && { show: states[0] }),
    ...(showsTool && { sqlTable: showsTool.schema }),
  };
  on({ input });
  // Text as it is written, for the pane to show live.
  options.includePartialMessages = true;
  const session = query({ prompt, options });
  let result = null;
  let error = null;
  // Every tool Claude called, with its arguments, for the pane.
  const toolCalls = [];
  try {
    for await (const msg of session) {
      if (msg.type === "assistant") {
        // Login and billing failures arrive here rather than as a thrown error.
        if (msg.error) error = msg.error;
        for (const b of msg.message?.content ?? [])
          if (b.type === "tool_use") {
            const call = { tool: b.name.replace(/^mcp__\w+__/, ""), args: b.input };
            toolCalls.push(call);
            on(call);
          }
      } else if (
        msg.type === "stream_event" &&
        msg.event.type === "content_block_delta" &&
        msg.event.delta.type === "text_delta"
      )
        on({ text: msg.event.delta.text });
      else if (msg.type === "rate_limit_event")
        noteLimits(msg.rate_limit_info);
      else if (msg.type === "result") result = msg;
    }
    if (error) throw new Error(`claude: ${error}`);
    if (!result) throw new Error("claude: no result");
    if (result.is_error) throw new Error(`claude: ${result.subtype}`);
  } catch (e) {
    if (OLD_CLI_RE.test(e.message))
      setGlobalMessage({
        id: "LlmOldCli",
        text: "Old Cli",
        color: "red",
        position: LLM_MSG_POS,
      });
    throw e;
  } finally {
    showsTool?.close();
  }
  setGlobalMessage({ id: "LlmOldCli", action: "hide" });
  if (!resume)
    await dropOldSessions(result.session_id).catch((e) =>
      unilog(2759, `old claude sessions not deleted: ${e.message}`),
    );
  const u = result.usage ?? {};
  const inputTokens =
    (u.input_tokens ?? 0) +
    (u.cache_read_input_tokens ?? 0) +
    (u.cache_creation_input_tokens ?? 0);
  unilog(2750, `claude asked about ${states.length} shows in ${result.num_turns} turns, ${inputTokens} tokens: ${text}`);
  return {
    llm: true,
    inputTokens,
    // What the call would cost at API prices; the subscription charged
    // nothing for it while within its limits.
    apiCost: result.total_cost_usd ?? 0,
    // What Resume continues next time.
    sessionId: result.session_id,
    // Real money, for Auto's jev tool calls, and Jev's month so far.
    jevCost,
    monthCost: monthCost(),
    input,
    result: {
      answer: result.result,
      // Show names for the client's list filter, when Claude picked some.
      selected: showsTool?.selected() ?? null,
      toolCalls,
      turns: result.num_turns,
      stopReason: result.stop_reason,
      usage: u,
    },
  };
};

// The text asked of one show, whatever its wording: "set in the outback",
// "is it set in the outback?" and "which shows are set in the outback" all
// work. This beat "Is tv_show one of the TV shows this question asks for",
// which put shows that plainly fail at up to 0.22.
const showQuestion = (text) =>
  `The question "${text}" is about the TV show in \`tv_show\`. Is the answer yes?`;

// mode is the jev pane's choice. Plain asks the text once with no state, and
// Show asks it of the show named showName (the list's selection), that
// show's record as the state; the result is the answer whole. In Lib and All
// Shows ask it of every library show, or every show, separately, each show's
// record as the state; the result gives the probability (noul) that each one
// is a show the text asks for, most likely first. input is the request sent,
// the first show's for those two.
// on() is only for Claude, through the streaming route; see llmQuery. auto
// is the pane's Auto: Claude, with Jev as a tool.
export const jevQuery = async (
  { text, mode, showName, llm, auto, resume },
  on = () => {},
) => {
  const all = getAllTvdbSync();
  if (llm) {
    if (mode === "Show" && !all[showName])
      throw new Error(`no show named ${showName}`);
    const shows =
      mode === "Plain"
        ? []
        : mode === "Show"
          ? [all[showName]]
          : Object.values(all).filter(
              (s) => mode === "All Shows" || s.inLibrary !== false,
            );
    return llmQuery(text, mode, shows, on, auto, resume);
  }
  if (mode === "Plain" || mode === "Show") {
    let input = request("", text);
    if (mode === "Show") {
      if (!all[showName]) throw new Error(`no show named ${showName}`);
      input = request(showState(all[showName]), showQuestion(text));
    }
    const answer = await systemOne(input);
    const inputTokens = answer.usage.input_tokens;
    return {
      inputTokens,
      ...(await addCost(inputTokens)),
      input,
      result: answer,
    };
  }
  const recs = Object.values(all).filter(
    (s) => mode === "All Shows" || s.inLibrary !== false,
  );
  const { model, inputTokens, results } = await scoreShows(recs, text);
  return {
    inputTokens,
    ...(await addCost(inputTokens)),
    input: request(showState(recs[0]), showQuestion(text)),
    result: { model, shows: results },
  };
};

// The text asked of each show separately, its record as the state: the
// probability (noul) that each is a show the text asks for, most likely
// first. The caller records the cost.
const scoreShows = async (recs, text) => {
  const instructions = showQuestion(text);
  const results = [];
  let model = null;
  let inputTokens = 0;
  let next = 0;
  await Promise.all(
    Array.from({ length: JEV_WORKERS }, async () => {
      while (next < recs.length) {
        const s = recs[next++];
        const res = await systemOne(request(showState(s), instructions));
        model = res.model;
        inputTokens += res.usage.input_tokens;
        results.push({ name: s.name, noul: res.answers.answer.noul });
      }
    }),
  );
  results.sort((a, b) => b.noul - a.noul);
  unilog(2736, `asked ${results.length} shows, ${inputTokens} tokens: ${text}`);
  return { model, inputTokens, results };
};
