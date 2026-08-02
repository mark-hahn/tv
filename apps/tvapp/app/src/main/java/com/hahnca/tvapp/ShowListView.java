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
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * The card list down the left half of the screen: one card per show, holding
 * the name and its waitStr. One card is active at any time and may be different
 * from the card currently selected by the remote's arrow-key focus.
 *
 * Every card is built up front rather than recycled — the list is a couple of
 * hundred shows and never changes while the app is open. Filtering and sorting
 * therefore only ever re-order cards that already exist, which is what lets the
 * list keep up with a filter being typed.
 */
class ShowListView extends ScrollView implements Scroller {

  private static final int CARD_BG = 0xFF202020;
  private static final int CARD_BG_ACTIVE = 0xFF0A4A8A;
  private static final int CARD_SELECTED_BORDER = 0xFFFF0000;
  private static final float CARD_CORNER_DP = 8f;
  private static final float CARD_SELECTED_BORDER_DP = 3f;
  private static final float CARD_PAD_H_DP = 14f;
  private static final float CARD_PAD_V_DP = 10f;
  private static final float CARD_GAP_DP = 6f;
  private static final float LIST_PAD_DP = 12f;
  private static final float NAME_TEXT_SIZE_SP = 16.2f;
  private static final float WAIT_TEXT_SIZE_SP = 14.4f;
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

  private static final String EMPTY_LABEL = "No Shows.";

  private final LinearLayout column;
  private final TextView emptyView;
  private final List<Shows.Show> shows = new ArrayList<>(); // everything loaded
  private final List<Shows.Show> visible = new ArrayList<>(); // after filter and sort
  private final Map<Shows.Show, View> cards = new HashMap<>();
  private final Map<String, Shows.Show> byName = new HashMap<>();
  private SelectionListener listener;
  private Shows.Show active;
  private Shows.Show focused;
  private boolean focusShown;
  private String filter = "";
  private Shows.Sort sort = Shows.Sort.ALPHA;
  private final Set<String> activeFilters = new HashSet<>();
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

    emptyView = new TextView(context);
    emptyView.setText(EMPTY_LABEL);
    emptyView.setTextColor(Color.WHITE);
    emptyView.setTextSize(TypedValue.COMPLEX_UNIT_SP, NAME_TEXT_SIZE_SP);
    emptyView.setGravity(Gravity.CENTER_HORIZONTAL);
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
      cards.put(show, card);
    }
    active = null;
    focused = null;
    for (Shows.Show show : shows) {
      if (show.name.equals(selectedName)) setActive(show);
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

  void setActiveFilters(Set<String> labels) {
    if (activeFilters.equals(labels)) return;
    activeFilters.clear();
    activeFilters.addAll(labels);
    clearActive();
    apply();
  }

  /**
   * A new order puts the active show somewhere unpredictable in it, so the
   * list goes back to the top and takes whichever show lands there.
   */
  void setSort(Shows.Sort sort) {
    if (this.sort == sort && customOrder == null) return;
    customOrder = null;
    this.sort = sort;
    clearActive();
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
    clearActive();
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
      clearActive();
    }
    // Lifting the filter does not: a show just clicked out of the narrowed
    // list is what this is clearing the actor filter *for* — apply() below
    // already keeps a selection that is still visible, which it always is
    // once nothing is narrowing the list at all.
    apply();
  }

  Shows.Show getSelected() {
    return active;
  }

  /** Driven straight by tv-tv, not a click -- no filter, sort, or order to touch. */
  void selectByName(String name) {
    Shows.Show show = byName.get(name);
    if (show != null) {
      setActive(show);
      focus(show, focusShown);
      scrollToFocused();
    }
  }

  Shows.Show getFocused() {
    return focused;
  }

  int focusedCenterOnScreen() {
    View card = focused == null ? null : cards.get(focused);
    if (card == null) return -1;
    int[] pos = new int[2];
    card.getLocationOnScreen(pos);
    return pos[1] + card.getHeight() / 2;
  }

  boolean moveFocus(int direction) {
    if (visible.isEmpty()) return false;
    Shows.Show base = focused != null && visible.contains(focused) ? focused : active;
    int index = base == null ? 0 : visible.indexOf(base);
    if (index < 0) index = 0;
    int next = index + direction;
    if (next < 0 || next >= visible.size()) return false;
    focus(visible.get(next), true);
    scrollToFocused();
    return true;
  }

  boolean focusClosestToScreenY(int screenY) {
    Shows.Show show = closestToScreenY(screenY);
    if (show == null) return false;
    focus(show, true);
    scrollToFocused();
    return true;
  }

  void setCardFocusShown(boolean shown) {
    if (focusShown == shown) return;
    focusShown = shown;
    if (focused != null) paint(cards.get(focused));
  }

  void focusActive() {
    Shows.Show target = active != null ? active : (visible.isEmpty() ? null : visible.get(0));
    if (target != null) focus(target, true);
  }

  void activateFocused() {
    if (focused == null) return;
    setActive(focused);
    if (listener != null) listener.onShowClicked();
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
        if ((needle.isEmpty() || show.name.toLowerCase().contains(needle))
            && matchesActiveFilters(show)) {
          visible.add(show);
        }
      }
      Collections.sort(visible, Shows.order(sort));
    }
    column.removeAllViews();
    if (visible.isEmpty()) {
      LinearLayout.LayoutParams params =
          new LinearLayout.LayoutParams(
              ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
      column.addView(emptyView, params);
      if (active != null) clearActive();
      focused = null;
      return;
    }
    for (Shows.Show show : visible) {
      LinearLayout.LayoutParams params =
          new LinearLayout.LayoutParams(
              ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
      params.bottomMargin = (int) dp(CARD_GAP_DP);
      column.addView(cards.get(show), params);
    }
    // An active show the filter has just hidden falls to the top of what is left,
    // so the panes are never showing a show the list no longer offers.
    if (active != null && !visible.contains(active)) clearActive();
    if (active == null && !visible.isEmpty()) setActive(visible.get(0));
    if (focused != null && !visible.contains(focused)) focused = active;
    if (focused == null && active != null) focused = active;
    if (active == null) return;
    // scrollTo only means anything once the column has been laid out, and the
    // active card can be hundreds of rows down. The top card is scrolled to
    // zero rather than to itself, or the list's own top padding is cut off.
    final View card = cards.get(active);
    final boolean atTop = visible.get(0) == active;
    post(() -> scrollTo(0, atTop ? 0 : card.getTop()));
  }

  private boolean matchesActiveFilters(Shows.Show show) {
    // Non-Emby ("trash") shows are hidden unless the Trash filter is active.
    if (!activeFilters.contains("Trash") && !show.inEmby) return false;
    for (String label : activeFilters) {
      if ("Ready".equals(label) && show.notReady) return false;
      if ("Drama".equals(label) && !show.isDrama()) return false;
      if ("Comedy".equals(label) && !show.isComedy()) return false;
      if ("To Try".equals(label) && !show.inToTry) return false;
      if ("Continue".equals(label) && !show.inContinue) return false;
      if ("Mark".equals(label) && !show.inMark) return false;
      if ("Linda".equals(label) && !show.inLinda) return false;
    }
    return true;
  }

  private void clearActive() {
    if (active == null) return;
    Shows.Show old = active;
    active = null;
    paint(cards.get(old));
  }

  private void setActive(Shows.Show show) {
    if (show == active) return;
    Shows.Show old = active;
    active = show;
    if (old != null) paint(cards.get(old));
    paint(cards.get(show));
    if (listener != null) listener.onShowSelected(show);
  }

  private void focus(Shows.Show show, boolean showFocus) {
    Shows.Show old = focused;
    focused = show;
    focusShown = showFocus;
    if (old != null) paint(cards.get(old));
    if (show != null) paint(cards.get(show));
  }

  private Shows.Show closestToScreenY(int screenY) {
    Shows.Show best = null;
    int bestDistance = Integer.MAX_VALUE;
    for (Shows.Show show : visible) {
      View card = cards.get(show);
      if (card == null || card.getHeight() <= 0) continue;
      int[] pos = new int[2];
      card.getLocationOnScreen(pos);
      int center = pos[1] + card.getHeight() / 2;
      int distance = Math.abs(center - screenY);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = show;
      }
    }
    return best;
  }

  private void scrollToFocused() {
    if (focused == null) return;
    final View card = cards.get(focused);
    final boolean atTop = !visible.isEmpty() && visible.get(0) == focused;
    post(() -> scrollTo(0, atTop ? 0 : card.getTop()));
  }

  private void paint(View card) {
    if (card == null) return;
    Shows.Show show = null;
    for (Map.Entry<Shows.Show, View> entry : cards.entrySet()) {
      if (entry.getValue() == card) {
        show = entry.getKey();
        break;
      }
    }
    GradientDrawable bg = (GradientDrawable) card.getBackground();
    bg.setColor(show == active ? CARD_BG_ACTIVE : CARD_BG);
    bg.setStroke(
        show == focused && focusShown ? (int) dp(CARD_SELECTED_BORDER_DP) : 0,
        CARD_SELECTED_BORDER);
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
