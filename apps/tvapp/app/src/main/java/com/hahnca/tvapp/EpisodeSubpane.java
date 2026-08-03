package com.hahnca.tvapp;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.ShapeDrawable;
import android.graphics.drawable.shapes.RectShape;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.util.TypedValue;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import org.json.JSONObject;

/**
 * The web client's map-pane episode subpane: an episode's still, air date, and
 * overview, opened by clicking an episode cell in the Map tab's grid and
 * closed by clicking anywhere in it. MapPane gives it the bottom half of the
 * Map tab while it's open — see MapPane, MapView.EpisodeClickListener, and
 * MainActivity.
 */
class EpisodeSubpane extends LinearLayout implements Scroller {

  private static final String TAG = "tvapp";
  private static final String TMDB_URL = "https://hahnca.com/tv-srvr/api/getTmdb";
  private static final int BORDER_COLOR = Color.BLACK;
  private static final float BORDER_DP = 3f;
  private static final int BG_COLOR = Color.WHITE;
  private static final int IMAGE_PLACEHOLDER_BG = 0xFFDDDDDD;
  // The placeholder is a drawable rather than a background colour so that it
  // has an intrinsic aspect of its own for adjustViewBounds to size a width
  // from — a background paints behind the view but cannot measure it, so a
  // still-less episode would otherwise collapse the column to nothing.
  private static final int PLACEHOLDER_ASPECT_W = 16;
  private static final int PLACEHOLDER_ASPECT_H = 9;
  private static final float TEXT_PAD_DP = 8f;
  private static final float AIRED_TEXT_SIZE_SP = 14.4f;
  private static final float OVERVIEW_TEXT_SIZE_SP = 14.4f;
  private static final int TEXT_COLOR = 0xFF333333;
  private static final int TEXT_FOCUS_BORDER = 0xFFFF0000;
  private static final float TEXT_FOCUS_BORDER_DP = 3f;

  private final ImageView image;
  private final TextView aired;
  private final TextView overview;
  private final ScrollView overviewScroll;
  // The description is the one thing in here the cursor can be on, so the
  // cursor border goes on its background rather than on the subpane's.
  private final GradientDrawable overviewBg = new GradientDrawable();
  private final Handler ui = new Handler(Looper.getMainLooper());

  // Stamped fresh on every load(); a reply whose token no longer matches lost
  // a race with a later click or a close and must not paint over it.
  private Object token;

  // Which episode is currently shown, so a second click on the same cell knows
  // to close rather than reload it.
  private String openShowName;
  private int openSeason = -1;
  private int openEpisode = -1;

  EpisodeSubpane(Context context) {
    super(context);
    setOrientation(VERTICAL);
    setVisibility(GONE);
    setBackgroundColor(BORDER_COLOR); // shows through above content as the top border

    LinearLayout content = new LinearLayout(context);
    content.setOrientation(HORIZONTAL);
    content.setBackgroundColor(BG_COLOR);
    LinearLayout.LayoutParams contentParams =
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
    contentParams.topMargin = (int) dp(BORDER_DP);
    addView(content, contentParams);

    // Full height of the subpane, with the width following from the still's
    // own proportions: adjustViewBounds sizes the free dimension — the width,
    // the height being fixed by the layout — off the drawable's aspect, so
    // the picture keeps the shape it was loaded at and is never cropped.
    image = new ImageView(context);
    image.setScaleType(ImageView.ScaleType.FIT_CENTER);
    image.setAdjustViewBounds(true);
    image.setImageDrawable(placeholder());
    content.addView(
        image,
        new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.MATCH_PARENT));

    LinearLayout textColumn = new LinearLayout(context);
    textColumn.setOrientation(VERTICAL);
    int textPad = (int) dp(TEXT_PAD_DP);
    textColumn.setPadding(textPad, textPad, textPad, textPad);
    content.addView(
        textColumn,
        new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f));

    aired = new TextView(context);
    aired.setTextColor(TEXT_COLOR);
    aired.setTextSize(TypedValue.COMPLEX_UNIT_SP, AIRED_TEXT_SIZE_SP);
    aired.setTypeface(Typeface.DEFAULT_BOLD);
    textColumn.addView(
        aired,
        new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

    overview = new TextView(context);
    overview.setTextColor(TEXT_COLOR);
    overview.setTextSize(TypedValue.COMPLEX_UNIT_SP, OVERVIEW_TEXT_SIZE_SP);
    overviewScroll = new ScrollView(context);
    // Padded by the width of the cursor border whether it is showing or not,
    // so focus does not shift the text sideways as it comes and goes.
    int border = (int) dp(TEXT_FOCUS_BORDER_DP);
    overviewScroll.setPadding(border, border, border, border);
    overviewBg.setColor(BG_COLOR);
    overviewScroll.setBackground(overviewBg);
    overviewScroll.addView(
        overview,
        new ScrollView.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    LinearLayout.LayoutParams overviewParams =
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
    overviewParams.topMargin = (int) dp(TEXT_PAD_DP / 2);
    textColumn.addView(overviewScroll, overviewParams);

    // Clicking anywhere in the subpane closes it. On the ScrollView too, not
    // just the TextView inside it: a ScrollView eats the touch itself and
    // never gets as far as performClick, so without its own listener a tap
    // over blank space below short overview text would go nowhere.
    View.OnClickListener closeListener = v -> close();
    setOnClickListener(closeListener);
    content.setOnClickListener(closeListener);
    image.setOnClickListener(closeListener);
    textColumn.setOnClickListener(closeListener);
    aired.setOnClickListener(closeListener);
    overview.setOnClickListener(closeListener);
    overviewScroll.setOnClickListener(closeListener);
  }

  boolean isOpen() {
    return getVisibility() == VISIBLE;
  }

  /** Two-finger scrolling anywhere over the subpane works the description. */
  @Override
  public void scrollStep(int px) {
    overviewScroll.scrollBy(0, px);
  }

  /** The cursor is on the description — the only focusable item in here. */
  void setTextFocused(boolean focused) {
    overviewBg.setStroke(focused ? (int) dp(TEXT_FOCUS_BORDER_DP) : 0, TEXT_FOCUS_BORDER);
  }

  void scrollTextToTop() {
    overviewScroll.smoothScrollTo(0, 0);
  }

  void close() {
    setVisibility(GONE);
    setTextFocused(false);
    token = null;
    openShowName = null;
    openSeason = -1;
    openEpisode = -1;
  }

  /**
   * An episode cell was clicked. A second click on the cell already showing
   * closes the pane; any other click opens it (if closed) or switches it (if
   * already open on a different episode) — it never closes on that click.
   */
  void toggle(String showName, int season, int episode) {
    if (isOpen()
        && season == openSeason
        && episode == openEpisode
        && showName.equals(openShowName)) {
      close();
      return;
    }
    open(showName, season, episode);
  }

  /**
   * Straight to this episode, open or not. What the remote's ok key does on a
   * focused cell: ok inside the subpane is what closes it again, so opening
   * never has to double as closing the way a second click does.
   */
  void open(String showName, int season, int episode) {
    openShowName = showName;
    openSeason = season;
    openEpisode = episode;
    load(showName, season, episode);
  }

  /** Opens (or stays open, switching contents) with showName's season/episode. */
  private void load(String showName, int season, int episode) {
    setVisibility(VISIBLE);

    image.setImageDrawable(placeholder());
    aired.setText("");
    overview.setText("");
    overviewScroll.scrollTo(0, 0);

    Object myToken = new Object();
    token = myToken;
    new Thread(
            () -> {
              String body;
              try {
                body =
                    Http.postJson(
                        TMDB_URL,
                        new JSONObject()
                            .put("showName", showName)
                            .put("season", season)
                            .put("episode", episode)
                            .toString());
              } catch (Exception e) {
                Log.e(
                    TAG,
                    "getTmdb failed for " + showName + " S" + season + "E" + episode + ": " + e);
                return;
              }
              JSONObject json;
              try {
                json = new JSONObject(body);
              } catch (Exception e) {
                Log.e(TAG, "getTmdb parse failed for " + showName + ": " + e);
                return;
              }
              String imageUrl = json.isNull("image") ? null : json.optString("image", null);
              String overviewText = json.optString("overview", "");
              String airedDate = json.optString("aired", "");
              ui.post(
                  () -> {
                    if (token != myToken) return; // superseded by another click or a close
                    aired.setText(airedDate.isEmpty() ? "" : airedDate.replace('-', '/'));
                    overview.setText(overviewText);
                    Images.into(image, imageUrl, myToken);
                    // into() clears the view before it starts fetching, which
                    // would leave a zero-width column for the length of the
                    // load; the placeholder holds the space until the bitmap
                    // lands on top of it.
                    image.setImageDrawable(placeholder());
                  });
            },
            "episode-subpane")
        .start();
  }

  /** A grey rectangle of the shape a still usually is, sized by its intrinsics. */
  private static ShapeDrawable placeholder() {
    ShapeDrawable drawable = new ShapeDrawable(new RectShape());
    drawable.getPaint().setColor(IMAGE_PLACEHOLDER_BG);
    drawable.setIntrinsicWidth(PLACEHOLDER_ASPECT_W);
    drawable.setIntrinsicHeight(PLACEHOLDER_ASPECT_H);
    return drawable;
  }

  private float dp(float value) {
    return TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics());
  }
}
