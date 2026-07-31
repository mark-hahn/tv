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
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * The card list down the left half of the screen: one card per show, holding
 * the name and its waitStr. Exactly one card is selected at any time, the top
 * one to begin with.
 *
 * Every card is built up front rather than recycled — the list is a couple of
 * hundred shows and never changes while the app is open, and a plain ScrollView
 * is what lets the cursor's edge-of-screen scrolling just call scrollBy. The
 * header's filter and sort therefore only ever re-order cards that already
 * exist, which is what lets the list keep up with a filter being typed.
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

    /**
     * A card was clicked directly, as against being auto-picked because a
     * filter or sort change left the old selection off the list. Only this
     * fires when a filter typed on the phone should be cleared.
     */
    void onShowClicked();
  }

  private final LinearLayout column;
  private final List<Shows.Show> shows = new ArrayList<>(); // everything loaded
  private final List<Shows.Show> visible = new ArrayList<>(); // after filter and sort
  private final Map<Shows.Show, View> cards = new HashMap<>();
  private final Map<String, Shows.Show> byName = new HashMap<>();
  private SelectionListener listener;
  private Shows.Show selected;
  private String filter = "";
  private Shows.Sort sort = Shows.Sort.ALPHA;
  // The list tv-srvr worked out from the shared settings, names in its order,
  // or null when this view is filtering and sorting for itself.
  private List<String> customOrder;
  // Normalized actor name to require in the cast, or null — the Actors pane's
  // own way of narrowing this list, mutually exclusive with the other two.
  private String actorFilter;

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
    byName.clear();
    column.removeAllViews();
    for (Shows.Show show : shows) byName.put(show.name, show);
    for (Shows.Show show : shows) {
      View card = buildCard(show);
      card.setOnClickListener(
          v -> {
            select(show);
            if (listener != null) listener.onShowClicked();
          });
      cards.put(show, card);
    }
    selected = null;
    for (Shows.Show show : shows) {
      if (show.name.equals(selectedName)) select(show);
    }
    // Picks the top card when nothing was remembered, and lays the list out.
    apply();
  }

  /**
   * Substring of the name, case ignored — the web client's filter box exactly.
   * Leaves customOrder and actorFilter alone either way: a show click routes
   * its own clear here with nothing else meant to change, and everything that
   * does mean to replace them (typing, the phone's Clear button) already says
   * so explicitly at the call site before reaching this.
   */
  void setFilter(String text) {
    if (filter.equals(text)) return;
    filter = text;
    apply();
  }

  /**
   * A new order puts the selected show somewhere unpredictable in it, so the
   * list goes back to the top and takes whichever show lands there.
   */
  void setSort(Shows.Sort sort) {
    if (this.sort == sort && customOrder == null) return;
    customOrder = null;
    this.sort = sort;
    clearSelection();
    apply();
  }

  /**
   * Show exactly these shows, in exactly this order — tv-srvr's answer for the
   * shared settings, which are richer than this list's own filter and sort can
   * express. Null hands the list back to those.
   */
  void setCustomOrder(List<String> names) {
    customOrder = names;
    if (names != null) actorFilter = null;
    clearSelection();
    apply();
  }

  /**
   * Narrows the list to shows this actor is cast in — the Actors pane's card
   * click, the same end state the web client reaches by selecting an actor and
   * pressing its Shows button. Null lifts the narrowing back off.
   */
  void setActorFilter(String actorName) {
    // onFilter clears this on every keystroke, most of which are typed with no
    // actor filter active to begin with, so a no-op guard here is what keeps
    // typing from reselecting the current show on every character.
    String normalized = actorName == null ? null : Shows.normalizeName(actorName);
    if (Objects.equals(actorFilter, normalized)) return;
    actorFilter = normalized;
    if (actorFilter != null) {
      // Narrowing to a new actor drops the old selection, same as a new sort:
      // it is about to land somewhere unpredictable in a very different list.
      customOrder = null;
      clearSelection();
    }
    // Lifting the filter does not: a show just clicked out of the narrowed
    // list is what this is clearing the actor filter *for* — apply() below
    // already keeps a selection that is still visible, which it always is
    // once nothing is narrowing the list at all.
    apply();
  }

  Shows.Show getSelected() {
    return selected;
  }

  @Override
  public void scrollStep(int px) {
    scrollBy(0, px);
  }

  /** What a tap on Up or Down does, as against holding it. */
  void scrollToTop() {
    scrollTo(0, 0);
  }

  void scrollToBottom() {
    scrollTo(0, Math.max(0, column.getHeight() - getHeight()));
  }

  /**
   * Rebuilds the column from the current filter and sort. The cards themselves
   * are built once and only ever re-ordered here, so this costs a layout pass
   * and nothing else even while a filter is being typed.
   */
  private void apply() {
    visible.clear();
    if (customOrder != null) {
      // Already filtered and ordered by the server; a name we do not know is
      // one this list never loaded, so it is simply skipped.
      for (String name : customOrder) {
        Shows.Show show = byName.get(name);
        if (show != null) visible.add(show);
      }
    } else if (actorFilter != null) {
      for (Shows.Show show : shows) {
        if (hasActor(show, actorFilter)) visible.add(show);
      }
      Collections.sort(visible, Shows.order(sort));
    } else {
      String needle = filter.toLowerCase();
      for (Shows.Show show : shows) {
        if (needle.isEmpty() || show.name.toLowerCase().contains(needle)) visible.add(show);
      }
      Collections.sort(visible, Shows.order(sort));
    }
    column.removeAllViews();
    for (Shows.Show show : visible) {
      LinearLayout.LayoutParams params =
          new LinearLayout.LayoutParams(
              ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
      params.bottomMargin = (int) dp(CARD_GAP_DP);
      column.addView(cards.get(show), params);
    }
    // A selection the filter has just hidden falls to the top of what is left,
    // so the panes are never showing a show the list no longer offers.
    if (selected != null && !visible.contains(selected)) clearSelection();
    if (selected == null && !visible.isEmpty()) select(visible.get(0));
    if (selected == null) return;
    // scrollTo only means anything once the column has been laid out, and the
    // selected card can be hundreds of rows down. The top card is scrolled to
    // zero rather than to itself, or the list's own top padding is cut off.
    final View card = cards.get(selected);
    final boolean atTop = visible.get(0) == selected;
    post(() -> scrollTo(0, atTop ? 0 : card.getTop()));
  }

  private void clearSelection() {
    if (selected == null) return;
    paint(cards.get(selected), CARD_BG);
    selected = null;
  }

  private void select(Shows.Show show) {
    if (show == selected) return;
    if (selected != null) paint(cards.get(selected), CARD_BG);
    selected = show;
    paint(cards.get(show), CARD_BG_SELECTED);
    if (listener != null) listener.onShowSelected(show);
  }

  private void paint(View card, int color) {
    ((GradientDrawable) card.getBackground()).setColor(color);
  }

  private static boolean hasActor(Shows.Show show, String normalizedName) {
    for (Shows.Actor actor : show.characters) {
      if (Shows.normalizeName(actor.name).equals(normalizedName)) return true;
    }
    return false;
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
