package com.hahnca.tvapp;

import android.content.Context;
import android.graphics.drawable.GradientDrawable;
import android.util.TypedValue;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.List;

/**
 * What the two actor displays -- the related actors and the show counts --
 * have in common: a black sheet over the show list, holding a column of lines
 * of actor cards, and read rather than moved around in.
 *
 * A card is the actor's photo with their name beside it and whatever lines the
 * display puts under that name. It is as tall as those lines need, and a line
 * of cards is as tall as the tallest card on it.
 *
 * The arrow keys are the display's own, and by default walk the column a
 * screenful at a time; a display with a cursor of its own answers them by
 * moving it instead, and names the actor under it for the ok key. The keys
 * that close them are the activity's -- back, shows, sort, filter and info,
 * which take the screen somewhere else.
 */
abstract class ActorOverlay extends ScrollView {

  static final int BACKGROUND = 0xFF000000;
  static final float PAD_DP = 12f;
  static final float ROW_GAP_DP = 10f;
  static final float CELL_GAP_DP = 10f;
  static final float PHOTO_HEIGHT_DP = 102.4f;
  static final float PHOTO_ASPECT = 0.62f; // width / height
  static final float CARD_PAD_DP = 8f;
  static final float CARD_CORNER_DP = 8f;
  static final float NAME_GAP_DP = 12f;
  static final float NAME_TEXT_SIZE_SP = 17.28f;
  static final float LINE_TEXT_SIZE_SP = 12.24f;
  static final float LINE_GAP_DP = 2f;
  static final float MESSAGE_TEXT_SIZE_SP = 15.3f;
  // How much of the display one press of up or down moves: nearly a screenful,
  // with the last of what was on it kept for the eye to carry over.
  static final float SCROLL_PAGE_FRACTION = 0.85f;
  static final int CARD_BG = 0xFF2B2B2B;
  static final int NAME_COLOR = 0xFFFFFFFF;
  static final int LINE_COLOR = 0xCCFFFFFF;
  static final int PHOTO_PLACEHOLDER_BG = 0xFF303030;

  final LinearLayout column;

  ActorOverlay(Context context) {
    super(context);
    setBackgroundColor(BACKGROUND);
    setVisibility(View.GONE);
    column = new LinearLayout(context);
    column.setOrientation(LinearLayout.VERTICAL);
    int pad = (int) dp(PAD_DP);
    column.setPadding(pad, pad, pad, pad);
    addView(
        column,
        new ScrollView.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
  }

  boolean isOpen() {
    return getVisibility() == View.VISIBLE;
  }

  void close() {
    setVisibility(View.GONE);
    column.removeAllViews();
  }

  /**
   * The arrow keys, which with nothing on the display to move walk the whole
   * of it a screenful at a time. Left and right have nowhere to go.
   */
  void arrowKey(String key) {
    if ("up".equals(key)) scrollPage(-1);
    else if ("down".equals(key)) scrollPage(+1);
  }

  /** The actor under the display's own cursor, or null when it has none. */
  String focusedActorName() {
    return null;
  }

  /**
   * The up and down keys: a screenful either way, stopping at the two ends --
   * the scroll does nothing at all when everything fits already. direction is
   * -1 for up and +1 for down.
   */
  void scrollPage(int direction) {
    int step = Math.max(1, Math.round(getHeight() * SCROLL_PAGE_FRACTION));
    smoothScrollBy(0, direction * step);
  }

  /** An empty column, on screen and back at its top, for a display to fill. */
  void begin() {
    column.removeAllViews();
    setVisibility(View.VISIBLE);
    scrollTo(0, 0);
  }

  /**
   * One line of cards, each taking the same share of the width whether or not
   * it has an actor in it -- the odd card at the end of a list is as wide as
   * every other one.
   */
  View cardLine(List<View> cards, int perLine) {
    LinearLayout line = new LinearLayout(getContext());
    line.setOrientation(LinearLayout.HORIZONTAL);
    for (int i = 0; i < perLine; i++) {
      View card = i < cards.size() ? cards.get(i) : new View(getContext());
      LinearLayout.LayoutParams params =
          new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
      if (i > 0) params.leftMargin = (int) dp(CELL_GAP_DP);
      line.addView(card, params);
    }
    return line;
  }

  /** The actor's photo, their name beside it, and the display's own lines under that. */
  View actorCard(Shows.Actor actor, List<String> lines) {
    LinearLayout card = new LinearLayout(getContext());
    card.setOrientation(LinearLayout.HORIZONTAL);
    int pad = (int) dp(CARD_PAD_DP);
    card.setPadding(pad, pad, pad, pad);
    GradientDrawable bg = new GradientDrawable();
    bg.setCornerRadius(dp(CARD_CORNER_DP));
    bg.setColor(CARD_BG);
    card.setBackground(bg);

    int photoHeight = (int) dp(PHOTO_HEIGHT_DP);
    int photoWidth = Math.max(1, Math.round(photoHeight * PHOTO_ASPECT));
    ImageView photo = new ImageView(getContext());
    photo.setScaleType(ImageView.ScaleType.CENTER_CROP);
    photo.setBackgroundColor(PHOTO_PLACEHOLDER_BG);
    card.addView(photo, new LinearLayout.LayoutParams(photoWidth, photoHeight));
    if (actor.image.isEmpty()) {
      // The same TMDB lookup the cast strip does for the actors tvdb has no
      // picture of, so a face here is as likely as a face there.
      ActorPhotos.get(
          actor.name,
          url -> {
            if (!url.isEmpty()) Images.into(photo, url, photo);
          });
    } else {
      Images.into(photo, actor.image, photo);
    }

    LinearLayout text = new LinearLayout(getContext());
    text.setOrientation(LinearLayout.VERTICAL);
    TextView name = new TextView(getContext());
    name.setText(actor.name);
    name.setTextColor(NAME_COLOR);
    name.setTextSize(TypedValue.COMPLEX_UNIT_SP, NAME_TEXT_SIZE_SP);
    text.addView(
        name,
        new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    for (String value : lines) {
      TextView line = new TextView(getContext());
      line.setText(value);
      line.setTextColor(LINE_COLOR);
      line.setTextSize(TypedValue.COMPLEX_UNIT_SP, LINE_TEXT_SIZE_SP);
      LinearLayout.LayoutParams lineParams =
          new LinearLayout.LayoutParams(
              ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
      lineParams.topMargin = (int) dp(LINE_GAP_DP);
      text.addView(line, lineParams);
    }
    LinearLayout.LayoutParams textParams =
        new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
    textParams.leftMargin = (int) dp(NAME_GAP_DP);
    card.addView(text, textParams);
    return card;
  }

  TextView message(String value) {
    TextView view = new TextView(getContext());
    view.setText(value);
    view.setTextColor(LINE_COLOR);
    view.setTextSize(TypedValue.COMPLEX_UNIT_SP, MESSAGE_TEXT_SIZE_SP);
    return view;
  }

  LinearLayout.LayoutParams rowParams(boolean first) {
    LinearLayout.LayoutParams params =
        new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    if (!first) params.topMargin = (int) dp(ROW_GAP_DP);
    return params;
  }

  float dp(float value) {
    return TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics());
  }
}
