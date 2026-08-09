#!/bin/bash
# kfchk.sh — will Emby's HLS copy path stall on this file?
#
# Emby splits an HLS playback start across two ffmpeg jobs: one with no -ss
# writing segment 0, and one with "-ss <segment N start> -noaccurate_seek"
# writing segments N onward. -noaccurate_seek snaps backward to the nearest
# keyframe. When the video stream is copied (-c:v copy), keyframe positions are
# whatever the source encoder chose; if a 6s segment window contains no
# keyframe, -ss snaps back past the previous segment's start and the file
# written as segment N repeats content the player already has. The buffer stops
# growing and playback freezes at that boundary.
#
# So the test is NOT "max keyframe gap > 6s" — a long gap that straddles a
# boundary is harmless. The test is whether any window (6(w-1), 6w] is empty.
#
# Reads packets (no decoding) and only the first $SECS of the file via
# -read_intervals, so cost is flat regardless of file size — ~0.2-0.4s per file
# even for a multi-GB 2160p source. Scanning past the range ffprobe can seek to
# cheaply is what costs; keep SECS to what you actually need.
#
# Run this on hahnca.com — it needs the media tree and emby's ffprobe.
#
#   scripts/kfchk.sh FILE...
#   SECS=900 scripts/kfchk.sh FILE...     # check the first 15 minutes
#   find /mnt/media/tv/Foo -name '*.mkv' -print0 | xargs -0 scripts/kfchk.sh
#
# Output: "ok"/"BAD", the worst keyframe gap seen, and for BAD files the first
# segment index whose window is empty. first bad segment=1 means it breaks when
# played from 0; a higher index means it plays from 0 but breaks on a seek into
# that region.

FFPROBE=/opt/emby-server/bin/ffprobe
export LD_LIBRARY_PATH=/opt/emby-server/lib
SEGMENT_SECS=6
SECS=${SECS:-60}

for f in "$@"; do
  "$FFPROBE" -v error -select_streams v:0 \
    -show_entries packet=pts_time,flags -of csv=p=0 \
    -read_intervals "%+$SECS" "$f" 2>/dev/null |
    awk -F, '/K/ {print $1}' |
    awk -v secs="$SECS" -v seg="$SEGMENT_SECS" -v name="$(basename "$f")" '
      {kfs[n++]=$1}
      END{
        bad=0; worst=0
        for(w=1; w*seg<=secs; w++){
          lo=(w-1)*seg; hi=w*seg; found=0
          for(i=0;i<n;i++) if(kfs[i]>lo && kfs[i]<=hi) found=1
          if(!found && !bad) bad=w
        }
        p=0; for(i=0;i<n;i++){g=kfs[i]-p; if(g>worst) worst=g; p=kfs[i]}
        printf "%s maxgap=%.1fs  %s%s\n", (bad?"BAD ":"ok  "), worst, \
               (bad?"first bad segment=" bad "  ":""), name
      }'
done
