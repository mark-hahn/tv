package com.hahnca.tvapp;

import android.content.Context;
import android.graphics.Color;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.LinearLayout;
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
 * Season columns are weighted above a floor: a handful of seasons spread across
 * the pane, and past the dozen that fit at a legible width the grid runs off
 * the side and the pane scrolls sideways to reach the rest.
 */
class MapView extends ScrollPane {

  private static final String SERIES_MAP_URL =
      "https://hahnca.com/tv-srvr/api/getSeriesMapFromEmby";
  private static final String TAG = "tvapp";
  private static final float ROW_HEIGHT_DP = 34f;
  private static final float EPISODE_COL_WIDTH_DP = 40f;
  // A season column never narrows past this; beyond that the grid scrolls.
  private static final float MIN_SEASON_COL_WIDTH_DP = 44f;
  private static final float CELL_TEXT_SIZE_SP = 13.5f;
  private static final int CELL_AVAIL_BG = 0xFFFFFFFF;
  private static final int CELL_MISSING_BG = 0xFFFFCCCC;
  // A cell is far too small to carry the red border the cursor is everywhere
  // else, so it takes a background instead — the web client's own colour for a
  // selected cell, which the missing-file pink above cannot be confused with.
  private static final int CELL_FOCUS_BG = 0xFF90EE90;
  private static final int CELL_TEXT_COLOR = 0xFF000000;
  private static final int GRID_LINE = 0xFF000000;
  private static final float GRID_LINE_DP = 1f;

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

  private EpisodeClickListener episodeClickListener;
  private CellFocusListener cellFocusListener;
  private String showName;

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
    super(context, true);
  }

  @Override
  protected void fill(Shows.Show show) {
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
    column.removeAllViews();
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

    LinearLayout header = row();
    header.addView(label("", Color.WHITE), episodeColumn());
    for (int season : seasons) {
      header.addView(label("S" + season, Color.WHITE), cellColumn());
    }
    addRow(header, 0);

    cellSeasons.addAll(seasons);
    for (int episode = 1; episode <= grid.size(); episode++) {
      List<Cell> cells = grid.get(episode - 1);
      LinearLayout line = row();
      line.addView(label(String.valueOf(episode), DIM_COLOR), episodeColumn());
      List<TextView> rowViews = new ArrayList<>();
      for (int i = 0; i < seasons.size(); i++) {
        Cell cell = i < cells.size() ? cells.get(i) : null;
        ViewGroup holder = cell(cell, seasons.get(i), episode);
        rowViews.add((TextView) holder.getChildAt(0));
        line.addView(holder, cellColumn());
      }
      cellViews.add(rowViews);
      cellGrid.add(cells);
      addRow(line, 0);
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
   * when that direction runs off the edge, which leaves the cursor put: the
   * grid's way out is the back key, not an arrow.
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
    cellViews
        .get(row)
        .get(col)
        .setBackgroundColor(
            focused ? CELL_FOCUS_BG : (cell == null || cell.avail ? CELL_AVAIL_BG : CELL_MISSING_BG));
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

  private int cellColumnWidth = (int) dp(44f); // default, updated by show()

  private LinearLayout row() {
    LinearLayout row = new LinearLayout(getContext());
    row.setOrientation(LinearLayout.HORIZONTAL);
    return row;
  }

  private LinearLayout.LayoutParams episodeColumn() {
    return new LinearLayout.LayoutParams((int) dp(EPISODE_COL_WIDTH_DP), (int) dp(ROW_HEIGHT_DP));
  }

  private LinearLayout.LayoutParams cellColumn() {
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

  private ViewGroup cell(Cell cell, int season, int episode) {
    // A one-pixel margin on a black background is the grid line, which saves
    // giving every cell of a few hundred its own border drawable.
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
}
