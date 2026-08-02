package com.hahnca.tvapp;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/**
 * What every pane but Info is: a column of rows that scrolls as a whole. Holds
 * the show-changed bookkeeping so a pane only has to say how to fill itself.
 */
abstract class ScrollPane extends ScrollView implements Pane {

  static final float PAD_DP = 24f;
  static final float TEXT_SIZE_SP = 15.3f;
  static final int TEXT_COLOR = 0xFFE0E0E0;
  static final int DIM_COLOR = 0xFF9A9A9A;

  protected final Handler ui = new Handler(Looper.getMainLooper());
  protected final LinearLayout column;
  /** Null unless this pane goes sideways as well; only Map does. */
  private final HorizontalScrollView across;

  private Shows.Show show;
  private Shows.Show filled;

  ScrollPane(Context context) {
    this(context, false);
  }

  ScrollPane(Context context, boolean horizontal) {
    super(context);
    column = new LinearLayout(context);
    column.setOrientation(LinearLayout.VERTICAL);
    int pad = (int) dp(PAD_DP);
    column.setPadding(pad, pad, pad, pad);
    if (horizontal) {
      // fillViewport so content narrower than the pane still spreads across it:
      // weighted columns only have spare width to share out when the row is
      // measured against the viewport rather than against its own content.
      across = new HorizontalScrollView(context);
      across.setFillViewport(true);
      across.addView(
          column,
          new FrameLayout.LayoutParams(
              ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
      addView(
          across,
          new ScrollView.LayoutParams(
              ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    } else {
      across = null;
      addView(
          column,
          new ScrollView.LayoutParams(
              ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    }
    // On the column, not on the ScrollView: a ScrollView eats the touch itself
    // and never gets as far as performClick.
    column.setOnClickListener(v -> scrollToStart());
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

  @Override
  public void scrollStep(int px) {
    scrollBy(0, px);
  }

  @Override
  public void scrollStepX(int px) {
    if (across != null) across.scrollBy(px, 0);
  }

  @Override
  public View asView() {
    return this;
  }

  /** Back to the top, and to the far left of anything that went sideways. */
  void scrollToStart() {
    smoothScrollTo(0, 0);
    if (across != null) across.smoothScrollTo(0, 0);
  }

  /** True while the given show is still the one this pane is filled with. */
  protected boolean isCurrent(Shows.Show show) {
    return show == filled;
  }

  protected abstract void fill(Shows.Show show);

  private void refill() {
    if (show == filled) return;
    filled = show;
    column.removeAllViews();
    scrollTo(0, 0);
    if (across != null) across.scrollTo(0, 0);
    if (show != null) fill(show);
  }

  protected TextView text(String value, float sizeSp, int color) {
    TextView view = new TextView(getContext());
    view.setText(value);
    view.setTextColor(color);
    view.setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp);
    return view;
  }

  protected void addRow(View view, float topMarginDp) {
    LinearLayout.LayoutParams params =
        new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    params.topMargin = (int) dp(topMarginDp);
    column.addView(view, params);
  }

  protected void addMessage(String message) {
    column.removeAllViews();
    addRow(text(message, TEXT_SIZE_SP, DIM_COLOR), 0);
  }

  protected float dp(float value) {
    return TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics());
  }
}
