package com.hahnca.tvapp;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadataRetriever;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.widget.ImageView;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;

/**
 * Posters and actor photos. One thread per image and no cache: a pane shows a
 * couple of dozen at most, and they are re-fetched only when the show changes.
 */
class Images {

  private static final String TAG = "tvapp";
  private static final int TIMEOUT_MS = 15000;
  private static final Handler UI = new Handler(Looper.getMainLooper());

  /**
   * Loads url into view, unless the view has been handed to another show in the
   * meantime — which is what the tag is for: the caller stamps its own token,
   * and a load whose token no longer matches drops its bitmap.
   */
  static void into(ImageView view, String url, Object token) {
    view.setImageDrawable(null);
    view.setTag(token);
    if (url == null || url.isEmpty()) return;
    new Thread(
            () -> {
              Bitmap bitmap = fetch(url);
              if (bitmap == null) return;
              UI.post(
                  () -> {
                    if (view.getTag() != token) return;
                    view.setImageBitmap(bitmap);
                  });
            },
            "image")
        .start();
  }

  /**
   * The same, for a video that has no still of its own to fetch: its first
   * frame, which is what the web client's video element shows before it is
   * played. Only the imdb trailer needs this — YouTube hands out a thumbnail.
   */
  static void frameInto(ImageView view, String url, Object token) {
    view.setImageDrawable(null);
    view.setTag(token);
    if (url == null || url.isEmpty()) return;
    new Thread(
            () -> {
              Bitmap bitmap = frame(url);
              if (bitmap == null) return;
              UI.post(
                  () -> {
                    if (view.getTag() != token) return;
                    view.setImageBitmap(bitmap);
                  });
            },
            "video-frame")
        .start();
  }

  private static Bitmap frame(String url) {
    MediaMetadataRetriever retriever = new MediaMetadataRetriever();
    try {
      retriever.setDataSource(url, new HashMap<String, String>());
      return retriever.getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
    } catch (Exception e) {
      Log.e(TAG, "video frame load failed: " + e);
      return null;
    } finally {
      try {
        retriever.release();
      } catch (Exception e) {
        Log.e(TAG, "video frame release failed: " + e);
      }
    }
  }

  private static Bitmap fetch(String url) {
    HttpURLConnection conn = null;
    try {
      conn = (HttpURLConnection) new URL(url).openConnection();
      conn.setConnectTimeout(TIMEOUT_MS);
      conn.setReadTimeout(TIMEOUT_MS);
      try (InputStream in = conn.getInputStream()) {
        return BitmapFactory.decodeStream(in);
      }
    } catch (Exception e) {
      Log.e(TAG, "image load failed: " + e);
      return null;
    } finally {
      if (conn != null) conn.disconnect();
    }
  }
}
