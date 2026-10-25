#!/usr/bin/env python3
# The reference for scripts/vet-validate.js (subtitle vetting's judge,
# src/subJudge.js): the verdicts of the analysis's final logic (evaluate.py's
# FINAL variant) for every file of fresh100 and test100, with the fix line,
# the fill captions of files rejected only for missing captions (fill.py), and
# the verdicts against the old `+` file (plus.py). Runs on hahnca.com. Reads
# the sub-analysis data only; writes the json file named on the command line:
#   python3 scripts/vet-validate-ref.py /tmp/ref.json
import gzip, json, os, sys
from multiprocessing import Pool
OUT_ARG = sys.argv[1:]
sys.argv = sys.argv[:1]
A = "/root/dev/apps/tv/apps/srvr/data/sub-analysis"
sys.path.insert(0, f"{A}/fresh100")
sys.path.insert(0, f"{A}/planted")
sys.path.insert(0, f"{A}/plusfile")
import evaluate as E
import fill as F
import plus as PL

OUT = OUT_ARG[0]
FINAL = "whole+refit+mend+mlyr+mslide+segMin6+segE450+segL300+spotE1200+spotL600"


def episode(job):
    s, vid = job
    E.DIR = f"{A}/{s}"
    v = {x["id"]: x for x in json.load(open(f"{E.DIR}/picks.json"))}[vid]
    d = round(v["durS"] * 1000)
    vd = f"{E.DIR}/v/{vid}"
    W = PL.ORIG["asr_words"](f"{vd}/transcript.json.gz")
    files = [(n, k, E.srt_lines(f"{vd}/{n}.srt")) for n, k in E.video_files(v)]
    files = [f for f in files if f[2]]
    sibs = E.sibling_files(files, vd)
    cfg = E.make_cfg(FINAL)
    out = []
    plus_ok = os.path.exists(f"{PL.OUT}/{s}/{vid}.asr.srt")
    Wc = PL.load_plus(s, vid) if plus_ok else None
    for name, kind, lines in files:
        PL.mode(False)
        j = E.judge(lines, W, d, cfg, sibs[name])
        row = dict(set=s, vid=vid, name=name, kind=kind, verdict=PL.kind(j), why=j["why"], fix=j["fix"], durMs=d)
        if j["verdict"] == "bad" and j["why"].startswith("no captions"):
            _, _, (a, b) = E.cover_test(lines, E.file_cues(lines), W, [(0, d)], cfg, d)
            row["fix"] = (a, b)
            lv = [(a + b * x, a + b * y, w) for x, y, w in lines]
            _, fc = F.fill(lv, W, d, sibs[name], E.SLIDE_MS, E.SLIDE_MIN_WORDS)
            row["fills"] = [(s_, e_, " ".join(w)) for s_, e_, w in fc]
        if plus_ok:
            PL.mode(True)
            PL.load_plus(s, vid)
            jp = E.judge(lines, Wc, d, cfg, sibs[name])
            row["plus"] = PL.kind(jp)
            row["plusFix"] = jp["fix"]
            PL.mode(False)
        out.append(row)
    return out


if __name__ == "__main__":
    jobs = [(s, x["id"]) for s in ("fresh100", "test100") for x in json.load(open(f"{A}/{s}/picks.json"))
            if os.path.exists(f"{A}/{s}/v/{x['id']}/transcript.json.gz")]
    with Pool(12) as p:
        rows = [r for rs in p.map(episode, jobs, chunksize=1) for r in rs]
    json.dump(rows, open(OUT, "w"))
    print(len(rows), "files")
