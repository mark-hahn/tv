package com.hahnca.tvapp;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.util.TypedValue;
import android.view.View;

/**
 * The pointer tvappctrl drives. It is a full-screen overlay so the arrow can be
 * anywhere, and it is deliberately never clickable: a click command is
 * dispatched as a synthetic touch at the cursor hotspot, which has to fall
 * through this view to whatever is underneath it.
 */
class CursorView extends View {

  // A plain arrow pointer outlined in a 12x19 box with its hotspot at (0,0), so
  // the shape points up and to the left. Scaled to CURSOR_HEIGHT_DP, which is
  // larger than a desktop cursor because this one is read from a couch.
  private static final float[] SHAPE_X = {0, 0, 4, 7, 10, 7, 12};
  private static final float[] SHAPE_Y = {0, 16, 12, 19, 17, 11, 11};
  private static final float SHAPE_HEIGHT = 19f;
  private static final float CURSOR_HEIGHT_DP = 24f;
  // Fat enough that a white arrow still reads when it is over white content —
  // it starts life centered on the placeholder text, which is exactly that.
  private static final float OUTLINE_WIDTH_DP = 3f;
  // Being the last child is not enough to draw on top: a Button has elevation
  // and would otherwise cover the arrow. Nothing else in the app is raised, so
  // any value clear of the platform's own is fine. No background means no
  // shadow comes with it.
  private static final float ELEVATION_DP = 100f;

  private final Paint fillPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
  private final Paint outlinePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
  private final Path arrow = new Path();

  private float posX;
  private float posY;
  private boolean placed;
  // Where a restored arrow lands at the first layout. NaN for the middle of the
  // screen, which is where a first run starts.
  private float startX = Float.NaN;
  private float startY = Float.NaN;

  CursorView(Context context) {
    super(context);

    fillPaint.setStyle(Paint.Style.FILL);
    fillPaint.setColor(Color.WHITE);
    outlinePaint.setStyle(Paint.Style.STROKE);
    outlinePaint.setColor(Color.BLACK);
    outlinePaint.setStrokeWidth(dp(OUTLINE_WIDTH_DP));
    setElevation(dp(ELEVATION_DP));

    float scale = dp(CURSOR_HEIGHT_DP) / SHAPE_HEIGHT;
    arrow.moveTo(SHAPE_X[0] * scale, SHAPE_Y[0] * scale);
    for (int i = 1; i < SHAPE_X.length; i++) {
      arrow.lineTo(SHAPE_X[i] * scale, SHAPE_Y[i] * scale);
    }
    arrow.close();
  }

  float getPosX() {
    return posX;
  }

  float getPosY() {
    return posY;
  }

  void moveBy(float dx, float dy) {
    setPos(posX + dx, posY + dy);
  }

  /**
   * Where to put the arrow once there is a screen to put it on. Taken now and
   * applied at the first layout, because there is no size to clamp against
   * until then. NaN for either leaves that axis centered.
   */
  void startAt(float x, float y) {
    startX = x;
    startY = y;
  }

  private void setPos(float x, float y) {
    posX = clamp(x, getWidth());
    posY = clamp(y, getHeight());
    invalidate();
  }

  private static float clamp(float v, int size) {
    if (v < 0) return 0;
    float max = size - 1;
    return v > max ? max : v;
  }

  @Override
  protected void onSizeChanged(int w, int h, int oldW, int oldH) {
    super.onSizeChanged(w, h, oldW, oldH);
    if (!placed) {
      placed = true;
      setPos(Float.isNaN(startX) ? w / 2f : startX, Float.isNaN(startY) ? h / 2f : startY);
    } else {
      setPos(posX, posY); // a size change can leave the arrow off-screen
    }
  }

  @Override
  protected void onDraw(Canvas canvas) {
    canvas.save();
    canvas.translate(posX, posY);
    // Outline first: a centered stroke drawn after the fill would eat half the
    // white and leave the arrow looking like a thin black scratch.
    canvas.drawPath(arrow, outlinePaint);
    canvas.drawPath(arrow, fillPaint);
    canvas.restore();
  }

  private float dp(float value) {
    return TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics());
  }
}
