import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import allServices from "./services.json";

const TV_TV_URL = "https://hahnca.com/tv-tv";
const TV_SRVR_WS_URL = "wss://hahnca.com/tv-srvr";

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
  const [locked, setLocked] = useState(false);
  const [missingEpWarning, setMissingEpWarning] = useState(null);

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
  const subPollRef = useRef(null);
  const subPendingRef = useRef(null); // { deviceName, index } while optimistic highlight is active
  const subGenRef = useRef(0);
  const subNavigatingRef = useRef(false);
  const avoidingRef = useRef(false);
  const avoidTimerRef = useRef(null);
  const unlockHoldTimerRef = useRef(null);

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
    return () => {
      if (wsRef.current) wsRef.current.onclose = null;
      wsRef.current?.close();
      repeatActiveRef.current = false;
      volActiveRef.current = false;
      clearTimeout(repeatDelayRef.current);
      clearTimeout(repeatTimeoutRef.current);
      clearTimeout(holdRef.current);
      clearInterval(subPollRef.current);
      clearTimeout(avoidTimerRef.current);
      clearTimeout(unlockHoldTimerRef.current);
    };
  }, []);

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
    embyHoldRef.current = setTimeout(() => {
      embyHoldFiredRef.current = true;
    }, 1000);
  };

  const stopEmbyHold = () => {
    clearTimeout(embyHoldRef.current);
    if (!embyHoldFiredRef.current) {
      if (showSubCtrl) {
        subClose();
      } else {
        tvCmd("emby");
      }
    }
    embyHoldFiredRef.current = false;
  };

  const startAppsHold = () => {
    appsHoldFiredRef.current = false;
    appsHoldRef.current = setTimeout(() => {
      appsHoldFiredRef.current = true;
      setShowKeybd(true);
    }, 1000);
  };

  const stopAppsHold = () => {
    clearTimeout(appsHoldRef.current);
    if (!appsHoldFiredRef.current) {
      if (mode === "google" || mode === "fire") setShowStreamers(true);
    }
    appsHoldFiredRef.current = false;
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
      onPressIn: () => tvKey("back"),
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
      onPressIn: () => tvKey("home"),
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
    {
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
      onPressIn: () => {
        if (isOff || isOther) return;
        flash("vold");
        fetch(`${TV_TV_URL}/tv/vol/down`).catch(() => {});
      },
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
    {
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
        <View style={subCtrlStyles.container}>
          {/* Header row 1: show name + offset + close */}
          <View style={subCtrlStyles.headerRow1}>
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
                  const active = currentPlayer.subtitles.find(
                    (s) => s.index === currentPlayer.subtitleStreamIndex,
                  );
                  return active ? base : base;
                })()}
              </Text>
            </TouchableOpacity>
          </View>
          {/* Subtitle list */}
          <ScrollView style={{ flex: 1, minHeight: 0 }}>
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
    fontSize: 42,
    fontWeight: "bold",
    color: "#000",
  },
  cellTextSmall: {
    fontSize: 28,
  },
  cellTextTiny: {
    fontSize: 20,
  },
  cellTextLarge: {
    fontSize: 84,
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
    fontSize: 20,
    fontWeight: "bold",
  },
  closeBtn: {
    padding: 8,
  },
  closeBtnText: {
    color: "#fff",
    fontSize: 28,
    lineHeight: 32,
  },
  list: {
    flex: 1,
    padding: 8,
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
    fontSize: 13,
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
    fontSize: 16,
    borderWidth: 1,
    borderColor: "#bbb",
    borderRadius: 5,
    backgroundColor: "#fff",
    textAlign: "left",
  },
  closeBtn: {
    backgroundColor: "lightgreen",
    borderTopWidth: 3,
    borderTopColor: "#000",
    alignItems: "center",
    justifyContent: "center",
    height: "20%",
    flexShrink: 0,
  },
  closeBtnText: {
    fontSize: 39,
    fontWeight: "bold",
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
    fontSize: 15,
  },
});

const subCtrlStyles = StyleSheet.create({
  container: {
    flex: 1,
    borderWidth: 3,
    borderColor: "#000",
    backgroundColor: "#fff",
  },
  headerRow1: {
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
    borderBottomWidth: 3,
    borderBottomColor: "#000",
    gap: 8,
  },
  showName: {
    flex: 1,
    fontSize: 16,
    fontWeight: "bold",
    color: "#000",
  },
  closeBtn: {
    backgroundColor: "lightgreen",
    alignItems: "center",
    justifyContent: "center",
    height: 80,
    flexShrink: 0,
  },
  closeBtnText: {
    fontSize: 39,
    fontWeight: "bold",
    color: "#000",
  },
  noVideo: {
    padding: 20,
    textAlign: "center",
    color: "#999",
    fontSize: 16,
  },
  card: {
    padding: 28,
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
    backgroundColor: "#fff",
  },
  cardSelected: {
    backgroundColor: "#d0e8ff",
  },
  cardText: {
    fontSize: 27,
    color: "#000",
  },
  cardTextSelected: {
    fontWeight: "bold",
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
    fontSize: 42,
    fontWeight: "bold",
    padding: 10,
    paddingBottom: 6,
  },
  message: {
    fontSize: 25,
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
    fontSize: 39,
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
    fontSize: 16,
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
    fontSize: 16,
    fontWeight: "bold",
  },
});
