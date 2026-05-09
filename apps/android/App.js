import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
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

// Normalize font sizes so system font scale doesn't affect the app
const fs = (size) => size / PixelRatio.getFontScale();

const TV_TV_URL = "https://hahnca.com/tv-tv";
const TV_SRVR_WS_URL = "wss://hahnca.com/tv-srvr";
const TV_SRVR_HTTP_URL = "https://hahnca.com/tv-srvr";

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

const COLS = 3;
const ROWS = 5;
const BORDER = 13;
const SCREEN_MARGIN = 30;

export default function App() {
  const [muted, setMuted] = useState(false);
  const [cellDims, setCellDims] = useState({ w: 0, h: 0 });
  const [showStreamers, setShowStreamers] = useState(false);
  const [flashSvc, setFlashSvc] = useState(null);
  const [showKeybd, setShowKeybd] = useState(false);
  const [kybdInput, setKybdInput] = useState("");
  const [kybdHistory, setKybdHistory] = useState([]);
  const [showSubCtrl, setShowSubCtrl] = useState(false);
  const [subPlayers, setSubPlayers] = useState([]);
  const [subDeviceName, setSubDeviceName] = useState(null);
  const [showPicCtrl, setShowPicCtrl] = useState(false);
  const [picSettings, setPicSettings] = useState([]);
  const [picInputs, setPicInputs] = useState({}); // target -> { typing, raw }
  const [locked, setLocked] = useState(false);
  const [missingEpWarning, setMissingEpWarning] = useState(null);
  const [layoutOption, setLayoutOption] = useState("mark");
  const [showShows, setShowShows] = useState(false);
  const [showsList, setShowsList] = useState([]);
  const [selectedShow, setSelectedShow] = useState(null);
  const [selectedSE, setSelectedSE] = useState(null);
  const [followPlaying, setFollowPlaying] = useState(false);
  const [activeTab, setActiveTab] = useState("List");
  const [guestActors, setGuestActors] = useState([]);
  const [episodeInfo, setEpisodeInfo] = useState(null);
  const [showSearch, setShowSearch] = useState("");
  const [posterExpanded, setPosterExpanded] = useState(false);
  const [showSeriesMap, setShowSeriesMap] = useState(null);
  const [mapRefreshKey, setMapRefreshKey] = useState(0);
  const [playProgress, setPlayProgress] = useState(null);
  const [flashCell, setFlashCell] = useState(null);
  const [mapImageExpanded, setMapImageExpanded] = useState(false);
  const [showEpiSubs, setShowEpiSubs] = useState(false);
  const [epiSubTracks, setEpiSubTracks] = useState([]);

  const onGridLayout = ({ nativeEvent: { layout } }) => {
    if (layout.width < 10 || layout.height < 10) return;
    setCellDims({
      w: Math.floor((layout.width - BORDER * (COLS - 1)) / COLS),
      h: Math.floor((layout.height - BORDER * (ROWS - 1)) / ROWS),
    });
  };
  const [flashBtn, setFlashBtn] = useState(null);
  const [haState, setHaState] = useState(null);
  const [mediaTitle, setMediaTitle] = useState(null);

  const wsRef = useRef(null);
  const repeatDelayRef = useRef(null);
  const repeatTimeoutRef = useRef(null);
  const repeatActiveRef = useRef(false);
  const lastCmdRef = useRef(0);
  const holdRef = useRef(null);
  const volActiveRef = useRef(false);
  const kybdInputRef = useRef(null);
  const embyHoldRef = useRef(null);
  const embyHoldFiredRef = useRef(false);
  const appsHoldRef = useRef(null);
  const appsHoldFiredRef = useRef(false);
  const volDownHoldRef = useRef(null);
  const volDownHoldFiredRef = useRef(false);
  const picPollRef = useRef(null);
  const picCommitTimersRef = useRef({});
  const picInputsRef = useRef({});
  const subPollRef = useRef(null);
  const subPendingRef = useRef(null); // { deviceName, index } while optimistic highlight is active
  const subGenRef = useRef(0);
  const subNavigatingRef = useRef(false);
  const avoidingRef = useRef(false);
  const avoidTimerRef = useRef(null);
  const unlockHoldTimerRef = useRef(null);
  const homeHoldRef = useRef(null);
  const homeHoldFiredRef = useRef(false);
  const backHoldRef = useRef(null);
  const backHoldFiredRef = useRef(false);
  const showPlayingRef = useRef(null);
  const followPlayingRef = useRef(false);
  const showSelectedRef = useRef(null);
  const showsListRef = useRef([]);
  const showsListLoadedRef = useRef(false);
  const showsFlatListRef = useRef(null);
  const mapHeaderScrollRef = useRef(null);

  const debounce = () => {
    const now = Date.now();
    const ok = now - lastCmdRef.current >= 250;
    lastCmdRef.current = now;
    return ok;
  };

  const startRepeat = (key) => {
    if (isOff || isOther) return;
    if (checkBlocked()) return;
    if (!debounce()) return;
    flash(key);
    notifyAction();
    repeatActiveRef.current = true;
    (async () => {
      await fetch(`${TV_TV_URL}/tv/key/${key}`).catch(() => {});
      if (!repeatActiveRef.current) return;
      await new Promise((r) => {
        repeatDelayRef.current = setTimeout(r, 400);
      });
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
        const url =
          n > 1
            ? `${TV_TV_URL}/tv/key/${key}?n=${n}`
            : `${TV_TV_URL}/tv/key/${key}`;
        await fetch(url).catch(() => {});
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
  };

  const applyMuteState = (data) => {
    if (!data) return;
    if (data.muted !== null && data.muted !== undefined) setMuted(data.muted);
    if (data.state !== undefined) setHaState(data.state);
    if (data.mediaTitle !== undefined) setMediaTitle(data.mediaTitle);
  };

  const pollMute = async () => {
    try {
      const res = await fetch(`${TV_TV_URL}/tv/mutestate`);
      const data = await res.json();
      if (data.ok) applyMuteState(data);
    } catch (_) {}
  };

  const connectWs = () => {
    const ws = new WebSocket(TV_SRVR_WS_URL);
    wsRef.current = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ id: 0, fname: "register" }));
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.id === 0 && msg.notification === "tvMuteState") {
          applyMuteState(msg.data);
        } else if (msg.id === 0 && msg.notification === "tvRemoteAction") {
          const fromSubCtrl = msg.data?.fromSubCtrl ?? false;
          avoidingRef.current = true;
          clearTimeout(avoidTimerRef.current);
          avoidTimerRef.current = setTimeout(
            () => {
              avoidingRef.current = false;
            },
            fromSubCtrl ? 5000 : 1500,
          );
        } else if (msg.id === 0 && msg.notification === "tvRemoteLock") {
          setLocked(true);
        } else if (msg.id === 0 && msg.notification === "tvRemoteUnlock") {
          setLocked(false);
        } else if (
          msg.id === 0 &&
          msg.notification === "missingEpisodeWarning"
        ) {
          setMissingEpWarning(msg.data);
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
      setTimeout(connectWs, 2000);
    };
  };

  useEffect(() => {
    console.log("[vol] APP VERSION v23");
    pollMute();
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
      clearTimeout(repeatDelayRef.current);
      clearTimeout(repeatTimeoutRef.current);
      clearTimeout(holdRef.current);
      clearTimeout(homeHoldRef.current);
      clearTimeout(backHoldRef.current);
      clearInterval(subPollRef.current);
      clearTimeout(avoidTimerRef.current);
      clearTimeout(unlockHoldTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!showShows || showsListLoadedRef.current) return;
    showsListLoadedRef.current = true;
    (async () => {
      try {
        const [res, savedName] = await Promise.all([
          fetch(`${TV_SRVR_HTTP_URL}/api/getAllTvdb?hasEmby=1`),
          AsyncStorage.getItem("selectedShowName").catch(() => null),
        ]);
        const data = await res.json();
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
          const playingShow = lp ? list.find((s) => s.name === lp.name) : null;
          if (playingShow) {
            setFollowPlaying(true);
            setSelectedShow(playingShow);
            setSelectedSE(
              lp.s != null && lp.e != null ? { s: lp.s, e: lp.e } : null,
            );
          } else {
            setSelectedShow((prev) => prev ?? persisted ?? list[0]);
          }
        }
      } catch (_) {}
    })();
  }, [showShows]);

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
        if (data?.image || data?.overview) {
          setEpisodeInfo({
            image: data.image ?? null,
            overview: data.overview ?? null,
            name: data.name ?? null,
            aired: data.aired ?? null,
          });
        } else {
          setEpisodeInfo(null);
        }
      } catch (_) {
        if (!cancelled) {
          setGuestActors([]);
          setEpisodeInfo(null);
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
      !selectedShow
    )
      return;
    const idx = showsList.findIndex((s) => s.name === selectedShow.name);
    if (idx < 0) return;
    setTimeout(() => {
      showsFlatListRef.current?.scrollToIndex({ index: idx, animated: false });
    }, 100);
  }, [showShows, activeTab, selectedShow?.name, showsList.length]);

  useEffect(() => {
    if (!selectedShow) return;
    AsyncStorage.setItem("selectedShowName", selectedShow.name).catch(() => {});
  }, [selectedShow?.name]);

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
        let data;
        if (selectedShow.inEmby !== false) {
          const res = await fetch(
            `${TV_SRVR_HTTP_URL}/api/getSeriesMapFromEmby`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ showName: selectedShow.name }),
            },
          );
          data = await res.json();
        } else {
          const res = await fetch(
            `${TV_SRVR_HTTP_URL}/api/getSeriesMapFromTvdb`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                tvdbId: selectedShow.tvdbId,
                watchedEpis: selectedShow.watchedEpis ?? null,
              }),
            },
          );
          data = await res.json();
        }
        if (data.success && data.seriesMap) setShowSeriesMap(data.seriesMap);
      } catch (_) {}
    })();
  }, [activeTab, selectedShow?.name, mapRefreshKey]);

  const flash = (btn) => {
    setFlashBtn(btn);
    setTimeout(() => setFlashBtn(null), 150);
  };

  const notifyAction = (fromSubCtrl = false) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({ fname: "tvRemoteAction", param: { fromSubCtrl } }),
      );
    }
  };

  const checkBlocked = () => {
    if (locked) return true;
    if (avoidingRef.current) {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ fname: "tvRemoteCollision" }));
      }
      return true;
    }
    return false;
  };

  const startUnlockHold = () => {
    unlockHoldTimerRef.current = setTimeout(() => {
      setLocked(false);
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
    if (checkBlocked()) return;
    flash(cmd);
    if (!debounce()) return;
    notifyAction();
    try {
      const res = await fetch(`${TV_TV_URL}/tv/${cmd}`);
      const data = await res.json();
      if (cmd === "mute" && data.ok) setMuted(data.muted);
    } catch (_) {}
  };

  const tvKey = async (key) => {
    if (isOff || isOther) return;
    if (checkBlocked()) return;
    if (!debounce()) return;
    flash(key);
    notifyAction();
    try {
      await fetch(`${TV_TV_URL}/tv/key/${key}`);
    } catch (_) {}
  };

  const startHold = (action) => {
    holdRef.current = setTimeout(action, 500);
  };

  const stopHold = () => {
    clearTimeout(holdRef.current);
  };

  const googleBtn = async () => {
    if (checkBlocked()) return;
    if (mode === "google") {
      tvCmd("off");
    } else {
      flash("google");
      notifyAction();
      fetch(`${TV_TV_URL}/tv/googlebtn`).catch(() => {});
    }
  };

  const fireBtn = async () => {
    if (checkBlocked()) return;
    if (mode === "fire") {
      tvCmd("off");
    } else {
      flash("fire");
      notifyAction();
      fetch(`${TV_TV_URL}/tv/firebtn`).catch(() => {});
    }
  };

  const startEmbyHold = () => {
    embyHoldFiredRef.current = false;
    if (layoutOption === "mark") {
      embyHoldRef.current = setTimeout(() => {
        embyHoldFiredRef.current = true;
        if (mode === "google" || mode === "fire") setShowStreamers(true);
      }, 500);
    } else {
      embyHoldRef.current = setTimeout(() => {
        embyHoldFiredRef.current = true;
      }, 1000);
    }
  };

  const stopEmbyHold = () => {
    clearTimeout(embyHoldRef.current);
    if (!embyHoldFiredRef.current) {
      if (showSubCtrl) subClose();
      else tvCmd("emby");
    }
    embyHoldFiredRef.current = false;
  };

  const startAppsHold = () => {
    appsHoldFiredRef.current = false;
    appsHoldRef.current = setTimeout(() => {
      appsHoldFiredRef.current = true;
    }, 1000);
  };

  const stopAppsHold = () => {
    clearTimeout(appsHoldRef.current);
    if (!appsHoldFiredRef.current) {
      if (mode === "google" || mode === "fire") setShowStreamers(true);
    }
    appsHoldFiredRef.current = false;
  };

  const startVolDownHold = () => {
    volDownHoldFiredRef.current = false;
    volDownHoldRef.current = setTimeout(() => {
      volDownHoldFiredRef.current = true;
      openPicCtrl();
    }, 500);
  };

  const stopVolDownHold = () => {
    clearTimeout(volDownHoldRef.current);
    if (!volDownHoldFiredRef.current) {
      if (isOff || isOther) return;
      flash("vold");
      fetch(`${TV_TV_URL}/tv/vol/down`).catch(() => {});
    }
    volDownHoldFiredRef.current = false;
  };

  const openPicCtrl = () => {
    setShowPicCtrl(true);
    fetchPicSettings();
    picPollRef.current = setInterval(() => fetchPicSettings(), 3000);
  };

  const closePicCtrl = () => {
    clearInterval(picPollRef.current);
    setShowPicCtrl(false);
  };

  const fetchPicSettings = async () => {
    try {
      const data = await fetch(`${TV_TV_URL}/tv/picture`).then((r) => r.json());
      if (data.ok) {
        setPicSettings(data.settings);
        setPicInputs((prev) => {
          const next = { ...prev };
          for (const s of data.settings) {
            if (next[s.target]?.typing) continue;
            next[s.target] = { typing: false, raw: s.value };
          }
          picInputsRef.current = next;
          return next;
        });
      }
    } catch (_) {}
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
      [setting.target]: { typing: false, raw: newVal },
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
    const inp = picInputsRef.current[setting.target];
    if (!inp?.typing) return;
    const num = Number(inp.raw);
    if (
      inp.raw === "" ||
      isNaN(num) ||
      num < setting.min ||
      num > setting.max
    ) {
      const revert = {
        ...picInputsRef.current,
        [setting.target]: { typing: false, raw: setting.value },
      };
      picInputsRef.current = revert;
      setPicInputs(revert);
      return;
    }
    const newVal = String(Math.round(num));
    const upd = {
      ...picInputsRef.current,
      [setting.target]: { typing: false, raw: newVal },
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

  const picInputChange = (setting, text) => {
    const upd = {
      ...picInputsRef.current,
      [setting.target]: { typing: true, raw: text },
    };
    picInputsRef.current = upd;
    setPicInputs(upd);
    schedulePicCommit(setting);
  };

  const startBackHold = () => {
    backHoldFiredRef.current = false;
    backHoldRef.current = setTimeout(() => {
      backHoldFiredRef.current = true;
      setShowKeybd(true);
    }, 1000);
  };

  const stopBackHold = () => {
    clearTimeout(backHoldRef.current);
    if (!backHoldFiredRef.current) {
      tvKey("back");
    }
    backHoldFiredRef.current = false;
  };

  const toggleLayoutOption = async () => {
    const next = layoutOption === "mark" ? "linda" : "mark";
    setLayoutOption(next);
    try {
      await AsyncStorage.setItem("layoutOption", next);
    } catch (_) {}
  };

  const startHomeHold = () => {
    homeHoldFiredRef.current = false;
    homeHoldRef.current = setTimeout(() => {
      homeHoldFiredRef.current = true;
      toggleLayoutOption();
    }, 2000);
  };

  const stopHomeHold = () => {
    clearTimeout(homeHoldRef.current);
    if (!homeHoldFiredRef.current) {
      tvKey("home");
    }
    homeHoldFiredRef.current = false;
  };

  const fetchSubPlayers = async () => {
    try {
      const data = await fetch(`${TV_TV_URL}/tv/emby/playing`).then((r) =>
        r.json(),
      );
      if (data.ok) {
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
    } catch (_) {}
  };

  const openSubCtrl = async () => {
    if (mode !== "google" && mode !== "fire") return;
    setShowSubCtrl(true);
    await fetchSubPlayers();
    subPollRef.current = setInterval(fetchSubPlayers, 3000);
  };

  const subTypeChar = (type) => {
    if (type === "pgs") return "*";
    if (type === "embedded") return "T";
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
    clearInterval(subPollRef.current);
    setShowSubCtrl(false);
  };

  const subSelectTrack = async (index) => {
    const player = subPlayers.find(
      (p) => (p.deviceName || p.sessionId) === subDeviceName,
    );
    if (!player) return;
    if (subNavigatingRef.current) return;
    if (checkBlocked()) return;
    notifyAction(true);
    const gen = ++subGenRef.current;
    clearInterval(subPollRef.current);
    subPollRef.current = null;
    subPendingRef.current = { deviceName: subDeviceName, index };
    subNavigatingRef.current = true;
    setSubPlayers((prev) => {
      const idx = prev.findIndex(
        (p) => (p.deviceName || p.sessionId) === subDeviceName,
      );
      if (idx < 0) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], subtitleStreamIndex: index };
      return next;
    });
    let waitMs = 4000;
    let navMs = waitMs;
    try {
      const resp = await fetch(`${TV_TV_URL}/tv/emby/subtitle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: player.sessionId, index }),
      });
      const data = await resp.json();
      waitMs = data.waitMs ?? 4000;
      navMs = data.navMs ?? waitMs;
    } catch (_) {}
    if (subGenRef.current !== gen) return;
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
    subPollRef.current = setInterval(fetchSubPlayers, 2000);
    await fetchSubPlayers();
  };

  const kybdSendText = async () => {
    const text = kybdInput.trim();
    if (!text) return;
    for (let i = 0; i < 50; i++) {
      try {
        await fetch(`${TV_TV_URL}/tv/keyevent/KEYCODE_DEL`);
      } catch (_) {}
    }
    try {
      await fetch(`${TV_TV_URL}/tv/text?t=${encodeURIComponent(text)}`);
    } catch (_) {}
    try {
      await fetch(`${TV_TV_URL}/tv/keyevent/KEYCODE_ENTER`);
    } catch (_) {}
    setKybdHistory((h) => {
      const next = [text, ...h.filter((i) => i !== text)];
      return next;
    });
    setKybdInput("");
  };

  const kybdSendKeyevent = async (code) => {
    try {
      await fetch(`${TV_TV_URL}/tv/keyevent/${code}`);
    } catch (_) {}
  };

  const kybdSendHaKey = async (key) => {
    try {
      await fetch(`${TV_TV_URL}/tv/key/${key}`);
    } catch (_) {}
  };

  const openApp = async (svc) => {
    if (isOff) return;
    if (checkBlocked()) return;
    notifyAction();
    setTimeout(() => setShowStreamers(false), 1000);
    try {
      await fetch(`${TV_TV_URL}/tv/openapp?uri=${encodeURIComponent(svc.uri)}`);
    } catch (_) {}
  };

  const isOff =
    !haState ||
    haState === "off" ||
    haState === "unavailable" ||
    haState === "unknown";

  const mode = (() => {
    if (isOff) return "off";
    if (mediaTitle === "Smart TV") return "google";
    if (mediaTitle === "TV") return "tv";
    if (mediaTitle === "Fire TV Stick" || mediaTitle === "HDMI 2")
      return "fire";
    return "other";
  })();

  const isOther = mode === "other";
  const services = allServices[mode] ?? [];
  // Background color helpers (mirror Vue cellStyle / computed props)
  const cellBg = (defaultBg, key) => (flashBtn === key ? "orange" : defaultBg);

  const muteBg =
    flashBtn === "mute" ? "orange" : !isOff && muted ? "#ffb3b3" : "lightgreen";

  const offBg = flashBtn === "off" ? "orange" : isOff ? "lightblue" : "white";

  const modeBg = (m) => {
    if (flashBtn === m) return "orange";
    if (m === "google" && mode === "tv") return "#ffb3c1";
    return mode === m ? "lightblue" : "white";
  };

  // Button definitions — matches tvpane.vue grid order (row-major, 3 cols x 5 rows)
  const buttons = [
    // Row 1: back, up, home
    {
      key: "back",
      label: "↩",
      largeText: true,
      bg: () => cellBg("white", "back"),
      onPress: () => {},
      onPressIn: () => startBackHold(),
      onPressOut: () => stopBackHold(),
    },
    {
      key: "up",
      label: "▲",
      bg: () => cellBg("#f5e642", "up"),
      onPress: () => {},
      onPressIn: () => startRepeat("up"),
      onPressOut: stopRepeat,
    },
    {
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
      onPressIn: () => {
        stopRepeat();
        tvKey("ok");
      },
    },
    {
      key: "right",
      label: "▶",
      bg: () => cellBg("#f5e642", "right"),
      onPress: () => {},
      onPressIn: () => startRepeat("right"),
      onPressOut: stopRepeat,
    },
    // Row 3: emby, down, keyboard (A — no action in web version)
    {
      key: "emby",
      label: "Emby",
      smallText: true,
      bg: () => cellBg("white", "emby"),
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
    layoutOption === "mark"
      ? {
          key: "shows",
          label: "Shows",
          smallText: true,
          bg: () => cellBg("white", "shows"),
          onPress: () => {},
          onPressIn: () => setShowShows(true),
        }
      : {
          key: "stream",
          label: "Apps",
          smallText: true,
          bg: () => cellBg("white", "stream"),
          onPress: () => {},
          onPressIn: () => startAppsHold(),
          onPressOut: () => stopAppsHold(),
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
      onPressIn: () => {
        if (isOff || isOther) return;
        flash("volu");
        fetch(`${TV_TV_URL}/tv/vol/up`).catch(() => {});
      },
    },
    {
      key: "mute",
      label: "Mute",
      smallText: true,
      bg: () => muteBg,
      onPress: () => {},
      onPressIn: () => tvCmd("mute"),
    },
    // Row 5: subs, fire, google
    layoutOption === "linda"
      ? {
          key: "shows",
          label: "Shows",
          smallText: true,
          bg: () => cellBg("white", "shows"),
          onPress: () => {},
          onPressIn: () => setShowShows(true),
        }
      : {
          key: "subs",
          label: "Subs",
          smallText: true,
          bg: () => cellBg("white", "subs"),
          onPress: () => {},
          onPressIn: () => openSubCtrl(),
        },
    {
      key: "fire",
      label: "Fire",
      tinyText: true,
      bg: () => modeBg("fire"),
      onPress: () => {},
      onPressIn: () => startHold(() => fireBtn()),
      onPressOut: stopHold,
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
                  </Text>
                </TouchableOpacity>
              ))}
            </>
          )}
        </ScrollView>
        <TouchableOpacity
          onPress={subClose}
          style={subCtrlStyles.closeBtn}
          activeOpacity={0.7}
        >
          <Text style={subCtrlStyles.closeBtnText}>Close</Text>
        </TouchableOpacity>
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
                A remote collision has been detected and the remote has been
                locked. Press and hold unlock button to continue.
              </Text>
            </View>
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

  if (showKeybd) {
    return (
      <View style={kybdStyles.container}>
        <StatusBar hidden />
        <View style={kybdStyles.inputRow}>
          <TextInput
            ref={kybdInputRef}
            style={kybdStyles.textInput}
            value={kybdInput}
            onChangeText={setKybdInput}
            placeholder="Type here..."
            onSubmitEditing={kybdSendText}
            returnKeyType="send"
            autoFocus
          />
          <TouchableOpacity
            onPress={() => setShowKeybd(false)}
            style={kybdStyles.closeBtn}
          >
            <Text style={kybdStyles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>
        <ScrollView style={kybdStyles.historyList}>
          {kybdHistory.map((item, idx) => (
            <TouchableOpacity
              key={idx}
              onPress={() => {
                kybdInputRef.current?.focus();
                setKybdInput(item);
              }}
              style={[
                kybdStyles.historyItem,
                { backgroundColor: idx % 2 === 0 ? "#fafafa" : "#fff" },
              ]}
            >
              <Text style={kybdStyles.historyItemText}>{item}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
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

    const getCellBg = (cell) => {
      if (!cell || cell.avail) return { backgroundColor: "white" };
      return { backgroundColor: "#fcc" };
    };

    const getCellText = (cell) => {
      if (!cell) return "";
      const w = cell.unaired ? "U" : cell.played ? "W" : "";
      return w + (cell.avail ? "+" : "-");
    };

    const renderListContent = () => {
      const filtered = showSearch
        ? showsList.filter((s) =>
            s.name.toLowerCase().includes(showSearch.toLowerCase()),
          )
        : showsList;
      const initialIdx = showSearch
        ? 0
        : Math.max(
            0,
            showsList.findIndex((s) => s.name === show?.name),
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
              onPress={() => {
                showSelectedRef.current = { name: item.name };
                setShowSearch("");
                setSelectedShow(item);
                followPlayingRef.current = false;
                setFollowPlaying(false);
                setSelectedSE(null);
                setActiveTab("Info");
              }}
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
                              {getCellText(cell)}
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
                            {fmt(totalSec)}
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

    const renderEpiSubsContent = () => {
      const epName = episodeInfo?.name ?? "";
      const isSeason = /^Season\s+\d+$/i.test(epName);
      const displayName = isSeason ? "" : epName;
      const seStr = selectedSE
        ? `S${String(selectedSE.s).padStart(2, "0")}E${String(selectedSE.e).padStart(2, "0")}`
        : "";
      const headerText = displayName ? `${displayName} (${seStr})` : seStr;
      return (
        <View style={{ flex: 1 }}>
          {displayName || seStr ? (
            <View
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderBottomWidth: 1,
                borderBottomColor: "#ccc",
                backgroundColor: "#f8f8f8",
              }}
            >
              <Text style={{ fontSize: fs(24) }}>
                {displayName ? (
                  <>
                    <Text style={{ fontWeight: "bold" }}>{displayName}</Text>
                    {seStr ? (
                      <Text style={{ fontWeight: "normal" }}>
                        {" (" + seStr + ")"}
                      </Text>
                    ) : null}
                  </>
                ) : (
                  <Text>{seStr}</Text>
                )}
              </Text>
            </View>
          ) : null}
          <ScrollView style={{ flex: 1, backgroundColor: "#fff" }}>
            {!selectedSE ? (
              <Text style={subCtrlStyles.noVideo}>No episode selected.</Text>
            ) : epiSubTracks.length === 0 ? (
              <Text style={subCtrlStyles.noVideo}>No subtitles found.</Text>
            ) : (
              epiSubTracks.map((sub, idx) => (
                <View key={idx} style={subCtrlStyles.card}>
                  <Text style={subCtrlStyles.cardText}>
                    {subTypeChar(sub.type)}: {subShortLabel(sub.label)}
                  </Text>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      );
    };

    const handleTabPress = (tab) => {
      setShowSearch("");
      setShowEpiSubs(false);
      setActiveTab(tab);
    };

    const handleClose = () => {
      setShowSearch("");
      setShowEpiSubs(false);
      setShowShows(false);
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
          {["List", "Info", "Map", "Actors"].map((tab) => (
            <TouchableOpacity
              key={tab}
              onPress={() => handleTabPress(tab)}
              style={[
                showsStyles.tabBtn,
                !showEpiSubs && activeTab === tab && showsStyles.tabBtnActive,
              ]}
            >
              <Text style={showsStyles.tabBtnText}>{tab}</Text>
            </TouchableOpacity>
          ))}
          {layoutOption !== "linda" && (
            <TouchableOpacity
              onPress={() => {
                setShowEpiSubs(true);
                if (selectedSE && selectedShow) {
                  fetch(
                    `${TV_SRVR_HTTP_URL}/api/episodeSubs?show=${encodeURIComponent(selectedShow.name)}&s=${selectedSE.s}&e=${selectedSE.e}`,
                  )
                    .then((r) => r.json())
                    .then((tracks) =>
                      setEpiSubTracks(Array.isArray(tracks) ? tracks : []),
                    )
                    .catch(() => setEpiSubTracks([]));
                } else {
                  setEpiSubTracks([]);
                }
              }}
              style={[
                showsStyles.closeTabBtn,
                showEpiSubs && showsStyles.tabBtnActive,
              ]}
            >
              <Text style={showsStyles.tabBtnText}>Subs</Text>
            </TouchableOpacity>
          )}
        </View>
        {!showEpiSubs && activeTab === "List" && (
          <TextInput
            style={showsStyles.searchInput}
            value={showSearch}
            onChangeText={setShowSearch}
            placeholder="Search shows..."
            placeholderTextColor="#aaa"
            autoCorrect={false}
            autoCapitalize="none"
          />
        )}
        <View style={showsStyles.contentPane}>
          {showEpiSubs ? (
            renderEpiSubsContent()
          ) : (
            <>
              {activeTab === "List" && renderListContent()}
              {activeTab === "Info" && renderInfoContent()}
              {activeTab === "Map" && renderMapContent()}
              {activeTab === "Actors" && renderActorsContent()}
            </>
          )}
        </View>
        <TouchableOpacity
          onPress={handleClose}
          style={subCtrlStyles.closeBtn}
          activeOpacity={0.7}
        >
          <Text style={subCtrlStyles.closeBtnText}>Close</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (showPicCtrl) {
    return (
      <View style={styles.container}>
        <StatusBar hidden />
        <View style={picCtrlStyles.header}>
          <Text style={picCtrlStyles.headerTitle}>Picture Settings</Text>
          <TouchableOpacity
            onPress={closePicCtrl}
            style={picCtrlStyles.closeBtn}
          >
            <Text style={picCtrlStyles.closeBtnText}>✕</Text>
          </TouchableOpacity>
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
                  onFocus={() => {
                    const upd = {
                      ...picInputsRef.current,
                      [s.target]: { typing: true, raw: "" },
                    };
                    picInputsRef.current = upd;
                    setPicInputs(upd);
                  }}
                  onChangeText={(t) => picInputChange(s, t)}
                  onBlur={() => commitPicInput(s)}
                  onSubmitEditing={() => commitPicInput(s)}
                  returnKeyType="done"
                />
              ) : (
                <Text style={picCtrlStyles.value}>{s.value}</Text>
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
      </View>
    );
  }

  if (showStreamers) {
    return (
      <View style={styles.container}>
        <StatusBar hidden />
        <View style={streamerStyles.header}>
          <Text style={streamerStyles.headerTitle}>Streaming Services</Text>
          <TouchableOpacity
            onPress={() => setShowStreamers(false)}
            style={streamerStyles.closeBtn}
          >
            <Text style={streamerStyles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>
        <ScrollView style={streamerStyles.list}>
          <View style={streamerStyles.pinnedRow}>
            {["Netflix", "Prime Video", "HBO Max"]
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
              A remote collision has been detected and the remote has been
              locked. Press and hold unlock button to continue.
            </Text>
          </View>
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
    backgroundColor: "lightgreen",
    alignItems: "center",
    justifyContent: "center",
    height: 80,
    flexShrink: 0,
  },
  closeBtnText: {
    fontSize: fs(39),
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
