// tvappctrl — the phone side of apps/tvapp, the app sideloaded on the tv.
//
// Two exports, because the two have different lifetimes:
//
//   useTvappLink  the socket, held for as long as the app runs. It has to outlive
//                 the screen: being told tvapp just opened on the tv is what opens
//                 the screen, so something must be listening while the remote is
//                 the thing on display.
//   TvAppCtrl     the screen itself — blank but for an Exit button, and a drag
//                 surface for the tv's cursor. A keyboard joins them while the
//                 tv's filter box is in use, that box having no keyboard of its
//                 own to be typed into.
//
// The two ends stay in step in all four directions: tvapp opening or closing on
// the tv opens or closes this screen, and opening or closing this screen opens or
// closes tvapp.
//
// It talks over the LAN rather than through tv-srvr, because a finger drag sends
// motion at 60 Hz and must not round-trip through the public endpoint. It cannot
// reach the tv directly though — the tv answers no wireless host here — so
// tv-tv's relay bridges the last hop. See startTvappctrlRelay in
// apps/tv/src/main.js. There is no discovery: every address is a constant.
//
// The cursor protocol is hand-mirrored in
// apps/tvapp/app/src/main/java/com/hahnca/tvapp/CtrlServer.java — tvapp is Java
// and cannot import from here, so a change on one side is a change on both, in
// the same session. The relay's own control messages are mirrored in
// apps/tv/src/main.js.
//
// Deliberately not mirrored into the web client's tv pane: there is no tv pane
// counterpart to this screen and there is not meant to be one.

import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  PermissionsAndroid,
  StatusBar,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
} from "react-native";
import * as ScreenOrientation from "expo-screen-orientation";
import * as NavigationBar from "expo-navigation-bar";

// Not the tv itself: the tv answers no wireless host on this LAN, and the phone
// is on wifi. This is hahnca.com's *lan* address, which is wired, and tv-tv
// relays the rest of the way (see startTvappctrlRelay in apps/tv/src/main.js).
// Both legs are single lan hops — nothing goes out to the public endpoint.
const TVAPP_HOST = "192.168.1.103";
const TVAPP_PORT = 8098;
const RECONNECT_MS = 2000;
// An unreachable host can sit in CONNECTING far longer than the OS timeout is
// worth waiting for, so a connect that has not opened by now is given up on.
const CONNECT_TIMEOUT_MS = 5000;
// Phone drag units to tv pixels. tvapp's window is 1920x1080, so 3 puts a
// full-width swipe a bit past halfway across the tv.
const CURSOR_SPEED = 3;
// A press is a tap, not a drag, only if it barely moved and was let go quickly.
const TAP_MAX_MOVE = 8;
const TAP_MAX_MS = 300;
// Motion is coalesced to one message per frame instead of one per touch event.
const SEND_INTERVAL_MS = 16;
// Where the Exit button sits, per orientation. Portrait keeps clear of the camera
// cutout row, which hiding the status bar does not free up. Landscape is inset from
// both bezels instead: the cutout is centred on a side edge there, and with the
// status and navigation bars hidden the window runs edge to edge, so without an
// inset of its own the button ends up jammed into the corner.
const STATUS_BAR_HEIGHT = StatusBar.currentHeight ?? 0;
const EXIT_TOP = STATUS_BAR_HEIGHT + 8;
const EXIT_TOP_LANDSCAPE = 24;
const EXIT_RIGHT = 10;
const EXIT_RIGHT_LANDSCAPE = 56;
// The filter field shares that row, taking the rest of it: it is only up while
// the tv asks for it, and the Exit button has to stay reachable underneath.
const FILTER_LEFT = 10;
const FILTER_EXIT_GAP = 60;

// Android 16 and up refuse a connection to a LAN address unless the app holds
// this, declared in android/app/src/main/AndroidManifest.xml and granted at
// runtime. On older Android the request just comes back denied and the socket
// works anyway, so the result is never acted on.
const LOCAL_NETWORK_PERMISSION = "android.permission.ACCESS_LOCAL_NETWORK";

// Forwarded through the relay to tvapp, which reads them (CtrlServer.java).
const CMD_MOVE = "m";
const CMD_CLICK = "c";
const CMD_EXIT = "x";
const CMD_FILTER = "f";
const CMD_KEYBOARD_CLOSED = "e";
// From tvapp, forwarded back the same way: its filter box was clicked, so the
// keyboard this screen has no other reason to show has to come up, or go away.
const MSG_KEYBOARD_ON = "s";
const MSG_KEYBOARD_OFF = "h";
// Handled by the relay itself (apps/tv/src/main.js), not by tvapp.
const MSG_OPEN_TVAPP = "o";
const MSG_TVAPP_UP = "u";
const MSG_TVAPP_DOWN = "d";

/**
 * The relay socket, held open for as long as the app runs — not just while the
 * tvappctrl screen is up, because `onTvappUp` is what opens that screen.
 * Returns a send function; App.js owns the result and hands it to TvAppCtrl.
 */
export function useTvappLink({ onTvappUp, onTvappDown }) {
  const wsRef = useRef(null);
  // Read through a ref so the socket effect can stay mounted for the life of the
  // app while the callbacks it calls are re-created on every render.
  const handlersRef = useRef(null);
  handlersRef.current = { onTvappUp, onTvappDown };
  // The keyboard messages only mean anything to the tvappctrl screen, so that
  // screen registers for them while it is mounted rather than App.js routing
  // them through: the remote has nothing to do with a filter box on the tv.
  const keyboardRef = useRef(null);

  useEffect(() => {
    let done = false;
    let retryTimer = null;
    let openTimer = null;

    // A failure dispatches error and then close, so a retry has to be scheduled
    // at most once per socket or every round would double the connection rate.
    const scheduleRetry = () => {
      if (done || retryTimer) return;
      clearTimeout(openTimer);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        connect();
      }, RECONNECT_MS);
    };

    const connect = () => {
      if (done) return;
      const ws = new WebSocket(`ws://${TVAPP_HOST}:${TVAPP_PORT}`);
      wsRef.current = ws;
      ws.onopen = () => clearTimeout(openTimer);
      ws.onerror = scheduleRetry;
      ws.onclose = scheduleRetry;
      ws.onmessage = (e) => {
        if (e.data === MSG_TVAPP_UP) handlersRef.current.onTvappUp();
        else if (e.data === MSG_TVAPP_DOWN) handlersRef.current.onTvappDown();
        else if (e.data === MSG_KEYBOARD_ON) keyboardRef.current?.(true);
        else if (e.data === MSG_KEYBOARD_OFF) keyboardRef.current?.(false);
      };
      openTimer = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) ws.close(); // onclose retries
      }, CONNECT_TIMEOUT_MS);
    };

    // Asked for before the first connect, but not waited on as a gate: an
    // Android that does not know the permission must still get a socket.
    (async () => {
      try {
        await PermissionsAndroid.request(LOCAL_NETWORK_PERMISSION);
      } catch (_) {}
      if (!done) connect();
    })();

    return () => {
      done = true;
      clearTimeout(retryTimer);
      clearTimeout(openTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  const send = (msg) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(msg);
  };

  // A fresh identity each render is harmless: all three only dereference a ref.
  // Naming the actions the rest of the app needs keeps the wire protocol inside
  // this module.
  return {
    send,
    openTvapp: () => send(MSG_OPEN_TVAPP),
    onKeyboard: (fn) => {
      keyboardRef.current = fn;
    },
  };
}

export default function TvAppCtrl({ send, onKeyboard, onExit }) {
  const pendingRef = useRef({ dx: 0, dy: 0 });
  const touchRef = useRef(null);
  const { width, height } = useWindowDimensions();
  // The tv's show-list filter, typed here because the tv has no keyboard. Shown
  // only while tvapp asks for it — there is nothing else on this screen to type
  // into — and empty whenever it is not, filtering nothing.
  const [keyboard, setKeyboard] = useState(false);
  const [filter, setFilter] = useState("");
  const onKeyboardRef = useRef(onKeyboard);
  onKeyboardRef.current = onKeyboard;

  useEffect(() => {
    onKeyboardRef.current((show) => {
      setKeyboard(show);
      if (!show) setFilter("");
    });
    return () => onKeyboardRef.current(null);
  }, []);

  // Rotation is unlocked for this screen alone, and re-locked on the way out. It
  // is what makes the phone's orientation work at all: the layout turns with the
  // device, so the Exit button lands in the corner that is really the upper right,
  // and touch deltas arrive already in the rotated frame — a drag towards the top
  // of the phone as held is a drag towards the top of the tv, with no correction
  // to apply. Correcting the motion by hand instead would leave the button and
  // the status bar inset in the wrong corner.
  useEffect(() => {
    ScreenOrientation.unlockAsync().catch(() => {});
    return () => {
      ScreenOrientation.lockAsync(
        ScreenOrientation.OrientationLock.PORTRAIT_UP,
      ).catch(() => {});
    };
  }, []);

  // The navigation bar is hidden for this screen too. In landscape it moves to
  // the right edge and, the window being edge to edge, lays itself over the
  // content — right on top of the Exit button. Swipe still brings it back
  // temporarily, and it is restored on the way out.
  useEffect(() => {
    NavigationBar.setBehaviorAsync("overlay-swipe").catch(() => {});
    return () => {
      NavigationBar.setVisibilityAsync("visible").catch(() => {});
    };
  }, []);

  // Both bars are re-asserted on every rotation, because a configuration change
  // brings them back — the status bar with the clock and battery included, and the
  // declarative <StatusBar hidden /> below does not survive it either. Separate
  // from the effect above so the restore does not run on each rotation and flash
  // the navigation bar into view.
  useEffect(() => {
    NavigationBar.setVisibilityAsync("hidden").catch(() => {});
    StatusBar.setHidden(true);
  }, [width, height]);

  const landscape = width > height;
  const exitTop = landscape ? EXIT_TOP_LANDSCAPE : EXIT_TOP;
  const exitRight = landscape ? EXIT_RIGHT_LANDSCAPE : EXIT_RIGHT;

  const exit = () => {
    send(CMD_EXIT); // closes tvapp on the tv too
    onExit();
  };

  // The keyboard's own accept key. The filter is cleared rather than kept —
  // there is no way back to this field except through the tv's filter box, so a
  // filter left in force with the keyboard gone would be the tv's problem alone.
  const acceptFilter = () => {
    setKeyboard(false);
    setFilter("");
    send(CMD_KEYBOARD_CLOSED);
  };

  // The whole string every keystroke rather than the key: tvapp then cannot end
  // up out of step with what is on display here, whatever the wire drops.
  const changeFilter = (text) => {
    setFilter(text);
    send(`${CMD_FILTER},${text}`);
  };

  // Flushes whatever the drag accumulated since the last frame. Sending per
  // touch event would put dozens of tiny messages a second on the wire.
  useEffect(() => {
    const timer = setInterval(() => {
      const pending = pendingRef.current;
      if (pending.dx === 0 && pending.dy === 0) return;
      const scaledX = pending.dx * CURSOR_SPEED;
      const scaledY = pending.dy * CURSOR_SPEED;
      const dx = Math.round(scaledX);
      const dy = Math.round(scaledY);
      if (dx === 0 && dy === 0) {
        // Too small to be worth a whole tv pixel even added up — drop it.
        pending.dx = 0;
        pending.dy = 0;
        return;
      }
      // Carry the rounding remainder, or a slow drag loses most of its motion.
      pending.dx = (scaledX - dx) / CURSOR_SPEED;
      pending.dy = (scaledY - dy) / CURSOR_SPEED;
      send(`${CMD_MOVE},${dx},${dy}`);
    }, SEND_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  const onGrant = (e) => {
    const { pageX, pageY } = e.nativeEvent;
    touchRef.current = { x: pageX, y: pageY, moved: 0, at: Date.now() };
  };

  // Only relative motion is sent — where on the phone the finger is has no
  // bearing on where the cursor is on the tv.
  const onMove = (e) => {
    const touch = touchRef.current;
    if (!touch) return;
    const { pageX, pageY } = e.nativeEvent;
    const dx = pageX - touch.x;
    const dy = pageY - touch.y;
    touch.x = pageX;
    touch.y = pageY;
    touch.moved += Math.abs(dx) + Math.abs(dy);
    pendingRef.current.dx += dx;
    pendingRef.current.dy += dy;
  };

  const onRelease = () => {
    const touch = touchRef.current;
    touchRef.current = null;
    if (!touch) return;
    const quick = Date.now() - touch.at <= TAP_MAX_MS;
    if (touch.moved <= TAP_MAX_MOVE && quick) send(CMD_CLICK);
  };

  return (
    <View
      style={styles.container}
      // Claiming the touch on start only. onMoveShouldSetResponder would let a
      // press that starts on the Exit button be stolen the instant the finger
      // twitches, so the button would flash and never fire.
      onStartShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={onGrant}
      onResponderMove={onMove}
      onResponderRelease={onRelease}
      onResponderTerminate={onRelease}
    >
      <StatusBar hidden />
      {keyboard && (
        <TextInput
          value={filter}
          onChangeText={changeFilter}
          onSubmitEditing={acceptFilter}
          // Mounted only while the tv wants it, so focusing on mount is what
          // brings the soft keyboard up without anything to tap here.
          autoFocus
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="done"
          placeholder="Filter..."
          placeholderTextColor="#888"
          style={[
            styles.filterInput,
            {
              top: exitTop,
              left: FILTER_LEFT,
              right: exitRight + FILTER_EXIT_GAP,
            },
          ]}
        />
      )}
      <TouchableOpacity
        onPress={exit}
        style={[styles.exitBtn, { top: exitTop, right: exitRight }]}
        activeOpacity={0.7}
      >
        <Text style={styles.exitBtnText}>Exit</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  // top and right come from the render: both depend on the orientation.
  exitBtn: {
    position: "absolute",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 4,
    backgroundColor: "whitesmoke",
  },
  exitBtnText: {
    fontSize: 14,
    color: "#000",
  },
  // top, left and right come from the render: they follow the Exit button's row.
  filterInput: {
    position: "absolute",
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
    backgroundColor: "whitesmoke",
    color: "#000",
    fontSize: 16,
  },
});
