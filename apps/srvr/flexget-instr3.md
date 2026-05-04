## answers and new instructions

## misc instructions/changes
- don't need apps/srvr/data/flexget-decision.log
  - flexget-history acts as a log
- remove step 4 of Processing each candidate from flexget stdout section
  - do not Skip if a video file for that episode already exists in the media library
  - previous matching episode files will be renamed by down server
- be careful about deploying
  - old flexget code should not be run with new data
  - all deployment of new code and data should happen at once
    - stop all tv servers while deploying first time
  - one-time test should not interfere with old code
    - do not Deploy srvr (./srvr srvr) for test
    - just deploy files directly to test folder
- in flex pane Sort list by `sent` timestamp, oldest first, not newest first
  - use standard log scrolling algorithm with bottom non-stickiness

## answers
1. you choose whether to use --dump stdout or another method -- if using --dump then when running one-time test, check --dump` output format first -- order is: check --dump format, update code, re-deploy test, and then run actual test -- if not using --dump then do any format checking needed the same way at beginning of test

2. use `pipx install flexget` --  confirm Python version available on server.

3. --config path for flexget should be `apps/srvr/config/config.yml`

4. ignore any Season pack -- do not treat as candidate

5. use whichever available group value, preferring flexget's value.

6. to access flexget-history.json use cross-app file read

7. do not worry about `.old` files accumulating -- No cleanup is needed -- `.old` rename should chain (e.g. `.old.old`) only when needed

8. use existing qbt API call path for qbt sends

9. calculate `<idx>` as a client-side computation over the returned list

10. stop USB server flexget by stopping the flexget daemon on the USB server and removing/disabling the cron or systemd unit there. the infrastructure can be left in place but unused -- remember this is a shared server so priveleges will be limited

## instructions
- update flexget-plan.md
- make no changes other than writing to plan
- notify me of any incompleteness, contradictions, ambiguity, or impossible actions
- feel free to make suggestions

