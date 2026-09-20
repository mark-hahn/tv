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

  // Mirrors RESOLUTION_DIGITS / normalizeVideoHeightToQuality in
  // packages/share/src/index.js. Rows are { height, digit }, highest first.
  private static final int[][] RESOLUTION_DIGITS = {
    {2160, 9}, {1080, 8}, {720, 7}, {576, 6}, {540, 5}, {480, 4},
  };

  // Midpoints between adjacent rungs; 340 is the floor below which there is
  // no watchable resolution to name.
  private static final int[] RESOLUTION_CUTS = {
    1620, 900, 648, 558, 510, 340,
  };

  private static String qualityChar(int quality) {
    if (quality <= 0) return "0";
    for (int[] row : RESOLUTION_DIGITS) {
      if (row[0] == quality) return String.valueOf(row[1]);
    }
    for (int i = 0; i < RESOLUTION_CUTS.length; i++) {
      if (quality >= RESOLUTION_CUTS[i]) return String.valueOf(RESOLUTION_DIGITS[i][1]);
    }
    return "0";
  }
}