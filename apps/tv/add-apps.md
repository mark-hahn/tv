# Adding Apps to services.json

This describes the full process of adding a new streaming service to `apps/tv/services.json`, including logo acquisition and deployment.

---

## 1. Find the app URI on the Bravia TV

The Bravia TV (192.168.1.231) provides a list of installed apps with their launch URIs. Query it from the remote server (hahnca.com):

```bash
ssh hahnca.com 'curl -s --http1.0 -m10 -X POST http://192.168.1.231/sony/appControl \
  -H "Content-Type: application/json" -H "X-Auth-PSK: qwerty" \
  -d "{\"method\":\"getApplicationList\",\"id\":1,\"params\":[],\"version\":\"1.0\"}" \
  | python3 -c "import json,sys,html; [print(html.unescape(a[\"title\"]),\"|\",a[\"uri\"]) for a in json.load(sys.stdin)[\"result\"][0]]"'
```

> **Important**: Always use `--http1.0` when calling the Bravia HTTP API. The TV speaks chunked HTTP/1.1 but never closes the connection, causing curl to hang. HTTP/1.0 forces an immediate close after the response.

Find the row matching the new app to get its `uri` value. The uri format is typically:
`com.sony.dtv.<package>.<MainActivityClass>`

---

## 2. Add the entry to services.json

File: `apps/tv/services.json`

Each entry has these fields:

```json
{
  "name": "Display Name",
  "uri": "com.sony.dtv...",
  "icon": null,
  "color": "RRGGBB",
  "logo": "slug.png"
}
```

- `name`: Human-readable name shown in the UI. Must match the Bravia `title` exactly for logo download to work.
- `uri`: The launch URI from step 1.
- `icon`: Leave `null` (simple-icons are no longer used).
- `color`: Hex color (without `#`) for the button background. Use a brand color.
- `logo`: PNG filename — use the slugify rules below.

### Slug rules (matches the download script)

Given a display name, compute the slug:

1. Lowercase the name
2. Replace `+` with `plus`
3. Remove `&`
4. Remove all chars except `a-z`, `0-9`, space, `-`
5. Trim whitespace
6. Replace spaces with `-`
7. Collapse consecutive `-` into one
8. Append `.png`

Examples: `AMC+` → `amcplus.png`, `A&E` → `ae.png`, `Disney+` → `disneyplus.png`, `YouTube TV` → `youtube-tv.png`

---

## 3. Download the logo

On the remote server (hahnca.com), run the download script at `/tmp/dl-logos3.py`. It reads from `services.json` on the server path `/root/dev/apps/tv/apps/tv/services.json`, fetches each logo from the Bravia app list, and saves to `/tmp/logos-new/`.

If you only need to download the new logo, run this one-liner from hahnca.com:

```bash
ssh hahnca.com 'python3 - << EOF
import json, re, os, html, subprocess

# Get app list from Bravia (--http1.0 required to avoid chunked hang)
result = subprocess.run(
    ["curl", "-s", "--http1.0", "-m10", "-X", "POST", "http://192.168.1.231/sony/appControl",
     "-H", "Content-Type: application/json",
     "-H", "X-Auth-PSK: qwerty",
     "-d", '"'"'{"method":"getApplicationList","id":1,"params":[],"version":"1.0"}'"'"'],
    capture_output=True, text=True
)
apps = json.loads(result.stdout)["result"][0]
lookup = {html.unescape(a.get("title","")): a.get("icon","") for a in apps}

name = "NEW APP NAME"   # <-- change this
slug = name.lower().replace("+","plus").replace("&","")
slug = re.sub(r"[^a-z0-9 -]","",slug).strip()
slug = re.sub(r" +","-",slug)
slug = re.sub(r"-+","-",slug)
dest = f"/tmp/logos-new/{slug}.png"
os.makedirs("/tmp/logos-new", exist_ok=True)
url = lookup.get(name,"")
print("icon url:", url)
r = subprocess.run(["curl","-s","--http1.0","-m10","-o",dest,url], capture_output=True)
print("exit:", r.returncode, "size:", os.path.getsize(dest) if os.path.exists(dest) else "missing")
EOF'
```

---

## 4. Copy the logo locally and deploy

After the logo is downloaded to `/tmp/logos-new/<slug>.png` on hahnca.com:

```bash
# Copy logo from remote to local client public folder
scp hahnca.com:/tmp/logos-new/<slug>.png /root/apps/tv/apps/client/public/logos/<slug>.png
```

Then deploy everything:

```bash
cd /root/apps/tv && ./srvr
```

This builds the client (vite build with `--base=/shows/ --outDir=shows`) and deploys all servers including the built `shows/logos/` directory to hahnca.com.

Also copy the services.json to the android project so Metro bundler can access it (the android project cannot import outside its own root):

```bash
cp /root/apps/tv/apps/tv/services.json /root/apps/tv/apps/android/services.json
```

---

## 5. Android logo display

The Android app (`apps/android/App.js`) loads logos as remote images from:
`https://hahnca.com/shows/logos/<slug>.png`

No changes to App.js are needed — it reads `services.json` (locally copied) and constructs the URL dynamically.

---

## Summary checklist

- [ ] Query Bravia app list for the new app's `uri`
- [ ] Add entry to `apps/tv/services.json` with correct slug for `logo` field
- [ ] Copy `services.json` to `apps/android/services.json`
- [ ] Download logo from Bravia to `/tmp/logos-new/<slug>.png` on hahnca.com
- [ ] `scp` logo to `apps/client/public/logos/<slug>.png` locally
- [ ] Run `./srvr` to build and deploy
