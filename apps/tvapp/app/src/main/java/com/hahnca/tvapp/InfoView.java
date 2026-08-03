package com.hahnca.tvapp;

import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.util.TypedValue;
import android.view.View;
import android.view.ViewGroup;
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
 * No buttons — the pane's actions live on this screen's own Emby button.
 */
class InfoView extends LinearLayout implements Pane {

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
  private static final int TEXT_FOCUS_BORDER = 0xFFFF0000;
  private static final float TEXT_FOCUS_BORDER_DP = 3f;

  private final TextView title;
  private final ImageView poster;
  private final LinearLayout fields;
  private final TextView overview;
  private final ScrollView overviewScroll;
  // The description is this pane's one focusable item, so the cursor border
  // goes on its own background rather than on the pane's.
  private final GradientDrawable overviewBg = new GradientDrawable();

  private Shows.Show show;
  private Shows.Show filled;

  InfoView(Context context) {
    super(context);
    setOrientation(VERTICAL);
    int pad = (int) dp(PAD_DP);
    setPadding(pad, pad, pad, pad);

    title = new TextView(context);
    title.setTextColor(Color.WHITE);
    title.setTextSize(TypedValue.COMPLEX_UNIT_SP, TITLE_TEXT_SIZE_SP);
    title.setSingleLine(true);
    title.setEllipsize(android.text.TextUtils.TruncateAt.END);
    addView(title, wrap());

    LinearLayout top = new LinearLayout(context);
    top.setOrientation(HORIZONTAL);
    LinearLayout.LayoutParams topParams = wrap();
    topParams.topMargin = (int) dp(PAD_DP / 2);
    addView(top, topParams);

    poster = new ImageView(context);
    poster.setScaleType(ImageView.ScaleType.CENTER_CROP);
    poster.setBackgroundColor(POSTER_PLACEHOLDER_BG);
    top.addView(
        poster,
        new LinearLayout.LayoutParams(
            (int) dp(POSTER_WIDTH_DP), (int) dp(POSTER_WIDTH_DP * POSTER_ASPECT)));

    fields = new LinearLayout(context);
    fields.setOrientation(VERTICAL);
    LinearLayout.LayoutParams fieldsParams =
        new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
    fieldsParams.leftMargin = (int) dp(FIELD_GAP_DP);
    top.addView(fields, fieldsParams);

    overview = new TextView(context);
    overview.setTextColor(OVERVIEW_COLOR);
    overview.setTextSize(TypedValue.COMPLEX_UNIT_SP, OVERVIEW_TEXT_SIZE_SP);
    overviewScroll = new ScrollView(context);
    // Padded by the width of the cursor border whether it is showing or not,
    // so focus does not shift the text sideways as it comes and goes.
    int border = (int) dp(TEXT_FOCUS_BORDER_DP);
    overviewScroll.setPadding(border, border, border, border);
    overviewBg.setColor(Color.TRANSPARENT);
    overviewScroll.setBackground(overviewBg);
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
    addView(overviewScroll, overviewParams);
  }

  void setPosterClickListener(OnClickListener listener) {
    poster.setOnClickListener(listener);
  }

  /** Scrolls the description; the rest of the pane stays put. */
  @Override
  public void scrollStep(int px) {
    overviewScroll.scrollBy(0, px);
  }

  /** The cursor is on the description — this pane's only focusable item. */
  void setTextFocused(boolean focused) {
    overviewBg.setStroke(focused ? (int) dp(TEXT_FOCUS_BORDER_DP) : 0, TEXT_FOCUS_BORDER);
  }

  void scrollTextToTop() {
    overviewScroll.smoothScrollTo(0, 0);
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

    Images.into(poster, show.image, show);
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

  private float dp(float value) {
    return TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics());
  }
}
