# Background location: what the web app can and cannot do

Nodara's first release is a Progressive Web App. Browsers deliberately restrict location access to protect users, and we don't hide that.

## What works

- **While Nodara is open and on screen**, the app watches your position and sends updates every 5–60 s (adaptive: more often while moving, less while still). Battery level is included where the browser exposes it (Chrome/Android; not iOS).
- **Offline queue:** if the connection drops, fixes are kept on the device (up to 2 000) and uploaded when you're back online.
- **Keep screen awake:** optional Screen Wake Lock (Android Chrome, iOS 16.4+) keeps Nodara in the foreground during a drive.
- **Push notifications** arrive even when Nodara is closed (on iOS only after installing to the Home Screen, iOS 16.4+).

## What doesn't

| Platform | Behaviour when Nodara is not in the foreground |
|---|---|
| iPhone / iPad (Safari or installed PWA) | Location updates **stop** immediately. |
| Android (Chrome / installed PWA) | Updates continue briefly, then the browser throttles and stops them. |
| Desktop | Works while the tab is open; most laptops have coarse Wi-Fi location. |

Service workers have no geolocation access, and the Background Geolocation APIs that would make this possible don't exist on the web. **Geofences can't be monitored in the background by a browser either**, so arrival/departure alerts for web-only users depend on them opening the app.

## How Nodara stays honest about it

- Every location shows how old it is; anything older than 15 minutes is greyed and labelled **last known location** with the time it was recorded. Nothing old is shown as live.
- The sharing indicator says **Paused in background** when the page is hidden.
- Device-offline notifications tell you (and opted-in circle members) when a device stopped reporting.
- Trips recorded from sparse data are flagged **low confidence**.

## Getting reliable background sharing today

Use a native open-source tracker that posts to your Nodara server — see [clients.md](clients.md):

- **OwnTracks** (iOS & Android)
- **Overland** (iOS)

## The plan

Native Nodara apps for iOS and Android will use the platform background-location and region-monitoring APIs and post to the same `/api/locations` endpoint with device tokens. The server, data model and API are already designed for this; no server changes are needed. See the [roadmap](roadmap.md).
