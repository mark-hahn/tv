package com.hahnca.tvapp;

import android.content.Context;
import android.graphics.Color;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.util.List;

/**
 * The Actors tab: the cast as a grid of photo cards, name over character, out
 * of the show record's own characters list — the same source the web client and
 * the phone remote read. Nothing here is clickable: their counterparts open an
 * IMDb page, and there is no browser worth opening on a tv.
 */
class ActorsView extends ScrollPane {

  private static final int COLUMNS = 4;
  private static final float CARD_GAP_DP = 12f;
  private static final float PHOTO_HEIGHT_DP = 150f;
  private static final float NAME_TEXT_SIZE_SP = 15f;
  private static final float CHARACTER_TEXT_SIZE_SP = 13f;
  private static final int PHOTO_PLACEHOLDER_BG = 0xFF303030;

  ActorsView(Context context) {
    super(context);
  }

  @Override
  protected void fill(Shows.Show show) {
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
