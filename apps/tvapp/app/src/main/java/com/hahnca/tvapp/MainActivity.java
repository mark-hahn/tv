package com.hahnca.tvapp;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity implements CtrlServer.Listener {

  private static final String TAG = "tvapp";
  private static final float EXIT_TEXT_SIZE_SP = 16f;
  private static final float EXIT_MARGIN_DP = 24f;
  private static final float BUTTON_GAP_DP = 12f;
  // Share of the screen width the show list gets.
  private static final float LIST_WIDTH_FRACTION = 0.4f;
  private static final float PANE_TOP_MARGIN_DP = 44f;

  // The web client's simple-mode tabs, in its order. Each has a pane of the
  // same name holding what that pane holds there.
  private static final String[] TAB_LABELS = {"Info", "Map", "Actor", "Trailer"};
  private static final float TAB_TEXT_SIZE_SP = 14.3f;
  private static final float TAB_PAD_DP = 2f;
  private static final float TAB_GAP_DP = 6f;
  private static final int TAB_BG = 0xFF404040;
  private static final int TAB_ACTIVE_BG = 0xFF0A4A8A;
  private static final float TAB_CORNER_DP = 6f;

  // The selected show is remembered across runs, so the app comes back where it
  // was left rather than at the top of a list of a couple hundred shows.
  private static final String PREFS_NAME = "tvapp";
  private static final String KEY_SELECTED_SHOW = "selectedShow";

  // Loading a show into Emby is the web client's TV button, verbatim: tv-tv
  // powers the set on, brings Emby to the front and hands it the show.
  private static final String VIEWSHOW_URL = "https://hahnca.com/tv-tv/tv/viewshow";
  private static final int VIEWSHOW_TIMEOUT_MS = 10000;
  // Leaving tvapp any other way lands on the launcher, so Exit opens Emby
  // itself. Local intent, not tv-tv: nothing has to be loaded into it.
  private static final String EMBY_PACKAGE = "com.mb.android";
  // Asks the set to bring tvapp back to the front, see bringToFront.
  private static final String OPEN_TVAPP_URL = "https://hahnca.com/tv-tv/tv/opentvapp";

  // The cursor held in the top or bottom quarter of the screen, over the list
  // column, scrolls the list — there is no other way to reach show 200 with a
  // pointer. Speed ramps linearly from a standstill at the quarter line to
  // SCROLL_STEP_DP a tick hard against the edge, so one gesture covers both a
  // nudge of a row or two and a run to the end of the list.
  private static final float SCROLL_ZONE_FRACTION = 0.25f;
  private static final float SCROLL_STEP_DP = 12f;
  private static final long SCROLL_INTERVAL_MS = 16;
  // Whichever pane is showing scrolls the same way, but at one steady crawl in
  // either direction: a description or a cast is not a list of two hundred.
  private static final float PANE_SCROLL_ZONE_DP = 60f;
  private static final float PANE_SCROLL_STEP_DP = 2f;

  // Pointer acceleration, the same bargain a desktop mouse makes: a slow drag
  // is passed through untouched so a card can be aimed at, and a fast one is
  // multiplied so the far corner of a 4K screen is one flick away instead of
  // several hand resets on a phone-sized surface.
  private static final float ACCEL_MAX_GAIN = 3.5f;
  private static final float ACCEL_FULL_SPEED_PX_MS = 3f; // speed at max gain
  private static final long ACCEL_MAX_GAP_MS = 100; // longer gap = a new stroke

  private final Handler ui = new Handler(Looper.getMainLooper());

  private CursorView cursor;
  private CtrlServer ctrlServer;
  private ShowListView showList;
  private InfoView info;
  private final List<Pane> panes = new ArrayList<>();
  private final List<Button> tabs = new ArrayList<>();
  private Pane activePane;
  private TrailerPlayer player;
  private Scroller scrollTarget; // what the cursor is scrolling, null for nothing
  private float scrollStepDp; // signed dp a tick, negative for up
  private float scrollRemainder; // sub-pixel carry, so slow speeds still move

  // A drag sends motion at ~60 Hz from the socket thread. Deltas are summed and
  // applied by one posted runnable rather than posting one per packet.
  private float pendingDx;
  private float pendingDy;
  private boolean movePending;
  private long lastMoveAt; // when the previous batch was applied, for accelGain
  private boolean foreground; // whether this activity is the one on screen

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    // Cheap insurance: if the boot receiver lost the race with Wi-Fi coming up,
    // opening the app puts wireless debugging back.
    AdbWifi.enable(this);

    // The tv's screensaver takes the screen out from under a cursor that is
    // being dragged, and a dream deep enough to stop the activity would take the
    // ctrl socket with it.
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

    setContentView(buildUi());

    showList.setSelectionListener(this::onShowSelected);
    String remembered = prefs().getString(KEY_SELECTED_SHOW, null);
    Shows.load(shows -> ui.post(() -> showList.setShows(shows, remembered)));

    ctrlServer = new CtrlServer(this);
    ctrlServer.start();
  }

  private View buildUi() {
    FrameLayout root = new FrameLayout(this);
    root.setBackgroundColor(Color.BLACK);

    // Show list down the left, the rest empty apart from the buttons.
    LinearLayout columns = new LinearLayout(this);
    columns.setOrientation(LinearLayout.HORIZONTAL);
    columns.setWeightSum(1f);

    showList = new ShowListView(this);
    columns.addView(showList, column(LIST_WIDTH_FRACTION));

    FrameLayout right = new FrameLayout(this);
    columns.addView(right, column(1f - LIST_WIDTH_FRACTION));
    right.addView(buildPanes(), paneParams());
    right.addView(buildButtons(), buttonsParams());
    selectTab(0);

    root.addView(columns, matchParent());

    // Over the whole screen while a trailer plays, and gone the rest of the
    // time. Still under the cursor, which is added after it.
    player = new TrailerPlayer(this);
    root.addView(player, matchParent());

    // Added last so the arrow draws over everything else.
    cursor = new CursorView(this);
    root.addView(cursor, matchParent());

    return root;
  }

  /**
   * Emby, then the tabs, which are the web client's simple-mode ones, then Exit.
   * Only the tabs are weighted, so they spread across the pane and the two
   * action buttons keep their own width at either end of the row.
   */
  private View buildButtons() {
    LinearLayout buttons = new LinearLayout(this);
    buttons.setOrientation(LinearLayout.HORIZONTAL);
    buttons.addView(button("Emby", v -> embyClick()), buttonParams(dp(BUTTON_GAP_DP)));
    for (int i = 0; i < TAB_LABELS.length; i++) {
      final int index = i;
      Button tab = button(TAB_LABELS[i], v -> selectTab(index));
      tab.setTextSize(TypedValue.COMPLEX_UNIT_SP, TAB_TEXT_SIZE_SP);
      // A Button's own minimum width and padding are both wider than a fifth of
      // the pane; left alone they push Emby and Exit off the edge and wrap the
      // longer labels onto a second line the button is too short to show.
      tab.setMinWidth(0);
      tab.setMinimumWidth(0);
      tab.setSingleLine(true);
      int pad = (int) dp(TAB_PAD_DP);
      tab.setPadding(pad, 0, pad, 0);
      // Its own background rather than the theme's: tinting a platform Button
      // and then clearing the tint does not give the platform look back, it
      // gives a white button with white text.
      GradientDrawable bg = new GradientDrawable();
      bg.setCornerRadius(dp(TAB_CORNER_DP));
      tab.setBackground(bg);
      tab.setTextColor(Color.WHITE);
      tabs.add(tab);
      buttons.addView(tab, tabParams());
    }
    buttons.addView(button("Exit", v -> exitClick()), buttonParams(0));
    return buttons;
  }

  private View buildPanes() {
    FrameLayout holder = new FrameLayout(this);
    info = new InfoView(this);
    // The poster is the pane's biggest target, and loading the show it shows is
    // the only thing this screen does, so it is a second Emby button.
    info.setPosterClickListener(v -> embyClick());
    panes.add(info);
    panes.add(new MapView(this));
    panes.add(new ActorsView(this));
    panes.add(new ReviewsView(this));
    TrailersView trailers = new TrailersView(this);
    trailers.setPlayListener(url -> player.play(url));
    panes.add(trailers);
    for (Pane pane : panes) {
      pane.asView().setVisibility(View.GONE);
      holder.addView(pane.asView(), matchParent());
    }
    return holder;
  }

  /** Shows one tab's pane and hides the rest; the tab itself goes blue. */
  private void selectTab(int index) {
    for (int i = 0; i < panes.size(); i++) {
      panes.get(i).asView().setVisibility(i == index ? View.VISIBLE : View.GONE);
      paint(tabs.get(i), TAB_BG);
    }
    paint(tabs.get(index), TAB_ACTIVE_BG);
    activePane = panes.get(index);
    activePane.onShown();
  }

  private void paint(Button tab, int color) {
    ((GradientDrawable) tab.getBackground()).setColor(color);
  }

  private LinearLayout.LayoutParams tabParams() {
    LinearLayout.LayoutParams params =
        new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
    params.rightMargin = (int) dp(TAB_GAP_DP);
    return params;
  }

  private Button button(String label, View.OnClickListener onClick) {
    Button button = new Button(this);
    button.setText(label);
    button.setTextSize(TypedValue.COMPLEX_UNIT_SP, EXIT_TEXT_SIZE_SP);
    button.setOnClickListener(onClick);
    return button;
  }

  private LinearLayout.LayoutParams buttonParams(float rightMargin) {
    LinearLayout.LayoutParams params =
        new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    params.rightMargin = (int) rightMargin;
    return params;
  }

  /** Selection outlives the app: it is written through to disk on every click. */
  private void onShowSelected(Shows.Show show) {
    for (Pane pane : panes) pane.setShow(show);
    prefs().edit().putString(KEY_SELECTED_SHOW, show.name).apply();
  }

  private SharedPreferences prefs() {
    return getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
  }

  private FrameLayout.LayoutParams paneParams() {
    FrameLayout.LayoutParams params =
        new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
    // Starts below the button row, which spans this half of the screen.
    params.topMargin = (int) dp(PANE_TOP_MARGIN_DP);
    return params;
  }

  private FrameLayout.LayoutParams buttonsParams() {
    // Full width, or the weighted tabs would have no spare width to share out
    // and would each collapse to their own label.
    FrameLayout.LayoutParams params =
        new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.TOP | Gravity.END);
    // Hard against the top of the screen; only the side inset is kept.
    int margin = (int) dp(EXIT_MARGIN_DP);
    params.setMargins(margin, 0, margin, margin);
    return params;
  }

  private LinearLayout.LayoutParams column(float fraction) {
    return new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, fraction);
  }

  /** Loads the selected show into Emby, which takes the screen from us. */
  private void embyClick() {
    Shows.Show show = showList.getSelected();
    if (show == null) return;
    new Thread(
            () -> {
              try {
                String url =
                    VIEWSHOW_URL
                        + "?showId="
                        + URLEncoder.encode(show.id, "UTF-8")
                        + "&showName="
                        + URLEncoder.encode(show.name, "UTF-8");
                HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(VIEWSHOW_TIMEOUT_MS);
                conn.setReadTimeout(VIEWSHOW_TIMEOUT_MS);
                conn.getInputStream().close();
                conn.disconnect();
              } catch (Exception e) {
                Log.e(TAG, "viewshow failed for " + show.name + ": " + e);
              }
              // Only once the request is away: finishing can take the process
              // with it, and tv-tv is what brings Emby up.
              ui.post(this::finishAndRemoveTask);
            },
            "viewshow")
        .start();
  }

  private void exitClick() {
    openEmby();
    finishAndRemoveTask();
  }

  private void openEmby() {
    Intent intent = getPackageManager().getLeanbackLaunchIntentForPackage(EMBY_PACKAGE);
    if (intent == null) intent = getPackageManager().getLaunchIntentForPackage(EMBY_PACKAGE);
    if (intent == null) {
      Log.e(TAG, "no launch intent for " + EMBY_PACKAGE);
      return;
    }
    startActivity(intent);
  }

  private FrameLayout.LayoutParams matchParent() {
    return new FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
  }

  private float dp(float value) {
    return TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics());
  }

  @Override
  protected void onDestroy() {
    ui.removeCallbacks(autoScroll);
    ctrlServer.shutdown();
    super.onDestroy();
  }

  @Override
  public void onMove(float dx, float dy) {
    synchronized (this) {
      pendingDx += dx;
      pendingDy += dy;
      if (movePending) return;
      movePending = true;
    }
    ui.post(this::applyMove);
  }

  private void applyMove() {
    float dx;
    float dy;
    synchronized (this) {
      dx = pendingDx;
      dy = pendingDy;
      pendingDx = 0;
      pendingDy = 0;
      movePending = false;
    }
    float gain = accelGain(dx, dy);
    cursor.moveBy(dx * gain, dy * gain);
    updateAutoScroll();
  }

  /**
   * How much to multiply this batch of motion by, from how fast the finger is
   * moving. Speed is measured over the gap between batches rather than per
   * event: the deltas arrive already coalesced to one batch a frame, and a gap
   * long enough to be a new stroke is clamped so it starts unaccelerated.
   */
  private float accelGain(float dx, float dy) {
    long now = SystemClock.uptimeMillis();
    long gap = Math.min(now - lastMoveAt, ACCEL_MAX_GAP_MS);
    lastMoveAt = now;
    if (gap <= 0) return 1;
    float speed = (float) Math.hypot(dx, dy) / gap;
    float ramp = Math.min(speed / ACCEL_FULL_SPEED_PX_MS, 1f);
    return 1 + (ACCEL_MAX_GAIN - 1) * ramp;
  }

  /**
   * Picks what the arrow's position scrolls and how fast. Over the list, the
   * top and bottom quarters scroll it at a speed that ramps up towards the
   * edge; over the info pane, the bottom edge scrolls the description down at a
   * constant crawl, which is all a paragraph needs. The scrolling has to keep
   * going while the cursor is simply held there, so it runs off its own
   * repeating post rather than off arriving motion — which is also why the
   * target and step are fields and not arguments.
   */
  private void updateAutoScroll() {
    float x = cursor.getPosX();
    float y = cursor.getPosY();
    float height = cursor.getHeight();
    float zone = height * SCROLL_ZONE_FRACTION;
    Scroller target = null;
    float stepDp = 0;
    if (x < showList.getWidth()) {
      float speed = 0;
      if (zone > 0 && y < zone) speed = -(zone - y) / zone;
      else if (zone > 0 && y > height - zone) speed = (y - (height - zone)) / zone;
      if (speed != 0) {
        target = showList;
        stepDp = speed * SCROLL_STEP_DP;
      }
    } else {
      // The zone stops at the pane's own top so that reaching up for a tab does
      // not scroll the pane out from under the cursor on the way.
      float paneTop = dp(PANE_TOP_MARGIN_DP);
      float paneZone = dp(PANE_SCROLL_ZONE_DP);
      if (y > paneTop && y < paneTop + paneZone) {
        target = activePane;
        stepDp = -PANE_SCROLL_STEP_DP;
      } else if (y > height - paneZone) {
        target = activePane;
        stepDp = PANE_SCROLL_STEP_DP;
      }
    }
    boolean wasStopped = scrollTarget == null;
    if (target != scrollTarget) scrollRemainder = 0;
    scrollTarget = target;
    scrollStepDp = stepDp;
    if (target == null) {
      ui.removeCallbacks(autoScroll);
    } else if (wasStopped) {
      ui.post(autoScroll);
    }
  }

  private final Runnable autoScroll =
      new Runnable() {
        @Override
        public void run() {
          if (scrollTarget == null) return;
          float px = dp(scrollStepDp) + scrollRemainder;
          int whole = (int) px;
          scrollRemainder = px - whole;
          scrollTarget.scrollStep(whole);
          ui.postDelayed(this, SCROLL_INTERVAL_MS);
        }
      };

  @Override
  public void onClick() {
    if (!foreground) {
      ui.post(this::bringToFront);
    } else if (player.isPlaying()) {
      ui.post(player::close);
    } else {
      ui.post(this::clickAtCursor);
    }
  }

  /**
   * A click that arrives while something else owns the screen — a trailer
   * playing in YouTube, say — brings tvapp back instead of being aimed at a
   * cursor nobody can see. The ctrl socket outlives being backgrounded, so the
   * phone can do this without leaving the tvappctrl screen at all.
   *
   * Asking tv-tv rather than calling startActivity: Android blocks an activity
   * start from an app that is in the background, and no permission a sideloaded
   * app can grant itself lifts that. tv-tv asks the set to open its own app,
   * which is not a background start — the same route opening tvappctrl on the
   * phone already takes.
   */
  private void bringToFront() {
    new Thread(
            () -> {
              try {
                Http.get(OPEN_TVAPP_URL);
              } catch (Exception e) {
                Log.e(TAG, "opentvapp failed: " + e);
              }
            },
            "opentvapp")
        .start();
  }

  @Override
  protected void onResume() {
    super.onResume();
    foreground = true;
  }

  @Override
  protected void onPause() {
    foreground = false;
    super.onPause();
  }

  // Closing tvappctrl on the phone closes tvapp here. The reverse direction needs
  // nothing: the relay notices this activity's socket dropping.
  @Override
  public void onExit() {
    ui.post(this::finishAndRemoveTask);
  }

  /**
   * Clicks whatever is under the arrow by synthesizing a touch at the cursor
   * hotspot. Dispatching into the view hierarchy instead of calling a listener
   * directly means any widget this ui grows is clickable with no more plumbing.
   */
  private void clickAtCursor() {
    float x = cursor.getPosX();
    float y = cursor.getPosY();
    View root = getWindow().getDecorView();
    long now = SystemClock.uptimeMillis();
    dispatchTouch(root, MotionEvent.ACTION_DOWN, now, x, y);
    dispatchTouch(root, MotionEvent.ACTION_UP, now, x, y);
  }

  private void dispatchTouch(View root, int action, long downTime, float x, float y) {
    MotionEvent event = MotionEvent.obtain(downTime, downTime, action, x, y, 0);
    root.dispatchTouchEvent(event);
    event.recycle();
  }

  @Override
  public boolean onKeyDown(int keyCode, KeyEvent event) {
    if (keyCode == KeyEvent.KEYCODE_BACK) {
      // A trailer playing is what Back means first; only an idle screen exits.
      if (player.isPlaying()) player.close();
      else finishAndRemoveTask();
      return true;
    }
    return super.onKeyDown(keyCode, event);
  }
}
