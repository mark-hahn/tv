package com.hahnca.tvapp;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * The one place that talks to the servers. Everything this app reads comes over
 * public https from tv-srvr or tv-api, the same calls the web client and the
 * phone remote make.
 */
class Http {

  private static final int CONNECT_TIMEOUT_MS = 10000;
  private static final int READ_TIMEOUT_MS = 30000;
  private static final int READ_BUF_BYTES = 32768;

  static String get(String url) throws Exception {
    return read(open(url));
  }

  static String postJson(String url, String body) throws Exception {
    HttpURLConnection conn = open(url);
    conn.setRequestMethod("POST");
    conn.setRequestProperty("Content-Type", "application/json");
    conn.setDoOutput(true);
    try (OutputStream out = conn.getOutputStream()) {
      out.write(body.getBytes(StandardCharsets.UTF_8));
    }
    return read(conn);
  }

  private static HttpURLConnection open(String url) throws Exception {
    HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
    conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
    conn.setReadTimeout(READ_TIMEOUT_MS);
    return conn;
  }

  private static String read(HttpURLConnection conn) throws Exception {
    try {
      InputStream in = conn.getInputStream();
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      byte[] buf = new byte[READ_BUF_BYTES];
      int n;
      while ((n = in.read(buf)) > 0) {
        out.write(buf, 0, n);
      }
      return out.toString(StandardCharsets.UTF_8.name());
    } finally {
      conn.disconnect();
    }
  }
}
