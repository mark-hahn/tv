package com.hahnca.tvapp;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
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
  private static final float COLUMN_GAP_DP = 12f;
  private static final float LIST_WIDTH_FRACTION = 0.36f;
  private static final float BUTTONS_WIDTH_FRACTION = 0.09f;
  private static final float PANE_WIDTH_FRACTION = 0.55f;

  private static final String[] TAB_LABELS = {"Info", "Map", "Actors", "Trailer"};
  // Not a toggle of its own: clicking it opens the phone's filter input screen,
  // which is the only way that screen opens now that the remote has no Filter
  // button. It is focused and clicked like the rest of the group, and shows
  // active while filter text is narrowing the list.
  private static final String FILTER_INPUT_LABEL = "Text";
  // Sits directly above the text-input button and resets every way the show
  // list can be narrowed: filter text, the toggle filters below it, the actor
  // filter, and custom sort.
  private static final String CLEAR_FILTER_LABEL = "Clear";
  private static final String[] FILTER_LABELS = {
    CLEAR_FILTER_LABEL, FILTER_INPUT_LABEL, "Ready", "Drama", "Comedy", "To Try", "Continue",
    "Mark", "Linda", "Trash"
  };
  private static final String SORT_WATCHED = "Watched";
  private static final String SORT_ADDED = "Added";
  private static final String SORT_CUSTOM = "Custom";
  private static final String[] SORT_LABELS = {SORT_WATCHED, SORT_ADDED, SORT_CUSTOM};
  // The shared settings already filtered and sorted into a show list, by the
  // same @tv/share code the web client runs on its own copy of the data.
  private static final String SHARED_FILTER_SHOWS_URL =
      "https://hahnca.com/tv-srvr/api/getSharedFilterShows";
  private static final int MAP_TAB_INDEX = 1;
  private static final int ACTORS_TAB_INDEX = 2;
  private static final int TRAILER_TAB_INDEX = 3;

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
  // filter group's 10 -- fit the column's height without crowding it.
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
  // The focused area's own border, twice the width of a focused button's, drawn
  // around the whole group. It sits in the padding the group already had, so
  // nothing inside it moves when it comes and goes.
  private static final float AREA_BORDER_DP = BUTTON_SELECTED_BORDER_DP * 2f * 0.7f * 0.7f;

  private static final String PREFS_NAME = "tvapp";
  private static final String KEY_SELECTED_SHOW = "selectedShow";
  private static final String KEY_SORT = "sort";
  private static final String KEY_FOCUSED_FILTER = "focusedFilter";

  private static final String VIEWSHOW_URL = "https://hahnca.com/tv-tv/tv/viewshow";
  private static final int VIEWSHOW_TIMEOUT_MS = 10000;
  private static final String EMBY_PACKAGE = "com.mb.android";
  private static final String UNMUTE_URL = "https://hahnca.com/tv-tv/tv/unmute";
  private static final long KEEP_AWAKE_IDLE_MS = 5_000;
  // Coming back from Emby reuses the list already in memory, which is the point
  // of staying resident, but a list loaded long enough ago has stale waitStrs.
  private static final long SHOWS_REFRESH_AFTER_MS = 10 * 60_000;

  private final Handler ui = new Handler(Looper.getMainLooper());
  private final List<Pane> panes = new ArrayList<>();
  private final Map<String, ButtonItem> buttonItems = new HashMap<>();
  private final List<String> buttonOrder = new ArrayList<>();
  private final Set<String> activeFilters = new HashSet<>();

  private CtrlServer ctrlServer;
  private ShowListView showList;
  private TextView filterLabel;
  private InfoView info;
  private MapPane mapPane;
  private ActorsView actorsPane;
  private TrailersView trailersView;
  private Pane activePane;
  private TrailerPlayer player;
  private LinearLayout buttonColumn;
  private GradientDrawable filterGroupBg;
  private GradientDrawable paneAreaBg;
  private Shows.Sort sort = Shows.Sort.ALPHA;
  private boolean customOn;
  private int activeTabIndex;
  private Area area = Area.SHOWS;
  // The filter button the focus is on, kept while the focus is elsewhere and
  // across restarts, so the filter group is re-entered where it was left.
  private String focusedFilter;
  // Whether filter text is narrowing the show list, which is exactly when the
  // filter label above the list is showing that text.
  private boolean filterTextActive;
  private String activeShowName;
  private long showsLoadedAt;

  /**
   * The one area of the screen that can hold a focused item. The show list is
   * an area like the other two, but nothing in it is ever focused: it is simply
   * where the arrow keys go when neither of the other two has the focus, and
   * there its up and down move the selected show itself.
   *
   * The filter group focuses one of its buttons. The tab pane focuses an item
   * of the pane on screen -- a cell in Map's grid, a card in Actors, a card in
   * Trailer -- and Info, having nothing to focus, cannot be entered at all.
   * The tab and sort buttons are never focused; the remote's Info and Sort keys
   * are what change them.
   */
  private enum Area {
    SHOWS,
    FILTERS,
    PANE
  }

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    AdbWifi.enable(this);
    setContentView(buildUi());

    showList.setSelectionListener(this::onShowSelected);
    sort = Shows.Sort.of(prefs().getString(KEY_SORT, null));
    showList.setSort(sort);
    focusedFilter = prefs().getString(KEY_FOCUSED_FILTER, FILTER_LABELS[0]);
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
    ctrlServer = new CtrlServer(this);
    ctrlServer.start();
    if (showsLoadedAt != 0
        && System.currentTimeMillis() - showsLoadedAt > SHOWS_REFRESH_AFTER_MS) {
      Shows.Show selected = showList.getSelected();
      loadShows(selected == null ? null : selected.name);
    }
  }

  @Override
  protected void onStop() {
    ctrlServer.shutdown();
    ctrlServer = null;
    super.onStop();
  }

  private View buildUi() {
    FrameLayout root = new FrameLayout(this);
    root.setBackgroundColor(Color.BLACK);

    LinearLayout columns = new LinearLayout(this);
    columns.setOrientation(LinearLayout.HORIZONTAL);
    columns.setPadding(0, (int) dp(SCREEN_V_MARGIN_DP), 0, (int) dp(SCREEN_V_MARGIN_DP));
    columns.addView(buildButtonColumn(), column(BUTTONS_WIDTH_FRACTION, 0));
    columns.addView(buildList(), column(LIST_WIDTH_FRACTION, dp(COLUMN_GAP_DP)));
    columns.addView(buildPaneColumn(), column(PANE_WIDTH_FRACTION, dp(COLUMN_GAP_DP)));
    root.addView(columns, matchParent());

    player = new TrailerPlayer(this);
    root.addView(player, matchParent());
    buttonColumn.post(this::sizeTabButtons);
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
    filterTextActive = text != null && !text.isEmpty();
    repaintButtons();
    if (text == null || text.isEmpty()) {
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
   * The one focusable group of buttons, in a container of its own so the focus
   * border can be drawn around all of it at once. The container's padding is
   * what the column used to hold, so the border lands in space the layout
   * already had.
   */
  private View buildFilterGroup() {
    LinearLayout group = new LinearLayout(this);
    group.setOrientation(LinearLayout.VERTICAL);
    group.setPadding(
        (int) dp(BUTTON_PAD_H_DP),
        (int) dp(AREA_BORDER_DP),
        (int) dp(BUTTON_PAD_H_DP),
        (int) dp(AREA_BORDER_DP));
    filterGroupBg = new GradientDrawable();
    filterGroupBg.setCornerRadius(dp(BUTTON_CORNER_DP));
    group.setBackground(filterGroupBg);
    for (int i = 0; i < FILTER_LABELS.length; i++) {
      LinearLayout.LayoutParams params = shareOfColumn(1f);
      // Between the buttons only: below the last one is the container's own
      // padding, which is what the border sits in.
      if (i < FILTER_LABELS.length - 1) params.bottomMargin = (int) dp(COLUMN_BUTTON_GAP_DP);
      addButton(group, FILTER_LABELS[i], params);
    }
    return group;
  }

  private LinearLayout.LayoutParams filterGroupParams() {
    LinearLayout.LayoutParams params = shareOfColumn(FILTER_LABELS.length);
    // The container's own top padding is part of the gap between the groups.
    params.topMargin = (int) dp(BUTTON_GROUP_GAP_DP - AREA_BORDER_DP);
    return params;
  }

  /**
   * The tab buttons, in a row across the top of the tab pane they switch. They
   * are the one group that is read left to right, so they are sized rather than
   * stretched: each keeps the width it had while it was in the button column.
   */
  private View buildTabRow() {
    LinearLayout row = new LinearLayout(this);
    row.setOrientation(LinearLayout.HORIZONTAL);
    for (int i = 0; i < TAB_LABELS.length; i++) {
      LinearLayout.LayoutParams params =
          new LinearLayout.LayoutParams(
              ViewGroup.LayoutParams.WRAP_CONTENT, (int) dp(BUTTON_HEIGHT_DP));
      if (i > 0) params.leftMargin = (int) dp(TAB_GAP_DP);
      addButton(row, TAB_LABELS[i], params);
    }
    return row;
  }

  /** The width the tab buttons had in the button column, which is that column
   * inside its buttons' margins. Known only once the column has been laid out. */
  private void sizeTabButtons() {
    int width = buttonColumn.getWidth() - 2 * (int) dp(BUTTON_PAD_H_DP);
    if (width <= 0) return;
    for (int i = 0; i < TAB_LABELS.length; i++) {
      View view = buttonItems.get(TAB_LABELS[i]).view;
      LinearLayout.LayoutParams params = (LinearLayout.LayoutParams) view.getLayoutParams();
      params.width = width;
      // The row starts half a button in from the edge of the pane, which is a
      // width only known here.
      if (i == 0) params.leftMargin = width / 2;
      view.setLayoutParams(params);
    }
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

  /** The tab row above the tab pane it switches, and the pane below it. */
  private View buildPaneColumn() {
    LinearLayout paneColumn = new LinearLayout(this);
    paneColumn.setOrientation(LinearLayout.VERTICAL);
    LinearLayout.LayoutParams rowParams =
        new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    rowParams.bottomMargin = (int) dp(BUTTON_MARGIN_BOTTOM_DP);
    paneColumn.addView(buildTabRow(), rowParams);
    paneColumn.addView(
        buildPanes(), new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
    return paneColumn;
  }

  private View buildPanes() {
    FrameLayout holder = new FrameLayout(this);
    // Room for the focus border around the whole tab pane; the panes inside
    // shrink by that much rather than the border overlapping them.
    holder.setPadding(
        (int) dp(AREA_BORDER_DP),
        (int) dp(AREA_BORDER_DP),
        (int) dp(AREA_BORDER_DP),
        (int) dp(AREA_BORDER_DP));
    paneAreaBg = new GradientDrawable();
    paneAreaBg.setCornerRadius(dp(BUTTON_CORNER_DP));
    holder.setBackground(paneAreaBg);
    info = new InfoView(this);
    panes.add(info);
    mapPane = new MapPane(this);
    // The grid is fetched, so a right-arrow into the Map pane can land before
    // there is a cell to land on; this is the grid saying it got there.
    mapPane.setCellFocusListener(
        () -> {
          area = Area.PANE;
          repaintFocus();
        });
    panes.add(mapPane);
    actorsPane = new ActorsView(this);
    actorsPane.setListener(this::actorClick);
    panes.add(actorsPane);
    trailersView = new TrailersView(this);
    trailersView.setPlayListener(
        url -> {
          sendUnmute();
          player.play(url);
        });
    panes.add(trailersView);
    for (Pane pane : panes) {
      pane.asView().setVisibility(View.GONE);
      holder.addView(pane.asView(), matchParent());
    }
    selectTab(0);
    return holder;
  }

  private void selectTab(int index) {
    activeTabIndex = index;
    for (int i = 0; i < panes.size(); i++) {
      panes.get(i).asView().setVisibility(i == index ? View.VISIBLE : View.GONE);
    }
    activePane = panes.get(index);
    activePane.onShown();
    if (index != MAP_TAB_INDEX) mapPane.closeEpisode();
    // Nothing can stay focused in a pane that has just stopped being the one on
    // screen. Whatever is moving the focus into the new pane sets it after this.
    clearPaneFocus();
    repaintButtons();
  }

  /** Every pane's focused item at once -- whichever one the focus is leaving. */
  private void clearPaneFocus() {
    mapPane.clearCellFocus();
    actorsPane.clearCardFocus();
    trailersView.clearCardFocus();
  }

  /** The focused area's border, and the focused button inside it. */
  private void repaintFocus() {
    repaintButtons();
    filterGroupBg.setStroke(
        area == Area.FILTERS ? (int) dp(AREA_BORDER_DP) : 0, BUTTON_SELECTED_BORDER);
    paneAreaBg.setStroke(
        area == Area.PANE ? (int) dp(AREA_BORDER_DP) : 0, BUTTON_SELECTED_BORDER);
  }

  private void repaintButtons() {
    for (String label : buttonOrder) {
      ButtonItem item = buttonItems.get(label);
      if (item != null) {
        item.paint(isButtonActive(label), area == Area.FILTERS && label.equals(focusedFilter));
      }
    }
  }

  private boolean isButtonActive(String label) {
    for (int i = 0; i < TAB_LABELS.length; i++) {
      if (TAB_LABELS[i].equals(label)) return activeTabIndex == i;
    }
    if (FILTER_INPUT_LABEL.equals(label)) return filterTextActive;
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
      setCustomOn(false);
      showList.setCustomOrder(null);
      clearTextFilter();
      applySort(Shows.Sort.ALPHA);
    } else if (sort == Shows.Sort.WATCHING) {
      applySort(Shows.Sort.ADDED);
    } else if (sort == Shows.Sort.ADDED) {
      customClick();
    } else {
      applySort(Shows.Sort.WATCHING);
    }
  }

  private void applySort(Shows.Sort newSort) {
    sort = newSort;
    showList.setSort(sort);
    prefs().edit().putString(KEY_SORT, sort.name()).apply();
    repaintButtons();
  }

  private void setCustomOn(boolean on) {
    customOn = on;
    repaintButtons();
  }

  /**
   * Custom on: the show list tv-srvr worked out from the shared settings, which
   * it keeps on disk, so the button is always there to be turned on.
   */
  private void customClick() {
    new Thread(
            () -> {
              try {
                JSONObject res = new JSONObject(Http.get(SHARED_FILTER_SHOWS_URL));
                JSONArray arr = res.optJSONArray("names");
                List<String> names = new ArrayList<>();
                for (int i = 0; arr != null && i < arr.length(); i++) {
                  names.add(arr.optString(i, ""));
                }
                ui.post(
                    () -> {
                      clearTextFilter();
                      actorsPane.clearSelection();
                      showList.setActorFilter(null);
                      showList.setCustomOrder(names);
                      setCustomOn(true);
                    });
              } catch (Exception e) {
                Log.e(TAG, "custom show list fetch failed: " + e);
              }
            },
            "custom-click")
        .start();
  }

  private void toggleFilter(String label) {
    if (customOn) {
      setCustomOn(false);
      showList.setCustomOrder(null);
    }
    actorsPane.clearSelection();
    showList.setActorFilter(null);
    if (activeFilters.contains(label)) activeFilters.remove(label);
    else activeFilters.add(label);
    showList.setActiveFilters(activeFilters);
    repaintButtons();
  }

  /** The Clear button: every way the show list can be narrowed, all at once. */
  private void clearAllFilters() {
    if (customOn) {
      setCustomOn(false);
      showList.setCustomOrder(null);
    }
    actorsPane.clearSelection();
    showList.setActorFilter(null);
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
      showList.setActorFilter(null);
      return;
    }
    if (customOn) setCustomOn(false);
    clearTextFilter();
    showList.setActorFilter(actorName);
  }

  private void onShowSelected(Shows.Show show) {
    activeShowName = show.name;
    sendActiveShow();
    for (Pane pane : panes) pane.setShow(show);
    mapPane.closeEpisode();
    // Started as soon as the show is picked, so the trailer pane is usually
    // done waiting by the time the trailer tab is asked for.
    TrailerList.settle(show, () -> trailersView.onTrailersReady(show));
    prefs().edit().putString(KEY_SELECTED_SHOW, show.name).apply();
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

  /** Nothing is focused anywhere; the arrow keys drive the show list itself. */
  private void focusShows() {
    area = Area.SHOWS;
    clearPaneFocus();
    repaintFocus();
  }

  private void focusFilters() {
    area = Area.FILTERS;
    clearPaneFocus();
    if (buttonItems.get(focusedFilter) == null) focusedFilter = FILTER_LABELS[0];
    repaintFocus();
  }

  /**
   * Into the tab pane, onto the first item of the pane already on screen. A
   * pane with nothing to focus cannot be entered at all, so the key does
   * nothing: Info never has anything, and neither has a show with no cast, no
   * trailers, or no episodes.
   */
  private void focusPane() {
    boolean entered = false;
    switch (activeTabIndex) {
      case MAP_TAB_INDEX:
        // A grid still being fetched has nowhere to put the focus yet; the cell
        // focus listener takes the focus in as soon as the grid lands.
        entered = mapPane.requestFocusFirstCell();
        break;
      case ACTORS_TAB_INDEX:
        entered = actorsPane.focusFirstCard();
        break;
      case TRAILER_TAB_INDEX:
        entered = trailersView.focusTopCard();
        break;
    }
    if (!entered) return;
    area = Area.PANE;
    repaintFocus();
  }

  private void moveFilterFocus(int step) {
    int index = -1;
    for (int i = 0; i < FILTER_LABELS.length; i++) {
      if (FILTER_LABELS[i].equals(focusedFilter)) index = i;
    }
    if (index < 0) index = 0;
    // Up/down does not wrap: left and right are the only ways out of the group.
    int next = Math.max(0, Math.min(FILTER_LABELS.length - 1, index + step));
    focusedFilter = FILTER_LABELS[next];
    prefs().edit().putString(KEY_FOCUSED_FILTER, focusedFilter).apply();
    repaintButtons();
  }

  /**
   * Every arrow key, in one place, keyed on the focused area. Each area answers
   * all four directions or deliberately ignores one; nothing falls through to
   * another area's handling.
   */
  private void moveSelection(String direction) {
    boolean up = "up".equals(direction);
    boolean down = "down".equals(direction);
    boolean left = "left".equals(direction);
    boolean right = "right".equals(direction);
    if (!up && !down && !left && !right) return;

    syncAreaToPane();

    switch (area) {
      case SHOWS:
        // Nothing is focused here, so up and down move the selected show
        // itself; the panes catch up once it stops moving. The button column
        // sits to the left of the list and the tab pane to its right.
        if (up) showList.moveSelection(-1);
        else if (down) showList.moveSelection(+1);
        else if (left) focusFilters();
        else focusPane();
        return;

      case FILTERS:
        // The button column is now the leftmost column, so there is nothing
        // further left to go to.
        if (left) return;
        if (right) focusShows();
        else moveFilterFocus(up ? -1 : +1);
        return;

      case PANE:
        movePaneFocus(up, down, left, right);
        return;
    }
  }

  /** The focused item's step inside whichever pane is on screen. */
  private void movePaneFocus(boolean up, boolean down, boolean left, boolean right) {
    switch (activeTabIndex) {
      case MAP_TAB_INDEX:
        // Off the leftmost season column the focus leaves the grid, the way it
        // does off the leftmost actor card; up, down and right only ever move
        // around inside it.
        if (up) mapPane.moveCellFocus(-1, 0);
        else if (down) mapPane.moveCellFocus(+1, 0);
        else if (right) mapPane.moveCellFocus(0, +1);
        else if (!mapPane.moveCellFocus(0, -1)) {
          mapPane.closeEpisode();
          focusShows();
        }
        return;

      case ACTORS_TAB_INDEX:
        if (up) actorsPane.moveCardFocus(-1, 0);
        else if (down) actorsPane.moveCardFocus(+1, 0);
        else if (right) actorsPane.moveCardFocus(0, +1);
        // Off the leftmost card of a row the focus leaves the grid.
        else if (!actorsPane.moveCardFocus(0, -1)) focusShows();
        return;

      case TRAILER_TAB_INDEX:
        // Right is the way in and left the way out; a card grid one column wide
        // has nothing further right to reach.
        if (up) trailersView.moveCardFocus(-1);
        else if (down) trailersView.moveCardFocus(+1);
        else if (left) focusShows();
        return;
    }
  }

  /**
   * A show change rebuilds the cards and cells out from under the focus, so the
   * pane area is only believed while its pane really has something focused;
   * otherwise the focus falls back to the show list, the pane's left neighbor.
   */
  private void syncAreaToPane() {
    if (area != Area.PANE) return;
    boolean lost;
    switch (activeTabIndex) {
      case MAP_TAB_INDEX:
        lost = !mapPane.hasFocusedCell();
        break;
      case ACTORS_TAB_INDEX:
        lost = !actorsPane.hasFocusedCard();
        break;
      case TRAILER_TAB_INDEX:
        lost = !trailersView.hasFocusedCard();
        break;
      default:
        lost = true;
    }
    if (lost) focusShows();
  }

  private void activateSelectedItem() {
    syncAreaToPane();
    switch (area) {
      case SHOWS:
        embyClick();
        return;
      case FILTERS:
        if (CLEAR_FILTER_LABEL.equals(focusedFilter)) clearAllFilters();
        else if (FILTER_INPUT_LABEL.equals(focusedFilter)) sendToPhone(CtrlServer.MSG_OPEN_FILTER);
        else toggleFilter(focusedFilter);
        return;
      case PANE:
        activatePaneItem();
        return;
    }
  }

  private void activatePaneItem() {
    switch (activeTabIndex) {
      case MAP_TAB_INDEX:
        mapPane.toggleFocusedEpisode();
        return;
      case ACTORS_TAB_INDEX:
        actorsPane.activateFocusedCard();
        return;
      case TRAILER_TAB_INDEX:
        trailersView.activateFocusedCard();
        return;
    }
  }

  /**
   * The remote's Info key: one step down the tab group, wrapping. The tab
   * buttons cannot be focused, so this is the only thing that moves them.
   * Whatever was focused loses the focus, since the pane it was in is on its
   * way out, and the show list is what the arrow keys drive after that.
   */
  private void cycleTab() {
    int next = (activeTabIndex + 1) % TAB_LABELS.length;
    selectTab(next);
    focusShows();
    // A show with one trailer has nothing to choose between, so landing on the
    // trailer tab plays it outright; none or several leaves the cards up. After
    // the focus has moved, since dropping the focus out of the trailer pane is
    // also what cancels a play its list has not settled for yet.
    if (next == TRAILER_TAB_INDEX) trailersView.playSoleTrailer();
  }

  private void embyClick() {
    Shows.Show show = showList.getSelected();
    if (show == null) {
      backToEmby();
      return;
    }
    // A focused Map cell names an episode as well as a show, so that is the one
    // Emby opens on -- with or without the episode subpane up, which goes away
    // either way. A cell with no file has nothing to load, and falls back to
    // what this button does everywhere else: the show alone.
    String focusedEpisodeId = null;
    if (area == Area.PANE && activeTabIndex == MAP_TAB_INDEX) {
      focusedEpisodeId = mapPane.focusedEpisodeId();
      mapPane.closeEpisode();
    }
    final String episodeId = focusedEpisodeId;
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
                        // Emby opens on the show, then starts it playing -- the
                        // focused episode when the Map named one, next up otherwise.
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
    ui.post(
        () -> {
          bumpKeepAwake();
          handleRemoteKey(key);
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
          if (customOn) {
            setCustomOn(false);
            showList.setCustomOrder(null);
          }
          actorsPane.clearSelection();
          showList.setActorFilter(null);
          showList.setFilter(text);
        });
  }

  @Override
  public void onSelectShow(String name) {
    ui.post(() -> showList.selectByName(name));
  }

  @Override
  public void onPhoneConnected() {
    ui.post(this::sendActiveShow);
  }

  @Override
  protected void onDestroy() {
    ui.removeCallbacks(clearKeepAwake);
    super.onDestroy();
  }

  /**
   * One level out: a playing trailer, then an open episode subpane, then
   * whichever area has the focus straight back to the show list, and only from
   * the show list does back leave for Emby. The subpane closing is all a back
   * press does -- the focus stays on the cell it was opened from.
   *
   * The web client's Shows button closes tvapp with this same message, so
   * while an area other than the show list has the focus it takes a second
   * press to close -- which is how a playing trailer and an open episode
   * subpane already behaved.
   */
  private void handleBack() {
    if (player.isPlaying()) {
      player.close();
      return;
    }
    if (mapPane.isEpisodeOpen()) {
      mapPane.closeEpisode();
      return;
    }
    switch (area) {
      case PANE:
      case FILTERS:
        focusShows();
        return;
      default:
        backToEmby();
    }
  }

  private void handleRemoteKey(String key) {
    if (player.isPlaying()) {
      // While the video owns the screen the keys are the video's, the way they
      // are in Emby: ok pauses and resumes, left and right seek. The rest are
      // swallowed so they cannot move hidden tvapp focus underneath, and back
      // is what closes the player.
      player.key(key);
      return;
    }
    if ("ok".equals(key)) activateSelectedItem();
    else if ("info".equals(key)) cycleTab();
    else if ("sort".equals(key)) cycleSort();
    else moveSelection(key);
  }

  @Override
  public boolean dispatchKeyEvent(KeyEvent event) {
    String key = remoteKeyFromKeyCode(event.getKeyCode());
    if (key == null) return super.dispatchKeyEvent(event);
    if (event.getAction() == KeyEvent.ACTION_DOWN) {
      bumpKeepAwake();
      if ("back".equals(key)) handleBack();
      else handleRemoteKey(key);
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
