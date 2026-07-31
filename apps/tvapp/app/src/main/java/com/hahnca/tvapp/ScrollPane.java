package com.hahnca.tvapp;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/**
 * What every pane but Info is: a column of rows that scrolls as a whole. Holds
 * the show-changed bookkeeping so a pane only has to say how to fill itself.
 */
abstract class ScrollPane extends ScrollView implements Pane {

  static final float PAD_DP = 24f;
  static final float TEXT_SIZE_SP = 17f;
  static final int TEXT_COLOR = 0xFFE0E0E0;
  static final int DIM_COLOR = 0xFF9A9A9A;

  protected final Handler ui = new Handler(Looper.getMainLooper());
  protected final LinearLayout column;

  private Shows.Show show;
  private Shows.Show filled;

  ScrollPane(Context context) {
    super(context);
    column = new LinearLayout(context);
    column.setOrientation(LinearLayout.VERTICAL);
    int pad = (int) dp(PAD_DP);
    column.setPadding(pad, pad, pad, pad);
    addView(
        column,
        new ScrollView.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
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
  public View asView() {
    return this;
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
