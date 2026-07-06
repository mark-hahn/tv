// Shared batch-job infrastructure: the SCHED_IDLE/ionice command prefix and the
// single serialized ffmpeg job queue used by every batch consumer (subtitle
// extraction, re-encode, BIF). Real-time video streaming is managed separately.

// Batch ffmpeg/jobs run under SCHED_IDLE (`chrt -i 0`) + idle I/O class
// (`ionice -c 3`). SCHED_IDLE means the kernel only gives them CPU when no
// normal-priority task wants it, so Emby transcodes and live streaming (both
// normal priority) run at full speed and instantly preempt batch work — while
// batch still uses every idle core to finish fast. This is why CPU load average
// is not a useful health signal; PSI `full` pressure is (see pollGlobalMessages).
export const BATCH_SCHED = ["chrt", "-i", "0", "ionice", "-c", "3"];

// Single queue for all batch ffmpeg jobs (subtitle extraction, re-encode, BIF).
// Video streaming is managed separately.
export const ffmpegQueue = (() => {
  let tail = Promise.resolve();
  let _pending = 0;
  function run(fn) {
    _pending++;
    const next = tail.then(() => fn()).finally(() => _pending--);
    tail = next.catch(() => {});
    return next;
  }
  // pending includes the currently-running job
  return {
    run,
    get pending() {
      return _pending;
    },
  };
})();
