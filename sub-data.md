# Subtitle timing data

What is stored for measuring subtitle timing, where it is, and how to measure from it without hearing any new audio. Gathered 10-23. The same text is the README of the analysis folder on hahnca.com.

## Where things are

All paths are on hahnca.com unless marked local.

| What | Where |
|---|---|
| Live subtitle database (tv-srvr is its only writer; open it read-only) | `/root/dev/apps/tv/apps/srvr/data/subs.db` |
| Frozen copy of it, 10-23 about 01:30 | `/root/dev/apps/tv/apps/srvr/data/sub-analysis/snapshots/subs-2026-10-23.db` |
| Copy as of 10-22 19:44, before the 10-23 backfill | restic mount `/mnt/bkupall-bkup/tags/sys/2026-10-22T19:44:48-07:00/root/dev/apps/tv/apps/srvr/data/subs.db` (copy it to a scratch folder with its `-wal` file before opening) |
| Subtitle files and videos | `/mnt/media/tv/<show>/<season>/`, each subtitle `<video name>.<suffix>.srt` |
| Media backup mirror | `/mnt/m-bkup/tv/` |
| Analysis folder: helper, scripts, test outputs, lists | `/root/dev/apps/tv/apps/srvr/data/sub-analysis/` |
| The 21 files deleted on 10-23 that existed before, with their earlier checks | `/root/dev/apps/tv/apps/srvr/data/sub-cover-deleted/` |
| The staged-checks code, rolled back and not deployed (local) | `/root/sub-cover-staged-checks/` |
| The plan, with changes marked, and the shift summary (local) | `sub-cover.md`, `sub-shift.md` in the workspace |

## The stored clips

Table `clips`: one row per checked video.

| Column | Meaning |
|---|---|
| `video` | the video's full path |
| `track` | the English audio track the clips were cut from; −1 means no English audio, so there are no clips (checked by audio matching) |
| `json` | the clips, below |
| `ts` | when stored, ms since 1970 |

The JSON is `{clips: [c0, c1], middle, cover}`. Each clip is `{fromS, words}`:
- `fromS` is where the clip starts in the video, in seconds. Every clip is 120 s long.
- `words` lists what ASR heard, as `[word, ms]`. `ms` counts from the clip's start, not the video's. Words are already lower case with punctuation gone.
- `c0` is the busiest 2 minutes of dialogue in the first third of the first subtitle file, and `c1` the same for the last third.
- `middle` is null or one clip in the middle third.
- `cover` is null or a list of clips, one in each part of about 3 minutes that had no clip.

On 10-23: 897 videos have clips, 349 of them a middle clip and 23 cover clips.

## The stored checks

Table `checks`: one row per subtitle file judged.

| Column | Meaning |
|---|---|
| `file`, `video` | full paths |
| `size`, `mtimeMs` | the file as it was judged; the check holds only while the file still has them |
| `verdict` | `good`, `fixable`, `wrong cut`, `can't tell`, `unusable`; `open` exists only from the 10-23 run |
| `offsetMs` | the file's offset when judged |
| `method` | `asr` (clips), `retime` (fitted to the ASR file), `audio`, `match` (10-23 run only) |
| `detail` | what was seen or done (patterns below) |
| `fix` | added 10-23: the strongest fix ever made, `shift`, `stretch` or `hand`. The code running now ignores it. |

`detail` patterns:
- `+52 ms (30) | -23 ms (28)`: each clip's offset with its number of paired lines.
- `shifted -1399 ms`, `stretched -199 ms to -1130 ms`: a fix the check made.
- `timed by hand`: a person applied an offset.
- `another cut: …`, `its timing scatters ±… ms at m:ss`, `cues run … s past the end`: why a file was rejected.

A rejected file is deleted, but its row stays as the record of why.

## How a measurement is made

**Line against heard words** (what the clip check does). A subtitle line starting within 60 s of a clip pairs with the heard words when two things hold:
- its first 5 words occur once among those nearby lines;
- they occur exactly once in the clip's words.

The line's offset is the heard word's start minus the line's start. It is positive when the line comes early. A clip's offset is the median of its lines' offsets.

**File against file.** Lines of 3 or more words pair by their first 5 words when those occur once in each file. The difference is the other file's line start minus this file's. An unaltered ASR file, or an embedded track checked good with no fix, fits its video and serves as the reference.

## The helper

`subpairs.py` in the analysis folder does both measurements:

```
cd /root/dev/apps/tv/apps/srvr/data/sub-analysis
python3 subpairs.py clip "<video>" 0                     # every file's lines against the first clip
python3 subpairs.py clip "<video>" middle --file mb2 --whole   # one file, words unique in the whole file
python3 subpairs.py compare "<video>"                     # every file against a reference file
python3 subpairs.py compare "<video>" --db snapshots/subs-2026-10-23.db
```

`clip` takes `0`, `1`, `middle` or `cover:N`. `compare` lists each file's stretches of 3 or more lines in a row that are more than 0.5 s off its usual difference.

## Saved test outputs (`tests/`)

| File | What it holds |
|---|---|
| `cover-test.out`, `cover-test2.out` | Dry cover-clip runs of 10-22 over 7 and 20 videos. Per file: verdict, then each clip's offset as `ms (lines, ±spread)`, in the order of the `clips at` list (two main clips, then cover clips by minute). |
| `opn-nofix.out` | The same for 20 videos with a download that had needed no fix (10-22) |
| `shift3-cover.out` | The same for the 29 videos of the 35 shifted files whose middle clip agreed (10-23) |
| `bad-stretch.json`, `verify-out.json`, `within-out.json` | The 10-22 analysis of 271 stretches at no standard rate |
| `orig.srt`, `t2.srt` | Becker S02E02's first download and its WEBDL embedded track |
| `local-copy/` | Analysis scripts from 10-22 |

The cover clips heard in these dry runs were not stored. Only the offsets printed in these outputs remain.

## Lists (`lists/`)

| File | What it holds |
|---|---|
| `session-deleted.tsv` | The 75 files deleted on 10-23: path, verdict, size, mtime, time of the check |
| `session-downloads.txt` | The downloads made during 10-23 (54 of the deleted files were these) |
| `fixlog.json`, `fixlog-files.json` | Every stretch and shift in the log since the checks began, per file |
| `opn-nofix-*.txt`, `onf-full.txt`, `cl2-full.txt` | Video lists of the dry runs |

`scripts/` holds the one-off scripts behind the numbers below. Each starts with what it measures or is short enough to read.

## Results so far

Line noise: a correctly matched line against its clip's median, in clips with 15 or more lines whose lines do not scatter.

| Measured from | Off by more than 0.25 s | 0.5 s | 1 s | 2 s |
|---|---|---|---|---|
| 1 line, words unique within 60 s | 21.9% | 7.9% | 2.6% | 1.7% |
| 1 line, words unique in the whole file | 21.5% | 7.5% | 2.1% | 1.2% |
| median of 3 lines in a row | 9.8% | 2.1% | 0.3% | |

Where the first clip starts:
- The median start is 3.1 minutes. 24% of first clips start in the first minute.
- In 117 files whose start is off for up to 6 minutes, the first clip lands inside the bad stretch for 40.
- A first clip starting at the first cue would land inside it for all 117.

Files compared with a reference file of the same video, 667 episodes, each counted by its worst file:

| Episodes | Worst file |
|---|---|
| 436 | no errors |
| 17 | errors only in the first and/or last 6 minutes |
| 37 | a bad stretch from the very start or to the very end, longer than 6 minutes |
| 177 | errors in the middle |

Another 521 episodes have no reference file, or nothing besides it.

The shifted-file test: 35 shifted files whose middle clip agreed got cover clips. 20 were good, 5 needed a stretch, and 10 were off somewhere no main or middle clip covered: 5 at the start, 3 at the end, 2 in several places.
