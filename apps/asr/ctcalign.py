#!/usr/bin/env python3
"""Forced-align cue text to audio with a CTC acoustic model.

Gemini estimates its timestamps rather than measuring them, so they drift by
seconds. This reads the cue text it produced, aligns the words against the
audio, and writes back measured start/end times for each cue. asr.js then
guards the result before using it.

  ctcalign.py <cues.json> <audio.wav> <times.json>

cues.json  : ["cue text", ...]
audio.wav  : 16 kHz mono 16-bit PCM
times.json : [{"start", "end", "words": [{"w", "start", "end"}, ...]} | null,
             ...]  (one per cue; word spans let asr.js split long cues on
             real word boundaries)
"""
import json
import re
import sys
import wave

import numpy as np
import torch
import torchaudio

CHUNK_SEC = 60  # forward-pass chunk; emissions are concatenated afterwards

ONES = ("zero one two three four five six seven eight nine ten eleven twelve "
        "thirteen fourteen fifteen sixteen seventeen eighteen nineteen").split()
TENS = "  twenty thirty forty fifty sixty seventy eighty ninety".split()


def spell(n):
    """Digits are not in the model alphabet, so numbers become words."""
    n = int(n)
    if n < 20:
        return ONES[n]
    if n < 100:
        return TENS[n // 10 - 2] + ("" if n % 10 == 0 else " " + ONES[n % 10])
    if n < 1000:
        return ONES[n // 100] + " hundred" + ("" if n % 100 == 0 else " " + spell(n % 100))
    if n < 10000:
        return spell(n // 1000) + " thousand" + ("" if n % 1000 == 0 else " " + spell(n % 1000))
    return " ".join(ONES[int(d)] for d in str(n))


def read_wav(path):
    with wave.open(path, "rb") as w:
        rate = w.getframerate()
        channels = w.getnchannels()
        raw = w.readframes(w.getnframes())
    pcm = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    if channels > 1:
        pcm = pcm.reshape(-1, channels).mean(axis=1)
    return torch.from_numpy(pcm).unsqueeze(0), rate


def main():
    cues_path, wav_path, out_path = sys.argv[1:4]
    cues = json.load(open(cues_path, encoding="utf8"))

    bundle = torchaudio.pipelines.MMS_FA
    model = bundle.get_model()
    tokenizer = bundle.get_tokenizer()
    aligner = bundle.get_aligner()
    allowed = set(bundle.get_dict().keys())

    # one flat word list, remembering which cue each word came from
    words, owner = [], []
    for i, cue in enumerate(cues):
        text = re.sub(r"\d+", lambda m: " " + spell(m.group()) + " ", cue)
        for word in re.sub(r"[^a-zA-Z' ]", " ", text).lower().split():
            word = "".join(c for c in word if c in allowed)
            if word:
                words.append(word)
                owner.append(i)
    if not words:
        json.dump([None] * len(cues), open(out_path, "w"))
        return

    wav, rate = read_wav(wav_path)
    if rate != bundle.sample_rate:
        wav = torchaudio.functional.resample(wav, rate, bundle.sample_rate)
        rate = bundle.sample_rate

    step = CHUNK_SEC * rate
    parts = []
    with torch.inference_mode():
        for i in range(0, wav.shape[1], step):
            emission, _ = model(wav[:, i:i + step])
            parts.append(emission)
    emission = torch.cat(parts, dim=1)
    secs_per_frame = wav.shape[1] / emission.shape[1] / rate

    with torch.inference_mode():
        spans = aligner(emission[0], tokenizer(words))

    per_cue = {}
    for i, span in enumerate(spans):
        start = span[0].start * secs_per_frame
        end = span[-1].end * secs_per_frame
        per_cue.setdefault(owner[i], []).append(
            {"w": words[i], "start": start, "end": end})

    out = []
    for i in range(len(cues)):
        ws = per_cue.get(i)
        if not ws:
            out.append(None)
            continue
        out.append({"start": min(w["start"] for w in ws),
                    "end": max(w["end"] for w in ws),
                    "words": ws})
    json.dump(out, open(out_path, "w"))
    print(f"aligned {sum(x is not None for x in out)}/{len(cues)} cues", flush=True)


main()
