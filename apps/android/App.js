import React, { useState, useEffect, useRef } from "react";
import { View, Text, StyleSheet, StatusBar } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";

const TV_TV_URL = "https://hahnca.com/tv-tv";
const TV_SRVR_WS_URL = "wss://hahnca.com/tv-srvr";

const COLS = 3;
const ROWS = 5;
const BORDER = 13;
const SCREEN_MARGIN = 30;

export default function App() {
  const [muted, setMuted] = useState(false);
  const [cellDims, setCellDims] = useState({ w: 0, h: 0 });

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
          mode === "fire" && key === "left"
            ? isFast
              ? 9
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
    flash("google");
    fetch(`${TV_TV_URL}/tv/googlebtn`).catch(() => {});
  };

  const fireBtn = async () => {
    flash("fire");
    fetch(`${TV_TV_URL}/tv/firebtn`).catch(() => {});
  };

  const isOff =
    !haState ||
    haState === "off" ||
    haState === "unavailable" ||
    haState === "unknown";

  const mode = (() => {
    if (isOff) return "off";
    if (mediaTitle === "Smart TV") return "google";
    if (mediaTitle === "Fire TV Stick" || mediaTitle === "HDMI 2")
      return "fire";
    return "other";
  })();

  const isOther = mode === "other";
  // Background color helpers (mirror Vue cellStyle / computed props)
  const cellBg = (defaultBg, key) => (flashBtn === key ? "orange" : defaultBg);

  const muteBg =
    flashBtn === "mute" ? "orange" : !isOff && muted ? "#ffb3b3" : "lightgreen";

  const offBg = flashBtn === "off" ? "orange" : isOff ? "lightblue" : "white";

  const modeBg = (m) => {
    if (flashBtn === m) return "orange";
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
      onPressIn: () => tvKey("up"),
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
      onPressIn: () => tvCmd("emby"),
    },
    {
      key: "down",
      label: "▼",
      bg: () => cellBg("#f5e642", "down"),
      onPress: () => {},
      onPressIn: () => tvKey("down"),
    },
    {
      key: "keyboard",
      label: "ABC",
      smallText: true,
      bg: () => cellBg("white", "keyboard"),
      onPress: () => {},
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
    // Row 5: google, roku, off
    {
      key: "google",
      label: "Google",
      tinyText: true,
      bg: () => modeBg("google"),
      onPress: () => {},
      onPressIn: () => startHold(() => googleBtn()),
      onPressOut: stopHold,
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
      key: "off",
      label: "Off",
      tinyText: true,
      bg: () => offBg,
      onPress: () => {},
      onPressIn: () =>
        startHold(() => {
          flash("off");
          tvCmd("off");
        }),
      onPressOut: stopHold,
    },
  ];

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
