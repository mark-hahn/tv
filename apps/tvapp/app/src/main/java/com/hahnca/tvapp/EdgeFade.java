package com.hahnca.tvapp;

import android.graphics.Canvas;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Shader;
import android.util.TypedValue;
import android.view.View;
import android.view.ViewGroup;

/**
 * The "there is more this way" hint a scrolling view wears: a band at the edge
 * it can still scroll towards, fading its content out into whatever it is drawn
 * on, and shown only while there is more that way to reach.
 *
 * The owner drives it from two overrides -- resize() from onSizeChanged and
 * draw() from dispatchDraw -- and keeps its selected card out from under the
 * bands by treating size() as part of the edge it scrolls away from.
 */
class EdgeFade {

  static final float HEIGHT_DP = 56f;
  // Matches the app root's background (MainActivity's Color.BLACK) so the fade
  // reads as the content dissolving into the screen.
  private static final int COLOR = 0xFF000000;

  private final ViewGroup owner;
  private final float sizeDp;
  private final boolean sideways;
  private final int color;
  private final Paint startPaint = new Paint();
  private final Paint endPaint = new Paint();

  /** Top and bottom bands on a view that scrolls up and down. */
  static EdgeFade vertical(ViewGroup owner) {
    return new EdgeFade(owner, HEIGHT_DP, false, COLOR);
  }

  /**
   * Left and right bands on a view that scrolls sideways. The colour is the
   * caller's because a strip inside a card dissolves into the card, not into
   * the screen behind it.
   */
  static EdgeFade horizontal(ViewGroup owner, float sizeDp, int color) {
    return new EdgeFade(owner, sizeDp, true, color);
  }

  private EdgeFade(ViewGroup owner, float sizeDp, boolean sideways, int color) {
    this.owner = owner;
    this.sizeDp = sizeDp;
    this.sideways = sideways;
    this.color = color;
  }

  /** How deep the band is, in pixels. */
  float size() {
    return TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP, sizeDp, owner.getResources().getDisplayMetrics());
  }

  /** Rebuilds the gradients for a viewport this long along the scroll axis. */
  void resize(int extent) {
    if (extent <= 0) return;
    float fade = size();
    int clear = color & 0x00FFFFFF;
    if (sideways) {
      startPaint.setShader(
          new LinearGradient(0, 0, fade, 0, color, clear, Shader.TileMode.CLAMP));
      endPaint.setShader(
          new LinearGradient(extent - fade, 0, extent, 0, clear, color, Shader.TileMode.CLAMP));
      return;
    }
    startPaint.setShader(new LinearGradient(0, 0, 0, fade, color, clear, Shader.TileMode.CLAMP));
    endPaint.setShader(
        new LinearGradient(0, extent - fade, 0, extent, clear, color, Shader.TileMode.CLAMP));
  }

  /**
   * Paints the bands over content already drawn. dispatchDraw's canvas is
   * still in the scrolled content's coordinates, so it is shifted back by the
   * scroll first -- that pins the bands to the view's own edges instead of
   * letting them ride away with the content.
   */
  void draw(Canvas canvas) {
    View content = owner.getChildCount() == 0 ? null : owner.getChildAt(0);
    if (content == null) return;
    int w = owner.getWidth();
    int h = owner.getHeight();
    float fade = size();
    canvas.save();
    if (sideways) {
      int scroll = owner.getScrollX();
      canvas.translate(scroll, 0);
      if (scroll > 0) canvas.drawRect(0, 0, fade, h, startPaint);
      if (content.getWidth() > scroll + w) canvas.drawRect(w - fade, 0, w, h, endPaint);
    } else {
      int scroll = owner.getScrollY();
      canvas.translate(0, scroll);
      if (scroll > 0) canvas.drawRect(0, 0, w, fade, startPaint);
      if (content.getHeight() > scroll + h) canvas.drawRect(0, h - fade, w, h, endPaint);
    }
    canvas.restore();
  }
}
