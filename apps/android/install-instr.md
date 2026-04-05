# TV Remote — deploy to phone

After `eas build` finishes it prints an APK download URL.
https://expo.dev/artifacts/eas/uzmNWs4XjWXiVkFn6wdcSA.apk

Run these steps for each Pixel phone.

## With adb (USB cable)

```bash
# download the apk
curl -L "<EAS_APK_URL>" -o tv-remote.apk

# install (phone must be in USB debugging mode)
adb devices                          # confirm phone is listed
adb install tv-remote.apk           # first install
# adb install -r tv-remote.apk      # reinstall / update
```

## Without adb (browser on phone)

1. Open the EAS APK URL in Chrome on the phone.
2. Settings → Apps → Special app access → Install unknown apps → Chrome → Allow.
3. Tap the downloaded file to install.

## Enable USB debugging (one-time per phone)

Settings → About phone → tap Build number 7 times → Developer options → USB debugging ON.

## Update app

1. Bump `versionCode` in apps/android/app.json.
2. `cd apps/android && eas build -p android --profile preview`
3. `adb install -r tv-remote.apk` on each phone.
