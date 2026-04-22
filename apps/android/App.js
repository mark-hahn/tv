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
  const [subPlayerIdx, setSubPlayerIdx] = useState(0);
  const [subOffset, setSubOffset] = useState(0);

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

  const debounce = () => {
    const now = Date.now();
    const ok = now - lastCmdRef.current >= 250;
    lastCmdRef.current = now;
    return ok;
  };

  const startRepeat = (key) => {
    if (isOff || isOther) return;
    if (!debounce()) return;
    flash(key);
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
    };
  }, []);

  const flash = (btn) => {
    setFlashBtn(btn);
    setTimeout(() => setFlashBtn(null), 150);
  };

  const tvCmd = async (cmd) => {
    if (isOff || isOther) return;
    flash(cmd);
    if (!debounce()) return;
    try {
      const res = await fetch(`${TV_TV_URL}/tv/${cmd}`);
      const data = await res.json();
      if (cmd === "mute" && data.ok) setMuted(data.muted);
    } catch (_) {}
  };

  const tvKey = async (key) => {
    if (isOff || isOther) return;
    if (!debounce()) return;
    flash(key);
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
    if (mode === "google") {
      tvCmd("off");
    } else {
      flash("google");
      fetch(`${TV_TV_URL}/tv/googlebtn`).catch(() => {});
    }
  };

  const fireBtn = async () => {
    if (mode === "fire") {
      tvCmd("off");
    } else {
      flash("fire");
      fetch(`${TV_TV_URL}/tv/firebtn`).catch(() => {});
    }
  };

  const startEmbyHold = () => {
    embyHoldFiredRef.current = false;
    embyHoldRef.current = setTimeout(() => {
      embyHoldFiredRef.current = true;
      openSubCtrl();
    }, 1000);
  };

  const stopEmbyHold = () => {
    clearTimeout(embyHoldRef.current);
    if (!embyHoldFiredRef.current) {
      tvCmd("emby");
    }
    embyHoldFiredRef.current = false;
  };

  const openSubCtrl = async () => {
    setShowSubCtrl(true);
    setSubOffset(0);
    setSubPlayerIdx(0);
    try {
      const data = await fetch(`${TV_TV_URL}/tv/emby/playing`).then((r) =>
        r.json(),
      );
      if (data.ok) setSubPlayers(data.playing);
    } catch (_) {}
  };

  const subCyclePlayer = () => {
    setSubPlayerIdx((i) => (i + 1) % Math.max(subPlayers.length, 1));
    setSubOffset(0);
  };

  const subClose = () => setShowSubCtrl(false);

  const subSaveAndClose = () => setShowSubCtrl(false);

  const subAdjustOffset = async (deltaMs) => {
    const newOffset = subOffset + deltaMs;
    setSubOffset(newOffset);
    const player = subPlayers[subPlayerIdx];
    if (!player) return;
    try {
      await fetch(`${TV_TV_URL}/tv/emby/subtitle-offset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: player.sessionId,
          offsetMs: newOffset,
        }),
      });
    } catch (_) {}
  };

  const subSelectTrack = async (index) => {
    const player = subPlayers[subPlayerIdx];
    if (!player) return;
    setSubPlayers((prev) => {
      const next = [...prev];
      next[subPlayerIdx] = {
        ...next[subPlayerIdx],
        subtitleStreamIndex: index,
      };
      return next;
    });
    try {
      await fetch(`${TV_TV_URL}/tv/emby/subtitle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: player.sessionId, index }),
      });
    } catch (_) {}
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
      onPressIn: () => {
        if (mode === "google" || mode === "fire") setShowStreamers(true);
      },
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
    // Row 5: keybd, fire, google
    {
      key: "keybd",
      label: null,
      icon: <MaterialIcons name="keyboard" size={42} color="black" />,
      bg: () => cellBg("white", "keybd"),
      onPress: () => {},
      onPressIn: () =>
        startHold(() => {
          flash("keybd");
          setTimeout(() => setShowKeybd(true), 500);
        }),
      onPressOut: () => clearTimeout(holdRef.current),
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
    const currentPlayer = subPlayers[subPlayerIdx] ?? null;
    return (
      <View style={subCtrlStyles.container}>
        <StatusBar hidden />
        {/* Header row 1: show name + offset + close */}
        <View style={subCtrlStyles.headerRow1}>
          <TouchableOpacity onPress={subCyclePlayer} style={{ flex: 1 }}>
            <Text style={subCtrlStyles.showName} numberOfLines={1}>
              {currentPlayer ? currentPlayer.showName : "No video playing"}
            </Text>
          </TouchableOpacity>
          {subOffset !== 0 && (
            <Text style={subCtrlStyles.offsetText}>
              {subOffset > 0 ? "+" : ""}
              {subOffset}ms
            </Text>
          )}
          <TouchableOpacity onPress={subClose} style={subCtrlStyles.closeBtn}>
            <Text style={subCtrlStyles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>
        {/* Header row 2: left arrow, OK, right arrow */}
        <View style={subCtrlStyles.headerRow2}>
          <TouchableOpacity
            style={subCtrlStyles.arrowBtn}
            onPress={() => subAdjustOffset(-100)}
          >
            <Text style={subCtrlStyles.arrowText}>◀</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={subCtrlStyles.okBtn}
            onPress={subSaveAndClose}
          >
            <Text style={subCtrlStyles.okText}>OK</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[subCtrlStyles.arrowBtn, { borderRightWidth: 0 }]}
            onPress={() => subAdjustOffset(100)}
          >
            <Text style={subCtrlStyles.arrowText}>▶</Text>
          </TouchableOpacity>
        </View>
        {/* Subtitle list */}
        <ScrollView style={{ flex: 1 }}>
          {!currentPlayer ? (
            <Text style={subCtrlStyles.noVideo}>No video playing</Text>
          ) : (
            <>
              <TouchableOpacity
                onPress={() => subSelectTrack(-1)}
                style={[
                  subCtrlStyles.card,
                  currentPlayer.subtitleStreamIndex === -1 &&
                    subCtrlStyles.cardSelected,
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
                    currentPlayer.subtitleStreamIndex === sub.index &&
                      subCtrlStyles.cardSelected,
                  ]}
                >
                  <Text
                    style={[
                      subCtrlStyles.cardText,
                      currentPlayer.subtitleStreamIndex === sub.index &&
                        subCtrlStyles.cardTextSelected,
                    ]}
                  >
                    {sub.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </>
          )}
        </ScrollView>
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
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "#999",
    borderRadius: 5,
  },
  closeBtnText: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#000",
    lineHeight: 18,
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
  offsetText: {
    fontSize: 13,
    color: "#555",
  },
  closeBtn: {
    padding: 8,
  },
  closeBtnText: {
    fontSize: 20,
    color: "#000",
  },
  headerRow2: {
    flexDirection: "row",
    height: 80,
    borderBottomWidth: 3,
    borderBottomColor: "#000",
  },
  arrowBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f5e642",
    borderRightWidth: 3,
    borderRightColor: "#000",
  },
  okBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "lightgreen",
    borderRightWidth: 3,
    borderRightColor: "#000",
  },
  arrowText: {
    fontSize: 42,
    fontWeight: "bold",
    color: "#000",
  },
  okText: {
    fontSize: 42,
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
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
    backgroundColor: "#fff",
  },
  cardSelected: {
    backgroundColor: "#d0e8ff",
  },
  cardText: {
    fontSize: 18,
    color: "#000",
  },
  cardTextSelected: {
    fontWeight: "bold",
  },
});
