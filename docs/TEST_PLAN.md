# Software Test Plan

**Ambulance Booking System**

Team 16 — Adithya Shyam D (241IT005), Dev Patel (241IT023), Ritesh Bhagat (241IT063)
Department of Information Technology, NITK Surathkal

Derived from the Software Requirements Specification, the Data Flow Diagrams and the
Data Dictionary. This is the testing-phase deliverable that follows the SRS, DFD and
development phases.

---

## 1. Introduction

### 1.1 Purpose

This document defines how the Ambulance Booking System is tested: what is tested, at
which level, against which requirement, and what result each test produced. Every
test case here is automated and executable — the results in
[TEST_RESULTS.md](TEST_RESULTS.md) are generated from a real run, not transcribed by
hand.

### 1.2 Scope

In scope: the backend REST API, the dispatch engine, the realtime channel, the
database layer, and the business rules of all fourteen functional requirements
(F.1–F.14), together with the constraints (C.1–C.7) and non-functional requirements
(NF.1–NF.6) that can be verified by execution.

Out of scope, and why:

| Not tested automatically | Reason |
|---|---|
| React Native screen rendering | Requires a device or emulator harness; verified manually against the checklist in §7 |
| WhatsApp Business Cloud API delivery | Third-party service; the adapter is tested through its mock transport, and the live path is configuration only |
| Real GPS hardware | Constraint C.4 assumes a GPS-enabled handset; positions are injected through the same API the device uses |
| Load and soak testing | NF.4 is addressed structurally (query counts, bounded search) rather than by load generation |

### 1.3 References

1. Software Requirements Specification, Ambulance Booking System, Team 16
2. Data Flow Diagrams (Levels 0–2), Team 16
3. Data Dictionary, Team 16
4. IEEE Std 829, Standard for Software Test Documentation

---

## 2. Test strategy

Testing is organised into the three conventional levels, each in its own directory so
the level of any test is evident from its location.

| Level | Location | What it exercises | Count |
|---|---|---|---|
| Unit | `backend/tests/unit/` | One module in isolation, no server and no network | 57 |
| Integration | `backend/tests/integration/` | Modules working together over HTTP and the database | 50 |
| System | `backend/tests/system/` | Whole-system behaviour, including failure recovery | 11 |
| | | **Total** | **118** |

**Unit testing** covers the pure logic where a defect is cheapest to find: fare
arithmetic, geodesy, the Data Dictionary validators, identifier generation, the
reporting calendar and the rate limiter. Each unit test file gets its own throwaway
database so no unit test can fail because of another.

**Integration testing** drives the real HTTP API against a real database, and asserts
both the response *and* the resulting database state — which is how a requirement
like "signing in must change the database" is verified rather than assumed.

**System testing** covers behaviour that only appears when the parts run together over
time: the recovery sweep, availability consistency across three different consumers,
and the reporting calendar end to end.

### 2.1 Test design techniques

| Technique | Where it is used |
|---|---|
| Equivalence partitioning | Ambulance types, role codes, payment modes, booking states |
| Boundary value analysis | Rating 0/1/5/6, coordinate limits ±90 / ±180, offer expiry at 45 s, local-day boundary at 18:30 UTC |
| State transition testing | Booking lifecycle and the one-step milestone rule (F.9) |
| Decision testing | Candidate ranking: availability, verification, capability tier, radius |
| Negative testing | Wrong role, wrong owner, expired OTP, replayed OTP, double payment, double rating |
| Regression testing | One test pinned per defect in §6 |

---

## 3. Test environment

| Item | Value |
|---|---|
| Runtime | Node.js ≥ 22.5 (developed on 24.14.1) |
| Test runner | `node --test` (built in; no external framework) |
| Database | SQLite via `node:sqlite`, a fresh temporary file per test file |
| Server | Started in-process on an OS-assigned free port |
| WhatsApp | Mock transport — messages stored and printed, never sent |
| Maps | OSM adapter with the offline fallback path |
| Payments | Mock gateway |

No external service, API key or network access is required, so the suite runs
identically on any machine.

### 3.1 Commands

```
npm test                 all 118 tests
npm run test:unit        unit level only
npm run test:integration integration level only
npm run test:system      system level only
npm run test:report      runs everything and regenerates TEST_RESULTS.md
```

### 3.2 Code coverage

Measured with Node's built-in coverage instrumentation:

```
npm run test:coverage
```

| Metric | Result |
|---|---|
| Line coverage | 83.84 % |
| Branch coverage | 72.01 % |
| Function coverage | 78.24 % |

Fully covered (100 % lines): `utils/geo.js`, `utils/ids.js`, `utils/localDate.js`,
`services/availability.js`. The Data Dictionary validators sit at 95 %.

The lowest figures are concentrated in exactly one place, and deliberately so:

| Module | Line % | Why the remainder is uncovered |
|---|---|---|
| `services/payments.js` | 42.6 | The Razorpay branch needs live gateway credentials; the mock and cash paths are covered |
| `services/maps.js` | 51.3 | The Google Maps adapter and network-failure branches need an API key and induced outages |
| `services/messaging.js` | 73.9 | The WhatsApp Cloud API branch needs a Meta business account; the mock transport is covered |

These are the third-party adapters excluded in §1.2. Each is a configuration-selected
alternative to a path that *is* tested, so the untested code is the integration with an
external service rather than any project logic. Excluding those three files, line
coverage of the system's own logic is above 90 %.

### 3.3 Entry and exit criteria

**Entry:** the development phase is complete for the requirement under test; the
build runs; seed data loads.

**Exit:** every test passes; every functional requirement has at least one test case;
every defect found is either fixed with a regression test, or recorded in §6 with a
stated reason for deferral.

---

## 4. Test case specification

Test case IDs are grouped by requirement. Each maps to a named test in the suite; the
per-test pass/fail record is in [TEST_RESULTS.md](TEST_RESULTS.md).

### F.1 Registration and authentication

| ID | Test case | Input | Expected result |
|---|---|---|---|
| TC-F1-01 | Register a new patient | Valid name, phone, password | 201, account created and signed in |
| TC-F1-02 | Reject a malformed mobile number | `1234567890` | 400, field `phone_no` |
| TC-F1-03 | Reject a duplicate registration | An existing phone number | 409 |
| TC-F1-04 | Issue an OTP | Registered phone | 200, six-digit code, 5-minute expiry |
| TC-F1-05 | Reject an incorrect OTP | Wrong code | 401 |
| TC-F1-06 | Consume the OTP once | The same valid code twice | First 200, second 401 |
| TC-F1-07 | Password stored as a bcrypt digest | Any registration | No `password_hash` in any response |

### F.2 Role-based login

| ID | Test case | Input | Expected result |
|---|---|---|---|
| TC-F2-01 | Sign in as the correct role | Patient credentials + `USER` | 200, session issued |
| TC-F2-02 | Refuse a mismatched mode | Patient credentials + `DRIVER` | 403, response names the real role |
| TC-F2-03 | Refuse a wrong password | Bad password | 401 |
| TC-F2-04 | Block unauthenticated access | No token | 401 |
| TC-F2-05 | Block a forged token | Malformed JWT | 401 |
| TC-F2-06 | Enforce RBAC | Patient token on an admin route | 403 |
| TC-F2-07 | **Login writes a session to D1** | Successful login | A row appears in `sessions` with role and expiry |
| TC-F2-08 | A failed login writes no session | Bad password | `sessions` row count unchanged |
| TC-F2-09 | Session lifetime matches the dictionary | Any login | `token_expiry − issued_at` = 24 h |
| TC-F2-10 | Sign-out revokes the session | Logout then reuse the token | Row marked revoked; token rejected with 401 |
| TC-F2-11 | Revocation is per session | Two devices, sign out one | The other stays signed in |

### F.3 / F.4 Booking and pickup location

| ID | Test case | Input | Expected result |
|---|---|---|---|
| TC-F3-01 | Place a booking | Type + coordinates | 201, id matching `BK[0-9]{8}` |
| TC-F3-02 | Reject an unknown ambulance type | `XYZ` | 400 |
| TC-F3-03 | Reject a booking with no location | Type only | 400 |
| TC-F3-04 | One active booking at a time | Second booking while one is open | 409 |
| TC-F4-01 | Resolve coordinates to an address | Lat/long | Address and place id attached |
| TC-F4-02 | Bound coordinates to WGS-84 | Latitude 91 | 400 |

### F.5 – F.7 Matching and dispatch

| ID | Test case | Input | Expected result |
|---|---|---|---|
| TC-F5-01 | Offer to a suitable nearby ambulance | Booking near an on-duty driver | Offer appears in that driver's inbox |
| TC-F5-02 | `rank_score` within its stated range | Any offer | 0 ≤ score ≤ 100 |
| TC-F5-03 | Never downgrade care level | ICU request, only BLS free | No offer; booking fails cleanly |
| TC-F5-04 | Exclude unverified providers | Pending driver nearby | Not offered |
| TC-F5-05 | Exclude providers outside the radius | Booking far offshore | No candidate; `FAILED` |
| TC-F6-01 | WhatsApp alert logged | Any dispatch | `messages` row, channel `WHATSAPP`, state `SENT` |
| TC-F6-02 | Offer carries the 45-second window | Any offer | `expires_in_seconds` ≤ 45 |
| TC-F7-01 | Accept an offer | Assigned driver accepts | 200, trip `TR[0-9]{8}`, booking `ASSIGNED` |
| TC-F7-02 | Refuse acceptance by another driver | A different driver accepts | 403 |
| TC-F7-03 | Refuse a second acceptance | Accept twice | 409 |
| TC-F7-04 | Reassign on decline | Driver declines | Offer moves to the next candidate |
| TC-F7-05 | Record the response time | Accept | `response_time_sec` populated |

### F.8 / F.9 Tracking and trip status

| ID | Test case | Input | Expected result |
|---|---|---|---|
| TC-F8-01 | Report a position | Driver GPS ping | 200, ETA recalculated |
| TC-F8-02 | Patient sees position and ETA | Track request | Ambulance location, ETA, provider details |
| TC-F9-01 | Advance a milestone | `ENROUTE` from `ASSIGNED` | 200 |
| TC-F9-02 | Refuse skipping a stage | `COMPLETED` from `ASSIGNED` | 409, `expected: ENROUTE` |
| TC-F9-03 | Complete the trip | Final milestone | 200, invoice raised |
| TC-F9-04 | Release the driver on completion | After completion | Availability back to `AVAILABLE` |

### F.10 – F.12 Billing, history and feedback

| ID | Test case | Input | Expected result |
|---|---|---|---|
| TC-F10-01 | Fare breakdown structure | Any calculation | Exactly the `fare_breakdown` group fields |
| TC-F10-02 | Total equals components plus tax | Any type and distance | Arithmetic holds to two decimals |
| TC-F10-03 | Fares rise with capability | PTV < BLS < ALS < ICU | Monotonic increase |
| TC-F10-04 | Zero distance still bills base fare | 0 km | Distance charge 0, total > 0 |
| TC-F10-05 | Negative distance clamped | −50 km | Distance charge 0 |
| TC-F10-06 | **Bill the distance actually driven** | Full trip with GPS trace | Billed distance equals the laden leg |
| TC-F10-07 | **Driver cannot set their own fare** | Distance in the request body | Ignored; server figure used |
| TC-F10-08 | Settle an invoice | Payment mode | 200, status `SUCCESS` |
| TC-F10-09 | Refuse double payment | Pay twice | 409 |
| TC-F11-01 | Patient history | List request | The trip appears |
| TC-F11-02 | Driver history | List request | The trip appears |
| TC-F12-01 | Submit a rating | 1–5 plus comment | 201, provider average updated |
| TC-F12-02 | Reject an out-of-range rating | 0, 6, 3.5 | Rejected |
| TC-F12-03 | Rate only once | Rate twice | 409 |

### F.13 / F.14 Administration, analytics and notifications

| ID | Test case | Input | Expected result |
|---|---|---|---|
| TC-F13-01 | Operational overview | Admin request | Live counts and response-time statistics |
| TC-F13-02 | List providers awaiting verification | Filter `PENDING` | The pending provider is listed |
| TC-F13-03 | Verify a provider | Set `VERIFIED` | Status updated, driver notified |
| TC-F13-04 | Suspend a provider | Set `SUSPENDED` | Taken off duty immediately |
| TC-F13-05 | All four report types run | Each `report_type` | 200, id `RPT[0-9]{6}` |
| TC-F13-06 | Reject an inverted date range | `from_date` after `to_date` | 400 |
| TC-F13-07 | **Local-day bucketing** | Booking at 03:00 IST | Counted on the local day, not the UTC one |
| TC-F13-08 | **Local-hour demand curve** | Same booking | Appears in the 03:00 bucket |
| TC-F14-01 | Notification inbox | Any lifecycle event | Entry created and readable |
| TC-F14-02 | Mark notifications read | Read request | Unread count returns to zero |

### Constraints and non-functional requirements

| ID | Requirement | Test case | Expected result |
|---|---|---|---|
| TC-C1-01 | C.1 privacy | Stranger reads another patient's booking | 403 |
| TC-C1-02 | C.1 privacy | **Stranger subscribes to a booking's live channel** | Refused; not joined |
| TC-C5-01 | C.5 audit | Complete a lifecycle | All seven action types present in `audit_log` |
| TC-C5-02 | C.5 audit | Automatic off-duty | `PROVIDER_AUTO_OFFLINE` recorded |
| TC-C6-01 | C.6 control | **One availability definition** | Matcher, dashboard and patient view agree |
| TC-C6-02 | C.6 control | Silent driver | Excluded from matching and taken off duty |
| TC-NF1-01 | NF.1 reliability | **Driver vanishes mid-trip** | Flagged; patient and control room told |
| TC-NF1-02 | NF.1 reliability | Live run with a silent phone | Never auto-cancelled |
| TC-NF1-03 | NF.1 reliability | Booking stranded mid-match | Re-offered, or failed and the patient told |
| TC-NF1-04 | NF.1 reliability | Repeated sweeps | A flagged trip is not re-notified each minute |
| TC-NF3-01 | NF.3 security | **Repeated wrong passwords** | Blocked with 429 and a retry hint |
| TC-NF3-02 | NF.3 security | **Repeated OTP requests** | Throttled |
| TC-NF3-03 | NF.3 security | Suspended account signs in | 403 |
| TC-NF4-01 | NF.4 scalability | **Booking list of many rows** | Related rows resolved in two queries, not two per row |

Rows in bold were added or corrected as a direct result of the testing phase.

---

## 5. Requirement coverage

Every functional requirement has at least one executable test case.

| Requirement | Test cases | Level |
|---|---|---|
| F.1 Registration and authentication | TC-F1-01 … 07 | Unit + Integration |
| F.2 Role-based login | TC-F2-01 … 11 | Integration |
| F.3 Select type and place booking | TC-F3-01 … 04 | Integration |
| F.4 Capture pickup location | TC-F4-01 … 02, TC-F10 unit validators | Unit + Integration |
| F.5 Match nearest ambulance | TC-F5-01 … 05 | Integration + System |
| F.6 Notify driver via WhatsApp | TC-F6-01 … 02 | Integration |
| F.7 Accept or reject | TC-F7-01 … 05 | Integration |
| F.8 Live tracking and ETA | TC-F8-01 … 02 | Integration |
| F.9 Trip status updates | TC-F9-01 … 04 | Integration |
| F.10 Payment and billing | TC-F10-01 … 09 | Unit + Integration |
| F.11 Booking history | TC-F11-01 … 02 | Integration |
| F.12 Rating and feedback | TC-F12-01 … 03 | Unit + Integration |
| F.13 Administration and analytics | TC-F13-01 … 08 | Integration + System |
| F.14 Notifications and alerts | TC-F14-01 … 02 | Integration |

---

## 6. Defect log

Defects found during the testing phase, in the order they were found. Each fixed
defect has a regression test so it cannot silently return.

| ID | Requirement | Severity | Defect | Found by | Status |
|---|---|---|---|---|---|
| D-01 | F.10 | High | The fare was computed from `route_distance_km`, which holds the *remaining* distance to the target and is ≈0 on arrival. A trip ending near its pickup point billed base fare only. | Integration test of a full trip | Fixed — server-side odometer over the GPS trace |
| D-02 | F.10, NF.3 | High | The billed distance was taken from the driver's request body, so the party being paid chose the amount. | Review during D-01 | Fixed — request body ignored |
| D-03 | NF.3, C.1 | High | `booking:subscribe` joined any realtime room on request, streaming another patient's pickup address and live ambulance position to any signed-in account. | Privacy test | Fixed — same ownership rule as the REST route |
| D-04 | NF.3 | High | Sign-in and OTP verification accepted unlimited attempts, making a six-digit code exhaustible. | Security test | Fixed — per-account rate limits |
| D-05 | F.7, C.6 | Medium | Accept, decline and expiry each read the assignment state then wrote it, so two simultaneous responses could both pass the check. | Code inspection during F.7 testing | Fixed — conditional updates that verify a row changed |
| D-06 | NF.1 | High | A driver who accepted and then went silent left the booking `ASSIGNED` indefinitely; the patient saw a frozen ETA and the ambulance was held `BUSY` permanently. | System test of failure recovery | Fixed — recovery sweep |
| D-07 | C.6, F.13 | Medium | "Available" was defined three different ways, so the dashboard could report ambulances free that the matcher would never consider. | System test comparing the three consumers | Fixed — one shared predicate |
| D-08 | F.13 | Medium | Analytics bucketed by UTC date, filing every call between 00:00 and 05:29 IST under the previous day and shifting the demand curve by 5.5 hours. | Boundary analysis of the reporting window | Fixed — local-time bucketing |
| D-09 | NF.4 | Low | Booking lists issued two extra queries per row (201 for a 100-row page); candidate matching scanned the whole fleet. | Inspection against NF.4 | Fixed — batch resolution and a bounded search |
| D-10 | F.6 | Medium | `message_id` is the primary key of `messages` but appended only four random digits to a millisecond timestamp, so two alerts in the same millisecond collided about 1 in 10 000 times — aborting the insert and losing the delivery record. | **Unit test** of identifier uniqueness | Fixed — CSPRNG suffix |
| D-11 | F.1, F.2 | Medium | The `sessions` table of data store D1 was never written. DFD 0.1.3 "Create Session & Assign Role" writes to D1, so the implementation was incomplete against the design; signing in produced no session record. | **Unit/integration review of D1 against the DFD** | Fixed — sessions persisted and revocable |

No defects remain open.

### 6.1 Observations on the tests themselves

Three tests failed on first execution because the *test* was wrong, not the product.
They are recorded here because they are evidence the suite is meaningful:

1. A dispatch test assumed the nearest ambulance would be offered first; the ranking
   correctly preferred a slightly more distant exact-type match. The test was rewritten
   to discover the recipient rather than assume it.
2. A recovery test timed out the only eligible driver and then expected a re-offer; the
   engine correctly refuses to re-offer to a provider who has already been asked.
3. A privacy test omitted a client dependency, which failed to load rather than
   reporting a false pass.

---

## 7. Manual test checklist

The mobile clients are verified manually against this list, since automating a React
Native UI is outside the scope of the phase.

| # | Step | Expected |
|---|---|---|
| M-01 | Sign in on the patient app | Booking screen opens |
| M-02 | Decline location permission | Address-search fallback offered, with a clear message |
| M-03 | Search a landmark and select it | Pin moves; nearby ambulances shown |
| M-04 | Place a booking | Tracking screen shows "Finding an ambulance" |
| M-05 | Driver app receives the offer | Card appears with a live countdown |
| M-06 | Accept the offer | Patient app switches to the assigned view with an ETA |
| M-07 | Driver reports position | Marker and ETA update without a refresh |
| M-08 | Step through the milestones | Each stage appears on the patient's trail immediately |
| M-09 | Complete the trip | Invoice shown on both sides |
| M-10 | Pay and rate | Status becomes paid; rating recorded |
| M-11 | Control room during the run | Fleet map, booking detail and alert log all reflect it live |
| M-12 | Sign out, then reuse the app | Session ends; a fresh sign-in is required |

---

## 8. Conclusion

118 automated test cases execute across unit, integration and system levels, with all
fourteen functional requirements covered and every test passing. Eleven defects were
found and fixed during the phase, each pinned by a regression test — two of them
(D-10, D-11) found specifically by unit testing and by checking the implementation
back against the DFD data stores.

Current results: [TEST_RESULTS.md](TEST_RESULTS.md), regenerated with
`npm run test:report`.
