package com.hahnca.tvapp;

import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.List;

/**
 * The Actors tab: the cast as a grid of photo cards, name over character, out
 * of the show record's own characters list — the same source the web client and
 * the phone remote read.
 *
 * Clicking a card is the web client's actors-pane click-then-Shows-button
 * rolled into one gesture, there being no second button worth adding on a tv:
 * it narrows the show list to that actor's shows. Clicking the same card again
 * lifts the narrowing back off.
 *
 * Which card that was is remembered here and not drawn anywhere: the cursor
 * border is the only red border on a card, so it always means the cursor. The
 * narrowing outlives the cursor going anywhere at all — another show, another
 * tab, the button column — and only the things MainActivity clears it for
 * (a filter button, filter text, another actor, closing tvapp) take it off.
 */
class ActorsView extends ScrollPane {

  private static final int COLUMNS = 4;
  private static final float CARD_GAP_DP = 12f;
  private static final float PHOTO_HEIGHT_DP = 150f;
  private static final float NAME_TEXT_SIZE_SP = 13.5f;
  private static final float CHARACTER_TEXT_SIZE_SP = 11.7f;
  private static final int PHOTO_PLACEHOLDER_BG = 0xFF303030;
  private static final int FOCUS_BORDER = 0xFFFF0000;
  private static final float FOCUS_BORDER_DP = 3f;
  private static final float CARD_CORNER_DP = 6f;
  private static final float CARD_PAD_DP = 4f;

  interface Listener {
    /** Null when the click undid the previous selection rather than making one. */
    void onActorClick(String actorName);
  }

  // Parallel: the cards as laid out, row-major across COLUMNS, and the actor
  // each one is for. Only real cards are in here — the last row's empty
  // spacers are not somewhere the cursor can go.
  private final List<View> cardViews = new ArrayList<>();
  private final List<Shows.Actor> cardActors = new ArrayList<>();
  private int focusedIndex = -1;
  private Listener listener;
  private String selectedName; // normalized, or null; never drawn
  private Shows.Show currentShow;
  // The show and actor the cursor was on the last time it left this pane's
  // grid, so coming back to the same show puts the cursor back on the same
  // actor instead of always resetting to the first card. Survives the show
  // changing away and back before the grid is re-entered -- only fill() and
  // clearCardFocus() touch these, never anything that merely rebuilds the
  // grid for a different show.
  private String rememberedShowName;
  private String rememberedActorName; // normalized

  ActorsView(Context context) {
    super(context);
    enableEdgeFade();
  }

  void setListener(Listener listener) {
    this.listener = listener;
  }

  /** From outside: something else just took over narrowing the show list. */
  void clearSelection() {
    selectedName = null;
  }

  /**
   * The actors button's right-arrow, button-to-grid transition. Lands back on
   * the actor the cursor was last on, if the grid is still showing the same
   * show it was on then; otherwise the first card, as before.
   */
  boolean focusFirstCard() {
    if (cardViews.isEmpty()) return false;
    setFocusedIndex(rememberedIndex());
    return true;
  }

  private int rememberedIndex() {
    if (rememberedActorName == null
        || currentShow == null
        || !currentShow.name.equals(rememberedShowName)) {
      return 0;
    }
    for (int i = 0; i < cardActors.size(); i++) {
      if (Shows.normalizeName(cardActors.get(i).name).equals(rememberedActorName)) return i;
    }
    return 0;
  }

  /** Cursor leaves the grid — back to the actors button, or a show/tab change. */
  void clearCardFocus() {
    if (hasFocusedCard() && currentShow != null) {
      rememberedShowName = currentShow.name;
      rememberedActorName = Shows.normalizeName(cardActors.get(focusedIndex).name);
    }
    setFocusedIndex(-1);
  }

  boolean hasFocusedCard() {
    return focusedIndex >= 0 && focusedIndex < cardViews.size();
  }

  /**
   * One step through the grid. False when that direction runs off the edge --
   * off the left edge the cursor leaves the pane, which is MainActivity's to
   * do; every other edge simply leaves it where it is.
   */
  boolean moveCardFocus(int rowStep, int colStep) {
    if (!hasFocusedCard()) return false;
    int col = focusedIndex % COLUMNS;
    if (col + colStep < 0 || col + colStep >= COLUMNS) return false; // no row wrapping
    int next = focusedIndex + rowStep * COLUMNS + colStep;
    if (next < 0 || next >= cardViews.size()) return false;
    setFocusedIndex(next);
    return true;
  }

  /** Ok on a focused card: narrows the show list to that actor, or lifts it. */
  void activateFocusedCard() {
    if (!hasFocusedCard()) return;
    handleClick(cardActors.get(focusedIndex).name);
  }

  @Override
  protected void fill(Shows.Show show) {
    currentShow = show;
    cardViews.clear();
    cardActors.clear();
    focusedIndex = -1;
    List<Shows.Actor> cast = show.characters;
    if (cast.isEmpty()) {
      addMessage("No cast.");
      return;
    }
    for (int i = 0; i < cast.size(); i += COLUMNS) {
      LinearLayout row = new LinearLayout(getContext());
      row.setOrientation(LinearLayout.HORIZONTAL);
      for (int col = 0; col < COLUMNS; col++) {
        int index = i + col;
        // The last row is padded with empty cells, so its cards keep the width
        // the rest of the grid has.
        row.addView(
            index < cast.size() ? card(cast.get(index), show) : new LinearLayout(getContext()),
            cell());
      }
      addRow(row, i == 0 ? 0 : CARD_GAP_DP);
    }
  }

  private LinearLayout.LayoutParams cell() {
    LinearLayout.LayoutParams params =
        new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
    params.rightMargin = (int) dp(CARD_GAP_DP);
    return params;
  }

  private LinearLayout card(Shows.Actor actor, Shows.Show show) {
    LinearLayout card = new LinearLayout(getContext());
    card.setOrientation(LinearLayout.VERTICAL);
    int pad = (int) dp(CARD_PAD_DP);
    card.setPadding(pad, pad, pad, pad);
    GradientDrawable bg = new GradientDrawable();
    bg.setCornerRadius(dp(CARD_CORNER_DP));
    card.setBackground(bg);

    cardViews.add(card);
    cardActors.add(actor);
    card.setOnClickListener(v -> handleClick(actor.name));

    ImageView photo = new ImageView(getContext());
    photo.setScaleType(ImageView.ScaleType.CENTER_CROP);
    photo.setBackgroundColor(PHOTO_PLACEHOLDER_BG);
    card.addView(
        photo,
        new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, (int) dp(PHOTO_HEIGHT_DP)));
    Images.into(photo, actor.image, show);

    card.addView(label(actor.name, NAME_TEXT_SIZE_SP, Color.WHITE));
    if (!actor.character.isEmpty()) {
      card.addView(label("(" + actor.character + ")", CHARACTER_TEXT_SIZE_SP, DIM_COLOR));
    }
    return card;
  }

  private void handleClick(String actorName) {
    String normalized = Shows.normalizeName(actorName);
    // The same actor again, whichever of this show's cards it came from, is
    // the click that lifts the narrowing rather than replacing it.
    boolean deselecting = normalized.equals(selectedName);
    selectedName = deselecting ? null : normalized;
    if (listener != null) listener.onActorClick(deselecting ? null : actorName);
  }

  private void setFocusedIndex(int index) {
    if (focusedIndex == index) return;
    int old = focusedIndex;
    focusedIndex = index;
    if (old >= 0 && old < cardViews.size()) paintFocus(old);
    if (index >= 0 && index < cardViews.size()) {
      paintFocus(index);
      ensureVisible(cardViews.get(index));
    }
  }

  private void paintFocus(int index) {
    ((GradientDrawable) cardViews.get(index).getBackground())
        .setStroke(index == focusedIndex ? (int) dp(FOCUS_BORDER_DP) : 0, FOCUS_BORDER);
  }

  private TextView label(String value, float sizeSp, int color) {
    TextView view = new TextView(getContext());
    view.setText(value);
    view.setTextColor(color);
    view.setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp);
    view.setSingleLine(true);
    view.setEllipsize(android.text.TextUtils.TruncateAt.END);
    view.setGravity(Gravity.CENTER_HORIZONTAL);
    return view;
  }
}
