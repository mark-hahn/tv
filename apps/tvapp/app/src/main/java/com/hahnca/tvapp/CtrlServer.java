package com.hahnca.tvapp;

import android.util.Log;
import java.net.InetSocketAddress;
import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;

/**
 * The tvapprc command socket. The phone cannot reach the TV directly on this
 * LAN, so tv-tv bridges WebSocket messages between Android and this listener.
 *
 * From the remote:
 *
 *   k,&lt;key&gt;     one of up/down/left/right/ok/oklong/sort/filter --
 *                  oklong being the ok key held rather than clicked
 *   j,&lt;key&gt;     skip variant of up/down -- sent instead of k while a hold has
 *                  been auto-repeating fast long enough to enter skip mode
 *   b              switch from tvapp to Emby, one level out at a time
 *   g              switch from tvapp to Emby right now, regardless of focus
 *   e              load the active show into Emby
 *   x              close tvapp
 *   f,&lt;text&gt;    show-list filter text
 *   s,&lt;name&gt;    select this show, exact name match -- sent by tv-tv itself
 *   c              the shared filter settings changed: re-fetch the Custom
 *                  list -- sent by tv-tv itself, on tv-srvr's behalf
 *
 * Back to Android:
 *
 *   z              the filter was cleared here: clear Android's filter box too
 *   c,<count>      the number of shows currently visible in the list
 *   a,&lt;name&gt;    the active show, so the phone's own show pane can open on it
 */
class CtrlServer extends WebSocketServer {

  static final int CTRL_PORT = 8099;

  static final String MSG_CLEAR_FILTER = "z";
  static final String MSG_COUNTS = "c";
  static final String MSG_ACTIVE_SHOW = "a";

  private static final String TAG = "tvapp";
  private static final String CMD_KEY = "k";
  private static final String CMD_KEY_LETTER = "j";
  private static final String CMD_BACK_TO_EMBY = "b";
  private static final String CMD_FORCE_CLOSE_TO_EMBY = "g";
  private static final String CMD_EMBY_SELECTED = "e";
  private static final String CMD_EXIT = "x";
  private static final String CMD_FILTER = "f";
  private static final String CMD_SELECT = "s";
  private static final String CMD_CUSTOM_CHANGED = "c";
  private static final int STOP_TIMEOUT_MS = 500;

  interface Listener {
    void onRemoteKey(String key);

    void onRemoteKeyLetter(String key);

    void onBackToEmby();

    void onForceCloseToEmby();

    void onEmbySelected();

    void onExit();

    void onFilter(String text);

    void onSelectShow(String name);

    void onCustomChanged();

    void onPhoneConnected();
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
    Log.i(TAG, "tvapprc connected from " + conn.getRemoteSocketAddress());
    listener.onPhoneConnected();
  }

  @Override
  public void onClose(WebSocket conn, int code, String reason, boolean remote) {
    Log.i(TAG, "tvapprc disconnected, code " + code + " " + reason);
  }

  /** To the phone. There is only ever the one connection, so broadcast is it. */
  void send(String message) {
    broadcast(message);
  }

  @Override
  public void onMessage(WebSocket conn, String message) {
    // Filter text, show names, and key names are everything after the first
    // comma, commas and all, so they are taken apart before fixed commands.
    if (message.startsWith(CMD_FILTER + ",")) {
      listener.onFilter(message.substring(CMD_FILTER.length() + 1));
      return;
    }
    if (message.startsWith(CMD_SELECT + ",")) {
      listener.onSelectShow(message.substring(CMD_SELECT.length() + 1));
      return;
    }
    if (message.startsWith(CMD_KEY_LETTER + ",")) {
      listener.onRemoteKeyLetter(message.substring(CMD_KEY_LETTER.length() + 1));
      return;
    }
    if (message.startsWith(CMD_KEY + ",")) {
      listener.onRemoteKey(message.substring(CMD_KEY.length() + 1));
      return;
    }
    if (CMD_BACK_TO_EMBY.equals(message)) {
      listener.onBackToEmby();
    } else if (CMD_FORCE_CLOSE_TO_EMBY.equals(message)) {
      listener.onForceCloseToEmby();
    } else if (CMD_EMBY_SELECTED.equals(message)) {
      listener.onEmbySelected();
    } else if (CMD_EXIT.equals(message)) {
      listener.onExit();
    } else if (CMD_CUSTOM_CHANGED.equals(message)) {
      listener.onCustomChanged();
    } else {
      Log.w(TAG, "unknown ctrl command: " + message);
    }
  }

  @Override
  public void onError(WebSocket conn, Exception e) {
    Log.e(TAG, "ctrl socket error: " + e);
  }
}
