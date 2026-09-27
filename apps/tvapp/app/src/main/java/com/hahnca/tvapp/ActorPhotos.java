package com.hahnca.tvapp;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * A photo for one of the cast the tvdb record has none for. The web client's
 * Actors pane does the same lookup rather than dropping those actors, so this
 * is what lets this app show the whole cast it shows -- a show like Angel has
 * fifteen in the record and only three of them carry an image.
 *
 * tv-srvr chooses it (its images.js) by the person's name alone, so it is the
 * same whatever show they are in. Remembered for the life of the app: the
 * same cast is rebuilt every time cardMisc comes round to it. An empty answer
 * is remembered as readily as a real one, so an actor no provider has a photo
 * of is asked about once.
 */
class ActorPhotos {

  private static final String TAG = "tvapp";
  private static final String PERSON_URL = "https://hahnca.com/tv-srvr/api/getPersonImages";
  // A cast at a time, and only the one cardMisc is showing, so a few threads
  // fill a strip without opening a connection per actor at once.
  private static final int LOOKUP_THREADS = 3;

  private static final ExecutorService POOL = Executors.newFixedThreadPool(LOOKUP_THREADS);
  private static final Handler UI = new Handler(Looper.getMainLooper());
  private static final Map<String, String> CACHE = new HashMap<>();

  interface Ready {
    /** On the ui thread. Empty when no provider has a photo of this person. */
    void onPhoto(String url);
  }

  static void get(Shows.Actor actor, Ready ready) {
    if (actor.name.isEmpty()) {
      ready.onPhoto("");
      return;
    }
    String key = actor.name;
    String cached;
    synchronized (CACHE) {
      cached = CACHE.get(key);
    }
    if (cached != null) {
      ready.onPhoto(cached);
      return;
    }
    POOL.execute(
        () -> {
          String url = fetch(actor);
          synchronized (CACHE) {
            CACHE.put(key, url);
          }
          UI.post(() -> ready.onPhoto(url));
        });
  }

  /** The reply is a json array of urls, one per person asked about. */
  private static String fetch(Shows.Actor actor) {
    try {
      JSONObject person = new JSONObject();
      person.put("name", actor.name);
      JSONObject body = new JSONObject();
      body.put("people", new JSONArray().put(person));
      return new JSONArray(Http.postJson(PERSON_URL, body.toString())).optString(0, "");
    } catch (Exception e) {
      Log.e(TAG, "actor photo lookup failed for " + actor.name + ": " + e);
      return "";
    }
  }
}
