package com.hahnca.tvapp;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewParent;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The Map tab: the season by episode grid, seasons across and episode numbers
 * down, each cell saying whether the episode is watched, on disk, and at what
 * quality — the web client's map and the phone remote's, with the same letters
 * and the same two cell colours.
 *
 * Both headers stay put: the season row is fixed to the top of the pane and the
 * episode-number column to its left edge, so a grid scrolled far down or far
 * across can still be read. That is what the four nested scroll views are for —
 * the grid is the only one the user drives, and its scroll position is copied
 * to the header row (sideways) and the episode column (down).
 *
 * Season columns are a fixed width, so past the dozen that fit at a legible
 * width the grid runs off the side and the pane scrolls sideways to reach the
 * rest.
 */
class MapView extends LinearLayout implements Pane {

  private static final String SERIES_MAP_URL =
      "https://hahnca.com/tv-srvr/api/getSeriesMapFromEmby";
  private static final String TAG = "tvapp";
  private static final float ROW_HEIGHT_DP = 34f;
  private static final float EPISODE_COL_WIDTH_DP = 40f;
  private static final float CELL_TEXT_SIZE_SP = 13.5f;
  private static final int CELL_AVAIL_BG = 0xFFFFFFFF;
  private static final int CELL_MISSING_BG = 0xFFFFCCCC;
  // The cursor is the red border it is on every other item in tvapp, drawn by
  // widening the cell's own margin over a red holder instead of the black one
  // that makes the grid lines. The cell keeps its size either way, so nothing
  // in the grid moves as the cursor passes through.
  private static final int CELL_FOCUS_BORDER = 0xFFFF0000;
  private static final float CELL_FOCUS_BORDER_DP = 3f;
  private static final int CELL_TEXT_COLOR = 0xFF000000;
  private static final int GRID_LINE = 0xFF000000;
  private static final float GRID_LINE_DP = 1f;
  // Shallower than the show list's, so the tighter grid rows lose less of
  // themselves to the fade.
  private static final float MAP_FADE_V_DP = EdgeFade.HEIGHT_DP * 0.5f;
  // Narrower again sideways: a season column is much narrower than a row is
  // tall, so the same depth would swallow more of the grid going across.
  private static final float MAP_FADE_H_DP = MAP_FADE_V_DP * 0.8f;

  /** An episode cell was clicked: opens the episode subpane in MainActivity. */
  interface EpisodeClickListener {
    void onEpisodeClicked(String showName, int season, int episode);
  }

  /**
   * A cell took the cursor after the grid it belongs to had to be waited for.
   * The grid is fetched, so the right-arrow that moves the cursor in here can
   * land before there is anything to land on.
   */
  interface CellFocusListener {
    void onCellFocused();
  }

  private final Handler ui = new Handler(Looper.getMainLooper());

  private final LinearLayout headerBar;
  private final LinearLayout headerRow;
  private final HorizontalScrollView headerAcross;
  private final LinearLayout body;
  private final LinearLayout episodeColumn;
  private final ScrollView episodeDown;
  private final LinearLayout gridColumn;
  private final HorizontalScrollView gridAcross;
  private final ScrollView gridDown;
  private final TextView message;

  private EpisodeClickListener episodeClickListener;
  private CellFocusListener cellFocusListener;
  private String showName;
  private Shows.Show show;
  private Shows.Show filled;

  // The grid as built, so the cursor can be moved around it and the focused
  // episode named: cell views and cell data indexed the same way, [episode -
  // 1][season across]. Every row holds one view per season, blank where that
  // season has no such episode number.
  private final List<List<TextView>> cellViews = new ArrayList<>();
  private final List<List<Cell>> cellGrid = new ArrayList<>();
  private final List<Integer> cellSeasons = new ArrayList<>();
  private int focusRow = -1;
  private int focusCol = -1;
  private boolean gridBuilt;
  private boolean focusFirstWhenReady;
  private int cellColumnWidth = (int) dp(44f); // default, updated by show()

  void setEpisodeClickListener(EpisodeClickListener listener) {
    this.episodeClickListener = listener;
  }

  void setCellFocusListener(CellFocusListener listener) {
    this.cellFocusListener = listener;
  }

  /** One cell of the grid, or null where a season has no such episode. */
  private static class Cell {
    final boolean played;
    final boolean avail;
    final boolean unaired;
    final int quality;
    final boolean noFile;
    final String id; // Emby's, for loading this very episode rather than the show

    Cell(JSONObject node) {
      played = node.optBoolean("played", false);
      avail = node.optBoolean("avail", false);
      unaired = node.optBoolean("unaired", false);
      quality = node.optInt("quality", 0);
      noFile = node.optBoolean("noFile", false);
      id = node.isNull("id") ? null : node.optString("id", null);
    }
  }

  MapView(Context context) {
    super(context);
    setOrientation(VERTICAL);
    int pad = (int) dp(ScrollPane.PAD_DP);
    setPadding(pad, pad, pad, pad);

    headerRow = new LinearLayout(context);
    headerRow.setOrientation(HORIZONTAL);
    headerAcross = new SlaveHorizontalScrollView(context);
    headerAcross.addView(
        headerRow,
        new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.MATCH_PARENT));

    headerBar = new LinearLayout(context);
    headerBar.setOrientation(HORIZONTAL);
    headerBar.addView(label("", Color.WHITE), episodeColumnParams());
    headerBar.addView(
        headerAcross,
        new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f));
    addView(
        headerBar,
        new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, (int) dp(ROW_HEIGHT_DP)));

    episodeColumn = new LinearLayout(context);
    episodeColumn.setOrientation(VERTICAL);
    episodeDown = new SlaveScrollView(context);
    episodeDown.addView(
        episodeColumn,
        new ScrollView.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

    gridColumn = new LinearLayout(context);
    gridColumn.setOrientation(VERTICAL);
    gridAcross = new GridHorizontalScrollView(context);
    gridAcross.setHorizontalScrollBarEnabled(false);
    gridAcross.addView(
        gridColumn,
        new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    gridDown = new GridScrollView(context);
    gridDown.setVerticalScrollBarEnabled(false);
    gridDown.addView(
        gridAcross,
        new ScrollView.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

    body = new LinearLayout(context);
    body.setOrientation(HORIZONTAL);
    body.addView(
        episodeDown,
        new LinearLayout.LayoutParams(
            (int) dp(EPISODE_COL_WIDTH_DP), ViewGroup.LayoutParams.MATCH_PARENT));
    body.addView(
        gridDown, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f));
    addView(
        body,
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

    message = text("", ScrollPane.TEXT_SIZE_SP, ScrollPane.DIM_COLOR);
    message.setVisibility(GONE);
    addView(
        message,
        new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

    // On the column, not on the ScrollView: a ScrollView eats the touch itself
    // and never gets as far as performClick.
    gridColumn.setOnClickListener(v -> scrollToStart());
  }

  /**
   * The grid's scroll is the one the user drives; the headers follow it. The
   * edge fade is drawn here only, so it covers the table without touching the
   * episode numbers scrolling alongside it.
   */
  private class GridScrollView extends ScrollView {
    private final EdgeFade edgeFade = EdgeFade.vertical(this, MAP_FADE_V_DP);

    GridScrollView(Context context) {
      super(context);
    }

    @Override
    protected void onScrollChanged(int l, int t, int oldl, int oldt) {
      super.onScrollChanged(l, t, oldl, oldt);
      episodeDown.scrollTo(0, t);
      invalidate();
    }

    @Override
    protected void onSizeChanged(int w, int h, int oldw, int oldh) {
      super.onSizeChanged(w, h, oldw, oldh);
      edgeFade.resize(h);
    }

    @Override
    protected void dispatchDraw(Canvas canvas) {
      super.dispatchDraw(canvas);
      edgeFade.draw(canvas);
    }
  }

  /**
   * A header scroll view: driven only by the grid, never by touch. Carries no
   * edge fade -- the episode and season numbers are how you read the grid, so
   * they stay legible while the table they label is what fades away.
   */
  private class SlaveScrollView extends ScrollView {
    SlaveScrollView(Context context) {
      super(context);
      setVerticalScrollBarEnabled(false);
    }

    @Override
    public boolean onTouchEvent(MotionEvent event) {
      return false;
    }

    @Override
    public boolean onInterceptTouchEvent(MotionEvent event) {
      return false;
    }
  }

  private class SlaveHorizontalScrollView extends HorizontalScrollView {
    SlaveHorizontalScrollView(Context context) {
      super(context);
      setHorizontalScrollBarEnabled(false);
    }

    @Override
    public boolean onTouchEvent(MotionEvent event) {
      return false;
    }

    @Override
    public boolean onInterceptTouchEvent(MotionEvent event) {
      return false;
    }
  }

  /**
   * The grid's sideways scroll: the one the user drives, fading at both its
   * left and right edges where seasons run off past the table.
   */
  private class GridHorizontalScrollView extends HorizontalScrollView {
    private final EdgeFade edgeFade = EdgeFade.horizontal(this, MAP_FADE_H_DP);

    GridHorizontalScrollView(Context context) {
      super(context);
    }

    @Override
    protected void onScrollChanged(int l, int t, int oldl, int oldt) {
      super.onScrollChanged(l, t, oldl, oldt);
      invalidate();
    }

    @Override
    protected void onSizeChanged(int w, int h, int oldw, int oldh) {
      super.onSizeChanged(w, h, oldw, oldh);
      edgeFade.resize(w);
    }

    @Override
    protected void dispatchDraw(Canvas canvas) {
      super.dispatchDraw(canvas);
      edgeFade.draw(canvas);
    }
  }

  @Override
  public void setShow(Shows.Show show) {
    this.show = show;
    if (getVisibility() == VISIBLE) refill();
  }

  @Override
  public void onShown() {
    refill();
  }

  @Override
  public View asView() {
    return this;
  }

  @Override
  public void scrollStep(int px) {
    gridDown.scrollBy(0, px);
  }

  @Override
  public void scrollStepX(int px) {
    gridAcross.scrollBy(px, 0);
    headerAcross.scrollTo(gridAcross.getScrollX(), 0);
  }

  /** Back to the top, and to the far left. */
  void scrollToStart() {
    gridDown.smoothScrollTo(0, 0);
    gridAcross.smoothScrollTo(0, 0);
    headerAcross.scrollTo(0, 0);
  }

  /**
   * Called when the cursor can no longer step down within its own column --
   * its season has run out of episodes -- but the table can still run on
   * beneath it for other, longer seasons. Scrolls all the way to the bottom
   * so the rest of the table is visible even though the cursor stays put.
   */
  void scrollToBottom() {
    gridDown.fullScroll(View.FOCUS_DOWN);
  }

  private void refill() {
    if (show == filled) return;
    filled = show;
    clearGrid();
    clearRows();
    gridDown.scrollTo(0, 0);
    gridAcross.scrollTo(0, 0);
    headerAcross.scrollTo(0, 0);
    if (show != null) fill(show);
  }

  /** True while the given show is still the one this pane is filled with. */
  private boolean isCurrent(Shows.Show show) {
    return show == filled;
  }

  private void fill(Shows.Show show) {
    showName = show.name;
    gridBuilt = false;
    clearGrid();
    addMessage("Loading…");
    new Thread(
            () -> {
              List<Integer> seasons = new ArrayList<>();
              List<List<Cell>> grid = new ArrayList<>(); // [episode][season]
              String error = null;
              try {
                // stale: the cached episodeData, which the server builds without
                // touching Emby or the disk. This pane only reads it.
                String body =
                    Http.postJson(
                        SERIES_MAP_URL,
                        new JSONObject()
                            .put("showName", show.name)
                            .put("stale", true)
                            .toString());
                error = parse(body, seasons, grid);
              } catch (Exception e) {
                error = e.getMessage();
                Log.e(TAG, "series map load failed for " + show.name + ": " + e);
              }
              final String failure = error;
              ui.post(
                  () -> {
                    if (!isCurrent(show)) return; // another show owns the pane
                    show(seasons, grid, failure);
                  });
            },
            "series-map")
        .start();
  }

  private void show(List<Integer> seasons, List<List<Cell>> grid, String error) {
    clearRows();
    clearGrid();
    if (seasons.isEmpty()) {
      gridBuilt = true;
      focusFirstWhenReady = false;
      addMessage(error == null ? "No episodes." : "No map: " + error);
      return;
    }

    // Calculate column width from the available pane width.
    // Tabs divide equally, so half a tab's width = paneWidth / 8.
    // Emby and Exit buttons plus gaps take ~200dp, so subtract that first.
    float paneWidth = getWidth();
    if (paneWidth <= 0) {
      // Layout hasn't happened yet; use a post to defer.
      ui.post(() -> show(seasons, grid, error));
      return;
    }
    float buttonRowWidth = paneWidth;
    float buttonFixedAndGaps = dp(200f); // rough estimate for Emby, Exit, gaps
    float availForTabs = Math.max(buttonRowWidth - buttonFixedAndGaps, buttonRowWidth * 0.6f);
    float perTab = availForTabs / 4;
    float halfTab = perTab / 2;
    cellColumnWidth = (int) halfTab;

    showGrid();
    for (int season : seasons) {
      headerRow.addView(label("S" + season, Color.WHITE), cellColumnParams());
    }

    cellSeasons.addAll(seasons);
    for (int episode = 1; episode <= grid.size(); episode++) {
      List<Cell> cells = grid.get(episode - 1);
      episodeColumn.addView(
          label(String.valueOf(episode), ScrollPane.DIM_COLOR), episodeColumnParams());
      LinearLayout line = row();
      List<TextView> rowViews = new ArrayList<>();
      for (int i = 0; i < seasons.size(); i++) {
        Cell cell = i < cells.size() ? cells.get(i) : null;
        ViewGroup holder = cell(cell, seasons.get(i), episode);
        rowViews.add((TextView) holder.getChildAt(0));
        line.addView(holder, cellColumnParams());
      }
      cellViews.add(rowViews);
      cellGrid.add(cells);
      gridColumn.addView(
          line,
          new LinearLayout.LayoutParams(
              ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    }
    gridBuilt = true;
    // The cursor was moved in here while this was still being fetched.
    if (focusFirstWhenReady) {
      focusFirstWhenReady = false;
      if (focusFirstCell() && cellFocusListener != null) cellFocusListener.onCellFocused();
    }
  }

  /**
   * Puts the cursor on the first episode, now if the grid is up and as soon as
   * it lands if it is not. False either way means the cursor has not moved --
   * on a grid still loading the listener says when it has.
   */
  boolean requestFocusFirstCell() {
    if (focusFirstCell()) return true;
    focusFirstWhenReady = !gridBuilt;
    return false;
  }

  void clearCellFocus() {
    focusFirstWhenReady = false;
    if (focusRow < 0) return;
    int row = focusRow;
    int col = focusCol;
    focusRow = -1;
    focusCol = -1;
    paintCell(row, col);
  }

  boolean hasFocusedCell() {
    return focusRow >= 0 && focusRow < cellViews.size();
  }

  /**
   * One step through the grid, over any blank cell in the way -- a season with
   * no such episode number is not an episode and cannot hold the cursor. False
   * when that direction runs off the edge, which leaves the cursor put.
   */
  boolean moveCellFocus(int rowStep, int colStep) {
    if (!hasFocusedCell()) return false;
    int row = focusRow;
    int col = focusCol;
    while (true) {
      row += rowStep;
      col += colStep;
      if (row < 0 || row >= cellViews.size()) return false;
      if (col < 0 || col >= cellViews.get(row).size()) return false;
      if (cellAt(row, col) != null) {
        setCellFocus(row, col);
        return true;
      }
    }
  }

  String focusedShowName() {
    return showName;
  }

  int focusedSeason() {
    return hasFocusedCell() ? cellSeasons.get(focusCol) : -1;
  }

  int focusedEpisode() {
    return hasFocusedCell() ? focusRow + 1 : -1;
  }

  /** Null when the focused episode has no file, so there is nothing to load. */
  String focusedEpisodeId() {
    if (!hasFocusedCell()) return null;
    Cell cell = cellAt(focusRow, focusCol);
    if (cell == null || cell.noFile || !cell.avail) return null;
    return cell.id;
  }

  private boolean focusFirstCell() {
    for (int row = 0; row < cellViews.size(); row++) {
      for (int col = 0; col < cellViews.get(row).size(); col++) {
        if (cellAt(row, col) != null) {
          setCellFocus(row, col);
          return true;
        }
      }
    }
    return false;
  }

  private void setCellFocus(int row, int col) {
    int oldRow = focusRow;
    int oldCol = focusCol;
    focusRow = row;
    focusCol = col;
    if (oldRow >= 0) paintCell(oldRow, oldCol);
    paintCell(row, col);
    ensureVisible(cellViews.get(row).get(col));
  }

  private void paintCell(int row, int col) {
    if (row >= cellViews.size() || col >= cellViews.get(row).size()) return;
    Cell cell = cellAt(row, col);
    boolean focused = row == focusRow && col == focusCol;
    TextView view = cellViews.get(row).get(col);
    view.setBackgroundColor(cell == null || cell.avail ? CELL_AVAIL_BG : CELL_MISSING_BG);
    View holder = (View) view.getParent();
    holder.setBackgroundColor(focused ? CELL_FOCUS_BORDER : GRID_LINE);
    int inset = (int) dp(focused ? CELL_FOCUS_BORDER_DP : GRID_LINE_DP);
    LinearLayout.LayoutParams params = (LinearLayout.LayoutParams) view.getLayoutParams();
    params.setMargins(inset, inset, inset, inset);
    view.setLayoutParams(params);
  }

  private Cell cellAt(int row, int col) {
    List<Cell> cells = cellGrid.get(row);
    return col < cells.size() ? cells.get(col) : null;
  }

  private void clearGrid() {
    cellViews.clear();
    cellGrid.clear();
    cellSeasons.clear();
    focusRow = -1;
    focusCol = -1;
  }

  /** Everything the grid is drawn out of, headers included. */
  private void clearRows() {
    headerRow.removeAllViews();
    episodeColumn.removeAllViews();
    gridColumn.removeAllViews();
  }

  /**
   * Scrolls only as far as needed to bring a cell fully into view -- how the
   * arrow-key cursor follows itself around a grid taller, and wider, than the
   * pane showing it. Posted, because the row the cursor just moved to may not
   * have been laid out yet.
   */
  private void ensureVisible(View child) {
    post(
        () -> {
          // Layout positions are relative to the parent and unaffected by
          // scrolling, so adding them up to the grid column gives the content
          // coordinates that getScrollY/getScrollX are measured in.
          int top = 0;
          int left = 0;
          View view = child;
          while (view != null && view != gridColumn) {
            top += view.getTop();
            left += view.getLeft();
            ViewParent parent = view.getParent();
            view = parent instanceof View ? (View) parent : null;
          }
          int bottom = top + child.getHeight();
          // The edge fade counts as out of view, or the cursor could stop under
          // it and have its own cell dimmed.
          int fadeV = (int) dp(MAP_FADE_V_DP);
          if (top - fadeV < gridDown.getScrollY()) gridDown.scrollTo(0, top - fadeV);
          else if (bottom + fadeV > gridDown.getScrollY() + gridDown.getHeight()) {
            gridDown.scrollTo(0, bottom + fadeV - gridDown.getHeight());
          }
          int right = left + child.getWidth();
          int fadeH = (int) dp(MAP_FADE_H_DP);
          if (left - fadeH < gridAcross.getScrollX()) gridAcross.scrollTo(left - fadeH, 0);
          else if (right + fadeH > gridAcross.getScrollX() + gridAcross.getWidth()) {
            gridAcross.scrollTo(right + fadeH - gridAcross.getWidth(), 0);
          }
          headerAcross.scrollTo(gridAcross.getScrollX(), 0);
        });
  }

  /** The message replaces the whole grid, headers and all. */
  private void addMessage(String text) {
    clearRows();
    message.setText(text);
    message.setVisibility(VISIBLE);
    headerBar.setVisibility(GONE);
    body.setVisibility(GONE);
  }

  private void showGrid() {
    message.setVisibility(GONE);
    headerBar.setVisibility(VISIBLE);
    body.setVisibility(VISIBLE);
  }

  private LinearLayout row() {
    LinearLayout row = new LinearLayout(getContext());
    row.setOrientation(LinearLayout.HORIZONTAL);
    return row;
  }

  private LinearLayout.LayoutParams episodeColumnParams() {
    return new LinearLayout.LayoutParams(
        (int) dp(EPISODE_COL_WIDTH_DP), (int) dp(ROW_HEIGHT_DP));
  }

  private LinearLayout.LayoutParams cellColumnParams() {
    // Fixed width at half a tab button's width, no weight expansion.
    return new LinearLayout.LayoutParams(cellColumnWidth, (int) dp(ROW_HEIGHT_DP));
  }

  private TextView label(String value, int color) {
    TextView view = new TextView(getContext());
    view.setText(value);
    view.setTextColor(color);
    view.setTextSize(TypedValue.COMPLEX_UNIT_SP, CELL_TEXT_SIZE_SP);
    view.setGravity(Gravity.CENTER);
    return view;
  }

  private TextView text(String value, float sizeSp, int color) {
    TextView view = new TextView(getContext());
    view.setText(value);
    view.setTextColor(color);
    view.setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp);
    return view;
  }

  private ViewGroup cell(Cell cell, int season, int episode) {
    // A one-pixel margin on a black background is the grid line, which saves
    // giving every cell of a few hundred its own border drawable -- and the
    // cursor is the same margin widened over red.
    LinearLayout holder = new LinearLayout(getContext());
    TextView view = label(cellText(cell), CELL_TEXT_COLOR);
    view.setBackgroundColor(cell == null || cell.avail ? CELL_AVAIL_BG : CELL_MISSING_BG);
    LinearLayout.LayoutParams params =
        new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
    int line = (int) dp(GRID_LINE_DP);
    params.setMargins(line, line, line, line);
    holder.setBackgroundColor(GRID_LINE);
    holder.addView(view, params);
    // Blank cells (a season with no such episode number) have nothing to show.
    if (cell != null) {
      holder.setOnClickListener(
          v -> {
            if (episodeClickListener != null) {
              episodeClickListener.onEpisodeClicked(showName, season, episode);
            }
          });
    }
    return holder;
  }

  private static String cellText(Cell cell) {
    if (cell == null) return "";
    String watched = cell.unaired ? "u" : cell.played ? "w" : "";
    if (cell.avail) return watched + qualityChar(cell.quality);
    if (cell.unaired) return "u";
    return watched + "-";
  }

  private static String qualityChar(int quality) {
    if (quality <= 0) return "0";
    double digit = Math.round((Math.log(quality) / Math.log(2) - 8) * 3);
    return String.valueOf((long) digit);
  }

  /**
   * Turns the server's [[season, [[episode, cell]]]] into a grid indexed by
   * episode then by the season's position across, and returns its error if the
   * call did not succeed.
   */
  private static String parse(String body, List<Integer> seasons, List<List<Cell>> grid)
      throws Exception {
    JSONObject json = new JSONObject(body);
    if (!json.optBoolean("success", false)) {
      return json.isNull("error") ? "no series map" : json.optString("error");
    }
    JSONArray seasonNodes = json.optJSONArray("seriesMap");
    if (seasonNodes == null) return "no series map";
    for (int s = 0; s < seasonNodes.length(); s++) {
      JSONArray seasonNode = seasonNodes.getJSONArray(s);
      seasons.add(seasonNode.getInt(0));
      JSONArray episodeNodes = seasonNode.getJSONArray(1);
      for (int e = 0; e < episodeNodes.length(); e++) {
        JSONArray episodeNode = episodeNodes.getJSONArray(e);
        int episode = episodeNode.getInt(0);
        while (grid.size() < episode) grid.add(new ArrayList<>());
        List<Cell> cells = grid.get(episode - 1);
        while (cells.size() < s) cells.add(null);
        cells.add(new Cell(episodeNode.getJSONObject(1)));
      }
    }
    return null;
  }

  private float dp(float value) {
    return TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics());
  }
}
