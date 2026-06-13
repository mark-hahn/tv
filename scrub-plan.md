# scrub plan

## current behavior summary

- web client and android both have local left/right hold logic that preserves short-press vs long-press behavior and falls back to normal key repeat when emby is not playing
- both remote clients currently call `POST /tv/emby/scrub/start` on the tv server for long-press left/right while emby is playing
- the tv server currently owns a repeating scrub loop, but that loop should be removed in favor of one explicit endpoint call per jump
- ignore intro skip behavior for this change; it is not the model for scrub implementation

## implementation plan

1. replace the current scrub contract with one endpoint call per jump
   - keep the existing remote debounce, press-and-hold threshold, and short-press fallback behavior unchanged in web and android
   - remove the server-side repeating scrub loop entirely
   - remove the dead-man ping and scrub stop lifecycle because there will be no long-lived server scrub state to maintain

2. add explicit scrub constants at the top of the owning files
   - define a single in-code repeat interval constant for emby jump repetition, set to `1000` ms
   - define a separate in-code real-time emby position tick interval constant, set to `200` ms
   - define constants for first-phase jump size `10` seconds, later-phase jump size `30` seconds, and phase cutoff after `4` jumps
   - remove the current asymmetric forward/backward scrub interval constants because the new behavior requires the same timing in both directions

3. move `embyPos` ownership to each client hold session
   - when a left/right hold crosses the existing long-press threshold, fetch the current emby position once and initialize a client-local `embyPos`
   - start a client-local `200ms` interval timer that increments `embyPos` by `200ms` while the hold session is active
   - keep a client-local repeat-count so each jump can choose `10s` for the first four actions and `30s` after that
   - start each new hold with repeat-count reset to the first-jump phase, including when the new hold changes direction from the prior hold
   - for each jump action, update `embyPos` only by applying the jump distance, clamp at `0`, and send one endpoint call carrying the target tick value
   - do not use any `lastPosAt`-style variable or any per-jump elapsed-time calculation
   - after initialization, do not reread playing position from the api during the hold session; `embyPos` is the authoritative position variable for scrub behavior
   - if playback becomes paused during scrub handling, clear the hold state immediately, stop timers, and ignore the still-held button until the button is physically released

4. make the first jump semantics explicit and consistent
   - on long-press activation, perform one jump immediately after the hold threshold succeeds, then continue every `1000` ms while the hold remains active
   - count that immediate jump as jump `1` for the `10s, 10s, 10s, 10s, 30s...` sequence
   - preserve the current short-press-on-release behavior for left/right when scrub mode never started
   - specifically, if the arrow key is released before the `400ms` long-press threshold, send the normal left or right tv key exactly as the current code does

5. add one simple tv server endpoint for a single explicit emby jump
   - keep the existing `POST /tv/emby/seek` route or replace it with a clearer single-jump route if naming matters
   - the endpoint should accept the target ticks for one jump and issue one emby seek command, using the same session-selection behavior as the current emby routes
   - do not keep any scrub-specific state, timers, repeat counters, pings, or stop handling on the server
   - if an initial position-read endpoint is still needed, keep it as a simple one-shot endpoint that is used only when the scrub hold session starts
   - move session lookup and single-shot seek code into a small shared helper near the emby routes so the one-shot position read and one-shot seek stay minimal and consistent

6. align web client remote logic with the new contract
   - in `apps/client/src/components/tvpane.vue`, replace the current `scrub/start`, `scrub/ping`, and `scrub/stop` flow with client-side repeat logic that sends one seek request per jump
   - keep the existing `400ms` hold threshold and fallback-to-key-repeat when the initial emby position fetch or first jump path reports `notPlaying`
   - keep the existing pending-left-right-key release path so a sub-`400ms` press still emits one normal tv arrow key
   - update the local constants so they describe jump policy rather than the old fixed scrub loop
   - add a client-local `200ms` timer lifecycle that starts when emby scrub begins and stops immediately on release
   - remove the web-client scrub ping timer and `_scrubbing` lifecycle because they are unnecessary under the one-request-per-jump design
   - add explicit local state to ignore a still-held button after playback pauses until release occurs

7. align android remote logic with the same contract and timing
   - in `apps/android/App.js`, make the same client-side `embyPos` and one-request-per-jump changes as the web client
   - preserve existing debounce, hold threshold, and short-press fallback semantics
   - keep the existing pending-left-right-key release path so a sub-`400ms` press still emits one normal tv arrow key
   - add the same client-local `200ms` timer lifecycle used by the web client
   - remove the android scrub ping timer and scrub-active lifecycle because they are unnecessary under the one-request-per-jump design
   - add explicit local state to ignore a still-held button after playback pauses until release occurs
   - verify that web and android use the same jump sequence and same `1000ms` repeat interval

8. implement the previously suggested cleanup as part of the change
   - share the same jump-policy constants and helper logic structure conceptually between web and android so behavior stays aligned
   - reuse the existing single-shot seek endpoint shape if practical and delete the scrub-specific server endpoints because they describe the old server-loop model
   - keep the server helper extraction in scope for this change rather than leaving it as a follow-up

9. keep non-emby behavior unchanged
   - if emby is not playing, left/right should continue to emit the same tv key commands with the same debounce, repeat start delay, and repeat pacing they use today
   - do not change up/down or any non-left/right button behavior

10. validation plan after implementation

- hold right while emby is playing and confirm the jump sequence is `+10, +10, +10, +10, +30, +30...` seconds on roughly `1s` spacing
- hold left while emby is playing and confirm the same timing with negative jumps and clamping at zero
- during a sustained hold, confirm the target positions advance roughly in real time between jumps because `embyPos` is being incremented by the `200ms` timer
- tap left and tap right briefly while emby is playing and confirm a release before `400ms` still emits a single normal tv arrow key
- while holding a scrub button, cause playback to become paused and confirm the hold state clears immediately, timers stop, and the still-held button is ignored until release
- start a new hold in the opposite direction and confirm the jump phase resets to the first `10s` jump
- hold left/right when emby is not playing and confirm existing tv key repeat behavior is unchanged on both web and android
- verify releasing the button stops further jumps promptly, stops the `200ms` timer, and leaves no leftover client timers and no server cleanup dependency

## resolved decisions

- do one immediate jump at hold activation plus one jump every second after that
- if playback is paused during scrub handling, clear the hold state, stop timers, and ignore the button until it is actually released
- ignore the earlier intro-skip-related instruction entirely
- changing direction during a new hold resets the repeat-count phase back to the first `10s` jump

## revised design conclusion

- the simplest design is: client owns `embyPos`, a `200ms` real-time increment timer, and repeat count for the duration of one hold; server only performs one seek per request
- that design removes the current split-brain between client hold timing and server repeat timing
- it also makes web and android parity explicit, because both clients will implement the same local jump state machine

## contradictions or impossibilities

- there is no hard contradiction in the requested behavior based on the current code layout
- the request is implementable without polling emby position after scrub start, because each client can maintain `embyPos` locally with a fixed `200ms` timer plus the explicit jump offsets
- exact sync with real emby playback is impossible under this model, but the instructions explicitly accept rough matching and make the local `embyPos` authoritative

## suggestions

- incorporated into the implementation plan above
