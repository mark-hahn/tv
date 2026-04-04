# TV Remote — Android App

Single-screen Android remote that mirrors the client TV pane exactly.
Targets Pixel 7a and Pixel 9a. Not intended for public distribution.

## Dev workflow (hot-reload like Vite)

```bash
cd apps/android
npm install          # or pnpm install
npx expo start       # starts dev server + shows QR code
```

On the Pixel phone:

1. Install **Expo Go** from the Play Store (one-time setup).
2. Scan the QR code with Expo Go.
3. The app loads over LAN. Changes to `App.js` reload instantly.

To use tunnel mode when not on the same network:

```bash
npx expo start --tunnel
```

## Build standalone APK (sideload, no Play Store)

Requires an Expo account and the EAS CLI:

```bash
npm install -g eas-cli
eas login
eas build -p android --profile preview
```

EAS builds the APK in the cloud and gives a download URL.
Transfer the APK to each phone (USB, email, etc.) and install with
"Install unknown apps" enabled in Android settings.

## Endpoints

All requests go to `https://hahnca.com/tv-tv` — same as the browser client.
No additional config needed.

## Button grid (matches tvpane.vue exactly)

```
[ ↩ back ]  [ ▲ up    ]  [ ⌂ home  ]
[ ◀ left ]  [ OK      ]  [ ▶ right ]
[ E emby ]  [ ▼ down  ]  [ A kbd   ]
[ Vol-   ]  [ Vol+    ]  [ Mute    ]
[ Google ]  [ Roku    ]  [ Off     ]
```
