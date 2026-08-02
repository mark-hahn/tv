package com.hahnca.tvapp;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import java.util.Iterator;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The imdb video, which the web client's trailer pane adds to a show as it
 * opens it and this app has to add for itself: the tvdb record carries only the
 * trailers tvdb knows about, so without this a show whose second trailer is
 * imdb's shows one card here and two there — and the one-trailer shortcut
 * plays a video the show does not really have on its own.
 *
 * Asked once per show and not saved back: the url is signed and expires, so it
 * is worth no more than the sitting the app is up for.
 */
class ImdbTrailer {

  private static final String REMOTES_URL = "https://hahnca.com/tv-srvr/api/getRemotes";
  private static final String TAG = "tvapp";
  private static final String TRAILER_NAME = "IMDB Video";
  private static final String VIDEO_HOST = "imdb-video.media-imdb.com";
  private static final String IMDB_REMOTE = "IMDB";
  // A url within two minutes of its Expires is not worth a card -- the same
  // margin the web client keeps before it goes and fetches a fresh one.
  private static final long EXPIRY_MARGIN_MS = 2 * 60 * 1000;
  private static final Pattern EXPIRES = Pattern.compile("[?&]Expires=(\\d+)");
  private static final Handler UI = new Handler(Looper.getMainLooper());

  interface Done {
    /** On the ui thread, saying whether the show's trailer list changed. */
    void onImdbChecked(boolean changed);
  }

  /**
   * Called on the ui thread with the show that has just become the active one.
   * A show already asked about is left alone, callback and all: nothing about
   * its trailers can have changed since.
   */
  static void ensure(Shows.Show show, Done done) {
    if (show.imdbChecked) return;
    boolean dropped = dropExpired(show);
    if (hasVideo(show)) {
      show.imdbChecked = true;
      done.onImdbChecked(dropped);
      return;
    }
    new Thread(
            () -> {
              Shows.Trailer found = fetch(show);
              UI.post(
                  () -> {
                    if (found != null) show.trailers.add(found);
                    show.imdbChecked = true;
                    done.onImdbChecked(dropped || found != null);
                  });
            },
            "imdb-video")
        .start();
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

  /** A record saved a while ago can carry a url that has run out; that is no card. */
  private static boolean dropExpired(Shows.Show show) {
    boolean dropped = false;
    for (Iterator<Shows.Trailer> it = show.trailers.iterator(); it.hasNext(); ) {
      Shows.Trailer trailer = it.next();
      if (isVideo(trailer.url) && expired(trailer.url)) {
        it.remove();
        dropped = true;
      }
    }
    return dropped;
  }

  private static boolean hasVideo(Shows.Show show) {
    for (Shows.Trailer trailer : show.trailers) {
      if (isVideo(trailer.url)) return true;
    }
    return false;
  }

  private static boolean isVideo(String url) {
    return url.contains(VIDEO_HOST);
  }

  private static boolean expired(String url) {
    Matcher matcher = EXPIRES.matcher(url);
    if (!matcher.find()) return false; // unsigned, so it does not run out
    try {
      long expiresMs = Long.parseLong(matcher.group(1)) * 1000L;
      return expiresMs <= System.currentTimeMillis() + EXPIRY_MARGIN_MS;
    } catch (NumberFormatException e) {
      return false;
    }
  }
}
