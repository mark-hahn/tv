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
import android.text.SpannableString;
import android.text.style.RelativeSizeSpan;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewTreeObserver;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

public class MainActivity extends Activity implements CtrlServer.Listener {

  private static final String TAG = "tvapp";
  private static final float SCREEN_V_MARGIN_DP = 24f;
  // Only what keeps the columns from touching: the cards run to the edge of
  // their own column, so this is the whole of the space between a card and the
  // button column beside it. It is a margin, not part of the width fractions.
  private static final float COLUMN_GAP_DP = 3f;
  private static final float BUTTONS_WIDTH_FRACTION = 0.09f;
  private static final float LIST_WIDTH_FRACTION = 1f - BUTTONS_WIDTH_FRACTION;
  // The top of the group, and where the filter key's cursor rests between runs
  // of clicks. It resets every way the show list can be narrowed: filter text,
  // the toggle filters below it, the actor filter, and custom sort.
  private static final String CLEAR_FILTER_LABEL = "Clear";
  // The one filter that grows the list rather than narrowing it: every show
  // that is not in Emby comes in with it, which is a rebuild long enough to be
  // waited on rather than sat through.
  private static final String TRASH_FILTER_LABEL = "Trash";
  private static final String[] FILTER_LABELS = {
    CLEAR_FILTER_LABEL, "Ready", "Drama", "Comedy", "To Try", "Continue", "Mark", "Linda",
    TRASH_FILTER_LABEL
  };
  private static final String SORT_WATCHED = "Watched";
  private static final String SORT_ADDED = "Added";
  private static final String SORT_CUSTOM = "Custom";
  private static final String[] SORT_LABELS = {SORT_WATCHED, SORT_ADDED, SORT_CUSTOM};
  // The shared settings already filtered and sorted into a show list, by the
  // same @tv/share code the web client runs on its own copy of the data.
  private static final String SHARED_FILTER_SHOWS_URL =
      "https://hahnca.com/tv-srvr/api/getSharedFilterShows";
  // Shown above the show list only while a filter is active, mirroring the
  // text as the phone's filter input screen types it.
  private static final float FILTER_LABEL_TEXT_SIZE_SP = 15f;
  private static final float FILTER_LABEL_PAD_H_DP = 14f;
  private static final float FILTER_LABEL_PAD_BOTTOM_DP = 6f;
  private static final int FILTER_LABEL_BG = 0xFF3A3A3A;

  private static final float BUTTON_TEXT_SIZE_SP = 12.5f;
  // The tab buttons' height. The sort and filter buttons no longer have one of
  // their own: they divide up whatever height the button column has.
  private static final float BUTTON_HEIGHT_DP = 25.0f;
  private static final float BUTTON_MARGIN_BOTTOM_DP = 6.0f;
  // Gap between the stacked sort/filter buttons in the button column, kept
  // smaller than BUTTON_MARGIN_BOTTOM_DP so all of them -- Sort's 3 plus the
  // filter group's 9 -- fit the column's height without crowding it.
  private static final float COLUMN_BUTTON_GAP_DP = 4.0f;
  // Across the tab row, where the buttons are read left to right and want more
  // air between them than the stacked groups do.
  private static final float TAB_GAP_DP = BUTTON_MARGIN_BOTTOM_DP * 2f;
  private static final float BUTTON_GROUP_GAP_DP = BUTTON_HEIGHT_DP / 2f;
  private static final float BUTTON_PAD_H_DP = 8f;
  private static final float BUTTON_CORNER_DP = 6f;
  private static final float BUTTON_SELECTED_BORDER_DP = 3f;
  private static final int BUTTON_ACTIVE_BG = 0xFF0A4A8A;
  private static final int BUTTON_INACTIVE_BG = 0xFF808080;
  private static final int BUTTON_ACTIVE_TEXT = 0xFFFFFFFF;
  private static final int BUTTON_INACTIVE_TEXT = 0xFF000000;
  private static final int BUTTON_SELECTED_BORDER = 0xFFFF0000;
  // The inset the filter group container keeps above and below its buttons.
  private static final float GROUP_INSET_DP = BUTTON_SELECTED_BORDER_DP * 2f * 0.7f * 0.7f;

  // The filter key's cursor: the first click brings it into view on Clear,
  // each further click steps it one button down, and once the clicking stops
  // the button it came to rest on is activated and the group falls back to its
  // idle state -- cursor hidden, back on Clear. The key is deaf for a moment
  // after that, so the click that ended one run cannot start the next.
  private static final long FILTER_DWELL_MS = 1000;
  private static final long FILTER_IGNORE_MS = 300;
  // Clear has no state to stay lit for, so it lights just long enough to say
  // it ran.
  private static final long CLEAR_FLASH_MS = 500;

  private static final String PREFS_NAME = "tvapp";
  private static final String KEY_SELECTED_SHOW = "selectedShow";
  private static final String KEY_SORT = "sort";

  private static final String VIEWSHOW_URL = "https://hahnca.com/tv-tv/tv/viewshow";
  private static final int VIEWSHOW_TIMEOUT_MS = 10000;
  private static final String NO_FILE_TOAST = "No file.";
  // Not a Toast: the wait is ten seconds and the longest toast is three and a
  // half, so it went out well before the shows came in. This is a view of the
  // app's own, up until it is taken down.
  private static final String TRASH_WAIT_LABEL = "Waiting for trash";
  private static final float LOADING_TEXT_SIZE_SP = 30f;
  private static final int LOADING_BG = 0xE6000000;
  private static final float LOADING_PAD_H_DP = 32f;
  private static final float LOADING_PAD_V_DP = 20f;
  // Drawn by this process, so the rebuild has to give way for a moment or the
  // message the wait is for would not be up until the wait was over.
  private static final long LOADING_HEAD_START_MS = 150;
  private static final String NOT_READY_TOAST =
      "Show not ready to watch. Use map to play an episode.";
  private static final float TOAST_TEXT_SCALE = 2f;
  private static final String EMBY_PACKAGE = "com.mb.android";
  private static final String UNMUTE_URL = "https://hahnca.com/tv-tv/tv/unmute";
  private static final long KEEP_AWAKE_IDLE_MS = 5_000;
  // A back key in the first moment on screen is not the user's: coming here
  // from Emby closes the show that was playing, and that close key can still be
  // in flight when tvapp takes the screen. Answering it would send tvapp
  // straight back out again.
  private static final long BACK_DEAF_ON_FRONT_MS = 1_500;
  // Coming back from Emby reuses the list already in memory, which is the point
  // of staying resident, but a list loaded long enough ago has stale waitStrs.
  private static final long SHOWS_REFRESH_AFTER_MS = 10 * 60_000;

  private final Handler ui = new Handler(Looper.getMainLooper());
  private final Map<String, ButtonItem> buttonItems = new HashMap<>();
  private final List<String> buttonOrder = new ArrayList<>();
  private final Set<String> activeFilters = new HashSet<>();

  private CtrlServer ctrlServer;
  private Updates updates;
  private ShowListView showList;
  private TextView filterLabel;
  private TrailerPlayer player;
  private LinearLayout buttonColumn;
  private Shows.Sort sort = Shows.Sort.ALPHA;
  private boolean customOn;
  // The filter button the filter key's cursor is on. One button is selected at
  // all times, but the cursor showing which is drawn only during a run of
  // filter key clicks; the rest of the time the selection sits idle on Clear.
  private String selectedFilter = CLEAR_FILTER_LABEL;
  private boolean filterCursorVisible;
  private long filterIgnoreUntil;
  // Clear's brief lit-up confirmation that it ran, since it has no state of its
  // own to show.
  private boolean clearFlashing;
  // Set off the ui thread as well as on it: keys are read on the socket thread,
  // which is where one arriving mid-rebuild has to be dropped -- the ui thread
  // is busy, and anything posted to it would only be answered afterwards, all
  // at once.
  private volatile boolean showsLoading;
  private TextView loadingLabel;
  // The typed filter text, kept even while the actor filter is the one
  // actually showing in filterLabel, so clearing the actor filter can put the
  // typed text straight back up without re-deriving it.
  private String typedFilterText = "";
  // Name of the actor narrowing the list -- the Actors pane's card click --
  // or null. Mutually exclusive with typed filter text in practice: whatever
  // sets one clears the other first. Shown in filterLabel in its place while
  // set.
  private String actorFilterName;
  private String activeShowName;
  private long showsLoadedAt;
  private long frontSince;
  private long trashAt;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    AdbWifi.enable(this);
    setContentView(buildUi());

    showList.setSelectionListener(this::onShowSelected);
    sort = Shows.Sort.of(prefs().getString(KEY_SORT, null));
    showList.setSort(sort);
    String remembered = prefs().getString(KEY_SELECTED_SHOW, null);

    showList.setCountsListener(
        count -> sendToPhone(CtrlServer.MSG_COUNTS + "," + count));

    loadShows(remembered);
  }

  private void loadShows(String selectedName) {
    Shows.load(
        shows ->
            ui.post(
                () -> {
                  showsLoadedAt = System.currentTimeMillis();
                  showList.setShows(shows, selectedName);
                }));
  }

  /**
   * The ctrl socket is bound only while tvapp is on screen: everything upstream
   * -- the bridge's tvapp up/down, toggletvapp, the phone's tvapprc mode --
   * reads "port 8099 answers" as "tvapp is the foreground app", and that has to
   * keep being true now that the activity outlives being switched away from.
   * WebSocketServer cannot be restarted once stopped, so each foreground turn
   * gets its own.
   */
  @Override
  protected void onStart() {
    super.onStart();
    frontSince = SystemClock.uptimeMillis();
    ctrlServer = new CtrlServer(this);
    ctrlServer.start();
    if (showsLoadedAt != 0
        && System.currentTimeMillis() - showsLoadedAt > SHOWS_REFRESH_AFTER_MS) {
      reloadShows();
    }
    // Only while on screen: a socket held open behind Emby would reload a list
    // nobody is looking at, and tv-srvr would keep a client it cannot reach.
    updates = new Updates(this::reloadShows);
    updates.start();
  }

  @Override
  protected void onStop() {
    ctrlServer.shutdown();
    ctrlServer = null;
    updates.stop();
    updates = null;
    super.onStop();
  }

  /** Re-reads the list, keeping the selection on whatever show it is on. */
  private void reloadShows() {
    Shows.Show selected = showList.getSelected();
    loadShows(selected == null ? null : selected.name);
  }

  private View buildUi() {
    FrameLayout root = new FrameLayout(this);
    root.setBackgroundColor(Color.BLACK);

    LinearLayout columns = new LinearLayout(this);
    columns.setOrientation(LinearLayout.HORIZONTAL);
    columns.setPadding(0, (int) dp(SCREEN_V_MARGIN_DP), 0, (int) dp(SCREEN_V_MARGIN_DP));
    columns.addView(buildButtonColumn(), column(BUTTONS_WIDTH_FRACTION, 0));
    columns.addView(buildList(), column(LIST_WIDTH_FRACTION, dp(COLUMN_GAP_DP)));
    root.addView(columns, matchParent());

    loadingLabel = new TextView(this);
    loadingLabel.setText(TRASH_WAIT_LABEL);
    loadingLabel.setTextColor(Color.WHITE);
    loadingLabel.setTextSize(TypedValue.COMPLEX_UNIT_SP, LOADING_TEXT_SIZE_SP);
    loadingLabel.setPadding(
        (int) dp(LOADING_PAD_H_DP),
        (int) dp(LOADING_PAD_V_DP),
        (int) dp(LOADING_PAD_H_DP),
        (int) dp(LOADING_PAD_V_DP));
    GradientDrawable loadingBg = new GradientDrawable();
    loadingBg.setCornerRadius(dp(BUTTON_CORNER_DP));
    loadingBg.setColor(LOADING_BG);
    loadingLabel.setBackground(loadingBg);
    loadingLabel.setVisibility(View.GONE);
    root.addView(
        loadingLabel,
        new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.CENTER));

    player = new TrailerPlayer(this);
    // However the video came down -- played out, right, or back -- the strip
    // moves the cursor on to the next trailer.
    player.setOpenListener(
        open -> {
          if (!open) showList.highlightNextTrailerAfterPlayed();
        });
    root.addView(player, matchParent());
    return root;
  }

  /**
   * The filter label sits above the list rather than over it, so it only ever
   * takes the height its text needs; the list gets the rest by weight. Hidden
   * entirely while there is no filter text, so it costs the list no space then.
   */
  private View buildList() {
    LinearLayout column = new LinearLayout(this);
    column.setOrientation(LinearLayout.VERTICAL);

    filterLabel = new TextView(this);
    filterLabel.setTextColor(Color.WHITE);
    filterLabel.setTextSize(TypedValue.COMPLEX_UNIT_SP, FILTER_LABEL_TEXT_SIZE_SP);
    filterLabel.setSingleLine(true);
    filterLabel.setEllipsize(android.text.TextUtils.TruncateAt.END);
    filterLabel.setGravity(Gravity.CENTER_HORIZONTAL);
    filterLabel.setPadding(
        (int) dp(FILTER_LABEL_PAD_H_DP), (int) dp(FILTER_LABEL_PAD_BOTTOM_DP),
        (int) dp(FILTER_LABEL_PAD_H_DP), (int) dp(FILTER_LABEL_PAD_BOTTOM_DP));
    GradientDrawable filterLabelBg = new GradientDrawable();
    filterLabelBg.setCornerRadius(dp(BUTTON_CORNER_DP));
    filterLabelBg.setColor(FILTER_LABEL_BG);
    filterLabel.setBackground(filterLabelBg);
    filterLabel.setVisibility(View.GONE);
    LinearLayout.LayoutParams filterLabelParams =
        new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    // Same left margin as sits between the Info and Map tab buttons.
    filterLabelParams.leftMargin = (int) dp(TAB_GAP_DP);
    filterLabelParams.bottomMargin = (int) dp(FILTER_LABEL_PAD_BOTTOM_DP);
    column.addView(filterLabel, filterLabelParams);

    showList = new ShowListView(this);
    showList.setFilterTextListener(this::updateFilterLabel);
    column.addView(
        showList, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
    return column;
  }

  private void updateFilterLabel(String text) {
    typedFilterText = text == null ? "" : text;
    refreshFilterLabel();
  }

  /**
   * What filterLabel shows: the actor name while the actor filter is set, else
   * the typed filter text, else nothing. The actor filter takes precedence
   * because everything that sets it clears the typed text first, so the two
   * are never both meant to show at once.
   */
  private void refreshFilterLabel() {
    String text = actorFilterName != null ? actorFilterName : typedFilterText;
    if (text.isEmpty()) {
      filterLabel.setVisibility(View.GONE);
      filterLabel.setText("");
    } else {
      filterLabel.setText(text);
      filterLabel.setVisibility(View.VISIBLE);
    }
  }

  /**
   * What is left in the column once the tabs have moved over the tab pane: the
   * sort group and the filter group, sharing the whole height of the column
   * between them by weight rather than standing at a fixed height. Every button
   * is one share, the filter group as many shares as it holds buttons, so the
   * two groups keep their proportions while the fixed spacing -- the gap
   * between the groups and the room for the filter group's focus border --
   * comes off the top first.
   *
   * The column's own horizontal padding is the filter group container's, so
   * that border has room without the buttons inside it moving; the sort buttons
   * carry the same inset as margins instead.
   */
  private View buildButtonColumn() {
    buttonColumn = new LinearLayout(this);
    buttonColumn.setOrientation(LinearLayout.VERTICAL);

    for (String label : SORT_LABELS) {
      LinearLayout.LayoutParams params = shareOfColumn(1f);
      params.leftMargin = (int) dp(BUTTON_PAD_H_DP);
      params.rightMargin = (int) dp(BUTTON_PAD_H_DP);
      params.bottomMargin = (int) dp(COLUMN_BUTTON_GAP_DP);
      addButton(buttonColumn, label, params);
    }
    buttonColumn.addView(buildFilterGroup(), filterGroupParams());
    repaintButtons();
    return buttonColumn;
  }

  private LinearLayout.LayoutParams shareOfColumn(float shares) {
    return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, shares);
  }

  /**
   * The filter buttons, in a container of its own so the group keeps its
   * spacing from the sort buttons above it whatever the column's height works
   * out to.
   */
  private View buildFilterGroup() {
    LinearLayout group = new LinearLayout(this);
    group.setOrientation(LinearLayout.VERTICAL);
    group.setPadding(
        (int) dp(BUTTON_PAD_H_DP),
        (int) dp(GROUP_INSET_DP),
        (int) dp(BUTTON_PAD_H_DP),
        (int) dp(GROUP_INSET_DP));
    for (int i = 0; i < FILTER_LABELS.length; i++) {
      LinearLayout.LayoutParams params = shareOfColumn(1f);
      // Between the buttons only: below the last one is the container's own
      // padding.
      if (i < FILTER_LABELS.length - 1) params.bottomMargin = (int) dp(COLUMN_BUTTON_GAP_DP);
      addButton(group, FILTER_LABELS[i], params);
    }
    return group;
  }

  private LinearLayout.LayoutParams filterGroupParams() {
    LinearLayout.LayoutParams params = shareOfColumn(FILTER_LABELS.length);
    // The container's own top padding is part of the gap between the groups.
    params.topMargin = (int) dp(BUTTON_GROUP_GAP_DP - GROUP_INSET_DP);
    return params;
  }

  private void addButton(LinearLayout parent, String label, LinearLayout.LayoutParams params) {
    TextView view = new TextView(this);
    view.setText(label);
    view.setGravity(Gravity.CENTER);
    view.setTextSize(TypedValue.COMPLEX_UNIT_SP, BUTTON_TEXT_SIZE_SP);
    view.setTypeface(null, android.graphics.Typeface.BOLD);
    view.setSingleLine(true);
    view.setPadding((int) dp(BUTTON_PAD_H_DP), 0, (int) dp(BUTTON_PAD_H_DP), 0);
    GradientDrawable bg = new GradientDrawable();
    bg.setCornerRadius(dp(BUTTON_CORNER_DP));
    view.setBackground(bg);

    buttonItems.put(label, new ButtonItem(label, view));
    buttonOrder.add(label);
    parent.addView(view, params);
  }

  private void repaintButtons() {
    for (String label : buttonOrder) {
      ButtonItem item = buttonItems.get(label);
      if (item != null) {
        item.paint(isButtonActive(label), filterCursorVisible && label.equals(selectedFilter));
      }
    }
  }

  private boolean isButtonActive(String label) {
    if (CLEAR_FILTER_LABEL.equals(label)) return clearFlashing;
    if (activeFilters.contains(label)) return true;
    if (SORT_WATCHED.equals(label)) return !customOn && sort == Shows.Sort.WATCHING;
    if (SORT_ADDED.equals(label)) return !customOn && sort == Shows.Sort.ADDED;
    if (SORT_CUSTOM.equals(label)) return customOn;
    return false;
  }

  /**
   * The remote's Sort key: one step down the sort group, none of it active
   * being the step past the bottom. No button active is the alphabetical sort,
   * which is why the cycle has one more stop than the group has buttons.
   */
  private void cycleSort() {
    if (customOn) {
      dropCustom(false);
      clearTextFilter();
    } else if (sort == Shows.Sort.WATCHING) {
      applySort(Shows.Sort.ADDED);
    } else if (sort == Shows.Sort.ADDED) {
      customClick();
    } else {
      applySort(Shows.Sort.WATCHING);
    }
  }

  private void applySort(Shows.Sort newSort) {
    applySort(newSort, false);
  }

  private void applySort(Shows.Sort newSort, boolean keepSelection) {
    sort = newSort;
    showList.setSort(sort, keepSelection);
    prefs().edit().putString(KEY_SORT, sort.name()).apply();
    repaintButtons();
  }

  private void setCustomOn(boolean on) {
    customOn = on;
    repaintButtons();
  }

  /**
   * Off the Custom list, because something else is narrowing the list now. The
   * settings it came from carried their own sort, so there is no sort of this
   * app's own to fall back to: it goes alphabetical, the sort with no button.
   */
  private void dropCustom(boolean keepSelection) {
    if (!customOn) return;
    Log.i(TAG, "custom off");
    setCustomOn(false);
    applySort(Shows.Sort.ALPHA, keepSelection);
  }

  /**
   * Custom on: the show list tv-srvr worked out from the shared settings, which
   * it keeps on disk, so the button is always there to be turned on.
   */
  private void customClick() {
    fetchCustomOrder(
        (names, selectedShow) -> {
          clearTextFilter();
          applyActorFilter(null);
          showList.setCustomOrder(names, selectedShow);
          setCustomOn(true);
          Log.i(TAG, "custom on: " + names.size() + " shows, selected " + selectedShow);
        });
  }

  /**
   * tv-srvr's push, sent the moment the web client's Send button saves new
   * shared settings -- the only thing that can change them, so nothing here
   * polls for it. Ignored unless Custom is the sort in force.
   */
  private void customChanged() {
    Log.i(TAG, "shared settings push, customOn=" + customOn);
    if (!customOn) return;
    fetchCustomOrder(
        (names, selectedShow) -> {
          if (!customOn) return;
          showList.setCustomOrder(names, selectedShow);
          Log.i(TAG, "custom re-applied: " + names.size() + " shows, selected " + selectedShow);
        });
  }

  private interface CustomOrderCallback {
    void onNames(List<String> names, String selectedShow);
  }

  private void fetchCustomOrder(CustomOrderCallback callback) {
    new Thread(
            () -> {
              try {
                JSONObject res = new JSONObject(Http.get(SHARED_FILTER_SHOWS_URL));
                JSONArray arr = res.optJSONArray("names");
                List<String> names = new ArrayList<>();
                for (int i = 0; arr != null && i < arr.length(); i++) {
                  names.add(arr.optString(i, ""));
                }
                Object rawSelected = res.opt("selectedShow");
                String selectedShow = (rawSelected instanceof String) ? (String) rawSelected : null;
                ui.post(() -> callback.onNames(names, selectedShow));
              } catch (Exception e) {
                Log.e(TAG, "custom show list fetch failed: " + e);
              }
            },
            "custom-fetch")
        .start();
  }

  /**
   * The button answers on this frame and the list follows on the next one.
   * Re-filtering is a rebuild of a column of hundreds of cards -- Trash worst
   * of all, since it brings in every show that is not in Emby -- and doing it
   * first holds up the very frame the button would have turned blue on.
   */
  private void toggleFilter(String label) {
    if (activeFilters.contains(label)) activeFilters.remove(label);
    else activeFilters.add(label);
    repaintButtons();
    boolean slow = TRASH_FILTER_LABEL.equals(label);
    if (slow) { trashAt = SystemClock.uptimeMillis(); Log.i(TAG, "trash timing: activated"); }
    if (slow) startShowsLoading();
    ui.postDelayed(
        () -> {
          dropCustom(false);
          applyActorFilter(null);
          if (slow) Log.i(TAG, "trash timing: setActiveFilters in +" + since());
          showList.setActiveFilters(activeFilters);
          if (slow) Log.i(TAG, "trash timing: setActiveFilters out +" + since());
          if (slow) endShowsLoadingWhenDrawn();
        },
        slow ? LOADING_HEAD_START_MS : 0);
  }

  /** The list is being rebuilt: say so, and let no key through until it is not. */
  private void startShowsLoading() {
    showsLoading = true;
    loadingLabel.setVisibility(View.VISIBLE);
  }

  /**
   * The shows are not up when setActiveFilters returns. The column has its new
   * children by then, but measuring and laying out hundreds of cards is the
   * pass after this one, and drawing them the pass after that -- so this waits
   * for the pre-draw, which is the end of the layout, and then posts, which is
   * the end of the draw that follows it. Ending any earlier left the toast
   * gone a second before the list it was standing in for arrived.
   */
  private void endShowsLoadingWhenDrawn() {
    ViewTreeObserver observer = showList.getViewTreeObserver();
    observer.addOnPreDrawListener(
        new ViewTreeObserver.OnPreDrawListener() {
          @Override
          public boolean onPreDraw() {
            showList.getViewTreeObserver().removeOnPreDrawListener(this);
            Log.i(TAG, "trash timing: preDraw +" + since());
            showList.post(
                () -> {
                  Log.i(TAG, "trash timing: afterDraw +" + since());
                  endShowsLoading();
                });
            return true;
          }
        });
  }

  private void endShowsLoading() {
    showsLoading = false;
    loadingLabel.setVisibility(View.GONE);
  }

  /**
   * Whether this key is one the show list answers, and so one there is no
   * answering while the list is being rebuilt. Back and the rest still work.
   */
  private static boolean blockedWhileLoading(String key) {
    return "ok".equals(key)
        || "up".equals(key)
        || "down".equals(key)
        || "left".equals(key)
        || "right".equals(key);
  }

  /** The Clear button: every way the show list can be narrowed, all at once. */
  private void clearAllFilters() {
    dropCustom(false);
    applyActorFilter(null);
    activeFilters.clear();
    showList.setActiveFilters(activeFilters);
    clearTextFilter();
    repaintButtons();
  }

  /**
   * The filter text goes with the list it was narrowing, so anything that
   * replaces that list clears it -- on the phone's input screen as well, which
   * is holding the same string.
   */
  private void clearTextFilter() {
    showList.setFilter("");
    sendToPhone(CtrlServer.MSG_CLEAR_FILTER);
  }

  /** Silent while tvapp is off screen: the ctrl socket is bound only in front. */
  private void sendToPhone(String message) {
    if (ctrlServer != null) ctrlServer.send(message);
  }

  /**
   * The phone's Shows button, held, opens its own show pane on whatever show is
   * active here, so the phone is told the name on every change and again as
   * soon as it connects.
   */
  private void sendActiveShow() {
    if (activeShowName == null) return;
    sendToPhone(CtrlServer.MSG_ACTIVE_SHOW + "," + activeShowName);
  }

  private void actorClick(String actorName) {
    if (actorName == null) {
      applyActorFilter(null);
      return;
    }
    // Keeping the selection: the actor clicked comes from the selected show's
    // own cast, so that show is in the narrowed list and stays the one every
    // pane -- the Actors pane the click was made in above all -- is showing.
    dropCustom(true);
    clearTextFilter();
    applyActorFilter(actorName);
  }

  /** Sets the actor filter on the show list and keeps filterLabel in step. */
  private void applyActorFilter(String actorName) {
    showList.setActorFilter(actorName);
    actorFilterName = actorName;
    refreshFilterLabel();
  }

  private void onShowSelected(Shows.Show show) {
    activeShowName = show.name;
    sendActiveShow();
    TrailerList.settle(show, () -> showList.onTrailersReady(show));
    prefs().edit().putString(KEY_SELECTED_SHOW, show.name).apply();
  }

  private String since() {
    return (SystemClock.uptimeMillis() - trashAt) + "ms";
  }

  private SharedPreferences prefs() {
    return getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
  }

  private LinearLayout.LayoutParams column(float fraction, float leftMargin) {
    LinearLayout.LayoutParams params =
        new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, fraction);
    params.leftMargin = (int) leftMargin;
    return params;
  }

  private FrameLayout.LayoutParams matchParent() {
    return new FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
  }

  private float dp(float value) {
    return TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics());
  }

  /**
   * The filter key, which is the only thing that reaches the filter buttons --
   * nothing else selects or activates one. The first click of a run only brings
   * the cursor into view, on the Clear it is idling on; every click after that
   * steps it one button down, as far as the last button and no further. The
   * dwell restarts on each click, so a run of clicks picks a button without
   * activating any of the ones passed over.
   */
  private void filterKeyClick() {
    if (SystemClock.uptimeMillis() < filterIgnoreUntil) return;
    ui.removeCallbacks(filterDwell);
    if (filterCursorVisible) stepSelectedFilter();
    else filterCursorVisible = true;
    repaintButtons();
    // Nothing below the last button for another click to reach, so there is
    // nothing to wait to find out: it acts without sitting out the dwell.
    if (FILTER_LABELS[FILTER_LABELS.length - 1].equals(selectedFilter)) {
      activateSelectedFilter();
      return;
    }
    ui.postDelayed(filterDwell, FILTER_DWELL_MS);
  }

  /** One button down, stopping at the bottom of the group rather than wrapping. */
  private void stepSelectedFilter() {
    int index = -1;
    for (int i = 0; i < FILTER_LABELS.length; i++) {
      if (FILTER_LABELS[i].equals(selectedFilter)) index = i;
    }
    selectedFilter = FILTER_LABELS[Math.min(index + 1, FILTER_LABELS.length - 1)];
  }

  private final Runnable filterDwell = this::activateSelectedFilter;

  private final Runnable clearFlashEnd =
      () -> {
        clearFlashing = false;
        repaintButtons();
      };

  /**
   * The end of a run of filter key clicks: the button the cursor came to rest
   * on acts -- Clear resets everything, the rest toggle -- and the group goes
   * back to idle, waiting on Clear with nothing outlined.
   */
  private void activateSelectedFilter() {
    if (CLEAR_FILTER_LABEL.equals(selectedFilter)) {
      clearAllFilters();
      clearFlashing = true;
      ui.postDelayed(clearFlashEnd, CLEAR_FLASH_MS);
    } else {
      toggleFilter(selectedFilter);
    }
    selectedFilter = CLEAR_FILTER_LABEL;
    filterCursorVisible = false;
    filterIgnoreUntil = SystemClock.uptimeMillis() + FILTER_IGNORE_MS;
    repaintButtons();
  }

  /**
   * Every arrow key, in one place. Nothing is focused: up and down move the
   * selected show itself, left and right jump the list to its two ends, and
   * right gives way to the trailer it would play when cardMisc is showing
   * trailers.
   */
  private void moveSelection(String direction) {
    if ("up".equals(direction)) showList.moveSelection(-1);
    else if ("down".equals(direction)) showList.moveSelection(+1);
    else if ("left".equals(direction)) showList.selectLast();
    else if ("right".equals(direction)) {
      if (showList.isTrailerMode()) playCardTrailer();
      else showList.selectFirst();
    }
  }

  private void playCardTrailer() {
    String url = showList.playActiveTrailer();
    if (url == null) return;
    sendUnmute();
    player.play(url);
  }

  private void embyClick() {
    Shows.Show show = showList.getSelected();
    if (show == null) {
      backToEmby();
      return;
    }
    if (!show.hasFile) {
      showBigCenterToast(NO_FILE_TOAST);
      return;
    }
    if (show.notReady) {
      showBigCenterToast(NOT_READY_TOAST);
      return;
    }
    new Thread(
            () -> {
              try {
                String url =
                    VIEWSHOW_URL
                        + "?showId="
                        + URLEncoder.encode(show.id, "UTF-8")
                        + "&showName="
                        + URLEncoder.encode(show.name, "UTF-8")
                        + "&play=1";
                HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(VIEWSHOW_TIMEOUT_MS);
                conn.setReadTimeout(VIEWSHOW_TIMEOUT_MS);
                conn.getInputStream().close();
                conn.disconnect();
              } catch (Exception e) {
                Log.e(TAG, "viewshow failed for " + show.name + ": " + e);
              }
              ui.post(() -> moveTaskToBack(true));
            },
            "viewshow")
        .start();
  }

  /**
   * A toast that stands out more than the ordinary small one in the corner --
   * these name a show state, not just a missed key press, and are read across
   * a room. Text size doubles via a span rather than a custom view, which
   * Android restricts for background apps; tvapp is always foreground.
   */
  private void showBigCenterToast(String message) {
    SpannableString text = new SpannableString(message);
    text.setSpan(new RelativeSizeSpan(TOAST_TEXT_SCALE), 0, text.length(), 0);
    Toast toast = Toast.makeText(this, text, Toast.LENGTH_LONG);
    toast.setGravity(Gravity.CENTER, 0, 0);
    toast.show();
  }

  /**
   * Steps aside rather than exiting. Starting Emby is what puts it on screen;
   * going to the back as well is what keeps tvapp from being the next task up.
   * The show list stays parsed in memory, so coming back is immediate.
   */
  private void backToEmby() {
    openEmby();
    moveTaskToBack(true);
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

  private void bumpKeepAwake() {
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    ui.removeCallbacks(clearKeepAwake);
    ui.postDelayed(clearKeepAwake, KEEP_AWAKE_IDLE_MS);
  }

  private final Runnable clearKeepAwake =
      () -> getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

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

  @Override
  public void onRemoteKey(String key) {
    if (showsLoading && blockedWhileLoading(key)) return;
    ui.post(
        () -> {
          bumpKeepAwake();
          handleRemoteKey(key);
        });
  }

  @Override
  public void onRemoteKeyLetter(String key) {
    if (showsLoading && blockedWhileLoading(key)) return;
    ui.post(
        () -> {
          bumpKeepAwake();
          handleRemoteKeyLetter(key);
        });
  }

  @Override
  public void onBackToEmby() {
    ui.post(
        () -> {
          bumpKeepAwake();
          handleBack();
        });
  }

  // The phone's Shows button: unlike handleBack's one level out at a time,
  // this always leaves for Emby immediately no matter what has the focus.
  @Override
  public void onForceCloseToEmby() {
    ui.post(
        () -> {
          bumpKeepAwake();
          backToEmby();
        });
  }

  @Override
  public void onEmbySelected() {
    ui.post(
        () -> {
          bumpKeepAwake();
          embyClick();
        });
  }

  @Override
  public void onExit() {
    ui.post(this::finishAndRemoveTask);
  }

  @Override
  public void onFilter(String text) {
    ui.post(
        () -> {
          bumpKeepAwake();
          dropCustom(false);
          applyActorFilter(null);
          showList.setFilter(text);
        });
  }

  @Override
  public void onSelectShow(String name) {
    ui.post(() -> showList.selectByName(name));
  }

  @Override
  public void onCustomChanged() {
    ui.post(this::customChanged);
  }

  @Override
  public void onPhoneConnected() {
    ui.post(this::sendActiveShow);
  }

  @Override
  protected void onDestroy() {
    ui.removeCallbacks(clearKeepAwake);
    ui.removeCallbacks(filterDwell);
    ui.removeCallbacks(clearFlashEnd);
    super.onDestroy();
  }

  /** One level out: close a playing trailer, then leave tvapp. */
  private void handleBack() {
    if (player.isPlaying()) {
      player.close();
      return;
    }
    backToEmby();
  }

  private void handleRemoteKey(String key) {
    if (player.isPlaying()) {
      // While the video owns the screen the keys are the video's, the way they
      // are in Emby: ok pauses and resumes, left seeks. Right is the way back
      // out, the same key that started the video. The rest are swallowed so
      // they cannot move hidden tvapp focus underneath.
      if ("right".equals(key)) player.close();
      else player.key(key);
      return;
    }
    if ("ok".equals(key)) showList.rotateCardMisc();
    else if ("sort".equals(key)) cycleSort();
    else if ("filter".equals(key)) filterKeyClick();
    else moveSelection(key);
  }

  /**
   * The skip variant of up/down, sent once a held key has been auto-repeating
   * fast long enough to enter skip mode. Alphabetical is the one order a show's
   * first letter says where it is in, so it is the one order that skips by
   * letter; the rest skip by page instead.
   */
  private void handleRemoteKeyLetter(String key) {
    if (player.isPlaying()) return;
    boolean up = "up".equals(key);
    boolean down = "down".equals(key);
    if (!up && !down) {
      moveSelection(key);
      return;
    }
    int direction = up ? -1 : +1;
    if (showList.isAlphaOrder()) showList.moveSelectionByLetter(direction);
    else showList.moveSelectionByPage(direction);
  }

  @Override
  public boolean dispatchKeyEvent(KeyEvent event) {
    String key = remoteKeyFromKeyCode(event.getKeyCode());
    if (key == null) return super.dispatchKeyEvent(event);
    if (event.getAction() == KeyEvent.ACTION_DOWN) {
      bumpKeepAwake();
      if ("back".equals(key)) {
        if (SystemClock.uptimeMillis() - frontSince < BACK_DEAF_ON_FRONT_MS) return true;
        handleBack();
      } else if (!showsLoading || !blockedWhileLoading(key)) handleRemoteKey(key);
    }
    return true;
  }

  private String remoteKeyFromKeyCode(int keyCode) {
    switch (keyCode) {
      case KeyEvent.KEYCODE_DPAD_UP:
        return "up";
      case KeyEvent.KEYCODE_DPAD_DOWN:
        return "down";
      case KeyEvent.KEYCODE_DPAD_LEFT:
        return "left";
      case KeyEvent.KEYCODE_DPAD_RIGHT:
        return "right";
      case KeyEvent.KEYCODE_DPAD_CENTER:
      case KeyEvent.KEYCODE_ENTER:
      case KeyEvent.KEYCODE_NUMPAD_ENTER:
        return "ok";
      case KeyEvent.KEYCODE_BACK:
        return "back";
      default:
        return null;
    }
  }

  private class ButtonItem {
    final String label;
    final TextView view;

    ButtonItem(String label, TextView view) {
      this.label = label;
      this.view = view;
    }

    void paint(boolean active, boolean selected) {
      GradientDrawable bg = (GradientDrawable) view.getBackground();
      bg.setColor(active ? BUTTON_ACTIVE_BG : BUTTON_INACTIVE_BG);
      bg.setStroke(
          selected ? (int) dp(BUTTON_SELECTED_BORDER_DP) : 0, BUTTON_SELECTED_BORDER);
      view.setTextColor(active ? BUTTON_ACTIVE_TEXT : BUTTON_INACTIVE_TEXT);
    }
  }
}
