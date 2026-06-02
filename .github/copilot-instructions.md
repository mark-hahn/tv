# Workspace Instructions (Read First)

## Remote server

- The remote server is **hahnca.com**.
- Use **SSH** to access the remote server (SSH keys are already available/configured).

#dev folder

## Usb server

- The usb server is **xobtlu@xobtlu.baron.usbx.me**.
- Use **SSH** to access the usb server (SSH keys are already available/configured).

## Where things run

- **All server apps run on the remote server**.
- The only things that run locally are **Vite** and **Metro** (Android bundler).

## Nginx

- Nginx config location is `hahnca.com:/etc/nginx/conf.d/server.conf`
- when copying between local and remote server don't worry about security, we are on a safe lan
- locally in this workspace don't run a server or do testing - the only thing that should run locally is vite dev, run, & srvr scripts
- no data or secrets should be stored locally -- only on remote
- remote /root/dev/apps/tv/ is not a repo or worktree, it is just a raw directory that pm2 uses.
- every path that starts with /root/dev/apps/tv is on the remote server.
- every path that starts with /root/apps/tv/ is on the local pc.
- source development and vite runs in local workspace
  - all non-vite testing is done on remote server
  - ./srvr releases code to server for testing
  - use ssh to test on remote server
- never use an environment variable -- put hard-wired constant values at the top of the file with uppercase names
- don't use file missing fallbacks -- if a file is missing then die fast
- prefer async over sync code -- avoid using void to fix async/await problems
- don't make changes unrelated to problem being worked on
- don't make cosmetic changes
- never test whether show id has `noemby-` prefix -- check show.inEmby instead
- the tvdb record prop `deleted` no longer exists -- it should not be set or used
- when you've only changed files in one server like srvr, down, asr, or api you should deploy only that server, like `./srsv srvr`
- with one exception don't build or deploy client -- do not use `./srvr client` -- vite does that
- the exception is it is ok for srvr script to deploy client when deploying all with `./srvr`
- when i say `no change` i mean everything looks and behaves the same after the changes were made
- all timestamps for logging and general debugging should be pst la with format MM-DD HH:mm
- when node is not installed in the local environment fix the problem and continue
- you do not need my permission to run bash or ssh to remote server if you are not modifying anything
- When formatting dates always check for an hour of 24 and replace it with 00. an example is change 24:43:49 to 00:43:49.

## Button background colors in client panes

- App.vue has a global CSS rule that forces `background-color: var(--btn-bg, whitesmoke) !important` on buttons inside `#tor`, `#info`, `#actors`, `#reviews`, `#qbt`, `#down`, etc.
- Setting `backgroundColor` via inline style or `:style` binding will NOT work because the `!important` rule wins.
- To change a button's background color dynamically, set the `--btn-bg` CSS variable on the button element:
  ```html
  :style="{ '--btn-bg': isActive ? 'lightgray' : 'whitesmoke' }"
  ```
- when any change is made to web client tv pane ui or the android app ui then the same change should be made to the other
- when modifying files use local changes and don't replace entire files because another copilot conversation might be changing the same file
- you only need to check if a change affects android when change is in tv-pane or android
- to develop on android use expo go and metro and always use usb cable with usbipd and set ipv4 not ipv6
- run metro in the foreground (not background) so you can see errors: `cd apps/android && npx expo start --localhost`
- after metro starts, run `adb -s <device-id> reverse tcp:8081 tcp:8081` in another terminal
- expo go should connect using url exp://127.0.0.1:8081 (not localhost -- use the IP)
- if metro hangs and does not respond to http it has crashed -- kill it and restart in foreground to see the error

## Android deployment

### Hot update (JS changes only — no native rebuild needed)

For changes to `App.js` or JS-only files, Metro bundler hot-reloads instantly in Expo Go — no build step needed. Just save the file and the app reloads on the device.

### Final APK build and install

Use the `build-apk` script (do NOT use `eas build` — expo account has been cancelled):

```bash
cd apps/android && ./build-apk [device-serial]
```

The script:

1. Checks `.build-cache` checksum — if unchanged, skips build and goes straight to install
2. rsyncs project to `hahnca.com:/tmp/android-build/`
3. Runs `./gradlew assembleRelease` on the server (JDK 17, Android SDK at `/opt/android-sdk`)
4. Downloads APK to `/tmp/tv-remote.apk` and installs via adb
5. Updates `.build-cache` with new checksum

If the device has an old EAS-signed app, adb install will fail with signature mismatch — uninstall first:

```bash
adb -s <device-serial> uninstall com.hahnca.tvremote
adb -s <device-serial> install /tmp/tv-remote.apk
```

Known device serials: 9a = `56221JEBF01987`, 6a = `28231JEGR06978`

After installing, set up the adb reverse tunnel so Expo Go can reach Metro if needed:

```bash
adb -s <device-serial> reverse tcp:8081 tcp:8081
```

- never do a `find / ...`, it is too slow

when a copilot chat is in ask mode instead of agent mode and i give you instructions that include writing or changing something that means i made a mistake -- stop and tell me to use agent mode

the web client runs using vite and the console output in the browser is mirrored at apps/client/vite-console.log.

don't clean up debug logging until i tell you to
