package com.hahnca.tvapp;

/**
 * Something the cursor can scroll by holding at an edge of the screen. Which
 * one is being scrolled depends on which half the cursor is in, so MainActivity
 * drives them through this rather than knowing about either.
 */
interface Scroller {
  /** Scrolls by one tick's worth of pixels, negative for up. */
  void scrollStep(int px);
}
