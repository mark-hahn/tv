import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  Alert,
  Keyboard,
  PermissionsAndroid,
  Pressable,
  StyleSheet,
  StatusBar,
  ScrollView,
  FlatList,
  TouchableOpacity,
  TextInput,
  Image,
  Linking,
  PixelRatio,
  Dimensions,
} from "react-native";

import { MaterialIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import allServices from "./services.json";
import { keyLabels } from "./keyLabels.js";

// Normalize font sizes so system font scale doesn't affect the app
const fs = (size) => size / PixelRatio.getFontScale();

// Human-readable label for the lockout message. openapp:/subtitle: keys
// carry their own readable suffix already, everything else looks up
// ./keyLabels.json (see that file to change wording).
const keyLabel = (key) => {
  if (!key) return key;
  if (key.startsWith("openapp:")) return key.slice("openapp:".length);
  if (key.startsWith("subtitle:"))
    return `Subtitle ${key.slice("subtitle:".length)}`;
  return keyLabels[key] ?? key;
};

const TV_TV_URL = "https://hahnca.com/tv-tv";
const TV_SRVR_WS_URL = "wss://hahnca.com/tv-srvr";
const TV_SRVR_HTTP_URL = "https://hahnca.com/tv-srvr";
const TVAPPRC_HOST = "192.168.1.103";
const TVAPPRC_PORT = 8098;
const TVAPPRC_RECONNECT_MS = 2000;
const TVAPPRC_CONNECT_TIMEOUT_MS = 5000;
const LOCAL_NETWORK_PERMISSION = "android.permission.ACCESS_LOCAL_NETWORK";
const MSG_TVAPP_UP = "u";
const MSG_TVAPP_DOWN = "d";
const MSG_CLEAR_FILTER = "z";
const MSG_COUNTS = "c";
const MSG_ACTIVE_SHOW = "a";
const CMD_OPEN_TVAPP = "o";
const CMD_CLOSE_TO_EMBY = "b";
// Back to a clean tvapp screen: the show list focused and nothing else,
// cardMisc back to its description, filters off.
const CMD_CLEAR_STATE = "r";
const CMD_KEY = "k";
// Letter-skip variant of CMD_KEY, up/down only -- sent instead of CMD_KEY
// once a held key has been auto-repeating fast long enough that tvapp's show
// list starts jumping by starting letter instead of by row.
const CMD_KEY_LETTER = "j";
// Not arrows: each of these hands the focus to one of tvapp's areas, which the
// arrow keys cannot all reach -- the sort group, the filter group, and the
// selected card's cardMisc. Info also rotates cardMisc once it is focused.
const CMD_KEY_SORT = "sort";
const CMD_KEY_FILTER = "filter";
const CMD_KEY_INFO = "info";
const CMD_FILTER = "f";
const SCRUB_HOLD_DELAY_MS = 400;
// tvapp arrow-key repeat: fast cadence once a hold clears the initial
// SCRUB_HOLD_DELAY_MS. After another SCRUB_HOLD_DELAY_MS of fast repeats,
// up/down switch to letter-skip mode, which repeats at SCRUB_HOLD_DELAY_MS
// again -- the same "slow" pace, reused rather than a new constant.
const TVAPP_FAST_REPEAT_MS = 120;
const SCRUB_PING_INTERVAL_MS = 500;
const VOL_STEP = 1;
const PIC_VAL_MAX_CHARS = 20;
const PIC_VAL_EDGE_CHARS = 8;

function buildSeriesMap(seriesMapIn) {
  if (!seriesMapIn || seriesMapIn.length === 0) return null;
  const result = {};
  for (const [seasonNum, episodes] of seriesMapIn) {
    const seasonMap = {};
    result[seasonNum] = seasonMap;
    for (const [episodeNum, epiObj] of episodes) {
      seasonMap[episodeNum] = epiObj;
    }
  }
  return result;
}

function displayEpisodeTitle(name) {
  const title = String(name || "").trim();
  if (!title) return "";
  return /^(season|episode)\s+\d+$/i.test(title) ? "" : title;
}

function formatSelectedSE(selectedSE) {
  if (!selectedSE?.s || !selectedSE?.e) return "";
  return `(S${String(selectedSE.s).padStart(2, "0")}E${String(selectedSE.e).padStart(2, "0")})`;
}

function formatLaDateTime(dateIn) {
  const date = dateIn instanceof Date ? dateIn : new Date(dateIn);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map = {};
  for (const part of parts) {
    if (part && part.type && part.value) map[part.type] = part.value;
  }
  if (map.hour === "24") map.hour = "00";
  if (
    !map.year ||
    !map.month ||
    !map.day ||
    !map.hour ||
    !map.minute ||
    !map.second
  ) {
    return "";
  }
  const hour = map.hour === "24" ? "00" : map.hour;
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${map.year}/${map.month}/${map.day} ${hour}:${map.minute}:${map.second}.${ms}`;
}

function normalizePlayedDate(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 0 && value < 100000000000 ? value * 1000 : value;
    return formatLaDateTime(ms);
  }
  const raw = String(value).trim();
  if (!raw) return "";
  if (/^\d+$/.test(raw)) return normalizePlayedDate(Number(raw));
  let m = raw.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);
  if (m) return `${m[1]}/${m[2]}/${m[3]} 00:00:00.000`;
  m = raw.match(
    /^(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,}))?$/,
  );
  if (m) {
    const hour = m[4] === "24" ? "00" : m[4];
    const ms = (m[7] || "000").slice(0, 3).padEnd(3, "0");
    return `${m[1]}/${m[2]}/${m[3]} ${hour}:${m[5]}:${m[6]}.${ms}`;
  }
  return formatLaDateTime(raw);
}

function getViewedSortValue(show, lastViewedMap) {
  void lastViewedMap;
  return normalizePlayedDate(show?.lastPlayedDate) || "";
}

const COLS = 3;
const ROWS = 5;
// tvapprc mode adds a row of its own on top -- sort, filter, info -- so the
// cells there are shorter than the ordinary remote's.
const TVAPPRC_ROWS = 6;
const BORDER = 13;
const SCREEN_MARGIN = 30;

// Stable per-instance client id, used to ignore our own echoed remote actions
// (a live duplicate socket would otherwise make this UI collide with itself on
// the next key). Module scope so it survives Fast Refresh re-renders.
const CLIENT_ID = Math.random().toString(36).slice(2);

export default function App() {
  // The grid's measured size rather than the cell size worked out from it: the
  // row count changes with tvapprc mode, which is not a layout change, so the
  // cells have to be derived on every render instead of on measure.
  const [gridSize, setGridSize] = useState({ w: 0, h: 0 });
  const [showStreamers, setShowStreamers] = useState(false);
  const [tvapprcMode, setTvapprcMode] = useState(false);
  const [showTvapprcInput, setShowTvapprcInput] = useState(false);
  const [tvapprcFilter, setTvapprcFilter] = useState("");
  const [tvapprcShows, setTvapprcShows] = useState([]);
  const [tvapprcTotalCount, setTvapprcTotalCount] = useState(0);
  const [tvapprcListCount, setTvapprcListCount] = useState(null);
  const tvapprcShowsLoadedRef = useRef(false);
  const [flashSvc, setFlashSvc] = useState(null);
  const [showSubCtrl, setShowSubCtrl] = useState(false);
  const [subPlayers, setSubPlayers] = useState([]);
  const [subDeviceName, setSubDeviceName] = useState(null);
  const [showPicCtrl, setShowPicCtrl] = useState(false);
  const [picSettings, setPicSettings] = useState([]);
  const [picInputs, setPicInputs] = useState({}); // target -> { typing, raw }
  const [locked, setLocked] = useState(false);
  const [lockInfo, setLockInfo] = useState(null);
  const [missingEpWarning, setMissingEpWarning] = useState(null);
  const [subMismatchWarning, setSubMismatchWarning] = useState(false);
  const [layoutOption, setLayoutOption] = useState("mark");
  useEffect(() => {
    layoutOptionRef.current = layoutOption;
  }, [layoutOption]);
  const [showShows, setShowShows] = useState(false);
  const [showsList, setShowsList] = useState([]);
  const [selectedShow, setSelectedShow] = useState(null);
  const [selectedSE, setSelectedSE] = useState(null);
  const [followPlaying, setFollowPlaying] = useState(false);
  const [activeTab, setActiveTab] = useState("List");
  const [guestActors, setGuestActors] = useState([]);
  const [episodeInfo, setEpisodeInfo] = useState(null);
  const [showSearch, setShowSearch] = useState("");
  const [sortOrder, setSortOrder] = useState("viewed");
  const [scrollToTopOnOpen, setScrollToTopOnOpen] = useState(false);
  useEffect(() => {
    sortOrderRef.current = sortOrder;
  }, [sortOrder]);
  const [posterExpanded, setPosterExpanded] = useState(false);
  const [showSeriesMap, setShowSeriesMap] = useState(null);
  const [mapRefreshKey, setMapRefreshKey] = useState(0);
  const [playProgress, setPlayProgress] = useState(null);
  const [flashCell, setFlashCell] = useState(null);
  const [mapImageExpanded, setMapImageExpanded] = useState(false);
  const [epiStats, setEpiStats] = useState(null);
  const onGridLayout = ({ nativeEvent: { layout } }) => {
    if (layout.width < 10 || layout.height < 10) return;
    setGridSize({ w: layout.width, h: layout.height });
  };
  const gridRows = tvapprcMode ? TVAPPRC_ROWS : ROWS;
  const cellDims = {
    w: Math.floor((gridSize.w - BORDER * (COLS - 1)) / COLS),
    h: Math.floor((gridSize.h - BORDER * (gridRows - 1)) / gridRows),
  };
  const [flashBtn, setFlashBtn] = useState(null);
  const [haState, setHaState] = useState(null);
  const [mediaTitle, setMediaTitle] = useState(null);

  const wsRef = useRef(null);
  const channelsRef = useRef(new Map());
  const repeatDelayRef = useRef(null);
  const repeatTimeoutRef = useRef(null);
  const repeatActiveRef = useRef(false);
  const subPlayersRef = useRef([]);
  const lastCmdRef = useRef(0);
  const holdRef = useRef(null);
  const volActiveRef = useRef(false);
  const kybdInputRef = useRef(null);
  const embyHoldRef = useRef(null);
  const embyHoldFiredRef = useRef(false);
  const appsHoldRef = useRef(null);
  const appsHoldFiredRef = useRef(false);
  const lpRef = useRef(null);
  const volDownHoldRef = useRef(null);
  const volDownHoldFiredRef = useRef(false);
  const picCommitTimersRef = useRef({});
  const picInputsRef = useRef({});
  const subPendingRef = useRef(null); // { deviceName, index } while optimistic highlight is active
  const subGenRef = useRef(0);
  const subNavigatingRef = useRef(false);
  const unlockHoldTimerRef = useRef(null);
  const pendingLRKeyRef = useRef(null);
  const homeHoldRef = useRef(null);
  const homeHoldFiredRef = useRef(false);
  const showPlayingRef = useRef(null);
  const followPlayingRef = useRef(false);
  const layoutOptionRef = useRef("mark");
  const showSelectedRef = useRef(null);
  const sortOrderRef = useRef("viewed");
  const lastViewedRef = useRef({});
  const showsListRef = useRef([]);
  const showsListLoadedRef = useRef(false);
  const showsFlatListRef = useRef(null);
  const mapHeaderScrollRef = useRef(null);
  const tvapprcWsRef = useRef(null);
  // The show tvapp has active, sent by tvapp on every change and on connect.
  const tvapprcActiveShowRef = useRef(null);
  // A show name the shows pane selects as soon as its list is loaded.
  const pendingShowSelectRef = useRef(null);

  const debounce = () => {
    const now = Date.now();
    const ok = now - lastCmdRef.current >= 250;
    lastCmdRef.current = now;
    return ok;
  };

  const startRepeat = (key) => {
    if (tvapprcMode) {
      flash(key);
      repeatActiveRef.current = true;
      pendingLRKeyRef.current = null;
      const isUpDown = key === "up" || key === "down";
      (async () => {
        const r = await sendKeyThrough(key, null);
        if (r.blocked) return stopRepeat();
        sendTvapprc(`${CMD_KEY},${key}`);
        await new Promise((r) => {
          repeatDelayRef.current = setTimeout(r, SCRUB_HOLD_DELAY_MS);
        });
        // Fast phase, repeating every TVAPP_FAST_REPEAT_MS. Once up/down have
        // held through another SCRUB_HOLD_DELAY_MS of it -- the same delay
        // that got us here -- switch to letter-skip mode: back to the slow
        // SCRUB_HOLD_DELAY_MS cadence, but each repeat jumps a letter.
        let fastElapsedMs = 0;
        let letterMode = false;
        while (repeatActiveRef.current) {
          const rr = await sendKeyThrough(key, null, { repeating: true });
          if (rr.blocked) return stopRepeat();
          sendTvapprc(`${letterMode ? CMD_KEY_LETTER : CMD_KEY},${key}`);
          const delay = letterMode ? SCRUB_HOLD_DELAY_MS : TVAPP_FAST_REPEAT_MS;
          await new Promise((r) => {
            repeatTimeoutRef.current = setTimeout(r, delay);
          });
          if (!letterMode && isUpDown) {
            fastElapsedMs += TVAPP_FAST_REPEAT_MS;
            if (fastElapsedMs >= SCRUB_HOLD_DELAY_MS) letterMode = true;
          }
        }
      })();
      return;
    }
    if (isOff || isOther) return;
    if (!debounce()) return;
    flash(key);
    repeatActiveRef.current = true;
    pendingLRKeyRef.current = null;
    const isLR = key === "left" || key === "right";
    (async () => {
      if (!isLR) {
        const r = await sendKeyThrough(key, `/tv/key/${key}`);
        if (r.blocked) return stopRepeat();
        if (!repeatActiveRef.current) return;
      } else {
        // Only arms the collision window here — the actual send (tap
        // release below, or scrub start/ping) happens once we know
        // whether this is a short tap or a long-press scrub.
        const r = await sendKeyThrough(key, null);
        if (r.blocked) return stopRepeat();
        pendingLRKeyRef.current = key;
      }
      await new Promise((r) => {
        repeatDelayRef.current = setTimeout(r, SCRUB_HOLD_DELAY_MS);
      });
      if (!repeatActiveRef.current) return;
      if (isLR) {
        pendingLRKeyRef.current = null; // long press — key will not be sent on release
        // Start server-side scrubbing (repeating: a held scrub owns the floor)
        const r = await sendKeyThrough(key, `/tv/scrub/start`, {
          method: "POST",
          body: { direction: key },
          repeating: true,
        });
        if (r.blocked) return stopRepeat();
        // Send ping repeatedly while holding
        while (repeatActiveRef.current) {
          await new Promise((r) => {
            repeatTimeoutRef.current = setTimeout(r, SCRUB_PING_INTERVAL_MS);
          });
          if (!repeatActiveRef.current) break;
          const p = await sendKeyThrough(key, `/tv/scrub/ping`, {
            method: "POST",
            repeating: true,
          });
          if (p.blocked) return stopRepeat();
        }
        return;
      }
      // Non-LR keys: standard repeat logic
      let count = 0;
      while (repeatActiveRef.current) {
        const isFast = count >= 4;
        const n =
          mode === "fire" && key === "right"
            ? isFast
              ? 18
              : 1
            : mode === "fire" && key === "left"
              ? isFast
                ? 6
                : 1
              : isFast && mode === "fire"
                ? 3
                : 1;
        const path =
          n > 1 ? `/tv/key/${key}?n=${n}` : `/tv/key/${key}`;
        const r = await sendKeyThrough(key, path, { repeating: true });
        if (r.blocked) return stopRepeat();
        if (!repeatActiveRef.current) break;
        const FAST_REPEAT_MS = 100;
        const delay =
          mode === "fire" ? (count++, 0) : count++ < 4 ? 500 : FAST_REPEAT_MS;
        await new Promise((r) => {
          repeatTimeoutRef.current = setTimeout(r, delay);
        });
      }
    })();
  };

  const stopRepeat = () => {
    repeatActiveRef.current = false;
    clearTimeout(repeatDelayRef.current);
    clearTimeout(repeatTimeoutRef.current);
    const pendingLRKey = pendingLRKeyRef.current;
    pendingLRKeyRef.current = null;
    if (tvapprcMode) return;
    // Stop server-side scrubbing. This is a gesture-end cleanup, not a
    // keypress, and must fire even when locked (else the tv keeps scrubbing),
    // so it goes direct rather than through the collision gate.
    fetch(`${TV_TV_URL}/tv/scrub/stop`, { method: "POST" }).catch(() => {});
    if (pendingLRKey) {
      // Short press on left/right — send key on release (through the gate)
      sendKeyThrough(pendingLRKey, `/tv/key/${pendingLRKey}`);
    }
  };

  const applyTvState = (data) => {
    if (!data) return;
    if (data.state !== undefined) setHaState(data.state);
    if (data.mediaTitle !== undefined) setMediaTitle(data.mediaTitle);
  };

  const openChannel = (ch, handlers) => {
    if (channelsRef.current.has(ch)) return;
    channelsRef.current.set(ch, handlers);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ ch, op: "sub" }));
    }
  };

  const closeChannel = (ch) => {
    if (!channelsRef.current.has(ch)) return;
    channelsRef.current.delete(ch);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ ch, op: "unsub" }));
    }
  };

  const connectWs = () => {
    const ws = new WebSocket(TV_SRVR_WS_URL);
    wsRef.current = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ id: 0, fname: "register" }));
      for (const ch of channelsRef.current.keys()) {
        ws.send(JSON.stringify({ ch, op: "sub" }));
      }
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.ch) {
          const handlers = channelsRef.current.get(msg.ch);
          if (msg.op === "snapshot") handlers?.onSnapshot?.(msg.data);
          else if (msg.op === "delta") handlers?.onDelta?.(msg.data);
          return;
        }
        if (msg.id === 0 && msg.notification === "tvMuteState") {
          applyTvState(msg.data);
        } else if (msg.id === 0 && msg.notification === "tvRemoteLock") {
          // The filter text screen is one of the things that can lose a
          // collision, and it sits above the lockout, so it goes away first.
          setShowTvapprcInput(false);
          Keyboard.dismiss();
          setLocked(true);
          setLockInfo(msg.data ?? null);
        } else if (msg.id === 0 && msg.notification === "tvRemoteUnlock") {
          setLocked(false);
          setLockInfo(null);
        } else if (
          msg.id === 0 &&
          msg.notification === "missingEpisodeWarning"
        ) {
          setMissingEpWarning(msg.data);
        } else if (msg.id === 0 && msg.notification === "subtitleMismatch") {
          if (layoutOptionRef.current === "linda") return;
          setSubMismatchWarning(true);
          setShowSubCtrl(true);
          openChannel("embyPlaying", {
            onSnapshot: applySubPlayers,
            onDelta: applySubPlayers,
          });
        } else if (msg.id === 0 && msg.notification === "nowPlaying") {
          const { showName, playing } = msg.data ?? {};
          const s = playing?.[0]?.season ?? null;
          const e = playing?.[0]?.episode ?? null;
          const positionTicks = playing?.[0]?.positionTicks ?? null;
          const runtimeTicks = playing?.[0]?.runtimeTicks ?? null;
          const prev = showPlayingRef.current;
          const episodeChanged =
            prev?.name !== showName || prev?.s !== s || prev?.e !== e;
          if (episodeChanged) setMapRefreshKey((k) => k + 1);
          if (showName) {
            showPlayingRef.current = { name: showName, s, e };
            if (
              positionTicks != null &&
              runtimeTicks != null &&
              runtimeTicks > 0
            ) {
              setPlayProgress({
                position: positionTicks,
                duration: runtimeTicks,
              });
            }
            if (prev?.name !== showName) {
              const playingShow = showsListRef.current.find(
                (sh) => sh.name === showName,
              );
              if (playingShow) {
                followPlayingRef.current = true;
                setFollowPlaying(true);
                setSelectedShow(playingShow);
                setSelectedSE(s != null && e != null ? { s, e } : null);
              }
            } else if (s != null && e != null && followPlayingRef.current) {
              setSelectedSE({ s, e });
            }
          }
        }
      } catch (_) {}
    };
    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      setTimeout(connectWs, 2000);
    };
  };

  const sendTvapprc = (message) => {
    const ws = tvapprcWsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return false;
    ws.send(message);
    return true;
  };

  useEffect(() => {
    let done = false;
    let retryTimer = null;
    let openTimer = null;

    const closeTvapprcInput = () => {
      setShowTvapprcInput(false);
      Keyboard.dismiss();
    };

    const clearTvapprcFilter = () => {
      setTvapprcFilter("");
      Keyboard.dismiss();
    };

    const scheduleRetry = () => {
      if (done || retryTimer) return;
      clearTimeout(openTimer);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        connect();
      }, TVAPPRC_RECONNECT_MS);
    };

    const connect = () => {
      if (done) return;
      const ws = new WebSocket(`ws://${TVAPPRC_HOST}:${TVAPPRC_PORT}`);
      tvapprcWsRef.current = ws;
      ws.onopen = () => clearTimeout(openTimer);
      ws.onerror = scheduleRetry;
      ws.onclose = scheduleRetry;
      ws.onmessage = (e) => {
        if (e.data === MSG_TVAPP_UP) {
          setTvapprcMode(true);
        } else if (e.data === MSG_TVAPP_DOWN) {
          setTvapprcMode(false);
          closeTvapprcInput();
          clearTvapprcFilter();
          setTvapprcListCount(null);
          tvapprcActiveShowRef.current = null;
        } else if (e.data === MSG_CLEAR_FILTER) {
          clearTvapprcFilter();
        } else if (
          typeof e.data === "string" &&
          e.data.startsWith(`${MSG_COUNTS},`)
        ) {
          const n = parseInt(e.data.slice(MSG_COUNTS.length + 1), 10);
          if (!Number.isNaN(n)) setTvapprcListCount(n);
        } else if (
          typeof e.data === "string" &&
          e.data.startsWith(`${MSG_ACTIVE_SHOW},`)
        ) {
          tvapprcActiveShowRef.current = e.data.slice(
            MSG_ACTIVE_SHOW.length + 1,
          );
        }
      };
      openTimer = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) ws.close();
      }, TVAPPRC_CONNECT_TIMEOUT_MS);
    };

    PermissionsAndroid.request(LOCAL_NETWORK_PERMISSION)
      .catch((e) => console.warn("tvapprc network permission failed", e))
      .finally(() => {
        if (!done) connect();
      });

    return () => {
      done = true;
      clearTimeout(retryTimer);
      clearTimeout(openTimer);
      tvapprcWsRef.current?.close();
      tvapprcWsRef.current = null;
    };
  }, []);

  // The filter text screen holds the collision floor for as long as it is up,
  // so srvr is told every time it opens or closes. Sitting on the state rather
  // than on each call site catches every way it closes, and the false this
  // fires on startup clears any entry left behind by an app that died with the
  // screen up.
  useEffect(() => {
    fetch(`${TV_SRVR_HTTP_URL}/api/tvRemoteFilterOpen`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senderId: CLIENT_ID, open: showTvapprcInput }),
    }).catch(() => {});
  }, [showTvapprcInput]);

  useEffect(() => {
    if (!tvapprcMode) {
      tvapprcShowsLoadedRef.current = false;
      return;
    }
    if (tvapprcShowsLoadedRef.current) return;
    tvapprcShowsLoadedRef.current = true;
    (async () => {
      try {
        const res = await fetch(`${TV_SRVR_HTTP_URL}/api/getAllTvdb?hasEmby=0`);
        const data = await res.json();
        const all = Object.entries(data).map(([name, show]) => ({
          ...show,
          name,
        }));
        setTvapprcTotalCount(all.length);
        setTvapprcShows(all.filter((show) => show.inEmby !== false));
      } catch (_) {}
    })();
  }, [tvapprcMode]);

  useEffect(() => {
    console.log("[vol] APP VERSION v23");
    connectWs();
    AsyncStorage.getItem("layoutOption")
      .then((val) => {
        if (val === "mark" || val === "linda") setLayoutOption(val);
      })
      .catch(() => {});

    return () => {
      if (wsRef.current) wsRef.current.onclose = null;
      wsRef.current?.close();
      repeatActiveRef.current = false;
      volActiveRef.current = false;
      pendingLRKeyRef.current = null;
      clearTimeout(repeatDelayRef.current);
      clearTimeout(repeatTimeoutRef.current);
      clearTimeout(holdRef.current);
      clearTimeout(lpRef.current?.debounceTimer ?? lpRef.current?.timer);
      clearTimeout(lpRef.current?.longTimer);
      lpRef.current = null;
      clearTimeout(dbRef.current?.timer);
      dbRef.current = null;
      closeChannel("embyPlaying");
      closeChannel("tvPicture");
      clearTimeout(unlockHoldTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!showShows || showsListLoadedRef.current) return;
    showsListLoadedRef.current = true;
    (async () => {
      try {
        const [res, lastViewedRes, savedName, savedSE] = await Promise.all([
          fetch(`${TV_SRVR_HTTP_URL}/api/getAllTvdb?hasEmby=1`),
          fetch(`${TV_SRVR_HTTP_URL}/api/getLastViewed`),
          AsyncStorage.getItem("selectedShowName").catch(() => null),
          AsyncStorage.getItem("selectedSE").catch(() => null),
        ]);
        const data = await res.json();
        const lastViewedData = await lastViewedRes.json();
        lastViewedRef.current = lastViewedData || {};
        const persistedSE = savedSE ? JSON.parse(savedSE) : null;
        const list = Object.entries(data)
          .map(([name, show]) => ({ ...show, name }))
          .filter((show) => show.inEmby !== false)
          .sort((a, b) => {
            const ka = a.name.replace(/^the /i, "").toLowerCase();
            const kb = b.name.replace(/^the /i, "").toLowerCase();
            return ka < kb ? -1 : ka > kb ? 1 : 0;
          });
        showsListRef.current = list;
        setShowsList(list);
        if (list.length > 0) {
          const persisted = savedName
            ? list.find((s) => s.name === savedName)
            : null;
          showSelectedRef.current = { name: (persisted ?? list[0]).name };
          const lp = showPlayingRef.current;
          // A pending select (from tvapp) picks the show instead of Emby's.
          const playingShow =
            lp && !pendingShowSelectRef.current
              ? list.find((s) => s.name === lp.name)
              : null;
          if (playingShow) {
            setFollowPlaying(true);
            setSelectedShow(playingShow);
            setSelectedSE(
              lp.s != null && lp.e != null ? { s: lp.s, e: lp.e } : null,
            );
          } else {
            setSelectedShow((prev) => prev ?? persisted ?? list[0]);
            setSelectedSE(persistedSE);
          }
        }
      } catch (_) {}
    })();
  }, [showShows]);

  // The shows pane was opened on a named show (tvapp's active one), which can
  // only be selected once the list it belongs to has arrived.
  useEffect(() => {
    const name = pendingShowSelectRef.current;
    if (!showShows || !name || showsList.length === 0) return;
    pendingShowSelectRef.current = null;
    const found = showsList.find((s) => s.name === name);
    // The list tab, the same place the Shows button's hold lands normally.
    if (found) selectShowFromList(found, "List");
  }, [showShows, showsList.length]);

  useEffect(() => {
    if (!selectedSE || !selectedShow) {
      setGuestActors([]);
      setEpisodeInfo(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${TV_SRVR_HTTP_URL}/api/getTmdb`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            showName: selectedShow.name,
            year: null,
            season: selectedSE.s,
            episode: selectedSE.e,
          }),
        });
        const data = await res.json();
        if (cancelled) return;
        const guestList = Array.isArray(data) ? data : (data?.guests ?? []);
        const guests = guestList.map((g) => ({
          personName: g.name,
          name: g.character,
          image: g.profile_path
            ? `https://image.tmdb.org/t/p/w185${g.profile_path}`
            : null,
        }));
        setGuestActors(guests);
        setEpisodeInfo({
          image: data?.image ?? null,
          overview: data?.overview ?? null,
          name: data?.name ?? null,
          aired: data?.aired ?? null,
        });
      } catch (_) {
        if (!cancelled) {
          setGuestActors([]);
          setEpisodeInfo({
            image: null,
            overview: null,
            name: null,
            aired: null,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedShow?.name, selectedSE?.s, selectedSE?.e]);

  useEffect(() => {
    if (
      !showShows ||
      activeTab !== "List" ||
      showsList.length === 0 ||
      !selectedShow ||
      scrollToTopOnOpen
    )
      return;
  }, [
    showShows,
    activeTab,
    selectedShow?.name,
    showsList.length,
    scrollToTopOnOpen,
  ]);

  useEffect(() => {
    if (!selectedShow) return;
    AsyncStorage.setItem("selectedShowName", selectedShow.name).catch(() => {});
  }, [selectedShow?.name]);

  useEffect(() => {
    if (!selectedSE) {
      AsyncStorage.removeItem("selectedSE").catch(() => {});
      return;
    }
    AsyncStorage.setItem("selectedSE", JSON.stringify(selectedSE)).catch(
      () => {},
    );
  }, [selectedSE?.s, selectedSE?.e]);

  useEffect(() => {
    if (!selectedShow) return;
    setShowSeriesMap(null);
    setFlashCell(null);
    setMapImageExpanded(false);
    setActiveTab("Info");
  }, [selectedShow?.name]);

  useEffect(() => {
    if (activeTab !== "Map" || !selectedShow) return;
    setShowSeriesMap(null);
    (async () => {
      try {
        const res = await fetch(
          `${TV_SRVR_HTTP_URL}/api/getSeriesMapFromEmby`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ showName: selectedShow.name }),
          },
        );
        const data = await res.json();
        if (data.success && data.seriesMap) setShowSeriesMap(data.seriesMap);
      } catch (_) {}
    })();
  }, [activeTab, selectedShow?.name, mapRefreshKey]);

  useEffect(() => {
    if (activeTab !== "Stats") return;
    if (!selectedSE || !selectedShow) {
      setEpiStats(null);
      return;
    }
    setEpiStats(null);
    fetch(
      `${TV_SRVR_HTTP_URL}/api/episodeStats?show=${encodeURIComponent(selectedShow.name)}&s=${selectedSE.s}&e=${selectedSE.e}`,
    )
      .then((r) => r.json())
      .then((data) => setEpiStats(data && !data.error ? data : {}))
      .catch(() => setEpiStats({}));
  }, [activeTab, selectedSE?.s, selectedSE?.e]);

  useEffect(() => {
    if (scrollToTopOnOpen && showsFlatListRef.current) {
      setTimeout(() => {
        showsFlatListRef.current?.scrollToOffset({
          offset: 0,
          animated: false,
        });
        setScrollToTopOnOpen(false);
      }, 50);
    }
  }, [scrollToTopOnOpen]);

  const flash = (btn) => {
    setFlashBtn(btn);
    setTimeout(() => setFlashBtn(null), 300);
  };

  // Single choke point for every key/command this app sends — the server's
  // keySendWithChk checks it against the other remote's last press before
  // forwarding to the tv (base "tv") or to srvr's own api (base "srvr", for
  // skip-intro). path=null just arms the collision window without sending
  // anything (the arrow button-down, whose real send is decided later by
  // hold-duration). repeating=true marks a held/scrub send so it wins the
  // floor over another remote's key.
  const sendKeyThrough = async (
    key,
    path,
    { method = "GET", body, fromSubCtrl = false, repeating = false, base = "tv" } = {},
  ) => {
    try {
      const res = await fetch(`${TV_SRVR_HTTP_URL}/api/tvRemoteKey`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key,
          senderId: CLIENT_ID,
          fromSubCtrl,
          repeating,
          base,
          method,
          path,
          body,
        }),
      });
      return await res.json();
    } catch (_) {
      return { blocked: false, result: null };
    }
  };

  const startUnlockHold = () => {
    unlockHoldTimerRef.current = setTimeout(() => {
      setLocked(false);
      setLockInfo(null);
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ fname: "tvRemoteUnlock" }));
      }
    }, 500);
  };

  const stopUnlockHold = () => {
    clearTimeout(unlockHoldTimerRef.current);
  };

  const tvCmd = async (cmd) => {
    if (isOff || isOther) return;
    flash(cmd);
    if (!debounce()) return;
    await sendKeyThrough(cmd, `/tv/${cmd}`);
  };

  const tvKey = async (key) => {
    if (tvapprcMode) {
      flash(key);
      const r = await sendKeyThrough(key, null);
      if (!r.blocked) sendTvapprc(`${CMD_KEY},${key}`);
      return;
    }
    if (isOff || isOther) return;
    if (!debounce()) return;
    flash(key);
    await sendKeyThrough(key, `/tv/key/${key}`);
  };

  const closeTvapprcInput = () => {
    setShowTvapprcInput(false);
    Keyboard.dismiss();
  };

  const updateTvapprcFilter = (text) => {
    setTvapprcFilter(text);
    sendTvapprc(`${CMD_FILTER},${text.trim()}`);
  };

  // tvapprc mode is not set here, only asked for: the bridge's tvapp-up
  // message is the one thing that knows tvapp really came up, and this remote
  // has to be in the mode tvapp is in and no other.
  const openTvapp = () => {
    flash("shows");
    if (!sendTvapprc(CMD_OPEN_TVAPP)) {
      fetch(`${TV_TV_URL}/tv/opentvapp`).catch((e) =>
        console.warn("opentvapp failed", e),
      );
    }
  };

  /**
   * One level out over there, which is not always a close: tvapp takes this
   * same message for its own back key, and while one of its areas has the
   * focus the press only drops that focus. So this leaves tvapprc mode alone
   * and lets the bridge's tvapp-down message end it, which is the only thing
   * that knows tvapp really left.
   */
  const closeTvappToEmby = async (flashKey = "back") => {
    flash(flashKey);
    if ((await sendKeyThrough("back", null)).blocked) return;
    if (!sendTvapprc(CMD_CLOSE_TO_EMBY)) {
      fetch(`${TV_TV_URL}/tv/tvapprc/back`, { method: "POST" }).catch((e) =>
        console.warn("tvapprc back failed", e),
      );
    }
  };

  /**
   * The Shows key while tvapp is up: the same thing it does from Emby, which
   * is to put the tvapp show list up with nothing else in the way -- there it
   * opens tvapp, here it clears whatever tvapp is showing back to that.
   */
  const clearTvappState = (flashKey) => {
    flash(flashKey);
    sendTvapprc(CMD_CLEAR_STATE);
  };

  const startHold = (action) => {
    holdRef.current = setTimeout(action, 400);
  };

  const stopHold = () => {
    clearTimeout(holdRef.current);
  };

  // Shared long-press: debounce → short; 400ms → long
  const lpStart = (shortAction, longAction, holdMs = 400) => {
    const lp = { shortAction, longAction, phase: 0 };
    lpRef.current = lp;
    lp.debounceTimer = setTimeout(() => {
      if (lpRef.current === lp) lp.phase = 1;
    }, 10);
    lp.longTimer = setTimeout(() => {
      if (lpRef.current !== lp) return;
      lpRef.current = null;
      longAction?.();
    }, holdMs);
  };

  // Drops a hold in flight without running either of its actions.
  const lpCancel = () => {
    const lp = lpRef.current;
    if (!lp) return;
    clearTimeout(lp.debounceTimer);
    clearTimeout(lp.longTimer);
    lpRef.current = null;
  };

  const lpStop = () => {
    const lp = lpRef.current;
    if (!lp) return;
    clearTimeout(lp.debounceTimer);
    clearTimeout(lp.longTimer);
    lpRef.current = null;
    if (lp.phase === 0) return;
    if (lp.phase === 1) lp.shortAction?.();
  };

  // A hold button does not send its key until it is released, which can be a
  // couple of seconds after the press, so on its own it would reach the
  // collision gate long after another remote's simultaneous press had left the
  // window -- and not at all when the press is held past its long-press. This
  // arms the window on the press instead, and drops the hold if that press
  // already lost to another remote.
  const armHold = (key, start) => {
    start();
    sendKeyThrough(key, null).then((r) => {
      if (r.blocked) lpCancel();
    });
  };

  // Shared simple debounce: debounce → action, no long-press
  const dbRef = useRef(null);
  const dbStart = (action) => {
    clearTimeout(dbRef.current?.timer);
    const db = { action };
    dbRef.current = db;
    db.timer = setTimeout(() => {
      if (dbRef.current !== db) return;
      dbRef.current = null;
      action?.();
    }, 10);
  };

  const dbStop = () => {
    if (!dbRef.current) return;
    clearTimeout(dbRef.current.timer);
    dbRef.current = null;
  };

  // Checks the TV's actual current input (mediaTitle) rather than the
  // derived `mode`, because `mode` collapses to "tvapprc" whenever tvapprc
  // mode is active — that would otherwise make these buttons always run the
  // power-on sequence instead of recognizing the TV is already on that input.
  const googleBtn = async () => {
    if (mediaTitle === "Smart TV") {
      tvCmd("off");
    } else {
      flash("google");
      sendKeyThrough("googlebtn", `/tv/googlebtn`);
    }
  };

  const fireBtn = async () => {
    if (mediaTitle === "Fire TV Stick" || mediaTitle === "HDMI 2") {
      tvCmd("off");
    } else {
      flash("fire");
      sendKeyThrough("firebtn", `/tv/firebtn`);
    }
  };

  const startAppsHold = () => {
    lpStart(
      () => {
        flash("fire");
        setShowStreamers(true);
      },
      () => {
        flash("fire");
        fireBtn();
      },
    );
  };

  const stopAppsHold = () => lpStop();

  const startVolDownHold = () => {
    armHold("vold", () =>
      lpStart(
        async () => {
          if (isOff || isOther) return;
          flash("vold");
          await sendKeyThrough("vold", `/tv/vol/down`);
        },
        () => {
          flash("vold");
          openPicCtrl();
        },
      ),
    );
  };

  const stopVolDownHold = () => lpStop();

  const openPicCtrl = () => {
    if (layoutOptionRef.current === "linda") return;
    setShowPicCtrl(true);
    openChannel("tvPicture", {
      onSnapshot: applyPicSettings,
      onDelta: applyPicSettings,
    });
  };

  const startVolUpHold = () => {
    armHold("volu", () =>
      lpStart(
        async () => {
          if (isOff || isOther) return;
          flash("volu");
          await sendKeyThrough("volu", `/tv/vol/up`);
        },
        () => {
          flash("volu");
          openSubCtrl();
        },
      ),
    );
  };

  const stopVolUpHold = () => lpStop();

  const closePicCtrl = () => {
    closeChannel("tvPicture");
    setShowPicCtrl(false);
  };

  const applyPicSettings = (data) => {
    if (!data?.ok) return;
    setPicSettings(data.settings);
    setPicInputs((prev) => {
      const next = { ...prev };
      for (const s of data.settings) {
        if (picCommitTimersRef.current[s.target]) continue; // actively typing
        next[s.target] = { raw: s.value, resetNext: true };
      }
      picInputsRef.current = next;
      return next;
    });
  };

  const fetchPicSettings = async () => {
    try {
      const data = await fetch(`${TV_TV_URL}/tv/picture`).then((r) => r.json());
      applyPicSettings(data);
    } catch (_) {}
  };

  // long option names push the arrow buttons off the edge of the screen
  const picValText = (v) => {
    const s = String(v);
    if (s.length <= PIC_VAL_MAX_CHARS) return s;
    return `${s.slice(0, PIC_VAL_EDGE_CHARS)}...${s.slice(-PIC_VAL_EDGE_CHARS)}`;
  };

  const picNextValue = (setting, dir) => {
    if (setting.type === "range") {
      const v = Number(setting.value) + dir * setting.step;
      if (v < setting.min || v > setting.max) return null;
      return String(v);
    } else {
      const idx = setting.options.indexOf(setting.value);
      if (idx < 0)
        return dir > 0
          ? setting.options[0]
          : setting.options[setting.options.length - 1];
      const next = idx + dir;
      if (next < 0 || next >= setting.options.length) return null;
      return setting.options[next];
    }
  };

  const picAdjust = async (setting, dir) => {
    const newVal = picNextValue(setting, dir);
    if (newVal === null) return;
    const upd = {
      ...picInputsRef.current,
      [setting.target]: { raw: newVal, resetNext: true },
    };
    picInputsRef.current = upd;
    setPicInputs(upd);
    try {
      await fetch(`${TV_TV_URL}/tv/picture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: setting.target, value: newVal }),
      });
    } catch (_) {}
    await fetchPicSettings();
  };

  const schedulePicCommit = (setting) => {
    clearTimeout(picCommitTimersRef.current[setting.target]);
    picCommitTimersRef.current[setting.target] = setTimeout(
      () => commitPicInput(setting),
      750,
    );
  };

  const commitPicInput = async (setting) => {
    clearTimeout(picCommitTimersRef.current[setting.target]);
    picCommitTimersRef.current[setting.target] = null;
    const inp = picInputsRef.current[setting.target];
    if (!inp || inp.resetNext) return; // nothing was typed
    const num = Number(inp.raw);
    if (
      inp.raw === "" ||
      isNaN(num) ||
      num < setting.min ||
      num > setting.max
    ) {
      // invalid — revert to last server value
      await fetchPicSettings();
      return;
    }
    const newVal = String(Math.round(num));
    try {
      await fetch(`${TV_TV_URL}/tv/picture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: setting.target, value: newVal }),
      });
    } catch (_) {}
    await fetchPicSettings();
  };

  const picInputChange = (setting, text) => {
    const inp = picInputsRef.current[setting.target];
    // When resetNext, RN gave us oldRaw+newChar — extract just the new part
    const newRaw = inp?.resetNext ? text.slice((inp.raw ?? "").length) : text;
    const upd = {
      ...picInputsRef.current,
      [setting.target]: { raw: newRaw, resetNext: false },
    };
    picInputsRef.current = upd;
    setPicInputs(upd);
    schedulePicCommit(setting);
  };

  const startBackPress = () =>
    dbStart(() => {
      if (tvapprcMode) closeTvappToEmby();
      else tvKey("back");
    });

  const stopBackPress = () => dbStop();

  const showsHoldRef = useRef(null);
  const showsHoldFiredRef = useRef(false);

  // Picking a show in the shows pane: the list row's tap and the tvapp
  // selection both land here, on the show's first unwatched episode.
  const selectShowFromList = async (item, tab = "Info") => {
    showSelectedRef.current = { name: item.name };
    setShowSearch("");
    setSelectedShow(item);
    followPlayingRef.current = false;
    setFollowPlaying(false);
    try {
      const res = await fetch(`${TV_SRVR_HTTP_URL}/api/getSeriesMapFromEmby`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ showName: item.name }),
      });
      const data = await res.json();
      let firstUnwatched = null;
      if (data.success && data.seriesMap) {
        for (const [seasonNum, episodes] of data.seriesMap) {
          for (const [episodeNum, epiObj] of episodes) {
            if (!epiObj.played && !epiObj.unaired) {
              firstUnwatched = { s: seasonNum, e: episodeNum };
              break;
            }
          }
          if (firstUnwatched) break;
        }
      }
      setSelectedSE(firstUnwatched);
    } catch (_) {
      setSelectedSE(null);
    }
    setActiveTab(tab);
  };

  const openShowsPane = () => {
    flash("shows");
    setActiveTab("List");
    setSortOrder("viewed");
    setFollowPlaying(true);
    setScrollToTopOnOpen(true);
    setShowShows(true);
  };

  // flashKey is which of the two Shows cells was the one pressed, so only that
  // one lights up while tvapp is up.
  const startShowsHold = (flashKey) => {
    // Nothing on the hold while tvapp is up: the key is the one way back to a
    // clean tvapp screen, so it answers the same however long it is held.
    if (tvapprcMode) {
      dbStart(() => clearTvappState(flashKey));
      return;
    }
    lpStart(openTvapp, openShowsPane);
  };

  const stopShowsHold = () => {
    dbStop();
    lpStop();
  };

  // Long-press skip toggles the playing episode between 2160 and 1080.
  const toggleResolution = async () => {
    if (isOff || isOther) return;
    if (!showPlayingRef.current) return; // only while a video is playing
    flash("skip");
    await sendKeyThrough("resToggle", `/tv/toggleres`, {
      method: "POST",
      body: {},
    });
  };

  const startSkipHold = () => {
    const pressedAt = Date.now();
    armHold("skip", () =>
      lpStart(
        () => {
          // short press → skip intro (a srvr feature, not a tv/ha command)
          flash("skip");
          sendKeyThrough("skip", `/api/skipIntro`, {
            method: "POST",
            body: { pressedAt },
            base: "srvr",
          });
        },
        () => {
          // long press → toggle resolution
          toggleResolution();
        },
      ),
    );
  };

  const stopSkipHold = () => {
    dbStop();
    lpStop();
  };

  const toggleLayoutOption = async () => {
    const next = layoutOption === "mark" ? "linda" : "mark";
    setLayoutOption(next);
    Alert.alert(next === "linda" ? "Linda mode" : "Mark mode");
    try {
      await AsyncStorage.setItem("layoutOption", next);
    } catch (_) {}
  };

  // The tvapprc row's three focus keys: one message per click and no repeat,
  // since each one only says which of tvapp's areas the keys talk to next.
  const startTvapprcFocusHold = (key) => {
    dbStart(async () => {
      flash(key);
      const r = await sendKeyThrough(key, null);
      if (!r.blocked) sendTvapprc(`${CMD_KEY},${key}`);
    });
  };

  const stopTvapprcFocusHold = () => {
    dbStop();
  };

  const startHomeHold = () => {
    armHold("home", () =>
      lpStart(() => tvKey("home"), toggleLayoutOption, 2000),
    );
  };

  const stopHomeHold = () => {
    dbStop();
    lpStop();
  };

  const startOkHold = () => {
    stopRepeat();
    dbStart(() => tvKey("ok"));
  };
  const stopOkHold = () => {
    dbStop();
    lpStop();
  };

  const startMuteHold = () => dbStart(() => tvCmd("mute"));
  const stopMuteHold = () => dbStop();

  const fetchSubPlayers = async () => {
    try {
      const data = await fetch(`${TV_TV_URL}/tv/emby/playing`).then((r) =>
        r.json(),
      );
      applySubPlayers(data);
    } catch (_) {}
  };

  const applySubPlayers = (data) => {
    if (data?.ok) {
      const pending = subPendingRef.current;
      let players = data.playing;
      if (pending) {
        players = players.map((p) => {
          if ((p.deviceName || p.sessionId) === pending.deviceName) {
            if (p.subtitleStreamIndex === pending.index) {
              subPendingRef.current = null; // Emby confirmed
            } else {
              return { ...p, subtitleStreamIndex: pending.index }; // keep optimistic
            }
          }
          return p;
        });
      }
      setSubPlayers(players);
      subPlayersRef.current = players;
      setSubDeviceName((prev) => {
        const hasCurrentPlayer =
          prev && players.find((p) => (p.deviceName || p.sessionId) === prev);
        if (!hasCurrentPlayer) {
          const lrtv = players.find((p) => p.deviceName === "Living Room TV");
          if (lrtv) return "Living Room TV";
        }
        return prev;
      });
    }
  };

  const openSubCtrl = async () => {
    if (mode !== "google" && mode !== "fire") return;
    if (layoutOptionRef.current === "linda") return;
    setShowSubCtrl(true);
    openChannel("embyPlaying", {
      onSnapshot: applySubPlayers,
      onDelta: applySubPlayers,
    });
  };

  const startEmbyHold = () => {
    if (tvapprcMode) {
      // The Text key: the filter input screen is this remote's own, so it just
      // opens here. tvapp hears about it only as the text typed into it.
      dbStart(() => {
        flash("text");
        setShowTvapprcInput(true);
      });
      return;
    }
    armHold("emby", () =>
      lpStart(
        () => tvCmd("emby"),
        () => {
          flash("emby");
          setShowStreamers(true);
        },
      ),
    );
  };

  const stopEmbyHold = () => {
    dbStop();
    lpStop();
  };

  const subTypeChar = (type) => {
    if (type === "pgs") return "*";
    if (type === "sdh") return "H";
    if (type === "embedded") return "T";
    if (type === "forced") return "F";
    if (type === "asr") return "+";
    if (type === "mbs") return ">";
    if (type === "opn") return "V";
    if (type === "srt") return "S";
    return "S";
  };

  const subShortLabel = (label) =>
    (label || "").replace(/\bdefault\b/gi, "Def");

  const subShortDevice = (name) => {
    if (!name) return name;
    if (name === "Living Room TV") return "TV";
    if (name === "Firefox Browser") return "Firefox";
    if (name === "Firefox Windows") return "Firefox";
    if (name === "Google Chrome Windows") return "Chrome";
    if (name === "Galaxy Tab S8") return "Tablet";
    return name;
  };

  const subCyclePlayer = () => {
    if (subPlayers.length === 0) return;
    const curIdx = subPlayers.findIndex(
      (p) => (p.deviceName || p.sessionId) === subDeviceName,
    );
    const nextIdx = (curIdx + 1) % subPlayers.length;
    setSubDeviceName(
      subPlayers[nextIdx].deviceName || subPlayers[nextIdx].sessionId,
    );
  };

  const subClose = () => {
    closeChannel("embyPlaying");
    setShowSubCtrl(false);
    setSubMismatchWarning(false);
  };

  const subChoose = async () => {
    const player = subPlayers.find(
      (p) => (p.deviceName || p.sessionId) === subDeviceName,
    );
    if (!player || !player.episodeCode) return;
    try {
      await fetch(`${TV_SRVR_HTTP_URL}/api/chksrt/set-preferred`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          showName: player.showName,
          episodeCode: player.episodeCode,
          embStreamIndex: player.subtitleStreamIndex,
        }),
      });
    } catch (_) {}
    await fetchSubPlayers();
  };

  const subSelectTrack = async (index) => {
    const player = subPlayers.find(
      (p) => (p.deviceName || p.sessionId) === subDeviceName,
    );
    if (!player) return;
    if (subNavigatingRef.current) return;
    const gen = ++subGenRef.current;
    subPendingRef.current = { deviceName: subDeviceName, index };
    setSubPlayers((prev) => {
      const idx = prev.findIndex(
        (p) => (p.deviceName || p.sessionId) === subDeviceName,
      );
      if (idx < 0) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], subtitleStreamIndex: index };
      return next;
    });
    const { blocked, result } = await sendKeyThrough(
      `subtitle:${index}`,
      `/tv/emby/subtitle`,
      {
        method: "POST",
        body: { sessionId: player.sessionId, index },
        fromSubCtrl: true,
      },
    );
    const waitMs = blocked ? 0 : (result?.waitMs ?? 4000);
    const navMs = blocked ? 0 : (result?.navMs ?? waitMs);
    if (subGenRef.current !== gen) return;
    if (navMs > 0) {
      subNavigatingRef.current = true;
    }
    await new Promise((r) => setTimeout(r, navMs));
    subNavigatingRef.current = false;
    if (subGenRef.current !== gen) return;
    const deadline = Date.now() + (waitMs - navMs);
    while (subPendingRef.current && Date.now() < deadline) {
      await fetchSubPlayers();
      if (subGenRef.current !== gen) return;
      if (!subPendingRef.current) break;
      await new Promise((r) => setTimeout(r, 500));
      if (subGenRef.current !== gen) return;
    }
    subPendingRef.current = null;
    await fetchSubPlayers();
  };

  const kybdSendText = async () => {};
  const kybdSendKeyevent = async (code) => {};

  const kybdSendHaKey = async (key) => {};

  const openApp = async (svc) => {
    if (isOff) return;
    setTimeout(() => setShowStreamers(false), 1000);
    await sendKeyThrough(
      `openapp:${svc.name}`,
      `/tv/openapp?uri=${encodeURIComponent(svc.uri)}`,
    );
  };

  const isOff =
    !tvapprcMode &&
    (!haState ||
      haState === "off" ||
      haState === "unavailable" ||
      haState === "unknown");

  const mode = (() => {
    if (tvapprcMode) return "tvapprc";
    if (isOff) return "off";
    if (mediaTitle === "Smart TV") return "google";
    if (mediaTitle === "TV") return "tv";
    if (mediaTitle === "Fire TV Stick" || mediaTitle === "HDMI 2")
      return "fire";
    return "other";
  })();

  const isOther = mode === "other";
  // Streaming-app list is keyed by the TV's actual input, so it must ignore
  // the tvapprcMode collapse above -- otherwise it looks up "tvapprc" in
  // services.json (which only has "google"/"fire") and comes back empty.
  const servicesMode =
    mediaTitle === "Smart TV"
      ? "google"
      : mediaTitle === "Fire TV Stick" || mediaTitle === "HDMI 2"
        ? "fire"
        : mode;
  const services = allServices[servicesMode] ?? [];
  // Background color helpers (mirror Vue cellStyle / computed props)
  const cellBg = (defaultBg, key) => (flashBtn === key ? "orange" : defaultBg);

  const muteBg = flashBtn === "mute" ? "orange" : "lightgreen";

  const offBg = flashBtn === "off" ? "orange" : isOff ? "lightblue" : "white";

  const modeBg = (m) => {
    if (flashBtn === m) return "orange";
    if (m === "google" && mode === "tv") return "#ffb3c1";
    return mode === m ? "lightblue" : "white";
  };

  // The tvapprc-only top row, which pushes the ordinary five rows down one.
  // Each key hands the focus to one of tvapp's areas.
  const tvapprcFocusRow = [
    { key: CMD_KEY_SORT, label: "Sort" },
    { key: CMD_KEY_FILTER, label: "Filter" },
    { key: CMD_KEY_INFO, label: "Info" },
  ].map(({ key, label }) => ({
    key,
    label,
    smallText: true,
    bg: () => cellBg("white", key),
    onPress: () => {},
    onPressIn: () => startTvapprcFocusHold(key),
    onPressOut: () => stopTvapprcFocusHold(),
  }));

  // Button definitions — matches tvpane.vue grid order (row-major, 3 cols x 5 rows)
  const buttons = [
    ...(tvapprcMode ? tvapprcFocusRow : []),
    // Row 1: back, up, home
    {
      key: "back",
      label: "↩",
      largeText: true,
      bg: () => cellBg("white", "back"),
      onPress: () => {},
      onPressIn: () => startBackPress(),
      onPressOut: () => stopBackPress(),
    },
    {
      key: "up",
      label: "▲",
      bg: () => cellBg("#f5e642", "up"),
      onPress: () => {},
      onPressIn: () => startRepeat("up"),
      onPressOut: stopRepeat,
    },
    // A second Shows key while tvapp is up -- the same button as the one in the
    // bottom row, within reach of the thumb that is on the arrows. Sort, which
    // used to be here, has moved to the row above.
    tvapprcMode
      ? {
          key: "shows2",
          label: "Shows",
          smallText: true,
          // Plain white, unlike the bottom row's, which is lit to say tvapprc
          // mode is on: one such lamp on the screen is enough. It flashes under
          // its own name so pressing it does not light the other one too.
          bg: () => cellBg("white", "shows2"),
          onPress: () => {},
          onPressIn: () => startShowsHold("shows2"),
          onPressOut: () => stopShowsHold(),
        }
      : {
          key: "home",
          label: null,
          icon: <MaterialIcons name="home" size={42} color="black" />,
          bg: () => cellBg("white", "home"),
          onPress: () => {},
          onPressIn: () => startHomeHold(),
          onPressOut: () => stopHomeHold(),
        },
    // Row 2: left, ok, right
    {
      key: "left",
      label: "◀",
      bg: () => cellBg("#f5e642", "left"),
      onPress: () => {},
      onPressIn: () => startRepeat("left"),
      onPressOut: stopRepeat,
    },
    {
      key: "ok",
      label: "OK",
      bg: () => cellBg("lightgreen", "ok"),
      onPress: () => {},
      onPressIn: () => startOkHold(),
      onPressOut: () => stopOkHold(),
    },
    {
      key: "right",
      label: "▶",
      bg: () => cellBg("#f5e642", "right"),
      onPress: () => {},
      onPressIn: () => startRepeat("right"),
      onPressOut: stopRepeat,
    },
    // Row 3: emby, down, skip
    {
      key: tvapprcMode ? "text" : "emby",
      label: tvapprcMode ? "Search" : "Emby",
      smallText: true,
      bg: () => cellBg("white", tvapprcMode ? "text" : "emby"),
      onPress: () => {},
      onPressIn: () => startEmbyHold(),
      onPressOut: () => stopEmbyHold(),
    },
    {
      key: "down",
      label: "▼",
      bg: () => cellBg("#f5e642", "down"),
      onPress: () => {},
      onPressIn: () => startRepeat("down"),
      onPressOut: stopRepeat,
    },
    // Blank and dead while tvapp is up: Info has moved to the row above.
    {
      key: "skip",
      label: tvapprcMode ? null : "Skip",
      smallText: true,
      bg: () => cellBg("white", "skip"),
      onPress: () => {},
      onPressIn: tvapprcMode ? undefined : () => startSkipHold(),
      onPressOut: tvapprcMode ? undefined : () => stopSkipHold(),
    },
    // Row 4: vol-, vol+, mute
    {
      key: "vold",
      label: "Vol-",
      smallText: true,
      bg: () => cellBg("lightgreen", "vold"),
      onPress: () => {},
      onPressIn: () => startVolDownHold(),
      onPressOut: () => stopVolDownHold(),
    },
    {
      key: "volu",
      label: "Vol+",
      smallText: true,
      bg: () => cellBg("lightgreen", "volu"),
      onPress: () => {},
      onPressIn: () => startVolUpHold(),
      onPressOut: () => stopVolUpHold(),
    },
    {
      key: "mute",
      label: "Mute",
      smallText: true,
      bg: () => muteBg,
      onPress: () => {},
      onPressIn: () => startMuteHold(),
      onPressOut: () => stopMuteHold(),
    },
    // Row 5: shows, apps, google
    {
      key: "shows",
      label: "Shows",
      smallText: true,
      bg: () =>
        flashBtn === "shows" ? "orange" : tvapprcMode ? "lightblue" : "white",
      onPress: () => {},
      onPressIn: () => startShowsHold("shows"),
      onPressOut: () => stopShowsHold(),
    },
    {
      key: "stream",
      label: "Apps",
      smallText: true,
      bg: () => modeBg("fire"),
      onPress: () => {},
      onPressIn: () => startAppsHold(),
      onPressOut: () => stopAppsHold(),
    },
    {
      key: "google",
      label: "Google",
      tinyText: true,
      bg: () => modeBg("google"),
      onPress: () => {},
      onPressIn: () => startHold(() => googleBtn()),
      onPressOut: stopHold,
    },
  ];

  if (showSubCtrl) {
    const currentPlayer =
      subPlayers.find((p) => (p.deviceName || p.sessionId) === subDeviceName) ??
      null;
    return (
      <View style={styles.container}>
        <StatusBar hidden />
        <View style={subCtrlStyles.header}>
          <TouchableOpacity onPress={subCyclePlayer} style={{ flex: 1 }}>
            <Text style={subCtrlStyles.showName} numberOfLines={1}>
              {(() => {
                if (!currentPlayer)
                  return subDeviceName ? "---" : "No video playing";
                let base = currentPlayer.episodeCode
                  ? `${currentPlayer.showName} ${currentPlayer.episodeCode}`
                  : currentPlayer.showName;
                if (currentPlayer.deviceName)
                  base += ` (${subShortDevice(currentPlayer.deviceName)})`;
                return base;
              })()}
            </Text>
          </TouchableOpacity>
        </View>
        {subMismatchWarning && (
          <Text
            style={{
              color: "red",
              fontWeight: "bold",
              textAlign: "center",
              paddingVertical: 8,
              fontSize: fs(36),
              backgroundColor: "#fff",
            }}
          >
            Subtitles don't match
          </Text>
        )}
        <ScrollView style={subCtrlStyles.list}>
          {!currentPlayer ? (
            <Text style={subCtrlStyles.noVideo}>No video playing</Text>
          ) : currentPlayer.deviceName !== "Living Room TV" ? (
            <Text style={subCtrlStyles.noVideo}>
              Only the Living Room TV is supported
            </Text>
          ) : (
            <>
              <TouchableOpacity
                onPress={() => subSelectTrack(-1)}
                style={[
                  subCtrlStyles.card,
                  {
                    backgroundColor:
                      currentPlayer.subtitleStreamIndex === -1
                        ? "#d0e8ff"
                        : "#fff",
                  },
                ]}
              >
                <Text
                  style={[
                    subCtrlStyles.cardText,
                    currentPlayer.subtitleStreamIndex === -1 &&
                      subCtrlStyles.cardTextSelected,
                  ]}
                >
                  None
                </Text>
              </TouchableOpacity>
              {currentPlayer.subtitles.map((sub) => (
                <TouchableOpacity
                  key={sub.index}
                  onPress={() => subSelectTrack(sub.index)}
                  style={[
                    subCtrlStyles.card,
                    {
                      backgroundColor:
                        currentPlayer.subtitleStreamIndex === sub.index
                          ? "#d0e8ff"
                          : "#fff",
                    },
                  ]}
                >
                  <Text
                    style={[
                      subCtrlStyles.cardText,
                      currentPlayer.subtitleStreamIndex === sub.index &&
                        subCtrlStyles.cardTextSelected,
                    ]}
                  >
                    {subTypeChar(sub.type)}: {subShortLabel(sub.label)}
                    {sub.index === currentPlayer.chosenSubIndex
                      ? " (chosen)"
                      : ""}
                  </Text>
                </TouchableOpacity>
              ))}
            </>
          )}
        </ScrollView>
        <View style={{ flexDirection: "row" }}>
          <TouchableOpacity
            onPress={subChoose}
            disabled={
              !currentPlayer || currentPlayer.deviceName !== "Living Room TV"
            }
            style={[
              subCtrlStyles.closeBtn,
              { flex: 1 },
              (!currentPlayer ||
                currentPlayer.deviceName !== "Living Room TV") && {
                opacity: 0.35,
              },
            ]}
            activeOpacity={0.7}
          >
            <Text style={subCtrlStyles.closeBtnText}>Choose</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={subClose}
            style={[subCtrlStyles.closeBtn, { flex: 1 }]}
            activeOpacity={0.7}
          >
            <Text style={subCtrlStyles.closeBtnText}>Close</Text>
          </TouchableOpacity>
        </View>
        {locked && (
          <View style={lockStyles.overlay}>
            <Text style={lockStyles.title}>Remote Collision</Text>
            <View
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                padding: 16,
              }}
            >
              <Text style={lockStyles.message}>
                A remote collision has been detected. The remote has been
                locked. Press and hold unlock button to continue.
              </Text>
            </View>
            {lockInfo && (
              <View style={lockStyles.keyStatus}>
                <Text style={lockStyles.keyStatusText}>
                  {keyLabel(lockInfo.sentKey)} sent
                </Text>
                <Text style={lockStyles.keyStatusText}>
                  {keyLabel(lockInfo.blockedKey)} ignored
                </Text>
              </View>
            )}
            <TouchableOpacity
              onPressIn={startUnlockHold}
              onPressOut={stopUnlockHold}
              style={lockStyles.unlockBtn}
              activeOpacity={1}
            >
              <Text style={lockStyles.unlockBtnText}>Unlock</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  }

  if (showShows) {
    const show = selectedShow;
    const seLabel = selectedSE
      ? ` (S${String(selectedSE.s).padStart(2, "0")}E${String(selectedSE.e).padStart(2, "0")})`
      : "";

    const handleHeaderPress = () => {
      if (followPlaying) {
        // Toggle off: go to saved selected show
        const sel = showSelectedRef.current;
        if (!sel) return;
        const selShow = showsListRef.current.find((s) => s.name === sel.name);
        if (!selShow) return;
        setFollowPlaying(false);
        setSelectedShow(selShow);
      } else {
        // Toggle on: go to playing show
        const lp = showPlayingRef.current;
        if (!lp) return;
        const playingShow = showsListRef.current.find(
          (s) => s.name === lp.name,
        );
        if (!playingShow) return;
        followPlayingRef.current = true;
        setFollowPlaying(true);
        setSelectedShow(playingShow);
        setSelectedSE(
          lp.s != null && lp.e != null ? { s: lp.s, e: lp.e } : null,
        );
      }
      setActiveTab("Info");
    };

    const qualityChar = (q) => {
      if (!q) return "0";
      return String(Math.round((Math.log2(q) - 8) * 3));
    };

    const getCellBg = (cell) => {
      if (!cell || cell.avail) return { backgroundColor: "white" };
      return { backgroundColor: "#fcc" };
    };

    const getCellText = (cell, s, ep) => {
      if (!cell) return "";
      const w = cell.unaired ? "u" : cell.played ? "w" : "";
      if (cell.avail) {
        return w + qualityChar(cell.quality);
      }
      if (cell.unaired) return "u";
      return w + "-";
    };

    const getSortedShows = (shows) => {
      return [...shows].sort((a, b) => {
        if (sortOrder === "alpha") {
          const ka = a.name.replace(/^the\s*/i, "").toLowerCase();
          const kb = b.name.replace(/^the\s*/i, "").toLowerCase();
          return ka < kb ? -1 : ka > kb ? 1 : 0;
        } else if (sortOrder === "viewed") {
          const lastViewedA = getViewedSortValue(a, lastViewedRef.current);
          const lastViewedB = getViewedSortValue(b, lastViewedRef.current);
          return lastViewedB > lastViewedA
            ? 1
            : lastViewedB < lastViewedA
              ? -1
              : 0;
        } else if (sortOrder === "added") {
          const dateA = a.dateCreated || "";
          const dateB = b.dateCreated || "";
          // Pad short dates for proper comparison
          const paddedA = dateA.length > 10 ? dateA : dateA + " 00:00:00.000";
          const paddedB = dateB.length > 10 ? dateB : dateB + " 00:00:00.000";
          return paddedB > paddedA ? 1 : paddedB < paddedA ? -1 : 0; // Most recent first
        }
        return 0;
      });
    };

    const renderListContent = () => {
      const sorted = getSortedShows(showsList);
      const filtered = showSearch
        ? sorted.filter((s) =>
            s.name.toLowerCase().includes(showSearch.toLowerCase()),
          )
        : sorted;
      const initialIdx = showSearch
        ? 0
        : Math.max(
            0,
            sorted.findIndex((s) => s.name === show?.name),
          );
      return (
        <FlatList
          ref={showsFlatListRef}
          data={filtered}
          keyExtractor={(item) => item.name}
          getItemLayout={(_, index) => ({
            length: 52,
            offset: 52 * index,
            index,
          })}
          initialScrollIndex={initialIdx}
          onScrollToIndexFailed={() => {}}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => selectShowFromList(item)}
              style={[
                showsStyles.listRow,
                item.name === show?.name && showsStyles.listRowSelected,
              ]}
            >
              <Text style={showsStyles.listRowName} numberOfLines={1}>
                {item.name}
              </Text>
              <View style={showsStyles.listRowRight}>
                {item.notReady === false && (
                  <Text style={showsStyles.listRowPlus}>+</Text>
                )}
                {item.waitStr ? (
                  <Text style={showsStyles.listRowWait}>{item.waitStr}</Text>
                ) : null}
              </View>
            </TouchableOpacity>
          )}
        />
      );
    };

    const renderInfoContent = () => {
      if (!show) return null;
      const posterUri = show.image ?? show.imageUrl ?? null;
      const firstAired = show.firstAired ?? "";
      const lastAired = show.lastAired ?? "";
      const network = show.originalNetwork ?? "";
      const genres = Array.isArray(show.genres) ? show.genres.join(", ") : "";
      const status = show.status ?? "";
      const runtime = show.averageRuntime ? `${show.averageRuntime} Mins` : "";
      const seasonCount = show.seasonCount ?? 0;
      const seasons =
        seasonCount === 1
          ? "1 Season"
          : seasonCount > 1
            ? `${seasonCount} Seasons`
            : "";
      const episodeCount = show.episodeCount ?? 0;
      const watchedCount = show.watchedCount ?? null;
      let watchedTxt = "";
      if (episodeCount > 0 && watchedCount !== null) {
        watchedTxt =
          watchedCount === episodeCount
            ? `all ${episodeCount} episodes`
            : `${watchedCount} of ${episodeCount}`;
      }
      const cntryLang = [show.originalCountry, show.originalLanguage]
        .filter(Boolean)
        .join(" / ");
      const overview = show.overview ?? show.description ?? "";
      return (
        <View style={{ flex: 1 }}>
          <View style={showsStyles.infoTop}>
            <View
              style={posterExpanded ? { width: "100%" } : showsStyles.posterBox}
            >
              {posterUri ? (
                <TouchableOpacity
                  onPress={() => setPosterExpanded((v) => !v)}
                  activeOpacity={0.85}
                >
                  <Image
                    source={{ uri: posterUri }}
                    style={showsStyles.posterImg}
                    resizeMode="cover"
                  />
                </TouchableOpacity>
              ) : (
                <View style={showsStyles.posterPlaceholder}>
                  <Text style={showsStyles.posterPlaceholderText}>
                    No Image
                  </Text>
                </View>
              )}
            </View>
            {!posterExpanded && (
              <TouchableOpacity
                style={showsStyles.infoBox}
                activeOpacity={show.imdbUrl ? 0.6 : 1}
                onPress={() => show.imdbUrl && Linking.openURL(show.imdbUrl)}
              >
                {firstAired ? (
                  <Text style={showsStyles.infoField}>{firstAired}</Text>
                ) : null}
                {lastAired ? (
                  <Text style={showsStyles.infoField}>{lastAired}</Text>
                ) : null}
                {status ? (
                  <Text style={showsStyles.infoField}>{status}</Text>
                ) : null}
                {cntryLang ? (
                  <Text style={showsStyles.infoField}>
                    {cntryLang.toUpperCase()}
                  </Text>
                ) : null}
                {network ? (
                  <Text style={showsStyles.infoField}>{network}</Text>
                ) : null}
                {genres ? (
                  <Text style={showsStyles.infoField}>{genres}</Text>
                ) : null}
                {runtime ? (
                  <Text style={showsStyles.infoField}>{runtime}</Text>
                ) : null}
                {seasons ? (
                  <Text style={showsStyles.infoField}>{seasons}</Text>
                ) : null}
                {watchedTxt ? (
                  <Text style={showsStyles.infoField}>
                    Watched {watchedTxt}
                  </Text>
                ) : null}
              </TouchableOpacity>
            )}
          </View>
          {overview ? (
            <ScrollView style={{ flex: 1 }}>
              <Text style={showsStyles.overviewText}>{overview}</Text>
            </ScrollView>
          ) : null}
        </View>
      );
    };

    const renderMapContent = () => {
      if (!showSeriesMap)
        return (
          <View
            style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
          >
            <Text>Loading...</Text>
          </View>
        );
      const sm = buildSeriesMap(showSeriesMap);
      if (!sm) return null;
      const seasons = Object.keys(sm)
        .map(Number)
        .sort((a, b) => a - b);
      const maxEp = seasons.reduce((max, s) => {
        const epNums = Object.keys(sm[s]).map(Number);
        return Math.max(max, ...epNums);
      }, 0);
      const episodes = Array.from({ length: maxEp }, (_, i) => i + 1);
      const COL_W = 47;
      const ROW_H = 36;

      return (
        <View style={{ flex: 1 }}>
          {/* Fixed season header row */}
          <View style={{ flexDirection: "row" }}>
            <View style={{ width: 40, height: ROW_H }} />
            <ScrollView
              horizontal
              ref={mapHeaderScrollRef}
              scrollEnabled={false}
              showsHorizontalScrollIndicator={false}
            >
              <View style={{ flexDirection: "row", height: ROW_H }}>
                {seasons.map((s) => (
                  <View
                    key={s}
                    style={{
                      width: COL_W,
                      justifyContent: "center",
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ fontSize: fs(18), fontWeight: "bold" }}>
                      S{s}
                    </Text>
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>
          {/* Scrollable body */}
          <ScrollView>
            <View style={{ flexDirection: "row" }}>
              <View style={{ width: 40 }}>
                {episodes.map((ep) => (
                  <View
                    key={ep}
                    style={{
                      height: ROW_H,
                      justifyContent: "center",
                      alignItems: "center",
                    }}
                  >
                    <Text
                      style={{
                        fontSize: fs(18),
                        fontWeight: "bold",
                        color: "#555",
                      }}
                    >
                      {ep}
                    </Text>
                  </View>
                ))}
              </View>
              <ScrollView
                horizontal
                nestedScrollEnabled
                showsHorizontalScrollIndicator={false}
                scrollEventThrottle={16}
                onScroll={(e) =>
                  mapHeaderScrollRef.current?.scrollTo({
                    x: e.nativeEvent.contentOffset.x,
                    animated: false,
                  })
                }
              >
                <View>
                  {episodes.map((ep) => (
                    <View
                      key={ep}
                      style={{ flexDirection: "row", height: ROW_H }}
                    >
                      {seasons.map((s) => {
                        const cell = sm[s]?.[ep];
                        const isSelected =
                          selectedSE?.s === s && selectedSE?.e === ep;
                        return (
                          <TouchableOpacity
                            key={s}
                            onPress={() => {
                              const lp = showPlayingRef.current;
                              const isPlaying = lp && lp.s === s && lp.e === ep;
                              followPlayingRef.current = isPlaying;
                              setFollowPlaying(isPlaying);
                              setSelectedSE({ s, e: ep });
                            }}
                            style={[
                              {
                                width: COL_W,
                                height: ROW_H,
                                borderWidth: 0.5,
                                borderColor: "#ccc",
                                justifyContent: "center",
                                alignItems: "center",
                              },
                              isSelected
                                ? { backgroundColor: "lightgreen" }
                                : getCellBg(cell),
                            ]}
                          >
                            <Text
                              style={{ fontSize: fs(17), fontWeight: "bold" }}
                            >
                              {getCellText(cell, s, ep)}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ))}
                </View>
              </ScrollView>
            </View>
          </ScrollView>
          {/* Expanded episode image */}
          {mapImageExpanded &&
            episodeInfo?.image &&
            (() => {
              const screenWidth = Dimensions.get("window").width;
              const expandedHeight = Math.round(screenWidth * (9 / 16));
              return (
                <TouchableOpacity
                  activeOpacity={1}
                  onPress={() => setMapImageExpanded(false)}
                  style={{ borderTopWidth: 6, borderTopColor: "#000" }}
                >
                  <Image
                    source={{ uri: episodeInfo.image }}
                    style={{ width: screenWidth, height: expandedHeight }}
                    resizeMode="cover"
                  />
                </TouchableOpacity>
              );
            })()}
          {/* Episode info box */}
          {selectedSE &&
            (() => {
              const screenWidth = Dimensions.get("window").width;
              const imgWidth = Math.round(screenWidth / 2);
              const imgHeight = Math.round(imgWidth * (9 / 16));
              return (
                <View
                  style={{
                    borderTopWidth: 3,
                    borderTopColor: "#000",
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                      borderBottomWidth: 3,
                      borderBottomColor: "#000",
                    }}
                  >
                    <View
                      style={{
                        flex: 1,
                        flexDirection: "row",
                        alignItems: "center",
                      }}
                    >
                      {episodeInfo && displayEpisodeTitle(episodeInfo.name) ? (
                        <Text
                          style={{
                            fontSize: fs(16),
                            fontWeight: "bold",
                            flexShrink: 1,
                          }}
                          numberOfLines={1}
                        >
                          {displayEpisodeTitle(episodeInfo.name)}
                        </Text>
                      ) : null}
                      <Text
                        style={{
                          fontSize: fs(16),
                          marginLeft:
                            episodeInfo && displayEpisodeTitle(episodeInfo.name)
                              ? 8
                              : 0,
                        }}
                        numberOfLines={1}
                      >
                        {formatSelectedSE(selectedSE)}
                      </Text>
                    </View>
                    <Text
                      style={{
                        fontSize: fs(16),
                        fontWeight: "bold",
                        color: "#555",
                        marginLeft: 8,
                      }}
                    >
                      {episodeInfo?.aired
                        ? episodeInfo.aired.replace(/-/g, "/")
                        : ""}
                    </Text>
                  </View>
                  {followPlaying &&
                    playProgress &&
                    (() => {
                      const totalSec = Math.round(playProgress.duration / 1e7);
                      const posSec = Math.round(playProgress.position / 1e7);
                      const remSec = Math.max(0, totalSec - posSec);
                      const fmt = (s) => {
                        const h = Math.floor(s / 3600);
                        const m = Math.floor((s % 3600) / 60);
                        return `${h}:${String(m).padStart(2, "0")}`;
                      };
                      const pct = Math.min(
                        100,
                        (playProgress.position / playProgress.duration) * 100,
                      );
                      return (
                        <View
                          style={{ flexDirection: "row", alignItems: "center" }}
                        >
                          <Text
                            style={{
                              fontSize: fs(18),
                              color: "#555",
                              marginHorizontal: 4,
                            }}
                          >
                            {fmt(posSec)}
                          </Text>
                          <View
                            style={{
                              flex: 1,
                              height: 6,
                              backgroundColor: "#ddd",
                            }}
                          >
                            <View
                              style={{
                                height: 6,
                                backgroundColor: "#2a2",
                                width: `${pct}%`,
                              }}
                            />
                          </View>
                          <Text
                            style={{
                              fontSize: fs(18),
                              color: "#555",
                              marginHorizontal: 4,
                            }}
                          >
                            {fmt(remSec)}
                          </Text>
                        </View>
                      );
                    })()}
                  <View
                    style={{
                      flexDirection: "row",
                      height: imgHeight + 30,
                      paddingVertical: 7,
                    }}
                  >
                    {episodeInfo?.image ? (
                      <TouchableOpacity
                        activeOpacity={0.85}
                        onPress={() => setMapImageExpanded((v) => !v)}
                      >
                        <Image
                          source={{ uri: episodeInfo.image }}
                          style={{ width: imgWidth, height: imgHeight }}
                          resizeMode="cover"
                        />
                      </TouchableOpacity>
                    ) : (
                      <View
                        style={{
                          width: imgWidth,
                          height: imgHeight,
                          backgroundColor: "#ddd",
                        }}
                      />
                    )}
                    <ScrollView
                      style={{
                        flex: 1,
                        paddingHorizontal: 8,
                        paddingVertical: 4,
                      }}
                    >
                      {episodeInfo?.overview ? (
                        <Text
                          style={{
                            fontSize: fs(16),
                            color: "#333",
                            lineHeight: fs(22),
                          }}
                        >
                          {episodeInfo.overview}
                        </Text>
                      ) : null}
                    </ScrollView>
                  </View>
                </View>
              );
            })()}
        </View>
      );
    };

    const renderActorsContent = () => {
      const chars = show?.characters ?? [];
      const crew = show?.crew ?? [];
      const openActorImdb = async (actor) => {
        const name = (actor.actor ?? actor.personName ?? "").trim();
        if (!name) return;
        // Extract TVDB person ID from tvdbUrl e.g. https://thetvdb.com/people/252099-seth-green
        const tvdbPersonId = actor.tvdbUrl
          ? ((actor.tvdbUrl.match(/\/people\/(\d+)/) || [])[1] ?? null)
          : null;
        try {
          const res = await fetch(`${TV_SRVR_HTTP_URL}/api/getActorPage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, tvdbPersonId }),
          });
          const url = await res.json();
          if (url) Linking.openURL(url);
          else
            Linking.openURL(
              `https://www.imdb.com/find?q=${encodeURIComponent(name)}&s=nm`,
            );
        } catch (_) {
          Linking.openURL(
            `https://www.imdb.com/find?q=${encodeURIComponent(name)}&s=nm`,
          );
        }
      };
      const renderActorCard = (actor, key) => (
        <TouchableOpacity
          key={key}
          style={showsStyles.actorCard}
          onPress={() => openActorImdb(actor)}
        >
          {actor.image || actor.personImgURL ? (
            <Image
              source={{ uri: actor.image ?? actor.personImgURL }}
              style={showsStyles.actorImg}
              resizeMode="cover"
            />
          ) : (
            <View style={showsStyles.actorImgPlaceholder} />
          )}
          <Text style={showsStyles.actorPersonName} numberOfLines={1}>
            {actor.actor ?? actor.personName}
          </Text>
          <Text style={showsStyles.actorCharName} numberOfLines={1}>
            {(actor.character ?? actor.name)
              ? `(${actor.character ?? actor.name})`
              : ""}
          </Text>
        </TouchableOpacity>
      );
      return (
        <ScrollView>
          {chars.length > 0 && (
            <>
              <Text style={showsStyles.actorSectionTitle}>Cast</Text>
              <View style={showsStyles.actorGrid}>
                {chars.map((actor, i) => renderActorCard(actor, i))}
              </View>
            </>
          )}
          {selectedSE && guestActors.length > 0 && (
            <>
              <View style={showsStyles.sectionDivider} />
              <Text style={showsStyles.actorSectionTitle}>
                {`Guests S${String(selectedSE.s).padStart(2, "0")}E${String(selectedSE.e).padStart(2, "0")}`}
              </Text>
              <View style={showsStyles.actorGrid}>
                {guestActors.map((actor, i) => renderActorCard(actor, i))}
              </View>
            </>
          )}
          {crew.length > 0 && (
            <>
              <View style={showsStyles.sectionDivider} />
              <Text style={showsStyles.actorSectionTitle}>Crew</Text>
              <View style={showsStyles.actorGrid}>
                {crew.map((member, i) => (
                  <TouchableOpacity
                    key={i}
                    style={showsStyles.actorCard}
                    onPress={() => openActorImdb({ actor: member.name })}
                  >
                    {member.image ? (
                      <Image
                        source={{ uri: member.image }}
                        style={showsStyles.actorImg}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={showsStyles.actorImgPlaceholder} />
                    )}
                    <Text style={showsStyles.actorPersonName} numberOfLines={1}>
                      {member.name}
                    </Text>
                    <Text style={showsStyles.actorCharName} numberOfLines={1}>
                      {member.type ? `(${member.type})` : ""}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
        </ScrollView>
      );
    };

    const renderEpiStatsContent = () => {
      if (!selectedSE) {
        return <Text style={subCtrlStyles.noVideo}>No episode selected</Text>;
      }
      if (!epiStats) {
        return <Text style={subCtrlStyles.noVideo}>Loading…</Text>;
      }
      const fmtSize = (bytes) => {
        if (!bytes) return null;
        const gb = bytes / (1024 * 1024 * 1024);
        return gb >= 1
          ? `${gb.toFixed(2)} GB`
          : `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
      };
      const fmtRate = (bps) => {
        if (!bps) return null;
        return `${(bps / 1000000).toFixed(1)} Mbps`;
      };
      const rows = [
        { label: "File", value: epiStats.fileName },
        {
          label: "PTT Title",
          value:
            epiStats.ptt?.title?.toLowerCase() !==
            selectedShow?.name?.toLowerCase()
              ? epiStats.ptt?.title
              : null,
        },
        { label: "Show", value: selectedShow?.name },
        {
          label: "Season",
          value: selectedSE?.s != null ? String(selectedSE.s) : null,
        },
        {
          label: "Episode",
          value: selectedSE?.e != null ? String(selectedSE.e) : null,
        },
        { label: "Air Date", value: episodeInfo?.aired },
        { label: "File Size", value: fmtSize(epiStats.fileSize) },
        {
          label: "Duration",
          value:
            epiStats.durationMins != null
              ? `${epiStats.durationMins} min`
              : null,
        },
        {
          label: "Bit Depth",
          value:
            epiStats.videoBitDepth != null
              ? `${epiStats.videoBitDepth}-bit`
              : null,
        },
        { label: "Bit Rate", value: fmtRate(epiStats.videoBitRate) },
        {
          label: "Frame Rate",
          value:
            epiStats.videoFrameRate != null
              ? `${epiStats.videoFrameRate} fps`
              : null,
        },
        {
          label: "Resolution",
          value:
            epiStats.videoWidth && epiStats.videoHeight
              ? `${epiStats.videoWidth}x${epiStats.videoHeight}`
              : null,
        },
        { label: "HDR", value: epiStats.hdr },
        {
          label: "Audio Ch",
          value:
            epiStats.audioChannels != null
              ? String(epiStats.audioChannels)
              : null,
        },
        { label: "Source", value: epiStats.ptt?.source },
        { label: "Codec", value: epiStats.ptt?.codec },
        { label: "Group", value: epiStats.ptt?.group },
        { label: "Language", value: epiStats.ptt?.language },
        { label: "Audio", value: epiStats.ptt?.audio },
        { label: "Resolution (PTT)", value: epiStats.ptt?.resolution },
        {
          label: "Year",
          value: epiStats.ptt?.year != null ? String(epiStats.ptt.year) : null,
        },
        { label: "Proper", value: epiStats.ptt?.proper ? "Yes" : null },
        { label: "Repack", value: epiStats.ptt?.repack ? "Yes" : null },
        { label: "Extended", value: epiStats.ptt?.extended ? "Yes" : null },
        { label: "Unrated", value: epiStats.ptt?.unrated ? "Yes" : null },
        { label: "Hardcoded", value: epiStats.ptt?.hardcoded ? "Yes" : null },
      ].filter((r) => r.value != null && r.value !== "");
      return (
        <ScrollView style={{ flex: 1, backgroundColor: "#fff" }}>
          {rows.map((r, idx) => (
            <View
              key={idx}
              style={{
                flexDirection: "row",
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderBottomWidth: 1,
                borderBottomColor: "#eee",
                backgroundColor: idx % 2 === 0 ? "#fff" : "#f8f8f8",
              }}
            >
              <Text style={{ fontSize: fs(18), color: "#666", width: 120 }}>
                {r.label}
              </Text>
              <Text style={{ fontSize: fs(18), flex: 1, flexWrap: "wrap" }}>
                {r.value}
              </Text>
            </View>
          ))}
        </ScrollView>
      );
    };

    const handleTabPress = (tab) => {
      setShowSearch("");
      if (tab === "List") {
        setScrollToTopOnOpen(true);
      }
      setActiveTab(tab);
    };

    const handleClose = () => {
      setShowSearch("");
      setShowShows(false);
    };

    const handleTvClick = () => {
      if (!show) return;
      let episodeId = null;
      if (selectedSE && showSeriesMap) {
        const sm = buildSeriesMap(showSeriesMap);
        const episodeData = sm?.[selectedSE.s]?.[selectedSE.e];
        episodeId = episodeData?.id || null;
      }
      const params = new URLSearchParams({
        showId: show.id,
        showName: show.name,
      });
      if (episodeId) params.set("episodeId", episodeId);
      fetch(`${TV_TV_URL}/tv/viewshow?${params.toString()}`).catch(() => {});
      handleClose();
    };

    return (
      <View style={showsStyles.container}>
        <StatusBar hidden />
        <TouchableOpacity
          onPress={handleHeaderPress}
          style={showsStyles.headerRow}
          activeOpacity={0.7}
        >
          <Text style={showsStyles.headerTitle} numberOfLines={1}>
            {show?.name ?? "—"}
            {seLabel}
          </Text>
        </TouchableOpacity>
        <View style={showsStyles.tabRow}>
          {["List", "Info", "Map", "Actors", "Stats"].map((tab) => (
            <TouchableOpacity
              key={tab}
              onPress={() => handleTabPress(tab)}
              style={[
                showsStyles.tabBtn,
                activeTab === tab && showsStyles.tabBtnActive,
              ]}
            >
              <Text style={showsStyles.tabBtnText}>{tab}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {activeTab === "List" && (
          <View style={{ flexDirection: "row", width: "100%" }}>
            <TextInput
              style={[showsStyles.searchInput, { flex: 1, marginRight: 0 }]}
              value={showSearch}
              onChangeText={setShowSearch}
              placeholder="Search shows..."
              placeholderTextColor="#aaa"
              autoCorrect={false}
              autoCapitalize="none"
            />
            <TouchableOpacity
              onPress={() => {
                const orders = ["alpha", "viewed", "added"];
                const currentIdx = orders.indexOf(sortOrder);
                const nextIdx = (currentIdx + 1) % orders.length;
                setScrollToTopOnOpen(true);
                setSortOrder(orders[nextIdx]);
              }}
              style={[
                showsStyles.searchInput,
                {
                  flex: 1,
                  marginLeft: 0,
                  justifyContent: "center",
                  alignItems: "center",
                },
              ]}
            >
              <Text style={{ fontSize: fs(18), fontWeight: "bold" }}>
                {sortOrder === "alpha"
                  ? "Alpha"
                  : sortOrder === "viewed"
                    ? "Watched"
                    : "Added"}
              </Text>
            </TouchableOpacity>
          </View>
        )}
        <View style={showsStyles.contentPane}>
          <>
            {activeTab === "List" && renderListContent()}
            {activeTab === "Info" && renderInfoContent()}
            {activeTab === "Map" && renderMapContent()}
            {activeTab === "Actors" && renderActorsContent()}
            {activeTab === "Stats" && renderEpiStatsContent()}
          </>
        </View>
        <View style={{ flexDirection: "row" }}>
          <TouchableOpacity
            onPress={handleTvClick}
            style={[subCtrlStyles.closeBtn, { flex: 1 }]}
            activeOpacity={0.7}
          >
            <Text style={subCtrlStyles.closeBtnText}>TV</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleClose}
            style={[subCtrlStyles.closeBtn, { flex: 1 }]}
            activeOpacity={0.7}
          >
            <Text style={subCtrlStyles.closeBtnText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (showPicCtrl) {
    return (
      <View style={styles.container}>
        <StatusBar hidden />
        <View style={picCtrlStyles.header}>
          <Text style={picCtrlStyles.headerTitle}>Picture Settings</Text>
        </View>
        <ScrollView style={picCtrlStyles.list}>
          {picSettings.map((s) => (
            <View key={s.target} style={picCtrlStyles.row}>
              <View style={picCtrlStyles.labelCol}>
                <Text style={picCtrlStyles.label}>{s.label}</Text>
                {s.type === "range" && (
                  <Text
                    style={picCtrlStyles.rangeHint}
                  >{`${s.min}–${s.max}`}</Text>
                )}
              </View>
              <TouchableOpacity
                onPress={() => picAdjust(s, -1)}
                style={picCtrlStyles.arrowBtn}
              >
                <Text style={picCtrlStyles.arrowText}>▼</Text>
              </TouchableOpacity>
              {s.type === "range" ? (
                <TextInput
                  style={picCtrlStyles.valueInput}
                  value={picInputs[s.target]?.raw ?? s.value}
                  keyboardType="number-pad"
                  onChangeText={(t) => picInputChange(s, t)}
                  onBlur={() => commitPicInput(s)}
                  onSubmitEditing={() => commitPicInput(s)}
                  returnKeyType="done"
                />
              ) : (
                <Text style={picCtrlStyles.value} numberOfLines={1}>
                  {picValText(s.value)}
                </Text>
              )}
              <TouchableOpacity
                onPress={() => picAdjust(s, 1)}
                style={picCtrlStyles.arrowBtn}
              >
                <Text style={picCtrlStyles.arrowText}>▲</Text>
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
        <TouchableOpacity
          onPress={closePicCtrl}
          style={subCtrlStyles.closeBtn}
          activeOpacity={0.7}
        >
          <Text style={subCtrlStyles.closeBtnText}>Close</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (showStreamers) {
    return (
      <View style={styles.container}>
        <StatusBar hidden />
        <View style={streamerStyles.header}>
          <Text style={streamerStyles.headerTitle}>Streaming Services</Text>
        </View>
        <ScrollView style={streamerStyles.list}>
          <View style={streamerStyles.pinnedRow}>
            {["Emby", "Netflix", "HBO Max"]
              .map((name) => services.find((s) => s.name === name))
              .filter(Boolean)
              .map((svc) => (
                <TouchableOpacity
                  key={"pin-" + svc.name}
                  onPressIn={() => {
                    setFlashSvc("pin-" + svc.name);
                    setTimeout(() => setFlashSvc(null), 500);
                  }}
                  onPress={() => openApp(svc)}
                  style={[
                    streamerStyles.pinnedCard,
                    flashSvc === "pin-" + svc.name && {
                      backgroundColor: "lightblue",
                    },
                  ]}
                >
                  <Image
                    source={{
                      uri: `https://hahnca.com/shows/logos/${svc.logo}`,
                    }}
                    style={streamerStyles.logo}
                  />
                  <Text style={streamerStyles.cardName}>{svc.name}</Text>
                </TouchableOpacity>
              ))}
          </View>
          <View style={streamerStyles.grid}>
            {services.map((svc) => (
              <TouchableOpacity
                key={svc.name}
                onPressIn={() => {
                  setFlashSvc(svc.name);
                  setTimeout(() => setFlashSvc(null), 500);
                }}
                onPress={() => openApp(svc)}
                style={[
                  streamerStyles.card,
                  flashSvc === svc.name && { backgroundColor: "lightblue" },
                ]}
              >
                <Image
                  source={{ uri: `https://hahnca.com/shows/logos/${svc.logo}` }}
                  style={streamerStyles.logo}
                />
                <Text style={streamerStyles.cardName}>{svc.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
        <TouchableOpacity
          onPress={() => setShowStreamers(false)}
          style={subCtrlStyles.closeBtn}
          activeOpacity={0.7}
        >
          <Text style={subCtrlStyles.closeBtnText}>Close</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar hidden />
      <View style={styles.grid} onLayout={onGridLayout}>
        {cellDims.w > 0 &&
          buttons.map((btn) => (
            <View
              key={btn.key}
              style={[
                styles.cell,
                {
                  backgroundColor: btn.bg(),
                  width: cellDims.w,
                  height: cellDims.h,
                },
              ]}
              onStartShouldSetResponder={() => true}
              onResponderTerminationRequest={() => false}
              onResponderGrant={() => {
                if (btn.onPressIn) btn.onPressIn();
              }}
              onResponderRelease={() => {
                if (btn.onPressOut) btn.onPressOut();
              }}
              onResponderTerminate={() => {
                if (btn.onPressOut) btn.onPressOut();
              }}
            >
              {btn.icon ? (
                btn.icon
              ) : (
                <Text
                  style={[
                    styles.cellText,
                    btn.smallText && styles.cellTextSmall,
                    btn.tinyText && styles.cellTextTiny,
                    btn.largeText && styles.cellTextLarge,
                  ]}
                >
                  {btn.label}
                </Text>
              )}
            </View>
          ))}
      </View>
      {tvapprcMode && showTvapprcInput && (
        <View style={tvapprcInputStyles.overlay}>
          <Pressable style={tvapprcInputStyles.emptyFill} onPress={closeTvapprcInput} />
          <View style={tvapprcInputStyles.doneBtnContainer} pointerEvents="box-none">
            <TouchableOpacity
              onPress={closeTvapprcInput}
              style={[
                tvapprcInputStyles.actionBtn,
                tvapprcInputStyles.doneBtn,
              ]}
              activeOpacity={0.7}
            >
              <Text style={tvapprcInputStyles.actionText}>Done</Text>
            </TouchableOpacity>
          </View>
          <View style={tvapprcInputStyles.inputGroup} pointerEvents="box-none">
            <View style={tvapprcInputStyles.topRow}>
              <TextInput
                style={tvapprcInputStyles.input}
                value={tvapprcFilter}
                onChangeText={updateTvapprcFilter}
                autoFocus
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="done"
                onSubmitEditing={closeTvapprcInput}
              />
              <TouchableOpacity
                onPress={() => updateTvapprcFilter("")}
                style={tvapprcInputStyles.actionBtn}
                activeOpacity={0.7}
              >
                <Text style={tvapprcInputStyles.actionText}>Clear</Text>
              </TouchableOpacity>
            </View>
            {tvapprcTotalCount > 0 && (
              <View style={tvapprcInputStyles.countRow}>
                <Text style={tvapprcInputStyles.countText}>
                {(() => {
                  const query = tvapprcFilter.trim().toLowerCase();
                  const listCount =
                    tvapprcListCount ??
                    (query
                      ? tvapprcShows.filter((s) =>
                          s.name.toLowerCase().includes(query),
                        ).length
                      : tvapprcShows.length);
                  return `There are ${listCount} shows in list of ${tvapprcTotalCount} total.`;
                })()}
                </Text>
              </View>
            )}
          </View>
        </View>
      )}
      {locked && (
        <View style={lockStyles.overlay}>
          <Text style={lockStyles.title}>Remote Collision</Text>
          <View
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              padding: 16,
            }}
          >
            <Text style={lockStyles.message}>
              A remote collision has been detected. The remote has been
              locked. Press and hold unlock button to continue.
            </Text>
          </View>
          {lockInfo && (
            <View style={lockStyles.keyStatus}>
              <Text style={lockStyles.keyStatusText}>
                {keyLabel(lockInfo.sentKey)} sent
              </Text>
              <Text style={lockStyles.keyStatusText}>
                {keyLabel(lockInfo.blockedKey)} ignored
              </Text>
            </View>
          )}
          <TouchableOpacity
            onPressIn={startUnlockHold}
            onPressOut={stopUnlockHold}
            style={lockStyles.unlockBtn}
            activeOpacity={1}
          >
            <Text style={lockStyles.unlockBtnText}>Unlock</Text>
          </TouchableOpacity>
        </View>
      )}
      {missingEpWarning && (
        <View style={missingEpStyles.overlay}>
          <View style={missingEpStyles.box}>
            <Text style={missingEpStyles.text}>
              There is an unwatched episode before this one
            </Text>
            <Text style={missingEpStyles.text}>
              Show: {missingEpWarning.showName}
            </Text>
            <Text style={missingEpStyles.text}>
              Unwatched: S
              {String(missingEpWarning.missingSeason).padStart(2, "0")}E
              {String(missingEpWarning.missingEpisode).padStart(2, "0")}
            </Text>
            <Text style={missingEpStyles.text}>
              Currently playing: S
              {String(missingEpWarning.currentSeason).padStart(2, "0")}E
              {String(missingEpWarning.currentEpisode).padStart(2, "0")}
            </Text>
            <Text style={[missingEpStyles.text, { marginBottom: 20 }]}>
              Device: {missingEpWarning.device}
            </Text>
            <TouchableOpacity
              onPress={() => setMissingEpWarning(null)}
              style={missingEpStyles.closeBtn}
            >
              <Text style={missingEpStyles.closeBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
    paddingHorizontal: SCREEN_MARGIN,
    paddingVertical: SCREEN_MARGIN * 2,
  },
  grid: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: BORDER,
    columnGap: BORDER,
    backgroundColor: "#000",
  },
  cell: {
    // width/height set dynamically via cellDims
    alignItems: "center",
    justifyContent: "center",
  },
  cellText: {
    fontSize: fs(42),
    fontWeight: "bold",
    color: "#000",
  },
  cellTextSmall: {
    fontSize: fs(28),
  },
  cellTextTiny: {
    fontSize: fs(20),
  },
  cellTextLarge: {
    fontSize: fs(84),
  },
});

const tvapprcInputStyles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 30,
    backgroundColor: "#000",
    paddingTop: SCREEN_MARGIN,
    paddingBottom: SCREEN_MARGIN,
    paddingHorizontal: SCREEN_MARGIN,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  input: {
    flex: 1,
    backgroundColor: "#fff",
    color: "#000",
    fontSize: fs(22),
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 6,
  },
  actionBtn: {
    backgroundColor: "#fff",
    paddingVertical: 14,
    paddingHorizontal: 19,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  actionText: {
    color: "#000",
    fontSize: fs(22),
    fontWeight: "bold",
  },
  emptyFill: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  // Percentages, not the module-load Dimensions snapshot: that snapshot is
  // whatever orientation the bundle happened to load in, and a landscape one
  // pulls this whole group up into the Done button.
  doneBtnContainer: {
    position: "absolute",
    top: "30%",
    left: 0,
    right: 0,
    justifyContent: "flex-start",
    alignItems: "center",
  },
  doneBtn: {
    width: "80%",
    paddingVertical: 28,
  },
  inputGroup: {
    position: "absolute",
    top: "45%",
    left: 0,
    right: 0,
    paddingHorizontal: SCREEN_MARGIN,
  },
  countRow: {
    marginTop: 12,
    alignSelf: "flex-start",
  },
  countText: {
    color: "#FFFF00",
    fontSize: fs(18),
  },
});

const streamerStyles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: "#333",
  },
  headerTitle: {
    color: "#fff",
    fontSize: fs(20),
    fontWeight: "bold",
  },
  closeBtn: {
    padding: 8,
  },
  closeBtnText: {
    color: "#fff",
    fontSize: fs(28),
    lineHeight: 32,
  },
  list: {
    flex: 1,
    padding: 8,
  },
  pinnedRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },
  pinnedCard: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    backgroundColor: "#fff",
    gap: 6,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  card: {
    width: "31%",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    backgroundColor: "#fff",
    gap: 6,
  },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 6,
    resizeMode: "contain",
  },
  cardName: {
    color: "#000",
    fontSize: fs(13),
  },
});

const kybdStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    paddingHorizontal: SCREEN_MARGIN,
    paddingTop: SCREEN_MARGIN * 2,
    paddingBottom: SCREEN_MARGIN,
  },

  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    gap: 8,
  },
  textInput: {
    flex: 1,
    padding: 8,
    fontSize: fs(16),
    borderWidth: 1,
    borderColor: "#bbb",
    borderRadius: 5,
    backgroundColor: "#fff",
    textAlign: "left",
  },
  closeBtn: {
    padding: 8,
  },
  closeBtnText: {
    fontSize: fs(20),
    color: "#000",
  },
  historyList: {
    flex: 1,
  },
  historyItem: {
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  historyItemText: {
    fontSize: fs(15),
  },
});

const subCtrlStyles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: "#333",
    backgroundColor: "#fff",
  },
  showName: {
    color: "#000",
    fontSize: fs(20),
    fontWeight: "bold",
  },
  list: {
    flex: 1,
    backgroundColor: "#fff",
  },
  closeBtn: {
    backgroundColor: "white",
    alignItems: "center",
    justifyContent: "center",
    height: 64,
    flexShrink: 0,
    borderWidth: 2,
    borderColor: "#000",
    borderRadius: 8,
    margin: 4,
  },
  closeBtnText: {
    fontSize: fs(31),
    fontWeight: "bold",
    color: "#000",
  },
  noVideo: {
    padding: 20,
    textAlign: "center",
    color: "#999",
    fontSize: fs(16),
  },
  card: {
    padding: 28,
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
    backgroundColor: "#fff",
  },
  cardText: {
    fontSize: fs(27),
    color: "#000",
  },
  cardTextSelected: {
    fontWeight: "bold",
  },
});

const picCtrlStyles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: "#ccc",
    backgroundColor: "#fff",
  },
  headerTitle: {
    color: "#000",
    fontSize: fs(20),
    fontWeight: "bold",
  },
  closeBtn: {
    padding: 8,
  },
  closeBtnText: {
    color: "#000",
    fontSize: fs(28),
    lineHeight: 32,
  },
  list: {
    flex: 1,
    backgroundColor: "#fff",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    backgroundColor: "#fff",
    gap: 8,
  },
  labelCol: {
    flex: 1,
    flexDirection: "column",
    gap: 2,
  },
  label: {
    fontSize: fs(18),
    fontWeight: "bold",
    color: "#000",
  },
  arrowBtn: {
    backgroundColor: "whitesmoke",
    borderWidth: 1,
    borderColor: "#bbb",
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  arrowText: {
    fontSize: fs(18),
    color: "#000",
  },
  value: {
    minWidth: 72,
    textAlign: "center",
    fontSize: fs(18),
    fontWeight: "bold",
    color: "#000",
  },
  rangeHint: {
    fontSize: fs(15),
    color: "#000",
  },
  valueInput: {
    minWidth: 72,
    textAlign: "center",
    fontSize: fs(18),
    fontWeight: "bold",
    color: "#000",
    borderWidth: 1,
    borderColor: "#bbb",
    paddingVertical: 4,
    paddingHorizontal: 2,
    backgroundColor: "#fff",
  },
});

const lockStyles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: SCREEN_MARGIN * 2,
    left: SCREEN_MARGIN,
    right: SCREEN_MARGIN,
    bottom: SCREEN_MARGIN * 2,
    backgroundColor: "white",
    zIndex: 10,
    borderWidth: 3,
    borderColor: "#000",
    flexDirection: "column",
  },
  title: {
    fontSize: fs(42),
    fontWeight: "bold",
    padding: 10,
    paddingBottom: 6,
  },
  message: {
    fontSize: fs(25),
    fontWeight: "bold",
    textAlign: "center",
  },
  keyStatus: {
    marginLeft: 20,
    paddingBottom: 10,
  },
  keyStatusText: {
    color: "red",
    textAlign: "left",
    fontSize: fs(22),
    fontWeight: "bold",
  },
  unlockBtn: {
    backgroundColor: "lightgreen",
    borderTopWidth: 3,
    borderTopColor: "#000",
    alignItems: "center",
    justifyContent: "center",
    height: "20%",
  },
  unlockBtnText: {
    fontSize: fs(39),
    fontWeight: "bold",
  },
});

const missingEpStyles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 20,
  },
  box: {
    backgroundColor: "#ffcccc",
    borderWidth: 2,
    borderColor: "#cc0000",
    borderRadius: 10,
    padding: 24,
    maxWidth: 400,
    width: "90%",
  },
  text: {
    fontSize: fs(16),
    fontWeight: "bold",
    marginBottom: 6,
  },
  closeBtn: {
    marginTop: 4,
    alignSelf: "flex-start",
    backgroundColor: "whitesmoke",
    borderWidth: 1,
    borderColor: "#cc0000",
    borderRadius: 7,
    paddingVertical: 6,
    paddingHorizontal: 18,
  },
  closeBtnText: {
    fontSize: fs(16),
    fontWeight: "bold",
  },
});

const showsStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    paddingTop: SCREEN_MARGIN * 2,
    paddingBottom: SCREEN_MARGIN * 2,
  },
  headerRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#f0f0f0",
    borderTopWidth: 3,
    borderTopColor: "#000",
    borderBottomWidth: 3,
    borderBottomColor: "#000",
  },
  headerTitle: {
    fontSize: fs(27),
    fontWeight: "bold",
    color: "#000",
  },
  tabRow: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 3,
    borderBottomColor: "#000",
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 13,
    alignItems: "center",
    backgroundColor: "whitesmoke",
  },
  tabBtnActive: {
    backgroundColor: "lightgray",
  },
  tabBtnText: {
    fontSize: fs(22),
    fontWeight: "500",
  },
  tabDivider: {
    width: 3,
    alignSelf: "stretch",
    backgroundColor: "#000",
  },
  closeTabBtn: {
    flex: 1,
    paddingVertical: 13,
    alignItems: "center",
    backgroundColor: "whitesmoke",
  },
  contentPane: {
    flex: 1,
  },
  searchInput: {
    height: 52,
    paddingHorizontal: 12,
    fontSize: fs(22),
    backgroundColor: "#fff",
    borderBottomWidth: 3,
    borderBottomColor: "#000",
    marginBottom: 10,
  },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    height: 52,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#eee",
    backgroundColor: "white",
  },
  listRowSelected: {
    backgroundColor: "lightblue",
  },
  listRowName: {
    flex: 1,
    fontSize: fs(23),
    fontWeight: "bold",
    color: "#000",
  },
  listRowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  listRowPlus: {
    fontSize: fs(16),
    color: "#000",
  },
  listRowWait: {
    fontSize: fs(16),
    color: "blue",
  },
  infoTop: {
    flexDirection: "row",
    padding: 12,
  },
  posterBox: {
    width: "50%",
    marginRight: 12,
  },
  posterImg: {
    width: "100%",
    aspectRatio: 2 / 3,
    borderRadius: 4,
  },
  posterPlaceholder: {
    width: "100%",
    aspectRatio: 2 / 3,
    backgroundColor: "#ddd",
    borderRadius: 4,
    justifyContent: "center",
    alignItems: "center",
  },
  posterPlaceholderText: {
    color: "#888",
    fontSize: fs(12),
  },
  infoBox: {
    flex: 1,
  },
  infoField: {
    fontSize: fs(16),
    fontWeight: "bold",
    color: "#222",
    lineHeight: 22,
    marginBottom: 2,
  },
  overviewText: {
    fontSize: fs(20),
    color: "#333",
    lineHeight: 28,
    paddingHorizontal: 12,
    paddingBottom: 16,
  },
  actorSectionTitle: {
    fontSize: fs(14),
    fontWeight: "bold",
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
    color: "#000",
  },
  actorGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 6,
  },
  actorCard: {
    width: "33.33%",
    padding: 4,
    alignItems: "center",
    marginBottom: 8,
    backgroundColor: "#f5f5f5",
    borderRadius: 6,
  },
  actorImg: {
    width: "100%",
    aspectRatio: 100 / 130,
    borderRadius: 4,
    marginBottom: 4,
  },
  actorImgPlaceholder: {
    width: "100%",
    aspectRatio: 100 / 130,
    backgroundColor: "#ddd",
    borderRadius: 4,
    marginBottom: 4,
  },
  actorPersonName: {
    fontSize: fs(12),
    fontWeight: "bold",
    textAlign: "center",
    color: "#000",
  },
  actorCharName: {
    fontSize: fs(11),
    color: "#555",
    textAlign: "center",
  },
  sectionDivider: {
    height: 2,
    backgroundColor: "#000",
    marginVertical: 4,
    marginHorizontal: 12,
  },
});
