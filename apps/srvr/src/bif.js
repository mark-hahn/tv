import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { createWriteStream } from "fs";
import { unilog } from "@tv/share";

/**
 * Create a BIF (Base Index Frames) file for video thumbnail previews
 * @param {string} videoPath - Path to the video file
 * @param {number} width - Width of thumbnails (height auto-calculated)
 * @param {number} interval - Interval in seconds between frames
 */
async function createBifFile(videoPath, width = 320, interval = 10) {
  // Generate output path from video path, width, and interval
  const parsed = path.parse(videoPath);
  const outputPath = path.join(
    parsed.dir,
    `${parsed.name}-${width}-${interval}.bif`,
  );

  const startTime = Date.now();
  unilog(92, `Creating BIF file: ${outputPath}`);
  unilog(93, `Video: ${videoPath}`);
  unilog(94, `Settings: ${width}px width, ${interval}s interval`);

  // Create temp directory for frames
  const tempDir = `/tmp/bif-temp-${Date.now()}`;
  await fs.mkdir(tempDir, { recursive: true });

  try {
    // Extract frames using ffmpeg
    unilog(95, "\nExtracting frames...");
    await extractFrames(videoPath, tempDir, width, interval);

    // Get all frame files
    const files = await fs.readdir(tempDir);
    const frameFiles = files
      .filter((f) => f.endsWith(".jpg"))
      .sort((a, b) => {
        const numA = parseInt(a.match(/frame-(\d+)\.jpg/)?.[1] || "0");
        const numB = parseInt(b.match(/frame-(\d+)\.jpg/)?.[1] || "0");
        return numA - numB;
      });

    unilog(96, `\nExtracted ${frameFiles.length} frames`);

    // Create BIF file
    unilog(97, "Creating BIF file...");
    await writeBifFile(tempDir, frameFiles, outputPath, interval);

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    const stats = await fs.stat(outputPath);
    unilog(98, `\n✓ BIF file created successfully`);
    unilog(99, `  Output: ${outputPath}`);
    unilog(100, `  Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    unilog(101, `  Frames: ${frameFiles.length}`);
    unilog(102, `  Time taken: ${duration} seconds`);

    return {
      outputPath,
      duration,
      frameCount: frameFiles.length,
      size: stats.size,
    };
  } finally {
    // Cleanup temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

const MAX_BIF_SECONDS = 15 * 60;

function extractFrames(videoPath, outputDir, width, interval) {
  return new Promise((resolve, reject) => {
    // `-skip_frame nokey` decodes only keyframes (I-frames) instead of the whole
    // stream — ~9x faster for 4K HEVC. Thumbnails land on the nearest keyframe
    // rather than the exact interval mark, which is imperceptible for scrub
    // previews. `-vsync vfr` keeps the real (sparse) keyframe timestamps.
    const args = [
      "-skip_frame",
      "nokey",
      "-i",
      videoPath,
      "-t",
      String(MAX_BIF_SECONDS),
      "-vf",
      `fps=1/${interval},scale=${width}:-1`,
      "-vsync",
      "vfr",
      "-q:v",
      "2", // JPEG quality (2 is high quality)
      path.join(outputDir, "frame-%05d.jpg"),
    ];

    const ffmpeg = spawn("ffmpeg", args);

    let stderr = "";
    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
      // Show progress
      const timeMatch = data.toString().match(/time=(\d{2}):(\d{2}):(\d{2})/);
      if (timeMatch) {
        process.stdout.write(`\rProgress: ${timeMatch[0]}          `);
      }
    });

    ffmpeg.on("close", (code) => {
      process.stdout.write("\n");
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}\n${stderr}`));
      }
    });

    ffmpeg.on("error", reject);
  });
}

async function writeBifFile(frameDir, frameFiles, outputPath, interval) {
  // BIF file format (Roku/Emby compatible):
  // - Magic number: 0x89, 'B', 'I', 'F', 0x0d, 0x0a, 0x1a, 0x0a (8 bytes)
  // - Version: 0 (4 bytes, little endian)
  // - Number of images N (4 bytes, little endian)
  // - Timestamp multiplier: interval * 1000 ms (4 bytes, little endian)
  // - Reserved: 44 bytes of 0x00
  // - Index entries: (N+1) * 8 bytes
  //   - N entries: [frame_index (4 bytes LE)][byte_offset (4 bytes LE)]
  //   - 1 sentinel: [0xFFFFFFFF (4 bytes)][total_file_size (4 bytes LE)]
  // - Image data: concatenated JPEG files

  const images = [];
  for (const file of frameFiles) {
    const data = await fs.readFile(path.join(frameDir, file));
    images.push(data);
  }

  const headerSize = 64; // Magic(8) + version(4) + count(4) + multiplier(4) + reserved(44)
  const indexSize = (images.length + 1) * 8; // N entries + 1 sentinel
  const dataStartOffset = headerSize + indexSize;

  const totalImageSize = images.reduce((sum, img) => sum + img.length, 0);
  const totalFileSize = dataStartOffset + totalImageSize;

  let currentOffset = dataStartOffset;
  const indexEntries = images.map((img, i) => {
    const offset = currentOffset;
    currentOffset += img.length;
    return { index: i, offset }; // index is 0-based
  });

  // Write BIF file
  const stream = createWriteStream(outputPath);

  return new Promise((resolve, reject) => {
    stream.on("error", reject);
    stream.on("finish", resolve);

    // Write header
    const header = Buffer.alloc(64);
    let pos = 0;

    // Magic number (8 bytes)
    header.writeUInt8(0x89, pos++);
    header.writeUInt8(0x42, pos++); // 'B'
    header.writeUInt8(0x49, pos++); // 'I'
    header.writeUInt8(0x46, pos++); // 'F'
    header.writeUInt8(0x0d, pos++);
    header.writeUInt8(0x0a, pos++);
    header.writeUInt8(0x1a, pos++);
    header.writeUInt8(0x0a, pos++);

    // Version (4 bytes)
    header.writeUInt32LE(0, pos);
    pos += 4;

    // Number of images (4 bytes)
    header.writeUInt32LE(images.length, pos);
    pos += 4;

    // Timestamp multiplier (4 bytes) - interval in milliseconds
    header.writeUInt32LE(interval * 1000, pos);
    pos += 4;

    // Reserved (44 bytes of zeros - already zeroed)

    stream.write(header);

    // Write index entries: [frame_index (4 bytes)][byte_offset (4 bytes)]
    for (const entry of indexEntries) {
      const indexEntry = Buffer.alloc(8);
      indexEntry.writeUInt32LE(entry.index, 0);
      indexEntry.writeUInt32LE(entry.offset, 4);
      stream.write(indexEntry);
    }

    // Write sentinel: 0xFFFFFFFF + total file size
    const sentinel = Buffer.alloc(8);
    sentinel.writeUInt32LE(0xffffffff, 0);
    sentinel.writeUInt32LE(totalFileSize, 4);
    stream.write(sentinel);

    // Write image data
    for (const img of images) {
      stream.write(img);
    }

    stream.end();
  });
}

export { createBifFile };
