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
}
