package com.hahnca.tvapp;

/** Shared map-cell text and colors, kept in step with the web map. */
class MapCells {

  static final int BG_NORMAL = 0xFFFFFFFF;
  static final int BG_NO_FILE = 0xFFFFAAAA;
  static final int BG_ERROR = 0xFFFFFF00;

  static int background(boolean error, boolean noFile) {
    if (error) return BG_ERROR;
    if (noFile) return BG_NO_FILE;
    return BG_NORMAL;
  }

  static String text(
      boolean played,
      boolean avail,
      boolean noFile,
      boolean unaired,
      int quality,
      long pos,
      boolean inEmby) {
    StringBuilder out = new StringBuilder();
    if (pos > 0) append(out, "p");
    if (played) append(out, "w");
    if (avail && !unaired && inEmby) append(out, qualityChar(quality));
    if (noFile && !unaired) append(out, "-");
    if (unaired && !played && noFile) append(out, "u");
    return out.toString();
  }

  private static void append(StringBuilder out, String value) {
    if (value.isEmpty()) return;
    if (out.length() > 0) out.append(" ");
    out.append(value);
  }

  private static String qualityChar(int quality) {
    if (quality <= 0) return "0";
    double digit = Math.round((Math.log(quality) / Math.log(2) - 8) * 3);
    return String.valueOf((long) digit);
  }
}