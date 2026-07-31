package com.hahnca.tvapp;

import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.List;

/**
 * The card list down the left half of the screen: one card per show, holding
 * the name and its waitStr. Exactly one card is selected at any time, the top
 * one to begin with.
 *
 * Every card is built up front rather than recycled — the list is a couple of
 * hundred shows and never changes while the app is open, and a plain ScrollView
 * is what lets the cursor's edge-of-screen scrolling just call scrollBy.
 */
class ShowListView extends ScrollView implements Scroller {

  private static final int CARD_BG = 0xFF202020;
  private static final int CARD_BG_SELECTED = 0xFF0A4A8A;
  private static final float CARD_CORNER_DP = 8f;
  private static final float CARD_PAD_H_DP = 14f;
  private static final float CARD_PAD_V_DP = 10f;
  private static final float CARD_GAP_DP = 6f;
  private static final float LIST_PAD_DP = 12f;
  private static final float NAME_TEXT_SIZE_SP = 18f;
  private static final float WAIT_TEXT_SIZE_SP = 16f;
  private static final float WAIT_GAP_DP = 12f;
  private static final int WAIT_COLOR = 0xFFB0B0B0;

  interface SelectionListener {
    void onShowSelected(Shows.Show show);
  }

  private final LinearLayout column;
  private final List<Shows.Show> shows = new ArrayList<>();
  private final List<View> cards = new ArrayList<>();
  private SelectionListener listener;
  private int selected = -1;

  ShowListView(Context context) {
    super(context);
    column = new LinearLayout(context);
    column.setOrientation(LinearLayout.VERTICAL);
    int pad = (int) dp(LIST_PAD_DP);
    column.setPadding(pad, pad, pad, pad);
    addView(
        column,
        new ScrollView.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
  }

  void setSelectionListener(SelectionListener listener) {
    this.listener = listener;
  }

  /**
   * Fills the list and restores the selection, falling back to the top card
   * when the remembered show is gone (renamed, or dropped out of Emby).
   */
  void setShows(List<Shows.Show> list, String selectedName) {
    shows.clear();
    shows.addAll(list);
    cards.clear();
    column.removeAllViews();
    for (int i = 0; i < shows.size(); i++) {
      final int index = i;
      View card = buildCard(shows.get(i));
      card.setOnClickListener(v -> select(index));
      LinearLayout.LayoutParams params =
          new LinearLayout.LayoutParams(
              ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
      params.bottomMargin = (int) dp(CARD_GAP_DP);
      column.addView(card, params);
      cards.add(card);
    }
    selected = -1;
    if (shows.isEmpty()) return;
    int index = indexOfName(selectedName);
    select(index);
    // The selected card can be hundreds of rows down, and scrollTo only works
    // once the column has been laid out.
    final View card = cards.get(index);
    post(() -> scrollTo(0, card.getTop()));
  }

  private int indexOfName(String name) {
    if (name != null) {
      for (int i = 0; i < shows.size(); i++) {
        if (shows.get(i).name.equals(name)) return i;
      }
    }
    return 0;
  }

  Shows.Show getSelected() {
    return selected < 0 ? null : shows.get(selected);
  }

  @Override
  public void scrollStep(int px) {
    scrollBy(0, px);
  }

  private void select(int index) {
    if (index == selected) return;
    if (selected >= 0) paint(cards.get(selected), CARD_BG);
    selected = index;
    paint(cards.get(selected), CARD_BG_SELECTED);
    if (listener != null) listener.onShowSelected(shows.get(selected));
  }

  private void paint(View card, int color) {
    ((GradientDrawable) card.getBackground()).setColor(color);
  }

  private View buildCard(Shows.Show show) {
    LinearLayout card = new LinearLayout(getContext());
    card.setOrientation(LinearLayout.HORIZONTAL);
    card.setGravity(Gravity.CENTER_VERTICAL);
    card.setPadding(
        (int) dp(CARD_PAD_H_DP),
        (int) dp(CARD_PAD_V_DP),
        (int) dp(CARD_PAD_H_DP),
        (int) dp(CARD_PAD_V_DP));

    GradientDrawable bg = new GradientDrawable();
    bg.setCornerRadius(dp(CARD_CORNER_DP));
    bg.setColor(CARD_BG);
    card.setBackground(bg);

    TextView name = new TextView(getContext());
    name.setText(show.name);
    name.setTextColor(Color.WHITE);
    name.setTextSize(TypedValue.COMPLEX_UNIT_SP, NAME_TEXT_SIZE_SP);
    name.setSingleLine(true);
    name.setEllipsize(android.text.TextUtils.TruncateAt.END);
    LinearLayout.LayoutParams nameParams =
        new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
    card.addView(name, nameParams);

    TextView wait = new TextView(getContext());
    wait.setText(show.waitStr);
    wait.setTextColor(WAIT_COLOR);
    wait.setTextSize(TypedValue.COMPLEX_UNIT_SP, WAIT_TEXT_SIZE_SP);
    wait.setSingleLine(true);
    LinearLayout.LayoutParams waitParams =
        new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    waitParams.leftMargin = (int) dp(WAIT_GAP_DP);
    card.addView(wait, waitParams);

    return card;
  }

  private float dp(float value) {
    return TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics());
  }
}
