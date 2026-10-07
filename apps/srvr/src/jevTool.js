// The shows_sql tool Claude gets for the jev pane's In Lib and All Shows
// questions, as an in-process MCP server, after the finance app's
// server/src/sql-tool.js. Claude looks up only what a question needs, and
// sorts, counts and totals come out of SQL exactly instead of from Claude
// reading hundreds of records.
import Database from "better-sqlite3";
import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";

const SERVER_NAME = "shows";
const SQL_TOOL_NAME = `mcp__${SERVER_NAME}__sql`;
const SELECT_TOOL_NAME = `mcp__${SERVER_NAME}__select`;
const JEV_TOOL_NAME = `mcp__${SERVER_NAME}__jev`;
const MAX_ROWS = 500;
// Every result is re-read on each remaining turn, so the bytes are capped as
// well as the rows: 500 overviews and 500 names are nothing alike.
const MAX_BYTES = 40000;

// SQLite types for the JS values the show states hold. Arrays go in as JSON
// text, booleans as 0/1.
const sqlType = (v) =>
  typeof v === "number" ? "NUMERIC" : typeof v === "boolean" ? "INTEGER" : "TEXT";
const sqlValue = (v) =>
  v == null
    ? null
    : typeof v === "boolean"
      ? Number(v)
      : typeof v === "object"
        ? JSON.stringify(v)
        : v;

// One SELECT only; anything else is refused so Claude can correct itself.
const assertSelect = (sql) => {
  const q = String(sql).trim().replace(/;+\s*$/, "");
  if (!q) throw new Error("empty query");
  if (q.includes(";")) throw new Error("only one statement per query");
  if (!/^(select|with)\b/i.test(q))
    throw new Error("only SELECT (or WITH ... SELECT) queries are allowed");
  return q;
};

// The columns once, then each row as a bare array, under the byte budget.
const runSelect = (db, sql, params) => {
  const stmt = db.prepare(assertSelect(sql));
  if (!stmt.reader) throw new Error("that statement does not return rows");
  const all = stmt.all(params ?? []);
  const columns = all.length ? Object.keys(all[0]) : [];
  const payload = {
    columns,
    rows: all.slice(0, MAX_ROWS).map((r) => columns.map((c) => r[c])),
  };
  let json = JSON.stringify(payload);
  while (json.length > MAX_BYTES && payload.rows.length > 1) {
    payload.rows.splice(-Math.ceil(payload.rows.length * 0.2));
    json = JSON.stringify(payload);
  }
  if (payload.rows.length < all.length) {
    payload.note =
      `${all.length} rows matched, first ${payload.rows.length} returned. ` +
      "Narrow the query: fewer columns, aggregate it, or page with LIMIT/OFFSET.";
    json = JSON.stringify(payload);
  }
  return json;
};

// An in-memory table of the given show states, the session options that
// give Claude the MCP server over it, and the table's schema. Made fresh for
// every question: an SDK MCP server holds one session's transport at a time.
// selected() is what Claude's select tool last picked for the show list, or
// null. close() frees the table. With jevScore (the pane's Auto), Claude
// also gets the jev tool: jevScore(question) scores every show in the table
// with Jev and resolves to [{name, noul}] at or above jevMin, highest first.
export const makeShowsTool = (states, { jevScore, jevMin } = {}) => {
  const columns = new Map();
  for (const s of states)
    for (const [k, v] of Object.entries(s))
      if (!columns.has(k) && v != null) columns.set(k, sqlType(v));
  const db = new Database(":memory:");
  const cols = [...columns.keys()];
  db.exec(
    `CREATE TABLE shows (${cols.map((c) => `"${c}" ${columns.get(c)}`).join(", ")})`,
  );
  const insert = db.prepare(
    `INSERT INTO shows VALUES (${cols.map(() => "?").join(", ")})`,
  );
  db.transaction(() => {
    for (const s of states) insert.run(cols.map((c) => sqlValue(s[c])));
  })();
  const schema =
    `shows(${cols.map((c) => `${c} ${columns.get(c)}`).join(", ")})\n` +
    "One row per show. Dates are text like 2024/03/19. Array columns " +
    "(genres, crew, actors, collections) hold JSON arrays; use json_each() " +
    "to search them. sitcom and inLibrary are 0/1. Empty values are NULL.";
  const known = new Set(states.map((s) => s.name));
  let selected = null;
  const server = createSdkMcpServer({
    name: SERVER_NAME,
    version: "1.0.0",
    tools: [
      tool(
        "sql",
        `Run one read-only SQLite SELECT against the TV shows table:\n${schema}\n` +
          "Name the columns you need and never SELECT *. Do sorting, counting " +
          "and totals in SQL rather than over rows you fetch. Results come " +
          `back as {"columns":[...],"rows":[[...]]}, at most ${MAX_ROWS} rows ` +
          `and about ${MAX_BYTES / 1000}KB.`,
        {
          query: z.string().describe("A single SELECT or WITH ... SELECT."),
          params: z
            .array(z.union([z.string(), z.number(), z.null()]))
            .describe("Values for ? placeholders; empty if there are none."),
        },
        async ({ query, params }) => {
          try {
            return {
              content: [{ type: "text", text: runSelect(db, query, params) }],
            };
          } catch (e) {
            // A failed tool still answers, so Claude can fix the query.
            return {
              content: [{ type: "text", text: `error: ${e.message}` }],
              isError: true,
            };
          }
        },
      ),
      tool(
        "select",
        "Filter the user's show list down to these shows. Call it when the " +
          "user asks you to select, filter or pick out shows. Pass every " +
          "matching show's exact name from the table's name column; a later " +
          "call replaces an earlier one.",
        { names: z.array(z.string()).describe("Exact show names.") },
        async ({ names }) => {
          const unknown = names.filter((n) => !known.has(n));
          if (unknown.length)
            return {
              content: [
                {
                  type: "text",
                  text: `error: not in the table: ${unknown.join(", ")}. Use exact name values.`,
                },
              ],
              isError: true,
            };
          selected = [...new Set(names)];
          return {
            content: [{ type: "text", text: `selected ${selected.length} shows` }],
          };
        },
      ),
      ...(jevScore
        ? [
            tool(
              "jev",
              `Score every show in the table with Jev, a fast classifier that ` +
                `reads each show's full record and judges a yes/no question ` +
                `about that one show. Use it for what shows are about: story, ` +
                `themes, setting, tone. Phrase the question so one show can ` +
                `answer it. Returns the shows scoring ${jevMin} or more as ` +
                `[name, score] pairs, highest first. Takes about 5 seconds.`,
              {
                question: z
                  .string()
                  .describe("What a show must be, e.g. set in the outback."),
              },
              async ({ question }) => {
                try {
                  const rows = (await jevScore(question)).map((r) => [
                    r.name,
                    r.noul,
                  ]);
                  return {
                    content: [
                      {
                        type: "text",
                        text: JSON.stringify({
                          scored: states.length,
                          shows: rows,
                        }),
                      },
                    ],
                  };
                } catch (e) {
                  return {
                    content: [{ type: "text", text: `error: ${e.message}` }],
                    isError: true,
                  };
                }
              },
            ),
          ]
        : []),
    ],
  });
  return {
    mcpServers: { [SERVER_NAME]: server },
    allowedTools: [
      SQL_TOOL_NAME,
      SELECT_TOOL_NAME,
      ...(jevScore ? [JEV_TOOL_NAME] : []),
    ],
    schema,
    selected: () => selected,
    close: () => db.close(),
  };
};
