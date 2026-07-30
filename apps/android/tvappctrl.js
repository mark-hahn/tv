// tvappctrl — the phone side of apps/tvapp, the app sideloaded on the tv.
//
// Reached from the tv remote by long-pressing Back, and left again with the
// Remote button. While it is up the tv remote is not on screen and nothing here
// touches it.
//
// This is the one screen that talks phone -> tv direct over the LAN instead of
// through tv-srvr: a finger drag sends motion at 60 Hz and must not round-trip
// through hahnca.com. There is no discovery — the tv's ip is pinned by a DHCP
// reservation on the router and the port is ours. If the phone is not on the
// tv's LAN, or the reservation is lost, the socket simply never opens.
//
// The wire protocol is hand-mirrored in
// apps/tvapp/app/src/main/java/com/hahnca/tvapp/CtrlServer.java — tvapp is Java
// and cannot import from here, so a change on one side is a change on both, in
// the same session.
//
// Deliberately not mirrored into the web client's tv pane: there is no tv pane
// counterpart to this screen and there is not meant to be one.

import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  PermissionsAndroid,
  StatusBar,
  StyleSheet,
  TouchableOpacity,
} from "react-native";

// Not the tv itself: the ap isolates wireless clients from each other, and the
// phone and the tv are both on wifi, so there is no path between them. This is
// hahnca.com's *lan* address, which is wired, and tv-tv relays the cursor stream
// the rest of the way (see startTvappctrlRelay in apps/tv/src/main.js). Both
// legs are single lan hops — nothing goes out to the public endpoint.
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
// Keeps the Remote button clear of the status bar and the camera cutout, which
// hiding the status bar does not free up.
const HEADER_TOP = (StatusBar.currentHeight ?? 0) + 8;

// Android 16 and up refuse a connection to a LAN address unless the app holds
// this, declared in android/app/src/main/AndroidManifest.xml and granted at
// runtime. On older Android the request just comes back denied and the socket
// works anyway, so the result is never acted on.
const LOCAL_NETWORK_PERMISSION = "android.permission.ACCESS_LOCAL_NETWORK";

const CMD_MOVE = "m";
const CMD_CLICK = "c";

export default function TvAppCtrl({ onExit }) {
  const wsRef = useRef(null);
  const pendingRef = useRef({ dx: 0, dy: 0 });
  const touchRef = useRef(null);

  // One socket for the life of the screen, reopened until it sticks. The retry
  // loop is what makes waking the tv or walking back onto the LAN just work.
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
      // press that starts on the Remote button be stolen the instant the finger
      // twitches, so the button would flash and never fire.
      onStartShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={onGrant}
      onResponderMove={onMove}
      onResponderRelease={onRelease}
      onResponderTerminate={onRelease}
    >
      <StatusBar hidden />
      <TouchableOpacity
        onPress={onExit}
        style={styles.remoteBtn}
        activeOpacity={0.7}
      >
        <Text style={styles.remoteBtnText}>Remote</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  remoteBtn: {
    position: "absolute",
    top: HEADER_TOP,
    right: 10,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 4,
    backgroundColor: "whitesmoke",
  },
  remoteBtnText: {
    fontSize: 14,
    color: "#000",
  },
});
