# Requirement traceability

Maps the SRS, the DFD process model and the data dictionary onto the code, so each
specification item can be checked against its implementation.

## Functional requirements

| SRS | Requirement | DFD process | Implementation | Client surface |
|---|---|---|---|---|
| F.1 | Registration, OTP verification and password recovery | 0.1.1 Register & Verify OTP | `backend/src/routes/auth.js` — `/register`, `/otp/request`, `/otp/verify`. A code proves one contact detail; registration proves an **email address**, since an address can be proved at no cost while a number needs a paid SMS gateway. `users.email_verified` / `phone_verified` record which has actually been checked. | `AuthScreen` OTP tab asks only for an address; the number is collected at sign-up as crew contact |
| F.2 | Role-based login | 0.1.2 Authenticate Credentials, 0.1.3 Create Session & Assign Role | `routes/auth.js` `/login`, `middleware/auth.js` `requireRole` | Mode chosen per app; dashboard is ADMIN-only |
| F.3 | Select ambulance type and place booking | 0.2.1 Capture Type & Pickup, 0.2.3 Create Booking Record | `routes/bookings.js` `POST /api/bookings` | `BookScreen` |
| F.4 | Capture pickup location | 0.2.2 Resolve & Validate Location | `services/maps.js`, `routes/geo.js` | GPS, map pin, address search |
| F.5 | Match nearest available ambulance | 0.3.1 Find & Rank Providers | `services/dispatch.js` `findCandidates`; an `EMG` request clears the tier floor so every class is eligible | Emergency option on `BookScreen` |
| F.6 | Notify driver via WhatsApp | 0.3.2 Notify Provider & Await Reply | `services/messaging.js`, `dispatch.offerNext` / `alertCandidate`; an `EMG` request alerts every candidate at once, first accept wins | Driver `DutyScreen` with a broadcast badge; dashboard *Alert log* |
| F.7 | Accept or reject a request | 0.3.2, 0.3.3 Confirm Assignment | `dispatch.acceptOffer` / `rejectOffer` / `timeoutOffer` | Driver offer card with countdown |
| F.8 | Live tracking and ETA | 0.4.2 Calculate ETA & Route | `routes/provider.js` `/location`, `routes/bookings.js` `/track` | Patient `TrackScreen`; dashboard *Fleet map* |
| F.9 | Trip status updates | 0.4.1 Receive GPS & Status, 0.4.3 Publish Status & Alerts | `routes/provider.js` `/trips/:id/status` | Driver `TripScreen` → patient milestone trail |
| F.10 | Payment and billing | 0.5.1 Calculate Fare, 0.5.2 Process Payment | `services/fare.js`, `services/payments.js`, `routes/payments.js` | Patient `BookingDetailScreen` |
| F.11 | Booking history and records | 0.5.3 Record History & Feedback | `GET /api/bookings`, `GET /api/provider/trips` | `HistoryScreen`, `EarningsScreen` |
| F.12 | Rating and feedback | 0.5.3 Record History & Feedback | `routes/bookings.js` `POST /:id/rating` | Star rating on a completed trip |
| F.13 | Administrative management | 0.6.1 Verify & Manage Providers, 0.6.2 Monitor Bookings, 0.6.3 Reports & Analytics | `routes/admin.js` | Whole dashboard |
| F.14 | Notifications and alerts | 0.3.2, 0.4.3, 0.6.3 | `services/notifications.js`, `messaging.js`, `push.js` | In-app inbox, WhatsApp, email, and Expo push for a closed app; `AlertSettings` to verify delivery |

## Data stores

| Store | Contents per the DFD | Tables |
|---|---|---|
| D1 | User account and role data | `users`, `organisations`, `otps`, `sessions` |
| D2 | Availability and vehicle data | `providers` |
| D3 | Booking and assignment | `bookings`, `assignments` |
| D4 | Trip status and location | `trips`, `trip_locations` |
| D5 | Payments, invoices and ratings | `invoices`, `ratings` |

Supporting tables outside the DFD: `messages` (delivery log for F.6/F.14),
`notifications` (in-app inbox), `audit_log` (constraint C.5), `fare_rules` (F.10
pricing), `id_counters` (identifier sequences).

## Data dictionary conformance

Element formats from section 2 are enforced in `backend/src/utils/validate.js` and by
`CHECK` constraints in `schema.sql`.

| Element | Specified format | Enforced by |
|---|---|---|
| `user_id` | `'U'` + 8 digits | `utils/ids.js` |
| `provider_id` | `'P'` + 8 digits | `utils/ids.js` |
| `org_id` | `'O'` + 6 digits | `utils/ids.js` |
| `booking_id` | `'BK'` + 8 digits | `utils/ids.js` |
| `assignment_id` | `'AS'` + 8 digits | `utils/ids.js` |
| `trip_id` | `'TR'` + 8 digits | `utils/ids.js` |
| `invoice_id` | `'INV'` + 8 digits | `utils/ids.js` |
| `report_id` | `'RPT'` + 6 digits | `utils/ids.js` |
| `phone_no` | `^[6-9][0-9]{9}$` | `validate.phone` |
| `vehicle_reg_no` | `^[A-Z]{2}[0-9]{2}[A-Z]{2}[0-9]{4}$` | `validate.vehicleRegNo` |
| `password_hash` | bcrypt, cost 12 | `bcrypt.hashSync(pw, 12)` |
| `otp_code` / `otp_expiry` | 6 digits, issue + 5 min | `routes/auth.js` `OTP_TTL_MS` |
| `session_token` | JWT HS256, 24 h | `middleware/auth.js` |
| `role_code` | `USER \| DRIVER \| ORG \| ADMIN` | CHECK + `validate.oneOf` |
| `verification_status` | `PENDING \| VERIFIED \| REJECTED \| SUSPENDED` | CHECK + `validate.oneOf` |
| `ambulance_type` | `BLS \| ALS \| ICU \| PTV` | CHECK + `validate.oneOf` |
| `availability_status` | `AVAILABLE \| BUSY \| OFFLINE` | CHECK + `validate.oneOf` |
| `booking_status` | 9 states from `REQUESTED` to `FAILED` | CHECK + `validate.oneOf` |
| `assignment_status` | `OFFERED \| ACCEPTED \| REJECTED \| TIMEOUT` | CHECK + `validate.oneOf` |
| `offer_expiry_timestamp` | offer time + 45 s | `config.dispatch.offerTimeoutSeconds` |
| `retry_count` | 0 to 5 | `config.dispatch.maxRetries` |
| `rank_score` | 0.00 to 100.00 | `dispatch.findCandidates` |
| `trip_milestone` | `ASSIGNED → … → COMPLETED` | CHECK + one-step transition guard |
| `rating_value` | 1 to 5 | CHECK + `validate.rating` |
| `payment_mode` | `UPI \| CARD \| NETBANKING \| CASH` | CHECK + `validate.oneOf` |
| `payment_status` | `PENDING \| SUCCESS \| FAILED \| REFUNDED` | CHECK + `validate.oneOf` |
| `message_channel` | `WHATSAPP \| PUSH \| SMS` | CHECK + `validate.oneOf` |
| `delivery_state` | `SENT \| DELIVERED \| READ \| FAILED` | CHECK + `validate.oneOf` |
| `report_type` | `RESPONSE_TIME \| DEMAND \| REVENUE \| PROVIDER_PERF` | `routes/admin.js` |
| `response_time_sec` | booking → confirmed assignment | computed in `dispatch.acceptOffer` |
| Timestamps | ISO 8601, stored UTC | `nowIso()` |
| Money | INR, two decimals | `services/fare.js` `round2` |

Composite groups (`location`, `pickup_point`, `credentials`, `provider_ref`,
`fare_breakdown`, `date_range`) appear as the corresponding column groups and request
bodies.

## Defects found and fixed after the first build

Each is pinned by a regression test in `backend/tests/api.test.js` or `backend/tests/recovery.test.js`.

| Area | Defect | Resolution |
|---|---|---|
| F.10 | The fare was computed from `route_distance_km`, which holds the *remaining* distance to the target and is ~0 on arrival. A trip ending at its pickup point billed base fare only. | The server accumulates a laden-distance odometer from the GPS trace and bills that. |
| F.10 / NF.3 | The billed distance was read from the driver's request body, so the party being paid chose the amount. | The request body no longer contributes; the figure is measured server-side. |
| NF.3 / C.1 | `booking:subscribe` joined any socket room on request, streaming another patient's pickup address and live ambulance GPS to any signed-in account. | The room now applies the same ownership rule as the REST route. |
| NF.3 | Sign-in and OTP verification accepted unlimited attempts, leaving a six-digit code exhaustible. | Per-account rate limits on sign-in, OTP issue and OTP verification. |
| F.1 | `/otp/verify` consumed the code before checking whether a name was needed, so the screen's two-step registration — verify, be asked for a name, verify again — always failed the second step. Registering from the app was impossible however correct the code was. | Everything that can refuse the request is settled before the code is marked consumed. |
| F.1 | The app requested codes with no `purpose`, which defaults to `LOGIN`, and `LOGIN` refuses a number with no account. Registration by code was reachable over the API and never from the app. | The client asks for `REGISTER`, which is what a screen serving both sign-in and sign-up needs. |
| NF.3 | A password needed only six characters, so `password`, `12345678` and the account holder's own phone number were all acceptable. | A policy applied wherever a password is chosen: length floor, breach blocklist, no trivial patterns, and nothing containing the holder's own details. Sign-in is exempt so existing accounts are not locked out. |
| F.1 | `/register` created the account immediately with `email_verified = 0` and never sent a code. The address was required and never checked, which is the same as not requiring it — and the registration form was the path most people would take. | `/register` validates and emails a code, answering 202; `/otp/verify` creates the account. No account can exist with an unproved address. |
| F.1 | `messages.recipient_phone` was NOT NULL, so logging the very first message to a new user — the code that creates their account — violated the constraint and returned 500. Registration by email was impossible. | The column is nullable: at that moment there is no account and no number to attribute the message to. |
| F.14 | The patient's Account tab rendered `<NotificationInbox>` without importing it, so opening it threw "Element type is invalid". The file compiled, so nothing caught it until the tab was opened. | Import added, and a check that every JSX component in the app is imported or declared. |
| F.3 | The booking screen counted available ambulances per type against `a.ambulance_ambulanceType`, a field that does not exist, so the "N free" badge never appeared. | Reads `ambulance_type`, which is what the endpoint returns. |
| F.6 / C.5 | The call buttons dialled a number already in the tracking payload, so a driver's and a patient's number were disclosed to each other with no record of it. | The number is released by `POST /api/bookings/:id/call`, only between the parties of a live booking, and the release is audited. |
| F.7 / C.6 | Accept, decline and expiry each read the assignment state and then wrote it, so two simultaneous responses could both pass the check. | All three transitions are conditional updates that verify a row actually changed. |
| NF.1 / C.6 | A driver who accepted and then went silent left the booking in ASSIGNED for ever: the patient watched a frozen ETA and the ambulance was held BUSY permanently. Nothing swept for it. | A recovery sweep retires stale providers, flags stalled trips to the patient and control room, and re-offers bookings left mid-match. |
| C.6 / F.13 | "Available" was defined three different ways, so the dashboard could report ambulances free that the matcher would never consider. | One predicate in `services/availability.js`, used by the matcher, the dashboard and the patient view; stale providers are reported separately. |
| F.13 | Analytics bucketed by UTC date, filing every call between 00:00 and 05:29 IST under the previous day and shifting the demand-by-hour curve by 5.5 hours. | Day and hour buckets use the control room's civil timezone (`REPORT_UTC_OFFSET`). |
| NF.4 | Booking lists issued two extra queries per row, so a 100-row control-room page cost 201 round trips; candidate matching scanned the whole fleet. | Related rows resolved in two batch queries; matching bounded by a latitude/longitude box in SQL. |

## Constraints

| | Constraint | How it is met |
|---|---|---|
| C.1 | Data-protection compliance | Passwords are bcrypt-only, never returned; tokens scoped by role; location is readable only by the patient, the assigned driver and administrators |
| C.2 | Connectivity | Map failures degrade to straight-line distance and average-speed ETA; the API surfaces a clear "cannot reach the server" message rather than a stack trace |
| C.3 | Software interfaces | WhatsApp, maps and payment providers sit behind adapters with working fallbacks |
| C.4 | GPS hardware | `expo-location` in both apps; the pickup point falls back to map pin or typed address |
| C.5 | Audit functions | `audit_log` written on registration, login, booking, every dispatch decision, status change, payment and admin action; browsable in the dashboard |
| C.6 | Control functions | 45-second offer expiry, automatic reassignment on reject or timeout, retry cap, and availability re-validated before every offer |
| C.7 | Criticality | Booking responds before matching runs; messaging failures never block dispatch; offer timers are re-armed after a restart |

## Non-functional requirements

| | Requirement | How it is met |
|---|---|---|
| NF.1 | Availability and reliability | No request is left unserved — reject and timeout both reassign; `FAILED` is only reached after the retry cap and the patient is told |
| NF.2 | Performance | The booking endpoint returns before matching starts; dispatch is in-process with an indexed candidate query; updates are pushed, not polled |
| NF.3 | Security and privacy | JWT HS256 with expiry, RBAC on every route, ownership checks on booking and invoice reads (REST *and* the socket booking rooms), bcrypt cost 12, rate limits on sign-in and OTP, and a fare the paid party cannot influence |
| NF.4 | Scalability | Stateless JWT auth, indexed dispatch query, room-based socket fan-out; the SQL schema ports to a server database unchanged |
| NF.5 | Platform support | Two React Native apps run on Android and iOS through Expo; the dashboard runs in any browser |
| NF.6 | Usability | Booking is three taps from opening the app; large touch targets, one dominant action per screen, plain-language status, and a visible reminder to call 108 |
