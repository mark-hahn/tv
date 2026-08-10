// Media serving routes: /api/stream (ffmpeg remux/transcode to fragmented MP4,
// with nginx redirect fast-path for already-compatible mp4s), audio/subtitle
// track listing, per-episode subtitle discovery, episode ffprobe stats, and
// subtitle serving (embedded stream → WebVTT, or sidecar .srt → VTT).

import fs from "fs";
import * as crypto from "node:crypto";
import * as cp from "child_process";
import * as path from "node:path";
import { parse as parseTorrentTitle } from "parse-torrent-title";
import { unilog, logHere } from "@tv/share";
import { resStripAlt } from "../videoFiles.js";
import { mpfourValid } from "../mpfour.js";
import { SRVR_DATA_DIR, ensureDir } from "../srvrPaths.js";

const tvDir = "/mnt/media/tv";

// Extracting an embedded subtitle stream demuxes the whole video file — ten
// minutes for a 2160p mkv — and the result never changes for a given file, so
// each (file, stream) is extracted once and replayed from here after that. Kept
// out of the media tree so nothing in the disk scan or Emby sees it.
const VTT_CACHE_DIR = path.join(SRVR_DATA_DIR, "vtt-cache");

function runFfprobe(args, maxBuffer = 2 * 1024 * 1024) {
  return cp.execFileSync("ffprobe", args, {
    maxBuffer,
    encoding: "utf8",
  });
}

// Cache key covers file identity (path + size + mtime), so a replaced or
// re-encoded file can never serve a stale vtt.
function vttCachePath(resolved, idx) {
  const st = fs.statSync(resolved);
  const key = `${resolved}|${idx}|${st.size}|${st.mtimeMs}`;
  const hash = crypto.createHash("sha1").update(key).digest("hex");
  return path.join(VTT_CACHE_DIR, `${hash}.vtt`);
}

// Serve one embedded subtitle stream as WebVTT. Owns the ffmpeg lifetime and
// the cache write for both /api/subtitle paths that need it.
function serveEmbeddedVtt(req, res, resolved, idx) {
  res.setHeader("Content-Type", "text/vtt");
  res.setHeader("Cache-Control", "no-cache");

  const cachePath = vttCachePath(resolved, idx);
  if (fs.existsSync(cachePath)) {
    res.send(fs.readFileSync(cachePath, "utf8"));
    return;
  }

  ensureDir(VTT_CACHE_DIR);
  const tmpPath = `${cachePath}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  const cacheOut = fs.createWriteStream(tmpPath);

  const ff = cp.spawn("ffmpeg", [
    "-i",
    resolved,
    "-map",
    `0:${idx}`,
    "-f",
    "webvtt",
    "pipe:1",
  ]);
  ff.stdout.pipe(res);
  ff.stdout.pipe(cacheOut);
  ff.stderr.on("data", () => {});

  const killFf = () => {
    if (!ff.killed) ff.kill("SIGKILL");
  };
  // Every way the client can go away. req close alone is not enough: when the
  // response is proxy-buffered nobody closes the request, and a dead output
  // pipe only surfaces as a stdout error — either way the extraction would
  // keep demuxing a multi-GB file for nobody.
  req.on("close", killFf);
  res.on("close", killFf);
  ff.stdout.on("error", (e) => {
    unilog(2004, `subtitle stdout error: ${e.message}`);
    killFf();
  });
  ff.on("error", (e) => {
    unilog(2005, `subtitle ffmpeg spawn failed: ${e.message}`);
  });
  ff.on("exit", (code) => {
    // Only a clean full extraction is worth keeping — a killed or failed run
    // leaves a truncated vtt that would then be served forever.
    cacheOut.end(() => {
      try {
        if (code === 0) fs.renameSync(tmpPath, cachePath);
        else fs.unlinkSync(tmpPath);
      } catch (e) {
        unilog(2006, `vtt cache write failed: ${e.message}`);
      }
    });
    if (!res.writableEnded) res.end();
  });
}

function shiftVttTimestamp(ts, offsetSec) {
  const [hms, msStr] = ts.split(".");
  const [h, m, s] = hms.split(":").map(Number);
  let totalMs = (h * 3600 + m * 60 + s) * 1000 + parseInt(msStr || "0", 10);
  totalMs += Math.round(offsetSec * 1000);
  if (totalMs < 0) totalMs = 0;
  const oh = Math.floor(totalMs / 3600000);
  const om = Math.floor((totalMs % 3600000) / 60000);
  const os = Math.floor((totalMs % 60000) / 1000);
  const oms = totalMs % 1000;
  return `${String(oh).padStart(2, "0")}:${String(om).padStart(2, "0")}:${String(os).padStart(2, "0")}.${String(oms).padStart(3, "0")}`;
}

export function registerMediaRoutes(app) {
  app.get("/api/stream", async (req, res) => {
    const filePath = req.query.path;
    if (!filePath) {
      res.status(400).json({ error: "path required" });
      return;
    }

    // Security: path must be within tvDir or moviesDir
    const resolved = path.resolve(filePath);
    const moviesDir = "/mnt/media/movies";
    if (
      !resolved.startsWith(tvDir + "/") &&
      resolved !== tvDir &&
      !resolved.startsWith(moviesDir + "/") &&
      resolved !== moviesDir
    ) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    if (!fs.existsSync(resolved)) {
      res.status(404).json({ error: "file not found" });
      return;
    }

    // mpfour fast path: a pre-encoded seekable mirror exists — redirect to
    // nginx for Range-request seeking. Only for the plain stream (PGS burn-in,
    // alternate audio, and mid-stream MSE recovery still need ffmpeg on the
    // original).
    if (
      req.query.sub === undefined &&
      req.query.audio === undefined &&
      !(parseInt(req.query.start) > 0)
    ) {
      const mirror = await mpfourValid(resolved);
      if (mirror) {
        const url =
          "https://hahnca.com" +
          mirror
            .replace("/mnt/media", "")
            .split("/")
            .map((seg) => encodeURIComponent(seg))
            .join("/");
        unilog(1411, `redirect to mpfour: ${url}`);
        res.redirect(302, url);
        return;
      }
    }

    try {
      const probeResult = cp.spawnSync(
        "ffprobe",
        [
          "-v",
          "quiet",
          "-analyzeduration",
          "100000",
          "-probesize",
          "100000",
          "-print_format",
          "json",
          "-show_streams",
          resolved,
        ],
        { maxBuffer: 2 * 1024 * 1024 },
      );
      if (probeResult.status !== 0)
        throw new Error(probeResult.stderr?.toString() || "ffprobe failed");
      const probeOut = probeResult.stdout.toString();
      const streams = JSON.parse(probeOut).streams || [];
      const audioStreams = streams.filter((s) => s.codec_type === "audio");
      const defaultAudioStream = audioStreams[0] || null;
      const rawAudio = req.query.audio;
      const requestedAudioIndex =
        rawAudio !== undefined ? parseInt(rawAudio, 10) : null;
      if (rawAudio !== undefined && Number.isNaN(requestedAudioIndex)) {
        res.status(400).json({ error: "invalid audio stream index" });
        return;
      }
      const selectedAudioStream =
        requestedAudioIndex == null
          ? defaultAudioStream
          : audioStreams.find((s) => s.index === requestedAudioIndex) || null;
      if (rawAudio !== undefined && !selectedAudioStream) {
        res.status(400).json({ error: "audio stream not found" });
        return;
      }
      const videoCodec = streams.find(
        (s) => s.codec_type === "video",
      )?.codec_name;
      const audioCodec = selectedAudioStream?.codec_name;
      const selectedAudioIndex = selectedAudioStream?.index ?? null;
      const audioMap =
        selectedAudioIndex != null ? `0:${selectedAudioIndex}` : null;
      const selectedAltAudio =
        selectedAudioIndex != null &&
        defaultAudioStream?.index != null &&
        selectedAudioIndex !== defaultAudioStream.index;

      const vCopy = videoCodec === "h264";
      const aCopy = audioCodec === "aac";

      if (
        vCopy &&
        aCopy &&
        resolved.toLowerCase().endsWith(".mp4") &&
        !selectedAltAudio
      ) {
        const relPath = resolved.replace("/mnt/media", "");
        const url =
          "https://hahnca.com" +
          relPath
            .split("/")
            .map((seg) => encodeURIComponent(seg))
            .join("/");
        unilog(45, `redirect to nginx: ${url}`);
        res.redirect(302, url);
        return;
      }

      const startSec = parseInt(req.query.start) || 0;
      const rawSub = req.query.sub;
      const subIdx = rawSub !== undefined ? parseInt(rawSub, 10) : null;
      const usePgsSub =
        subIdx !== null && !isNaN(subIdx) && subIdx >= 0 && subIdx <= 50;

      const ffmpegArgs =
        startSec > 0
          ? ["-ss", String(startSec), "-i", resolved]
          : ["-i", resolved];

      if (usePgsSub) {
        // Burn PGS bitmap subtitle into video stream via filter_complex overlay
        ffmpegArgs.push(
          "-filter_complex",
          `[0:v][0:${subIdx}]overlay[v]`,
          "-map",
          "[v]",
        );
        if (audioMap) {
          ffmpegArgs.push("-map", audioMap);
        }
        ffmpegArgs.push(
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-tune",
          "zerolatency",
          "-pix_fmt",
          "yuv420p",
          "-crf",
          "23",
          "-g",
          "48",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-ac",
          "2",
        );
      } else if (vCopy) {
        // h264 video in non-MP4 container: copy the stream, ffmpeg will remux into fMP4.
        // No re-encode needed; the source GOP doesn't matter because frag_keyframe
        // will still fragment at existing keyframe boundaries (typically every 2-5s for web sources).
        ffmpegArgs.push("-map", "0:v:0");
        if (audioMap) ffmpegArgs.push("-map", audioMap);
        ffmpegArgs.push("-c:v", "copy");
        if (aCopy) {
          ffmpegArgs.push("-c:a", "copy");
        } else {
          // -ac 2: downmix 5.1/multichannel to stereo — browsers require stereo AAC
          ffmpegArgs.push("-c:a", "aac", "-b:a", "128k", "-ac", "2");
        }
      } else {
        ffmpegArgs.push(
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-tune",
          "zerolatency",
          "-pix_fmt",
          "yuv420p",
          "-crf",
          "23",
          "-g",
          "48",
        );
        ffmpegArgs.push("-map", "0:v:0");
        if (audioMap) ffmpegArgs.push("-map", audioMap);
        if (aCopy) {
          ffmpegArgs.push("-c:a", "copy");
        } else {
          // -ac 2: downmix 5.1/multichannel to stereo — browsers require stereo AAC
          ffmpegArgs.push("-c:a", "aac", "-b:a", "128k", "-ac", "2");
        }
      }
      ffmpegArgs.push(
        "-f",
        "mp4",
        "-movflags",
        "frag_keyframe+empty_moov+default_base_moof",
        "pipe:1",
      );

      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Cache-Control", "no-cache");

      const ffmpeg = cp.spawn("ffmpeg", ffmpegArgs);
      ffmpeg.stdout.pipe(res);
      ffmpeg.stderr.on("data", () => {});
      ffmpeg.on("error", (err) => {
        unilog(589, "ffmpeg spawn error:", err.message);
      });
      const killFfmpeg = () => {
        if (ffmpeg.killed) return;
        ffmpeg.kill("SIGKILL");
      };
      ffmpeg.stdout.on("error", (err) => {
        unilog(1439, `ffmpeg stdout error: ${err.message}`);
        killFfmpeg();
      });
      req.on("close", killFfmpeg);
      res.on("close", killFfmpeg);
      ffmpeg.on("exit", (code) => {
        if (code !== 0 && code !== null) unilog(46, `ffmpeg exit code ${code}`);
        if (!res.writableEnded) res.end();
      });
    } catch (err) {
      unilog(590, "error:", err.message);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/audio-list", async (req, res) => {
    const filePath = req.query.path;
    if (!filePath) {
      res.status(400).json({ error: "path required" });
      return;
    }
    const resolved = path.resolve(filePath);
    const moviesDir2 = "/mnt/media/movies";
    if (
      !resolved.startsWith(tvDir + "/") &&
      resolved !== tvDir &&
      !resolved.startsWith(moviesDir2 + "/") &&
      resolved !== moviesDir2
    ) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    if (!fs.existsSync(resolved)) {
      res.status(404).json({ error: "file not found" });
      return;
    }
    try {
      const probeOut = runFfprobe([
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_streams",
        resolved,
      ]);
      const streams = JSON.parse(probeOut).streams || [];
      const tracks = streams
        .filter((s) => s.codec_type === "audio")
        .map((s, idx) => {
          const parts = [];
          const title = String(s.tags?.title || "").trim();
          const lang = String(s.tags?.language || "").trim();
          const codec = String(s.codec_name || "").trim();
          const channels = Number.isFinite(s.channels) ? `${s.channels}ch` : "";
          if (title) parts.push(title);
          else if (lang) parts.push(lang);
          else parts.push(`Track ${idx + 1}`);
          if (codec) parts.push(codec);
          if (channels) parts.push(channels);
          return {
            index: s.index,
            label: parts.join(" | "),
            isDefault: s.disposition?.default === 1,
          };
        });
      res.json(tracks);
    } catch (e) {
      unilog(591, "probe error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/subtitle-list", async (req, res) => {
    const filePath = req.query.path;
    if (!filePath) {
      res.status(400).json({ error: "path required" });
      return;
    }
    const resolved = path.resolve(filePath);
    const moviesDir2 = "/mnt/media/movies";
    if (
      !resolved.startsWith(tvDir + "/") &&
      resolved !== tvDir &&
      !resolved.startsWith(moviesDir2 + "/") &&
      resolved !== moviesDir2
    ) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    if (!fs.existsSync(resolved)) {
      res.status(404).json({ error: "file not found" });
      return;
    }
    const dir = path.dirname(resolved);
    const stem = resStripAlt(path.basename(resolved)).replace(/\.[^.]+$/, "");
    const tracks = [];
    try {
      const probeOut = runFfprobe([
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_streams",
        resolved,
      ]);
      const streams = JSON.parse(probeOut).streams || [];
      for (const s of streams.filter((s) => s.codec_type === "subtitle")) {
        const lang = (s.tags?.language || "").toLowerCase();
        if (lang && lang !== "eng" && lang !== "en") continue;
        const label = s.tags?.title || s.tags?.language || "eng";
        const isPgs =
          s.codec_name === "hdmv_pgs_subtitle" ||
          s.codec_name === "dvb_subtitle";
        if (isPgs && s.disposition?.forced === 1) continue;
        const isForced = !isPgs && s.disposition?.forced === 1;
        const isSdh =
          !isPgs &&
          !isForced &&
          (s.disposition?.hearing_impaired === 1 ||
            /\bsdh\b/i.test(s.tags?.title || ""));
        tracks.push({
          id: `emb-${s.index}`,
          label,
          type: isPgs
            ? "pgs"
            : isForced
              ? "forced"
              : isSdh
                ? "sdh"
                : "embedded",
          index: s.index,
        });
      }
    } catch (e) {
      unilog(592, "probe error:", e.message);
    }
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(".srt") || !f.startsWith(stem)) continue;
        const suffix = f
          .slice(stem.length)
          .replace(/\.srt$/, "")
          .replace(/^\./, "");
        tracks.push({
          id: `srt-${f}`,
          label: suffix || f,
          type: "srt",
          file: f,
        });
      }
    } catch (e) {
      // ignore readdir errors
    }
    // TEMP: log button details for chksrt debugging
    try {
      const charFor = (t) => {
        if (t.type === "pgs") return "*";
        if (t.type === "sdh") return "H";
        if (t.type === "embedded") return "T";
        if (t.type === "forced") return "F";
        if (/\.asr\.srt$/.test(t.file || "")) return "+";
        if (/\.mb\d+\.srt$/.test(t.file || "")) return ">";
        if (/\.opn[A-Z2-7]{5}\.srt$/i.test(t.file || "")) return "V";
        return "S";
      };
      const lines = [`## ${path.basename(resolved)}\n`];
      tracks.forEach((t, i) => {
        const newLabel = `${charFor(t)} ${i + 1}`;
        const filePart = t.file
          ? t.file.slice(stem.length + 1)
          : `(embedded index ${t.index})`;
        lines.push(
          `- old: \`${t.label}\`  new: \`${newLabel}\`  file: \`${filePart}\``,
        );
        if (/\.opn[A-Z2-7]{5}\.srt$/i.test(t.file || "")) {
          lines.push(`  head "${path.join(dir, t.file)}"`);
          const opnTag = (t.file.match(/\.opn([A-Z2-7]{5})\.srt$/i) || [])[1];
          if (opnTag) {
            // TEMP: decode base32 tag to decimal file_id
            const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
            let fid = 0;
            for (const ch of opnTag.toUpperCase())
              fid = fid * 32 + alpha.indexOf(ch);
            lines.push(
              `  id: ${fid}  https://www.opensubtitles.com/en/subtitles/${fid}`,
            );
          }
        }
      });
      fs.appendFileSync("/root/dev/apps/tv/temp.md", lines.join("\n") + "\n\n");
    } catch (_) {}
    res.json(tracks);
  });

  app.get("/api/episodeSubs", async (req, res) => {
    const showName = (req.query.show || "").trim();
    const season = parseInt(req.query.s, 10);
    const episode = parseInt(req.query.e, 10);
    if (!showName || isNaN(season) || isNaN(episode)) {
      res.status(400).json({ error: "show, s, e required" });
      return;
    }
    if (showName.includes("/") || showName.includes("\\")) {
      res.status(400).json({ error: "invalid show name" });
      return;
    }
    const seasonDir = path.join(tvDir, showName, `Season ${season}`);
    let entries;
    try {
      entries = fs.readdirSync(seasonDir);
    } catch {
      res.json([]);
      return;
    }
    const seKey = `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
    const videoExt = /\.(mkv|mp4|avi|m4v|ts)$/i;
    const videoFile = entries.find(
      (f) => videoExt.test(f) && f.toUpperCase().includes(seKey),
    );
    if (!videoFile) {
      res.json([]);
      return;
    }
    const resolved = path.join(seasonDir, videoFile);
    const stem = videoFile.replace(/\.[^.]+$/, "");
    const tracks = [];
    try {
      const probeOut = runFfprobe([
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_streams",
        resolved,
      ]);
      const streams = JSON.parse(probeOut).streams || [];
      for (const s of streams.filter((s) => s.codec_type === "subtitle")) {
        const lang = (s.tags?.language || "").toLowerCase();
        if (lang && lang !== "eng" && lang !== "en") continue;
        const label = s.tags?.title || s.tags?.language || "eng";
        const isPgs =
          s.codec_name === "hdmv_pgs_subtitle" ||
          s.codec_name === "dvb_subtitle";
        if (isPgs && s.disposition?.forced === 1) continue;
        const isForced = !isPgs && s.disposition?.forced === 1;
        const isSdh =
          !isPgs &&
          !isForced &&
          (s.disposition?.hearing_impaired === 1 ||
            /\bsdh\b/i.test(s.tags?.title || ""));
        tracks.push({
          id: `emb-${s.index}`,
          label,
          type: isPgs
            ? "pgs"
            : isForced
              ? "forced"
              : isSdh
                ? "sdh"
                : "embedded",
          index: s.index,
        });
      }
    } catch (e) {
      unilog(593, "probe error:", e.message);
    }
    try {
      for (const f of entries) {
        if (!f.endsWith(".srt") || !f.startsWith(stem)) continue;
        const suffix = f
          .slice(stem.length)
          .replace(/\.srt$/, "")
          .replace(/^\./, "");
        tracks.push({
          id: `srt-${f}`,
          label: suffix || f,
          type: "srt",
          file: f,
        });
      }
    } catch (e) {
      // ignore
    }
    res.json(tracks);
  });

  app.get("/api/episodeStats", async (req, res) => {
    const showName = (req.query.show || "").trim();
    const season = parseInt(req.query.s, 10);
    const episode = parseInt(req.query.e, 10);
    if (!showName || isNaN(season) || isNaN(episode)) {
      res.status(400).json({ error: "show, s, e required" });
      return;
    }
    if (showName.includes("/") || showName.includes("\\")) {
      res.status(400).json({ error: "invalid show name" });
      return;
    }
    const seasonDir = path.join(tvDir, showName, `Season ${season}`);
    let entries;
    try {
      entries = fs.readdirSync(seasonDir);
    } catch {
      res.status(404).json({ error: "season not found" });
      return;
    }
    const seKey = `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
    const videoExt = /\.(mkv|mp4|avi|m4v|ts)$/i;
    const videoFile = entries.find(
      (f) => videoExt.test(f) && f.toUpperCase().includes(seKey),
    );
    if (!videoFile) {
      res.status(404).json({ error: "file not found" });
      return;
    }
    const resolved = path.join(seasonDir, videoFile);

    // ffprobe
    let fileSize = null;
    let durationMins = null;
    let videoWidth = null;
    let videoHeight = null;
    let videoBitRate = null;
    let videoBitDepth = null;
    let videoFrameRate = null;
    let hdr = null;
    let audioChannels = null;
    try {
      const probeOut = runFfprobe(
        [
          "-v",
          "quiet",
          "-print_format",
          "json",
          "-show_streams",
          "-show_format",
          resolved,
        ],
        4 * 1024 * 1024,
      );
      const probe = JSON.parse(probeOut);
      const fmt = probe.format || {};
      fileSize = fmt.size ? parseInt(fmt.size, 10) : null;
      durationMins = fmt.duration
        ? Math.round((parseFloat(fmt.duration) / 60) * 10) / 10
        : null;
      const fmtBitRate = fmt.bit_rate ? parseInt(fmt.bit_rate, 10) : null;
      const streams = probe.streams || [];
      const vStream = streams.find((s) => s.codec_type === "video");
      if (vStream) {
        videoWidth = vStream.width || null;
        videoHeight = vStream.height || null;
        videoBitRate = vStream.bit_rate
          ? parseInt(vStream.bit_rate, 10)
          : fmtBitRate;
        const pf = vStream.pix_fmt || "";
        if (/12/.test(pf)) videoBitDepth = 12;
        else if (/10/.test(pf)) videoBitDepth = 10;
        else videoBitDepth = 8;
        const ct = vStream.color_transfer || "";
        const cp2 = vStream.color_primaries || "";
        if (ct === "smpte2084") hdr = "HDR10";
        else if (ct === "arib-std-b67") hdr = "HLG";
        else if (cp2 === "bt2020") hdr = "HDR";
        else hdr = null;
        const fpsStr = vStream.r_frame_rate || vStream.avg_frame_rate || "";
        if (fpsStr && fpsStr.includes("/")) {
          const [num, den] = fpsStr.split("/").map(Number);
          if (den > 0) videoFrameRate = Math.round((num / den) * 1000) / 1000;
        }
      }
      const aStream = streams.find((s) => s.codec_type === "audio");
      if (aStream) {
        audioChannels = aStream.channels || null;
      }
    } catch (e) {
      unilog(594, "probe error:", e.message);
    }

    // parse-torrent-title
    const ptt =
      parseTorrentTitle(videoFile.replace(/\.[a-z0-9]{2,4}$/i, "")) || {};

    res.json({
      fileName: videoFile,
      fileSize,
      durationMins,
      videoWidth,
      videoHeight,
      videoBitRate,
      videoBitDepth,
      videoFrameRate,
      hdr,
      audioChannels,
      ptt,
    });
  });

  app.get("/api/subtitle", async (req, res) => {
    const filePath = req.query.path;
    if (!filePath) {
      res.status(400).json({ error: "path required" });
      return;
    }
    const resolved = path.resolve(filePath);
    const moviesDir3 = "/mnt/media/movies";
    if (
      !resolved.startsWith(tvDir + "/") &&
      resolved !== tvDir &&
      !resolved.startsWith(moviesDir3 + "/") &&
      resolved !== moviesDir3
    ) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    if (!fs.existsSync(resolved)) {
      res.status(404).json({ error: "file not found" });
      return;
    }
    const dir = path.dirname(resolved);
    const stem = resStripAlt(path.basename(resolved)).replace(/\.[^.]+$/, "");

    // Explicit embedded stream by index
    if (req.query.index !== undefined) {
      const idx = parseInt(req.query.index, 10);
      serveEmbeddedVtt(req, res, resolved, idx);
      return;
    }

    // Explicit sidecar .srt by filename
    if (req.query.file) {
      const srtFile = path.basename(req.query.file);
      if (!srtFile.endsWith(".srt")) {
        res.status(400).json({ error: "invalid file" });
        return;
      }
      try {
        const offsetSec = parseFloat(req.query.offset || "0");
        const clampedOffset = isNaN(offsetSec)
          ? 0
          : Math.max(-10, Math.min(10, offsetSec));
        const srt = fs.readFileSync(path.join(dir, srtFile), "utf8");
        let vtt =
          "WEBVTT\n\n" + srt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
        if (clampedOffset !== 0) {
          vtt = vtt.replace(
            /(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})/g,
            (_, t1, t2) =>
              `${shiftVttTimestamp(t1, clampedOffset)} --> ${shiftVttTimestamp(t2, clampedOffset)}`,
          );
        }
        res.setHeader("Content-Type", "text/vtt");
        res.setHeader("Cache-Control", "no-cache");
        res.send(vtt);
      } catch (e) {
        unilog(595, "sidecar error:", e.message);
        if (!res.headersSent) res.status(500).json({ error: e.message });
      }
      return;
    }

    // 1. Try embedded subtitle stream first (e.g. subrip inside MKV)
    try {
      const probeOut = runFfprobe([
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_streams",
        resolved,
      ]);
      const streams = JSON.parse(probeOut).streams || [];
      const subStream = streams.find((s) => s.codec_type === "subtitle");
      if (subStream) {
        serveEmbeddedVtt(req, res, resolved, subStream.index);
        return;
      }
    } catch (e) {
      unilog(596, "embedded probe error:", e.message);
    }

    // 2. Fall back to sidecar .srt matching stem (xxx.mkv matches xxx.yyy.srt)
    let srtPath = null;
    try {
      const files = fs.readdirSync(dir);
      const match = files.find((f) => f.endsWith(".srt") && f.startsWith(stem));
      if (match) srtPath = path.join(dir, match);
    } catch (e) {
      // ignore readdir errors
    }
    if (!srtPath) {
      res.status(404).json({ error: "no subtitle found" });
      return;
    }
    try {
      const srt = fs.readFileSync(srtPath, "utf8");
      const vtt =
        "WEBVTT\n\n" + srt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
      res.setHeader("Content-Type", "text/vtt");
      res.setHeader("Cache-Control", "no-cache");
      res.send(vtt);
    } catch (e) {
      unilog(597, "sidecar error:", e.message);
      if (!res.headersSent) res.status(500).json({ error: e.message });
    }
  });
}
