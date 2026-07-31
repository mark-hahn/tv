package com.hahnca.tvapp;

import android.content.Context;
import android.graphics.drawable.GradientDrawable;
import android.widget.ImageView;
import android.widget.LinearLayout;
import java.util.List;

/**
 * The Trailers tab: a card per trailer the show record carries, holding the
 * video's own still, clicked to play — the web client's card, with the still
 * standing in for the player it embeds before you press play.
 *
 * Playing happens inside tvapp (see TrailerPlayer), not by handing the url to
 * YouTube: the tv app never says when a video ended and leaves no way back.
 */
class TrailersView extends ScrollPane {

  interface PlayListener {
    void onPlayTrailer(String url);
  }

  private static final int CARD_BG = 0xFF202020;
  private static final float CARD_CORNER_DP = 8f;
  private static final float CARD_PAD_DP = 12f;
  private static final float CARD_GAP_DP = 16f;
  private static final float STILL_WIDTH_DP = 300f;
  private static final float STILL_ASPECT = 9f / 16f; // height / width
  private static final int STILL_PLACEHOLDER_BG = 0xFF303030;

  private PlayListener playListener;
  // Set by fill() to the lone trailer's url when the show has exactly one, so
  // a tab click that lands here can jump straight to playing it rather than
  // showing a one-card grid there's no point choosing from.
  private String soleTrailerUrl;

  TrailersView(Context context) {
    super(context);
  }

  void setPlayListener(PlayListener listener) {
    playListener = listener;
  }

  @Override
  public void onShown() {
    super.onShown();
    if (soleTrailerUrl != null && playListener != null) {
      playListener.onPlayTrailer(soleTrailerUrl);
    }
  }

  @Override
  protected void fill(Shows.Show show) {
    List<Shows.Trailer> trailers = show.trailers;
    soleTrailerUrl = trailers.size() == 1 ? trailers.get(0).url : null;
    if (trailers.isEmpty()) {
      addMessage("No trailers found.");
      return;
    }
    for (int i = 0; i < trailers.size(); i++) {
      addRow(card(trailers.get(i), show), i == 0 ? 0 : CARD_GAP_DP);
    }
  }

  private LinearLayout card(Shows.Trailer trailer, Shows.Show show) {
    LinearLayout card = new LinearLayout(getContext());
    card.setOrientation(LinearLayout.VERTICAL);
    int pad = (int) dp(CARD_PAD_DP);
    card.setPadding(pad, pad, pad, pad);

    GradientDrawable bg = new GradientDrawable();
    bg.setCornerRadius(dp(CARD_CORNER_DP));
    bg.setColor(CARD_BG);
    card.setBackground(bg);

    ImageView still = new ImageView(getContext());
    still.setScaleType(ImageView.ScaleType.CENTER_CROP);
    still.setBackgroundColor(STILL_PLACEHOLDER_BG);
    LinearLayout.LayoutParams stillParams =
        new LinearLayout.LayoutParams(
            (int) dp(STILL_WIDTH_DP), (int) dp(STILL_WIDTH_DP * STILL_ASPECT));
    card.addView(still, stillParams);
    Images.into(still, Trailers.thumbnail(trailer.url), show);

    card.setOnClickListener(
        v -> {
          if (playListener != null) playListener.onPlayTrailer(trailer.url);
        });
    return card;
  }
}
