package com.hahnca.tvapp;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import java.net.URLEncoder;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/**
 * The landscape image a show-list card wants, which the tvdb record does not
 * have: its own image is a portrait poster, the wrong shape for a card.
 *
 * tv-srvr finds a backdrop in TMDB, by the show's TMDB id where the record
 * carries one and by name where it does not, and caches its own answers
 * -- so this asks once per show and remembers what it was told. An empty url is
 * TMDB having nothing, and is cached as readily as a real one: the caller falls
 * back to the poster and must not ask again on every scroll.
 */
class Backdrops {

  private static final String TAG = "tvapp";
  private static final String BACKDROP_URL = "https://hahnca.com/tv-srvr/api/getBackdrop";
  // Only the cards on screen ever ask, so a few at a time is enough, and it
  // keeps a fast scroll from opening a connection per card it passes.
  private static final int LOOKUP_THREADS = 3;

  private static final ExecutorService POOL = Executors.newFixedThreadPool(LOOKUP_THREADS);
  private static final Handler UI = new Handler(Looper.getMainLooper());
  private static final Map<String, String> CACHE = new HashMap<>();

  interface Ready {
    /** Candidates in the order they should be tried, most wanted first. */
    void onUrls(String[] urls);
  }

  /**
   * Answers on the ui thread, at once for a show that has been asked about
   * before. width is what the image will be drawn at.
   */
  static void get(Shows.Show show, int width, Ready ready) {
    String cached;
    synchronized (CACHE) {
      cached = CACHE.get(show.name);
    }
    if (cached != null) {
      ready.onUrls(new String[] {cached});
      return;
    }
    POOL.execute(
        () -> {
          String url = fetch(show);
          synchronized (CACHE) {
            CACHE.put(show.name, url);
          }
          UI.post(() -> ready.onUrls(new String[] {url}));
        });
  }

  private static String fetch(Shows.Show show) {
    try {
      String query =
          show.tmdbId.isEmpty()
              ? "?showName=" + URLEncoder.encode(show.name, "UTF-8")
              : "?tmdbId=" + URLEncoder.encode(show.tmdbId, "UTF-8");
      JSONObject rec = new JSONObject(Http.get(BACKDROP_URL + query));
      return rec.isNull("url") ? "" : rec.optString("url", "");
    } catch (Exception e) {
      Log.e(TAG, "backdrop lookup failed for " + show.name + ": " + e);
      return "";
    }
  }
}
