package com.hahnca.tvapp;

import android.util.Log;
import java.net.URI;
import javax.net.ssl.SSLContext;
import org.java_websocket.client.WebSocketClient;
import org.java_websocket.handshake.ServerHandshake;
import org.json.JSONObject;

/**
 * Whether the web client has filter/sort settings shared (its hdrtop Send
 * button, list.vue's hasSharedFilters) — tracked live over the same socket
 * tv-srvr already pushes "sharedFiltersChanged" on
 * (apps/srvr/src/messaging.js notifyClients), so no polling is needed here.
 * A dropped connection is retried rather than surfaced.
 */
class SharedFilters {

  static final String GET_URL = "https://hahnca.com/tv-srvr/api/getSharedFilters";
  // The shared settings already filtered and sorted into a show list, by the
  // same @tv/share code the web client runs on its own copy of the data.
  static final String SHOWS_URL = "https://hahnca.com/tv-srvr/api/getSharedFilterShows";
  private static final String WS_URL = "wss://hahnca.com/tv-srvr";
  private static final long RECONNECT_DELAY_MS = 5000;
  private static final String TAG = "tvapp";

  interface Listener {
    void onSharedFiltersChanged(boolean has);
  }

  private final Listener listener;
  private WebSocketClient client;
  private volatile boolean stopped;

  SharedFilters(Listener listener) {
    this.listener = listener;
  }

  void start() {
    fetchInitial();
    connect();
  }

  void stop() {
    stopped = true;
    if (client != null) client.close();
  }

  private void fetchInitial() {
    new Thread(
            () -> {
              try {
                listener.onSharedFiltersChanged(hasFilters(Http.get(GET_URL)));
              } catch (Exception e) {
                Log.e(TAG, "getSharedFilters failed: " + e);
              }
            },
            "shared-filters-init")
        .start();
  }

  private void connect() {
    if (stopped) return;
    try {
      client =
          new WebSocketClient(new URI(WS_URL)) {
            @Override
            public void onOpen(ServerHandshake handshake) {
              Log.i(TAG, "shared filters socket connected");
            }

            @Override
            public void onMessage(String message) {
              handleMessage(message);
            }

            @Override
            public void onClose(int code, String reason, boolean remote) {
              scheduleReconnect();
            }

            @Override
            public void onError(Exception e) {
              Log.e(TAG, "shared filters socket error: " + e);
            }
          };
      client.setSocketFactory(SSLContext.getDefault().getSocketFactory());
      client.connect();
    } catch (Exception e) {
      Log.e(TAG, "shared filters socket connect failed: " + e);
      scheduleReconnect();
    }
  }

  private void scheduleReconnect() {
    if (stopped) return;
    new Thread(
            () -> {
              try {
                Thread.sleep(RECONNECT_DELAY_MS);
              } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
              }
              connect();
            },
            "shared-filters-reconnect")
        .start();
  }

  private void handleMessage(String message) {
    try {
      JSONObject frame = new JSONObject(message);
      if (!"sharedFiltersChanged".equals(frame.optString("notification", ""))) return;
      JSONObject data = frame.optJSONObject("data");
      listener.onSharedFiltersChanged(data != null && data.length() > 0);
    } catch (Exception e) {
      Log.e(TAG, "shared filters message parse failed: " + e);
    }
  }

  private static boolean hasFilters(String jsonBody) {
    try {
      return new JSONObject(jsonBody).length() > 0;
    } catch (Exception e) {
      return false; // "null", or unparsable, both mean nothing is shared
    }
  }
}
