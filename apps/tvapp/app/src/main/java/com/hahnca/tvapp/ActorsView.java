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
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * The Actors tab: the cast as a grid of photo cards, name over character, out
 * of the show record's own characters list — the same source the web client and
 * the phone remote read.
 *
 * Clicking a card is the web client's actors-pane click-then-Shows-button
 * rolled into one gesture, there being no second button worth adding on a tv:
 * it highlights the card and narrows the show list to that actor's shows.
 * Clicking the highlighted card again undoes both.
 */
class ActorsView extends ScrollPane {

  private static final int COLUMNS = 4;
  private static final float CARD_GAP_DP = 12f;
  private static final float PHOTO_HEIGHT_DP = 150f;
  private static final float NAME_TEXT_SIZE_SP = 15f;
  private static final float CHARACTER_TEXT_SIZE_SP = 13f;
  private static final int PHOTO_PLACEHOLDER_BG = 0xFF303030;
  // The web client's actor.vue: a red border is the whole of its selected
  // style, over an otherwise plain card.
  private static final int SELECTED_BORDER = 0xFFFF0000;
  private static final float SELECTED_BORDER_DP = 3f;
  private static final float CARD_CORNER_DP = 6f;
  private static final float CARD_PAD_DP = 4f;

  interface Listener {
    /** Null when the click undid the previous selection rather than making one. */
    void onActorClick(String actorName);
  }

  private final Map<String, View> cardsByName = new HashMap<>(); // normalized name -> card
  private Listener listener;
  private String selectedName; // normalized, or null

  ActorsView(Context context) {
    super(context);
  }

  void setListener(Listener listener) {
    this.listener = listener;
  }

  /** From outside: something else just took over narrowing the show list. */
  void clearSelection() {
    if (selectedName == null) return;
    View card = cardsByName.get(selectedName);
    if (card != null) paintSelected(card, false);
    selectedName = null;
  }

  @Override
  protected void fill(Shows.Show show) {
    cardsByName.clear();
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

    String normalized = Shows.normalizeName(actor.name);
    cardsByName.put(normalized, card);
    paintSelected(card, normalized.equals(selectedName));
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
    boolean deselecting = normalized.equals(selectedName);
    if (selectedName != null) {
      View prev = cardsByName.get(selectedName);
      if (prev != null) paintSelected(prev, false);
    }
    selectedName = deselecting ? null : normalized;
    if (!deselecting) {
      View current = cardsByName.get(normalized);
      if (current != null) paintSelected(current, true);
    }
    if (listener != null) listener.onActorClick(deselecting ? null : actorName);
  }

  private void paintSelected(View card, boolean selected) {
    ((GradientDrawable) card.getBackground())
        .setStroke(selected ? (int) dp(SELECTED_BORDER_DP) : 0, SELECTED_BORDER);
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
