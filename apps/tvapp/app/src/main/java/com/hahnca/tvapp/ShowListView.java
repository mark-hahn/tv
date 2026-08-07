package com.hahnca.tvapp;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Outline;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.LayerDrawable;
import android.os.Handler;
import android.os.Looper;
import android.text.Layout;
import android.text.TextPaint;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewOutlineProvider;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import org.json.JSONArray;

/**
 * The card list down the left half of the screen: one card per show, holding
 * its poster, name and waitStr. One card is selected at any time; nothing in
 * this list is ever focused, so the arrow keys move the selection itself.
 *
 * Every card is built up front rather than recycled — the list is a couple of
 * hundred shows and never changes while the app is open. Filtering and sorting
 * therefore only ever re-order cards that already exist, which is what lets the
 * list keep up with a filter being typed.
 */
class ShowListView extends ScrollView {

  private static final int CARD_BG = 0xFF2B2B2B;
  private static final int CARD_SELECTED_BORDER = 0xFF4444cc;
  private static final int CARD_TEXT_LIGHT = 0xFFFFFFFF;
  private static final float CARD_CORNER_DP = 8f;
  private static final float CARD_PAD_H_DP = 14f;
  private static final float CARD_PAD_V_DP = 8f;
  // Both halved off CARD_PAD_V_DP: the name line starts nearer the top of the
  // card and cardMisc runs nearer its bottom, neither changing its own height.
  private static final float CARD_PAD_TOP_DP = CARD_PAD_V_DP / 2f;
  private static final float CARD_PAD_BOTTOM_DP = CARD_PAD_V_DP / 2f;
  private static final float CARD_GAP_DP = 3f;
  // How far the card's own content sits inside the card body.
  private static final float CARD_CONTENT_INSET_DP = 3f;
  // The selection border is outside the content, and thick enough to fill the
  // whole run from this card's content to the next card's: this card's inset,
  // the gap between the two, and the next card's inset.
  private static final float CARD_SELECTED_BORDER_DP =
      2 * CARD_CONTENT_INSET_DP + CARD_GAP_DP;
  // Which is more room than the card has, so the border draws this much past
  // its edges.
  private static final float CARD_BORDER_OVERHANG_DP =
      CARD_SELECTED_BORDER_DP - CARD_CONTENT_INSET_DP;
  private static final float CARD_BODY_GAP_DP = 8f;
  private static final float LIST_PAD_DP = 12f;
  private static final float NAME_TEXT_SIZE_SP = 16.2f;
  private static final float FIELD_TEXT_SIZE_SP = 15.3f;
  // The metadata, which now rides on the end of the name row. Smaller than the
  // name beside it, and its own constant because FIELD_TEXT_SIZE_SP is what the
  // map labels and the empty-state messages use.
  private static final float INFO_TEXT_SIZE_SP = 12.24f;
  private static final float DESC_TEXT_SIZE_SP = 12.24f;
  // The band the description dissolves into the card over when it has more text
  // than cardMisc has room for.
  private static final float DESC_FADE_DP = 11f;
  private static final int MAX_GENRES = 3;
  // The name row's metadata, which stays as bright as the name beside it.
  private static final int FIELD_COLOR = 0xFFFFFFFF;
  // Everything in cardMisc below that row -- description, actor names, map
  // labels, empty-state messages -- at 80% white, so the top row leads.
  private static final int MISC_TEXT_COLOR = 0xCCFFFFFF;
  private static final int CARD_ROWS = 3;
  private static final float CARD_HEIGHT_PAD_V_DP = 2f;
  private static final float CARD_HEIGHT_GAP_DP = 1f;
  private static final float CARD_HEIGHT_FACTOR = 1.44f;
  private static final float CARD_IMAGE_ASPECT = 9f / 16f;
  // How far outside the viewport a card's media is still worth fetching, as a
  // fraction of the viewport height -- a screen either way, so a scroll lands
  // on cards that already have their images.
  private static final float MEDIA_PRELOAD = 1f;
  private static final int MEDIA_PLACEHOLDER_BG = 0xFF303030;
  private static final float MEDIA_GAP_DP = 10f;
  private static final float ACTOR_CARD_ASPECT = 0.62f; // width / height
  private static final float TRAILER_CARD_ASPECT = 16f / 9f; // width / height
  private static final float MEDIA_CARD_PAD_DP = 4f;
  private static final int TRAILER_CARD_BG = 0xFFD3D3D3;
  // Imdb's own video has no still to fetch, and no frame to pull out of it
  // either: the tv's decoder hands back a black frame from every point in it,
  // the same black the web client's video element shows. So the card says what
  // it is rather than sitting there as an empty box.
  private static final int TRAILER_IMDB_BG = 0xFF000000;
  private static final String TRAILER_IMDB_LABEL = "IMDB";
  // The cursor inside cardMisc -- the focused episode cell, actor card or
  // trailer card. Red, so it is never mistaken for the selected card's blue.
  private static final int FOCUS_BORDER = 0xFFFF0000;
  private static final float FOCUS_BORDER_DP = 3f;
  // The episode card's header, in the same red, so the card standing in for the
  // show's is never taken for the show's own.
  private static final int EPISODE_HEADER_COLOR = FOCUS_BORDER;
  private static final float ACTOR_NAME_TEXT_SIZE_SP = 10.8f;
  private static final float ACTOR_NAME_GAP_DP = 6f;
  private static final float MAP_SEASON_WIDTH_DP = 26f;
  private static final float MAP_ROW_GAP_DP = 4f;
  private static final float MAP_CELL_WIDTH_DP = 30f;
  private static final float MAP_CELL_HEIGHT_DP = 22f;
  private static final float MAP_CELL_GAP_DP = 2f;
  private static final float MAP_CELL_TEXT_SIZE_SP = 12f;
  private static final int MAP_CELL_TEXT_COLOR = 0xFF000000;
  private static final int MAP_CELL_BORDER = 0xFFCCCCCC;
  private static final int ED_AIRED = 0;
  private static final int ED_WATCHED = 1;
  private static final int ED_ID = 2;
  private static final int ED_FILE = 3;
  private static final int ED_RES = 4;
  private static final int ED_POS = 6;
  // One left/right press of the description, which has no cursor to move: a
  // couple of lines, so a held key runs down it at a readable rate.
  private static final int DESC_SCROLL_LINES = 2;
  // One left/right press of an actor or trailer strip in its plain sub-mode,
  // where again there is no cursor -- about a card and its gap.
  private static final float STRIP_SCROLL_DP = 120f;
  // The band an actor strip dissolves its two ends into, which is about a whole
  // actor card -- enough to read as more cards past it rather than as a shadow.
  private static final float STRIP_FADE_DP = 56f;
  private static final int TRASH_ICON_COLOR = 0xFFFF0000;
  private static final float TRASH_ICON_SIZE_DP = 16f;
  private static final float TRASH_ICON_STROKE_DP = 1.2f;

  interface SelectionListener {
    void onShowSelected(Shows.Show show);
  }

  interface CountsListener {
    void onCounts(int visibleCount);
  }

  interface FilterTextListener {
    void onFilterText(String text);
  }

  /**
   * The Actors cardMisc narrowing the show list to one actor's shows, and every
   * later thing that widens it again -- both of which are the activity's to do,
   * since the filter buttons and the label above the list are its.
   */
  interface ActorFilterListener {
    void onActorFilter(String actorName);
  }

  // The panes only follow the selection once it has stopped moving for this
  // long: arrow-key repeat down the list should not fetch and redraw every
  // show it passes over.
  private static final long PANE_DWELL_MS = 600;

  // The letter is there to steer a run of skips by, so it goes once the list
  // has come to rest and there is nothing left to steer.
  private static final long LETTER_BADGE_LINGER_MS = 1000;

  private static final String EMPTY_LABEL = "No Shows.";

  // One jump of the page-skip mode, which stands in for letter-skip in the
  // sorts where a show's first letter says nothing about where it sits.
  private static final int PAGE_CARDS = 20;

  private final LinearLayout column;
  private final TextView emptyView;
  private final List<Shows.Show> shows = new ArrayList<>(); // everything loaded
  private final List<Shows.Show> visible = new ArrayList<>(); // after filter and sort
  private final Map<Shows.Show, View> cards = new HashMap<>();
  private final Map<Shows.Show, FrameLayout> miscViews = new HashMap<>();
  private final Map<Shows.Show, List<MediaRequest>> mediaRequests = new HashMap<>();
  private final Set<MediaRequest> requestedMedia = new HashSet<>();
  private final Map<Shows.Show, ImageView> posters = new HashMap<>();
  private final Set<Shows.Show> requestedPosters = new HashSet<>();
  // The big letter overlay on the right of each row, shown only on the active
  // card while an up/down hold is in letter-skip mode.
  private final Map<Shows.Show, TextView> letterBadges = new HashMap<>();
  private final Map<String, Shows.Show> byName = new HashMap<>();
  private SelectionListener listener;
  private CountsListener countsListener;
  private FilterTextListener filterTextListener;
  private ActorFilterListener actorFilterListener;
  private int lastVisibleCount = -1;
  private Shows.Show active;
  private final Handler dwellHandler = new Handler(Looper.getMainLooper());
  private final Runnable notifySelection =
      () -> {
        if (listener != null && active != null) listener.onShowSelected(active);
      };
  // The card the letter is drawn on, so the timer that takes it away again
  // knows which one it belongs to even after the selection has moved on.
  private Shows.Show letterBadgeShow;
  private String filter = "";
  private Shows.Sort sort = Shows.Sort.ALPHA;
  private final Set<String> activeFilters = new HashSet<>();
  // The list tv-srvr worked out from the shared settings, names in its order,
  // or null when this view is filtering and sorting for itself.
  private List<String> customOrder;
  // Normalized actor name to require in the cast, or null — the Actors pane's
  // own way of narrowing this list, mutually exclusive with the other two.
  private String actorFilter;
  // The show setShows was told to keep selected, kept in the list even when the
  // freshly loaded data no longer matches the active filters. Watching an
  // episode is exactly what makes a show stop being Ready, so the reload on
  // coming back from Emby must not slide the selection onto a neighbor. Cleared
  // as soon as the selection moves off it, or the user changes the filters.
  private Shows.Show pinned;
  private final EdgeFade edgeFade = EdgeFade.vertical(this);
  private final int cardHeightPx;
  private final int posterWidthPx;
  // What the name row stands at, which is what cardMisc starts below.
  private final int nameLineHeightPx;
  private MiscMode miscMode = MiscMode.DESC;
  // How far into the mode cardMisc is: every mode starts at NONE, and the ok
  // key held steps it one deeper. Only the selected card ever leaves NONE.
  private SubMode subMode = SubMode.NONE;
  // The description of the selected card, which left and right scroll.
  private TextView descView;
  // The actor or trailer strip of the selected card, which left and right
  // scroll while its mode is at SubMode.NONE.
  private android.widget.HorizontalScrollView strip;
  // The strip's cards, and which of them the cursor is on -- actors or
  // trailers, whichever cardMisc is showing -- or -1 while there is no cursor.
  private final List<View> stripCards = new ArrayList<>();
  private int focusIndex = -1;
  // Which season row the Map mode is showing, as an index into the show's own
  // seasons rather than a season number, and which episode of it the cursor is
  // on once the mode is past SubMode.NONE.
  private int mapSeasonIndex;
  private int mapEpisodeIndex;
  // The episode card, which covers the selected show's card while Map is at
  // SubMode.CARD, and the two views on it that tv-srvr's answer fills in.
  private View episodeCard;
  private ImageView episodeStill;
  private TextView episodeDesc;
  private String todayKey = todayKey();

  ShowListView(Context context) {
    super(context);
    TextView probe = new TextView(context);
    probe.setTextSize(TypedValue.COMPLEX_UNIT_SP, NAME_TEXT_SIZE_SP);
    nameLineHeightPx = probe.getLineHeight();
    int rowHeight = probe.getLineHeight() + 2 * (int) dp(CARD_HEIGHT_PAD_V_DP);
    int textHeight = CARD_ROWS * rowHeight + (CARD_ROWS - 1) * (int) dp(CARD_HEIGHT_GAP_DP);
    cardHeightPx = Math.round(textHeight * CARD_HEIGHT_FACTOR);
    posterWidthPx = Math.round(cardHeightPx / CARD_IMAGE_ASPECT);

    column = new LinearLayout(context);
    column.setOrientation(LinearLayout.VERTICAL);
    int pad = (int) dp(LIST_PAD_DP);
    // Nothing on the right: a card reaches its column's own edge, so the only
    // thing between it and the pane beside it is MainActivity's column gap.
    column.setPadding(pad, pad, 0, pad);
    // The selected card's border draws past the card, over its neighbours and
    // into the list's own padding at the two ends.
    column.setClipChildren(false);
    column.setClipToPadding(false);
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

  void setFilterTextListener(FilterTextListener listener) {
    this.filterTextListener = listener;
  }

  void setActorFilterListener(ActorFilterListener listener) {
    this.actorFilterListener = listener;
  }

  /**
   * Substring of the name, case ignored -- what the phone's filter input screen
   * types. Leaves customOrder and actorFilter alone either way: everything that
   * does mean to replace them already says so explicitly at the call site
   * before reaching this.
   */
  void setFilter(String text) {
    if (filter.equals(text)) return;
    filter = text;
    if (filterTextListener != null) filterTextListener.onFilterText(filter);
    apply();
  }

  /**
   * Fills the list and restores the selection, falling back to the top card
   * when the remembered show is gone (renamed, or dropped out of Emby).
   */
  void setShows(List<Shows.Show> list, String selectedName) {
    shows.clear();
    shows.addAll(list);
    cards.clear();
    miscViews.clear();
    mediaRequests.clear();
    requestedMedia.clear();
    posters.clear();
    requestedPosters.clear();
    letterBadges.clear();
    byName.clear();
    hideEpisodeCard();
    column.removeAllViews();
    for (Shows.Show show : shows) byName.put(show.name, show);
    for (Shows.Show show : shows) {
      View card = buildCard(show);
      cards.put(show, card);
    }
    dwellHandler.removeCallbacks(notifySelection);
    active = null;
    pinned = null;
    resetSubMode();
    for (Shows.Show show : shows) {
      if (show.name.equals(selectedName)) {
        // Pinned before it is made active, so setActive below leaves the pin
        // alone and apply() keeps the card whatever the new data says.
        pinned = show;
        setActive(show);
      }
    }
    // Picks the top card when nothing was remembered, and lays the list out.
    apply();
  }

  /**
   * Toggling one of the checkbox filters (Ready, Drama, ...) only ever removes
   * or restores shows in place -- the remaining order is unaffected -- so the
   * selection recovery in apply() (nearest remaining show above) applies here,
   * unlike setSort/setCustomOrder/setActorFilter below which scramble the
   * order and so always drop back to the top.
   */
  private long applyAt;

  void setActiveFilters(Set<String> labels) {
    if (activeFilters.equals(labels)) return;
    activeFilters.clear();
    activeFilters.addAll(labels);
    // A filter the user just changed applies to every show, the pinned one
    // included -- the pin is only there to survive a data reload.
    pinned = null;
    apply();
  }

  /**
   * A new order puts the active show somewhere unpredictable in it, so the
   * list goes back to the top and takes whichever show lands there.
   */
  void setSort(Shows.Sort sort) {
    setSort(sort, false);
  }

  /**
   * keepSelection is for the callers that are re-sorting only as a side effect
   * of narrowing the list some other way, and are narrowing it around the show
   * that is selected -- the actor filter. The selection is theirs to keep.
   */
  void setSort(Shows.Sort sort, boolean keepSelection) {
    if (this.sort == sort && customOrder == null) return;
    customOrder = null;
    this.sort = sort;
    if (!keepSelection) clearActive();
    apply();
  }

  /**
   * Show exactly these shows, in exactly this order — tv-srvr's answer for the
   * shared settings, which are richer than this list's own filter and sort can
   * express. Null hands the list back to those.
   *
   * selectedName is the show that was selected where the settings were sent
   * from; null, or a name this order does not hold, leaves the top card
   * selected. It is made active before the cards are laid out so apply() keeps
   * it, rather than taking the top card and handing the panes a show that is
   * replaced a moment later.
   */
  void setCustomOrder(List<String> names, String selectedName) {
    customOrder = names;
    if (names != null) actorFilter = null;
    clearActive();
    if (names != null && selectedName != null && names.contains(selectedName)) {
      Shows.Show wanted = byName.get(selectedName);
      if (wanted != null) setActive(wanted);
    }
    apply();
  }

  /**
   * Narrows the list to shows this actor is cast in — the Actors pane's card
   * click, the same end state the web client reaches by selecting an actor and
   * pressing its Shows button. Null lifts the narrowing back off.
   *
   * The active show is left alone either way: the actor clicked always comes
   * from the active show's own cast, so it is always in the narrowed list, and
   * apply() below keeps a selection that is still visible. Landing anywhere
   * else would swap the show whose data the Actors pane (and every other pane)
   * is showing out from under the click that was just made on it.
   */
  void setActorFilter(String actorName) {
    String normalized = actorName == null ? null : Shows.normalizeName(actorName);
    if (Objects.equals(actorFilter, normalized)) return;
    actorFilter = normalized;
    if (actorFilter != null) customOrder = null;
    apply();
  }

  Shows.Show getSelected() {
    return active;
  }

  /**
   * The ok key: the next cardMisc mode for the selected show alone -- every
   * other card stays on its description -- back at the shallow end of it,
   * whatever sub-mode the one being left had been stepped into. A show with no
   * trailers has no trailer step: the mode is stepped past it rather than
   * landing on an empty strip.
   *
   * The actor filter is left alone. Rotating while it is up is rotating the
   * cardMisc of a card in the narrowed list, which is a list to browse like any
   * other; the filter buttons and the filter text are what lift it back off.
   */
  void rotateCardMisc() {
    if (active == null) return;
    resetSubMode();
    MiscMode[] modes = MiscMode.values();
    miscMode = modes[(miscMode.ordinal() + 1) % modes.length];
    if (miscMode == MiscMode.TRAILERS && !hasTrailers(active)) {
      miscMode = modes[(miscMode.ordinal() + 1) % modes.length];
    }
    if (miscMode == MiscMode.MAP) mapSeasonIndex = defaultSeasonIndex(active);
    renderMisc(active);
    loadVisibleMedia();
  }

  /**
   * The ok key held: one step deeper into the mode cardMisc is already showing.
   * Each mode has its own steps, and the deepest step of each simply stays put.
   */
  void okLongPress() {
    if (active == null) return;
    if (miscMode == MiscMode.MAP) {
      if (subMode == SubMode.NONE) {
        subMode = SubMode.FOCUS;
        mapEpisodeIndex = defaultEpisodeIndex();
      } else if (subMode == SubMode.FOCUS) {
        subMode = SubMode.CARD;
      } else {
        return;
      }
      renderMisc(active);
      loadVisibleMedia();
      return;
    }
    if (miscMode == MiscMode.ACTORS) {
      if (subMode == SubMode.NONE) {
        subMode = SubMode.FOCUS;
        focusIndex = stripCards.isEmpty() ? -1 : 0;
        paintStripFocus();
        scrollFocusIntoView();
        return;
      }
      // The focused actor's own shows, which is a filter over the whole list
      // rather than anything cardMisc can do by itself.
      String name = focusedActorName();
      if (name != null && actorFilterListener != null) actorFilterListener.onActorFilter(name);
      return;
    }
    if (miscMode == MiscMode.TRAILERS && subMode == SubMode.NONE) {
      subMode = SubMode.FOCUS;
      focusIndex = stripCards.isEmpty() ? -1 : 0;
      paintStripFocus();
      scrollFocusIntoView();
    }
  }

  /**
   * The left and right keys, which reach cardMisc and nothing else: what they
   * do is whatever the mode showing has to move through. direction is -1 for
   * left and +1 for right, back and forward through all of them.
   */
  void moveInCardMisc(int direction) {
    if (active == null) return;
    if (miscMode == MiscMode.DESC) {
      scrollDesc(direction);
    } else if (miscMode == MiscMode.MAP) {
      if (subMode == SubMode.NONE) stepSeason(direction);
      else stepEpisode(direction);
    } else if (subMode == SubMode.NONE) {
      scrollStrip(direction);
    } else {
      stepStripFocus(direction);
    }
  }

  /** Whether the trailer step is worth stopping on for this show. */
  private static boolean hasTrailers(Shows.Show show) {
    return !show.trailersReady || !show.trailers.isEmpty();
  }

  /** The trailer under the cursor, which is the only one the play key plays. */
  String focusedTrailerUrl() {
    if (miscMode != MiscMode.TRAILERS || subMode == SubMode.NONE || active == null) return null;
    if (focusIndex < 0 || focusIndex >= active.trailers.size()) return null;
    return active.trailers.get(focusIndex).url;
  }

  /** Whether an episode of the selected show is the thing the play key plays. */
  boolean hasEpisodeFocus() {
    return miscMode == MiscMode.MAP && subMode != SubMode.NONE && active != null;
  }

  /** Emby's own id for the episode under the cursor, or null when it has none. */
  String focusedEpisodeId() {
    JSONArray tuple = focusedEpisodeTuple();
    if (tuple == null) return null;
    String id = tuple.optString(ED_ID, "");
    return id.isEmpty() || "0".equals(id) ? null : id;
  }

  void onTrailersReady(Shows.Show show) {
    renderMisc(show);
    loadVisibleMedia();
  }

  /** Driven straight by tv-tv, not a click -- no sort or order to touch. */
  void selectByName(String name) {
    Shows.Show show = byName.get(name);
    if (show != null) {
      setActive(show);
      scrollToActive();
    }
  }

  /**
   * One show up or down. The selection moves at once -- there is no cursor to
   * move ahead of it -- while the panes wait out the dwell in setActive.
   */
  boolean moveSelection(int direction) {
    if (visible.isEmpty()) return false;
    int index = active == null ? 0 : visible.indexOf(active);
    if (index < 0) index = 0;
    int next = index + direction;
    if (next < 0 || next >= visible.size()) return false;
    setActive(visible.get(next), false);
    scrollToActive();
    return true;
  }

  /**
   * Letter-skip mode: jumps to the nearest show in the given direction whose
   * starting letter (leading "the" ignored, same as the alpha sort) differs
   * from the current one, and shows that letter in the row. Entered after an
   * up/down hold has been auto-repeating fast for a while -- see
   * MainActivity.handleRemoteKeyLetter.
   */
  boolean moveSelectionByLetter(int direction) {
    if (visible.isEmpty()) return false;
    int index = active == null ? 0 : visible.indexOf(active);
    if (index < 0) index = 0;
    String startKey = firstLetterKey(visible.get(index));
    int next = index;
    while (next + direction >= 0 && next + direction < visible.size()) {
      next += direction;
      if (!firstLetterKey(visible.get(next)).equals(startKey)) break;
    }
    if (next == index) return false;
    setActive(visible.get(next), false);
    scrollToActive();
    showLetterBadge(visible.get(next));
    return true;
  }

  /**
   * Page-skip mode: the same held-key jump as letter-skip, for the sorts where
   * the first letter is not what the list is in order of. Stops at the ends
   * rather than refusing a jump that would run past them.
   */
  boolean moveSelectionByPage(int direction) {
    if (visible.isEmpty()) return false;
    int index = active == null ? 0 : visible.indexOf(active);
    if (index < 0) index = 0;
    int next = Math.max(0, Math.min(visible.size() - 1, index + direction * PAGE_CARDS));
    if (next == index) return false;
    setActive(visible.get(next), false);
    scrollToActive();
    return true;
  }

  /** Whether the list is in the one order a show's first letter can be skipped by. */
  boolean isAlphaOrder() {
    return customOrder == null && sort == Shows.Sort.ALPHA;
  }

  private static String firstLetterKey(Shows.Show show) {
    String key = Shows.sortKey(show.name);
    return key.isEmpty() ? "" : key.substring(0, 1);
  }

  private final Runnable hideLetterBadgeSoon = () -> hideLetterBadge(letterBadgeShow);

  private void showLetterBadge(Shows.Show show) {
    TextView badge = letterBadges.get(show);
    View row = cards.get(show);
    if (badge == null || row == null) return;
    letterBadgeShow = show;
    // Restarted by every skip, so the letter stands for the whole run and only
    // the last one is timed.
    dwellHandler.removeCallbacks(hideLetterBadgeSoon);
    dwellHandler.postDelayed(hideLetterBadgeSoon, LETTER_BADGE_LINGER_MS);
    badge.setText(firstLetterKey(show).toUpperCase());
    int h = row.getHeight();
    // Well short of the card's own height: at 0.85 the line box of a card this
    // tall no longer fits inside it and the letter is clipped.
    if (h > 0) badge.setTextSize(TypedValue.COMPLEX_UNIT_PX, h * 0.6f);
    badge.setVisibility(View.VISIBLE);
  }

  private void hideLetterBadge(Shows.Show show) {
    TextView badge = show == null ? null : letterBadges.get(show);
    if (badge != null) badge.setVisibility(View.GONE);
    if (show != null && show == letterBadgeShow) {
      letterBadgeShow = null;
      dwellHandler.removeCallbacks(hideLetterBadgeSoon);
    }
  }

  @Override
  protected void onSizeChanged(int w, int h, int oldw, int oldh) {
    super.onSizeChanged(w, h, oldw, oldh);
    edgeFade.resize(h);
    if (w != oldw) renderAllMisc();
    loadVisibleMedia();
  }

  @Override
  protected void onScrollChanged(int l, int t, int oldl, int oldt) {
    super.onScrollChanged(l, t, oldl, oldt);
    invalidate();
    loadVisibleMedia();
  }

  /**
   * Fetches the cardMisc images on screen, and of the screenful either side of
   * them. Hundreds of cards exist at once, so they cannot all have their images
   * asked for up front; requestedMedia keeps a view from asking twice, while
   * Images' own tag keeps stale loads from landing after cardMisc rotates.
   */
  private void loadVisibleMedia() {
    if (getHeight() == 0 || visible.isEmpty()) return;
    android.util.Log.i("tvapp", "trash timing: loadVisibleMedia");
    int margin = (int) (getHeight() * MEDIA_PRELOAD);
    int top = getScrollY() - margin;
    int bottom = getScrollY() + getHeight() + margin;
    for (Shows.Show show : visible) {
      View card = cards.get(show);
      if (card.getBottom() < top || card.getTop() > bottom) continue;
      if (requestedPosters.add(show)) {
        ImageView poster = posters.get(show);
        if (poster != null) {
          // The width the card actually draws it at, both times: Emby resizes
          // server-side, so the image arrives at exactly that and is decoded and
          // drawn 1:1 with nothing left to rescale on this end.
          Backdrops.get(
              show,
              posterWidthPx,
              candidates -> {
                ImageView current = posters.get(show);
                if (current == null) return;
                String[] urls = Arrays.copyOf(candidates, candidates.length + 1);
                urls[candidates.length] = show.image;
                Images.intoThumb(current, urls, posterWidthPx, show);
              });
        }
      }
      List<MediaRequest> requests = mediaRequests.get(show);
      if (requests == null) continue;
      for (MediaRequest request : requests) {
        if (!requestedMedia.add(request)) continue;
        Images.into(request.view, request.url, request);
      }
    }
  }

  @Override
  protected void dispatchDraw(Canvas canvas) {
    super.dispatchDraw(canvas);
    edgeFade.draw(canvas);
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
    applyAt = android.os.SystemClock.uptimeMillis();
    android.util.Log.i("tvapp", "trash timing: apply visible=" + visible.size());
    column.removeAllViews();
    if (visible.isEmpty()) {
      LinearLayout.LayoutParams params =
          new LinearLayout.LayoutParams(
              ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
      column.addView(emptyView, params);
      if (active != null) clearActive();
      dispatchCounts();
      return;
    }
    for (Shows.Show show : visible) {
      LinearLayout.LayoutParams params =
          new LinearLayout.LayoutParams(
              ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
      params.bottomMargin = (int) dp(CARD_GAP_DP);
      column.addView(cards.get(show), params);
    }
    android.util.Log.i(
        "tvapp",
        "trash timing: addView done in "
            + (android.os.SystemClock.uptimeMillis() - applyAt)
            + "ms");
    // A selected show the filter has just hidden lands on the nearest remaining
    // show above where it was -- not simply the new top of the list -- so a
    // filter typed while browsing does not fling the selection to the far end.
    if (active != null && !visible.contains(active)) {
      Shows.Show recovered = null;
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
      setActive(recovered);
    } else if (active == null) {
      setActive(visible.get(0));
    }
    // scrollTo only means anything once the column has been laid out, and the
    // selected card can be hundreds of rows down. The top card is scrolled to
    // zero rather than to itself, or the list's own top padding is cut off.
    // Every other card stops a fade's height short of the top edge, the same
    // allowance scrollToActive makes, or the selected card lands under the
    // fade with its own text dimmed.
    final View card = cards.get(active);
    final boolean atTop = visible.get(0) == active;
    post(
        () -> {
          scrollTo(0, atTop ? 0 : card.getTop() - (int) edgeFade.size());
          // Explicitly, since a re-order that leaves the scroll position alone
          // still puts different cards on screen.
          loadVisibleMedia();
        });
    dispatchCounts();
  }

  private void dispatchCounts() {
    if (visible.size() == lastVisibleCount) return;
    lastVisibleCount = visible.size();
    if (countsListener != null) countsListener.onCounts(lastVisibleCount);
  }

  private boolean matchesActiveFilters(Shows.Show show) {
    // Non-Emby ("trash") shows are hidden unless the Trash filter is active.
    if (show == pinned) return true;
    if (!activeFilters.contains("Trash") && !show.inEmby) return false;
    // Not-ready shows are hidden unless the Ready filter is active.
    if (!activeFilters.contains("Ready") && (show.notReady || !show.waitStr.isEmpty())) return false;
    for (String label : activeFilters) {
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
    pinned = null;
    if (active == null) return;
    Shows.Show old = active;
    active = null;
    dwellHandler.removeCallbacks(notifySelection);
    hideLetterBadge(old);
    paint(cards.get(old));
    // The rotation belongs to the selected card, and there is none now. Without
    // this the card just deselected keeps drawing whatever mode it was on --
    // setActive cannot put it right afterwards, because by then it is not the
    // old active any more. This is the path a sort change takes.
    resetSubMode();
    if (miscMode != MiscMode.DESC) {
      miscMode = MiscMode.DESC;
      renderMisc(old);
    }
  }

  private void setActive(Shows.Show show) {
    setActive(show, true);
  }

  /**
   * The selected card, painted at once either way. dwell holds the panes back
   * until the selection has stopped moving for PANE_DWELL_MS -- arrow-key
   * repeat down the list should not load every show it passes over -- while
   * everything that jumps straight to one show tells them right away.
   */
  private void setActive(Shows.Show show, boolean notifyNow) {
    if (show == active) return;
    // The pin belongs to one show, and only while it is the selected one.
    if (show != pinned) pinned = null;
    Shows.Show old = active;
    active = show;
    if (old != null) {
      hideLetterBadge(old);
      paint(cards.get(old));
    }
    paint(cards.get(show));
    // Moving the selection puts the rotation back to the start, so every card
    // is on its description again: the one being left is redrawn to drop the
    // mode it was showing. The one arrived at is redrawn too, even though its
    // description is already what it is showing -- that is what hands the left
    // and right keys the description they are to scroll.
    resetSubMode();
    boolean wasRotated = miscMode != MiscMode.DESC;
    miscMode = MiscMode.DESC;
    if (old != null && wasRotated) renderMisc(old);
    renderMisc(show);
    dwellHandler.removeCallbacks(notifySelection);
    if (notifyNow) notifySelection.run();
    else dwellHandler.postDelayed(notifySelection, PANE_DWELL_MS);
  }

  /**
   * Scrolls only as far as needed to bring the selected card into view -- not
   * on every move, only when it has gone above the top or below the bottom
   * of what is currently showing. The edge fade is counted as out of view, or
   * stepping the selection to the edge would leave it sitting under the fade
   * with its own text dimmed.
   */
  private void scrollToActive() {
    if (active == null) return;
    final View card = cards.get(active);
    final boolean atTop = !visible.isEmpty() && visible.get(0) == active;
    final boolean atBottom = !visible.isEmpty() && visible.get(visible.size() - 1) == active;
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
          int fade = (int) edgeFade.size();
          int viewTop = getScrollY();
          int viewBottom = viewTop + getHeight();
          int cardTop = card.getTop();
          int cardBottom = cardTop + card.getHeight();
          if (cardTop - fade < viewTop) scrollTo(0, cardTop - fade);
          else if (cardBottom + fade > viewBottom) scrollTo(0, cardBottom + fade - getHeight());
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
    LayerDrawable bg = (LayerDrawable) card.getBackground();
    GradientDrawable border = (GradientDrawable) bg.getDrawable(1);
    border.setStroke(isActive ? (int) dp(CARD_SELECTED_BORDER_DP) : 0, CARD_SELECTED_BORDER);
    // The border reaches over the card below, and that one is drawn after this
    // one, so the selected card is lifted above its neighbours to stay whole.
    card.setTranslationZ(isActive ? 1f : 0f);
  }

  /**
   * The card body, and the selection border outside it. The border layer is
   * inset negatively so it can draw past the card's own edges, which is the
   * only way it reaches the content of the cards above and below. Its stroke
   * is set by paint(); the body is layer 0, so the outline -- and with it the
   * card's corner clipping -- still comes from the body alone.
   */
  private LayerDrawable newCardBackground() {
    GradientDrawable body = new GradientDrawable();
    body.setCornerRadius(dp(CARD_CORNER_DP));
    body.setColor(CARD_BG);
    GradientDrawable border = new GradientDrawable();
    border.setCornerRadius(dp(CARD_CORNER_DP) + dp(CARD_BORDER_OVERHANG_DP));
    LayerDrawable bg = new LayerDrawable(new Drawable[] {body, border});
    int overhang = -(int) dp(CARD_BORDER_OVERHANG_DP);
    bg.setLayerInset(1, overhang, overhang, overhang, overhang);
    return bg;
  }

  private static boolean hasActor(Shows.Show show, String normalizedName) {
    for (Shows.Actor actor : show.characters) {
      if (Shows.normalizeName(actor.name).equals(normalizedName)) return true;
    }
    return false;
  }

  private View buildCard(Shows.Show show) {
    // Everything on one line: the name, then the trash can for a show that is
    // not in Emby, then the metadata run together with dashes. Baselines rather
    // than box edges, so the smaller metadata sits on the name's own bottom.
    LinearLayout nameRow = new LinearLayout(getContext());
    nameRow.setOrientation(LinearLayout.HORIZONTAL);
    nameRow.setGravity(Gravity.BOTTOM);
    nameRow.setBaselineAligned(true);

    TextView name = new TextView(getContext());
    name.setText(show.name);
    name.setTextColor(CARD_TEXT_LIGHT);
    name.setTextSize(TypedValue.COMPLEX_UNIT_SP, NAME_TEXT_SIZE_SP);
    name.setSingleLine(true);
    name.setEllipsize(android.text.TextUtils.TruncateAt.END);
    // Zero width plus the row's only weight: the metadata and the trash can are
    // measured at what they need and the name takes whatever is left, so a name
    // too long for the rest of the row is the thing that gets its end trimmed.
    LinearLayout.LayoutParams nameParams =
        new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
    nameRow.addView(name, nameParams);

    if (!show.inEmby) {
      int size = (int) dp(TRASH_ICON_SIZE_DP);
      LinearLayout.LayoutParams trashParams = new LinearLayout.LayoutParams(size, size);
      trashParams.leftMargin = (int) dp(CARD_BODY_GAP_DP);
      trashParams.gravity = Gravity.BOTTOM;
      nameRow.addView(buildTrashIcon(), trashParams);
    }

    TextView info = new TextView(getContext());
    info.setText(
      joinDash(
        year(show.firstAired),
        show.status,
        watchedText(show),
        show.originalCountry.toUpperCase(Locale.US),
        show.averageRuntime > 0 ? show.averageRuntime + " Mins" : "",
        firstGenres(show.genres)));
    info.setTextColor(FIELD_COLOR);
    info.setTextSize(TypedValue.COMPLEX_UNIT_SP, INFO_TEXT_SIZE_SP);
    info.setSingleLine(true);
    LinearLayout.LayoutParams infoParams =
      new LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    infoParams.leftMargin = (int) dp(CARD_BODY_GAP_DP);
    nameRow.addView(info, infoParams);

    // Under the name row and full width, running from there to the bottom of
    // the card -- which is the height its actor and trailer cards take.
    FrameLayout misc = new FrameLayout(getContext());
    LinearLayout.LayoutParams miscParams =
      new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
    miscParams.topMargin = (int) dp(CARD_BODY_GAP_DP);
    miscViews.put(show, misc);

    // A FrameLayout wrapper, not just the row itself, so the letter-skip
    // badge below can sit on top of the row without disturbing its layout.
    FrameLayout card = new FrameLayout(getContext());
    int inset = (int) dp(CARD_CONTENT_INSET_DP);
    card.setPadding(inset, inset, inset, inset);
    card.setBackground(newCardBackground());
    // Deliberately not clipped to its own outline: that clip would take the
    // selection border back off at the card's edge, which is the one place it
    // has to get past. The corner clipping the card used to do for the poster
    // is outerRow's own now, and the outline is left as shape for the shadow
    // alone -- transparent, so the lift in paint() casts none.
    card.setOutlineProvider(
        new ViewOutlineProvider() {
          @Override
          public void getOutline(View view, Outline outline) {
            outline.setRoundRect(0, 0, view.getWidth(), view.getHeight(), dp(CARD_CORNER_DP));
            outline.setAlpha(0f);
          }
        });

    ImageView poster = new ImageView(getContext());
    poster.setScaleType(ImageView.ScaleType.CENTER_CROP);
    poster.setBackgroundColor(MEDIA_PLACEHOLDER_BG);
    posters.put(show, poster);

    LinearLayout content = new LinearLayout(getContext());
    content.setOrientation(LinearLayout.VERTICAL);
    content.setPadding(
      (int) dp(CARD_PAD_H_DP),
      (int) dp(CARD_PAD_TOP_DP),
      (int) dp(CARD_PAD_H_DP),
      (int) dp(CARD_PAD_BOTTOM_DP));
    content.addView(nameRow, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    content.addView(misc, miscParams);

    LinearLayout outerRow = new LinearLayout(getContext());
    outerRow.setOrientation(LinearLayout.HORIZONTAL);
    // The body's corners, at the radius left of the card's own once the card's
    // inset is taken off it, and what rounds the backdrop's outer corners.
    GradientDrawable bodyBg = new GradientDrawable();
    bodyBg.setCornerRadius(Math.max(0f, dp(CARD_CORNER_DP) - dp(CARD_CONTENT_INSET_DP)));
    bodyBg.setColor(CARD_BG);
    outerRow.setBackground(bodyBg);
    outerRow.setClipToOutline(true);
    outerRow.addView(poster, new LinearLayout.LayoutParams(posterWidthPx, ViewGroup.LayoutParams.MATCH_PARENT));
    outerRow.addView(content, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f));
    card.addView(
      outerRow,
      new FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, cardHeightPx - 2 * inset));

    TextView letter = new TextView(getContext());
    letter.setTextColor(CARD_TEXT_LIGHT);
    letter.setTypeface(Typeface.DEFAULT_BOLD);
    letter.setGravity(Gravity.CENTER);
    letter.setVisibility(View.GONE);
    FrameLayout.LayoutParams letterParams =
        new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.END | Gravity.CENTER_VERTICAL);
    letterParams.rightMargin = (int) dp(CARD_PAD_H_DP);
    card.addView(letter, letterParams);
    letterBadges.put(show, letter);

    renderMisc(show);

    return card;
  }

  private static String joinDash(String... parts) {
    StringBuilder out = new StringBuilder();
    for (String part : parts) {
      if (part == null || part.isEmpty()) continue;
      if (out.length() > 0) out.append(" - ");
      out.append(part);
    }
    return out.toString();
  }

  private static String watchedText(Shows.Show show) {
    if (show.episodeCount <= 0 || show.watchedCount < 0) return "";
    if (show.watchedCount == show.episodeCount) {
      return "Viewed all";
    }
    return "Viewed " + show.watchedCount + " of " + show.episodeCount;
  }

  /** The year out of a "yyyy/MM/dd" date, or whatever was there if it is not one. */
  private static String year(String date) {
    return date.length() >= 4 ? date.substring(0, 4) : date;
  }

  /** The first few genres of a ", "-joined list, the rest being more than a line wants. */
  private static String firstGenres(String genres) {
    if (genres.isEmpty()) return genres;
    String[] parts = genres.split(", ");
    if (parts.length <= MAX_GENRES) return genres;
    StringBuilder out = new StringBuilder();
    for (int i = 0; i < MAX_GENRES; i++) {
      if (i > 0) out.append(", ");
      out.append(parts[i]);
    }
    return out.toString();
  }

  private void renderAllMisc() {
    mediaRequests.clear();
    requestedMedia.clear();
    for (Shows.Show show : shows) renderMisc(show);
  }

  /**
   * Only the selected card follows the rotated mode; the rest stay on their
   * description, which is what makes rotating a thing that happens to one show
   * rather than to the whole list.
   */
  private void renderMisc(Shows.Show show) {
    FrameLayout misc = miscViews.get(show);
    if (misc == null) return;
    misc.removeAllViews();
    // The old requests go out of the dedup set with them, or this card's new
    // views would be left waiting on requests that have already been made.
    List<MediaRequest> old = mediaRequests.remove(show);
    if (old != null) requestedMedia.removeAll(old);
    MiscMode mode = show == active ? miscMode : MiscMode.DESC;
    // The views left and right act on belong to the selected card alone, and
    // are gone the moment that card is drawn again.
    if (show == active) {
      descView = null;
      strip = null;
      stripCards.clear();
      hideEpisodeCard();
    }
    if (mode == MiscMode.DESC) renderDescMisc(show, misc);
    else if (mode == MiscMode.MAP) renderMapMisc(show, misc);
    else if (mode == MiscMode.ACTORS) renderActorsMisc(show, misc);
    else renderTrailersMisc(show, misc);
    if (show == active && mode == MiscMode.MAP && subMode == SubMode.CARD) showEpisodeCard();
  }

  /**
   * Back to the shallow end of whatever mode cardMisc is on, and with it the
   * views the left and right keys were acting on -- whatever is drawn next puts
   * back the ones it has.
   */
  private void resetSubMode() {
    subMode = SubMode.NONE;
    focusIndex = -1;
    mapEpisodeIndex = 0;
    descView = null;
    strip = null;
    stripCards.clear();
    hideEpisodeCard();
  }

  /**
   * The focused episode's own card, which covers the selected show's card
   * exactly -- same size, same place -- rather than taking room of its own.
   * Rebuilt from scratch on every move, since a move is a different episode.
   */
  private void showEpisodeCard() {
    hideEpisodeCard();
    if (active == null) return;
    int season = focusedSeason();
    if (season < 0) return;
    View card = cards.get(active);
    if (!(card instanceof FrameLayout)) return;
    int episode = mapEpisodeIndex + 1;
    episodeCard = buildEpisodeCard(active, season, episode);
    int inset = (int) dp(CARD_CONTENT_INSET_DP);
    ((FrameLayout) card)
        .addView(
            episodeCard,
            new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, cardHeightPx - 2 * inset));
    fillEpisodeCard(active, season, episode);
  }

  /** The back key one level out of the episode card, back to its season row. */
  boolean closeEpisodeCard() {
    if (miscMode != MiscMode.MAP || subMode != SubMode.CARD) return false;
    subMode = SubMode.FOCUS;
    renderMisc(active);
    loadVisibleMedia();
    return true;
  }

  private void hideEpisodeCard() {
    if (episodeCard == null) return;
    ViewGroup parent = (ViewGroup) episodeCard.getParent();
    if (parent != null) parent.removeView(episodeCard);
    episodeCard = null;
  }

  /**
   * The same parts as the web client's episode pane under its map -- the still
   * and the description -- laid out as the show card it replaces: the still
   * where the backdrop was, and a header line where the name was. The header is
   * red, so an episode card is never taken for the show card at a glance.
   */
  private View buildEpisodeCard(Shows.Show show, int season, int episode) {
    LinearLayout outerRow = new LinearLayout(getContext());
    outerRow.setOrientation(LinearLayout.HORIZONTAL);
    GradientDrawable bodyBg = new GradientDrawable();
    bodyBg.setCornerRadius(Math.max(0f, dp(CARD_CORNER_DP) - dp(CARD_CONTENT_INSET_DP)));
    bodyBg.setColor(CARD_BG);
    outerRow.setBackground(bodyBg);
    outerRow.setClipToOutline(true);

    ImageView still = new ImageView(getContext());
    still.setScaleType(ImageView.ScaleType.CENTER_CROP);
    still.setBackgroundColor(MEDIA_PLACEHOLDER_BG);
    outerRow.addView(
        still,
        new LinearLayout.LayoutParams(posterWidthPx, ViewGroup.LayoutParams.MATCH_PARENT));

    LinearLayout content = new LinearLayout(getContext());
    content.setOrientation(LinearLayout.VERTICAL);
    content.setPadding(
        (int) dp(CARD_PAD_H_DP),
        (int) dp(CARD_PAD_TOP_DP),
        (int) dp(CARD_PAD_H_DP),
        (int) dp(CARD_PAD_BOTTOM_DP));

    TextView header = new TextView(getContext());
    header.setText(show.name + ", Season " + season + ", Episode " + episode);
    header.setTextColor(EPISODE_HEADER_COLOR);
    header.setTextSize(TypedValue.COMPLEX_UNIT_SP, NAME_TEXT_SIZE_SP);
    header.setSingleLine(true);
    header.setEllipsize(android.text.TextUtils.TruncateAt.END);
    content.addView(
        header,
        new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

    TextView desc = new TextView(getContext());
    desc.setTextColor(MISC_TEXT_COLOR);
    desc.setTextSize(TypedValue.COMPLEX_UNIT_SP, DESC_TEXT_SIZE_SP);
    FadingBox box = new FadingBox(getContext());
    box.addView(
        desc,
        new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
            Gravity.TOP));
    LinearLayout.LayoutParams boxParams =
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
    boxParams.topMargin = (int) dp(CARD_BODY_GAP_DP);
    content.addView(box, boxParams);

    outerRow.addView(
        content, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f));
    episodeStill = still;
    episodeDesc = desc;
    return outerRow;
  }

  /**
   * The still and the description, which are a tv-srvr call away. Asked for
   * only once the card is the one on screen: an episode already looked up
   * answers on this same call, and a card that has not been taken as the
   * current one yet would throw that answer away as stale.
   */
  private void fillEpisodeCard(Shows.Show show, int season, int episode) {
    final View card = episodeCard;
    final ImageView still = episodeStill;
    final TextView desc = episodeDesc;
    Episodes.get(
        show,
        season,
        episode,
        info -> {
          // The cursor may have moved on while tv-srvr was answering, and this
          // card is thrown away and rebuilt on every move.
          if (episodeCard != card) return;
          desc.setText(info.overview);
          if (!info.image.isEmpty()) Images.into(still, info.image, card);
        });
  }

  private void renderDescMisc(Shows.Show show, FrameLayout misc) {
    TextView desc = new TextView(getContext());
    desc.setText(show.overview.isEmpty() ? "No description." : show.overview);
    desc.setTextColor(MISC_TEXT_COLOR);
    desc.setTextSize(TypedValue.COMPLEX_UNIT_SP, DESC_TEXT_SIZE_SP);
    if (show == active) descView = desc;
    // No line cap and no ellipsis: whatever runs past the bottom of cardMisc is
    // cut off there, under the fade the box below paints over it.
    FadingBox box = new FadingBox(getContext());
    box.addView(
        desc,
        new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
            Gravity.TOP));
    misc.addView(
        box,
        new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
  }

  /**
   * Holds the description and fades whichever end of it has more text past it
   * into the card, so the cut never lands mid-letter. Both ends are scroll
   * positions, not fixed: the top fades once the text has been scrolled off it,
   * and the bottom stops fading once the last line has been scrolled to.
   *
   * The text view is the height of the box, so how much text there really is
   * has to come from the layout it built rather than from its own height.
   */
  private class FadingBox extends FrameLayout {

    private final Paint topPaint = new Paint();
    private final Paint bottomPaint = new Paint();
    private int fadeHeight;

    FadingBox(Context context) {
      super(context);
      setWillNotDraw(false);
    }

    @Override
    protected void onSizeChanged(int w, int h, int oldw, int oldh) {
      super.onSizeChanged(w, h, oldw, oldh);
      fadeHeight = Math.min(h, (int) dp(DESC_FADE_DP));
      topPaint.setShader(
          new LinearGradient(
              0, 0, 0, fadeHeight, CARD_BG, CARD_BG & 0x00FFFFFF, Shader.TileMode.CLAMP));
      bottomPaint.setShader(
          new LinearGradient(
              0, h - fadeHeight, 0, h, CARD_BG & 0x00FFFFFF, CARD_BG, Shader.TileMode.CLAMP));
    }

    @Override
    protected void dispatchDraw(Canvas canvas) {
      super.dispatchDraw(canvas);
      if (getChildCount() == 0 || fadeHeight <= 0) return;
      View child = getChildAt(0);
      if (!(child instanceof TextView)) return;
      TextView text = (TextView) child;
      Layout layout = text.getLayout();
      if (layout == null) return;
      int hidden = overflow(text, layout);
      int scrolled = text.getScrollY();
      if (scrolled > 0) canvas.drawRect(0, 0, getWidth(), fadeHeight, topPaint);
      if (scrolled < hidden) {
        canvas.drawRect(0, getHeight() - fadeHeight, getWidth(), getHeight(), bottomPaint);
      }
    }
  }

  /** How much of the text is past the bottom of the box it is drawn in. */
  private static int overflow(TextView text, Layout layout) {
    int needed = layout.getHeight() + text.getPaddingTop() + text.getPaddingBottom();
    return Math.max(0, needed - text.getHeight());
  }

  /**
   * One season row, which season being the left and right keys' to choose while
   * Map is at SubMode.NONE. Deeper than that they choose an episode of it
   * instead, and the row draws a cursor on the one they are on.
   */
  private void renderMapMisc(Shows.Show show, FrameLayout misc) {
    List<Integer> seasons = seasonsPresent(show.episodeData);
    if (seasons.isEmpty()) {
      misc.addView(message("No episodes."), centerWrap());
      return;
    }
    int index = show == active ? clampSeasonIndex(seasons) : defaultSeasonIndex(show);
    misc.addView(
        mapSeasonRow(show, seasons.get(index)),
        new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
  }

  private int clampSeasonIndex(List<Integer> seasons) {
    mapSeasonIndex = Math.max(0, Math.min(seasons.size() - 1, mapSeasonIndex));
    return mapSeasonIndex;
  }

  private LinearLayout mapSeasonRow(Shows.Show show, int season) {
    LinearLayout row = new LinearLayout(getContext());
    row.setOrientation(LinearLayout.HORIZONTAL);
    row.setGravity(Gravity.TOP);
    TextView label = message(String.valueOf(season));
    label.setGravity(Gravity.CENTER);
    row.addView(label, new LinearLayout.LayoutParams((int) dp(MAP_SEASON_WIDTH_DP), (int) dp(MAP_CELL_HEIGHT_DP)));

    boolean focusable = show == active && subMode != SubMode.NONE;
    JSONArray episodes = show.episodeData == null ? null : show.episodeData.optJSONArray(season);
    int count = episodes == null ? 0 : episodes.length();
    if (focusable) mapEpisodeIndex = Math.max(0, Math.min(Math.max(0, count - 1), mapEpisodeIndex));
    FlowLayout cells = new FlowLayout(getContext());
    for (int i = 0; i < count; i++) {
      cells.addView(
          mapCell(show, episodes.optJSONArray(i), focusable && i == mapEpisodeIndex),
          mapCellParams());
    }
    row.addView(cells, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
    return row;
  }

  private View mapCell(Shows.Show show, JSONArray tuple, boolean focused) {
    boolean played = tuple != null && tuple.optInt(ED_WATCHED, 0) == 1;
    boolean hasFile = tuple != null && !tuple.optString(ED_FILE, "").isEmpty() && !"0".equals(tuple.optString(ED_FILE, ""));
    boolean noFile = tuple != null && !hasFile;
    String aired = tuple == null ? "" : tuple.optString(ED_AIRED, "");
    boolean unaired = noFile && isFutureDate(aired);
    int quality = tuple == null ? 0 : tuple.optInt(ED_RES, 0);
    long pos = tuple == null ? 0 : tuple.optLong(ED_POS, 0);

    TextView view = new TextView(getContext());
    view.setText(
        tuple == null
            ? ""
            : MapCells.text(played, hasFile, noFile, unaired, quality, pos, show.inEmby));
    view.setTextColor(MAP_CELL_TEXT_COLOR);
    view.setTextSize(TypedValue.COMPLEX_UNIT_SP, MAP_CELL_TEXT_SIZE_SP);
    view.setGravity(Gravity.CENTER);
    view.setSingleLine(true);
    GradientDrawable bg = new GradientDrawable();
    bg.setColor(tuple == null ? MapCells.BG_NORMAL : MapCells.background(false, noFile));
    if (focused) bg.setStroke((int) dp(FOCUS_BORDER_DP), FOCUS_BORDER);
    else bg.setStroke((int) dp(1f), MAP_CELL_BORDER);
    view.setBackground(bg);
    return view;
  }

  private ViewGroup.MarginLayoutParams mapCellParams() {
    ViewGroup.MarginLayoutParams params =
        new ViewGroup.MarginLayoutParams((int) dp(MAP_CELL_WIDTH_DP), (int) dp(MAP_CELL_HEIGHT_DP));
    params.rightMargin = (int) dp(MAP_CELL_GAP_DP);
    params.bottomMargin = (int) dp(MAP_CELL_GAP_DP);
    return params;
  }

  /**
   * The season Map opens on: the one being watched through, else the last one
   * with anything watched in it, else the first with a file, else simply the
   * first there is. An index into seasonsPresent, which is what the left and
   * right keys step through.
   */
  private int defaultSeasonIndex(Shows.Show show) {
    List<Integer> seasons = seasonsPresent(show.episodeData);
    if (seasons.isEmpty()) return 0;
    int season = seasonWithWatchedTransition(show.episodeData, seasons);
    if (season < 0) season = lastSeasonWithWatched(show.episodeData, seasons);
    if (season < 0) season = firstSeasonWithFile(show.episodeData, seasons);
    int index = seasons.indexOf(season);
    return index < 0 ? 0 : index;
  }

  private List<Integer> seasonsPresent(JSONArray episodeData) {
    List<Integer> seasons = new ArrayList<>();
    for (int season = 0; episodeData != null && season < episodeData.length(); season++) {
      JSONArray episodes = episodeData.optJSONArray(season);
      if (hasAnyEpisode(episodes)) seasons.add(season);
    }
    return seasons;
  }

  private boolean hasAnyEpisode(JSONArray episodes) {
    for (int i = 0; episodes != null && i < episodes.length(); i++) {
      if (episodes.optJSONArray(i) != null) return true;
    }
    return false;
  }

  private int seasonWithWatchedTransition(JSONArray episodeData, List<Integer> seasons) {
    for (int season : seasons) {
      JSONArray episodes = episodeData.optJSONArray(season);
      boolean sawWatched = false;
      for (int i = 0; episodes != null && i < episodes.length(); i++) {
        JSONArray tuple = episodes.optJSONArray(i);
        if (tuple == null) continue;
        boolean watched = tuple.optInt(ED_WATCHED, 0) == 1;
        if (sawWatched && !watched) return season;
        if (watched) sawWatched = true;
      }
    }
    return -1;
  }

  private int lastSeasonWithWatched(JSONArray episodeData, List<Integer> seasons) {
    for (int i = seasons.size() - 1; i >= 0; i--) {
      int season = seasons.get(i);
      JSONArray episodes = episodeData.optJSONArray(season);
      for (int e = 0; episodes != null && e < episodes.length(); e++) {
        JSONArray tuple = episodes.optJSONArray(e);
        if (tuple != null && tuple.optInt(ED_WATCHED, 0) == 1) return season;
      }
    }
    return -1;
  }

  private int firstSeasonWithFile(JSONArray episodeData, List<Integer> seasons) {
    for (int season : seasons) {
      JSONArray episodes = episodeData.optJSONArray(season);
      for (int e = 0; episodes != null && e < episodes.length(); e++) {
        JSONArray tuple = episodes.optJSONArray(e);
        if (tuple != null && !tuple.optString(ED_FILE, "").isEmpty() && !"0".equals(tuple.optString(ED_FILE, ""))) return season;
      }
    }
    return -1;
  }

  /**
   * The whole regular cast, however many that is: the strip scrolls sideways
   * rather than stopping at the edge of cardMisc. Cards are not all one width
   * -- each is its photo plus a name column only as wide as that name's longest
   * word -- so the strip is laid out from their real widths.
   */
  private void renderActorsMisc(Shows.Show show, FrameLayout misc) {
    List<Shows.Actor> cast = castOf(show);
    if (cast.isEmpty()) {
      misc.addView(message("No cast."), centerWrap());
      return;
    }
    LinearLayout row = mediaStrip();
    int height = mediaCardHeight();
    int photoWidth = Math.max(1, Math.round(height * ACTOR_CARD_ASPECT));
    int border = (int) dp(FOCUS_BORDER_DP);
    for (Shows.Actor actor : cast) {
      int nameWidth = longestWordWidth(actor.name, ACTOR_NAME_TEXT_SIZE_SP);
      int cardWidth = photoWidth + (int) dp(ACTOR_NAME_GAP_DP) + nameWidth + 2 * border;
      View card = actorCard(actor, show, photoWidth, nameWidth);
      row.addView(card, mediaParams(cardWidth, height, row.getChildCount()));
      if (show == active) stripCards.add(card);
    }
    misc.addView(scrollingStrip(show, row, true), centerMatchHeight(height));
    if (show == active) paintStripFocus();
  }

  /**
   * The cast the strip shows, in the order the web client's Actors pane puts it
   * in: the ones the record has a photo of first, each group by tvdb's billing
   * order. Everyone in the record is here -- not just the ones tvdb marks as
   * regulars, and not just the ones it has a photo of, since a missing photo is
   * looked up rather than a reason to leave the actor out.
   */
  private static List<Shows.Actor> castOf(Shows.Show show) {
    List<Shows.Actor> cast = new ArrayList<>(show.characters);
    Collections.sort(
        cast,
        (a, b) -> {
          boolean aHas = !a.image.isEmpty();
          boolean bHas = !b.image.isEmpty();
          if (aHas != bHas) return aHas ? -1 : 1;
          return Integer.compare(a.sortOrder, b.sortOrder);
        });
    return cast;
  }

  private View actorCard(Shows.Actor actor, Shows.Show show, int photoWidth, int nameWidth) {
    LinearLayout card = new LinearLayout(getContext());
    card.setOrientation(LinearLayout.HORIZONTAL);
    card.setGravity(Gravity.CENTER_VERTICAL);
    // Room for the focus border, and something for it to be a stroke on: the
    // card itself is drawn by its photo and caption, not by any background.
    int border = (int) dp(FOCUS_BORDER_DP);
    card.setPadding(border, border, border, border);
    GradientDrawable bg = new GradientDrawable();
    bg.setCornerRadius(dp(CARD_CORNER_DP));
    bg.setColor(Color.TRANSPARENT);
    card.setBackground(bg);

    ImageView photo = new ImageView(getContext());
    photo.setScaleType(ImageView.ScaleType.CENTER_CROP);
    photo.setBackgroundColor(MEDIA_PLACEHOLDER_BG);
    card.addView(photo, new LinearLayout.LayoutParams(photoWidth, ViewGroup.LayoutParams.MATCH_PARENT));
    if (actor.image.isEmpty()) {
      // Nothing in the record, so the strip asks TMDB by name, the same way the
      // web client's Actors pane fills in the ones it is missing. Straight into
      // the view rather than through mediaRequests: the answer arrives when it
      // arrives, long after the pass that decides what is worth fetching.
      ActorPhotos.get(
          actor.name,
          url -> {
            if (!url.isEmpty()) Images.into(photo, url, photo);
          });
    } else {
      addMediaRequest(show, photo, actor.image);
    }

    // Held to the longest word's width, and then left to wrap on its own: the
    // longest word takes a line to itself and shorter ones pair up where two
    // of them fit, which is what makes the column as narrow as it can be.
    TextView caption = message(actor.name);
    caption.setTextSize(TypedValue.COMPLEX_UNIT_SP, ACTOR_NAME_TEXT_SIZE_SP);
    LinearLayout.LayoutParams captionParams =
        new LinearLayout.LayoutParams(nameWidth, ViewGroup.LayoutParams.WRAP_CONTENT);
    captionParams.leftMargin = (int) dp(ACTOR_NAME_GAP_DP);
    card.addView(caption, captionParams);
    return card;
  }

  /** What a name needs to never have to break a word across lines. */
  private int longestWordWidth(String text, float textSizeSp) {
    TextPaint paint = new TextPaint(Paint.ANTI_ALIAS_FLAG);
    paint.setTextSize(
        TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_SP, textSizeSp, getResources().getDisplayMetrics()));
    float widest = 0f;
    for (String word : text.trim().split("\\s+")) {
      if (!word.isEmpty()) widest = Math.max(widest, paint.measureText(word));
    }
    return (int) Math.ceil(widest);
  }

  private void renderTrailersMisc(Shows.Show show, FrameLayout misc) {
    // Nothing at all until the list has settled: a card that says it is loading
    // is a card that has to be redrawn to stop saying it.
    if (!show.trailersReady) return;
    if (show.trailers.isEmpty()) {
      misc.addView(message("No trailers found."), centerWrap());
      return;
    }
    LinearLayout row = mediaStrip();
    int height = mediaCardHeight();
    int width = Math.max(1, Math.round(height * TRAILER_CARD_ASPECT));
    for (int i = 0; i < show.trailers.size(); i++) {
      View card = trailerCard(show.trailers.get(i), show);
      row.addView(card, mediaParams(width, height, i));
      if (show == active) stripCards.add(card);
    }
    misc.addView(scrollingStrip(show, row, false), centerMatchHeight(height));
    if (show == active) paintStripFocus();
  }

  private View trailerCard(Shows.Trailer trailer, Shows.Show show) {
    FrameLayout card = new FrameLayout(getContext());
    int pad = (int) dp(MEDIA_CARD_PAD_DP);
    card.setPadding(pad, pad, pad, pad);
    GradientDrawable bg = new GradientDrawable();
    bg.setCornerRadius(dp(CARD_CORNER_DP));
    bg.setColor(TRAILER_CARD_BG);
    card.setBackground(bg);

    String thumbnail = Trailers.thumbnail(trailer.url);
    if (thumbnail.isEmpty()) {
      TextView label = new TextView(getContext());
      label.setText(TRAILER_IMDB_LABEL);
      label.setTextColor(MISC_TEXT_COLOR);
      label.setTextSize(TypedValue.COMPLEX_UNIT_SP, ACTOR_NAME_TEXT_SIZE_SP);
      label.setTypeface(Typeface.DEFAULT_BOLD);
      label.setGravity(Gravity.CENTER);
      label.setBackgroundColor(TRAILER_IMDB_BG);
      card.addView(
          label,
          new FrameLayout.LayoutParams(
              ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
      return card;
    }

    ImageView still = new ImageView(getContext());
    still.setScaleType(ImageView.ScaleType.CENTER_CROP);
    still.setBackgroundColor(MEDIA_PLACEHOLDER_BG);
    card.addView(still, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    addMediaRequest(show, still, thumbnail);
    return card;
  }

  private LinearLayout mediaStrip() {
    LinearLayout strip = new LinearLayout(getContext());
    strip.setOrientation(LinearLayout.HORIZONTAL);
    strip.setGravity(Gravity.CENTER_VERTICAL);
    return strip;
  }

  /**
   * The strip in something that can be scrolled past the edge of cardMisc, so
   * a cast or a trailer list of any length is all reachable. No scrollbar and
   * no touch: the only thing that moves it is the left and right keys.
   *
   * faded strips wear a band at whichever end still has cards past it, which is
   * the only sign a strip too long for the card gives that there is more.
   */
  private View scrollingStrip(Shows.Show show, LinearLayout row, boolean faded) {
    android.widget.HorizontalScrollView scroll =
        faded ? new FadingStrip(getContext()) : new android.widget.HorizontalScrollView(getContext());
    scroll.setHorizontalScrollBarEnabled(false);
    scroll.setOverScrollMode(View.OVER_SCROLL_NEVER);
    scroll.addView(
        row,
        new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.MATCH_PARENT));
    if (show == active) strip = scroll;
    return scroll;
  }

  /**
   * A strip whose two ends dissolve into the card rather than being cut off at
   * them. Its own class because the bands are drawn over the cards, which is
   * after the children have been drawn and so nothing a background can do.
   */
  private class FadingStrip extends android.widget.HorizontalScrollView {

    private final EdgeFade fade = EdgeFade.horizontal(this, STRIP_FADE_DP, CARD_BG);

    FadingStrip(Context context) {
      super(context);
    }

    @Override
    protected void onSizeChanged(int w, int h, int oldw, int oldh) {
      super.onSizeChanged(w, h, oldw, oldh);
      fade.resize(w);
    }

    @Override
    protected void onScrollChanged(int l, int t, int oldl, int oldt) {
      super.onScrollChanged(l, t, oldl, oldt);
      // The bands are pinned to the view while the cards move under them, so
      // the whole of it is redrawn rather than the part that scrolled.
      invalidate();
    }

    @Override
    protected void dispatchDraw(Canvas canvas) {
      super.dispatchDraw(canvas);
      fade.draw(canvas);
    }
  }

  private LinearLayout.LayoutParams mediaParams(int width, int height, int index) {
    LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(width, height);
    if (index > 0) params.leftMargin = (int) dp(MEDIA_GAP_DP);
    return params;
  }

  /** From the bottom of the name row to the bottom of the card. */
  private int mediaCardHeight() {
    int chrome =
        2 * (int) dp(CARD_CONTENT_INSET_DP)
            + (int) dp(CARD_PAD_TOP_DP)
            + (int) dp(CARD_PAD_BOTTOM_DP)
            + (int) dp(CARD_BODY_GAP_DP);
    return Math.max(1, cardHeightPx - chrome - nameLineHeightPx);
  }

  private FrameLayout.LayoutParams centerMatchHeight(int height) {
    return new FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, height, Gravity.CENTER_VERTICAL);
  }

  private FrameLayout.LayoutParams centerWrap() {
    return new FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.WRAP_CONTENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
        Gravity.CENTER_VERTICAL);
  }

  private TextView message(String value) {
    TextView view = new TextView(getContext());
    view.setText(value);
    view.setTextColor(MISC_TEXT_COLOR);
    view.setTextSize(TypedValue.COMPLEX_UNIT_SP, FIELD_TEXT_SIZE_SP);
    return view;
  }

  private void addMediaRequest(Shows.Show show, ImageView view, String url) {
    if (url == null || url.isEmpty()) return;
    MediaRequest request = new MediaRequest(view, url);
    List<MediaRequest> requests = mediaRequests.get(show);
    if (requests == null) {
      requests = new ArrayList<>();
      mediaRequests.put(show, requests);
    }
    requests.add(request);
  }

  private boolean isFutureDate(String date) {
    if (date == null || date.length() < 10 || "0".equals(date)) return false;
    return date.substring(0, 10).compareTo(todayKey) > 0;
  }

  private static String todayKey() {
    return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
  }

  private void paintStripFocus() {
    for (int i = 0; i < stripCards.size(); i++) {
      GradientDrawable bg = (GradientDrawable) stripCards.get(i).getBackground();
      bg.setStroke(i == focusIndex ? (int) dp(FOCUS_BORDER_DP) : 0, FOCUS_BORDER);
    }
  }

  /** Brings the card the cursor just moved onto into the strip's own window. */
  private void scrollFocusIntoView() {
    if (strip == null || focusIndex < 0 || focusIndex >= stripCards.size()) return;
    final View card = stripCards.get(focusIndex);
    strip.post(
        () -> {
          int left = card.getLeft();
          int right = card.getRight();
          int viewLeft = strip.getScrollX();
          int viewRight = viewLeft + strip.getWidth();
          if (left < viewLeft) strip.smoothScrollTo(left, 0);
          else if (right > viewRight) strip.smoothScrollTo(right - strip.getWidth(), 0);
        });
  }

  /**
   * One card of the strip either way. The trailers wrap round -- there are only
   * ever a few, and coming back to the first is quicker than turning around --
   * while the cast, which can run to any length, stops at its two ends.
   */
  private void stepStripFocus(int direction) {
    int count = stripCards.size();
    if (count == 0) return;
    int next =
        miscMode == MiscMode.TRAILERS
            ? ((focusIndex + direction) % count + count) % count
            : Math.max(0, Math.min(count - 1, focusIndex + direction));
    if (next == focusIndex) return;
    focusIndex = next;
    paintStripFocus();
    scrollFocusIntoView();
  }

  /** The strip with no cursor on it, which left and right simply slide along. */
  private void scrollStrip(int direction) {
    if (strip == null) return;
    strip.smoothScrollBy(direction * (int) dp(STRIP_SCROLL_DP), 0);
  }

  /**
   * The description, a couple of lines at a time, stopping where its last line
   * reaches the bottom of cardMisc rather than scrolling into empty space.
   */
  private void scrollDesc(int direction) {
    if (descView == null) return;
    Layout layout = descView.getLayout();
    if (layout == null) return;
    int max = overflow(descView, layout);
    int step = descView.getLineHeight() * DESC_SCROLL_LINES;
    descView.setScrollY(Math.max(0, Math.min(max, descView.getScrollY() + direction * step)));
    // The fades are the box's, drawn over the text rather than by it, so the
    // text scrolling on its own does not redraw them.
    if (descView.getParent() instanceof View) ((View) descView.getParent()).invalidate();
  }

  /** One season either way, stopping at the show's first and last. */
  private void stepSeason(int direction) {
    if (active == null) return;
    List<Integer> seasons = seasonsPresent(active.episodeData);
    if (seasons.isEmpty()) return;
    int next = Math.max(0, Math.min(seasons.size() - 1, mapSeasonIndex + direction));
    if (next == mapSeasonIndex) return;
    mapSeasonIndex = next;
    renderMisc(active);
    loadVisibleMedia();
  }

  /**
   * One episode of the season on show either way, stopping at its two ends. The
   * episode card, when it is up, is showing whichever episode this lands on.
   */
  private void stepEpisode(int direction) {
    if (active == null) return;
    int count = focusedSeasonLength();
    if (count == 0) return;
    int next = Math.max(0, Math.min(count - 1, mapEpisodeIndex + direction));
    if (next == mapEpisodeIndex) return;
    mapEpisodeIndex = next;
    renderMisc(active);
    loadVisibleMedia();
  }

  /** The season number the Map row is showing, or -1 when the show has none. */
  private int focusedSeason() {
    if (active == null) return -1;
    List<Integer> seasons = seasonsPresent(active.episodeData);
    if (seasons.isEmpty()) return -1;
    return seasons.get(Math.max(0, Math.min(seasons.size() - 1, mapSeasonIndex)));
  }

  /**
   * The episode the cursor lands on when it first comes up: the last one of the
   * season on show that has been watched, which is where watching left off, and
   * the first episode when none of it has been.
   */
  private int defaultEpisodeIndex() {
    int season = focusedSeason();
    if (season < 0 || active.episodeData == null) return 0;
    JSONArray episodes = active.episodeData.optJSONArray(season);
    for (int i = (episodes == null ? 0 : episodes.length()) - 1; i >= 0; i--) {
      JSONArray tuple = episodes.optJSONArray(i);
      if (tuple != null && tuple.optInt(ED_WATCHED, 0) == 1) return i;
    }
    return 0;
  }

  private int focusedSeasonLength() {
    int season = focusedSeason();
    if (season < 0 || active.episodeData == null) return 0;
    JSONArray episodes = active.episodeData.optJSONArray(season);
    return episodes == null ? 0 : episodes.length();
  }

  private JSONArray focusedEpisodeTuple() {
    if (!hasEpisodeFocus()) return null;
    int season = focusedSeason();
    if (season < 0 || active.episodeData == null) return null;
    JSONArray episodes = active.episodeData.optJSONArray(season);
    return episodes == null ? null : episodes.optJSONArray(mapEpisodeIndex);
  }

  private String focusedActorName() {
    if (active == null || focusIndex < 0) return null;
    List<Shows.Actor> cast = castOf(active);
    return focusIndex < cast.size() ? cast.get(focusIndex).name : null;
  }

  private enum MiscMode {
    DESC,
    MAP,
    ACTORS,
    TRAILERS
  }

  /**
   * How deep into its mode cardMisc has been stepped by the ok key held down.
   * NONE is where every mode starts; FOCUS is a cursor inside it -- an episode
   * cell, an actor card, a trailer card; CARD is the Map's last step, the
   * episode's own card over the show's.
   */
  private enum SubMode {
    NONE,
    FOCUS,
    CARD
  }

  private static class MediaRequest {
    final ImageView view;
    final String url;

    MediaRequest(ImageView view, String url) {
      this.view = view;
      this.url = url;
    }
  }

  private class FlowLayout extends ViewGroup {
    FlowLayout(Context context) {
      super(context);
    }

    @Override
    protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
      int maxWidth = Math.max(0, MeasureSpec.getSize(widthMeasureSpec));
      int lineWidth = 0;
      int lineHeight = 0;
      int totalHeight = 0;
      int widest = 0;
      for (int i = 0; i < getChildCount(); i++) {
        View child = getChildAt(i);
        measureChildWithMargins(child, widthMeasureSpec, 0, heightMeasureSpec, 0);
        MarginLayoutParams params = (MarginLayoutParams) child.getLayoutParams();
        int childWidth = child.getMeasuredWidth() + params.leftMargin + params.rightMargin;
        int childHeight = child.getMeasuredHeight() + params.topMargin + params.bottomMargin;
        if (lineWidth > 0 && lineWidth + childWidth > maxWidth) {
          widest = Math.max(widest, lineWidth);
          totalHeight += lineHeight;
          lineWidth = 0;
          lineHeight = 0;
        }
        lineWidth += childWidth;
        lineHeight = Math.max(lineHeight, childHeight);
      }
      widest = Math.max(widest, lineWidth);
      totalHeight += lineHeight;
      setMeasuredDimension(resolveSize(widest, widthMeasureSpec), resolveSize(totalHeight, heightMeasureSpec));
    }

    @Override
    protected void onLayout(boolean changed, int left, int top, int right, int bottom) {
      int maxWidth = right - left;
      int x = 0;
      int y = 0;
      int lineHeight = 0;
      for (int i = 0; i < getChildCount(); i++) {
        View child = getChildAt(i);
        MarginLayoutParams params = (MarginLayoutParams) child.getLayoutParams();
        int childWidth = child.getMeasuredWidth() + params.leftMargin + params.rightMargin;
        int childHeight = child.getMeasuredHeight() + params.topMargin + params.bottomMargin;
        if (x > 0 && x + childWidth > maxWidth) {
          x = 0;
          y += lineHeight;
          lineHeight = 0;
        }
        int childLeft = x + params.leftMargin;
        int childTop = y + params.topMargin;
        child.layout(childLeft, childTop, childLeft + child.getMeasuredWidth(), childTop + child.getMeasuredHeight());
        x += childWidth;
        lineHeight = Math.max(lineHeight, childHeight);
      }
    }

    @Override
    protected boolean checkLayoutParams(ViewGroup.LayoutParams params) {
      return params instanceof MarginLayoutParams;
    }

    @Override
    protected ViewGroup.LayoutParams generateDefaultLayoutParams() {
      return new MarginLayoutParams(
          ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    @Override
    public ViewGroup.LayoutParams generateLayoutParams(android.util.AttributeSet attrs) {
      return new MarginLayoutParams(getContext(), attrs);
    }

    @Override
    protected ViewGroup.LayoutParams generateLayoutParams(ViewGroup.LayoutParams params) {
      return new MarginLayoutParams(params);
    }
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
