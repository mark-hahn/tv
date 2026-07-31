package com.hahnca.tvapp;

/**
 * Something the cursor can scroll by holding at an edge of the screen. Which
 * one is being scrolled depends on which half the cursor is in, so MainActivity
 * drives them through this rather than knowing about either.
 */
interface Scroller {
  /** Scrolls by one tick's worth of pixels, negative for up. */
  void scrollStep(int px);

  /** Scrolls sideways by one tick, for the few that go that way at all. */
  default void scrollStepX(int px) {}

  /**
   * True for anything that is a list: the cursor scrolls it the way it scrolls
   * the show list, ramping with how far into the zone it is held, and a click
   * puts it back at the start. False leaves the older constant crawl.
   */
  default boolean rampScroll() {
    return false;
  }

  default boolean scrollsHorizontally() {
    return false;
  }
}
