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
 * One episode's still, description and aired date, which the show record does
 * not carry -- its episodeData holds only what the map cells are drawn from.
 *
 * The same tv-srvr call the web client's map pane makes when an episode cell is
 * clicked, so the episode card here shows what that pane shows. Answers are
 * remembered for the life of the app: stepping back and forth along a season is
 * exactly what this is asked for, and TMDB is a round trip away.
 */
class Episodes {

  private static final String TAG = "tvapp";
  private static final String TMDB_URL = "https://hahnca.com/tv-srvr/api/getTmdb";
  // A card at a time is what the cursor asks for, so a couple of threads keeps
  // a run along a season from queueing up behind one slow lookup.
  private static final int LOOKUP_THREADS = 2;

  private static final ExecutorService POOL = Executors.newFixedThreadPool(LOOKUP_THREADS);
  private static final Handler UI = new Handler(Looper.getMainLooper());
  private static final Map<String, Info> CACHE = new HashMap<>();

  /** Empty strings rather than nulls: every field of this goes into a view. */
  static class Info {
    final String image;
    final String overview;
    final String aired;

    Info(String image, String overview, String aired) {
      this.image = image;
      this.overview = overview;
      this.aired = aired;
    }
  }

  interface Ready {
    void onEpisode(Info info);
  }

  /** Answers on the ui thread, at once for an episode asked about before. */
  static void get(Shows.Show show, int season, int episode, Ready ready) {
    String key = show.name + "|" + season + "|" + episode;
    Info cached;
    synchronized (CACHE) {
      cached = CACHE.get(key);
    }
    if (cached != null) {
      ready.onEpisode(cached);
      return;
    }
    POOL.execute(
        () -> {
          Info info = fetch(show, season, episode);
          synchronized (CACHE) {
            CACHE.put(key, info);
          }
          UI.post(() -> ready.onEpisode(info));
        });
  }

  /**
   * TMDB having nothing for the episode is cached as readily as a real answer:
   * the cursor comes back over the same cell, and asking again would be another
   * round trip to be told the same thing.
   */
  private static Info fetch(Shows.Show show, int season, int episode) {
    try {
      JSONObject body = new JSONObject();
      body.put("showName", show.name);
      body.put("season", season);
      body.put("episode", episode);
      JSONObject rec = new JSONObject(Http.postJson(TMDB_URL, body.toString()));
      return new Info(str(rec, "image"), str(rec, "overview"), str(rec, "aired"));
    } catch (Exception e) {
      Log.e(TAG, "episode lookup failed for " + show.name + " S" + season + "E" + episode + ": " + e);
      return new Info("", "", "");
    }
  }

  private static String str(JSONObject rec, String key) {
    return rec.isNull(key) ? "" : rec.optString(key, "");
  }
}
