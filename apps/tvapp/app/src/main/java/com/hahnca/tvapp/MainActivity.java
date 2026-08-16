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
  // The top of the group, and where its cursor starts and is put back by a
  // clear. It resets every way the show list can be narrowed: filter text, the
  // toggle filters below it, the actor filter, and custom sort.
  private static final String CLEAR_FILTER_LABEL = "Clear";
  // The one filter that grows the list rather than narrowing it: every show
  // that is not in Emby comes in with it, which is a rebuild long enough to be
  // waited on rather than sat through.
  private static final String TRASH_FILTER_LABEL = "Trash";
  private static final String[] FILTER_LABELS = {
    CLEAR_FILTER_LABEL, "Drama", "Comedy", "To Try", "Continue", "Mark", "Linda", "Ready",
    TRASH_FILTER_LABEL
  };
  private static final String SORT_ALPHA = "Alpha";
  private static final String SORT_WATCHED = "Watched";
  private static final String SORT_ADDED = "Added";
  private static final String SORT_CUSTOM = "Custom";
  private static final String[] SORT_LABELS = {SORT_ALPHA, SORT_WATCHED, SORT_ADDED, SORT_CUSTOM};
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
  // The inset a button group container keeps above and below its buttons.
  private static final float GROUP_INSET_DP = BUTTON_SELECTED_BORDER_DP * 2f * 0.7f * 0.7f;
  // A whole button group having the focus, which is a different thing from
  // the cursor inside it: yellow around the group, red around one button.
  private static final int GROUP_FOCUS_BORDER = 0xFFFFFF00;
  private static final float GROUP_FOCUS_BORDER_DP = BUTTON_SELECTED_BORDER_DP;

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
  private static final String CLOSE_EMBY_SHOW_URL = "https://hahnca.com/tv-tv/tv/closeembyshow";
  private static final long KEEP_AWAKE_IDLE_MS = 5_000;
  // A back key in the first moment on screen is not the user's: coming here
  // from Emby closes the show that was playing, and that close key can still be
  // in flight when tvapp takes the screen. Answering it would send tvapp
  // straight back out again.
  private static final long BACK_DEAF_ON_FRONT_MS = 1_500;
  // How long after stepping off a played show a select naming that same show is
  // taken to be tv-tv's own -- the lastRelevantShow it selects on every open --
  // rather than the user asking for it. Long enough to cover the launch and
  // dial tv-tv does before sending it.
  private static final long SELECT_DEAF_AFTER_PLAY_MS = 15_000;
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
  private RelatedActors relatedActors;
  private ShowCounts showCounts;
  private TextView filterLabel;
  private TrailerPlayer player;
  private LinearLayout buttonColumn;
  private View sortGroup;
  private View filterGroup;
  private Shows.Sort sort = Shows.Sort.ALPHA;
  private boolean customOn;
  // Which of the four the keys are talking to. Only one of them is focused at
  // a time, and the show list is where the screen starts and comes back to.
  private Area area = Area.LIST;
  // The filter button the group's cursor is on. Remembered whether the group
  // has the focus or not, so coming back to it picks up where it left off, but
  // only drawn while it does.
  private String selectedFilter = CLEAR_FILTER_LABEL;
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
  // A select that arrived before the show list did, and the play waiting on it.
  // The ctrl socket is bound in onStart, well before the first Shows.load comes
  // back, so tv-tv's select-then-play burst can land on an empty list -- where
  // the select finds nothing and the play, seeing no selected show, would take
  // tvapp straight out to Emby.
  private String pendingSelectName;
  private boolean pendingPlay;
  // Set alongside pendingPlay when the play behind a not-yet-loaded select is
  // for one specific episode (tv-tv's map-pane TV button) rather than the
  // show's own next-up episode (its info-pane TV button).
  private String pendingPlayEpisodeId;
  private long showsLoadedAt;
  private long frontSince;
  private long trashAt;
  // Set when tvapp steps aside for a play in Emby, so the next foreground turn
  // knows it is coming back from having watched something.
  private boolean playedInEmby;
  // The show the selection was just stepped off of on coming back from a play,
  // and when that was, so tv-tv's select of it on the way back in does not put
  // the selection right back where it was.
  private String steppedOffShowName;
  private long steppedOffAt;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    AdbWifi.enable(this);
    setContentView(buildUi());

    showList.setSelectionListener(this::onShowSelected);
    sort = Shows.Sort.of(prefs().getString(KEY_SORT, null));
    showList.setSort(sort);
    // The column was painted while building the ui, before the remembered sort
    // was read back, so it is showing Alpha as the lit button until now.
    repaintButtons();
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
                  runPendingSelect();
                }));
  }

  /** The select, and any play behind it, that came in before the list did. */
  private void runPendingSelect() {
    if (pendingSelectName == null) return;
    showList.selectByName(pendingSelectName);
    pendingSelectName = null;
    if (pendingPlay) {
      pendingPlay = false;
      if (pendingPlayEpisodeId != null) {
        String embyId = pendingPlayEpisodeId;
        pendingPlayEpisodeId = null;
        playSelectedEpisode(embyId);
      } else {
        embyClick();
      }
    }
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
    stepOffPlayedShow();
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

  /**
   * Coming back from a play in Emby, in the Watched sort only: the show just
   * watched is done with, so the selection steps to the next one down at once,
   * without waiting for the reload that will re-sort the list. On the last show
   * there is no next one, so it steps up instead.
   */
  private void stepOffPlayedShow() {
    if (!playedInEmby) return;
    playedInEmby = false;
    if (sort != Shows.Sort.WATCHING) return;
    Shows.Show played = showList.getSelected();
    if (!showList.moveSelection(+1) && !showList.moveSelection(-1)) return;
    steppedOffShowName = played == null ? null : played.name;
    steppedOffAt = SystemClock.uptimeMillis();
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
    showList.setActorFilterListener(this::chooseActorFilter);
    // The two actor displays cover the list rather than taking room of their
    // own, so all three share a frame.
    FrameLayout listArea = new FrameLayout(this);
    listArea.addView(showList, matchParent());
    relatedActors = new RelatedActors(this);
    listArea.addView(relatedActors, matchParent());
    showCounts = new ShowCounts(this);
    listArea.addView(showCounts, matchParent());
    column.addView(
        listArea, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
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
   * is one share, each group as many shares as it holds buttons, so the two
   * groups keep their proportions while the fixed spacing -- the gap between
   * the groups and the room for their focus borders -- comes off the top first.
   *
   * Both groups keep their own horizontal padding, so a focus border has room
   * without the buttons inside it moving.
   */
  private View buildButtonColumn() {
    buttonColumn = new LinearLayout(this);
    buttonColumn.setOrientation(LinearLayout.VERTICAL);

    sortGroup = buildButtonGroup(SORT_LABELS);
    buttonColumn.addView(sortGroup, shareOfColumn(SORT_LABELS.length));
    filterGroup = buildButtonGroup(FILTER_LABELS);
    buttonColumn.addView(filterGroup, filterGroupParams());
    repaintButtons();
    paintGroups();
    return buttonColumn;
  }

  private LinearLayout.LayoutParams shareOfColumn(float shares) {
    return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, shares);
  }

  /**
   * One stack of buttons in a container of its own, so the group keeps its
   * spacing from the other group whatever the column's height works out to, and
   * so the focus border has something of the group's own to be drawn on.
   */
  private View buildButtonGroup(String[] labels) {
    LinearLayout group = new LinearLayout(this);
    group.setOrientation(LinearLayout.VERTICAL);
    GradientDrawable groupBg = new GradientDrawable();
    groupBg.setCornerRadius(dp(BUTTON_CORNER_DP));
    group.setBackground(groupBg);
    group.setPadding(
        (int) dp(BUTTON_PAD_H_DP),
        (int) dp(GROUP_INSET_DP),
        (int) dp(BUTTON_PAD_H_DP),
        (int) dp(GROUP_INSET_DP));
    for (int i = 0; i < labels.length; i++) {
      LinearLayout.LayoutParams params = shareOfColumn(1f);
      // Between the buttons only: below the last one is the container's own
      // padding.
      if (i < labels.length - 1) params.bottomMargin = (int) dp(COLUMN_BUTTON_GAP_DP);
      addButton(group, labels[i], params);
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
      if (item != null) item.paint(isButtonActive(label), isCursorOn(label));
    }
  }

  /**
   * Whether a group's cursor is drawn on this button. Only the filter group has
   * one -- the sort buttons are one-of, so the lit button is already saying
   * where up and down are working from and a second outline on it would say
   * nothing more. It is drawn only while the filter group has the focus: where
   * the cursor stands is remembered either way, but an outline on a group that
   * is not taking keys would read as a state of its own.
   */
  private boolean isCursorOn(String label) {
    if (isSortLabel(label)) return false;
    if (area != Area.FILTERS) return false;
    return label.equals(selectedFilter);
  }

  private static boolean isSortLabel(String label) {
    for (String sortLabel : SORT_LABELS) {
      if (sortLabel.equals(label)) return true;
    }
    return false;
  }

  /** The border round each group, which is only there while that group has the focus. */
  private void paintGroups() {
    paintGroup(sortGroup, area == Area.SORTS);
    paintGroup(filterGroup, area == Area.FILTERS);
  }

  private void paintGroup(View group, boolean focused) {
    GradientDrawable bg = (GradientDrawable) group.getBackground();
    bg.setStroke(focused ? (int) dp(GROUP_FOCUS_BORDER_DP) : 0, GROUP_FOCUS_BORDER);
  }

  /**
   * Hands the focus to one of the four areas. The show list is the one that
   * draws nothing of its own for it: its selected card is bordered whenever
   * cardMisc is not.
   */
  private void focusArea(Area next) {
    if (area == next) return;
    area = next;
    showList.setMiscFocused(area == Area.MISC);
    paintGroups();
    // The filter cursor comes and goes with the group's own focus.
    repaintButtons();
  }

  private boolean isButtonActive(String label) {
    if (CLEAR_FILTER_LABEL.equals(label)) return clearFlashing;
    if (activeFilters.contains(label)) return true;
    if (isSortLabel(label)) return label.equals(activeSortLabel());
    return false;
  }

  /** The one sort button that is lit: Custom wins, else whichever order is in force. */
  private String activeSortLabel() {
    if (customOn) return SORT_CUSTOM;
    if (sort == Shows.Sort.WATCHING) return SORT_WATCHED;
    if (sort == Shows.Sort.ADDED) return SORT_ADDED;
    return SORT_ALPHA;
  }

  /**
   * Up or down in the focused sort group: one button either way from the one
   * that is lit, stopping at the ends rather than wrapping, and switching the
   * list as it goes. There is nothing to confirm afterwards -- only one sort
   * can be on, so landing on a button is choosing it.
   */
  private void stepSort(int direction) {
    String next = stepInGroup(SORT_LABELS, activeSortLabel(), direction);
    if (next == null) return;
    if (SORT_CUSTOM.equals(next)) {
      customClick();
      return;
    }
    // Off the Custom list. Whatever else is narrowing the list -- the filter
    // buttons, the typed text, an actor -- stays exactly as it was: leaving
    // Custom is a sort choice and nothing more.
    if (customOn) setCustomOn(false);
    applySort(sortForLabel(next));
  }

  private static Shows.Sort sortForLabel(String label) {
    if (SORT_WATCHED.equals(label)) return Shows.Sort.WATCHING;
    if (SORT_ADDED.equals(label)) return Shows.Sort.ADDED;
    return Shows.Sort.ALPHA;
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
   * app's own to fall back to: it goes alphabetical.
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
          // Nothing else is turned off to make room for it: the custom order is
          // the whole list while it is on, so the filter buttons, the typed text
          // and any actor sit inert until it comes off again.
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
   *
   * Nothing else is turned off to let the button through: while Custom or an
   * actor is on, that is the list, and the button lights up but narrows
   * nothing until whichever of them it is comes off.
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
        || "info".equals(key)
        || "up".equals(key)
        || "down".equals(key)
        || "left".equals(key)
        || "right".equals(key);
  }

  /**
   * The Clear button: every way the show list can be narrowed, all at once.
   * The sort is not one of them -- Custom included, which stays on and stays
   * the list being shown.
   */
  private void clearAllFilters() {
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

  /**
   * The Actors cardMisc picking an actor: every other way the list was narrowed
   * comes off first, exactly as the Clear button takes them off, and the actor
   * name goes up over the list in their place. Null is that filter coming back
   * off again, which the ok key does on its way to the next cardMisc.
   *
   * The selection is kept: the actor chosen comes from the selected show's own
   * cast, so that show is in the narrowed list and stays the one cardMisc is
   * showing.
   */
  private void chooseActorFilter(String actorName) {
    if (actorName == null) {
      applyActorFilter(null);
      return;
    }
    dropCustom(true);
    activeFilters.clear();
    showList.setActiveFilters(activeFilters);
    clearTextFilter();
    applyActorFilter(actorName);
    repaintButtons();
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

  /** One button either way, stopping at the ends of the group rather than wrapping. */
  private void stepSelectedFilter(int direction) {
    String next = stepInGroup(FILTER_LABELS, selectedFilter, direction);
    if (next == null) return;
    selectedFilter = next;
    repaintButtons();
  }

  /** The label one step either way, or null at the end the step would run off. */
  private static String stepInGroup(String[] labels, String current, int direction) {
    int index = 0;
    for (int i = 0; i < labels.length; i++) {
      if (labels[i].equals(current)) index = i;
    }
    int next = Math.max(0, Math.min(labels.length - 1, index + direction));
    return next == index ? null : labels[next];
  }

  private final Runnable clearFlashEnd =
      () -> {
        clearFlashing = false;
        repaintButtons();
      };

  /**
   * The ok key on the button the group's cursor is on: Clear resets everything
   * and lights up for a moment, the rest toggle and stay lit while they are on.
   */
  private void activateSelectedFilter() {
    if (CLEAR_FILTER_LABEL.equals(selectedFilter)) {
      clearAllFilters();
      clearFlashing = true;
      ui.postDelayed(clearFlashEnd, CLEAR_FLASH_MS);
      repaintButtons();
    } else {
      toggleFilter(selectedFilter);
    }
  }

  /**
   * The Shows key: back to a clean screen. The show list has the focus and
   * nothing else does, and the selected card is back on its description with
   * the episode card and any trailer gone.
   *
   * The list itself is left exactly as it was found -- the sort, the filter
   * buttons, the typed text and any actor. This key is about what is on the
   * screen, not about what is in the list; the Clear button is the one that
   * takes narrowings off.
   */
  private void clearScreenState() {
    if (player.isPlaying()) player.close();
    relatedActors.close();
    showCounts.close();
    // The actor filter is a list to browse like any other, and this key is the
    // way back to the plain one, so it comes off here as it does on back.
    applyActorFilter(null);
    area = Area.LIST;
    showList.setMiscFocused(false);
    paintGroups();
    repaintButtons();
  }

  /**
   * The ok key on something to play, and tv-tv's own play command: a trailer
   * under cardMisc's cursor, the episode under it, or -- with the show list
   * focused -- the selected show itself, from wherever Emby left off.
   */
  private void embyClick() {
    String trailerUrl = showList.focusedTrailerUrl();
    if (trailerUrl != null) {
      player.play(trailerUrl);
      return;
    }
    Shows.Show show = showList.getSelected();
    if (show == null) {
      backToEmby();
      return;
    }
    if (showList.hasEpisodeFocus()) {
      // A named episode gets past Emby's own next-up choice, so the show's
      // readiness does not come into it -- but an episode with no file has
      // nothing at all to play.
      String episodeId = showList.focusedEpisodeId();
      if (episodeId == null) {
        showBigCenterToast(NO_FILE_TOAST);
        return;
      }
      playInEmby(show, episodeId);
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
    playInEmby(show, null);
  }

  // Same as embyClick's episode-focused branch, but the episode comes from
  // tv-tv (the map pane's TV button) instead of an on-screen cursor.
  private void playSelectedEpisode(String embyId) {
    Shows.Show show = showList.getSelected();
    if (show == null) {
      backToEmby();
      return;
    }
    playInEmby(show, embyId);
  }

  private void playInEmby(Shows.Show show, String episodeId) {
    new Thread(
            () -> {
              try {
                String url =
                    VIEWSHOW_URL
                        + "?showId="
                        + URLEncoder.encode(show.id, "UTF-8")
                        + "&showName="
                        + URLEncoder.encode(show.name, "UTF-8")
                        + (episodeId == null
                            ? ""
                            : "&episodeId=" + URLEncoder.encode(episodeId, "UTF-8"))
                        + "&play=1";
                HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(VIEWSHOW_TIMEOUT_MS);
                conn.setReadTimeout(VIEWSHOW_TIMEOUT_MS);
                conn.getInputStream().close();
                conn.disconnect();
              } catch (Exception e) {
                Log.e(TAG, "viewshow failed for " + show.name + ": " + e);
              }
              ui.post(
                  () -> {
                    playedInEmby = true;
                    moveTaskToBack(true);
                  });
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
   * The back key's own way out, which leaves Emby off the show as well as
   * tvapp: the same close tv-tv does on the way in, when the Shows key opens
   * tvapp over a show that is playing.
   *
   * Asked for first and answered on tv-srvr's own time: the stop takes effect
   * wherever Emby is, and the back key that follows it is a second or so
   * behind, by which time Emby is the app on screen to take it.
   */
  private void backToEmbyClosingShow() {
    closeEmbyShow();
    backToEmby();
  }

  private void closeEmbyShow() {
    new Thread(
            () -> {
              try {
                Http.postJson(CLOSE_EMBY_SHOW_URL, "{}");
              } catch (Exception e) {
                Log.e(TAG, "close emby show failed: " + e);
              }
            },
            "close-emby-show")
        .start();
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

  // tv-tv's force-back: unlike handleBack's one level out at a time, this
  // always leaves for Emby immediately no matter what has the focus.
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
          // Waits its turn behind a select the list has not arrived for yet,
          // rather than playing whatever (if anything) is selected now.
          if (pendingSelectName != null) {
            pendingPlay = true;
            return;
          }
          embyClick();
        });
  }

  @Override
  public void onClearState() {
    ui.post(
        () -> {
          bumpKeepAwake();
          clearScreenState();
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
    ui.post(
        () -> {
          // tv-tv selects lastRelevantShow on every open, which right after a
          // play is the show just watched -- the one the selection has already
          // been stepped off of on purpose.
          if (name != null && name.equals(steppedOffShowName)) {
            if (SystemClock.uptimeMillis() - steppedOffAt < SELECT_DEAF_AFTER_PLAY_MS) {
              steppedOffShowName = null;
              return;
            }
            steppedOffShowName = null;
          }
          if (showsLoadedAt == 0) {
            pendingSelectName = name;
            return;
          }
          showList.selectByName(name);
        });
  }

  // tv-tv's map-pane TV button: sent right after an onSelectShow, so it plays
  // that one episode instead of the show's own next-up pick.
  @Override
  public void onPlayEpisode(String embyId) {
    ui.post(
        () -> {
          bumpKeepAwake();
          if (pendingSelectName != null) {
            pendingPlayEpisodeId = embyId;
            pendingPlay = true;
            return;
          }
          playSelectedEpisode(embyId);
        });
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
    ui.removeCallbacks(clearFlashEnd);
    super.onDestroy();
  }

  /**
   * One level out: close a playing trailer, drop an actor filter, hand the
   * focus back to the show list, leave tvapp.
   *
   * cardMisc is one level however deep into it the screen is -- the episode
   * card included -- so this key comes out of the whole of it at once, back to
   * the show list.
   *
   * An actor filter is its own level: it comes off on its own, leaving every
   * other selected filter in place, and nothing else about the screen changes.
   */
  private void handleBack() {
    if (player.isPlaying()) {
      player.close();
      return;
    }
    ActorOverlay overlay = openOverlay();
    if (overlay != null) {
      overlay.close();
      return;
    }
    if (actorFilterName != null) {
      applyActorFilter(null);
      return;
    }
    if (area != Area.LIST) {
      focusArea(Area.LIST);
      return;
    }
    backToEmbyClosingShow();
  }

  private void handleRemoteKey(String key) {
    // Once the user has worked the remote, a select of the show just stepped
    // off is theirs and is answered normally.
    steppedOffShowName = null;
    if (player.isPlaying()) {
      // While the video owns the screen the keys are the video's, the way they
      // are in Emby: ok pauses and resumes, left seeks. Right is the way back
      // out, the same key that started the video. The rest are swallowed so
      // they cannot move hidden tvapp focus underneath.
      if ("right".equals(key)) player.close();
      else player.key(key);
      return;
    }
    // An actor display covers the list, so while one is up the keys are its
    // own: the arrows walk it, ok narrows the list to the actor under its
    // cursor if it has one, the three focus keys take it away and go on to
    // their own area, and the rest do nothing at all. The key that opened it
    // is one of the arrows from here on. Back is not here: it comes in as its
    // own message, and handleBack closes these the same way.
    ActorOverlay overlay = openOverlay();
    if (overlay != null) {
      if (isArrowKey(key)) {
        overlay.arrowKey(key);
        return;
      }
      if ("ok".equals(key)) {
        chooseOverlayActor(overlay);
        return;
      }
      if (!"sort".equals(key) && !"filter".equals(key) && !"info".equals(key)) return;
      overlay.close();
    }
    // The three focus keys, each answered wherever the focus happens to be:
    // they are the one way into their area, and so also the way out of every
    // other one. Info is the exception, and only once cardMisc already has the
    // focus, where it goes on rotating cardMisc's modes.
    if ("sort".equals(key)) {
      focusArea(Area.SORTS);
      return;
    }
    if ("filter".equals(key)) {
      focusArea(Area.FILTERS);
      return;
    }
    if ("info".equals(key) && area != Area.MISC) {
      focusArea(Area.MISC);
      return;
    }
    if (area == Area.SORTS) sortAreaKey(key);
    else if (area == Area.FILTERS) filterAreaKey(key);
    else if (area == Area.MISC) miscAreaKey(key);
    else listAreaKey(key);
  }

  /**
   * The show list has the focus: up and down move the selection, ok plays the
   * show it is on, and right hands the focus to the selected card's cardMisc.
   * Left does nothing -- the button groups have their own keys to reach them
   * with.
   */
  private void listAreaKey(String key) {
    if ("up".equals(key)) showList.moveSelection(-1);
    else if ("down".equals(key)) showList.moveSelection(+1);
    else if ("right".equals(key)) focusArea(Area.MISC);
    else if ("ok".equals(key)) embyClick();
  }

  /**
   * The sort group has the focus: up and down switch the sort, and right hands
   * the focus back to the show list. Left does nothing -- there is nothing to
   * the left of the button column.
   */
  private void sortAreaKey(String key) {
    if ("up".equals(key)) stepSort(-1);
    else if ("down".equals(key)) stepSort(+1);
    else if ("right".equals(key)) focusArea(Area.LIST);
  }

  /**
   * The filter group has the focus: up and down move its cursor, ok works the
   * button under it, and right hands the focus back to the show list.
   */
  private void filterAreaKey(String key) {
    if ("up".equals(key)) stepSelectedFilter(-1);
    else if ("down".equals(key)) stepSelectedFilter(+1);
    else if ("ok".equals(key)) activateSelectedFilter();
    else if ("right".equals(key)) focusArea(Area.LIST);
  }

  /**
   * cardMisc has the focus: info moves it on to the next mode, ok opens
   * whatever the mode has under its cursor, and the arrow keys move inside it.
   */
  private void miscAreaKey(String key) {
    // Down over the cast strip, which has nothing else to move: everyone the
    // actor under the cursor keeps turning up with, over the list.
    if ("down".equals(key) && showList.isActorFocused()) {
      openRelatedActors();
      return;
    }
    // Up over the same strip: who is in the most shows, over the list. Not
    // while the list is already narrowed to one actor -- that is a list to
    // browse, and this would cover it with a ranking of everyone.
    if ("up".equals(key) && showList.isActorFocused() && actorFilterName == null) {
      showCounts.open(showList.getShows());
      return;
    }
    if ("info".equals(key)) showList.infoInCardMisc();
    else if ("ok".equals(key)) openInCardMisc();
    else if ("up".equals(key)) showList.moveInCardMisc(-1, true);
    else if ("down".equals(key)) showList.moveInCardMisc(+1, true);
    else if ("left".equals(key)) showList.moveInCardMisc(-1, false);
    else if ("right".equals(key)) showList.moveInCardMisc(+1, false);
  }

  /** Every actor who shares more than one show with the one under the cursor. */
  private void openRelatedActors() {
    String name = showList.focusedActorName();
    if (name == null) return;
    relatedActors.open(showList.getShows(), name);
  }

  /** Whichever of the two actor displays is over the list, or null for neither. */
  private ActorOverlay openOverlay() {
    if (relatedActors.isOpen()) return relatedActors;
    if (showCounts.isOpen()) return showCounts;
    return null;
  }

  /**
   * The ok key on a display that has a cursor: the list narrowed to the actor
   * under it, which is the same filter the cast strip in cardMisc puts on, and
   * behaves the same way from here on. The display has served its purpose, so
   * it comes off to leave the narrowed list on screen.
   */
  private void chooseOverlayActor(ActorOverlay overlay) {
    String name = overlay.focusedActorName();
    if (name == null) return;
    overlay.close();
    chooseActorFilter(name);
    focusArea(Area.LIST);
  }

  private static boolean isArrowKey(String key) {
    return "up".equals(key) || "down".equals(key) || "left".equals(key) || "right".equals(key);
  }

  /**
   * The part of opening a cardMisc item that is not cardMisc's own: starting
   * Emby, and taking the focus back to the show list the actor filter has just
   * narrowed.
   */
  private void openInCardMisc() {
    ShowListView.OpenResult result = showList.openFocused();
    if (result == ShowListView.OpenResult.PLAY) embyClick();
    else if (result == ShowListView.OpenResult.ACTOR) focusArea(Area.LIST);
  }

  /**
   * The skip variant of up/down, sent once a held key has been auto-repeating
   * fast long enough to enter skip mode. Alphabetical is the one order a show's
   * first letter says where it is in, so it is the one order that skips by
   * letter; the rest skip by page instead.
   *
   * There is nothing to skip through anywhere but the show list, so a hold
   * over one of the other areas is just the key held down.
   */
  private void handleRemoteKeyLetter(String key) {
    if (player.isPlaying()) return;
    boolean up = "up".equals(key);
    boolean down = "down".equals(key);
    if (!up && !down || area != Area.LIST) {
      handleRemoteKey(key);
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

  /** The four things the keys can be talking to, one of them at a time. */
  private enum Area {
    LIST,
    SORTS,
    FILTERS,
    MISC
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
