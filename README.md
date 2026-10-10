# Ambulance Booking System

Implementation of the SRS, DFD model and data dictionary prepared by **Team 16** —
Adithya Shyam D (241IT005), Dev Patel (241IT023), Ritesh Bhagat (241IT063) —
Department of Information Technology, NITK Surathkal.

A patient requests an ambulance, the backend ranks and offers the job to the nearest
suitable driver over WhatsApp and in-app push, the driver accepts and runs the trip
while the patient watches it move on a map, and the control room supervises the whole
fleet.

```
                    ┌──────────────────┐
   Patient app ───▶ │                  │ ◀─── Driver app
   (React Native)   │   REST + Socket  │      (React Native)
                    │     backend      │
   Control room ──▶ │   Node + SQLite  │ ───▶ WhatsApp Cloud API
   (React + Vite)   └──────────────────┘      Maps (OSM / Google)
                                              Payment gateway
```

## What is in this repository

| Folder | What it is | Runs on |
|---|---|---|
| `backend/` | REST API, Socket.IO channel, dispatch engine, database | Node ≥ 22.5 |
| `mobile/app/` | The app — patient, driver and control room in one | Expo (Android, and web) |
| `docs/` | Requirement traceability, API reference, test plan, and the source SRS | — |

All three roles are one application. Sign-in opens on a mode chooser — **Book an
ambulance**, **Drive an ambulance**, **Control room** — and the chosen mode is
checked against the account the credentials belong to, which is requirement F.2.
One codebase, one APK, and because Expo also builds for web, the same code
serves the control room on a laptop.

## Quick start

Two terminals. Start the backend first — the app talks to it.

**1. Backend**

```bash
cd backend && npm install && cp .env.example .env && npm run seed && npm start
```

Serves `http://localhost:4000`. `npm run seed` creates the demo accounts listed below.

**2. The app**

```bash
cd mobile/app && npm install && npx expo start
```

Scan the QR code with Expo Go, press `a` for an Android emulator, or `w` to open
it in a browser — that last one is how you run the control room on a big screen.

### Demo accounts

Each signs in under the mode named beside it.

| Role | Mobile | Password | Mode |
|---|---|---|---|
| Administrator | `9000000001` | `admin123` | Control room |
| Patient | `9800000001` | `user123` | Book an ambulance |
| Patient | `9800000002` | `user123` | Book an ambulance |
| Driver — ALS | `9700000002` | `driver123` | Drive an ambulance |
| Driver — ICU | `9700000003` | `driver123` | Drive an ambulance |
| Driver — PTV | `9700000004` | `driver123` | Drive an ambulance |
| Driver — unverified | `9700000006` | `driver123` | Shows the verification gate |

Choosing the wrong mode is refused with the role the account actually holds,
rather than signing you into a console you cannot use.

### Connecting a real phone

A phone cannot reach `localhost` — that is the phone itself. Under Expo Go the
app reads the LAN address Expo already knows and points at port 4000
automatically, so on the same Wi-Fi this usually just works.

When it does not — a packaged APK, or a network Expo cannot infer — the sign-in
screen reports the address it is using and lets you change it:

```
Backend: http://192.168.1.20:4000              Change
```

The value is stored on the device, so this is a one-time twenty seconds per
network rather than a rebuild. See
[Pointing the app at your backend](#pointing-the-app-at-your-backend).

> **Two devices for a full demonstration.** One app means one signed-in session
> per device, so showing a booking reach a driver needs two surfaces — a phone
> as the driver and the browser build as the patient, or two phones.

## A five-minute demonstration

Run the app twice — a phone in **Drive an ambulance** and a browser in **Book an
ambulance** — with a third window in **Control room** if you have the screen.

1. **Control room** → *Providers*: the ALS driver is `VERIFIED`, Priya Rao is
   `PENDING`. Verify her and watch the driver's console unlock instantly, with
   no reload.
2. **Driver**: sign in as `9700000002`, toggle **On duty**. The control room's
   *Fleet map* shows the vehicle turn green and start reporting position.
3. **Patient**: sign in as `9800000001`, pick **ALS**, confirm the pin, send the
   request.
4. **Driver**: the offer appears with a 45-second countdown; the backend console
   prints the WhatsApp alert that would have been sent. Accept it.
5. **Patient**: the ambulance appears on the map with a live ETA that updates as
   the driver's position changes.
6. **Driver**: step through *On the way* → *Arrived* → *On board* → *Complete*.
   Each tap lands in the patient's app and the control room immediately.
7. **Patient**: pay the invoice and leave a rating.
8. **Control room** → *More* → *Reports*: response time, demand, revenue and
   provider performance now include this trip. *Audit trail* shows every step
   that was taken.

On a real phone the odometer accumulates between *On board* and *Complete*, so
the invoice carries a genuine distance charge. In a browser, where geolocation
is usually denied, the driver never moves and the billed distance is correctly
zero — the fare falls back to base plus surcharge plus tax.

To see automatic reassignment (F.7): put two drivers on duty, book, and **decline**
the first offer — the request moves to the next-best ambulance on its own. Ignoring
the offer for 45 seconds does the same thing.

## How the dispatch engine works

`backend/src/services/dispatch.js` is the heart of the system.

1. **Rank** (F.5) — providers that are `AVAILABLE`, `VERIFIED`, within the search
   radius and capable of the requested care level are scored out of 100:
   proximity 60, rating 25, exact type match 15. A higher-capability ambulance may
   serve a lower-tier request; the reverse is never allowed.
2. **Offer** (F.6) — the top candidate gets an in-app push *and* a WhatsApp message,
   in parallel. The offer carries a hard 45-second expiry.
3. **Resolve** (F.7) — accept confirms the assignment and opens a trip; decline or
   timeout marks the assignment and immediately offers the request to the next
   candidate. After 5 attempts the booking is marked `FAILED` and the patient is told.

Timers are re-armed on restart, so a server bounce mid-offer does not strand a request.

## Tests

```bash
cd backend && npm test
```

137 tests, no external services required — the suite boots the API on an ephemeral
port against a throwaway database, and the WhatsApp and maps adapters fall back to
their offline paths.

| Level | Suite | Covers |
|---|---|---|
| Unit (76) | `tests/unit/*.test.js` | Fare arithmetic, geodesy, polyline decoding, identifier formats, timezone bucketing, rate-limit windows, data-dictionary validators, gateway signature verification, WhatsApp template parameters |
| Integration (50) | `tests/integration/api.test.js` | Auth and RBAC, the full booking → dispatch → trip → invoice → rating lifecycle, automatic reassignment, privacy, rate limiting, admin reports and the audit trail |
| | `tests/integration/session.test.js` | Session records in D1, listing and ending your own sessions |
| System (11) | `tests/system/recovery.test.js` | Recovery sweep, availability consistency, reporting calendar, batch list queries |

Run one level at a time with `npm run test:unit`, `test:integration` or `test:system`;
`npm run test:report` regenerates [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md) from an
actual run.

### Checking a running system

`npm test` is self-contained and never touches your database. To check a system that
is actually up — after `npm start`, or against a deployment — run:

```bash
cd backend && npm run smoke
```

It signs in as the seeded driver, patient and administrator and walks one request
end to end: on duty → book → offer → accept → the four milestones → invoice →
payment → rating, asserting the role gate, the privacy rule and the milestone
ordering along the way. It puts the driver back off duty when it finishes, but it
does leave its booking behind — run it against a demo database, not a real one.

Several are regression tests pinning defects found after the first build: the fare
being computed from the wrong distance field, the billed distance being taken from
the driver's own request, an unauthorised socket subscription exposing live GPS, and
unlimited credential guessing.

## What happens when things go wrong

The offer timer covers a driver who never answers. A driver who answers and then
disappears — dead phone, killed app, no signal — is a different failure, and NF.1
says a request must not be left unserved. A recovery sweep runs every minute:

| Condition | Action |
|---|---|
| Marked available but no position reported for 15 min | Taken off duty, driver notified, recorded in the audit trail |
| Accepted trip with no contact for 10 min | Patient and control room told; the booking is flagged, **not** cancelled |
| Booking stuck `MATCHING` with no offer outstanding | Offered to the next candidate, or failed and the patient told |

A stalled trip is deliberately not auto-cancelled. A silent phone does not prove
the ambulance is not on its way, and cancelling a live emergency run would be worse
than the silence — so the sweep raises it for an operator instead of deciding.

"Available" is defined once, in `services/availability.js`, and used by the matcher,
the control-room counts and the patient's nearby-ambulance list alike. Before that,
the dashboard could report ambulances free that the dispatcher would never have
considered; it now reports those separately as *not reporting*.

## Reporting calendar

Timestamps are stored in UTC, as the data dictionary specifies. Analytics, though,
are read by a control room in one civil timezone, so day and hour buckets are
shifted by `REPORT_UTC_OFFSET` (default `+05:30`). Grouping on the raw UTC string
filed every call between 00:00 and 05:29 IST under the previous day and shifted the
demand curve by five and a half hours.

## How the fare is measured

`route_distance_km` on a trip is the **remaining** road distance to the current
target, refreshed on every GPS ping — it is a tracking figure and is near zero on
arrival, so it must never be billed.

Billing instead uses an odometer the server accumulates from the GPS trace itself.
Each ping adds the distance from the previous fix, with two guards: hops under 20 m
are treated as a stationary GPS drifting, and hops over 5 km as a signal that
dropped and reacquired rather than distance driven. Two totals are kept —
`distance_travelled_km` for the whole trip, and `laden_distance_km` for the leg
between `ONBOARD` and `COMPLETED`, which is the one the invoice charges for.

The figure is never read from the request body. The device being paid does not get
to state the amount.

Because it sums straight-line hops between fixes, the odometer slightly under-reads
true road distance, and the gap narrows as the ping interval shortens.

## Configuration

Everything is driven by `backend/.env` (see `.env.example` for the full list).

**WhatsApp** — leave `WHATSAPP_TOKEN` empty and the system uses a mock transport:
messages are stored in the `messages` table and printed to the console, so the whole
flow is demonstrable without a Meta business account. Set `WHATSAPP_TOKEN` and
`WHATSAPP_PHONE_NUMBER_ID` and the same code path sends through the WhatsApp Business
Cloud API. Either way the *Alert log* page shows what was sent.

There are two levels of "really sending", because Meta only accepts free-form
text inside the **24-hour customer service window** — that is, to someone who
messaged you first:

| | What you need | `WHATSAPP_USE_TEMPLATES` |
|---|---|---|
| **Demo** | Meta test number, a token, and up to 5 allow-listed recipients. Message the test number from the phone first to open the window. | `false` |
| **Production** | Business verification, a dedicated number, and approved templates. | `true` |

A dispatch alert to a driver is business-initiated and almost never inside that
window, so production must send templates. Each builder in `services/messaging.js`
returns both forms of its message — the readable `body` and the ordered `params`
for the template of the same name — so switching is a configuration change, not
a code change. Template parameters cannot contain newlines, which is why the
layout belongs in the approved template and each parameter is a flat value.

**Maps** — defaults to OpenStreetMap: Nominatim for geocoding, OSRM for routing, no
API key required. Set `MAPS_PROVIDER=google` with a `GOOGLE_MAPS_API_KEY` to switch to
the Google Geocoding and Directions APIs. If a provider is unreachable the system
falls back to straight-line distance and an average-speed ETA rather than failing the
dispatch (constraint C.2).

**Payments** — `mock` simulates a gateway; `razorpay` with keys creates real orders.
Cash-on-completion is always available.

**Database** — SQLite through Node's built-in `node:sqlite`, so there is no native
build step and nothing to install. The schema in `backend/src/db/schema.sql` is plain
relational SQL and ports to PostgreSQL or MySQL by changing only `AUTOINCREMENT`.

## Requirement coverage

Every functional requirement in the SRS is implemented. See
[docs/TRACEABILITY.md](docs/TRACEABILITY.md) for the requirement → code map and
[docs/API.md](docs/API.md) for the endpoint reference.

| | Requirement | Where |
|---|---|---|
| F.1 | Registration and authentication | `routes/auth.js` |
| F.2 | Role-based login | `middleware/auth.js` |
| F.3 | Select type and place booking | `routes/bookings.js` |
| F.4 | Capture pickup location | `services/maps.js` |
| F.5 | Match nearest ambulance | `services/dispatch.js` |
| F.6 | Notify driver via WhatsApp | `services/messaging.js` |
| F.7 | Accept / reject with reassignment | `services/dispatch.js` |
| F.8 | Live tracking and ETA | `routes/provider.js`, `routes/bookings.js` |
| F.9 | Trip status updates | `routes/provider.js` |
| F.10 | Payment and billing | `services/fare.js`, `routes/payments.js` |
| F.11 | Booking history | `routes/bookings.js`, `routes/provider.js` |
| F.12 | Rating and feedback | `routes/bookings.js` |
| F.13 | Administrative management | `routes/admin.js` |
| F.14 | Notifications and alerts | `services/notifications.js` |

Data stores D1–D5 map onto the tables documented at the top of
`backend/src/db/schema.sql`. Constraint C.5 (audit) is the `audit_log` table, written
by `audit()` on every booking, dispatch decision, status change and admin action.

## Building the Android app

`mobile/app/` is one Expo project serving all three roles, so one APK covers
patients, drivers and the control room — the mode is chosen at sign-in.

```bash
cd mobile/app
npx eas-cli login          # a free Expo account; first time only
npx eas-cli build --platform android --profile apk-lan
```

EAS builds in the cloud and returns a download link. Install it on the phone the
way you would any APK — allow installation from unknown sources, tap the file.
No Google Play account is involved.

### Pointing the app at your backend

A packaged APK has no dev server to ask for the LAN address, so it starts from
whatever `EXPO_PUBLIC_API_URL` was set to at build time. That value is only a
**default**: the address is a stored setting, so one APK works on any network.

On the sign-in screen, the line reporting where requests go is tappable:

```
Backend: http://192.168.1.20:4000              Change
```

Tap **Change**, type the new address, save. It is kept on the device and
survives restarts, and *(changed)* appears next to it while an override is in
effect. **Back to the built-in address** restores the compiled-in default.

That setting lives on the sign-in screen deliberately — it is the only screen
reachable when the address is wrong, since nothing else works until a request
succeeds. A bare `host:port` is enough; `http://` is assumed.

So after moving to a new network you only need `ipconfig` on the laptop and
twenty seconds on the phone. No rebuild.

The two profiles in [`eas.json`](mobile/app/eas.json) just choose the starting
default:

| Profile | Default points at | Use when |
|---|---|---|
| `apk-lan` | your laptop on the local network | demoing with the backend on your machine |
| `apk-hosted` | a deployed backend over HTTPS | a backend with a fixed address |

Android blocks plain HTTP by default, so `usesCleartextTraffic` is set in
`app.json` for the `apk-lan` case. A hosted HTTPS backend does not need it.

iOS is out of scope: Apple requires a paid Developer Program membership to
install an app on a device at all, and the build itself needs macOS. The same
code runs on an iPhone through Expo Go if you ever want to show it.

## Notes on scope

- The mobile apps use Leaflet in a WebView for maps rather than `react-native-maps`,
  so they run in plain Expo Go with no Google Maps key and no custom dev build.
- Location is reported while the app is in the foreground. Background tracking needs
  a development build and the `expo-location` background permission.
- Push notifications go over the Socket.IO channel. Adding Expo push tokens would
  extend this to notifications when the app is closed.
