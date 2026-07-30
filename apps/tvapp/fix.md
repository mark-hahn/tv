# TVAPP — getting the TV back

Everything here is about one thing: letting the PC reach the TV over adb so a
new build can be installed. **Watching the app needs none of it** — TVAPP sits
in the TV's apps row and opens with the remote, and BACK exits it.

All commands run from `/root/apps/tv/apps/tvapp`.

---

## Normal day

```bash
./build-apk
```

Builds on hahnca.com, installs, and launches. It finds the TV by itself — the
TV's IP and its wireless debugging port both change constantly, so neither is
written down anywhere; the TV advertises them over mDNS and `connect-tv` reads
that.

---

## After a reboot

Should heal itself. Android switches wireless debugging off on every boot, so
TVAPP holds `WRITE_SECURE_SETTINGS` and its boot receiver turns it back on
(`AdbWifi.java`). Opening the app does the same, as a backstop.

If `./build-apk` still can't find the TV, the receiver lost its race with Wi-Fi:
open TVAPP once with the remote and try again.

If that doesn't work either, the grant is gone — do **step 2** below, then:

```bash
./build-apk
```

---

## After a factory reset

The TV forgets the pairing, the app, and the permission grant. Full redo:

### 1. Turn debugging back on (at the TV, with the remote)

1. **Settings → System → About → Build** — click it 7 times. "You are now a
   developer."
2. **Settings → System → Developer options → Wireless debugging** — on.
3. Still in Wireless debugging, open **Pair device with pairing code**. It
   shows a 6-digit code. **Leave this dialog on screen** — its pairing port
   dies when you close it.

### 2. Pair and install (at the PC)

```bash
./connect-tv 451710      # <- the 6-digit code from the dialog
./build-apk
```

`connect-tv` finds the pairing port over mDNS, so the code is all it needs. The
TV may show an **Allow debugging?** prompt — accept it, tick *Always allow*.

`build-apk` then installs, grants `WRITE_SECURE_SETTINGS`, and launches the app
— which is what makes reboots self-healing again. All three matter; an app that
has never been opened never receives `BOOT_COMPLETED`.

### 3. Optional tidying

`connect-tv` has a `TV_GUID` constant that pins discovery to this TV so another
Android device on the LAN can't be picked instead. A factory reset changes it.
Discovery falls back to the first device advertising adb, so this only matters
if there is more than one. To re-pin it, take the id `adb pair` prints:

```
Successfully paired to 192.168.1.85:42315 [guid=adb-1263710030...-aoJzeA]
                                                 ^^^^^^^^^^^^^^^^^^^^^^^^
```

---

## After "Revoke pairings"

Same as a factory reset, but the app and its permission grant survive — only
the pairing is gone. Do **step 1**, then just:

```bash
./connect-tv <code>
```

---

## When it still won't connect

```bash
./connect-tv
```

says what it could not do. The usual causes, in order:

| Symptom | Cause | Fix |
| --- | --- | --- |
| `The TV is not advertising adb` | Wireless debugging is off | Step 1, or open TVAPP with the remote |
| `The TV is not advertising adb`, TV is on and debugging is on | mDNS not reaching hahnca.com | `ssh hahnca.com avahi-browse -rtp _adb-tls-connect._tcp` — empty means a network problem, not a TV problem |
| `refused us` | The TV no longer trusts our key | Step 1 + `./connect-tv <code>` |
| `No pairing service advertised` | The pairing dialog was closed | Reopen it and rerun immediately |

The cached address lives in `.device`. It is only a fast path — delete it any
time, discovery will rebuild it.
