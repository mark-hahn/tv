package com.hahnca.tvapp;

import android.content.Context;
import android.graphics.Color;
import android.util.Log;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The Reviews tab: IMDb user reviews for the show, from the same tv-api call
 * the web client makes, which does the filtering (English, long enough) and the
 * 10-point to 5-point star conversion. IMDb refuses the call often enough that
 * its error is worth showing rather than an empty pane.
 */
class ReviewsView extends ScrollPane {

  private static final String REVIEWS_URL =
      "https://hahnca.com/tv-api/api/reviews/getImdbReviews?imdbId=";
  private static final String TAG = "tvapp";
  private static final float AUTHOR_TEXT_SIZE_SP = 17f;
  private static final float REVIEW_GAP_DP = 20f;

  private static class Review {
    final String author;
    final String stars;
    final String text;

    Review(String author, String stars, String text) {
      this.author = author;
      this.stars = stars;
      this.text = text;
    }
  }

  ReviewsView(Context context) {
    super(context);
  }

  @Override
  protected void fill(Shows.Show show) {
    if (show.imdbId.isEmpty()) {
      addMessage("No IMDb id for this show.");
      return;
    }
    addMessage("Loading…");
    new Thread(
            () -> {
              String error = null;
              List<Review> reviews = new ArrayList<>();
              try {
                error = parse(Http.get(REVIEWS_URL + show.imdbId), reviews);
              } catch (Exception e) {
                error = e.getMessage();
                Log.e(TAG, "reviews load failed for " + show.name + ": " + e);
              }
              final String failure = error;
              ui.post(
                  () -> {
                    if (!isCurrent(show)) return; // another show owns the pane
                    show(reviews, failure);
                  });
            },
            "reviews")
        .start();
  }

  private void show(List<Review> reviews, String error) {
    column.removeAllViews();
    if (reviews.isEmpty()) {
      addMessage(error == null ? "No reviews." : "No reviews: " + error);
      return;
    }
    for (int i = 0; i < reviews.size(); i++) {
      Review review = reviews.get(i);
      addRow(text(review.author + review.stars, AUTHOR_TEXT_SIZE_SP, Color.WHITE), i == 0 ? 0 : REVIEW_GAP_DP);
      addRow(text(review.text, TEXT_SIZE_SP, TEXT_COLOR), 0);
    }
  }

  /** Fills reviews and returns the server's error, or null when there is none. */
  private static String parse(String body, List<Review> reviews) throws Exception {
    JSONObject json = new JSONObject(body);
    JSONArray array = json.optJSONArray("reviews");
    for (int i = 0; array != null && i < array.length(); i++) {
      JSONObject node = array.getJSONObject(i);
      double numStars = node.optDouble("numStars", -1);
      String stars = numStars < 0 ? "" : "  " + numStars + " / 5";
      reviews.add(
          new Review(
              node.optString("author", "Anonymous"), stars, node.optString("text", "")));
    }
    return json.isNull("error") ? null : json.optString("error", null);
  }
}
