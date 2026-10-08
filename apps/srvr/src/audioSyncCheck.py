# The check for syncSubToAudio in subSync.js: the offset that best fits the
# cues of the first and of the last third of an .srt to the speech ffsubsync
# heard in the whole video. A file from another cut fits its two ends at
# different offsets.
#
# argv: the speech .npz from ffsubsync --serialize-speech, the .srt, and the
# largest offset to look at in seconds. Prints {"startMs": n, "endMs": n};
# a positive offset means the cues belong later.
#
# Runs with ffsubsync's python (/opt/ffsubsync/bin/python), which has numpy.

import json
import re
import sys

import numpy as np

# ffsubsync's speech samples a second
RATE = 100
PARTS = 3

npz_path, srt_path, max_s = sys.argv[1], sys.argv[2], float(sys.argv[3])

# +1 where there is speech, -1 where there is none, as ffsubsync scores it
speech = 2 * np.load(npz_path)["speech"].astype(float) - 1

cues = []
with open(srt_path, encoding="utf-8-sig") as f:
    for m in re.finditer(
        r"(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)", f.read()
    ):
        g = [int(x) for x in m.groups()]
        start = ((g[0] * 60 + g[1]) * 60 + g[2]) * RATE + g[3] * RATE // 1000
        end = ((g[4] * 60 + g[5]) * 60 + g[6]) * RATE + g[7] * RATE // 1000
        cues.append((start, end))
if len(cues) < PARTS:
    sys.exit(f"only {len(cues)} cues")

max_n = int(max_s * RATE)
last = max(end for _, end in cues)
subs = -np.ones(last)
for start, end in cues:
    subs[start:end] = 1
# The speech with max_n before it and room after it to past the last cue, so a
# cue may look at any offset up to max_s. Outside the audio is 0: it neither
# matches nor misses, where silence there would match every gap in the cues.
ref = np.zeros(last + 2 * max_n)
n = min(len(speech), last + max_n)
ref[max_n : max_n + n] = speech[:n]


def best_ms(part):
    a, b = part[0][0], part[-1][1]
    # scores[k] is the fit with the cues moved by k - max_n samples
    scores = np.correlate(ref[a : b + 2 * max_n], subs[a:b], "valid")
    return round((int(np.argmax(scores)) - max_n) * 1000 / RATE)


part_len = -(-len(cues) // PARTS)
print(
    json.dumps(
        {"startMs": best_ms(cues[:part_len]), "endMs": best_ms(cues[-part_len:])}
    )
)
