// Media serving routes: /api/stream (ffmpeg remux/transcode to fragmented MP4,
// with nginx redirect fast-path for already-compatible mp4s), audio/subtitle
// track listing, episode ffprobe stats, and subtitle serving (sidecar .srt →
// VTT; embedded subtitle tracks are never served).

import fs from "fs";
import * as cp from "child_process";
import * as path from "node:path";
import { parse as parseTorrentTitle } from "parse-torrent-title";
import { unilog, logHere } from "@tv/share";
import { listSidecars } from "../subs.js";
import { showFolderFor } from "../showPaths.js";
import { HDR_TRANSFERS, TONEMAP } from "../stills.js";

const tvDir = "/mnt/media/tv";

function runFfprobe(args, maxBuffer = 2 * 1024 * 1024) {
  return cp.execFileSync("ffprobe", args, {
    maxBuffer,
    encoding: "utf8",
  });
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
      // An HDR source re-encoded to 8-bit keeps its bt2020/PQ tags and plays
      // all cyan and white, so the transcodes tone-map it to SDR bt709.
      const hdr = HDR_TRANSFERS.has(
        streams.find((s) => s.codec_type === "video")?.color_transfer,
      );
      const audioCodec = selectedAudioStream?.codec_name;
      const selectedAudioIndex = selectedAudioStream?.index ?? null;
      const audioMap =
        selectedAudioIndex != null ? `0:${selectedAudioIndex}` : null;
      const selectedAltAudio =
        selectedAudioIndex != null &&
        defaultAudioStream?.index != null &&
        selectedAudioIndex !== defaultAudioStream.index;

      const vCopy = videoCodec === "h264" && !hdr;
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

      // copyts: the stream keeps the file's own timestamps, for the browser
      // player's MediaSource (srvr/src/play.html), which puts each stream it
      // opens at its place in the whole episode. The mp4 muxer otherwise
      // starts every stream at 0; frag_discont and avoid_negative_ts stop it.
      const copyts = !!req.query.copyts;
      const ffmpegArgs = [
        ...(copyts ? ["-copyts"] : []),
        ...(startSec > 0 ? ["-ss", String(startSec)] : []),
        "-i",
        resolved,
      ];

      if (usePgsSub) {
        // Burn PGS bitmap subtitle into video stream via filter_complex overlay
        ffmpegArgs.push(
          "-filter_complex",
          `${hdr ? `[0:v]${TONEMAP}[t];[t]` : "[0:v]"}[0:${subIdx}]overlay[v]`,
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
        if (hdr) ffmpegArgs.push("-vf", TONEMAP);
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
        `frag_keyframe+empty_moov+default_base_moof${copyts ? "+frag_discont" : ""}`,
        ...(copyts ? ["-avoid_negative_ts", "disabled"] : []),
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
      // close, not exit: exit can come while stdout still holds data, and
      // the pipe writing it after this end() crashed tv-srvr.
      ffmpeg.on("close", (code) => {
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

  // The video's subtitles: its sidecar .srt files. Embedded tracks are never
  // listed; the sub queue copies the text ones out to sidecars.
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
    res.json(
      listSidecars(resolved).map((s) => ({
        id: `srt-${s.file}`,
        label: s.label,
        type: "srt",
        file: s.file,
      })),
    );
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
    const seasonDir = path.join(
      tvDir,
      showFolderFor(showName),
      `Season ${season}`,
    );
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

    // A sidecar .srt by filename
    const srtFile = path.basename(req.query.file || "");
    if (!srtFile.endsWith(".srt")) {
      res.status(400).json({ error: "invalid file" });
      return;
    }
    try {
      const srt = fs.readFileSync(path.join(dir, srtFile), "utf8");
      const vtt =
        "WEBVTT\n\n" + srt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
      res.setHeader("Content-Type", "text/vtt");
      res.setHeader("Cache-Control", "no-cache");
      res.send(vtt);
    } catch (e) {
      unilog(595, "sidecar error:", e.message);
      if (!res.headersSent) res.status(500).json({ error: e.message });
    }
  });
}
