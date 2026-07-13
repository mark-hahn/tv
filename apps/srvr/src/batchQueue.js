// Shared batch-job infrastructure: the SCHED_IDLE/ionice command prefix and the
// serialized ffmpeg job queues used by the batch consumers. Real-time video
// streaming is managed separately.

// Batch ffmpeg/jobs run under SCHED_IDLE (`chrt -i 0`) + idle I/O class
// (`ionice -c 3`). SCHED_IDLE means the kernel only gives them CPU when no
// normal-priority task wants it, so Emby transcodes and live streaming (both
// normal priority) run at full speed and instantly preempt batch work — while
// batch still uses every idle core to finish fast. This is why CPU load average
// is not a useful health signal; PSI `full` pressure is (see pollGlobalMessages).
export const BATCH_SCHED = ["chrt", "-i", "0", "ionice", "-c", "3"];

// One job at a time, in call order. `pending` includes the running job.
function makeSerialQueue() {
  let tail = Promise.resolve();
  let _pending = 0;
  function run(fn) {
    _pending++;
    const next = tail.then(() => fn()).finally(() => _pending--);
    tail = next.catch(() => {});
    return next;
  }
  return {
    run,
    get pending() {
      return _pending;
    },
  };
}

// Video recoding: 2160->1080 re-encode and BIF. These decode and re-encode full
// video streams, so each one already saturates every idle core — running two at
// once finishes neither sooner. Serialized for that reason, and for that reason
// only: a job belongs here if it competes for those cores, not merely because it
// shells out to ffmpeg.
export const ffmpegQueue = makeSerialQueue();

// Embedded-subtitle extraction (subsQueue.js). A seconds-long text-stream copy —
// no video decode — but it feeds subQueue -> subQueueChkSrt, so behind a
// multi-hour re-encode it stalls the whole chksrt pipeline.
export const subExtractQueue = makeSerialQueue();

// subExtractQueue is serialized among itself so a freshly-grabbed season can't
// fan out into N concurrent ffmpegs, but it runs in parallel with ffmpegQueue and
// with mpfour's own mp4-mirror loop (mpfour.js).
//
// ASR (asr.js) is on no queue here at all: transcription is a remote Mistral API
// call and the local ffmpeg work is audio-only (`-vn` extract, 16kHz filters,
// flac chunks), so it never competes for the re-encode's cores. Its own loop in
// subsQueue.js already runs one job at a time via the genSrtRunning guard.
