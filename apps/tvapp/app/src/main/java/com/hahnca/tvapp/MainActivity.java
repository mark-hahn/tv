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
  private static final String[] FILTER_LABELS = {
    "Ready", "Drama", "Comedy", "To Try", "Continue", "Mark", "Linda", "Trash"
  };
  private static final String SORT_WATCHED = "Watched";
  private static final String SORT_ADDED = "Added";
  private static final String SORT_CUSTOM = "Custom";
  private static final int MAP_TAB_INDEX = 1;
  private static final int TRAILER_TAB_INDEX = 3;

  private static final float BUTTON_TEXT_SIZE_SP = 12.5f;
  private static final float BUTTON_HEIGHT_DP = 25.0f;
  private static final float BUTTON_MARGIN_BOTTOM_DP = 6.0f;
  private static final float BUTTON_GROUP_GAP_DP = BUTTON_HEIGHT_DP / 2f;
  private static final float BUTTON_PAD_H_DP = 8f;
  private static final float BUTTON_CORNER_DP = 6f;
  private static final float BUTTON_SELECTED_BORDER_DP = 3f;
  private static final int BUTTON_ACTIVE_BG = 0xFF0A4A8A;
  private static final int BUTTON_INACTIVE_BG = 0xFFFFFFFF;
  private static final int BUTTON_ACTIVE_TEXT = 0xFFFFFFFF;
  private static final int BUTTON_INACTIVE_TEXT = 0xFF000000;
  private static final int BUTTON_SELECTED_BORDER = 0xFFFF0000;

  private static final String PREFS_NAME = "tvapp";
  private static final String KEY_SELECTED_SHOW = "selectedShow";
  private static final String KEY_SORT = "sort";

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
  private SharedFilters sharedFilters;
  private ShowListView showList;
  private InfoView info;
  private MapPane mapPane;
  private ActorsView actorsPane;
  private TrailersView trailersView;
  private Pane activePane;
  private TrailerPlayer player;
  private Shows.Sort sort = Shows.Sort.ALPHA;
  private boolean customOn;
  private boolean customAvailable;
  private int activeTabIndex;
  private Cursor cursor = Cursor.SHOW;
  private String selectedButton;
  private long showsLoadedAt;

  /**
   * The one place the cursor is. It used to be two booleans that had to be kept
   * agreeing with each other, and every arrow-key bug in the trailer column came
   * from a path that set one and not the other -- the cursor reading as being on
   * a trailer card while it was drawn on the trailer button, where up/down/right
   * then did nothing. One field cannot disagree with itself.
   */
  private enum Cursor {
    SHOW,
    BUTTON,
    TRAILER_CARD
  }

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
        count -> {
          if (ctrlServer != null) ctrlServer.send(CtrlServer.MSG_COUNTS + "," + count);
        });
    // A filter/sort change that empties the list leaves nothing in the show
    // column for the cursor to sit on, so it moves over to the button column
    // -- back to whichever button was selected last, or Info if none yet.
    showList.setEmptyListener(
        () -> {
          if (cursor == Cursor.SHOW) {
            selectButton(selectedButton != null ? selectedButton : TAB_LABELS[0]);
          }
        });

    loadShows(remembered);

    sharedFilters =
        new SharedFilters(
            has ->
                ui.post(
                    () -> {
                      setCustomAvailable(has);
                      if (!has) {
                        setCustomOn(false);
                        showList.setCustomOrder(null);
                      }
                    }));
    sharedFilters.start();
  }

  private void loadShows(String selectedName) {
    Shows.load(
        shows ->
            ui.post(
                () -> {
                  showsLoadedAt = System.currentTimeMillis();
                  showList.setShows(shows, selectedName);
                  if (cursor == Cursor.SHOW) showList.focusActive();
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
    columns.addView(buildList(), column(LIST_WIDTH_FRACTION, 0));
    columns.addView(buildButtonColumn(), column(BUTTONS_WIDTH_FRACTION, dp(COLUMN_GAP_DP)));
    columns.addView(buildPanes(), column(PANE_WIDTH_FRACTION, dp(COLUMN_GAP_DP)));
    root.addView(columns, matchParent());

    player = new TrailerPlayer(this);
    root.addView(player, matchParent());
    return root;
  }

  private View buildList() {
    showList = new ShowListView(this);
    return showList;
  }

  private View buildButtonColumn() {
    LinearLayout column = new LinearLayout(this);
    column.setOrientation(LinearLayout.VERTICAL);
    column.setPadding((int) dp(BUTTON_PAD_H_DP), 0, (int) dp(BUTTON_PAD_H_DP), 0);

    addGroup(column, TAB_LABELS);
    addGroup(column, FILTER_LABELS);
    addGroup(column, new String[] {SORT_WATCHED, SORT_ADDED, SORT_CUSTOM});
    buttonItems.get(SORT_CUSTOM).view.setVisibility(View.GONE);
    repaintButtons();
    return column;
  }

  private void addGroup(LinearLayout column, String[] labels) {
    boolean firstGroup = buttonOrder.isEmpty();
    for (int i = 0; i < labels.length; i++) {
      float topMargin;
      if (firstGroup && i == 0) {
        topMargin = 0;
      } else if (i == 0) {
        topMargin = BUTTON_GROUP_GAP_DP;
      } else {
        topMargin = 0;
      }
      addButtonItem(column, labels[i], topMargin);
    }
  }

  private void addButtonItem(LinearLayout column, String label, float topMarginDp) {
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

    ButtonItem item = new ButtonItem(label, view);
    buttonItems.put(label, item);
    buttonOrder.add(label);

    LinearLayout.LayoutParams params =
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (int) dp(BUTTON_HEIGHT_DP));
    params.topMargin = (int) dp(topMarginDp);
    params.bottomMargin = (int) dp(BUTTON_MARGIN_BOTTOM_DP);
    column.addView(view, params);
  }

  private View buildPanes() {
    FrameLayout holder = new FrameLayout(this);
    info = new InfoView(this);
    panes.add(info);
    mapPane = new MapPane(this);
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
    if (index != TRAILER_TAB_INDEX) {
      trailersView.clearCardFocus();
      if (cursor == Cursor.TRAILER_CARD) cursor = Cursor.BUTTON;
    }
    repaintButtons();
  }

  private void repaintButtons() {
    for (String label : buttonOrder) {
      ButtonItem item = buttonItems.get(label);
      if (item != null) {
        item.paint(
            isButtonActive(label),
            cursor == Cursor.BUTTON && label.equals(selectedButton));
      }
    }
  }

  private boolean isButtonActive(String label) {
    for (int i = 0; i < TAB_LABELS.length; i++) {
      if (TAB_LABELS[i].equals(label)) return activeTabIndex == i;
    }
    if (activeFilters.contains(label)) return true;
    if (SORT_WATCHED.equals(label)) return !customOn && sort == Shows.Sort.WATCHING;
    if (SORT_ADDED.equals(label)) return !customOn && sort == Shows.Sort.ADDED;
    if (SORT_CUSTOM.equals(label)) return customOn;
    return false;
  }

  private void setCustomAvailable(boolean available) {
    customAvailable = available;
    ButtonItem custom = buttonItems.get(SORT_CUSTOM);
    if (custom != null) custom.view.setVisibility(available ? View.VISIBLE : View.GONE);
    if (!available && SORT_CUSTOM.equals(selectedButton)) selectButton(SORT_ADDED);
    repaintButtons();
  }

  private void sortClick(Shows.Sort clicked) {
    Shows.Sort next = !customOn && clicked == sort ? Shows.Sort.ALPHA : clicked;
    if (customOn) {
      setCustomOn(false);
      showList.setCustomOrder(null);
      clearTextFilter();
    }
    applySort(next);
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

  private void customClick() {
    if (!customAvailable) return;
    if (customOn) {
      setCustomOn(false);
      showList.setCustomOrder(null);
      clearTextFilter();
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

  private void clearTextFilter() {
    showList.setFilter("");
    ctrlServer.send(CtrlServer.MSG_CLEAR_FILTER);
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
    for (Pane pane : panes) pane.setShow(show);
    mapPane.closeEpisode();
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

  /**
   * Mirrors the show list's dwell-select: the cursor landing on a button does
   * not activate it immediately -- only sitting still on it for
   * ShowListView.DWELL_SELECT_MS does, so arrow-key repeat while scrubbing
   * through the button column does not fire every button it passes over.
   */
  private void selectButton(String label) {
    selectButton(label, true);
  }

  /**
   * dwell false just parks the cursor on the button. That is the way back from
   * the trailer cards: the trailer button is already the active tab, and
   * re-activating it would start the lone trailer playing all over again.
   */
  private void selectButton(String label, boolean dwell) {
    ButtonItem item = buttonItems.get(label);
    if (item == null || item.view.getVisibility() != View.VISIBLE) return;
    cursor = Cursor.BUTTON;
    trailersView.clearCardFocus();
    selectedButton = label;
    showList.setCardFocusShown(false);
    repaintButtons();
    ui.removeCallbacks(buttonDwellActivate);
    if (dwell) ui.postDelayed(buttonDwellActivate, ShowListView.DWELL_SELECT_MS);
  }

  private final Runnable buttonDwellActivate =
      () -> {
        if (cursor == Cursor.BUTTON && selectedButton != null) activateButton(selectedButton);
      };

  private void selectShow() {
    cursor = Cursor.SHOW;
    trailersView.clearCardFocus();
    ui.removeCallbacks(buttonDwellActivate);
    showList.setCardFocusShown(true);
    repaintButtons();
  }

  /**
   * Every arrow key, in one place, keyed on where the cursor is. Each state
   * answers all four directions or deliberately ignores one; nothing falls
   * through to another state's handling.
   */
  private void moveSelection(String direction) {
    boolean up = "up".equals(direction);
    boolean down = "down".equals(direction);
    boolean left = "left".equals(direction);
    boolean right = "right".equals(direction);
    if (!up && !down && !left && !right) return;

    // A show change rebuilds the trailer cards out from under the cursor, so
    // the card state is only believed while a card is really focused.
    if (cursor == Cursor.TRAILER_CARD && !trailersView.hasFocusedCard()) {
      selectButton(TAB_LABELS[TRAILER_TAB_INDEX], false);
    }

    switch (cursor) {
      case SHOW:
        if (up) showList.moveFocus(-1);
        else if (down) showList.moveFocus(+1);
        else if (left) embyClick();
        else selectButton(selectedButton != null ? selectedButton : TAB_LABELS[0]);
        return;

      case BUTTON:
        if (left) {
          showList.focusActive();
          selectShow();
        } else if (right) {
          enterTrailerCards();
        } else {
          moveButton(up ? -1 : +1);
        }
        return;

      case TRAILER_CARD:
        // Right is the way in and left the way out; a card grid one column wide
        // has nothing further right to reach.
        if (up) trailersView.moveCardFocus(-1);
        else if (down) trailersView.moveCardFocus(+1);
        else if (left) selectButton(TAB_LABELS[TRAILER_TAB_INDEX], false);
        return;
    }
  }

  private void moveButton(int step) {
    List<String> visible = visibleButtonLabels();
    int index = visible.indexOf(selectedButton);
    if (index < 0) return;
    int next = index + step;
    if (next < 0 || next >= visible.size()) return;
    selectButton(visible.get(next));
  }

  /**
   * Right from the trailer button, the only button with anywhere to go right
   * to. Any other button ignores right, and so does the trailer button when
   * the show has no trailers to put a cursor on.
   */
  private void enterTrailerCards() {
    if (!TAB_LABELS[TRAILER_TAB_INDEX].equals(selectedButton)) return;
    Shows.Show show = showList.getSelected();
    if (show == null || show.trailers.isEmpty()) return;
    ui.removeCallbacks(buttonDwellActivate);
    // The cards only exist once the pane has been filled, which is what being
    // shown does; playing is activateButton's job, so this never starts one.
    if (activeTabIndex != TRAILER_TAB_INDEX) selectTab(TRAILER_TAB_INDEX);
    if (!trailersView.focusTopCard()) return;
    cursor = Cursor.TRAILER_CARD;
    repaintButtons();
  }

  private List<String> visibleButtonLabels() {
    List<String> labels = new ArrayList<>();
    for (String label : buttonOrder) {
      ButtonItem item = buttonItems.get(label);
      if (item != null && item.view.getVisibility() == View.VISIBLE) labels.add(label);
    }
    return labels;
  }

  private void activateSelectedItem() {
    if (cursor == Cursor.TRAILER_CARD && !trailersView.hasFocusedCard()) {
      selectButton(TAB_LABELS[TRAILER_TAB_INDEX], false);
    }
    switch (cursor) {
      case SHOW:
        embyClick();
        return;
      case TRAILER_CARD:
        trailersView.activateFocusedCard();
        return;
      case BUTTON:
        ui.removeCallbacks(buttonDwellActivate);
        activateButton(selectedButton, true);
        return;
    }
  }

  private void activateButton(String label) {
    activateButton(label, false);
  }

  /**
   * fromOk separates a real ok press from the dwell that fires whenever the
   * cursor rests on a button. It only matters to the trailer button: a show
   * with one trailer plays it on activation, and the dwell re-activating the
   * tab the cursor is already sitting on would restart that video every time,
   * leaving the player up to swallow the arrow keys. So the dwell plays only
   * when it is what made the tab active -- ok always replays.
   */
  private void activateButton(String label, boolean fromOk) {
    for (int i = 0; i < TAB_LABELS.length; i++) {
      if (TAB_LABELS[i].equals(label)) {
        boolean wasActive = activeTabIndex == i;
        selectTab(i);
        // A show with one trailer has nothing to choose between, so activating
        // the button plays it outright; none or several leaves the cards up.
        if (i == TRAILER_TAB_INDEX && (fromOk || !wasActive)) trailersView.playSoleTrailer();
        return;
      }
    }
    for (String filter : FILTER_LABELS) {
      if (filter.equals(label)) {
        toggleFilter(label);
        return;
      }
    }
    if (SORT_WATCHED.equals(label)) sortClick(Shows.Sort.WATCHING);
    else if (SORT_ADDED.equals(label)) sortClick(Shows.Sort.ADDED);
    else if (SORT_CUSTOM.equals(label)) customClick();
  }

  private void embyClick() {
    Shows.Show show = showList.getSelected();
    if (show == null) {
      backToEmby();
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
                        + URLEncoder.encode(show.name, "UTF-8");
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
          if (cursor == Cursor.SHOW) showList.focusActive();
        });
  }

  @Override
  public void onSelectShow(String name) {
    ui.post(
        () -> {
          showList.selectByName(name);
          if (cursor == Cursor.SHOW) showList.focusActive();
        });
  }

  @Override
  protected void onDestroy() {
    ui.removeCallbacks(clearKeepAwake);
    ui.removeCallbacks(buttonDwellActivate);
    sharedFilters.stop();
    super.onDestroy();
  }

  private void handleBack() {
    if (player.isPlaying()) player.close();
    else if (mapPane.isEpisodeOpen()) mapPane.closeEpisode();
    else backToEmby();
  }

  private void handleRemoteKey(String key) {
    if (player.isPlaying()) {
      // While the video owns the screen, OK closes it and arrows are swallowed
      // so they cannot move hidden tvapp focus underneath.
      if ("ok".equals(key)) player.close();
      return;
    }
    if ("ok".equals(key)) activateSelectedItem();
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
