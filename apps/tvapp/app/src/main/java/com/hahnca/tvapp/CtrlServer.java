package com.hahnca.tvapp;

import android.util.Log;
import java.net.InetSocketAddress;
import org.java_websocket.WebSocket;
import org.java_websocket.framing.CloseFrame;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;

/**
 * The tvapprc command socket. The phone cannot reach the TV directly on this
 * LAN, so tv-tv bridges WebSocket messages between Android and this listener.
 *
 * From the remote:
 *
 *   k,&lt;key&gt;     one of up/down/left/right/ok/sort/filter/info -- the last
 *                  three each hand the focus to their own area
 *   kr,&lt;key&gt;    an auto-repeat of a held k key, not a fresh press
 *   j,&lt;key&gt;     skip variant of up/down -- sent instead of k while a hold has
 *                  been auto-repeating fast long enough to enter skip mode
 *   b              back, one level out at a time; at the top it stays put
 *   e              play what the cursor is on, else the active show's next-up
 *   r              clear the screen state: the show list focused and nothing
 *                  else, cardMisc back to its description, filters off
 *   x              close tvapp
 *   f,&lt;text&gt;    show-list filter text
 *   s,&lt;name&gt;    select this show, exact name match -- sent by tv-tv itself
 *   p,&lt;season&gt;,&lt;episode&gt; play this specific episode of the selected
 *                  show -- sent by tv-tv itself, right after an s,&lt;name&gt;
 *   c              the shared filter settings changed: re-fetch the Custom
 *                  list -- sent by tv-tv itself, on tv-srvr's behalf
 *   h              the hide key: the watched mark on the focused episode when
 *                  the map has one under its cursor, else hide/unhide the
 *                  selected show
 *   l              send the subtitle list of the video that is up (l,... below)
 *   t,&lt;n&gt;       turn on subtitle track n of that list; t,-1 turns them off
 *   v,&lt;url&gt;  put a live camera on the screen, over everything, by
 *                  loading that url in a WebView; v,off takes it back off.
 *                  Sent by tv-tv on hvac2's behalf -- see
 *                  docs/tv-videostream-contract.md
 *
 * Back to Android:
 *
 *   z              the filter was cleared here: clear Android's filter box too
 *   c,<count>      the number of shows currently visible in the list
 *   a,&lt;name&gt;    the active show, so the phone's own show pane can open on it
 *   i,&lt;0|1&gt;     whether the active show is hidden, so the remote's hide key
 *                  can read Hide or Unhide
 *   l,&lt;json&gt;    the video's subtitle tracks, {title, tracks: [{label, type}],
 *                  selected}, or null once no video is up -- sent on every
 *                  change and when asked
 */
class CtrlServer extends WebSocketServer {

  static final int CTRL_PORT = 8099;

  static final String MSG_CLEAR_FILTER = "z";
  static final String MSG_COUNTS = "c";
  static final String MSG_ACTIVE_SHOW = "a";
  static final String MSG_ACTIVE_HIDDEN = "i";
  static final String MSG_SUBTITLES = "l";

  private static final String TAG = "tvapp";
  private static final String CMD_KEY = "k";
  private static final String CMD_KEY_REPEAT = "kr";
  private static final String CMD_KEY_LETTER = "j";
  private static final String CMD_BACK = "b";
  private static final String CMD_PLAY = "e";
  private static final String CMD_CLEAR_STATE = "r";
  private static final String CMD_EXIT = "x";
  private static final String CMD_FILTER = "f";
  private static final String CMD_SELECT = "s";
  private static final String CMD_PLAY_EPISODE = "p";
  private static final String CMD_CUSTOM_CHANGED = "c";
  // The hide key was pressed on the remote. What it acts on is this app's to
  // say -- it is the only one that knows whether the map has an episode under
  // its cursor -- so the remote sends the press and nothing more.
  private static final String CMD_HIDE = "h";
  private static final String CMD_SUBTITLES = "l";
  private static final String CMD_SUBTITLE = "t";
  // A live camera over the whole screen. The argument is a page url, or "off".
  // Everything about the video is that page's business; see CamOverlay.
  private static final String CMD_CAM = "v";
  private static final String CAM_OFF = "off";
  private static final int STOP_TIMEOUT_MS = 500;

  interface Listener {
    void onRemoteKey(String key, boolean repeat);

    void onRemoteKeyLetter(String key);

    void onBack();

    void onPlay();

    void onClearState();

    void onExit();

    void onFilter(String text);

    void onSelectShow(String name);

    void onPlayEpisode(int season, int episode);

    void onCustomChanged();

    void onHideKey();

    void onSubtitlesWanted();

    void onSelectSubtitle(int index);

    void onShowCam(String url);

    void onHideCam();

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

  /**
   * Every connection is dropped outright before the server is stopped, rather
   * than left to stop()'s polite close.
   *
   * stop() only queues a close frame per connection and gives the selector
   * thread STOP_TIMEOUT_MS to write it, read the peer's echo back, and close
   * the channel; then it closes the selector and the listening socket and
   * leaves any connection that did not finish in time with its socket still
   * open. Nothing ever closes those -- the activity is on its way to the
   * background, and Android freezes the process a few tens of seconds later --
   * so the far end goes on seeing an established connection with tvapp at the
   * other end of it, and the remote stays in tvapprc mode driving keys into a
   * socket nobody reads. closeConnection closes the channel there and then, on
   * this thread, which puts a fin on the wire and tells tv-tv immediately.
   */
  void shutdown() {
    for (WebSocket conn : getConnections()) {
      conn.closeConnection(CloseFrame.GOING_AWAY, "tvapp backgrounded");
    }
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
    if (message.startsWith(CMD_PLAY_EPISODE + ",")) {
      String[] se = message.substring(CMD_PLAY_EPISODE.length() + 1).split(",");
      try {
        listener.onPlayEpisode(Integer.parseInt(se[0]), Integer.parseInt(se[1]));
      } catch (NumberFormatException | ArrayIndexOutOfBoundsException e) {
        Log.w(TAG, "bad play-episode command: " + message);
      }
      return;
    }
    if (message.startsWith(CMD_CAM + ",")) {
      String arg = message.substring(CMD_CAM.length() + 1);
      if (CAM_OFF.equals(arg)) listener.onHideCam();
      else listener.onShowCam(arg);
      return;
    }
    if (message.startsWith(CMD_SUBTITLE + ",")) {
      try {
        listener.onSelectSubtitle(Integer.parseInt(message.substring(CMD_SUBTITLE.length() + 1)));
      } catch (NumberFormatException e) {
        Log.w(TAG, "bad subtitle command: " + message);
      }
      return;
    }
    if (message.startsWith(CMD_KEY_LETTER + ",")) {
      listener.onRemoteKeyLetter(message.substring(CMD_KEY_LETTER.length() + 1));
      return;
    }
    if (message.startsWith(CMD_KEY_REPEAT + ",")) {
      listener.onRemoteKey(message.substring(CMD_KEY_REPEAT.length() + 1), true);
      return;
    }
    if (message.startsWith(CMD_KEY + ",")) {
      listener.onRemoteKey(message.substring(CMD_KEY.length() + 1), false);
      return;
    }
    if (CMD_BACK.equals(message)) {
      listener.onBack();
    } else if (CMD_PLAY.equals(message)) {
      listener.onPlay();
    } else if (CMD_CLEAR_STATE.equals(message)) {
      listener.onClearState();
    } else if (CMD_EXIT.equals(message)) {
      listener.onExit();
    } else if (CMD_CUSTOM_CHANGED.equals(message)) {
      listener.onCustomChanged();
    } else if (CMD_HIDE.equals(message)) {
      listener.onHideKey();
    } else if (CMD_SUBTITLES.equals(message)) {
      listener.onSubtitlesWanted();
    } else {
      Log.w(TAG, "unknown ctrl command: " + message);
    }
  }

  @Override
  public void onError(WebSocket conn, Exception e) {
    Log.e(TAG, "ctrl socket error: " + e);
  }
}
