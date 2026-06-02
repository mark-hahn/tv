# USB Server Migration Inventory

## What in this repo currently uses the USB server

### Live runtime code

- `apps/down/src/main.js`
  - Hard-codes `usbHost = "xobtlu@xobtlu.baron.usbx.me"`.
  - TV download cycle SSHes to the USB server to:
    - list `files/` contents
    - prune old content under `~/files`
    - list directories under `files/`
    - scan DVD-style files under `files/`
  - This is the main TV-side file transfer / prune path.

- `apps/down/src/tvJson.js`
  - Hard-codes `const usbHost = "xobtlu@xobtlu.baron.usbx.me"`.
  - Passes the USB host into worker/download lifecycle code.

- `apps/down/src/movie-rsync.js`
  - Hard-codes:
    - `USB_HOST = "xobtlu@xobtlu.baron.usbx.me"`
    - `USB_MOVIES_PATH = "/home/xobtlu/movies"`
    - `QB_HOST = "xobtlu.baron.usbx.me"`
    - `QB_PORT = 12041`
    - `QB_USER = "xobtlu"`
  - Polls qBittorrent WebUI on the USB server.
  - Reads completed movie torrents whose save path is `/home/xobtlu/movies`.
  - Copies movie payloads over SSH/dd from the USB server.
  - Marks remote files done with `.tv-done` sidecars.

- `apps/api/src/sshTunnel.js`
  - Hard-codes `USB_SSH_TARGET = "xobtlu@xobtlu.baron.usbx.me"`.
  - Runs `ssh ... curl ...` on the USB server so outbound tracker traffic originates from the USB server IP.

- `apps/api/src/search.js`
  - Calls `patchProviderWithSshTunnel(...)` for `IpTorrents` and `TorrentLeech`.
  - This means private-tracker searches depend on the USB server SSH tunnel path in `sshTunnel.js`.

- `apps/api/src/download.js`
  - Uses `sshCurlFetch(...)` from `sshTunnel.js` for tracker download flows.
  - Has comments that assume `qbt-unrar.sh` on the USB server is doing post-download naming/unrar work.

- `apps/api/src/usb.js`
  - Uses `QB_HOST` / `QB_USER` from `apps/api/secrets/qbt-cred.txt` as the SSH target for most USB interactions.
  - Hard-codes these remote roots:
    - `USB_FILES_ROOT = "/home/xobtlu/files"`
    - `USB_MOVIES_ROOT = "/home/xobtlu/movies"`
    - additional rename/delete helpers also hard-code `/home/xobtlu/files`.
  - Live features that depend on the USB server:
    - USB file tree listing
    - USB movie tree listing
    - USB prune scan/delete logic
    - USB rename/delete operations
    - qBittorrent recheck/login via WebUI credentials

- `apps/api/src/server.js`
  - Hard-codes:
    - `USB_HOST_FOR_MEDIAINFO = "xobtlu@xobtlu.baron.usbx.me"`
    - `USB_FILES_ROOT_MI = "/home/xobtlu/files"`
    - `USB_MOVIES_ROOT_MI = "/home/xobtlu/movies"`
  - `/api/usb/mediainfo` SSHes to the USB server and runs `mediainfo` there.

- `apps/client/src/components/tor.vue`
  - Sends movie downloads with `savePath: "/home/xobtlu/movies"`.
  - This is not an SSH target by itself, but it is a hard-coded USB-server path that must match the new server layout.

- `apps/srvr/index.js`
  - Does not hard-code the old host, but it reads `QB_HOST` / `QB_USER` from `qbt-cred.txt` and uses them for qBittorrent-related flows.
  - That secrets file will need the new login/host later even though it is not in this repo.

### Docs / prompt files / notes that mention the old USB server

- `.github/copilot-instructions.md`
  - Names the USB server as `xobtlu@xobtlu.baron.usbx.me`.

- `.github/prompts/api.prompt.md`
  - Describes private-tracker requests as `ssh xobtlu@xobtlu.baron.usbx.me curl ...`.

- `.github/prompts/down.prompt.md`
  - Documents the seedbox as `xobtlu@xobtlu.baron.usbx.me`.
  - Documents qBittorrent polling at `xobtlu.baron.usbx.me:12041`.

- `docs/extrn-access.md`
  - Lists `xobtlu.baron.usbx.me` / `xobtlu@xobtlu.baron.usbx.me`.
  - Also notes `QB_HOST` from `apps/api/secrets/qbt-cred.txt`.

## Address / login / path references that will need changing later

### Hard-coded in repo

- SSH login / host
  - `xobtlu@xobtlu.baron.usbx.me`
  - Found in:
    - `apps/down/src/main.js`
    - `apps/down/src/tvJson.js`
    - `apps/down/src/movie-rsync.js`
    - `apps/api/src/sshTunnel.js`
    - `apps/api/src/server.js`
    - `.github/copilot-instructions.md`
    - `.github/prompts/api.prompt.md`
    - `.github/prompts/down.prompt.md`
    - `docs/extrn-access.md`

- qBittorrent host / port / login
  - `xobtlu.baron.usbx.me`
  - `12041`
  - `xobtlu`
  - Hard-coded in `apps/down/src/movie-rsync.js`.

- Remote home-root paths
  - `/home/xobtlu/files`
  - `/home/xobtlu/movies`
  - Found in `apps/api/src/usb.js`, `apps/api/src/server.js`, `apps/down/src/movie-rsync.js`, `apps/client/src/components/tor.vue`, and several doc files.

### Dynamic, but still must be updated outside the repo

- `apps/api/secrets/qbt-cred.txt`
  - `QB_HOST` currently drives the SSH target and qBittorrent HTTP host for `apps/api/src/usb.js` and qBittorrent-related `apps/srvr/index.js` paths.
  - `QB_USER` may also need updating if the login name changes.

## Backup scan results

### Definitely migrate

- `usb-bkup/.bash_aliases`
  - Contains the operator aliases used on the seedbox.
  - Includes aliases for qBittorrent log tails and other convenience commands.

- `usb-bkup/qbt-unrar.sh`
  - Required by qBittorrent autorun.
  - `qBittorrent.conf` points AutoRun to `/bin/bash /home/xobtlu/qbt-unrar.sh "%R" "%N"`.
  - Also writes `/home/xobtlu/unrar.log` and touches extracted files so prune logic does not immediately delete them.

- `usb-bkup/.config/qBittorrent/`
  - Required qBittorrent configuration.
  - Verified items in backup:
    - `qBittorrent.conf`
    - `qBittorrent-data.conf`
    - `categories.json`
    - `watched_folders.json`
  - Important current settings in `qBittorrent.conf`:
    - WebUI port `12041`
    - WebUI username `xobtlu`
    - default save path `/home/xobtlu/files`
    - incomplete path `/home/xobtlu/incomplete`
    - autorun script `/home/xobtlu/qbt-unrar.sh`
    - watched-folder and qBittorrent runtime behavior

- `usb-bkup/.local/share/qBittorrent/`
  - Required if you want current torrent state/history carried forward.
  - Contains `BT_backup/` with `.torrent` and `.fastresume` files.
  - Backup has 565 files in `BT_backup/`.
  - Also contains `logs/`, `nova3/`, and other qBittorrent runtime data.

- `usb-bkup/iptorrents.py`
  - qBittorrent search-engine helper script with embedded tracker login.
  - Migrate if the qBittorrent-side search plugin is still used on the new server.

- `usb-bkup/torrentleech.py`
  - qBittorrent search-engine helper script with embedded tracker login.
  - Migrate if the qBittorrent-side search plugin is still used on the new server.

- `usb-bkup/.local/share/qBittorrent/nova3/helpers.py`
- `usb-bkup/.local/share/qBittorrent/nova3/novaprinter.py`
  - Support files used by the qBittorrent search-engine scripts above.

- `usb-bkup/incomplete/`
  - Not empty in this backup.
  - Contains in-progress / partial payloads and should be migrated if you want active downloads to survive the move.

- `usb-bkup/watch/`
  - qBittorrent `watched_folders.json` points at `/home/xobtlu/watch/qbittorrent`.
  - Migrate the folder structure even if currently sparse, because qBittorrent is configured to watch it.

- `usb-bkup/files/`
- `usb-bkup/movies/`
  - These are the canonical content roots referenced throughout the repo.
  - In this backup they look effectively empty at shallow scan, but they still need to exist on the new server at the expected paths unless code/config is changed.

- `usb-bkup/downloads/`
  - qBittorrent config references `/home/xobtlu/downloads/qbittorrent` as a save path in preferences.
  - Migrate or recreate if the new qBittorrent setup still uses that path.

### Likely migrate if you want the same shell/login environment

- `usb-bkup/.bashrc`
- `usb-bkup/.profile`
- `usb-bkup/.ssh/`
  - These are not called directly by repo code, but they affect login shell behavior, aliases, and SSH convenience on the seedbox.
  - `.ssh/` only matters if you intentionally want to preserve the old server-side SSH identity/config.

### Probably not required for these apps

- `.apps/ombi`, `.apps/radarr`, `.apps/sonarr`, `.config/transmission-daemon`, `.cache`, `.cargo`, `.pyenv`, `.rustup`, `.proot`, `.vscode-server`, and similar environment/tooling trees.
  - These do not appear to be required by the code paths in this repo for TV/api/down/client behavior.
  - Migrate only if you separately want those services or that shell environment on the new server.

## Practical migration minimum for our apps

If the goal is only to keep this repo working against the new USB server with minimum breakage, the must-have server-side set is:

- qBittorrent config/state
  - `.config/qBittorrent/`
  - `.local/share/qBittorrent/`
  - `watch/`
  - `incomplete/`
  - `files/`
  - `movies/`
  - `downloads/` if you keep the same qBittorrent pathing

- Helper scripts / shell setup
  - `.bash_aliases`
  - `qbt-unrar.sh`

- Optional qBittorrent search plugins if still used there
  - `iptorrents.py`
  - `torrentleech.py`
  - `.local/share/qBittorrent/nova3/helpers.py`
  - `.local/share/qBittorrent/nova3/novaprinter.py`

## Notes from this scan

- The copied backup was added to `.gitignore` as `usb-bkup/` so git stays clean.
- After that change, the only intended workspace changes are `.gitignore` and this file.
- The backup copy contains a lot of historical / unrelated server state, but the repo’s actual live dependency surface is much smaller and concentrated in `apps/down`, `apps/api`, and one path literal in `apps/client`.
