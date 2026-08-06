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
 * A show in Emby has one already -- Emby fetches a 1920x1080 backdrop from
 * TheTVDB and fanart.tv for every series it holds -- and hands it out resized
 * to whatever width is asked for, so those need no lookup at all and arrive at
 * exactly the card's size with nothing left to rescale on this end.
 *
 * The rest, the ones only the Trash filter shows, have no Emby item to ask.
 * For those tv-srvr finds a backdrop in TMDB, by the show's TMDB id where the
 * record carries one and by name where it does not, and caches its own answers
 * -- so this asks once per show and remembers what it was told. An empty url is
 * TMDB having nothing, and is cached as readily as a real one: the caller falls
 * back to the poster and must not ask again on every scroll.
 */
class Backdrops {

  private static final String TAG = "tvapp";
  private static final String BACKDROP_URL = "https://hahnca.com/tv-srvr/api/getBackdrop";
  // Emby's own image api, which takes the width it should hand back. No api key:
  // it serves images to anyone who asks, so none has to live in this apk. Emby's
  // tls port rather than its plain one, which would need a cleartext exception
  // in the manifest that nothing else here wants.
  private static final String EMBY_IMAGE_URL = "https://hahnca.com:8920/emby/Items";
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
   * Answers on the ui thread, at once for a show in Emby or one that has been
   * asked about before. width is what the image will be drawn at.
   */
  static void get(Shows.Show show, int width, Ready ready) {
    if (show.inEmby) {
      // Thumb is Emby's own title card -- the show's logo composited on a 16:9
      // crop, what its own apps show for this same kind of row -- and exists for
      // about two thirds of the library. Backdrop, plain wide art with nothing
      // on it, exists for nearly all of it, and is the plainer image seen till
      // now. Neither call costs a round trip: Emby 404s the ones it does not
      // have, which fetchScaled treats the same as any other failed fetch.
      String base = EMBY_IMAGE_URL + "/" + show.id + "/Images/";
      String widthQuery = "?maxWidth=" + width;
      ready.onUrls(
          new String[] {base + "Thumb" + widthQuery, base + "Backdrop/0" + widthQuery});
      return;
    }
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
