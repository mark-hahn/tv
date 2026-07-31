package com.hahnca.tvapp;

import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * The bar above the show list, the width of the list: the filter box taking
 * whatever width is left over on the left, and the two sort buttons hard
 * against the right.
 *
 * The filter box is a TextView, not an EditText — a tv has no keyboard. It
 * shows what the phone is typing into tvappctrl's keyboard and is clicked to
 * bring that keyboard up and to put it away again, both of which MainActivity
 * arranges over the ctrl socket.
 *
 * Holding the cursor over this bar does not scroll the list: the scroll zone
 * starts at the list's own top, so reaching up for the filter box does not pull
 * the list out from under the cursor on the way.
 */
class ListHeader extends LinearLayout {

  static final float HEIGHT_DP = 44f;

  private static final float PAD_H_DP = 12f;
  private static final float GAP_DP = 8f;
  private static final int BOX_BG = 0xFFE8E8E8;
  private static final int BOX_HINT = 0xFF808080;
  private static final float BOX_CORNER_DP = 4f;
  private static final float BOX_PAD_H_DP = 8f;
  private static final float BOX_TEXT_SIZE_SP = 16f;
  // The same two colours and the same corner as the pane tabs, so an active
  // sort button and an active tab read as the one thing.
  private static final int BTN_BG = 0xFF404040;
  private static final int BTN_ACTIVE_BG = 0xFF0A4A8A;
  private static final float BTN_CORNER_DP = 6f;
  private static final float BTN_TEXT_SIZE_SP = 14f;
  private static final float BTN_PAD_H_DP = 10f;

  interface Listener {
    /** The filter box was clicked: bring the phone's keyboard up, or take it down. */
    void onFilterClick();

    void onSortClick(Shows.Sort sort);
  }

  private final TextView box;
  private final Button watching;
  private final Button added;

  ListHeader(Context context, Listener listener) {
    super(context);
    setOrientation(HORIZONTAL);
    setGravity(Gravity.CENTER_VERTICAL);
    int pad = (int) dp(PAD_H_DP);
    setPadding(pad, 0, pad, 0);

    box = new TextView(context);
    box.setHint("Filter...");
    box.setHintTextColor(BOX_HINT);
    box.setTextColor(Color.BLACK);
    box.setTextSize(TypedValue.COMPLEX_UNIT_SP, BOX_TEXT_SIZE_SP);
    box.setSingleLine(true);
    box.setEllipsize(android.text.TextUtils.TruncateAt.START);
    box.setGravity(Gravity.CENTER_VERTICAL);
    int boxPad = (int) dp(BOX_PAD_H_DP);
    box.setPadding(boxPad, 0, boxPad, 0);
    GradientDrawable boxBg = new GradientDrawable();
    boxBg.setCornerRadius(dp(BOX_CORNER_DP));
    boxBg.setColor(BOX_BG);
    box.setBackground(boxBg);
    box.setOnClickListener(v -> listener.onFilterClick());
    // Weighted, so the buttons keep their own width and the box takes the rest.
    LinearLayout.LayoutParams boxParams =
        new LinearLayout.LayoutParams(0, (int) dp(HEIGHT_DP) - (int) dp(GAP_DP) * 2, 1f);
    boxParams.rightMargin = (int) dp(GAP_DP);
    addView(box, boxParams);

    watching = sortButton(context, "Watching", listener, Shows.Sort.WATCHING);
    added = sortButton(context, "Added", listener, Shows.Sort.ADDED);
    setSort(Shows.Sort.ALPHA);
  }

  private Button sortButton(Context context, String label, Listener listener, Shows.Sort sort) {
    Button button = new Button(context);
    button.setText(label);
    button.setTextSize(TypedValue.COMPLEX_UNIT_SP, BTN_TEXT_SIZE_SP);
    button.setTextColor(Color.WHITE);
    button.setSingleLine(true);
    // A Button's own minimum width and padding are wider than these labels need,
    // and would push the filter box down to nothing.
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
        new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, (int) dp(HEIGHT_DP) - (int) dp(GAP_DP) * 2);
    params.leftMargin = (int) dp(GAP_DP);
    addView(button, params);
    return button;
  }

  /** What the phone's keyboard has typed so far, or "" for no filter at all. */
  void setFilterText(String text) {
    box.setText(text);
  }

  /** Blue for the sort in force; both plain when the list is back in alpha order. */
  void setSort(Shows.Sort sort) {
    paint(watching, sort == Shows.Sort.WATCHING ? BTN_ACTIVE_BG : BTN_BG);
    paint(added, sort == Shows.Sort.ADDED ? BTN_ACTIVE_BG : BTN_BG);
  }

  private void paint(Button button, int color) {
    ((GradientDrawable) button.getBackground()).setColor(color);
  }

  private float dp(float value) {
    return TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics());
  }
}
