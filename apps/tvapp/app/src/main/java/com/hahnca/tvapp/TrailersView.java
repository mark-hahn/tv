package com.hahnca.tvapp;

import android.content.Context;
import android.graphics.drawable.GradientDrawable;
import android.view.View;
import android.widget.ImageView;
import android.widget.LinearLayout;
import java.util.ArrayList;
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

  private static final float CARD_CORNER_DP = 8f;
  private static final float CARD_PAD_DP = 12f;
  private static final float CARD_GAP_DP = 16f;
  private static final float STILL_WIDTH_DP = 300f;
  private static final float STILL_ASPECT = 9f / 16f; // height / width
  private static final int CARD_BG = 0xFFD3D3D3;
  private static final int STILL_PLACEHOLDER_BG = 0xFF303030;
  private static final int CARD_SELECTED_BORDER = 0xFFFF0000;
  private static final float CARD_SELECTED_BORDER_DP = 3f;

  private PlayListener playListener;
  // Set by fill() to the lone trailer's url when the show has exactly one, so
  // a tab click that lands here can jump straight to playing it rather than
  // showing a one-card grid there's no point choosing from.
  private String soleTrailerUrl;
  // The show the cards belong to, and a play the imdb answer is holding up:
  // until it lands a show with one tvdb trailer may still turn out to have two.
  private Shows.Show filledShow;
  private boolean playWhenChecked;
  // Parallel to cardViews -- a card is never "active", only cursor-selected
  // (a red border), so playing one is always this list plus a focused index,
  // never a click-remembered show/card pairing the way ShowListView keeps one.
  private final List<Shows.Trailer> trailerList = new ArrayList<>();
  private final List<View> cardViews = new ArrayList<>();
  private int focusedIndex = -1;

  TrailersView(Context context) {
    super(context);
  }

  void setPlayListener(PlayListener listener) {
    playListener = listener;
  }

  /**
   * Plays the lone trailer when the show has exactly one -- there is nothing to
   * choose between, so the button activating plays it rather than putting up a
   * one-card grid. Driven by the button, not by onShown: the right-arrow that
   * moves the cursor onto the cards shows this pane too and must not play.
   */
  void playSoleTrailer() {
    if (filledShow != null && !filledShow.imdbChecked) {
      playWhenChecked = true; // the answer decides whether the trailer is alone
      return;
    }
    if (soleTrailerUrl != null && playListener != null) {
      playListener.onPlayTrailer(soleTrailerUrl);
    }
  }

  /** The imdb answer has landed: the cards, and any play it was holding up. */
  void onImdbChecked(Shows.Show show, boolean changed) {
    boolean play = playWhenChecked;
    playWhenChecked = false;
    if (!isCurrent(show)) return; // a later fill picks the new list up
    if (changed) {
      column.removeAllViews();
      fill(show);
    } else {
      setSole(show);
    }
    if (play) playSoleTrailer();
  }

  /** Only once the imdb video has been asked about is one trailer the only one. */
  private void setSole(Shows.Show show) {
    List<Shows.Trailer> trailers = show.trailers;
    soleTrailerUrl =
        show.imdbChecked && trailers.size() == 1 ? trailers.get(0).url : null;
  }

  @Override
  protected void fill(Shows.Show show) {
    List<Shows.Trailer> trailers = show.trailers;
    filledShow = show;
    playWhenChecked = false;
    setSole(show);
    trailerList.clear();
    trailerList.addAll(trailers);
    cardViews.clear();
    focusedIndex = -1;
    if (trailers.isEmpty()) {
      addMessage("No trailers found.");
      return;
    }
    for (int i = 0; i < trailers.size(); i++) {
      View card = card(trailers.get(i), show);
      cardViews.add(card);
      addRow(card, i == 0 ? 0 : CARD_GAP_DP);
    }
  }

  /** The trailer button's right-arrow, button-to-grid transition. */
  boolean focusTopCard() {
    if (cardViews.isEmpty()) return false;
    setFocusedIndex(0);
    return true;
  }

  /** Cursor leaves the grid -- back to the trailer button, or a show/tab change. */
  void clearCardFocus() {
    // The cursor has moved off the trailer button as well, so a play the imdb
    // answer is still holding up is one nobody is waiting for any more.
    playWhenChecked = false;
    setFocusedIndex(-1);
  }

  boolean hasFocusedCard() {
    return focusedIndex >= 0 && focusedIndex < cardViews.size();
  }

  boolean moveCardFocus(int direction) {
    if (cardViews.isEmpty()) return false;
    int next = focusedIndex + direction;
    if (next < 0 || next >= cardViews.size()) return false;
    setFocusedIndex(next);
    return true;
  }

  boolean activateFocusedCard() {
    if (focusedIndex < 0 || focusedIndex >= trailerList.size()) return false;
    if (playListener != null) playListener.onPlayTrailer(trailerList.get(focusedIndex).url);
    return true;
  }

  private void setFocusedIndex(int index) {
    if (focusedIndex == index) return;
    int old = focusedIndex;
    focusedIndex = index;
    if (old >= 0 && old < cardViews.size()) paintFocus(old);
    if (index >= 0 && index < cardViews.size()) {
      paintFocus(index);
      scrollToCard(cardViews.get(index));
    }
  }

  private void paintFocus(int index) {
    GradientDrawable bg = (GradientDrawable) cardViews.get(index).getBackground();
    bg.setStroke(index == focusedIndex ? (int) dp(CARD_SELECTED_BORDER_DP) : 0, CARD_SELECTED_BORDER);
  }

  /** Scrolls only as far as needed to bring the cursor card into view. */
  private void scrollToCard(View card) {
    post(
        () -> {
          int viewTop = getScrollY();
          int viewBottom = viewTop + getHeight();
          int cardTop = card.getTop();
          int cardBottom = cardTop + card.getHeight();
          if (cardTop < viewTop) scrollTo(0, cardTop);
          else if (cardBottom > viewBottom) scrollTo(0, cardBottom - getHeight());
        });
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
    // YouTube publishes a still; the imdb video does not, so its own first
    // frame stands in -- what the web client's video element shows there.
    String thumbnail = Trailers.thumbnail(trailer.url);
    if (thumbnail.isEmpty()) Images.frameInto(still, trailer.url, show);
    else Images.into(still, thumbnail, show);

    card.setOnClickListener(
        v -> {
          if (playListener != null) playListener.onPlayTrailer(trailer.url);
        });
    return card;
  }
}
