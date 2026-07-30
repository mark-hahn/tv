package com.hahnca.tvapp;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;

public class MainActivity extends Activity implements CtrlServer.Listener {

  private static final float EXIT_TEXT_SIZE_SP = 20f;
  private static final float EXIT_MARGIN_DP = 24f;

  private final Handler ui = new Handler(Looper.getMainLooper());

  private CursorView cursor;
  private CtrlServer ctrlServer;

  // A drag sends motion at ~60 Hz from the socket thread. Deltas are summed and
  // applied by one posted runnable rather than posting one per packet.
  private float pendingDx;
  private float pendingDy;
  private boolean movePending;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    // Cheap insurance: if the boot receiver lost the race with Wi-Fi coming up,
    // opening the app puts wireless debugging back.
    AdbWifi.enable(this);

    // The tv's screensaver takes the screen out from under a cursor that is
    // being dragged, and a dream deep enough to stop the activity would take the
    // ctrl socket with it.
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

    setContentView(buildUi());

    ctrlServer = new CtrlServer(this);
    ctrlServer.start();
  }

  private View buildUi() {
    FrameLayout root = new FrameLayout(this);
    root.setBackgroundColor(Color.BLACK);

    Button exit = new Button(this);
    exit.setText("Exit");
    exit.setTextSize(TypedValue.COMPLEX_UNIT_SP, EXIT_TEXT_SIZE_SP);
    exit.setOnClickListener(v -> finishAndRemoveTask());
    FrameLayout.LayoutParams exitParams =
        new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.TOP | Gravity.END);
    int margin = (int) dp(EXIT_MARGIN_DP);
    exitParams.setMargins(margin, margin, margin, margin);
    root.addView(exit, exitParams);

    // Added last so the arrow draws over everything else.
    cursor = new CursorView(this);
    root.addView(cursor, matchParent());

    return root;
  }

  private FrameLayout.LayoutParams matchParent() {
    return new FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
  }

  private float dp(float value) {
    return TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics());
  }

  @Override
  protected void onDestroy() {
    ctrlServer.shutdown();
    super.onDestroy();
  }

  @Override
  public void onMove(float dx, float dy) {
    synchronized (this) {
      pendingDx += dx;
      pendingDy += dy;
      if (movePending) return;
      movePending = true;
    }
    ui.post(this::applyMove);
  }

  private void applyMove() {
    float dx;
    float dy;
    synchronized (this) {
      dx = pendingDx;
      dy = pendingDy;
      pendingDx = 0;
      pendingDy = 0;
      movePending = false;
    }
    cursor.moveBy(dx, dy);
  }

  @Override
  public void onClick() {
    ui.post(this::clickAtCursor);
  }

  // Closing tvappctrl on the phone closes tvapp here. The reverse direction needs
  // nothing: the relay notices this activity's socket dropping.
  @Override
  public void onExit() {
    ui.post(this::finishAndRemoveTask);
  }

  /**
   * Clicks whatever is under the arrow by synthesizing a touch at the cursor
   * hotspot. Dispatching into the view hierarchy instead of calling a listener
   * directly means any widget this ui grows is clickable with no more plumbing.
   */
  private void clickAtCursor() {
    float x = cursor.getPosX();
    float y = cursor.getPosY();
    View root = getWindow().getDecorView();
    long now = SystemClock.uptimeMillis();
    dispatchTouch(root, MotionEvent.ACTION_DOWN, now, x, y);
    dispatchTouch(root, MotionEvent.ACTION_UP, now, x, y);
  }

  private void dispatchTouch(View root, int action, long downTime, float x, float y) {
    MotionEvent event = MotionEvent.obtain(downTime, downTime, action, x, y, 0);
    root.dispatchTouchEvent(event);
    event.recycle();
  }

  @Override
  public boolean onKeyDown(int keyCode, KeyEvent event) {
    if (keyCode == KeyEvent.KEYCODE_BACK) {
      finishAndRemoveTask();
      return true;
    }
    return super.onKeyDown(keyCode, event);
  }
}
