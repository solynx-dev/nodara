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
| **Map-first, one screen** | Everything happens on the map: a draggable sheet (People · Places) snaps between peek, half and full with spring physics. Drag the header *or the list itself*; at full height the list scrolls, and pulling down from its top brings the sheet back down. The floating Check-in and map buttons are part of the sheet, so they ride on top of it and fade out as it expands. |
| **Liquid Glass** | Top bar, circle switcher, sheet, floating buttons, sharing banner and toasts are drawn with `expo-glass-effect` (real Liquid Glass on iOS 26, system blur on older iOS). The sheet fades to a solid background at full height so long lists stay readable. |
| **Profiles** | Tap anyone to open their profile in the sheet while the map follows them: where they are, **how long they've been there** (“Here for 3 h 12 min · since 7:32 PM”), battery, last update and accuracy, then **Drives** (last 7 days chart and totals, every drive grouped by day, “Show older drives”) and **History** (stays and trips for any of the last 7 days). |
| **Profile photos** | Take or choose a photo (cropped to a square and shrunk to 512 px on the phone). It shows on the map, in lists and in profiles, for people in your circles only. Pick a colour for when there's no photo. |
| **Readable status everywhere** | Every person is described the same way: where they are (“At Home”, “Near 12 King St”), how long (“Here for 3 h”), and a coloured status (*Live*, *Driving · 54 km/h*, *Updated 2 h ago*, *Last seen yesterday*). The circle header summarises everyone (“2 at a saved place · 1 on the move”). |
| **Places** | Tap a place (or long-press the map to add one) to edit it: move the map under the pin to reposition it, drag the slider to size the zone (50 m – 2 km), rename it, pick an icon and colour, choose which circle sees it, search for an address, or delete it. **Get notified when…** lets you pick, per person, whether you hear about them arriving, leaving, or both. Circle admins can edit everyone's places; anyone can choose their own alerts. |
| **Weekly driving reports** | For each week: speeding (over 130 km/h / 80 mph), phone use while moving, rapid acceleration and hard braking, with trends against last week, top speed, drives and distance, for everyone in the circle. Each profile shows the person's week, and each trip's map marks where events happened. |
| **Speed on the map** | While someone is driving, their speed shows next to their photo; over 130 km/h (80 mph) their pin turns red. |
| **Phone-use detection** | A tiny native module (`modules/phone-use`) records when the iPhone is unlocked, which iOS reports to Nodara while it's sharing location in the background. Times are uploaded with locations, and the server only counts the ones that happened while moving. Needs a passcode on the phone. |
| **Settings & circles** | A profile card with your week at a glance, a sharing health check, accuracy mode, per-circle management (members, roles, invitations, what members can see, leave/delete), notification types, units and default map style, your devices, and account links. |
| **Know when you're not sharing** | A banner (and the Settings health card) appears when this iPhone is paused, not sharing, or only sharing while open, with a one-tap fix. |
| **Apple Maps** | Pins are people's photos (or initials) and scale with zoom: a photo with a short label up close (“You · Home, 1 day”), a smaller photo at city level, and a small icon when zoomed out. People whose pins would overlap merge into one group pin; tap it to zoom in, or pick someone if they're in the same spot. Places show as geofence circles. Long-press to add a place, and tap empty map to deselect. |
| **Check in** | Sends your current location and notifies your circle (“Alex checked in at Home”), with an optional message. |
| **Push notifications** | Arrivals, departures, low battery and circle activity as real iOS notifications. Tapping one opens the right screen. |
| **Security** | Session and device tokens live in the iOS Keychain. Background uploads use a device token that can **only** submit locations. Signing out revokes it. |

Layout:

- **Home (map):**
  - Top glass bar: Settings · circle switcher (animated glass menu: switch circle, invite, new circle) · Alerts with an unread badge.
  - Above the sheet: *Check in*, map style menu, and recenter.
- **Sheet:**
  - **People:** avatar cards with battery level, place/address and “Since 7:32 PM”.
  - **Places:** who's there now, add a place.
  - **Trips:** per person, grouped by day.
  - **Person detail:** freshness, speed and heading, battery, accuracy, directions and recent trips.
- **Pushed pages:**
  - **Trip report:** route map and speed bars.
  - **Alerts.**
  - **Settings:** sharing, mode, permission, pause, per-circle sharing, push, units, web app, sign out.

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

Build and upload in one go:

```bash
npx eas-cli@latest build --platform ios --profile production --auto-submit
```

The first run asks you to sign in with your Apple ID and lets EAS create the certificates, the provisioning profile and the push key (say yes to all). The upload also creates the app in App Store Connect; if the name "Nodara" is taken there, pick another, such as "Nodara Family". The build takes about 15–30 minutes, and Apple processes it for another 5–15 minutes.

Then, in <https://appstoreconnect.apple.com> → your app → **TestFlight**:

- **Internal testing** (instant): add yourself, or anyone you've added under *Users and Access*. No review.
- **External testing** (for family without App Store Connect accounts): create a group, add the build, and invite people by email or with a public link. The first build needs a short Beta App Review, usually within a day.

Testers install the **TestFlight** app and get Nodara from there. Builds stay valid for 90 days. Export compliance is pre-answered in `app.json`, so builds don't wait on that question.

### 4. Publish on the App Store (optional)

In App Store Connect fill in the listing (screenshots, description, privacy policy URL), then **Submit for Review**. Things Apple will look at for a location app:

- **A demo server and account for the reviewer.** Nodara needs a server, so put a working server URL, email and password in *App Review Information → Notes*. `pnpm seed:demo` on that server gives the reviewer a populated map.
- **Background location justification** (guideline 2.5.4). In the notes, explain: “Family members choose to share their location continuously with their own self-hosted server so others in their circle can see where they are and get arrival alerts. Users can pause sharing at any time in Settings.”
- **App Privacy labels.** Location (precise), linked to the user, used for *App Functionality*. Not used for tracking. Data goes to the server the user chooses, not to the developer.
- **Privacy policy URL.** Required. A short page saying data is stored only on the user's own server is enough.

### Shipping updates

- **JavaScript-only changes:** `npx eas-cli@latest update --branch production` ([EAS Update](https://docs.expo.dev/eas-update/introduction/), pushed straight to installed apps).
- **Native changes** (new native module, app.json permissions): build and submit again.

## iPhone only

`supportsTablet` is `false`, so the app is iPhone-only: App Store Connect doesn't ask for iPad screenshots, and iPad owners can still install it and run it in iPhone mode. Turn it on once there's an iPad layout to show.

## Default server

The first screen is pre-filled with `EXPO_PUBLIC_DEFAULT_SERVER` from the build profile's `env` in `eas.json` (currently `nodara.ca`). People can still type any other server. If you publish your own build for a different server, change it there; remove it to start with an empty field. It's baked in when the app is built, so changing it needs a new build (or an EAS Update).

## Server requirements

- Nodara server with this repository's version or newer (`/api/devices/:id/native-push`, `/api/checkins`, `/api/me/avatar` and the `stay` field on live members). Older servers still work, but photos and "here for" times won't show.
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
