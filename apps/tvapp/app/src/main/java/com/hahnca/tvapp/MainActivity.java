package com.hahnca.tvapp;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.widget.TextView;

public class MainActivity extends Activity {

  private static final float TEXT_SIZE_SP = 72f;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    // Cheap insurance: if the boot receiver lost the race with Wi-Fi coming up,
    // opening the app puts wireless debugging back.
    AdbWifi.enable(this);

    TextView text = new TextView(this);
    text.setText("TVAPP TEST");
    text.setTextSize(TypedValue.COMPLEX_UNIT_SP, TEXT_SIZE_SP);
    text.setTextColor(Color.WHITE);
    text.setBackgroundColor(Color.BLACK);
    text.setGravity(Gravity.CENTER);

    setContentView(text);
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
