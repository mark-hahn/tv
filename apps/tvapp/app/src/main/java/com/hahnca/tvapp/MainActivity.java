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

  // The selected show and the arrow are both remembered across runs, so the app
  // comes back where it was left rather than at the top of a list of a couple
  // hundred shows with the cursor thrown back to the middle of the screen.
  private static final String PREFS_NAME = "tvapp";
  private static final String KEY_SELECTED_SHOW = "selectedShow";
  private static final String KEY_CURSOR_X = "cursorX";
  private static final String KEY_CURSOR_Y = "cursorY";
  // The header's sort outlives the app too. The filter deliberately does not:
  // closing the screen is one of the three things that clears it.
  private static final String KEY_SORT = "sort";

  // Loading a show into Emby is the web client's TV button, verbatim: tv-tv
  // powers the set on, brings Emby to the front and hands it the show.
  private static final String VIEWSHOW_URL = "https://hahnca.com/tv-tv/tv/viewshow";
  private static final int VIEWSHOW_TIMEOUT_MS = 10000;
  // Leaving tvapp any other way lands on the launcher, so Exit opens Emby
  // itself. Local intent, not tv-tv: nothing has to be loaded into it.
  private static final String EMBY_PACKAGE = "com.mb.android";
  // Asks the set to bring tvapp back to the front, see bringToFront.
  private static final String OPEN_TVAPP_URL = "https://hahnca.com/tv-tv/tv/opentvapp";

  // The cursor held in the top or bottom quarter of a list scrolls it — there
  // is no other way to reach show 200 with a pointer. Speed ramps linearly from
  // a standstill at the quarter line to SCROLL_STEP_DP a tick hard against the
  // edge, so one gesture covers both a nudge of a row or two and a run to the
  // end of the list. Every pane holding a list of its own — the description,
  // the map, the cast — scrolls by these same numbers, so the whole screen
  // behaves the one way.
  private static final float SCROLL_ZONE_FRACTION = 0.25f;
  private static final float SCROLL_STEP_DP = 12f;
  private static final long SCROLL_INTERVAL_MS = 16;
  // What is left of the older behaviour, for the panes that are not lists: a
  // steady crawl out of a fixed band at either end.
  private static final float PANE_SCROLL_ZONE_DP = 60f;
  private static final float PANE_SCROLL_STEP_DP = 2f;
  // Scrolling is what the cursor does when it is *held* in the zone. While
  // motion is still arriving it is being aimed instead, and pulling the content
  // out from under it mid-aim makes the target impossible to hit.
  private static final long SCROLL_MOVE_PAUSE_MS = 120;

  // Pointer acceleration, the same bargain a desktop mouse makes: a slow drag
  // is passed through untouched so a card can be aimed at, and a fast one is
  // multiplied so the far corner of a 4K screen is one flick away instead of
  // several hand resets on a phone-sized surface.
  private static final float ACCEL_MAX_GAIN = 3.5f;
  private static final float ACCEL_FULL_SPEED_PX_MS = 3f; // speed at max gain
  private static final long ACCEL_MAX_GAP_MS = 100; // longer gap = a new stroke
  // However fast the finger is going, one batch may not move the arrow further
  // than this. Whenever the ui thread is busy — a pane filling, an image
  // decoding — every frame of motion that arrived meanwhile lands in a single
  // batch, and acceleration multiplies that pile-up into a hop to the corner.
  // A flick is a dozen batches, so a sixth of the screen each still crosses it.
  private static final float MOVE_MAX_STEP_DP = 160f;

  private final Handler ui = new Handler(Looper.getMainLooper());

  private CursorView cursor;
  private CtrlServer ctrlServer;
  private ShowListView showList;
  private ListHeader listHeader;
  private Shows.Sort sort = Shows.Sort.ALPHA;
  // Whether the filter box is the thing the phone's keyboard is typing into.
  // A click on the box means "open that keyboard" or "clear this and close it"
  // depending on it.
  private boolean filtering;
  private InfoView info;
  private final List<Pane> panes = new ArrayList<>();
  private final List<Button> tabs = new ArrayList<>();
  private Pane activePane;
  private TrailerPlayer player;
  private Scroller scrollTarget; // what the cursor is scrolling, null for nothing
  private float scrollStepDp; // signed dp a tick, negative for up
  private float scrollStepDpX; // the same sideways, for the panes that go that way
  private float scrollRemainder; // sub-pixel carry, so slow speeds still move
  private float scrollRemainderX;

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

    // NaN when there is nothing remembered, which is the cursor's own word for
    // the middle of the screen.
    cursor.startAt(
        prefs().getFloat(KEY_CURSOR_X, Float.NaN), prefs().getFloat(KEY_CURSOR_Y, Float.NaN));

    showList.setSelectionListener(this::onShowSelected);
    sort = Shows.Sort.of(prefs().getString(KEY_SORT, null));
    listHeader.setSort(sort);
    showList.setSort(sort);
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
    columns.addView(buildList(), column(LIST_WIDTH_FRACTION));

    FrameLayout right = new FrameLayout(this);
    columns.addView(right, column(1f - LIST_WIDTH_FRACTION));
    right.addView(buildPanes(), paneParams());
    right.addView(buildButtons(), buttonsParams());
    selectTab(0);

    root.addView(columns, matchParent());

    // Over the whole screen while a trailer plays, and gone the rest of the
    // time. Still under the cursor, which is added after it.
    player = new TrailerPlayer(this);
    // The arrow goes away with it: there is nothing on this screen to aim at,
    // and it would sit over the picture for the length of the trailer.
    player.setOpenListener(open -> cursor.setVisibility(open ? View.GONE : View.VISIBLE));
    root.addView(player, matchParent());

    // Added last so the arrow draws over everything else.
    cursor = new CursorView(this);
    root.addView(cursor, matchParent());

    return root;
  }

  /** The filter and sort header over the show list, both the list's own width. */
  private View buildList() {
    LinearLayout left = new LinearLayout(this);
    left.setOrientation(LinearLayout.VERTICAL);
    listHeader =
        new ListHeader(
            this,
            new ListHeader.Listener() {
              @Override
              public void onFilterClick() {
                filterClick();
              }

              @Override
              public void onSortClick(Shows.Sort clicked) {
                sortClick(clicked);
              }
            });
    left.addView(
        listHeader,
        new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, (int) dp(ListHeader.HEIGHT_DP)));
    showList = new ShowListView(this);
    left.addView(
        showList, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
    return left;
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

  /**
   * The filter box clicked. There being no keyboard on a tv, the box is only a
   * display: clicking it asks tvappctrl to put a keyboard up on the phone, and
   * clicking it a second time is one of the three things that takes that
   * keyboard away again and leaves nothing filtered.
   */
  private void filterClick() {
    filtering = !filtering;
    if (!filtering) setFilter("");
    ctrlServer.send(filtering ? CtrlServer.MSG_KEYBOARD_ON : CtrlServer.MSG_KEYBOARD_OFF);
  }

  private void setFilter(String text) {
    listHeader.setFilterText(text);
    showList.setFilter(text);
  }

  /** Clicking the sort already in force turns it off, leaving alphabetical. */
  private void sortClick(Shows.Sort clicked) {
    sort = clicked == sort ? Shows.Sort.ALPHA : clicked;
    listHeader.setSort(sort);
    showList.setSort(sort);
    prefs().edit().putString(KEY_SORT, sort.name()).apply();
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
    dx *= gain;
    dy *= gain;
    // Both components by the same factor, so a clamped batch still goes the way
    // the finger went.
    float distance = (float) Math.hypot(dx, dy);
    float max = dp(MOVE_MAX_STEP_DP);
    if (distance > max) {
      dx *= max / distance;
      dy *= max / distance;
    }
    cursor.moveBy(dx, dy);
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
   * Picks what the arrow's position scrolls and how fast. The show list and
   * every pane that is a list of its own scroll the same way: the top and
   * bottom quarters move them at a speed that ramps up towards the edge. What
   * is not a list keeps the older constant crawl out of a fixed band. The
   * scrolling has to keep going while the cursor is simply held there, so it
   * runs off its own repeating post rather than off arriving motion — which is
   * also why the target and step are fields and not arguments.
   */
  private void updateAutoScroll() {
    float x = cursor.getPosX();
    float y = cursor.getPosY();
    float width = cursor.getWidth();
    float height = cursor.getHeight();
    float listWidth = showList.getWidth();
    // The pane's zone stops at its own top so that reaching up for a tab does
    // not scroll the pane out from under the cursor on the way.
    float paneTop = dp(PANE_TOP_MARGIN_DP);
    Scroller target = null;
    float stepDp = 0;
    float stepDpX = 0;
    if (x < listWidth) {
      // From the list's own top, not the screen's, so that holding the cursor
      // over the header to reach the filter box does not scroll the list.
      float speed = rampSpeed(y, showList.getTop(), height);
      if (speed != 0) {
        target = showList;
        stepDp = speed * SCROLL_STEP_DP;
      }
    } else if (activePane.rampScroll()) {
      stepDp = rampSpeed(y, paneTop, height) * SCROLL_STEP_DP;
      if (activePane.scrollsHorizontally()) {
        // Rightwards only: a click is the way back to the far left, the same
        // bargain every one of these panes makes with its top.
        float zone = (width - listWidth) * SCROLL_ZONE_FRACTION;
        if (zone > 0 && x > width - zone) {
          stepDpX = Math.min((x - (width - zone)) / zone, 1f) * SCROLL_STEP_DP;
        }
      }
      if (stepDp != 0 || stepDpX != 0) target = activePane;
    } else {
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
    if (target != scrollTarget) {
      scrollRemainder = 0;
      scrollRemainderX = 0;
    }
    scrollTarget = target;
    scrollStepDp = stepDp;
    scrollStepDpX = stepDpX;
    if (target == null) {
      ui.removeCallbacks(autoScroll);
    } else if (wasStopped) {
      ui.post(autoScroll);
    }
  }

  /**
   * How fast the cursor at {@code pos} scrolls what it is over: nothing until
   * it is within a quarter of either end of the region running from {@code top}
   * to {@code end}, then ramping linearly to full speed hard against the edge.
   * Negative for backwards.
   */
  private float rampSpeed(float pos, float top, float end) {
    float zone = (end - top) * SCROLL_ZONE_FRACTION;
    if (zone <= 0 || pos < top) return 0;
    if (pos < top + zone) return -(top + zone - pos) / zone;
    if (pos > end - zone) return Math.min((pos - (end - zone)) / zone, 1f);
    return 0;
  }

  private final Runnable autoScroll =
      new Runnable() {
        @Override
        public void run() {
          if (scrollTarget == null) return;
          if (SystemClock.uptimeMillis() - lastMoveAt >= SCROLL_MOVE_PAUSE_MS) {
            float py = dp(scrollStepDp) + scrollRemainder;
            int wholeY = (int) py;
            scrollRemainder = py - wholeY;
            if (wholeY != 0) scrollTarget.scrollStep(wholeY);
            float px = dp(scrollStepDpX) + scrollRemainderX;
            int wholeX = (int) px;
            scrollRemainderX = px - wholeX;
            if (wholeX != 0) scrollTarget.scrollStepX(wholeX);
          }
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
    // Here rather than on every move: the arrow moves at 60 Hz, and this is the
    // one thing that runs before either being backgrounded or being finished.
    prefs()
        .edit()
        .putFloat(KEY_CURSOR_X, cursor.getPosX())
        .putFloat(KEY_CURSOR_Y, cursor.getPosY())
        .apply();
    super.onPause();
  }

  // Closing tvappctrl on the phone closes tvapp here. The reverse direction needs
  // nothing: the relay notices this activity's socket dropping.
  @Override
  public void onExit() {
    ui.post(this::finishAndRemoveTask);
  }

  /** Every keystroke, as the whole string: a dropped frame cannot desync it. */
  @Override
  public void onFilter(String text) {
    ui.post(() -> setFilter(text));
  }

  /** Accepted on the phone, which is the second of the three ways to clear it. */
  @Override
  public void onKeyboardClosed() {
    ui.post(
        () -> {
          filtering = false;
          setFilter("");
        });
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
