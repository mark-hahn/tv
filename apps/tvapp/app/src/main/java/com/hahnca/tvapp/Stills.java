package com.hahnca.tvapp;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.LruCache;
import android.widget.FrameLayout;
import android.widget.ImageView;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/**
 * The scrub stills: tv-srvr's jpg of every gapMs of the whole episode
 * (stills.js's play set), full screen over the paused video and under its
 * time bar while left/right is held. A decoder seek takes about a second to
 * draw its frame, so a held seek showed one frame in eight; a still is a
 * 100 KB fetch, and the ones the hold is heading for are fetched ahead of it.
 */
class Stills extends FrameLayout {

  private static final int THREADS = 3;
  // Steps fetched ahead of the target, in the hold's direction.
  private static final int AHEAD = 8;
  // A 1920x1080 still is 4 MB decoded. Room for the ones fetched ahead and a
  // few behind.
  private static final int CACHED = 24;
  // A still that wasn't there is asked for again after this long: the set may
  // still be building.
  private static final long RETRY_MS = 1000;
  private static final ExecutorService POOL = Executors.newFixedThreadPool(THREADS);

  private final Handler ui = new Handler(Looper.getMainLooper());
  private final ImageView image;
  // Told each time a still goes up.
  private final Runnable onShown;
  private final LruCache<Integer, Bitmap> cache = new LruCache<>(CACHED);
  private final Set<Integer> loading = new HashSet<>();
  // Still index -> when it last wasn't there.
  private final Map<Integer, Long> missing = new HashMap<>();
  private String urlBase;
  private long gapMs;
  // New per video, so a fetch for the last one lands nowhere.
  private Object token;
  // Still indexes: the target's, and the one on screen (-1 for none).
  private int wanted = -1;
  private int shown = -1;
  private int dir;
  private long durMs;

  Stills(Context context, Runnable onShown) {
    super(context);
    this.onShown = onShown;
    setBackgroundColor(Color.BLACK);
    setVisibility(GONE);
    image = new ImageView(context);
    image.setScaleType(ImageView.ScaleType.FIT_CENTER);
    addView(image, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
  }

  /** getPlayUrl's stills, {urlBase, gapMs}, for the video that is starting. */
  void open(JSONObject stills) {
    close();
    token = new Object();
    urlBase = stills == null ? null : stills.optString("urlBase", null);
    gapMs = stills == null ? 0 : stills.optLong("gapMs");
  }

  void close() {
    hide();
    token = null;
    urlBase = null;
    loading.clear();
    missing.clear();
    cache.evictAll();
  }

  /**
   * Whether the video has a set. It may still be building: tv-srvr makes the
   * stills nearest the start first, and one not there yet is asked for again.
   */
  boolean has() {
    return urlBase != null && gapMs > 0;
  }

  /**
   * The still nearest ms, once it is here. Until then the last one stays up,
   * and a still that lands between the two in the hold's direction takes its
   * place, so the picture only ever moves the way the hold is going. stepMs
   * is the hold's signed step.
   */
  void show(long ms, long stepMs, long durMs) {
    this.durMs = durMs;
    dir = stepMs < 0 ? -1 : 1;
    wanted = (int) Math.round(ms / (double) gapMs);
    Bitmap b = cache.get(wanted);
    if (b != null) draw(wanted, b);
    else load(wanted);
    long step = Math.max(1, Math.round(Math.abs(stepMs) / (double) gapMs));
    for (int i = 1; i <= AHEAD; i++) load((int) (wanted + dir * i * step));
  }

  /** Where the still on screen is, -1 for none. */
  long shownMs() {
    return shown < 0 ? -1 : shown * gapMs;
  }

  void hide() {
    setVisibility(GONE);
    image.setImageDrawable(null);
    shown = -1;
  }

  private void load(int n) {
    if (n < 0 || n * gapMs > durMs || cache.get(n) != null || loading.contains(n)) return;
    Long gone = missing.get(n);
    if (gone != null && SystemClock.uptimeMillis() - gone < RETRY_MS) return;
    loading.add(n);
    Object t = token;
    String url = urlBase + String.format(Locale.US, "/%05d.jpg", n + 1);
    POOL.execute(
        () -> {
          byte[] bytes = Images.read(url);
          BitmapFactory.Options opts = new BitmapFactory.Options();
          opts.inPreferredConfig = Bitmap.Config.RGB_565;
          Bitmap b = bytes == null ? null : BitmapFactory.decodeByteArray(bytes, 0, bytes.length, opts);
          ui.post(
              () -> {
                if (t != token) return;
                loading.remove(n);
                if (b == null) {
                  missing.put(n, SystemClock.uptimeMillis());
                  return;
                }
                missing.remove(n);
                cache.put(n, b);
                if ((shown < 0 || (n - shown) * dir > 0) && (wanted - n) * dir >= 0) draw(n, b);
              });
        });
  }

  private void draw(int n, Bitmap b) {
    shown = n;
    image.setImageBitmap(b);
    setVisibility(VISIBLE);
    onShown.run();
  }
}
