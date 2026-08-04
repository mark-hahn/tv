package com.hahnca.tvapp;

import android.content.Context;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;

/**
 * The Map tab as actually shown: the season/episode grid, and — once an
 * episode cell is clicked — the episode subpane below it, taking a third of
 * the tab's height (the grid keeping the other two thirds) while it's open.
 * A LinearLayout weight split does this with no manual height math:
 * LinearLayout excludes a GONE child from the weight sum entirely, so the
 * grid alone gets the full height until the subpane appears.
 */
class MapPane implements Pane {

  private static final float GRID_WEIGHT = 2f;
  private static final float SUBPANE_WEIGHT = 1f;

  private final MapView mapView;
  private final EpisodeSubpane episodeSubpane;
  private final LinearLayout container;

  MapPane(Context context) {
    mapView = new MapView(context);
    episodeSubpane = new EpisodeSubpane(context);
    mapView.setEpisodeClickListener(episodeSubpane::toggle);

    container = new LinearLayout(context);
    container.setOrientation(LinearLayout.VERTICAL);
    container.addView(
        mapView.asView(),
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, GRID_WEIGHT));
    container.addView(
        episodeSubpane,
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, SUBPANE_WEIGHT));
  }

  void closeEpisode() {
    episodeSubpane.close();
  }

  boolean isEpisodeOpen() {
    return episodeSubpane.isOpen();
  }

  // The grid's cursor, which MainActivity drives by remote key. The episode
  // subpane below never takes it -- there is nothing in there to focus.

  void setCellFocusListener(MapView.CellFocusListener listener) {
    mapView.setCellFocusListener(listener);
  }

  boolean requestFocusFirstCell() {
    return mapView.requestFocusFirstCell();
  }

  void clearCellFocus() {
    mapView.clearCellFocus();
  }

  boolean hasFocusedCell() {
    return mapView.hasFocusedCell();
  }

  /**
   * The cursor's step through the grid, with the episode subpane -- if it is
   * open -- following it onto whatever cell it lands on. Closed, it stays
   * closed: opening it is what ok is for.
   */
  boolean moveCellFocus(int rowStep, int colStep) {
    if (!mapView.moveCellFocus(rowStep, colStep)) {
      // The cursor's own column ran dry, not necessarily the whole table --
      // scroll on so the rest of it, from other seasons, still shows.
      if (rowStep > 0 && colStep == 0) mapView.scrollToBottom();
      return false;
    }
    if (episodeSubpane.isOpen()) {
      episodeSubpane.showEpisode(
          mapView.focusedShowName(), mapView.focusedSeason(), mapView.focusedEpisode());
    }
    return true;
  }

  /** Null when the focused episode has no file for Emby to load. */
  String focusedEpisodeId() {
    return mapView.focusedEpisodeId();
  }

  /**
   * Ok on the focused cell: the subpane opens on that episode, or closes if it
   * is the one already showing. Nothing in the subpane takes the cursor, which
   * stays on the cell throughout.
   */
  void toggleFocusedEpisode() {
    if (!mapView.hasFocusedCell()) return;
    episodeSubpane.toggle(
        mapView.focusedShowName(), mapView.focusedSeason(), mapView.focusedEpisode());
  }

  @Override
  public void setShow(Shows.Show show) {
    mapView.setShow(show);
  }

  @Override
  public void onShown() {
    mapView.onShown();
  }

  @Override
  public View asView() {
    return container;
  }

  @Override
  public View scrollableView() {
    return mapView.scrollableView();
  }

  /**
   * The grid and the episode subpane scroll separately. Anywhere in the subpane
   * counts, the still included: the description is the only thing in there that
   * scrolls at all.
   */
  @Override
  public Scroller scrollerAt(HitTest hit) {
    if (episodeSubpane.isOpen() && hit.hits(episodeSubpane)) return episodeSubpane;
    return hit.hits(mapView.asView()) ? this : null;
  }

  @Override
  public void scrollStep(int px) {
    mapView.scrollStep(px);
  }

  @Override
  public void scrollStepX(int px) {
    mapView.scrollStepX(px);
  }
}
