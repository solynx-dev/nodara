# Nodara for iOS

The native Nodara app, built with [Expo](https://expo.dev) (SDK 58) and React Native. It connects to **your own Nodara server** — the same one the web app uses.

> [!CAUTION]
> Like the rest of Nodara, this app was **created mainly with AI** by someone who is **not a professional developer**. Test it with your own family before relying on it.

## What's native about it

| | |
|---|---|
| **Background location** | Real iOS background updates (`Always` permission) through a background task, so your circle keeps seeing you when the app is closed. Two modes: *Battery saver* (≈100 m, iOS auto-pause) and *Precise*. |
| **Geofence wake-ups** | Your family's places (up to 20 nearest) are registered with iOS region monitoring. iOS relaunches Nodara on arrival/departure — even if it was swiped away — and it sends a fresh fix right away. |
| **Offline queue** | Fixes are queued on the phone (up to 5 000) and uploaded when you're back online. |
| **Liquid Glass UI** | System tab bar (Liquid Glass on iOS 26), glass map controls (blur fallback on older iOS), large-title headers, native toolbar buttons & menus, form sheets with detents, SF Symbols, haptics, iOS system colours with automatic dark mode. |
| **Apple Maps** | Members as avatar pins with heading arrows, places as geofence circles, long-press to add a place, “Directions” hands off to Apple Maps. |
| **Push notifications** | Arrivals, departures, low battery and circle activity as real iOS notifications. Tapping one opens the right screen. |
| **Security** | Session and device tokens live in the iOS Keychain. Background uploads use a device token that can **only** submit locations. Signing out revokes it. |

Screens: **Map** (live members, places, people strip) · **Member sheet** (where, freshness, speed, battery, accuracy, recent trips) · **People** (circles, sharing toggles, invite via share sheet) · **Trips** (by person, day-grouped, route map + speed) · **Alerts** · **Settings** (sharing, mode, permission, pause, push, units, web app, sign out).

The web app still has a few things the iOS app doesn't yet (history calendar & playback, the full places editor, admin); Settings → *Open web app* gets you there.

## Run it on your iPhone — step by step

You need: a Mac **or** any computer (the builds run in Expo's cloud), an iPhone, and a running Nodara server reachable over **HTTPS** (iOS requires it).

### 0. One-time accounts

1. **Expo account** (free): <https://expo.dev/signup>
2. **Apple Developer Program** ($99 USD / year) — required to install your own build on an iPhone and to publish: <https://developer.apple.com/programs/enroll/>. Enrolment can take a day or two.

### 1. Install and link the project

```bash
cd apps/mobile
npm install
npx eas-cli@latest login          # your Expo account
npx eas-cli@latest init           # creates the Expo project and writes its ID into app.json
```

`eas init` adds `extra.eas.projectId` to `app.json` — commit that change. Push notifications need it.

> **Bundle identifier:** the app uses `ca.nodara.app`. Bundle IDs are global on the App Store, so if that one is taken (or you're publishing your own fork) change `ios.bundleIdentifier` in `app.json` to something you own, e.g. `ca.yourname.nodara`.

### 2. Make a development build and install it

```bash
npx eas-cli@latest device:create                      # register your iPhone (scan the QR code it shows)
npx eas-cli@latest build --profile development --platform ios
```

EAS asks to log in to your Apple account and creates the certificates and provisioning profile for you — say yes to everything. When the build finishes (~10–20 min), open the link on your iPhone and install it. On iOS 16+ you'll need to turn on **Settings → Privacy & Security → Developer Mode** once.

Then start the JavaScript server on your computer and open the app on the phone:

```bash
npx expo start            # scan the QR code with the iPhone camera
```

Edits to the code now appear on your phone instantly.

> Quick look without any build: `npx expo start` and open the QR code in the **Expo Go** app. Maps, tabs and the UI work there, but **background location, geofencing and push do not** — Expo Go only shares location while the app is open.

### 3. Share it with your family (TestFlight)

```bash
npx eas-cli@latest build --profile production --platform ios
npx eas-cli@latest submit --platform ios --latest
```

`submit` uploads the build to App Store Connect (it creates the app record for you on first run). In <https://appstoreconnect.apple.com> → your app → **TestFlight**, add your family as testers by email. They install the **TestFlight** app and get Nodara from there. Builds for testers stay valid for 90 days.

### 4. Publish on the App Store (optional)

In App Store Connect fill in the listing (screenshots, description, privacy policy URL), then **Submit for Review**. Things Apple will look at for a location app:

- **A demo server and account for the reviewer.** Nodara needs a server, so put a working server URL, email and password in *App Review Information → Notes*. `pnpm seed:demo` on that server gives the reviewer a populated map.
- **Background location justification** (guideline 2.5.4). In the notes, explain: “Family members choose to share their location continuously with their own self-hosted server so others in their circle can see where they are and get arrival alerts. Users can pause sharing at any time in Settings.”
- **App Privacy labels.** Location (precise), linked to the user, used for *App Functionality*. Not used for tracking. Data goes to the server the user chooses, not to the developer.
- **Privacy policy URL.** Required. A short page saying data is stored only on the user's own server is enough.

### Shipping updates

- **JavaScript-only changes:** `npx eas-cli@latest update --branch production` ([EAS Update](https://docs.expo.dev/eas-update/introduction/), pushed straight to installed apps).
- **Native changes** (new native module, app.json permissions): build and submit again.

## Server requirements

- Nodara server with this repository's version or newer (`/api/devices/:id/native-push` endpoint).
- HTTPS (iOS App Transport Security blocks plain HTTP).
- Push: the server relays notifications through Expo's push service (`EXPO_PUSH_ENABLED`, on by default). Apple only accepts pushes signed by the app publisher's key, so a self-hosted server can't talk to APNs directly. The relay sees only the notification title and body. Set `EXPO_PUSH_ENABLED=false` to turn it off; the app then shows alerts only while it's open.

## Development

```bash
npm run typecheck   # tsc
npm run lint        # expo lint
npm run doctor      # expo-doctor
npm run bundle:ios  # build the production JS bundle
```

- Routes live in `src/app` (Expo Router). Background tasks are registered in `index.ts` via `src/background/tasks.ts`, before the router loads. iOS relaunches the JS bundle without UI for location and geofence events.
- `ios/` is generated (Continuous Native Generation). Change native settings in `app.json`, never by hand.
- API types are imported (type-only) from `packages/shared` so the app and server stay in sync.
