// tvappctrl — the phone side of apps/tvapp, the app sideloaded on the tv.
//
// Two exports, because the two have different lifetimes:
//
//   useTvappLink  the socket, held for as long as the app runs. It has to outlive
//                 the screen: being told tvapp just opened on the tv is what opens
//                 the screen, so something must be listening while the remote is
//                 the thing on display.
//   TvAppCtrl     the screen itself — an Exit button, filter box, and Clear button
//                 along the bottom, and a drag surface for the tv's cursor above.
//                 The filter box lives here rather than on the tv: a tv has no
//                 keyboard, and the phone always does.
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
  Keyboard,
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
// A press that barely moves is a tap if it is let go inside TAP_MAX_MS and a
// hold if it is not — the tv's scroll buttons are worked by holding. One that
// moves is a drag either way, and is neither.
const TAP_MAX_MOVE = 8;
const TAP_MAX_MS = 300;
// How long the blocked dialog is held to close tvapp. Longer than a hold on the
// drag surface: it is the one thing a blocked phone can do and undoes what
// another phone is in the middle of, so it should not happen by brushing it.
const BLOCKED_CLOSE_HOLD_MS = 600;
// Motion is coalesced to one message per frame instead of one per touch event.
const SEND_INTERVAL_MS = 16;
// Where the bottom row (Exit, filter box, Clear) sits, per orientation. Portrait
// keeps clear of the navigation bar. Landscape is inset from both bezels instead:
// the cutout is centred on a side edge there, and with the status and navigation
// bars hidden the window runs edge to edge, so without an inset of its own the row
// ends up jammed into the corner.
const STATUS_BAR_HEIGHT = StatusBar.currentHeight ?? 0;
const ROW_BOTTOM = 8;
const ROW_BOTTOM_LANDSCAPE = 24;
const ROW_LEFT = 10;
const ROW_RIGHT = 10;
const ROW_RIGHT_LANDSCAPE = 56;
// Space between the filter box, Clear and Exit within the row.
const ROW_GAP = 10;
// Exit is twice its old size; Clear and the filter box match its height and
// font so the row reads as one control. Shrunk 20% from that doubled size.
// Increased by 50% to make buttons taller.
const ACTION_PAD_V = 14.4;
const ACTION_PAD_H = 19.2;
const ACTION_FONT_SIZE = 22.4;

// Android 16 and up refuse a connection to a LAN address unless the app holds
// this, declared in android/app/src/main/AndroidManifest.xml and granted at
// runtime. On older Android the request just comes back denied and the socket
// works anyway, so the result is never acted on.
const LOCAL_NETWORK_PERMISSION = "android.permission.ACCESS_LOCAL_NETWORK";

// Forwarded through the relay to tvapp, which reads them (CtrlServer.java).
const CMD_MOVE = "m";
const CMD_SCROLL = "g";
const CMD_CLICK = "c";
const CMD_PRESS = "p";
const CMD_RELEASE = "r";
const CMD_EXIT = "x";
const CMD_FILTER = "f";
// From tvapp, forwarded back the same way: a show was clicked there, which is
// one of the ways the filter clears — the box here has to follow.
const MSG_CLEAR_FILTER = "z";
// Handled by the relay itself (apps/tv/src/main.js), not by tvapp.
const MSG_OPEN_TVAPP = "o";
const MSG_TVAPP_UP = "u";
const MSG_TVAPP_DOWN = "d";
// Only one phone drives the cursor. The rest still open this screen — it mirrors
// whether tvapp is up and may not disagree with the tv — but come up blocked,
// with everything on it inert behind a dialog saying so.
const MSG_BLOCKED = "b";
const MSG_ALLOWED = "a";
// The one action left to a blocked phone, so a tv left open by a phone that has
// since been put down is not stuck that way. The relay takes it from a blocked
// phone where it drops everything else.
const MSG_CLOSE_TVAPP = "q";

/**
 * The relay socket, held open for as long as the app runs — not just while the
 * tvappctrl screen is up, because `onTvappUp` is what opens that screen.
 * Returns a send function; App.js owns the result and hands it to TvAppCtrl.
 */
export function useTvappLink({ onTvappUp, onTvappDown, onBlockedChange }) {
  const wsRef = useRef(null);
  // Read through a ref so the socket effect can stay mounted for the life of the
  // app while the callbacks it calls are re-created on every render.
  const handlersRef = useRef(null);
  handlersRef.current = { onTvappUp, onTvappDown, onBlockedChange };
  // MSG_CLEAR_FILTER only means anything to the tvappctrl screen, so that
  // screen registers for it while it is mounted rather than App.js routing it
  // through: the remote has nothing to do with a filter box on the tv.
  const clearFilterRef = useRef(null);

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
        else if (e.data === MSG_BLOCKED) handlersRef.current.onBlockedChange(true);
        else if (e.data === MSG_ALLOWED) handlersRef.current.onBlockedChange(false);
        else if (e.data === MSG_CLEAR_FILTER) clearFilterRef.current?.();
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
    onClearFilter: (fn) => {
      clearFilterRef.current = fn;
    },
  };
}

export default function TvAppCtrl({ send, onClearFilter, onExit, blocked, disableExit }) {
  const pendingRef = useRef({ moveDx: 0, moveDy: 0, scrollDx: 0, scrollDy: 0 });
  const touchRef = useRef(null);
  const holdRef = useRef(null);
  const blockedHoldRef = useRef(null);
  const { width, height } = useWindowDimensions();
  // The tv's show-list filter, typed here because the tv has no keyboard. Kept
  // regardless of whether the keyboard is currently up — closing the keyboard
  // is not one of the ways this clears, only Clear, tvapp closing, and picking
  // a show are.
  const [filter, setFilter] = useState("");
  const onClearFilterRef = useRef(onClearFilter);
  onClearFilterRef.current = onClearFilter;

  useEffect(() => {
    onClearFilterRef.current(() => {
      setFilter("");
      Keyboard.dismiss();
    });
    return () => onClearFilterRef.current(null);
  }, []);

  // The overlay below is what actually stops touches reaching anything, but a
  // keyboard already up sits above it, and a drag already under way holds the
  // responder and would go on feeding the cursor. Both are dropped here.
  useEffect(() => {
    if (!blocked) return;
    Keyboard.dismiss();
    clearTimeout(holdRef.current);
    touchRef.current = null;
    pendingRef.current.moveDx = 0;
    pendingRef.current.moveDy = 0;
    pendingRef.current.scrollDx = 0;
    pendingRef.current.scrollDy = 0;
    return () => clearTimeout(blockedHoldRef.current);
  }, [blocked]);

  // Holding the blocked dialog closes tvapp, which closes this screen and every
  // other phone's along with it — the same end as the Exit button, reached the
  // one way still open to a phone that is blocked.
  const startBlockedHold = () => {
    clearTimeout(blockedHoldRef.current);
    blockedHoldRef.current = setTimeout(() => {
      send(MSG_CLOSE_TVAPP);
      onExit();
    }, BLOCKED_CLOSE_HOLD_MS);
  };

  const stopBlockedHold = () => clearTimeout(blockedHoldRef.current);

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
  const rowBottom = landscape ? ROW_BOTTOM_LANDSCAPE : ROW_BOTTOM;
  const rowRight = landscape ? ROW_RIGHT_LANDSCAPE : ROW_RIGHT;

  const exit = () => {
    send(CMD_EXIT); // closes tvapp on the tv too
    onExit();
  };

  // The whole string every keystroke rather than the key: tvapp then cannot end
  // up out of step with what is on display here, whatever the wire drops.
  const changeFilter = (text) => {
    setFilter(text);
    send(`${CMD_FILTER},${text}`);
  };

  const clearFilter = () => {
    setFilter("");
    send(`${CMD_FILTER},`);
    Keyboard.dismiss();
  };

  // Flushes whatever the drags accumulated since the last frame. Sending per
  // touch event would put dozens of tiny messages a second on the wire.
  useEffect(() => {
    const timer = setInterval(() => {
      const pending = pendingRef.current;
      flushDelta(pending, "moveDx", "moveDy", CMD_MOVE);
      flushDelta(pending, "scrollDx", "scrollDy", CMD_SCROLL);
    }, SEND_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  const flushDelta = (pending, xKey, yKey, command) => {
    if (pending[xKey] === 0 && pending[yKey] === 0) return;
    const scaledX = pending[xKey] * CURSOR_SPEED;
    const scaledY = pending[yKey] * CURSOR_SPEED;
    const dx = Math.round(scaledX);
    const dy = Math.round(scaledY);
    if (dx === 0 && dy === 0) {
      // Too small to be worth a whole tv pixel even added up — drop it.
      pending[xKey] = 0;
      pending[yKey] = 0;
      return;
    }
    // Carry the rounding remainder, or a slow drag loses most of its motion.
    pending[xKey] = (scaledX - dx) / CURSOR_SPEED;
    pending[yKey] = (scaledY - dy) / CURSOR_SPEED;
    send(`${command},${dx},${dy}`);
  };

  // A press that outlives the tap window without going anywhere is a hold, and
  // is reported as one so the tv's scroll buttons can stay down under it. The
  // timer is the same TAP_MAX_MS a tap is judged by, so a press is one or the
  // other and never both.
  //
  // Also the container's own responder grant: it only fires for a touch that
  // starts outside the Exit button, filter box and Clear button, which claim it
  // themselves — so dismissing the keyboard here is exactly "clicked or dragged
  // outside the controls", and never clears the filter text itself.
  const onGrant = (e) => {
    if (blocked) return;
    Keyboard.dismiss();
    const { pageX, pageY } = e.nativeEvent;
    const touch = {
      x: pageX,
      y: pageY,
      moved: 0,
      at: Date.now(),
      held: false,
      scrolling: false,
      scrollX: 0,
      scrollY: 0,
    };
    touchRef.current = touch;
    clearTimeout(holdRef.current);
    holdRef.current = setTimeout(() => {
      if (touchRef.current !== touch || touch.moved > TAP_MAX_MOVE) return;
      touch.held = true;
      send(CMD_PRESS);
    }, TAP_MAX_MS);
  };

  const centerOf = (touches) => {
    if (!touches || touches.length < 2) return null;
    return {
      x: (touches[0].pageX + touches[1].pageX) / 2,
      y: (touches[0].pageY + touches[1].pageY) / 2,
    };
  };

  const startScroll = (touch, center) => {
    clearTimeout(holdRef.current);
    if (touch.held) send(CMD_RELEASE);
    touch.held = false;
    touch.scrolling = true;
    touch.scrollX = center.x;
    touch.scrollY = center.y;
    pendingRef.current.moveDx = 0;
    pendingRef.current.moveDy = 0;
  };

  // Only relative motion is sent — where on the phone the finger is has no
  // bearing on where the cursor is on the tv. Two fingers switch that relative
  // motion to scrolling and leave the cursor parked over the target.
  const onMove = (e) => {
    const touch = touchRef.current;
    if (!touch) return;
    const center = centerOf(e.nativeEvent.touches);
    if (center) {
      if (!touch.scrolling) {
        startScroll(touch, center);
        return;
      }
      const dx = center.x - touch.scrollX;
      const dy = center.y - touch.scrollY;
      touch.scrollX = center.x;
      touch.scrollY = center.y;
      touch.moved += Math.abs(dx) + Math.abs(dy);
      pendingRef.current.scrollDx += dx;
      pendingRef.current.scrollDy += dy;
      return;
    }
    if (touch.scrolling) return;
    const { pageX, pageY } = e.nativeEvent;
    const dx = pageX - touch.x;
    const dy = pageY - touch.y;
    touch.x = pageX;
    touch.y = pageY;
    touch.moved += Math.abs(dx) + Math.abs(dy);
    pendingRef.current.moveDx += dx;
    pendingRef.current.moveDy += dy;
  };

  const onRelease = (e) => {
    const remaining = e?.nativeEvent?.touches?.length ?? 0;
    if (remaining > 0) return;
    clearTimeout(holdRef.current);
    const touch = touchRef.current;
    touchRef.current = null;
    if (!touch) return;
    if (touch.held) {
      send(CMD_RELEASE);
      return;
    }
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
      <View style={[styles.topRow, { bottom: rowBottom, left: ROW_LEFT, right: rowRight }]}>
        <TouchableOpacity
          onPress={exit}
          disabled={disableExit}
          style={[styles.exitBtn, disableExit && { opacity: 0.5 }]}
          activeOpacity={0.7}
        >
          <Text style={styles.actionBtnText}>Exit</Text>
        </TouchableOpacity>
        <TextInput
          value={filter}
          onChangeText={changeFilter}
          onSubmitEditing={() => Keyboard.dismiss()}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="done"
          editable={!blocked}
          placeholder="Filter..."
          placeholderTextColor="#888"
          style={styles.filterInput}
        />
        <TouchableOpacity onPress={clearFilter} style={styles.clearBtn} activeOpacity={0.7}>
          <Text style={styles.actionBtnText}>Clear</Text>
        </TouchableOpacity>
      </View>
      {/* Last, so it covers the row above as well as the drag surface. Claiming
          every touch that starts on it is what blocks the ui: the views beneath
          are only ever offered a touch this one has turned down. The hold it
          takes for itself is the only thing that still gets through. */}
      {blocked && (
        <View
          style={styles.blockOverlay}
          onStartShouldSetResponder={() => true}
          onResponderTerminationRequest={() => false}
          onResponderGrant={startBlockedHold}
          onResponderRelease={stopBlockedHold}
          onResponderTerminate={stopBlockedHold}
        >
          <View style={styles.blockDialog}>
            <Text style={styles.blockDialogText}>
              {"TV control blocked.\nClick and hold to close."}
            </Text>
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
  },
  // top, left and right come from the render: all three depend on the orientation.
  topRow: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
  },
  filterInput: {
    flex: 1,
    marginRight: ROW_GAP,
    paddingVertical: ACTION_PAD_V,
    paddingHorizontal: 6.4,
    borderRadius: 4,
    backgroundColor: "#404040",
    color: "#fff",
    fontSize: ACTION_FONT_SIZE,
  },
  clearBtn: {
    paddingVertical: ACTION_PAD_V,
    paddingHorizontal: ACTION_PAD_H,
    borderRadius: 4,
    backgroundColor: "#404040",
  },
  exitBtn: {
    marginRight: ROW_GAP,
    paddingVertical: ACTION_PAD_V,
    paddingHorizontal: ACTION_PAD_H,
    borderRadius: 4,
    backgroundColor: "#404040",
  },
  actionBtnText: {
    fontSize: ACTION_FONT_SIZE,
    color: "#fff",
  },
  blockOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.75)",
  },
  blockDialog: {
    paddingVertical: 24,
    paddingHorizontal: 32,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#555",
    backgroundColor: "#303030",
  },
  blockDialogText: {
    fontSize: 26,
    fontWeight: "bold",
    color: "#fff",
    textAlign: "center",
  },
});
