package com.hahnca.tvapp;

import android.util.Log;
import java.net.InetSocketAddress;
import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;

/**
 * The socket tvappctrl (in apps/android) drives the cursor over. A WebSocket
 * because React Native JS has no raw sockets, and a socket rather than HTTP
 * requests because a finger drag sends motion at 60 Hz.
 *
 * There is no discovery: the phone dials CTRL_PORT at the TV's reserved ip,
 * both hard-wired on both sides.
 *
 * The wire protocol is hand-mirrored in apps/android/tvappctrl.js — tvapp is
 * Java and cannot import the phone's constants, so a change here is a change
 * there, in the same session. Keep it small. From the phone:
 *
 *   m,&lt;dx&gt;,&lt;dy&gt;   move the cursor by a relative amount, in tv pixels
 *   g,&lt;dx&gt;,&lt;dy&gt;   scroll by a relative amount, in tv pixels
 *   c              click whatever the cursor is over
 *   p              the finger has been down long enough to be a hold, not a tap
 *   r              and is now up again
 *   x              exit, so closing tvappctrl on the phone closes tvapp here
 *   f,&lt;text&gt;    the show list's filter, as the phone's own filter box has it
 *   s,&lt;name&gt;    select this show, exact name match -- sent by tv-tv itself,
 *                  straight over this same socket, not by the phone
 *
 * and back to the phone, which is what the relay's other direction is for:
 *
 *   z              a show was clicked here: clear the phone's filter box too
 */
class CtrlServer extends WebSocketServer {

  static final int CTRL_PORT = 8099;

  static final String MSG_CLEAR_FILTER = "z";

  private static final String TAG = "tvapp";
  private static final String CMD_MOVE = "m";
  private static final String CMD_SCROLL = "g";
  private static final String CMD_CLICK = "c";
  private static final String CMD_PRESS = "p";
  private static final String CMD_RELEASE = "r";
  private static final String CMD_EXIT = "x";
  private static final String CMD_FILTER = "f";
  private static final String CMD_SELECT = "s";
  private static final int STOP_TIMEOUT_MS = 500;

  interface Listener {
    void onMove(float dx, float dy);

    void onScroll(float dx, float dy);

    void onClick();

    /** A press held past the phone's tap window, and the release ending it. */
    void onPress();

    void onRelease();

    void onExit();

    void onFilter(String text);

    void onSelectShow(String name);
  }

  private final Listener listener;

  CtrlServer(Listener listener) {
    super(new InetSocketAddress(CTRL_PORT));
    this.listener = listener;
    // The phone reconnects on its own schedule, so the port has to be reusable
    // even while an old connection is still in TIME_WAIT.
    setReuseAddr(true);
  }

  void shutdown() {
    try {
      stop(STOP_TIMEOUT_MS);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      Log.w(TAG, "ctrl socket stop interrupted");
    }
  }

  @Override
  public void onStart() {
    Log.i(TAG, "ctrl socket listening on port " + CTRL_PORT);
  }

  @Override
  public void onOpen(WebSocket conn, ClientHandshake handshake) {
    Log.i(TAG, "tvappctrl connected from " + conn.getRemoteSocketAddress());
  }

  @Override
  public void onClose(WebSocket conn, int code, String reason, boolean remote) {
    Log.i(TAG, "tvappctrl disconnected, code " + code + " " + reason);
  }

  /** To the phone. There is only ever the one connection, so broadcast is it. */
  void send(String message) {
    broadcast(message);
  }

  @Override
  public void onMessage(WebSocket conn, String message) {
    // Filter text and a show name are everything after the first comma, commas
    // and all, so both are taken apart before the fixed-arity commands are.
    if (message.startsWith(CMD_FILTER + ",")) {
      listener.onFilter(message.substring(CMD_FILTER.length() + 1));
      return;
    }
    if (message.startsWith(CMD_SELECT + ",")) {
      listener.onSelectShow(message.substring(CMD_SELECT.length() + 1));
      return;
    }
    String[] parts = message.split(",");
    if (CMD_MOVE.equals(parts[0]) && parts.length == 3) {
      listener.onMove(Float.parseFloat(parts[1]), Float.parseFloat(parts[2]));
    } else if (CMD_SCROLL.equals(parts[0]) && parts.length == 3) {
      listener.onScroll(Float.parseFloat(parts[1]), Float.parseFloat(parts[2]));
    } else if (CMD_CLICK.equals(parts[0])) {
      listener.onClick();
    } else if (CMD_PRESS.equals(parts[0])) {
      listener.onPress();
    } else if (CMD_RELEASE.equals(parts[0])) {
      listener.onRelease();
    } else if (CMD_EXIT.equals(parts[0])) {
      listener.onExit();
    } else {
      Log.w(TAG, "unknown ctrl command: " + message);
    }
  }

  @Override
  public void onError(WebSocket conn, Exception e) {
    Log.e(TAG, "ctrl socket error: " + e);
  }
}
