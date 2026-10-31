# Location clients

Every client sends locations through the same ingestion pipeline (validation → speed filtering → storage → live broadcast → geofences → trip detection). Today there are three ways to share a location:

| Client | Background tracking | Setup |
|---|---|---|
| **Nodara web app / PWA** | Foreground only (see [background-location.md](background-location.md)) | Tap **Start sharing** |
| **OwnTracks** (iOS, Android) | ✅ Yes | Device token, HTTP mode |
| **Overland** (iOS) | ✅ Yes | Device token in the receiver URL |
| Custom / future native apps | ✅ (native) | Device token + `POST /api/locations` |

Create a device token in **Settings → Devices → Connect an app**. Tokens can **only submit locations** — they cannot read anything — and can be revoked or rotated at any time. The token is shown once.

> Always use HTTPS: tokens and locations would otherwise travel in clear text.

## OwnTracks

1. Install OwnTracks ([iOS](https://apps.apple.com/app/owntracks/id692424691) / [Android](https://play.google.com/store/apps/details?id=org.owntracks.android)).
2. In Nodara: **Settings → Devices → Connect an app → OwnTracks**.
3. In OwnTracks → Preferences → Connection:
   - **Mode:** HTTP
   - **URL:** `https://your-nodara/api/ingest/owntracks`
   - **Authentication:** on — **Username:** your email (any value works), **Password:** the device token
4. Choose a monitoring mode (*Significant* is battery-friendly; *Move* gives detailed trips).

Nodara reads OwnTracks `location` messages (`lat`, `lon`, `tst`, `acc`, `alt`, `vac`, `vel` in km/h, `cog`, `batt`, `bs`) and replies with an empty JSON array.

## Overland (iOS)

1. Install [Overland](https://overland.p3k.app/).
2. In Nodara: **Settings → Devices → Connect an app → Overland**.
3. In Overland → Settings → **Receiver Endpoint**: paste `https://your-nodara/api/ingest/overland?token=<device token>`.

Overland batches GeoJSON points; Nodara accepts up to 1000 per request and de-duplicates retries.

## Custom clients and native apps

```http
POST /api/locations
Authorization: Bearer ndd_xxxxxxxxxxxxxxxxxxxxxxxx
Content-Type: application/json

{
  "locations": [
    {
      "recordedAt": "2026-10-31T14:03:22.120Z",   // ISO-8601 or epoch (s or ms)
      "lat": 44.6488, "lon": -63.5752,
      "accuracy": 8,          // metres (horizontal)
      "altitude": 21, "altitudeAccuracy": 4,
      "speed": 12.4,          // m/s from GNSS, if available
      "heading": 91,          // degrees
      "battery": 64,          // percent
      "charging": false,
      "activity": "automotive"
    }
  ]
}
```

Response:

```json
{ "accepted": 1, "rejected": 0, "duplicates": 0, "latest": { … }, "hint": { "nextIntervalSec": 10 } }
```

- Send batches (≤ 1000) when offline; duplicates (same device + timestamp) are ignored, so retries are safe.
- Fixes more than 5 minutes in the future are rejected.
- `hint.nextIntervalSec` is a suggestion for adaptive tracking (shorter while moving).
- Signed-in apps can use a session token instead: `POST /api/auth/login` with `"client": "native"` returns a bearer token; then include `"deviceId"` in the body.

See [api.md](api.md) for the full API.
