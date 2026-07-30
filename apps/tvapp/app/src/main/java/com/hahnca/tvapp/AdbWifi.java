package com.hahnca.tvapp;

import android.content.Context;
import android.provider.Settings;
import android.util.Log;

/**
 * Turns wireless debugging back on. Android clears this setting on every boot,
 * so nothing can reach the TV over adb until something flips it again.
 *
 * Writing it needs WRITE_SECURE_SETTINGS, which is a development permission —
 * not held by default, but grantable once over adb:
 *   adb shell pm grant com.hahnca.tvapp android.permission.WRITE_SECURE_SETTINGS
 */
final class AdbWifi {

  private static final String TAG = "tvapp";
  private static final String ADB_WIFI_ENABLED = "adb_wifi_enabled";

  private AdbWifi() {}

  static void enable(Context context) {
    try {
      Settings.Global.putInt(context.getContentResolver(), ADB_WIFI_ENABLED, 1);
      Log.i(TAG, "wireless debugging enabled");
    } catch (SecurityException e) {
      Log.w(TAG, "cannot enable wireless debugging: " + e.getMessage()
          + " -- run: adb shell pm grant " + context.getPackageName()
          + " android.permission.WRITE_SECURE_SETTINGS");
    }
  }
}
