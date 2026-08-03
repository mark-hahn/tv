package com.hahnca.tvapp;

import android.graphics.Canvas;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Shader;
import android.util.TypedValue;
import android.view.View;
import android.view.ViewGroup;

/**
 * The "there is more this way" hint the scrolling views share: a band at an
 * edge of a scrolling view fading its content out into the screen behind it,
 * shown only while there is more to scroll to in that direction.
 *
 * The owner drives it from two overrides -- resize() from onSizeChanged and
 * draw() from dispatchDraw -- and keeps its arrow-key cursor out from under
 * the bands by treating size() as part of the edge it scrolls away from.
 */
class EdgeFade {

  static final float HEIGHT_DP = 56f;
  // Matches the app root's background (MainActivity's Color.BLACK) so the fade
  // reads as the content dissolving into the screen.
  private static final int COLOR = 0xFF000000;
  private static final int CLEAR = COLOR & 0x00FFFFFF;

  private final ViewGroup owner;
  private final boolean horizontal;
  private final float sizeDp;
  private final Paint startPaint = new Paint();
  private final Paint endPaint = new Paint();

  /** Top and bottom bands on a view that scrolls up and down. */
  static EdgeFade vertical(ViewGroup owner) {
    return new EdgeFade(owner, false, HEIGHT_DP);
  }

  /** Top and bottom bands, for a view that wants a shallower band than most. */
  static EdgeFade vertical(ViewGroup owner, float sizeDp) {
    return new EdgeFade(owner, false, sizeDp);
  }

  /** Left and right bands on a view that scrolls sideways. */
  static EdgeFade horizontal(ViewGroup owner, float sizeDp) {
    return new EdgeFade(owner, true, sizeDp);
  }

  private EdgeFade(ViewGroup owner, boolean horizontal, float sizeDp) {
    this.owner = owner;
    this.horizontal = horizontal;
    this.sizeDp = sizeDp;
  }

  /** How deep the band is, in pixels. */
  float size() {
    return TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP, sizeDp, owner.getResources().getDisplayMetrics());
  }

  /**
   * Rebuilds the gradients for a viewport this big along the scrolling axis --
   * its height for a vertical fade, its width for a horizontal one.
   */
  void resize(int extent) {
    if (extent <= 0) return;
    float fade = size();
    if (horizontal) {
      startPaint.setShader(
          new LinearGradient(0, 0, fade, 0, COLOR, CLEAR, Shader.TileMode.CLAMP));
      endPaint.setShader(
          new LinearGradient(extent - fade, 0, extent, 0, CLEAR, COLOR, Shader.TileMode.CLAMP));
    } else {
      startPaint.setShader(
          new LinearGradient(0, 0, 0, fade, COLOR, CLEAR, Shader.TileMode.CLAMP));
      endPaint.setShader(
          new LinearGradient(0, extent - fade, 0, extent, CLEAR, COLOR, Shader.TileMode.CLAMP));
    }
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
    canvas.save();
    float fade = size();
    if (horizontal) {
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
