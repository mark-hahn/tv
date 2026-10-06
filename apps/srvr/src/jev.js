// Questions for TypeSafe's jev model, from the client's jev pane.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { logHere, unilog} from "@tv/share"
import { getAllTvdbSync } from "./tvdb.js";
import { SRVR_DATA_DIR } from "./srvrPaths.js";

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
  const month = today.slice(0, 7);
  let monthCost = 0;
  for (const [date, c] of Object.entries(jevCost))
    if (date.startsWith(month)) monthCost += c;
  return { cost, monthCost };
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

// The state jev gets for one show.
const showState = (s) => ({
  tv_show: {
    name: s.name,
    firstAired: s.firstAired,
    originalCountry: s.originalCountry,
    originalNetwork: s.originalNetwork?.name ?? s.originalNetwork,
    genres: s.genres,
    overview: s.overview,
  },
});

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
export const jevQuery = async ({ text, mode, showName }) => {
  const all = getAllTvdbSync();
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
  return {
    inputTokens,
    ...(await addCost(inputTokens)),
    input: request(showState(recs[0]), instructions),
    result: { model, shows: results },
  };
};
