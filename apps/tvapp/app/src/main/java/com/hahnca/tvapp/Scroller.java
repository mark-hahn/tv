package com.hahnca.tvapp;

/** Something MainActivity can scroll by a direct drag delta. */
interface Scroller {
  /** Scrolls by pixels, negative for up. */
  void scrollStep(int px);

  /** Scrolls sideways by pixels, for the few that go that way at all. */
  default void scrollStepX(int px) {}
}
