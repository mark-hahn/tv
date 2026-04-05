import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  StatusBar,
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";

const TV_TV_URL = "https://hahnca.com/tv-tv";

const COLS = 3;
const ROWS = 5;
const BORDER = 3;
const { width, height } = Dimensions.get("window");
const CELL_W = (width - BORDER * (COLS + 1)) / COLS;
const CELL_H = (height - BORDER * (ROWS + 1)) / ROWS;

export default function App() {
  const [mode, setModeState] = useState("google");
  const [muted, setMuted] = useState(false);
  const [power, setPower] = useState("unknown");
  const [flashBtn, setFlashBtn] = useState(null);

  const muteTimerRef = useRef(null);

  const pollMute = async () => {
    try {
      const res = await fetch(`${TV_TV_URL}/tv/mutestate`);
      const data = await res.json();
      if (data.ok) {
        if (data.muted !== null) setMuted(data.muted);
        if (data.power) setPower(data.power);
      }
    } catch (_) {}
  };

  useEffect(() => {
    pollMute();
    muteTimerRef.current = setInterval(pollMute, 3000);
    return () => clearInterval(muteTimerRef.current);
  }, []);

  const flash = (btn) => {
    setFlashBtn(btn);
    setTimeout(() => setFlashBtn(null), 150);
  };

  const startFastPoll = () => {
    clearInterval(muteTimerRef.current);
    const startedAt = Date.now();
    muteTimerRef.current = setInterval(() => {
      pollMute();
      if (Date.now() - startedAt > 30000) {
        clearInterval(muteTimerRef.current);
        muteTimerRef.current = setInterval(pollMute, 3000);
      }
    }, 500);
  };

  const tvCmd = async (cmd) => {
    try {
      const res = await fetch(`${TV_TV_URL}/tv/${cmd}`);
      const data = await res.json();
      if (cmd === "mute" && data.ok) setMuted(data.muted);
    } catch (_) {}
  };

  const tvKey = async (key) => {
    try {
      await fetch(`${TV_TV_URL}/tv/key/${key}`);
    } catch (_) {}
  };

  const handleSetMode = async (m) => {
    flash(m);
    setModeState(m);
    try {
      await fetch(`${TV_TV_URL}/tv/mode/${m}`);
    } catch (_) {}
    startFastPoll();
  };

  const isOff = power === "off" || power === "standby";

  // Background color helpers (mirror Vue cellStyle / computed props)
  const cellBg = (defaultBg, key) => (flashBtn === key ? "#90ee90" : defaultBg);

  const muteBg = flashBtn === "mute" ? "#90ee90" : muted ? "#ffb3b3" : "white";

  const offBg = flashBtn === "off" ? "#90ee90" : isOff ? "lightblue" : "white";

  const modeBg = (m) => {
    if (flashBtn === m) return "#90ee90";
    if (!isOff && mode === m) return "lightblue";
    return "white";
  };

  // Button definitions — matches tvpane.vue grid order (row-major, 3 cols x 5 rows)
  const buttons = [
    // Row 1: back, up, home
    {
      key: "back",
      label: "↩",
      largeText: true,
      bg: () => cellBg("white", "back"),
      onPress: () => {
        flash("back");
        tvKey("back");
      },
    },
    {
      key: "up",
      label: "▲",
      bg: () => cellBg("#fffde7", "up"),
      onPress: () => {
        flash("up");
        tvKey("up");
      },
    },
    {
      key: "home",
      label: null,
      icon: <MaterialIcons name="home" size={42} color="black" />,
      bg: () => cellBg("white", "home"),
      onPress: () => {
        flash("home");
        tvKey("home");
      },
    },
    // Row 2: left, ok, right
    {
      key: "left",
      label: "◀",
      bg: () => cellBg("#fffde7", "left"),
      onPress: () => {
        flash("left");
        tvKey("left");
      },
    },
    {
      key: "ok",
      label: "OK",
      bg: () => cellBg("#e8f5e9", "ok"),
      onPress: () => {
        flash("ok");
        tvKey("ok");
      },
    },
    {
      key: "right",
      label: "▶",
      bg: () => cellBg("#fffde7", "right"),
      onPress: () => {
        flash("right");
        tvKey("right");
      },
    },
    // Row 3: emby, down, keyboard (A — no action in web version)
    {
      key: "emby",
      label: "E",
      bg: () => cellBg("white", "emby"),
      onPress: () => {
        flash("emby");
        tvCmd("emby");
      },
    },
    {
      key: "down",
      label: "▼",
      bg: () => cellBg("#fffde7", "down"),
      onPress: () => {
        flash("down");
        tvKey("down");
      },
    },
    {
      key: "keyboard",
      label: "A",
      bg: () => cellBg("white", "keyboard"),
      onPress: () => {},
    },
    // Row 4: vol-, vol+, mute
    {
      key: "vold",
      label: "Vol-",
      bg: () => cellBg("white", "vold"),
      onPress: () => {
        flash("vold");
        tvCmd("vol/down");
      },
    },
    {
      key: "volu",
      label: "Vol+",
      bg: () => cellBg("white", "volu"),
      onPress: () => {
        flash("volu");
        tvCmd("vol/up");
      },
    },
    {
      key: "mute",
      label: "Mute",
      bg: () => muteBg,
      onPress: () => {
        flash("mute");
        tvCmd("mute");
      },
    },
    // Row 5: google, roku, off
    {
      key: "google",
      label: "Google",
      smallText: true,
      bg: () => modeBg("google"),
      onPress: () => handleSetMode("google"),
    },
    {
      key: "roku",
      label: "Roku",
      smallText: true,
      bg: () => modeBg("roku"),
      onPress: () => handleSetMode("roku"),
    },
    {
      key: "off",
      label: "Off",
      smallText: true,
      bg: () => offBg,
      onPress: () => {
        flash("off");
        tvCmd("off");
      },
    },
  ];

  return (
    <View style={styles.container}>
      <StatusBar hidden />
      <View style={styles.grid}>
        {buttons.map((btn) => (
          <TouchableOpacity
            key={btn.key}
            style={[styles.cell, { backgroundColor: btn.bg() }]}
            onPress={btn.onPress}
            activeOpacity={1}
          >
            {btn.icon ? (
              btn.icon
            ) : (
              <Text
                style={[
                  styles.cellText,
                  btn.smallText && styles.cellTextSmall,
                  btn.largeText && styles.cellTextLarge,
                ]}
              >
                {btn.label}
              </Text>
            )}
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  grid: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    padding: BORDER,
    gap: BORDER,
    backgroundColor: "#000",
  },
  cell: {
    width: CELL_W,
    height: CELL_H,
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
  cellTextLarge: {
    fontSize: 84,
  },
});
