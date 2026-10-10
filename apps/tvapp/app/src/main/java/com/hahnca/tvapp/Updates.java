package com.hahnca.tvapp;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import java.net.URI;
import java.util.LinkedHashMap;
import java.util.Map;
import org.java_websocket.client.WebSocketClient;
import org.java_websocket.handshake.ServerHandshake;
import org.json.JSONObject;

/**
 * Word from tv-srvr that a show record has changed, so this app does not go on
 * showing what was true when it started. The list is loaded once and held in
 * memory, and nothing in it changes by itself -- hiding a show from the web
 * client rewrites its fakeLastPlayed, and without this the Watched sort here
 * would still be ordering on the old one.
 *
 * The same socket and the same notifications the web client listens to: nginx
 * upgrades /tv-srvr through to tv-srvr's WebSocket, so there is nothing on the
 * server side that had to be added for this.
 *
 * Each push carries the show's whole record, or only its name when tv-srvr
 * deleted it, and those records are put into the list in place of the old ones
 * -- the full list is ten megabytes, too much to fetch again for one show. A
 * burst of them (a disk refresh touches every episode of a show) is held back
 * until it settles and goes in as one change, which is what the debounce below
 * is for. Records missed while the socket was down are made up for by a full
 * reload once it is back.
 */
class Updates {

  private static final String TAG = "tvapp";
  private static final String UPDATES_URL = "wss://hahnca.com/tv-srvr";
  private static final String TVDB_UPDATED = "tvdbUpdated";
  private static final String TVDB_DELETED = "tvdbDeleted";
  private static final String SUBS_LATE = "subsLate";
  // Long enough that a run of records lands as one change, short enough that a
  // change made on the web client shows up here while the user is still looking
  // at what they changed.
  private static final long SETTLE_MS = 1500;
  // The socket drops whenever tv-srvr restarts, which a deploy does often.
  private static final long RETRY_MS = 15_000;

  interface Listener {
    /**
     * On the ui thread, once the records have stopped arriving: each changed
     * show's newest record by name, null for a show tv-srvr deleted.
     */
    void onShowsChanged(Map<String, JSONObject> changes);
  }

  interface ReconnectListener {
    /** On the ui thread: the socket is back after a drop, so pushes may have been missed. */
    void onReconnected();
  }

  interface SubsListener {
    /** On the ui thread: an episode's .srt files, once downloads its play did not wait for land. */
    void onSubsLate(JSONObject data);
  }

  private final Handler ui = new Handler(Looper.getMainLooper());
  private final Listener listener;
  private final ReconnectListener reconnectListener;
  private final SubsListener subsListener;
  private final Runnable notifyChanged;
  // Filled on the socket's thread and emptied on the ui thread, so guarded by
  // itself. A later record for the same show replaces the earlier one.
  private final Map<String, JSONObject> pending = new LinkedHashMap<>();
  private WebSocketClient client;
  private boolean running;
  // Whether this foreground turn's socket has opened before. Only the ui thread
  // reads or writes it. The first open needs no reload -- the activity reloaded
  // just before starting this -- but every later one is a reconnect.
  private boolean openedBefore;

  Updates(Listener listener, ReconnectListener reconnectListener, SubsListener subsListener) {
    this.listener = listener;
    this.reconnectListener = reconnectListener;
    this.subsListener = subsListener;
    this.notifyChanged =
        () -> {
          Map<String, JSONObject> changes;
          synchronized (pending) {
            if (pending.isEmpty()) return;
            changes = new LinkedHashMap<>(pending);
            pending.clear();
          }
          this.listener.onShowsChanged(changes);
        };
  }

  void start() {
    if (running) return;
    running = true;
    openedBefore = false;
    connect();
  }

  void stop() {
    running = false;
    ui.removeCallbacks(notifyChanged);
    synchronized (pending) {
      pending.clear();
    }
    WebSocketClient open = client;
    client = null;
    if (open != null) open.close();
  }

  private void connect() {
    if (!running) return;
    try {
      client =
          new WebSocketClient(new URI(UPDATES_URL)) {
            @Override
            public void onOpen(ServerHandshake handshake) {
              Log.i(TAG, "updates socket open");
              ui.post(
                  () -> {
                    if (!running) return;
                    if (openedBefore) reconnectListener.onReconnected();
                    openedBefore = true;
                  });
            }

            @Override
            public void onMessage(String message) {
              JSONObject msg = read(message);
              if (msg == null) return;
              String notification = msg.optString("notification");
              JSONObject data = msg.optJSONObject("data");
              if (SUBS_LATE.equals(notification)) {
                if (data != null) ui.post(() -> subsListener.onSubsLate(data));
                return;
              }
              boolean deleted = TVDB_DELETED.equals(notification);
              if (!deleted && !TVDB_UPDATED.equals(notification)) return;
              String name = data == null ? "" : data.optString("name", "");
              JSONObject record = deleted || data == null ? null : data.optJSONObject("record");
              if (name.isEmpty() || (!deleted && record == null)) return;
              synchronized (pending) {
                pending.put(name, record);
              }
              // Restarted on every record, so a burst settles into one change.
              ui.removeCallbacks(notifyChanged);
              ui.postDelayed(notifyChanged, SETTLE_MS);
            }

            @Override
            public void onClose(int code, String reason, boolean remote) {
              Log.i(TAG, "updates socket closed: " + reason);
              retry();
            }

            @Override
            public void onError(Exception e) {
              Log.e(TAG, "updates socket error: " + e);
            }
          };
      client.setConnectionLostTimeout(0);
      client.connect();
    } catch (Exception e) {
      Log.e(TAG, "updates socket connect failed: " + e);
      retry();
    }
  }

  private void retry() {
    if (!running) return;
    ui.postDelayed(
        () -> {
          if (running) connect();
        },
        RETRY_MS);
  }

  private static JSONObject read(String message) {
    try {
      return new JSONObject(message);
    } catch (Exception e) {
      Log.e(TAG, "updates socket message unreadable: " + e);
      return null;
    }
  }
}
