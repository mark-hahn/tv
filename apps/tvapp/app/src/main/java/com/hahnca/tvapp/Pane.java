package com.hahnca.tvapp;

import android.view.View;

/**
 * One of the tabs on the right half of the screen. They are the web client's
 * simple-mode tabs — Info, Map, Actors, Trailers — holding the same content it
 * shows, so all three uis agree on what a show looks like.
 *
 * A pane is told about the selected show whether or not it is on screen, and
 * loads whatever it needs only once it is shown: Map fetches, and running a
 * fetch a card at a time while someone scrolls the list would be for nothing.
 */
interface Pane extends Scroller {

  /** Remembered now, loaded on the next {@link #onShown()}. */
  void setShow(Shows.Show show);

  /** This pane just became the visible one. */
  void onShown();

  View asView();

  /** The visible region that scrolls when this pane is given a scroll action. */
  default View scrollableView() {
    return asView();
  }

  /**
   * Which of this pane's scroll regions should receive a scroll action. Only
   * Map has more than one region — its grid, and the episode subpane below it —
   * so every other pane is answered by scrollableView alone.
   */
  default Scroller scrollerAt(HitTest hit) {
    return hit.hits(scrollableView()) ? this : null;
  }

  /** Whether a target point is over a view; MainActivity owns the arithmetic. */
  interface HitTest {
    boolean hits(View view);
  }
}
