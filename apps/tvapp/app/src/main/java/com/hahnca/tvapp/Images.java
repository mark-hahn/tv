package com.hahnca.tvapp;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.util.LruCache;
import android.widget.ImageView;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The actor photos, one thread per image and no cache: a card shows a dozen at
 * most, and they are re-fetched only when its show changes.
 *
 * The card backdrops are the exception -- hundreds of cards, each wanting one --
 * so they go through intoThumb below, which shares a small pool of threads and
 * a cache of bitmaps already at the size the card draws them.
 */
class Images {

  private static final String TAG = "tvapp";
  private static final int TIMEOUT_MS = 15000;
  private static final Handler UI = new Handler(Looper.getMainLooper());
  private static final int THUMB_THREADS = 3;
  // Four times what the sampled-down thumbnails needed, since each is now kept
  // at around twice the card's width -- see THUMB_OVERSAMPLE.
  private static final int THUMB_CACHE_KB = 96 * 1024;
  // A card's bitmap is decoded to about this many times its own width and the
  // ImageView scales it the rest of the way down. Decoding straight to the card
  // width means a power-of-two sample that lands just above it -- 780 halved to
  // 390 for a 368-wide card -- and a box filter resampling that by 1.06 is what
  // makes the images look soft. Coming down from twice the width is a smooth
  // bilinear step instead.
  private static final int THUMB_OVERSAMPLE = 2;
  private static final ExecutorService THUMB_POOL = Executors.newFixedThreadPool(THUMB_THREADS);
  private static final LruCache<String, Bitmap> THUMBS =
      new LruCache<String, Bitmap>(THUMB_CACHE_KB) {
        @Override
        protected int sizeOf(String key, Bitmap value) {
          return value.getByteCount() / 1024;
        }
      };

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
   * A list card's image: decoded to around width px across, kept in a cache so
   * re-filtering the list does not re-fetch what it already had, and queued
   * behind the other cards rather than taking a thread of its own.
   *
   * urls is a preference order, most wanted first -- a show's Thumb, then its
   * Backdrop, then its own poster as the last resort that is the wrong shape
   * but beats an empty card. Each is tried only if the one before it hands out
   * nothing, whether from a 404 (Emby not having that type for this show) or
   * any other fetch failure.
   */
  static void intoThumb(ImageView view, String[] urls, int width, Object token) {
    view.setTag(token);
    String cachedUrl = null;
    Bitmap cached = null;
    for (String url : urls) {
      if (url == null || url.isEmpty()) continue;
      Bitmap hit = THUMBS.get(url);
      if (hit != null) {
        cachedUrl = url;
        cached = hit;
        break;
      }
    }
    if (cached != null) {
      view.setImageBitmap(cached);
      return;
    }
    view.setImageDrawable(null);
    THUMB_POOL.execute(
        () -> {
          for (String url : urls) {
            if (url == null || url.isEmpty()) continue;
            Bitmap bitmap = fetchScaled(url, width);
            if (bitmap == null) continue;
            THUMBS.put(url, bitmap);
            final Bitmap loaded = bitmap;
            UI.post(
                () -> {
                  if (view.getTag() != token) return;
                  view.setImageBitmap(loaded);
                });
            return;
          }
        });
  }

  /**
   * Card image, kept at about THUMB_OVERSAMPLE times width px across so the
   * ImageView has room to filter it down cleanly. The bytes are read once and
   * decoded twice -- bounds, then for real with the sample size those bounds
   * ask for -- so a card holds a thumbnail rather than a full-size backdrop.
   */
  private static Bitmap fetchScaled(String url, int width) {
    byte[] bytes = read(url);
    if (bytes == null) return null;
    try {
      BitmapFactory.Options bounds = new BitmapFactory.Options();
      bounds.inJustDecodeBounds = true;
      BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
      int target = width * THUMB_OVERSAMPLE;
      BitmapFactory.Options opts = new BitmapFactory.Options();
      opts.inSampleSize = 1;
      while (width > 0 && bounds.outWidth / (opts.inSampleSize * 2) >= target) {
        opts.inSampleSize *= 2;
      }
      return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, opts);
    } catch (Exception e) {
      Log.e(TAG, "thumb decode failed: " + e);
      return null;
    }
  }

  private static byte[] read(String url) {
    HttpURLConnection conn = null;
    try {
      conn = (HttpURLConnection) new URL(url).openConnection();
      conn.setConnectTimeout(TIMEOUT_MS);
      conn.setReadTimeout(TIMEOUT_MS);
      try (InputStream in = conn.getInputStream()) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toByteArray();
      }
    } catch (Exception e) {
      Log.e(TAG, "image load failed: " + e);
      return null;
    } finally {
      if (conn != null) conn.disconnect();
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
