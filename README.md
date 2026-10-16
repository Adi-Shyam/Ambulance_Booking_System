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

## The five request types

| Code | Means | Dispatch |
|---|---|---|
| `PTV` | Patient transport | Ranked list, one offer at a time |
| `BLS` | Basic life support | Ranked list, one offer at a time |
| `ALS` | Advanced life support | Ranked list, one offer at a time |
| `ICU` | Mobile ICU | Ranked list, one offer at a time |
| `EMG` | **Emergency — send anything** | **Every ambulance in range, all at once** |

`EMG` is deliberately not a vehicle class, and no provider can register as one.
"Emergency" describes what the caller needs, not what is parked outside the
hospital — which is also what makes "offer it to everybody" coherent. Two rules
follow from that:

- **Every class is eligible.** A PTV may not serve an ICU request, because care
  level must never be downgraded. An emergency has no such floor: the nearest
  ambulance is better than the right ambulance later.
- **They are alerted together, not in turn.** The ranked list still decides who
  is asked, but all of them are asked at the same moment and the first to accept
  takes it. The rest have their offer closed and are told why, rather than
  watching a countdown on a job that has gone. `BROADCAST_LIMIT` caps the
  fan-out so one request in a dense area cannot produce hundreds of alerts.

The control room sees the fan-out as what it is — one row per ambulance
alerted, with its rank — rather than as a single mysterious offer.

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

146 tests, no external services required — the suite boots the API on an ephemeral
port against a throwaway database, and the WhatsApp and maps adapters fall back to
their offline paths.

| Level | Suite | Covers |
|---|---|---|
| Unit (76) | `tests/unit/*.test.js` | Fare arithmetic, geodesy, polyline decoding, identifier formats, timezone bucketing, rate-limit windows, data-dictionary validators, gateway signature verification, WhatsApp template parameters |
| Integration (59) | `tests/integration/api.test.js` | Auth and RBAC, the full booking → dispatch → trip → invoice → rating lifecycle, automatic reassignment, privacy, rate limiting, admin reports and the audit trail |
| | `tests/integration/session.test.js` | Session records in D1, listing and ending your own sessions |
| | `tests/integration/alerts.test.js` | That the lifecycle steps nobody is watching the screen for also leave the building as WhatsApp alerts |
| | `tests/integration/otp-register.test.js` | Registering by code, OTP-only accounts setting a first password, and that nobody can make themselves an administrator that way |
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

## Alerts and calling

**Reaching a driver** happens on two levels, and they are worth keeping apart.

A *local* alert is raised by the app itself: a heads-up banner, a sound and a
vibration, scheduled on the device and delivered by the operating system. It
needs no push service, no credentials and no money, and it is what makes a
45-second offer noticeable rather than merely present on a screen nobody is
looking at. It only fires while the app is running, because the socket that
carried the offer dies with the process.

A *push* notification is the only thing that reaches a phone whose app is
closed. On Android that means Firebase Cloud Messaging, and **this build has
no FCM credentials**, so `getExpoPushTokenAsync` fails and nothing is ever
sent. Expo Go works because it carries Expo's own credentials; a built APK
does not. Fixing it needs a Firebase project, its service-account key uploaded
with `eas credentials`, and a rebuild.

Until then the alerts panel says exactly that rather than reporting a flat
failure, and the test button demonstrates the local alert instead.

**Push notifications**, when configured, are the channel that decides whether
a dispatch offer is seen at all — everything else in the app assumes somebody is looking. The socket
needs the app open; the inbox needs the screen on; a driver waiting for work is
doing neither, and an offer expires in 45 seconds.

They go through Expo's push service, which needs no credentials: the device
token is both the address and the authorisation. The app registers on every
sign-in rather than once on install, because a token can rotate and has to
follow whoever is signed in on that handset — and it unregisters on sign-out,
so a shared phone stops delivering the previous driver's offers.

Android decides whether a notification may interrupt by its *channel*, not by
the message, so there are two: `dispatch` can break through Do Not Disturb, and
`default` cannot. Each role's profile screen has a **Send a test alert** button,
because the way this fails is silent — notifications were declined months ago,
nothing looks broken, and offers simply never arrive.

Set `PUSH_MOCK=true` to log and record alerts without calling Expo. The test
suite does this, so running the tests sends nothing.

**Calling** is a handoff to the phone's own dialer, not voice carried in the
app. A crew who cannot find a patient, and a patient watching an ambulance go
past the turning, both need a call that works on a weak signal, with the app in
the background, and without this server being reachable. Carrying voice in-app
would be a worse answer to that problem — which is why the real 108 service,
and every ride-hailing app, does the same thing.

What the server owes them is the number, and `POST /api/bookings/:id/call`
releases it only between the two parties of a live booking and writes every
release to the audit trail (C.5). Number masking through a relay provider would
be the production refinement; it needs a paid Indian number.

## Deploying to Render

Deploying is worth doing for a reason beyond tidiness: it ends the LAN-address
problem. With the API on a fixed public URL the APK no longer has to be told
which Wi-Fi it is on, and a demonstration stops depending on two phones and a
laptop sharing a network.

`render.yaml` in the repository root is a Render blueprint. Push it, then in the
Render dashboard choose **New → Blueprint** and point it at this repository.
Render reads the file and creates the service; set `BREVO_API_KEY` in the
dashboard rather than in the file, which is in version control.

The service is deployed at:

```
https://ambulance-booking-api.onrender.com
```

`mobile/app/eas.json` already points the `apk-hosted` profile at it, so the
installable build is:

```bash
eas build --platform android --profile apk-hosted
```

The `apk-lan` profile is still there for working offline against a laptop on
the same network. It is rarely needed now: the hosted APK can be pointed at a
LAN address from the sign-in screen at runtime, which is the whole reason that
setting exists.

Two things about the free plan to know before demo day, neither of which is a
fault in the code:

- **The filesystem is ephemeral.** It is rebuilt on every deploy and every wake
  from idle, and the SQLite file goes with it. The app seeds itself on boot so
  it always comes back usable — fare rules, demo accounts, an administrator —
  but bookings made before a restart will not be there. To keep data, move to a
  paid instance and uncomment the disk block in `render.yaml`; the database path
  already comes from the environment, so no code changes.
- **The service sleeps after 15 minutes idle**, and the next request waits
  roughly 50 seconds while it wakes. Open the `/health` URL a minute before
  presenting and it will be warm.

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

**Email** — a verification code can travel by email instead of WhatsApp: the
sign-in screen offers the choice, and `POST /api/auth/otp/request` takes
`"channel": "EMAIL"`. The mobile number is still what identifies the account —
the data dictionary makes `phone_no` NOT NULL UNIQUE, and a crew who cannot find
the patient has to be able to ring them — so email chooses the postman, not the
identity.

Leave `EMAIL_HOST` empty for the mock transport, which logs the code and writes
the same `messages` row. For real delivery with Gmail: turn on 2-step
verification, create an App Password at `myaccount.google.com/apppasswords`, and
use it as `EMAIL_PASS` — a normal Google password will not authenticate over
SMTP.

Email is worth knowing about because it is the only channel with no conditions
attached: no 24-hour window, no template approval, and no billing relationship.
Where a business-initiated WhatsApp message needs all three, an email needs none.

**Maps** — three separate things, worth keeping apart:

| | Supplier | Key needed | Runs on |
|---|---|---|---|
| Geocoding (address → point) | Nominatim | no | backend |
| Routing (road line, ETA) | OSRM | no | backend |
| Tiles (the picture) | MapTiler | yes, client-side | app |

Only the tiles need a key, and it is a *client-side* key: it travels in the
tile URL by design, and MapTiler restricts it by origin in their dashboard
rather than by keeping it secret. Set `EXPO_PUBLIC_MAPTILER_KEY` to use it;
leave it empty and the map falls back to OpenStreetMap's own tiles, which work
and look plainer.

Nominatim and OSRM need no key. Set `MAPS_PROVIDER=google` with a `GOOGLE_MAPS_API_KEY` to switch to
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

### Building on this machine instead of EAS

EAS builds in the cloud and queues behind other people's jobs, which on the
free plan has meant anything from ten minutes to an hour. A local build takes
three to five once the toolchain is warm.

```powershell
cd mobile/app
.uild-apk.ps1                                    # against the deployed API
.uild-apk.ps1 -ApiUrl http://192.168.1.17:4000   # against a laptop on the LAN
.uild-apk.ps1 -Clean                             # after changing app.json
```

It regenerates `android/` with `expo prebuild` each time rather than trusting
what is there. That directory is build output - gitignored, and rebuilt from
`app.json` - so regenerating means a change to a permission or a plugin cannot
be silently missed.

What it needs, once:

| | |
|---|---|
| JDK 17 | `java -version` |
| Android SDK | platforms 35 & 36, build-tools 35.0.0 & 36.0.0, platform-tools |
| Licences | `sdkmanager --licenses` |

Install the SDK with the command-line tools from
[developer.android.com](https://developer.android.com/studio#command-tools),
unzipped so that `sdkmanager.bat` sits at
`%USERPROFILE%\Android\Sdk\cmdline-tools\latestin`. Gradle downloads
itself on the first build, which is why that one takes far longer than the
rest.

**Which to use.** A local build is signed with the debug keystore - the React
Native default, and a key whose password is published. It installs and runs,
which is all an iteration needs. The APK you actually hand to somebody should
come from EAS, which holds the project's own release keystore, so each build
installs over the last.

Mixing the two means uninstalling first: Android refuses to replace an app
with one signed by a different key, and that refusal is the point of signing.

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

## Digital Brand Identity Manual

The interface follows the Government of India's Digital Brand Identity Manual
(DBIM v3, MeitY, January 2025), which applies to government mobile apps
through Annexure D.

| DBIM | Applied |
|---|---|
| 2.1 One primary colour group | **Cinnamon Red** — the manual asks for the group that best represents the organisation's function |
| 2.2 Functional palette | `#FFFFFF` background, `#150202` text, Linen `#EBEAEA`, greys `#C6C6C6`/`#8E8E8E`/`#606060` |
| 2.2 Status colours | `#198754` success, `#FFC107` warning, `#DC3545` error, `#0D6EFD` information and links |
| 4.1 Typeface | **Noto Sans**, bundled in all four weights |
| 4.3.2 Mobile type scale | H1 24, H2 20, H3 16, body 14, small 13, tiny 12 |
| D.1.5 Contact | the About panel names the team on every role's profile |

This replaced a dark theme. DBIM mandates Inclusive White as the page
background with dark text and describes no dark variant, so complying meant
inverting the design rather than adjusting it. Everything flowed through
`src/lib/theme.js`, which is what made that a single edit rather than a sweep.

**Not met, and worth saying so rather than implying otherwise:** icons are
emoji, where section 3 asks for the DBIM toolkit set in PNG/SVG/WEBP at
24/32/48/64 px. Annexure D also requires NSSO (MeriPehchaan) single sign-on, a
CERT-IN security audit, the Central Content Publishing System APIs and hosting
on the Gov.In App Store — none of which a course project can obtain.

## Notes on scope

- The app uses Leaflet in a WebView for maps rather than `react-native-maps`, so it
  runs in plain Expo Go with no Google Maps key and no custom dev build.
- Location is reported while the app is in the foreground. Background tracking needs
  a development build and the `expo-location` background permission.
- Push notifications go over the Socket.IO channel. Adding Expo push tokens would
  extend this to notifications when the app is closed.
