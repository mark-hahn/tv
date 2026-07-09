// Unilog HTTP surface: the central /api/log collector, the reconciler tooling
// endpoints (id/group allocation), the log-viewer read-back, and the Groups
// management endpoints. Owns the log-pane subscriber set + the row broadcast to
// subscribed clients and the periodic prune. index.js wires the in-process sink
// (broadcastUnilog) and routes WebSocket subscribe/unsubscribe here.

import * as unilogDb from "../unilogDb.js";
import { notifyClients } from "../messaging.js";

const unilogSubscribers = new Set();
let unilogLastPruneTime = 0;
const UNILOG_PRUNE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// Client collision tracking: map client hash -> client ID, and current active ID.
const clientHashMap = new Map();
let curClientLogId = 0;
let nextClientId = 1;
let newClientSiteId = null;

// Initialize the "New client" log site at startup.
function initNewClientSite() {
  try {
    const clientsGroup = unilogDb.findOrCreateGroup({
      description: "clients",
    });
    newClientSiteId = unilogDb.createSite({
      tag: null,
      description: "New client",
      level: "warn",
      srcFile: "routes/unilog.js",
      srcLine: 0,
      oldLog: null,
      project: "srvr",
      groupIds: [clientsGroup.id],
    });
  } catch (error) {
    console.error("[unilog] Failed to init new client site:", error); // no-unilog
  }
}

initNewClientSite();

// Prune oldest log_events to keep table under 90_000 rows.
// Only runs when no subscribers have the log pane open and at least 1 hour
// has elapsed since the last prune.
export function maybeUnilogPrune() {
  if (unilogSubscribers.size > 0) return;
  if (Date.now() - unilogLastPruneTime < UNILOG_PRUNE_INTERVAL_MS) return;
  const deleted = unilogDb.pruneEvents();
  if (deleted > 0) {
    unilogLastPruneTime = Date.now();
    notifyClients("unilog-pruned", null);
  }
}

export function broadcastUnilog(row) {
  if (!row || unilogSubscribers.size === 0) return;
  if (row.hide) return; // don't broadcast hidden events
  const msg = JSON.stringify({
    id: 0,
    notification: "unilog-event",
    data: row,
  });
  for (const ws of unilogSubscribers) {
    if (ws.readyState === 1) {
      try {
        ws.send(msg);
      } catch (_) {} // no-unilog
    }
  }
}

export function addUnilogSubscriber(ws) {
  unilogSubscribers.add(ws);
}

export function removeUnilogSubscriber(ws) {
  unilogSubscribers.delete(ws);
  maybeUnilogPrune();
}

export function registerUnilogRoutes(app) {
  // Central log collector endpoint. Accepts a single event or a batch array.
  // pid identifies the EMITTING process/client; ts is stamped by the writer.
  app.post("/api/log", (req, res) => {
    try {
      const body = req.body;
      const events = Array.isArray(body) ? body : [body];

      // Check for client collision (only for client events with clientHash).
      const firstEvent = events[0];
      let currentClientId = null;
      if (firstEvent && firstEvent.clientHash && firstEvent.pid === "client") {
        const hash = firstEvent.clientHash;
        const existingId = clientHashMap.get(hash);

        if (existingId === undefined) {
          // New client: assign ID, log "New client", update current, add to map.
          const newId = nextClientId++;
          clientHashMap.set(hash, newId);
          curClientLogId = newId;
          currentClientId = newId;

          // Insert the "New client <id>" event using the pre-created site.
          if (newClientSiteId) {
            broadcastUnilog(
              unilogDb.insertEventDedup({
                logId: newClientSiteId,
                pid: "srvr",
                message: `New client ${newId}`,
              }),
            );
          }
        } else if (existingId !== curClientLogId) {
          // Old client but not the active one: reject and tell it to stop logging.
          return res.json({ ok: false, loggingDisabled: true });
        } else {
          currentClientId = existingId;
        }
        // else: existing client and is current, proceed normally below.
      }

      // Process all events normally.
      for (const e of events) {
        if (!e || e.logId == null) continue;
        let message = e.message;
        // Replace ~~~ with client ID if present.
        if (currentClientId && message && message.includes("~~~")) {
          message = message.replace(/~~~/g, currentClientId);
        }
        broadcastUnilog(
          unilogDb.insertEventDedup({
            logId: e.logId,
            pid: e.pid || "unknown",
            message,
          }),
        );
      }
      res.json({ ok: true, count: events.length });
    } catch (error) {
      console.error("[unilog] /api/log error:", error); // no-unilog
      res.status(500).json({ error: String(error?.message || error) });
    }
  });

  // Tooling endpoints — used by the local deploy-time reconciler to allocate ids.
  // tv-srvr is the only id generator; all log_id and group_id allocation flows here.

  app.post("/api/unilog/group", (req, res) => {
    try {
      const id = unilogDb.createGroup(req.body || {});
      res.json({ id });
    } catch (error) {
      console.error("[unilog] /api/unilog/group error:", error); // no-unilog
      res.status(500).json({ error: String(error?.message || error) });
    }
  });

  // Find a named group by description, or create it if absent. Used by the
  // reconciler to resolve logHere `grp` names to group ids.
  app.post("/api/unilog/find-or-create-group", (req, res) => {
    try {
      const { description } = req.body || {};
      if (!description)
        return res.status(400).json({ error: "description required" });
      res.json(unilogDb.findOrCreateGroup({ description }));
    } catch (error) {
      console.error("[unilog] /api/unilog/find-or-create-group error:", error); // no-unilog
      res.status(500).json({ error: String(error?.message || error) });
    }
  });

  app.post("/api/unilog/sites", (req, res) => {
    try {
      const sites = Array.isArray(req.body) ? req.body : [req.body];
      const ids = sites.map((s) => unilogDb.createSite(s));
      res.json({ ids });
    } catch (error) {
      console.error("[unilog] /api/unilog/sites error:", error); // no-unilog
      res.status(500).json({ error: String(error?.message || error) });
    }
  });

  app.post("/api/unilog/refresh-sites", (req, res) => {
    try {
      const sites = Array.isArray(req.body) ? req.body : [req.body];
      for (const s of sites) unilogDb.refreshSite(s);
      res.json({ refreshed: sites.length });
    } catch (error) {
      console.error("[unilog] /api/unilog/refresh-sites error:", error); // no-unilog
      res.status(500).json({ error: String(error?.message || error) });
    }
  });

  // Split a duplicate log_id: create a fresh row (copied from the old id's row, or
  // stub-like if the old id has no row) and return the new id. Used by the
  // deploy-time reconciler when it finds the same id on more than one source line.
  app.post("/api/unilog/duplicate-site", (req, res) => {
    try {
      const id = unilogDb.createDuplicateSite(req.body || {});
      res.json({ id });
    } catch (error) {
      console.error("[unilog] /api/unilog/duplicate-site error:", error); // no-unilog
      res.status(500).json({ error: String(error?.message || error) });
    }
  });

  app.post("/api/unilog/query-sites", (req, res) => {
    try {
      const ids = Array.isArray(req.body) ? req.body : (req.body?.ids ?? []);
      res.json(unilogDb.querySites(ids));
    } catch (error) {
      console.error("[unilog] /api/unilog/query-sites error:", error); // no-unilog
      res.status(500).json({ error: String(error?.message || error) });
    }
  });

  app.post("/api/unilog/set-level", (req, res) => {
    try {
      const { ids, level } = req.body || {};
      if (!Array.isArray(ids) || !ids.length)
        return res.status(400).json({ error: "ids required" });
      const changed = unilogDb.setSiteLevel(ids, level);
      res.json({ ok: true, changed });
    } catch (error) {
      console.error("[unilog] /api/unilog/set-level error:", error); // no-unilog
      res.status(500).json({ error: String(error?.message || error) });
    }
  });

  app.post("/api/unilog/delete-events", (req, res) => {
    try {
      const { eventIds } = req.body || {};
      if (!Array.isArray(eventIds) || !eventIds.length)
        return res.status(400).json({ error: "eventIds required" });
      const deleted = unilogDb.deleteEvents(eventIds);
      res.json({ ok: true, deleted });
    } catch (error) {
      console.error("[unilog] /api/unilog/delete-events error:", error); // no-unilog
      res.status(500).json({ error: String(error?.message || error) });
    }
  });

  app.post("/api/unilog/show-events", (req, res) => {
    try {
      const { groupIds } = req.body || {};
      if (!Array.isArray(groupIds) || !groupIds.length)
        return res.status(400).json({ error: "groupIds required" });
      const changed = unilogDb.showEventsInGroups(groupIds);
      res.json({ ok: true, changed });
    } catch (error) {
      console.error("[unilog] /api/unilog/show-events error:", error); // no-unilog
      res.status(500).json({ error: String(error?.message || error) });
    }
  });

  app.post("/api/unilog/unshow-events", (req, res) => {
    try {
      const { groupIds } = req.body || {};
      if (!Array.isArray(groupIds) || !groupIds.length)
        return res.status(400).json({ error: "groupIds required" });
      const changed = unilogDb.unshowEventsInGroups(groupIds);
      res.json({ ok: true, changed });
    } catch (error) {
      console.error("[unilog] /api/unilog/unshow-events error:", error); // no-unilog
      res.status(500).json({ error: String(error?.message || error) });
    }
  });

  // Read-back for the web client log viewer (Log tab). Returns recent events
  // (newest first) joined with their sites, plus the distinct pid list.
  app.get("/api/unilog/events", (req, res) => {
    try {
      const { pid, level, file, msg, limit, beforeId, afterId, errors } =
        req.query;
      res.json({
        events: unilogDb.queryEvents({
          pid,
          level,
          file,
          msg,
          limit,
          beforeId,
          afterId,
          errors,
        }),
        pids: unilogDb.listPids(),
        levels: unilogDb.listLevels(),
        total: unilogDb.countEvents(),
        dedupDropped: unilogDb.getDedupDropped(),
      });
    } catch (error) {
      console.error("[unilog] /api/unilog/events error:", error); // no-unilog
      res.status(500).json({ error: String(error?.message || error) });
    }
  });

  app.get("/api/unilog/oldest-ts", (req, res) => {
    try {
      res.json({ ts: unilogDb.getOldestTimestamp() });
    } catch (error) {
      console.error("[unilog] /api/unilog/oldest-ts error:", error); // no-unilog
      res.status(500).json({ error: String(error?.message || error) });
    }
  });

  // Groups management (web client Groups pane).
  app.get("/api/unilog/groups", (req, res) => {
    try {
      res.json({ groups: unilogDb.listGroups() });
    } catch (error) {
      console.error("[unilog] /api/unilog/groups error:", error); // no-unilog
      res.status(500).json({ error: String(error?.message || error) });
    }
  });

  app.get("/api/unilog/groups/orphans", (req, res) => {
    try {
      res.json({ groupIds: unilogDb.orphanGroupIds() });
    } catch (error) {
      console.error("[unilog] /api/unilog/groups/orphans error:", error); // no-unilog
      res.status(500).json({ error: String(error?.message || error) });
    }
  });

  app.post("/api/unilog/groups/create", (req, res) => {
    try {
      const { description, logIds } = req.body || {};
      if (!description || !String(description).trim())
        return res.status(400).json({ error: "description required" });
      res.json(
        unilogDb.createGroupWithSites({
          description: String(description).trim(),
          logIds: Array.isArray(logIds) ? logIds : [],
        }),
      );
    } catch (error) {
      console.error("[unilog] /api/unilog/groups/create error:", error); // no-unilog
      res.status(500).json({ error: String(error?.message || error) });
    }
  });

  app.post("/api/unilog/groups/assign", (req, res) => {
    try {
      const { groupIds, logIds } = req.body || {};
      res.json(
        unilogDb.assignGroupsToSites({
          groupIds: Array.isArray(groupIds) ? groupIds : [],
          logIds: Array.isArray(logIds) ? logIds : [],
        }),
      );
    } catch (error) {
      console.error("[unilog] /api/unilog/groups/assign error:", error); // no-unilog
      res.status(500).json({ error: String(error?.message || error) });
    }
  });

  app.post("/api/unilog/groups/remove", (req, res) => {
    try {
      const { groupIds, logIds } = req.body || {};
      res.json(
        unilogDb.removeGroupsFromSites({
          groupIds: Array.isArray(groupIds) ? groupIds : [],
          logIds: Array.isArray(logIds) ? logIds : [],
        }),
      );
    } catch (error) {
      console.error("[unilog] /api/unilog/groups/remove error:", error); // no-unilog
      res.status(500).json({ error: String(error?.message || error) });
    }
  });

  app.post("/api/unilog/groups/delete", (req, res) => {
    try {
      const { groupIds } = req.body || {};
      res.json(unilogDb.deleteGroups(Array.isArray(groupIds) ? groupIds : []));
    } catch (error) {
      console.error("[unilog] /api/unilog/groups/delete error:", error); // no-unilog
      res.status(500).json({ error: String(error?.message || error) });
    }
  });

  app.get("/api/unilog/groups/stats", (req, res) => {
    try {
      const groupId = Number(req.query.groupId);
      if (!Number.isFinite(groupId))
        return res.status(400).json({ error: "groupId required" });
      res.json(unilogDb.groupStats(groupId));
    } catch (error) {
      console.error("[unilog] /api/unilog/groups/stats error:", error); // no-unilog
      res.status(500).json({ error: String(error?.message || error) });
    }
  });

  app.post("/api/unilog/groups/site-ids", (req, res) => {
    try {
      const { groupIds } = req.body || {};
      res.json({
        logIds: unilogDb.siteIdsForGroups(
          Array.isArray(groupIds) ? groupIds : [],
        ),
      });
    } catch (error) {
      console.error("[unilog] /api/unilog/groups/site-ids error:", error); // no-unilog
      res.status(500).json({ error: String(error?.message || error) });
    }
  });

  app.post("/api/unilog/groups/ids-for-sites", (req, res) => {
    try {
      const { logIds } = req.body || {};
      res.json({
        groupIds: unilogDb.groupIdsForSites(
          Array.isArray(logIds) ? logIds : [],
        ),
      });
    } catch (error) {
      console.error("[unilog] /api/unilog/groups/ids-for-sites error:", error); // no-unilog
      res.status(500).json({ error: String(error?.message || error) });
    }
  });

  app.post("/api/unilog/groups/for-sites", (req, res) => {
    try {
      const { logIds } = req.body || {};
      res.json(unilogDb.groupsForSites(Array.isArray(logIds) ? logIds : []));
    } catch (error) {
      console.error("[unilog] /api/unilog/groups/for-sites error:", error); // no-unilog
      res.status(500).json({ error: String(error?.message || error) });
    }
  });

  app.post("/api/unilog/groups/set-name", (req, res) => {
    try {
      const { groupId, description } = req.body || {};
      if (groupId == null || !description || !String(description).trim())
        return res
          .status(400)
          .json({ error: "groupId and description required" });
      res.json(
        unilogDb.setGroupName({
          groupId,
          description: String(description).trim(),
        }),
      );
    } catch (error) {
      console.error("[unilog] /api/unilog/groups/set-name error:", error); // no-unilog
      res.status(500).json({ error: String(error?.message || error) });
    }
  });
}
