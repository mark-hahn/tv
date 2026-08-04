package com.hahnca.tvapp;

import android.content.Context;
import android.graphics.Color;
import android.util.TypedValue;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/**
 * The web client's info pane, as much of it as a couch and a pointer want: the
 * show name, its poster, the same one-per-line field list the phone remote's
 * Info tab shows, and the overview under them. The fields and their order are
 * mirrored from there, so the three uis read alike.
 *
 * No buttons — the pane's actions live on this screen's own Emby button. Ok
 * on the pane blows the poster up to fill it (aspect kept, letterboxed); ok,
 * any arrow, or back shrinks it back down.
 */
class InfoView extends FrameLayout implements Pane {

  private static final float PAD_DP = 24f;
  private static final float POSTER_WIDTH_DP = 137f;
  private static final float POSTER_ASPECT = 3f / 2f; // height / width
  private static final float FIELD_GAP_DP = 20f;
  private static final float TITLE_TEXT_SIZE_SP = 25.2f;
  private static final float FIELD_TEXT_SIZE_SP = 15.3f;
  private static final float OVERVIEW_TEXT_SIZE_SP = 16.2f;
  private static final int FIELD_COLOR = 0xFFC8C8C8;
  private static final int OVERVIEW_COLOR = 0xFFE0E0E0;
  private static final int POSTER_PLACEHOLDER_BG = 0xFF303030;

  private final LinearLayout content;
  private final TextView title;
  private final ImageView poster;
  private final ImageView bigPoster;
  private final LinearLayout fields;
  private final TextView overview;
  private final ScrollView overviewScroll;

  private Shows.Show show;
  private Shows.Show filled;
  private boolean posterOpen;

  InfoView(Context context) {
    super(context);

    content = new LinearLayout(context);
    content.setOrientation(LinearLayout.VERTICAL);
    int pad = (int) dp(PAD_DP);
    content.setPadding(pad, (int) dp(ScrollPane.PAD_TOP_DP), pad, pad);
    addView(content, matchParent());

    title = new TextView(context);
    title.setTextColor(Color.WHITE);
    title.setTextSize(TypedValue.COMPLEX_UNIT_SP, TITLE_TEXT_SIZE_SP);
    title.setSingleLine(true);
    title.setEllipsize(android.text.TextUtils.TruncateAt.END);
    content.addView(title, wrap());

    LinearLayout top = new LinearLayout(context);
    top.setOrientation(LinearLayout.HORIZONTAL);
    LinearLayout.LayoutParams topParams = wrap();
    topParams.topMargin = (int) dp(PAD_DP / 2);
    content.addView(top, topParams);

    poster = new ImageView(context);
    poster.setScaleType(ImageView.ScaleType.CENTER_CROP);
    poster.setBackgroundColor(POSTER_PLACEHOLDER_BG);
    top.addView(
        poster,
        new LinearLayout.LayoutParams(
            (int) dp(POSTER_WIDTH_DP), (int) dp(POSTER_WIDTH_DP * POSTER_ASPECT)));

    fields = new LinearLayout(context);
    fields.setOrientation(LinearLayout.VERTICAL);
    LinearLayout.LayoutParams fieldsParams =
        new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
    fieldsParams.leftMargin = (int) dp(FIELD_GAP_DP);
    top.addView(fields, fieldsParams);

    overview = new TextView(context);
    overview.setTextColor(OVERVIEW_COLOR);
    overview.setTextSize(TypedValue.COMPLEX_UNIT_SP, OVERVIEW_TEXT_SIZE_SP);
    overviewScroll = new ScrollView(context);
    // Clicking the description puts it back at the top, the same shortcut the
    // other list panes have. On the TextView, not just the ScrollView: a
    // ScrollView eats the touch itself and never gets as far as performClick.
    overview.setOnClickListener(v -> overviewScroll.smoothScrollTo(0, 0));
    overviewScroll.setOnClickListener(v -> overviewScroll.smoothScrollTo(0, 0));
    overviewScroll.addView(
        overview,
        new ScrollView.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    LinearLayout.LayoutParams overviewParams =
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
    overviewParams.topMargin = (int) dp(PAD_DP / 2);
    content.addView(overviewScroll, overviewParams);

    // On top of everything, hidden until ok opens it. FIT_CENTER letterboxes
    // it inside the pane rather than cropping, unlike the small poster above.
    bigPoster = new ImageView(context);
    bigPoster.setScaleType(ImageView.ScaleType.FIT_CENTER);
    bigPoster.setBackgroundColor(POSTER_PLACEHOLDER_BG);
    bigPoster.setVisibility(View.GONE);
    addView(bigPoster, matchParent());
  }

  void setPosterClickListener(OnClickListener listener) {
    poster.setOnClickListener(listener);
  }

  boolean isPosterOpen() {
    return posterOpen;
  }

  void openPoster() {
    if (show == null) return;
    posterOpen = true;
    content.setVisibility(View.INVISIBLE);
    bigPoster.setVisibility(View.VISIBLE);
  }

  void closePoster() {
    posterOpen = false;
    bigPoster.setVisibility(View.GONE);
    content.setVisibility(View.VISIBLE);
  }

  /** Scrolls the description; the rest of the pane stays put. */
  @Override
  public void scrollStep(int px) {
    overviewScroll.scrollBy(0, px);
  }

  @Override
  public View scrollableView() {
    return overviewScroll;
  }

  @Override
  public View asView() {
    return this;
  }

  @Override
  public void setShow(Shows.Show show) {
    this.show = show;
    if (getVisibility() == VISIBLE) refill();
  }

  @Override
  public void onShown() {
    refill();
  }

  private void refill() {
    if (show == filled) return;
    filled = show;
    closePoster();
    if (show != null) apply(show);
  }

  private void apply(Shows.Show show) {
    title.setText(show.name);
    overview.setText(show.overview);
    overviewScroll.scrollTo(0, 0);

    fields.removeAllViews();
    addField(joinRow(show.firstAired, show.lastAired, show.status));
    addField(joinRow(seasonsText(show.seasonCount), watchedText(show)));
    addField(joinRowWithSlash(show.countryLang.toUpperCase(), show.network));
    addField(lastWatchedText(show.lastPlayedDate));
    addField(show.genres);
    addField(show.averageRuntime > 0 ? show.averageRuntime + " Mins" : "");
    addField(collectionsText(show));
    addField(show.inEmby ? "" : "Not In Emby");

    Images.into(poster, show.image, show);
    Images.into(bigPoster, show.image, show);
  }

  private static String joinRow(String... parts) {
    StringBuilder out = new StringBuilder();
    for (String part : parts) {
      if (part == null || part.isEmpty()) continue;
      if (out.length() > 0) out.append(" - ");
      out.append(part);
    }
    return out.toString();
  }

  private static String joinRowWithSlash(String... parts) {
    StringBuilder out = new StringBuilder();
    for (String part : parts) {
      if (part == null || part.isEmpty()) continue;
      if (out.length() > 0) out.append(" / ");
      out.append(part);
    }
    return out.toString();
  }

  private static String lastWatchedText(String lastPlayedDate) {
    if (lastPlayedDate == null || lastPlayedDate.isEmpty()) return "";
    String date = lastPlayedDate.split(" ")[0];
    return date.isEmpty() ? "" : "Last watched: " + date;
  }

  private static String collectionsText(Shows.Show show) {
    StringBuilder names = new StringBuilder();
    int count = 0;
    if (show.inToTry) count = appendCollection(names, count, "To Try");
    if (show.inContinue) count = appendCollection(names, count, "Continue");
    if (show.inMark) count = appendCollection(names, count, "Mark");
    if (show.inLinda) count = appendCollection(names, count, "Linda");
    if (count == 0) return "";
    return (count > 1 ? "Collections: " : "Collection: ") + names;
  }

  private static int appendCollection(StringBuilder names, int count, String name) {
    if (count > 0) names.append(", ");
    names.append(name);
    return count + 1;
  }

  private static String seasonsText(int seasonCount) {
    if (seasonCount == 1) return "1 Season";
    return seasonCount > 1 ? seasonCount + " Seasons" : "";
  }

  private static String watchedText(Shows.Show show) {
    if (show.episodeCount <= 0 || show.watchedCount < 0) return "";
    if (show.watchedCount == show.episodeCount) {
      return "Watched all " + show.episodeCount + " episodes";
    }
    return "Watched " + show.watchedCount + " of " + show.episodeCount;
  }

  private void addField(String text) {
    if (text.isEmpty()) return;
    TextView field = new TextView(getContext());
    field.setText(text);
    field.setTextColor(FIELD_COLOR);
    field.setTextSize(TypedValue.COMPLEX_UNIT_SP, FIELD_TEXT_SIZE_SP);
    fields.addView(field, wrap());
  }

  private LinearLayout.LayoutParams wrap() {
    return new LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
  }

  private FrameLayout.LayoutParams matchParent() {
    return new FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
  }

  private float dp(float value) {
    return TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics());
  }
}
