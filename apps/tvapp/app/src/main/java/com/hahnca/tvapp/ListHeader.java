package com.hahnca.tvapp;

import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;

/**
 * The bar above the show list, the width of the list: the Watching and Added
 * sort buttons, followed by the Up and Down scroll buttons MainActivity
 * appends after them.
 *
 * The filter is no longer typed here — there is no keyboard on a tv — it now
 * lives entirely in tvappctrl on the phone, which has one.
 *
 * The list also scrolls from a two-finger drag when the cursor is not over a
 * scrollable pane, so this row can still be crossed without moving the cursor.
 */
class ListHeader extends LinearLayout {

  static final float HEIGHT_DP = 44f;
  // Shared with the Up and Down buttons MainActivity appends to this row, so
  // the column lines up with the cards below it.
  static final float PAD_H_DP = 12f;
  static final float GAP_DP = 8f;

  // Same height and font as the Up and Down buttons, so all four read as one
  // row of buttons.
  static final float BTN_HEIGHT_DP = 35.2f;
  private static final float BTN_TEXT_SIZE_SP = 16f;
  // The same two colours and the same corner as the pane tabs, so an active
  // sort button and an active tab read as the one thing.
  private static final int BTN_BG = 0xFF404040;
  private static final int BTN_ACTIVE_BG = 0xFF0A4A8A;
  private static final float BTN_CORNER_DP = 6f;
  private static final float BTN_PAD_H_DP = 10f;

  interface Listener {
    void onSortClick(Shows.Sort sort);

    /** The Added button, relabelled Custom, was clicked while settings are shared. */
    void onCustomClick();
  }

  private final Button watching;
  private final Button added;
  private Shows.Sort currentSort = Shows.Sort.ALPHA;
  // Whether tv-srvr currently has filter/sort settings shared (the web
  // client's hdrtop Send button) — while true, Added is Custom instead.
  private boolean customActive;
  // Whether those settings are the ones the list is showing right now.
  private boolean customOn;

  ListHeader(Context context, Listener listener) {
    super(context);
    setOrientation(HORIZONTAL);
    setGravity(Gravity.CENTER_VERTICAL);
    int pad = (int) dp(PAD_H_DP);
    setPadding(pad, 0, pad, 0);

    watching = sortButton(context, "Watching", listener, Shows.Sort.WATCHING, 0);
    added = sortButton(context, "Added", listener, Shows.Sort.ADDED, (int) dp(GAP_DP));
    added.setOnClickListener(
        v -> {
          if (customActive) listener.onCustomClick();
          else listener.onSortClick(Shows.Sort.ADDED);
        });
    setSort(Shows.Sort.ALPHA);
  }

  private Button sortButton(
      Context context, String label, Listener listener, Shows.Sort sort, int leftMargin) {
    Button button = new Button(context);
    button.setText(label);
    button.setTextSize(TypedValue.COMPLEX_UNIT_SP, BTN_TEXT_SIZE_SP);
    button.setTextColor(Color.WHITE);
    button.setSingleLine(true);
    // A Button's own minimum width and padding are wider than these labels need,
    // and would push the row taller than it needs to be.
    button.setMinWidth(0);
    button.setMinimumWidth(0);
    int pad = (int) dp(BTN_PAD_H_DP);
    button.setPadding(pad, 0, pad, 0);
    // Its own background rather than the theme's: tinting a platform Button and
    // then clearing the tint gives a white button with white text, not the
    // platform look back.
    GradientDrawable bg = new GradientDrawable();
    bg.setCornerRadius(dp(BTN_CORNER_DP));
    button.setBackground(bg);
    button.setOnClickListener(v -> listener.onSortClick(sort));
    LinearLayout.LayoutParams params =
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, (int) dp(BTN_HEIGHT_DP));
    params.leftMargin = leftMargin;
    addView(button, params);
    return button;
  }

  /** Blue for the sort in force; both plain when the list is back in alpha order. */
  void setSort(Shows.Sort sort) {
    currentSort = sort;
    repaint();
  }

  /**
   * Live from tv-srvr: while the web client has filter/sort settings shared,
   * Added relabels to Custom and its click restores them instead of sorting —
   * exactly what hdrtop's own Custom button does there.
   */
  void setSharedFilters(boolean has) {
    if (customActive == has) return;
    customActive = has;
    added.setText(has ? "Custom" : "Added");
    repaint();
  }

  /**
   * Whether the shared settings are what the list is showing. While they are,
   * Custom is the lit button and no sort button is, however the settings
   * happen to have ordered the list.
   */
  void setCustomOn(boolean on) {
    if (customOn == on) return;
    customOn = on;
    repaint();
  }

  private void repaint() {
    paint(watching, !customOn && currentSort == Shows.Sort.WATCHING ? BTN_ACTIVE_BG : BTN_BG);
    boolean addedLit = customActive ? customOn : currentSort == Shows.Sort.ADDED;
    paint(added, addedLit ? BTN_ACTIVE_BG : BTN_BG);
  }

  private void paint(Button button, int color) {
    ((GradientDrawable) button.getBackground()).setColor(color);
  }

  private float dp(float value) {
    return TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics());
  }
}
