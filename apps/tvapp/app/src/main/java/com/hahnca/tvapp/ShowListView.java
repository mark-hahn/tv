package com.hahnca.tvapp;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.os.Looper;
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

  private static final int CARD_BG_SELECTED = 0xFF0A4A8A;
  private static final int CARD_BG_EMBY = 0xFF000000;
  // Same black as an in-Emby row; square corners are what mark it not-in-Emby.
  private static final int CARD_BG_NOT_EMBY = CARD_BG_EMBY;
  private static final int CARD_TEXT_LIGHT = 0xFFFFFFFF;
  private static final int CARD_SELECTED_BORDER = 0xFFFF0000;
  private static final float CARD_CORNER_DP = 8f;
  private static final float CARD_SELECTED_BORDER_DP = 3f;
  private static final float CARD_PAD_H_DP = 14f;
  private static final float CARD_PAD_V_DP = 2f;
  private static final float CARD_GAP_DP = 1f;
  private static final float LIST_PAD_DP = 12f;
  private static final float NAME_TEXT_SIZE_SP = 16.2f;
  private static final float WAIT_TEXT_SIZE_SP = 14.4f;
  private static final float WAIT_GAP_DP = 12f;
  private static final int WAIT_COLOR = 0xFFB0B0B0;
  private static final int TRASH_ICON_COLOR = 0xFFB0B0B0;
  private static final float TRASH_ICON_SIZE_DP = 16f;
  private static final float TRASH_ICON_STROKE_DP = 1.2f;

  interface SelectionListener {
    void onShowSelected(Shows.Show show);
  }

  interface CountsListener {
    void onCounts(int visibleCount);
  }

  /** Fired when a filter/sort change leaves no shows visible at all. */
  interface EmptyListener {
    void onListEmptied();
  }

  // Package-visible: MainActivity's button column dwell-activates on the same delay.
  static final long DWELL_SELECT_MS = 600;

  private static final String EMPTY_LABEL = "No Shows.";

  private final LinearLayout column;
  private final TextView emptyView;
  private final List<Shows.Show> shows = new ArrayList<>(); // everything loaded
  private final List<Shows.Show> visible = new ArrayList<>(); // after filter and sort
  private final Map<Shows.Show, View> cards = new HashMap<>();
  private final Map<String, Shows.Show> byName = new HashMap<>();
  private SelectionListener listener;
  private CountsListener countsListener;
  private EmptyListener emptyListener;
  private int lastVisibleCount = -1;
  private Shows.Show active;
  private Shows.Show focused;
  private boolean focusShown;
  private final Handler dwellHandler = new Handler(Looper.getMainLooper());
  private final Runnable dwellSelect = () -> { if (focused != null) setActive(focused); };
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

  void setCountsListener(CountsListener listener) {
    this.countsListener = listener;
  }

  void setEmptyListener(EmptyListener listener) {
    this.emptyListener = listener;
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
    dwellHandler.removeCallbacks(dwellSelect);
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

  /**
   * Toggling one of the checkbox filters (Ready, Drama, ...) only ever removes
   * or restores shows in place -- the remaining order is unaffected -- so the
   * selection recovery in apply() (nearest remaining show above) applies here,
   * unlike setSort/setCustomOrder/setActorFilter below which scramble the
   * order and so always drop back to the top.
   */
  void setActiveFilters(Set<String> labels) {
    if (activeFilters.equals(labels)) return;
    activeFilters.clear();
    activeFilters.addAll(labels);
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

  boolean moveFocus(int direction) {
    if (visible.isEmpty()) return false;
    Shows.Show base = focused != null && visible.contains(focused) ? focused : active;
    int index = base == null ? 0 : visible.indexOf(base);
    if (index < 0) index = 0;
    int next = index + direction;
    if (next < 0 || next >= visible.size()) return false;
    // The top and bottom shows are the ends of the line -- there is nothing
    // further to dwell toward, so landing on either selects it right away
    // instead of waiting out DWELL_SELECT_MS.
    boolean atEnd = next == 0 || next == visible.size() - 1;
    focus(visible.get(next), true, atEnd);
    scrollToFocused();
    return true;
  }

  void setCardFocusShown(boolean shown) {
    if (focusShown == shown) return;
    focusShown = shown;
    if (focused != null) paint(cards.get(focused));
  }

  /** Left arrow from the list: jump the cursor straight to the top show. */
  void focusTop() {
    if (visible.isEmpty()) return;
    focus(visible.get(0), true, true);
    scrollToFocused();
  }

  /** Cursor moves to the selected show -- the left-arrow, button-to-list transition. */
  void focusActive() {
    Shows.Show target = active != null ? active : (visible.isEmpty() ? null : visible.get(0));
    if (target != null) {
      focus(target, true);
      scrollToFocused();
    }
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
    List<Shows.Show> previousVisible = new ArrayList<>(visible);
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
      dispatchCounts();
      if (emptyListener != null) emptyListener.onListEmptied();
      return;
    }
    for (Shows.Show show : visible) {
      LinearLayout.LayoutParams params =
          new LinearLayout.LayoutParams(
              ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
      params.bottomMargin = (int) dp(CARD_GAP_DP);
      column.addView(cards.get(show), params);
    }
    // A selected show the filter has just hidden lands on the nearest remaining
    // show above where it was -- not simply the new top of the list -- so a
    // filter typed while browsing does not fling the selection to the far end.
    // If the cursor itself is still visible it wins over that recovery, since
    // that is where the user is already looking.
    if (active != null && !visible.contains(active)) {
      Shows.Show recovered = null;
      if (focused != null && visible.contains(focused)) {
        recovered = focused;
      } else {
        int base = previousVisible.indexOf(active);
        if (base < 0) base = previousVisible.size();
        for (int i = base - 1; i >= 0; i--) {
          Shows.Show candidate = previousVisible.get(i);
          if (visible.contains(candidate)) {
            recovered = candidate;
            break;
          }
        }
        if (recovered == null) recovered = visible.get(0);
      }
      setActive(recovered);
      focused = recovered;
    } else if (active == null) {
      setActive(visible.get(0));
      focused = active;
    }
    if (focused == null || !visible.contains(focused)) focused = active;
    // scrollTo only means anything once the column has been laid out, and the
    // cursor card can be hundreds of rows down. The top card is scrolled to
    // zero rather than to itself, or the list's own top padding is cut off.
    final View card = cards.get(focused);
    final boolean atTop = visible.get(0) == focused;
    post(() -> scrollTo(0, atTop ? 0 : card.getTop()));
    dispatchCounts();
  }

  private void dispatchCounts() {
    if (visible.size() == lastVisibleCount) return;
    lastVisibleCount = visible.size();
    if (countsListener != null) countsListener.onCounts(lastVisibleCount);
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

  /**
   * Moves the cursor. The show it lands on only becomes the selected
   * (active) show once the cursor has sat still on it for DWELL_SELECT_MS --
   * arrow-key repeat while scrubbing through the list should not select
   * every show it passes over.
   */
  private void focus(Shows.Show show, boolean showFocus) {
    focus(show, showFocus, false);
  }

  /** immediate selects right away instead of arming the dwell timer. */
  private void focus(Shows.Show show, boolean showFocus, boolean immediate) {
    Shows.Show old = focused;
    focused = show;
    focusShown = showFocus;
    if (old != null) paint(cards.get(old));
    if (show != null) paint(cards.get(show));
    dwellHandler.removeCallbacks(dwellSelect);
    if (show == null || !showFocus) return;
    if (immediate) setActive(show);
    else dwellHandler.postDelayed(dwellSelect, DWELL_SELECT_MS);
  }

  /**
   * Scrolls only as far as needed to bring the cursor card into view -- not
   * on every move, only when it has gone above the top or below the bottom
   * of what is currently showing.
   */
  private void scrollToFocused() {
    if (focused == null) return;
    final View card = cards.get(focused);
    final boolean atTop = !visible.isEmpty() && visible.get(0) == focused;
    final boolean atBottom = !visible.isEmpty() && visible.get(visible.size() - 1) == focused;
    post(
        () -> {
          if (atTop) {
            scrollTo(0, 0);
            return;
          }
          if (atBottom) {
            scrollTo(0, Math.max(0, column.getHeight() - getHeight()));
            return;
          }
          int viewTop = getScrollY();
          int viewBottom = viewTop + getHeight();
          int cardTop = card.getTop();
          int cardBottom = cardTop + card.getHeight();
          if (cardTop < viewTop) scrollTo(0, cardTop);
          else if (cardBottom > viewBottom) scrollTo(0, cardBottom - getHeight());
        });
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
    boolean isActive = show != null && show == active;
    boolean inEmby = show == null || show.inEmby;
    // Square corners mark the one style that isn't Emby-active or Emby-normal:
    // a not-in-Emby row sitting unselected in the list.
    boolean square = !isActive && !inEmby;
    GradientDrawable bg = (GradientDrawable) card.getBackground();
    bg.setColor(isActive ? CARD_BG_SELECTED : (inEmby ? CARD_BG_EMBY : CARD_BG_NOT_EMBY));
    bg.setCornerRadius(square ? 0f : dp(CARD_CORNER_DP));
    bg.setStroke(
        show == focused && focusShown ? (int) dp(CARD_SELECTED_BORDER_DP) : 0,
        CARD_SELECTED_BORDER);
    LinearLayout row = (LinearLayout) card;
    ((TextView) row.getChildAt(0)).setTextColor(CARD_TEXT_LIGHT);
    ((TextView) row.getChildAt(1)).setTextColor(WAIT_COLOR);
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
    // Not yet active (nothing is, at build time), so a not-in-Emby show starts
    // in its square-corner rest style; paint() re-rounds it if it becomes active.
    bg.setCornerRadius(show.inEmby ? dp(CARD_CORNER_DP) : 0f);
    bg.setColor(show.inEmby ? CARD_BG_EMBY : CARD_BG_NOT_EMBY);
    card.setBackground(bg);

    TextView name = new TextView(getContext());
    name.setText(show.name);
    name.setTextColor(CARD_TEXT_LIGHT);
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

    if (!show.inEmby) {
      int size = (int) dp(TRASH_ICON_SIZE_DP);
      LinearLayout.LayoutParams trashParams = new LinearLayout.LayoutParams(size, size);
      trashParams.leftMargin = (int) dp(WAIT_GAP_DP);
      card.addView(buildTrashIcon(), trashParams);
    }

    return card;
  }

  /** Small drawn trash-can glyph, not-in-Emby rows only, far right of the row. */
  private View buildTrashIcon() {
    return new View(getContext()) {
      private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);

      {
        paint.setColor(TRASH_ICON_COLOR);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(dp(TRASH_ICON_STROKE_DP));
        paint.setStrokeCap(Paint.Cap.ROUND);
        paint.setStrokeJoin(Paint.Join.ROUND);
      }

      @Override
      protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        float w = getWidth();
        float h = getHeight();
        float lidY = h * 0.28f;
        canvas.drawLine(w * 0.12f, lidY, w * 0.88f, lidY, paint);
        canvas.drawLine(w * 0.38f, lidY, w * 0.38f, h * 0.08f, paint);
        canvas.drawLine(w * 0.62f, lidY, w * 0.62f, h * 0.08f, paint);
        canvas.drawLine(w * 0.38f, h * 0.08f, w * 0.62f, h * 0.08f, paint);
        Path body = new Path();
        body.moveTo(w * 0.22f, lidY);
        body.lineTo(w * 0.28f, h * 0.92f);
        body.lineTo(w * 0.72f, h * 0.92f);
        body.lineTo(w * 0.78f, lidY);
        canvas.drawPath(body, paint);
        canvas.drawLine(w * 0.4f, lidY + h * 0.1f, w * 0.42f, h * 0.82f, paint);
        canvas.drawLine(w * 0.6f, lidY + h * 0.1f, w * 0.58f, h * 0.82f, paint);
      }
    };
  }

  private float dp(float value) {
    return TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics());
  }
}
