# Automatic 1080p Fallback Generation

This document describes the process for automatically generating 1080p HEVC fallback files from 2160p (4K) source media. This is done to provide a lower-bandwidth option for clients that don't require full 4K resolution, while maintaining high quality and direct-play compatibility.

## Logic

The core logic resides in the `tv-srvr` application and is triggered periodically for all shows marked as being in Emby. For a given episode, a 1080p fallback is generated if all of the following conditions are true:

1.  A 2160p video file for the episode exists.
2.  A 1080p video file (either active or a hidden `.alt` copy) does **not** already exist.
3.  The episode is **unwatched**.
4.  There is no 1080p version of the episode currently being downloaded by the `down` service.

### Acquisition Methods

When a fallback is needed, the system uses one of two methods:

1.  **Reuse `.old` file (Preferred)**: The system first checks for a pre-existing 1080p file with an `.old` extension (e.g., `Show.S01E01.1080p.mkv.old`). If found, it is simply renamed to have an `.alt` extension, making it available as a fallback. This is a fast file-system operation. Subtitles from the 2160p version are copied over to match the new 1080p file's base name.

2.  **Re-encode from 2160p**: If no `.old` file is available, the system queues a re-encoding task. The active 2160p file is used as the source to generate a new 1080p file.

## Code Locations

The implementation is primarily located in `apps/srvr/index.js`:

- `scanShowForResFallback`: Scans all seasons of a show to find 2160p episodes that might need a fallback.
- `res1080NeededAndAcquire`: Contains the main decision logic to determine if a fallback is needed and triggers the acquisition process (either by renaming an `.old` file or queueing a re-encode).
- `reencodeOneTo1080`: Manages the ffmpeg re-encoding process for a single file. This is where the ffmpeg commands are constructed and executed.
- `res1080CopySubtitles`: Handles the copying of subtitle files (`.srt`, `.vtt`, etc.) from the 2160p source to the newly created 1080p file.
- `scripts/run-res-fallback-all.js`: A utility script to manually trigger a scan for all shows in Emby.

## FFmpeg Settings and GPU Usage

The re-encoding process is designed to be efficient by offloading the most intensive work to the GPU. It's a two-step process to work around issues with Dolby Vision metadata.

### Step 1: Video Encoding (GPU)

The first step uses the AMD `hevc_vaapi` hardware encoder.

- **Command Snippet**:

  ```bash
  ffmpeg -y -vaapi_device /dev/dri/renderD128 -i <source_2160p.mkv> \
  -vf "scale=-2:1080,crop=iw:1072,format=p010,hwupload" \
  -c:v hevc_vaapi -profile:v main10 -rc_mode VBR -b:v 8M -maxrate 10M -bufsize 16M \
  -tag:v hvc1 <temp_video_only.mp4>
  ```

- **GPU Hardware**: The `-vaapi_device /dev/dri/renderD128` flag explicitly targets the AMD GPU for hardware acceleration.
- **Video Codec**: `-c:v hevc_vaapi` selects the HEVC (H.265) VAAPI encoder.
- **Bit Depth and HDR**: `-profile:v main10` and `format=p010` ensure that the 10-bit color depth of the source is preserved, which is crucial for HDR content.
- **Bitrate**: The video is encoded with a Variable Bitrate (VBR) targeting `8M` (8 Mbps) with a cap of `10M` (10 Mbps) to ensure good quality without excessive file size.
- **Scaling**: The `-vf "scale=-2:1080,crop=iw:1072..."` filter scales the video down to a 1080p height. The `-2` parameter ensures the width is automatically calculated to maintain the source aspect ratio, rounded to the nearest multiple of 2 (required for 4:2:0 chroma subsampling). The decode and scale operations are intentionally kept on the CPU to avoid GPU memory leaks that were observed with `scale_vaapi` on long files.

### Step 2: Remuxing (CPU)

The second step combines the newly encoded 1080p video with the audio and subtitle tracks from the original 2160p file. This is a lightweight "copy" operation that does not require re-encoding.

- **Command Snippet**:
  ```bash
  ffmpeg -y -i <temp_video_only.mp4> -i <source_2160p.mkv> \
  -map 0:v:0 -map 1 -map -1:v -c copy <final_1080p.mkv.alt>
  ```
- This command takes the video from the first input (`-map 0:v:0`) and all tracks _except_ video from the second input (`-map 1 -map -1:v`) and muxes them together into the final MKV file.

## Edge Artifacts from Resolution Mismatch

### Right-Edge Stretching Issue (Fixed)

**Problem**: When encoding sources with non-standard aspect ratios (e.g., 1.85:1 cinema format at 3840x2076 instead of 16:9 at 3840x2160), using `scale=-16:1080` caused visible artifacts on the right edge of the frame.

**Root Cause**: The `-16` parameter forces ffmpeg to round the calculated width to the nearest multiple of 16. For a 3840x2076 source:

- Correct width at 1080 height: 1080 × (3840/2076) = **1997.69 pixels**
- Rounded to multiple of 16: **2000 pixels** (rounding up)
- Extra pixels needed: ~2-3 pixels

When the scaler needs to fill these extra pixels, it repeats the last column of pixels from the source, creating a visible vertical band where the right edge appears stretched.

**Solution**: Changed to `scale=-2:1080`, which:

- Rounds width to the nearest multiple of 2 (sufficient for 4:2:0 chroma subsampling)
- Produces **1998 pixels** width (much closer to the mathematically correct 1997.69)
- Eliminates or drastically reduces the edge-repetition artifact
- Still maintains encoder compatibility (even dimensions required for H.265)

### Vertical Crop to 1072

The `crop=iw:1072` filter trims the video height to 1072 pixels after scaling. This handles source files that are slightly taller than expected after scaling (due to non-standard source dimensions or black bars encoded into the frame), ensuring consistent output dimensions without visible artifacts at the top or bottom edges.
