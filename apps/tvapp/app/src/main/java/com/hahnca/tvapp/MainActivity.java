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

  private static final String[] TAB_LABELS = {"Info", "Map", "Actors", "Trailers"};
  private static final String[] FILTER_LABELS = {
    "Ready", "Drama", "Comedy", "To Try", "Continue", "Mark", "Linda", "Trash"
  };
  private static final String SORT_WATCHED = "Watched";
  private static final String SORT_ADDED = "Added";
  private static final String SORT_CUSTOM = "Custom";
  private static final int MAP_TAB_INDEX = 1;

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
  private Pane activePane;
  private TrailerPlayer player;
  private Shows.Sort sort = Shows.Sort.ALPHA;
  private boolean customOn;
  private boolean customAvailable;
  private int activeTabIndex;
  private boolean selectedCard = true;
  private String selectedButton;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    AdbWifi.enable(this);
    setContentView(buildUi());

    showList.setSelectionListener(
        new ShowListView.SelectionListener() {
          @Override
          public void onShowSelected(Shows.Show show) {
            MainActivity.this.onShowSelected(show);
          }

          @Override
          public void onShowClicked() {
            MainActivity.this.onShowActivated();
          }
        });
    sort = Shows.Sort.of(prefs().getString(KEY_SORT, null));
    showList.setSort(sort);
    String remembered = prefs().getString(KEY_SELECTED_SHOW, null);
    Shows.load(
        shows ->
            ui.post(
                () -> {
                  showList.setShows(shows, remembered);
                  if (selectedCard) showList.focusActive();
                }));

    ctrlServer = new CtrlServer(this);
    ctrlServer.start();

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
    TrailersView trailers = new TrailersView(this);
    trailers.setPlayListener(
        url -> {
          sendUnmute();
          player.play(url);
        });
    panes.add(trailers);
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
    repaintButtons();
  }

  private void repaintButtons() {
    for (String label : buttonOrder) {
      ButtonItem item = buttonItems.get(label);
      if (item != null) item.paint(isButtonActive(label), !selectedCard && label.equals(selectedButton));
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

  private void onShowActivated() {
    clearTextFilter();
    actorsPane.clearSelection();
    showList.setActorFilter(null);
    selectTab(0);
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

  private void selectButton(String label) {
    ButtonItem item = buttonItems.get(label);
    if (item == null || item.view.getVisibility() != View.VISIBLE) return;
    selectedCard = false;
    selectedButton = label;
    showList.setCardFocusShown(false);
    repaintButtons();
  }

  private void selectCard() {
    selectedCard = true;
    selectedButton = null;
    showList.setCardFocusShown(true);
    repaintButtons();
  }

  private void moveSelection(String direction) {
    if (selectedCard) {
      if ("up".equals(direction)) {
        showList.moveFocus(-1);
      } else if ("down".equals(direction)) {
        showList.moveFocus(+1);
      } else if ("right".equals(direction)) {
        int y = showList.focusedCenterOnScreen();
        if (y < 0) {
          showList.focusActive();
          y = showList.focusedCenterOnScreen();
        }
        String label = closestButtonToY(y);
        if (label != null) selectButton(label);
      }
      return;
    }

    if ("left".equals(direction)) {
      ButtonItem item = buttonItems.get(selectedButton);
      if (item != null && showList.focusClosestToScreenY(item.centerYOnScreen())) selectCard();
      return;
    }
    if (!"up".equals(direction) && !"down".equals(direction)) return;

    List<String> visible = visibleButtonLabels();
    int index = visible.indexOf(selectedButton);
    if (index < 0) return;
    int next = index + ("up".equals(direction) ? -1 : +1);
    if (next < 0 || next >= visible.size()) return;
    selectButton(visible.get(next));
  }

  private List<String> visibleButtonLabels() {
    List<String> labels = new ArrayList<>();
    for (String label : buttonOrder) {
      ButtonItem item = buttonItems.get(label);
      if (item != null && item.view.getVisibility() == View.VISIBLE) labels.add(label);
    }
    return labels;
  }

  private String closestButtonToY(int screenY) {
    String best = null;
    int bestDistance = Integer.MAX_VALUE;
    for (String label : visibleButtonLabels()) {
      ButtonItem item = buttonItems.get(label);
      int distance = Math.abs(item.centerYOnScreen() - screenY);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = label;
      }
    }
    return best;
  }

  private void activateSelectedItem() {
    if (selectedCard) {
      showList.activateFocused();
      return;
    }
    activateButton(selectedButton);
  }

  private void activateButton(String label) {
    for (int i = 0; i < TAB_LABELS.length; i++) {
      if (TAB_LABELS[i].equals(label)) {
        selectTab(i);
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
              ui.post(this::finishAndRemoveTask);
            },
            "viewshow")
        .start();
  }

  private void backToEmby() {
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
          if (player.isPlaying()) {
            if ("ok".equals(key)) player.close();
            return;
          }
          if ("ok".equals(key)) activateSelectedItem();
          else moveSelection(key);
        });
  }

  @Override
  public void onBackToEmby() {
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
          if (selectedCard) showList.focusActive();
        });
  }

  @Override
  public void onSelectShow(String name) {
    ui.post(
        () -> {
          showList.selectByName(name);
          if (selectedCard) showList.focusActive();
        });
  }

  @Override
  protected void onDestroy() {
    ui.removeCallbacks(clearKeepAwake);
    ctrlServer.shutdown();
    sharedFilters.stop();
    super.onDestroy();
  }

  @Override
  public boolean onKeyDown(int keyCode, KeyEvent event) {
    if (keyCode == KeyEvent.KEYCODE_BACK) {
      if (player.isPlaying()) player.close();
      else if (mapPane.isEpisodeOpen()) mapPane.closeEpisode();
      else backToEmby();
      return true;
    }
    return super.onKeyDown(keyCode, event);
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

    int centerYOnScreen() {
      int[] pos = new int[2];
      view.getLocationOnScreen(pos);
      return pos[1] + view.getHeight() / 2;
    }
  }
}
