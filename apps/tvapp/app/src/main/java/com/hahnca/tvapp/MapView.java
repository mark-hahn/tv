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
  private static final int CELL_TEXT_COLOR = 0xFF000000;
  private static final int GRID_LINE = 0xFF000000;
  private static final float GRID_LINE_DP = 1f;

  /** An episode cell was clicked: opens the episode subpane in MainActivity. */
  interface EpisodeClickListener {
    void onEpisodeClicked(String showName, int season, int episode);
  }

  private EpisodeClickListener episodeClickListener;
  private String showName;

  void setEpisodeClickListener(EpisodeClickListener listener) {
    this.episodeClickListener = listener;
  }

  /** One cell of the grid, or null where a season has no such episode. */
  private static class Cell {
    final boolean played;
    final boolean avail;
    final boolean unaired;
    final int quality;

    Cell(JSONObject node) {
      played = node.optBoolean("played", false);
      avail = node.optBoolean("avail", false);
      unaired = node.optBoolean("unaired", false);
      quality = node.optInt("quality", 0);
    }
  }

  MapView(Context context) {
    super(context, true);
  }

  @Override
  protected void fill(Shows.Show show) {
    showName = show.name;
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
    if (seasons.isEmpty()) {
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

    for (int episode = 1; episode <= grid.size(); episode++) {
      List<Cell> cells = grid.get(episode - 1);
      LinearLayout line = row();
      line.addView(label(String.valueOf(episode), DIM_COLOR), episodeColumn());
      for (int i = 0; i < seasons.size(); i++) {
        Cell cell = i < cells.size() ? cells.get(i) : null;
        line.addView(cell(cell, seasons.get(i), episode), cellColumn());
      }
      addRow(line, 0);
    }
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
    switch (quality) {
      case 2160:
        return "2";
      case 1080:
        return "1";
      case 720:
        return "7";
      case 576:
        return "5";
      case 480:
        return "4";
      case 384:
        return "3";
      default:
        return "0";
    }
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
