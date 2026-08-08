package com.hahnca.tvapp;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import java.net.URI;
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
 * A record arriving is only ever taken as "something changed" -- the reload
 * that follows re-reads the lot. One show's record is not worth splicing into
 * a sorted list of a couple of thousand, and a burst of them (an Emby refresh
 * touches every episode of a show) is worth exactly one reload, which is what
 * the debounce below is for.
 */
class Updates {

  private static final String TAG = "tvapp";
  private static final String UPDATES_URL = "wss://hahnca.com/tv-srvr";
  private static final String TVDB_UPDATED = "tvdbUpdated";
  // Long enough that a run of records lands as one reload, short enough that a
  // change made on the web client shows up here while the user is still looking
  // at what they changed.
  private static final long SETTLE_MS = 1500;
  // The socket drops whenever tv-srvr restarts, which a deploy does often.
  private static final long RETRY_MS = 15_000;

  interface Listener {
    /** On the ui thread, once the records have stopped arriving. */
    void onShowsChanged();
  }

  private final Handler ui = new Handler(Looper.getMainLooper());
  private final Listener listener;
  private final Runnable notifyChanged;
  private WebSocketClient client;
  private boolean running;

  Updates(Listener listener) {
    this.listener = listener;
    this.notifyChanged = () -> this.listener.onShowsChanged();
  }

  void start() {
    if (running) return;
    running = true;
    connect();
  }

  void stop() {
    running = false;
    ui.removeCallbacks(notifyChanged);
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
            }

            @Override
            public void onMessage(String message) {
              if (!isTvdbUpdate(message)) return;
              // Restarted on every record, so a burst settles into one reload.
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

  private static boolean isTvdbUpdate(String message) {
    try {
      return TVDB_UPDATED.equals(new JSONObject(message).optString("notification"));
    } catch (Exception e) {
      Log.e(TAG, "updates socket message unreadable: " + e);
      return false;
    }
  }
}
