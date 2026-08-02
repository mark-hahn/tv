package com.hahnca.tvapp;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * What a show's trailers are once they have been sorted out, which the record
 * alone does not say. Two things are wrong with the list as it arrives:
 *
 * <p>It is missing the imdb video. The web client's trailer pane fetches that
 * as it opens a show and this app has to fetch it for itself, or a show whose
 * second trailer is imdb's shows one card here and two there.
 *
 * <p>It can carry a video that will not play. Imdb's urls are signed and its
 * cdn answers 403 for the ones it no longer likes, which the web client only
 * finds out when the video element fails and this app would never find out at
 * all — it drew an empty card and counted it as a trailer.
 *
 * Sorted out once per show and not saved back: an answer that turns on a
 * signed url is worth no more than the sitting the app is up for.
 */
class TrailerList {

  private static final String REMOTES_URL = "https://hahnca.com/tv-srvr/api/getRemotes";
  private static final String TAG = "tvapp";
  private static final String TRAILER_NAME = "IMDB Video";
  private static final String VIDEO_HOST = "imdb-video.media-imdb.com";
  private static final String IMDB_REMOTE = "IMDB";
  private static final Handler UI = new Handler(Looper.getMainLooper());

  interface Done {
    /** On the ui thread, once show.trailers is what it is going to be. */
    void onTrailersReady();
  }

  /**
   * Called on the ui thread with the show that has just become the active one.
   * A show already sorted out is left alone, callback and all: nothing about
   * its trailers can have changed since.
   */
  static void settle(Shows.Show show, Done done) {
    if (show.trailersReady) return;
    List<Shows.Trailer> starting = new ArrayList<>(show.trailers);
    new Thread(
            () -> {
              List<Shows.Trailer> settled = new ArrayList<>();
              for (Shows.Trailer trailer : starting) {
                if (playable(trailer.url)) settled.add(trailer);
              }
              if (!hasImdbVideo(settled)) {
                Shows.Trailer found = fetch(show);
                if (found != null && playable(found.url)) settled.add(found);
              }
              UI.post(
                  () -> {
                    show.trailers.clear();
                    show.trailers.addAll(settled);
                    show.trailersReady = true;
                    done.onTrailersReady();
                  });
            },
            "trailers")
        .start();
  }

  /**
   * Whether this one gets a card. YouTube's own player answers for its videos;
   * anything else has to be a video file the player can hand to a video
   * element, and one the host will really serve.
   *
   * Asking is the only way to tell. The Expires in an imdb url says nothing
   * useful either way: its cdn serves urls whose Expires went by a week ago and
   * refuses others that are still well within theirs.
   */
  private static boolean playable(String url) {
    if (Trailers.isYoutube(url)) return true;
    return Trailers.isVideoFile(url) && Http.loads(url);
  }

  /** The imdb video from a getRemotes call, or null when there is none. */
  private static Shows.Trailer fetch(Shows.Show show) {
    try {
      JSONObject body =
          new JSONObject()
              .put("show", new JSONObject().put("name", show.name).put("id", show.id))
              .put("tvdbRemotes", show.remoteIds == null ? new JSONArray() : show.remoteIds)
              // fast: the scrape that finds the video, without the ratings work
              // the info pane wants -- the same call the web client makes here.
              .put("fast", true);
      JSONArray remotes = new JSONArray(Http.postJson(REMOTES_URL, body.toString()));
      for (int i = 0; i < remotes.length(); i++) {
        JSONObject remote = remotes.optJSONObject(i);
        if (remote == null) continue;
        String video = remote.optString("video", "");
        if (remote.optString("name", "").startsWith(IMDB_REMOTE) && !video.isEmpty()) {
          return new Shows.Trailer(TRAILER_NAME, video);
        }
      }
    } catch (Exception e) {
      Log.e(TAG, "imdb video fetch failed for " + show.name + ": " + e);
    }
    return null;
  }

  private static boolean hasImdbVideo(List<Shows.Trailer> trailers) {
    for (Shows.Trailer trailer : trailers) {
      if (trailer.url.contains(VIDEO_HOST)) return true;
    }
    return false;
  }

}
