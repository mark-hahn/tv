package com.hahnca.tvapp;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/**
 * A photo for one of the cast the tvdb record has none for. The web client's
 * Actors pane does the same lookup rather than dropping those actors, so this
 * is what lets this app show the whole cast it shows -- a show like Angel has
 * fifteen in the record and only three of them carry an image.
 *
 * Looked up by the person's name, which is all TMDB needs, and remembered for
 * the life of the app: the same cast is rebuilt every time cardMisc comes round
 * to it. An empty answer is remembered as readily as a real one, so an actor
 * TMDB has no photo of is asked about once.
 */
class ActorPhotos {

  private static final String TAG = "tvapp";
  private static final String PERSON_URL = "https://hahnca.com/tv-srvr/api/searchTmdbPerson";
  // A cast at a time, and only the one cardMisc is showing, so a few threads
  // fill a strip without opening a connection per actor at once.
  private static final int LOOKUP_THREADS = 3;

  private static final ExecutorService POOL = Executors.newFixedThreadPool(LOOKUP_THREADS);
  private static final Handler UI = new Handler(Looper.getMainLooper());
  private static final Map<String, String> CACHE = new HashMap<>();

  interface Ready {
    /** On the ui thread. Empty when TMDB has no photo of this person. */
    void onPhoto(String url);
  }

  static void get(String personName, Ready ready) {
    if (personName == null || personName.isEmpty()) {
      ready.onPhoto("");
      return;
    }
    String cached;
    synchronized (CACHE) {
      cached = CACHE.get(personName);
    }
    if (cached != null) {
      ready.onPhoto(cached);
      return;
    }
    POOL.execute(
        () -> {
          String url = fetch(personName);
          synchronized (CACHE) {
            CACHE.put(personName, url);
          }
          UI.post(() -> ready.onPhoto(url));
        });
  }

  /** The reply is the url as a bare json string, or null for nothing found. */
  private static String fetch(String personName) {
    try {
      JSONObject body = new JSONObject();
      body.put("name", personName);
      String reply = Http.postJson(PERSON_URL, body.toString()).trim();
      if (reply.isEmpty() || "null".equals(reply)) return "";
      if (reply.startsWith("\"") && reply.endsWith("\"")) {
        return new JSONObject("{\"u\":" + reply + "}").optString("u", "");
      }
      return "";
    } catch (Exception e) {
      Log.e(TAG, "actor photo lookup failed for " + personName + ": " + e);
      return "";
    }
  }
}
