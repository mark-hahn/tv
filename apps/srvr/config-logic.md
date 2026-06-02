# srvr config file management

## Location

All config files live in `apps/srvr/config/` on the **remote server only** (`/root/dev/apps/tv/apps/srvr/config/`). This folder does not exist in the local repo. It is created automatically at srvr startup by `ensureDir(CONFIG_DIR)`.

## Files

| File                   | Managed by                     | Purpose                                                                           |
| ---------------------- | ------------------------------ | --------------------------------------------------------------------------------- |
| `config1-header.txt`   | Manual / human                 | Top section of the flexget `config.yml` template                                  |
| `config2-rejects.json` | srvr (written on every save)   | JSON array of show names to exclude from torrent downloads                        |
| `config3-middle.txt`   | Manual / human                 | Middle section of the flexget `config.yml` template (between rejects and pickups) |
| `config4-pickups.json` | srvr (written on every save)   | JSON array of show names to actively pick up from torrents                        |
| `config5-footer.txt`   | Manual / human                 | Bottom section of the flexget `config.yml` template                               |
| `config.yml`           | srvr (assembled on every save) | The final flexget config uploaded to the USB server                               |

## How config.yml is assembled

On every save, `srvr` builds `config.yml` by concatenating:

```
headerStr          (from config1-header.txt, "" if missing)
  + "dummy" entry
  + one line per reject name  (from config2-rejects.json)
middleStr          (from config3-middle.txt, "" if missing)
  + one line per pickup name  (from config4-pickups.json)
footerStr          (from config5-footer.txt, "" if missing)
```

The assembled file is written to `config/config.yml`, then rsynced to `xobtlu@xobtlu.baron.usbx.me:/home/xobtlu/.config/flexget/config.yml`, and flexget is reloaded via `ssh xobtlu@xobtlu.baron.usbx.me /home/xobtlu/reload-cmd`.

## Read on startup

The five source files are read **once at process startup** (module-level `readTextOrWithChosenPath` calls, lines ~154–179 of `index.js`). Missing files fall back to `""` (txt) or `"[]"` (json) — srvr does not crash if they are absent.

After reading, `startupConfigSync()` runs immediately to reconcile `tvdb.json` with the rejects array (config is the authority).

## Written at runtime

`trySaveConfigYml` / `saveConfigYml` is called whenever rejects or pickups change:

- `addReject` / `removeReject` — user adds or removes a show from the reject list
- `addPickup` / `removePickup` — user adds or removes a show from the pickup list

On each call it:

1. Sorts both arrays
2. Writes `config2-rejects.json` and `config4-pickups.json`
3. Syncs `tvdb.json` reject flags to match the config arrays
4. Assembles and uploads `config.yml` to the USB server
5. Reloads flexget

## Deploy behavior

The `./srvr srvr` deploy script **never touches the config folder** — rsync excludes `data/` and `secrets/`, and there is no `--delete` flag, so remote-only files survive deploys. However the three `.txt` template files are never created by the code; they must be created/restored manually on the remote server if lost.
