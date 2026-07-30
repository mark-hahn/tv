package com.hahnca.tvapp;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Re-enables wireless debugging after a reboot. Android also switches it off
 * whenever Wi-Fi drops, and Wi-Fi is often still coming up when BOOT_COMPLETED
 * fires, so the setting is re-asserted for a while rather than written once.
 */
public class BootReceiver extends BroadcastReceiver {

  private static final int RETRIES = 12;
  private static final long RETRY_MS = 3000;

  @Override
  public void onReceive(Context context, Intent intent) {
    final PendingResult result = goAsync();
    final Context appContext = context.getApplicationContext();
    new Thread(() -> {
      try {
        for (int i = 0; i < RETRIES; i++) {
          AdbWifi.enable(appContext);
          Thread.sleep(RETRY_MS);
        }
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      } finally {
        result.finish();
      }
    }).start();
  }
}
