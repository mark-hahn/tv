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
import org.json.JSONArray;
import org.json.JSONObject;

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
  private static final String[] TAB_LABELS = {"Info", "Map", "Actors", "Trailer"};
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
  // Same volume control the web client's remote uses, via tv-tv's HA bridge.
  private static final String VOL_UP_URL = "https://hahnca.com/tv-tv/tv/vol/up";
  private static final String VOL_DOWN_URL = "https://hahnca.com/tv-tv/tv/vol/down";
  // Asked every time a trailer starts, so one left muted from dragging never
  // carries into the next play silently.
  private static final String UNMUTE_URL = "https://hahnca.com/tv-tv/tv/unmute";
  // While a trailer plays, dragging up/down repeats a volume step at this
  // cadence instead of moving a cursor nobody can see. Speed of the drag does
  // not matter, only its direction, so this is a fixed cadence rather than
  // anything derived from the motion.
  private static final long VOLUME_DRAG_INTERVAL_MS = 600;
  // No explicit end-of-drag message exists for a plain drag (see onMove/CMD_MOVE
  // in tvappctrl.js — only a held press gets a release). Motion arrives every
  // SEND_INTERVAL_MS there (16ms), so a gap several times that long means the
  // finger lifted.
  private static final long VOLUME_DRAG_IDLE_MS = 200;

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

  // The Up and Down buttons are still the explicit list controls. Held, they
  // ramp from a crawl a card at a time to a run down the whole list; tapped,
  // they go straight to one end of it. The 300 ms a hold takes to start is the
  // phone's own tap window, so a press is a tap or a hold and never both.
  private static final float SCROLL_BTN_HEIGHT_DP = 35.2f;
  private static final float SCROLL_BTN_TEXT_SIZE_SP = 16f;
  private static final float SCROLL_BTN_CORNER_DP = 6f;
  private static final int SCROLL_BTN_BG = 0xFF404040;
  // Separates the Up/Down pair from Watching/Added in the header row, so the
  // two groups still read apart now that they share one row.
  private static final float SCROLL_BTN_GROUP_GAP_DP = 24f;
  private static final float HOLD_SCROLL_START_DP = 1f; // initial scroll speed, dp per tick
  private static final float HOLD_SCROLL_MAX_DP = 36f; // scroll speed cap once fully sped up
  private static final float HOLD_SCROLL_ACCEL_DP_PER_S2 = 17.5f; // dp/tick gained per second
  private static final long HOLD_SCROLL_DELAY_MS = 750; // holds at start speed this long first
  private static final long HOLD_SCROLL_INTERVAL_MS = 16;

  private final Handler ui = new Handler(Looper.getMainLooper());

  private CursorView cursor;
  private CtrlServer ctrlServer;
  private SharedFilters sharedFilters;
  private ShowListView showList;
  private ListHeader listHeader;
  private Button scrollUp;
  private Button scrollDown;
  private int holdDirection; // -1 up, +1 down, 0 for no button being held
  private long holdStartedAt;
  private float holdRemainder; // sub-pixel carry, so the slow start still moves
  private Shows.Sort sort = Shows.Sort.ALPHA;
  private boolean customOn; // the shared settings are what the list is showing
  private InfoView info;
  private ActorsView actorsPane;
  private final List<Pane> panes = new ArrayList<>();
  private final List<Button> tabs = new ArrayList<>();
  private Pane activePane;
  private TrailerPlayer player;
  // A drag sends motion at ~60 Hz from the socket thread. Deltas are summed and
  // applied by one posted runnable rather than posting one per packet.
  private float pendingDx;
  private float pendingDy;
  private boolean movePending;
  private long lastMoveAt; // when the previous batch was applied, for accelGain
  private boolean foreground; // whether this activity is the one on screen

  // -1 while dragging up (volume up), +1 while dragging down (volume down), 0
  // idle. Ticked by volumeDragTick, not by the moves themselves.
  private int volumeDragDirection;
  private boolean volumeDragActive;
  private long volumeDragLastMoveAt;

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

    showList.setSelectionListener(
        new ShowListView.SelectionListener() {
          @Override
          public void onShowSelected(Shows.Show show) {
            MainActivity.this.onShowSelected(show);
          }

          @Override
          public void onShowClicked() {
            MainActivity.this.onShowClicked();
          }
        });
    sort = Shows.Sort.of(prefs().getString(KEY_SORT, null));
    listHeader.setSort(sort);
    showList.setSort(sort);
    String remembered = prefs().getString(KEY_SELECTED_SHOW, null);
    Shows.load(shows -> ui.post(() -> showList.setShows(shows, remembered)));

    ctrlServer = new CtrlServer(this);
    ctrlServer.start();

    sharedFilters =
        new SharedFilters(
            has ->
                ui.post(
                    () -> {
                      // Nothing shared any more: there is no custom mode to be
                      // in, and leaving its list up under a button that no
                      // longer says Custom is just a list nothing explains.
                      if (!has) {
                        setCustomOn(false);
                        showList.setCustomOrder(null);
                      }
                      listHeader.setSharedFilters(has);
                    }));
    sharedFilters.start();
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
    player.setOpenListener(
        open -> {
          cursor.setVisibility(open ? View.GONE : View.VISIBLE);
          // Closing however it happens — click, Back, or the video ending on
          // its own — ends any volume drag in progress along with it.
          if (!open) stopVolumeDrag();
        });
    root.addView(player, matchParent());

    // Added last so the arrow draws over everything else.
    cursor = new CursorView(this);
    root.addView(cursor, matchParent());

    return root;
  }

  /**
   * The sort and scroll header over the show list, the list's own width:
   * Watching and Added on the left, Up and Down after them — the same row now
   * that there is no filter box left to give the row its own line.
   */
  private View buildList() {
    LinearLayout left = new LinearLayout(this);
    left.setOrientation(LinearLayout.VERTICAL);
    listHeader =
        new ListHeader(
            this,
            new ListHeader.Listener() {
              @Override
              public void onSortClick(Shows.Sort sort) {
                sortClick(sort);
              }

              @Override
              public void onCustomClick() {
                customClick();
              }
            });
    // Up and Down are how the list scrolls, a pointer having nowhere else to
    // push: tapped they go to one end of it, held they scroll, and a held
    // button ramps up so the same gesture serves both a nudge of a card or two
    // and a run past two hundred. A wide gap ahead of Up keeps the two groups
    // reading apart despite sharing a row.
    scrollUp = scrollButton("Up", v -> showList.scrollToTop());
    scrollDown = scrollButton("Down", v -> showList.scrollToBottom());
    listHeader.addView(scrollUp, scrollButtonParams((int) dp(SCROLL_BTN_GROUP_GAP_DP)));
    listHeader.addView(scrollDown, scrollButtonParams((int) dp(ListHeader.GAP_DP)));
    left.addView(
        listHeader,
        new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, (int) dp(ListHeader.HEIGHT_DP)));
    showList = new ShowListView(this);
    left.addView(
        showList, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
    return left;
  }

  private Button scrollButton(String label, View.OnClickListener onClick) {
    Button button = new Button(this);
    button.setText(label);
    button.setTextSize(TypedValue.COMPLEX_UNIT_SP, SCROLL_BTN_TEXT_SIZE_SP);
    button.setTextColor(Color.WHITE);
    button.setSingleLine(true);
    button.setMinWidth(0);
    button.setMinimumWidth(0);
    button.setPadding(0, 0, 0, 0);
    // Its own background rather than the theme's, for the reason the tabs have
    // one: a platform Button cannot be tinted and untinted back again.
    GradientDrawable bg = new GradientDrawable();
    bg.setCornerRadius(dp(SCROLL_BTN_CORNER_DP));
    bg.setColor(SCROLL_BTN_BG);
    button.setBackground(bg);
    button.setOnClickListener(onClick);
    return button;
  }

  private LinearLayout.LayoutParams scrollButtonParams(int leftMargin) {
    LinearLayout.LayoutParams params =
        new LinearLayout.LayoutParams(0, (int) dp(SCROLL_BTN_HEIGHT_DP), 1f);
    params.leftMargin = leftMargin;
    return params;
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
    actorsPane = new ActorsView(this);
    actorsPane.setListener(this::actorClick);
    panes.add(actorsPane);
    TrailersView trailers = new TrailersView(this);
    trailers.setPlayListener(
        url -> {
          // A trailer dragged down to muted, or the physical remote's mute
          // still on from something else, must not carry silently into the
          // next one.
          sendUnmute();
          player.play(url);
        });
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

  /** Clicking the sort already in force turns it off, leaving alphabetical. */
  private void sortClick(Shows.Sort clicked) {
    // In custom mode no sort button is lit, so the first click on one turns it
    // on rather than toggling the sort hidden underneath it back off.
    Shows.Sort next = !customOn && clicked == sort ? Shows.Sort.ALPHA : clicked;
    // Picking a sort by hand is leaving the shared settings, and their list
    // goes back to the whole one — filter and all.
    if (customOn) {
      setCustomOn(false);
      showList.setCustomOrder(null);
      clearFilter();
    }
    applySort(next);
  }

  /** The filter, here and in the box on the phone that is its only ui. */
  private void clearFilter() {
    showList.setFilter("");
    ctrlServer.send(CtrlServer.MSG_CLEAR_FILTER);
  }

  /**
   * An Actors-pane card, clicked. Highlighting it and narrowing the show list
   * to its shows is one gesture here, where the web client takes a select and
   * a separate Shows-button press to reach the same place. Null is the second
   * click on the same card, undoing both.
   */
  private void actorClick(String actorName) {
    if (actorName == null) {
      showList.setActorFilter(null);
      return;
    }
    // Picking an actor by hand is leaving the shared settings, same as picking
    // a sort or typing a filter — setActorFilter below takes the list back off
    // tv-srvr's order; this is only the button's own label and highlight.
    if (customOn) setCustomOn(false);
    // A filter left over from the phone would otherwise reappear, unexplained,
    // the moment this actor is deselected again.
    clearFilter();
    showList.setActorFilter(actorName);
  }

  private void applySort(Shows.Sort newSort) {
    sort = newSort;
    listHeader.setSort(sort);
    showList.setSort(sort);
    prefs().edit().putString(KEY_SORT, sort.name()).apply();
  }

  private void setCustomOn(boolean on) {
    customOn = on;
    listHeader.setCustomOn(on);
  }

  /**
   * The web client's Custom button. The shared settings are far richer than
   * this list's own filter and sort — a dozen tri-state condition toggles and
   * eleven sort orders — so rather than reimplement any of that here, tv-srvr
   * applies them with the same @tv/share code the web client uses and hands
   * back the finished list.
   */
  private void customClick() {
    // Already showing it: this click is the way back out, to the whole list in
    // its plain alphabetical order.
    if (customOn) {
      setCustomOn(false);
      showList.setCustomOrder(null);
      clearFilter();
      applySort(Shows.Sort.ALPHA);
      return;
    }
    new Thread(
            () -> {
              try {
                JSONObject res = new JSONObject(Http.get(SharedFilters.SHOWS_URL));
                JSONArray arr = res.optJSONArray("names");
                List<String> names = new ArrayList<>();
                for (int i = 0; arr != null && i < arr.length(); i++) {
                  names.add(arr.optString(i, ""));
                }
                ui.post(
                    () -> {
                      // The server's list is the whole answer, so a filter left
                      // in the phone's box, or an actor still highlighted in
                      // the cast pane, would only be a lie about it.
                      clearFilter();
                      actorsPane.clearSelection();
                      showList.setCustomOrder(names);
                      setCustomOn(true);
                    });
              } catch (Exception e) {
                Log.e(TAG, "custom click show list fetch failed: " + e);
              }
            },
            "custom-click")
        .start();
  }

  /** Selection outlives the app: it is written through to disk on every click. */
  private void onShowSelected(Shows.Show show) {
    for (Pane pane : panes) pane.setShow(show);
    prefs().edit().putString(KEY_SELECTED_SHOW, show.name).apply();
  }

  /**
   * A card was clicked directly, as against auto-picked by a filter or sort
   * change. The filter — typed on the phone, since a tv has no keyboard — is
   * one of the things that gets cleared by picking a show, so both ends are
   * told: the list here, and the box on the phone. Picking a show is also
   * always answered with its Info, and an actor pane that may have narrowed
   * the list to find it does not carry over to the next one.
   */
  private void onShowClicked() {
    showList.setFilter("");
    ctrlServer.send(CtrlServer.MSG_CLEAR_FILTER);
    actorsPane.clearSelection();
    showList.setActorFilter(null);
    selectTab(0);
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
    ui.removeCallbacks(holdScroll);
    ui.removeCallbacks(volumeDragTick);
    ctrlServer.shutdown();
    sharedFilters.stop();
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
    if (player.isPlaying()) {
      updateVolumeDrag(dy);
      return;
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

  @Override
  public void onScroll(float dx, float dy) {
    ui.post(
        () -> {
          if (!foreground || player.isPlaying()) return;
          Scroller target = scrollTargetAtCursor();
          int wholeX = Math.round(dx);
          int wholeY = Math.round(dy);
          if (wholeY != 0) target.scrollStep(wholeY);
          if (wholeX != 0) target.scrollStepX(wholeX);
        });
  }

  private Scroller scrollTargetAtCursor() {
    float x = cursor.getPosX();
    float y = cursor.getPosY();
    View paneScroll = activePane.scrollableView();
    if (hits(paneScroll, x, y)) return activePane;
    return showList;
  }

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
   * The finger has been down on the phone long enough to be a hold rather than
   * a tap. The only thing a hold does is work the scroll buttons, so it is
   * answered by hit-testing them rather than by synthesizing a touch: a real
   * ACTION_DOWN would fire the button's own click on the way back up, and that
   * is the tap behaviour — a jump to one end of the list.
   */
  @Override
  public void onPress() {
    ui.post(
        () -> {
          if (!foreground || player.isPlaying()) return;
          float x = cursor.getPosX();
          float y = cursor.getPosY();
          if (hits(scrollUp, x, y)) startHold(-1);
          else if (hits(scrollDown, x, y)) startHold(+1);
        });
  }

  @Override
  public void onRelease() {
    ui.post(this::stopHold);
  }

  /** A move batch that arrived while the trailer player owns the screen. */
  private void updateVolumeDrag(float dy) {
    volumeDragLastMoveAt = SystemClock.uptimeMillis();
    if (dy == 0) return;
    volumeDragDirection = dy < 0 ? -1 : 1;
    if (!volumeDragActive) {
      volumeDragActive = true;
      ui.removeCallbacks(volumeDragTick);
      ui.post(volumeDragTick);
    }
  }

  private void stopVolumeDrag() {
    volumeDragActive = false;
    volumeDragDirection = 0;
    ui.removeCallbacks(volumeDragTick);
  }

  private final Runnable volumeDragTick =
      new Runnable() {
        @Override
        public void run() {
          if (!volumeDragActive) return;
          // No release message arrives for a plain drag — see VOLUME_DRAG_IDLE_MS.
          if (SystemClock.uptimeMillis() - volumeDragLastMoveAt > VOLUME_DRAG_IDLE_MS) {
            volumeDragActive = false;
            return;
          }
          sendVolume(volumeDragDirection);
          ui.postDelayed(this, VOLUME_DRAG_INTERVAL_MS);
        }
      };

  private void sendVolume(int direction) {
    String url = direction < 0 ? VOL_UP_URL : VOL_DOWN_URL;
    new Thread(
            () -> {
              try {
                Http.get(url);
              } catch (Exception e) {
                Log.e(TAG, "vol failed: " + e);
              }
            },
            "vol")
        .start();
  }

  private void sendUnmute() {
    new Thread(
            () -> {
              try {
                Http.get(UNMUTE_URL);
              } catch (Exception e) {
                Log.e(TAG, "unmute failed: " + e);
              }
            },
            "unmute")
        .start();
  }

  private void startHold(int direction) {
    holdDirection = direction;
    holdStartedAt = SystemClock.uptimeMillis();
    holdRemainder = 0;
    ui.post(holdScroll);
  }

  private void stopHold() {
    holdDirection = 0;
    ui.removeCallbacks(holdScroll);
  }

  /** Whether the cursor hotspot is inside a view, both in the root's own frame. */
  private boolean hits(View view, float x, float y) {
    int[] pos = new int[2];
    view.getLocationInWindow(pos);
    // The cursor spans the root, so its own origin is what the hotspot is
    // relative to and is what makes the two comparable.
    int[] origin = new int[2];
    cursor.getLocationInWindow(origin);
    float left = pos[0] - origin[0];
    float top = pos[1] - origin[1];
    return x >= left && x < left + view.getWidth() && y >= top && y < top + view.getHeight();
  }

  /**
   * Scrolls the list for as long as a button is held, starting slow enough to
   * land on a particular card, holding that speed for HOLD_SCROLL_DELAY_MS, and
   * only then ramping up to fast enough to cross the list.
   */
  private final Runnable holdScroll =
      new Runnable() {
        @Override
        public void run() {
          if (holdDirection == 0) return;
          long sinceDelay = SystemClock.uptimeMillis() - holdStartedAt - HOLD_SCROLL_DELAY_MS;
          float sped = Math.max(0f, sinceDelay) / 1000f * HOLD_SCROLL_ACCEL_DP_PER_S2;
          float stepDp = Math.min(HOLD_SCROLL_START_DP + sped, HOLD_SCROLL_MAX_DP);
          float px = dp(stepDp) * holdDirection + holdRemainder;
          int whole = (int) px;
          holdRemainder = px - whole;
          if (whole != 0) showList.scrollStep(whole);
          ui.postDelayed(this, HOLD_SCROLL_INTERVAL_MS);
        }
      };

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
    // A release that never arrives — the phone's app gone, its socket dropped —
    // would otherwise leave the list scrolling on its own.
    stopHold();
    stopVolumeDrag();
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
    ui.post(
        () -> {
          // Any filter traffic from the phone is the user working the list by
          // hand, so the custom one goes, and so does a highlighted actor:
          // typing, backspacing it away, and its Clear button all arrive here,
          // the last of these with an empty string but still meaning it.
          // Picking a show clears that box the other way round, over
          // MSG_CLEAR_FILTER, and never comes through here — which is what
          // keeps a show click inside custom mode or an actor's shows.
          if (customOn) {
            setCustomOn(false);
            showList.setCustomOrder(null);
          }
          actorsPane.clearSelection();
          showList.setActorFilter(null);
          showList.setFilter(text);
        });
  }

  /**
   * tv-tv asks for this right after opening tvapp on the tv, so the show
   * that's up on the web client is the one already selected here.
   */
  @Override
  public void onSelectShow(String name) {
    ui.post(() -> showList.selectByName(name));
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
