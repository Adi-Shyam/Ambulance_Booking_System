# API reference

Base URL `http://localhost:4000`. All bodies and responses are JSON (SRS 3.2.4).
Every route except those marked *public* needs `Authorization: Bearer <session_token>`.

Errors come back as `{ "error": "human readable message", "field": "..." }` with a
conventional status code: 400 validation, 401 authentication, 403 role or ownership,
404 missing, 409 conflicting state, 422 could not resolve.

---

## Authentication — F.1, F.2

| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/register` | *public.* `full_name`, `phone_no`, `email_id`, `password`, optional `role_code` (`USER`\|`DRIVER`\|`ORG`). The address is **required** — it is how an account is reached and how it is proved. 409 on a duplicate address or number. A password does not prove the address, so `email_verified` stays false until a code is answered. |
| POST | `/api/auth/login` | *public.* `password` plus **either** `email_id` **or** `phone_no`, optional `role_code`. A `role_code` that does not match the account is rejected with 403 — this is F.2's mode check. |
| POST | `/api/auth/otp/request` | *public.* **Either** `email_id` **or** `phone_no` — whichever contact detail is to be proved. An address can only be reached by email, so `channel` is forced to `EMAIL` for one; a number defaults to `WHATSAPP` and may use `EMAIL` when the account has an address on file. Optional `purpose` (`LOGIN`, the default, refuses an identifier with no account; `REGISTER` does not). Replies with `channel`, `verifying` (`EMAIL`\|`PHONE`) and a masked `sent_to`, plus `otp_code` while `EXPOSE_OTP_IN_RESPONSE=true`. |
| POST | `/api/auth/otp/verify` | *public.* `otp_code` plus the same identifier the code was issued against. Proves that one detail and sets `email_verified` or `phone_verified` accordingly. A correct code on an **address** with no account **registers it** when `full_name` and `phone_no` are also sent, returning 201; without them it answers 404 with `needs_registration: true` and a `missing` array naming the fields. A code on an unknown **number** is never a registration — nothing here proves a number belongs to the person holding it. Accounts made this way have no password; the schema allows a NULL hash for exactly these. |
| GET | `/api/auth/me` | Current user, provider profile and organisation. |
| PATCH | `/api/auth/me` | `full_name`, `email_id`. |
| POST | `/api/auth/password` | `new_password`, plus `current_password` unless the account has none — one registered by OTP sets its first password with the bearer token alone, since demanding a password it never had would strand it on code-only sign-in. |
| POST | `/api/auth/logout` | Revokes *this* session in D1 by its `jti`, so the token stops being accepted immediately rather than at its 24-hour expiry. Clearing it on the device alone would not. |
| GET | `/api/auth/sessions` | The account's own last 25 sessions — issued, expiry, revoked — with `current: true` on the one making the request. This is what DFD 0.1.3 writes. |

Session response:

```json
{
  "session_token": "<JWT HS256, 24h>",
  "token_expiry": "2026-08-25T10:12:44.000Z",
  "user": { "user_id": "U00000002", "role_code": "USER", "...": "..." },
  "provider": null
}
```

---

## Patient — F.3, F.4, F.8, F.11, F.12

| Method | Path | Notes |
|---|---|---|
| POST | `/api/bookings` | `ambulance_type` — `BLS`, `ALS`, `ICU`, `PTV` or `EMG` — plus either `latitude`+`longitude` or `address_text`. Optional `landmark`, `pincode`, `patient_name`, `contact_phone`, `notes`, drop coordinates. 409 if a booking is already open. Responds immediately, then matching runs. |
| GET | `/api/bookings` | Booking history, newest first. |
| GET | `/api/bookings/active` | The open booking, or `null`. |
| GET | `/api/bookings/:id` | Booking, invoice, rating and every dispatch attempt. |
| GET | `/api/bookings/:id/track` | Live position, fresh ETA, decoded `route_points`, driver contact. |
| POST | `/api/bookings/:id/cancel` | Optional `reason`. Blocked once the patient is `ONBOARD`. |
| POST | `/api/bookings/:id/rating` | `rating_value` 1–5, optional `feedback_text`. Completed trips only, once each. |
| POST | `/api/bookings/:id/call` | Returns the other party's `phone_no`, `name` and `to_role` so the app can open the phone's dialer. The driver is given the patient; the patient and the control room are given the driver. 409 before an ambulance is assigned or once the booking is closed. Every release is written to the audit trail (C.5) — a phone number is not disclosed quietly. |
| POST | `/api/bookings/estimate` | `ambulance_type`, `distance_km` → indicative fare breakdown. |

---

## Driver and organisation — F.7, F.9

All of these need the `DRIVER` or `ORG` role; the ones marked † additionally need a
`VERIFIED` provider profile.

| Method | Path | Notes |
|---|---|---|
| POST | `/api/provider/profile` | `vehicle_reg_no` (KA19AB1234), `ambulance_type`, optional `licence_no`, `document_ref`, `org_name`. Creates the D2 record for admin verification. |
| GET | `/api/provider/me` | Profile, organisation, trip and earnings totals. |
| PATCH | `/api/provider/profile` † | Change `ambulance_type` or `licence_no`. |
| POST | `/api/provider/availability` † | `availability_status` `AVAILABLE`\|`BUSY`\|`OFFLINE`. Blocked while a trip is live. |
| POST | `/api/provider/location` † | `latitude`, `longitude`, optional `speed_kmph`. Updates D2, appends to D4 on an active trip, and returns the recomputed `eta_minutes`. |
| GET | `/api/provider/offers` † | Live offers with `expires_in_seconds`. |
| POST | `/api/provider/offers/:assignmentId/accept` † | Confirms the assignment and opens a trip. 409 if expired or already taken. |
| POST | `/api/provider/offers/:assignmentId/reject` † | Optional `reason`. Immediately re-offers to the next candidate. |
| GET | `/api/provider/trips/active` † | Current trip with patient contact and `next_milestone`. |
| POST | `/api/provider/trips/:tripId/status` † | `trip_milestone`. Must advance exactly one stage. `COMPLETED` raises and returns the invoice, billed on the server-measured laden distance — no distance is accepted from the caller. |
| GET | `/api/provider/trips` † | Trip history with fare, payment and rating. |
| GET | `/api/provider/earnings` † | Settlement summary and a 14-day series. |

---

## Payments — F.10

| Method | Path | Notes |
|---|---|---|
| GET | `/api/payments/fare-rules` | *public.* Base fare, per-km rate and surcharge per type. |
| GET | `/api/payments/invoices` | The patient's invoices. |
| GET | `/api/payments/invoices/:id` | Patient, assigned driver or admin only. |
| POST | `/api/payments/invoices/:id/pay` | `payment_mode` `UPI`\|`CARD`\|`NETBANKING`\|`CASH`. |
| POST | `/api/payments/webhook` | *public,* signature-verified — the signature is the credential, not a session. Confirms a pending gateway charge. With an `X-Razorpay-Signature` header it verifies the HMAC of the **raw body** against `RAZORPAY_WEBHOOK_SECRET` and reads `payload.payment.entity`; without one it accepts the Checkout callback shape (`order_id`, `payment_id`, `signature`) verified against the API key secret. The two secrets are not interchangeable. |

---

## Geocoding — F.4

| Method | Path | Notes |
|---|---|---|
| GET | `/api/geo/geocode?q=&pincode=` | Address → candidate coordinates. |
| GET | `/api/geo/reverse?lat=&lng=` | Coordinates → address and pincode. |
| GET | `/api/geo/route?from_lat=&from_lng=&to_lat=&to_lng=` | Polyline, road distance, ETA. |
| GET | `/api/geo/nearby-ambulances?lat=&lng=&radius_km=` | Available ambulances near a point. |

---

## Notifications — F.14

| Method | Path | Notes |
|---|---|---|
| GET | `/api/notifications` | Inbox plus unread count. |
| POST | `/api/notifications/read` | Optional `ids`; omit to mark everything read. |
| POST | `/api/notifications/push-token` | `push_token` (an `ExponentPushToken[...]`), optional `platform`, `device_name`. Registers this handset. Sent on every sign-in, not once on install: a token can rotate, and it has to follow whoever is signed in on that phone. A token already on file moves to the caller. |
| DELETE | `/api/notifications/push-token` | `push_token`. Called on sign-out, so a shared phone stops delivering the previous driver's offers. |
| POST | `/api/notifications/push-test` | Sends a test alert to the caller's own devices. 409 when none is registered. A dispatch offer lasts 45 seconds and fails silently when notifications were declined, so this exists to find that out beforehand. |

---

## Administration — F.13

`ADMIN` role only.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/admin/overview` | Live counts, response-time statistics, demand by type, recent bookings. |
| GET | `/api/admin/providers` | Filters: `verification_status`, `ambulance_type`, `availability_status`, `q`. |
| GET | `/api/admin/providers/:id` | Provider, trip history, offer accept/decline statistics. |
| POST | `/api/admin/providers/:id/verification` | `verification_status`, optional `remarks`. Notifies the driver and takes a non-verified provider off duty. |
| GET | `/api/admin/bookings` | Filters: `booking_status`, `active=true`, `ambulance_type`, `from_date`, `to_date`, `q`. |
| GET | `/api/admin/bookings/:id` | Full case file: patient, attempts, GPS trace, invoice, rating, alerts. |
| POST | `/api/admin/bookings/:id/cancel` | Force-close a stuck booking. |
| POST | `/api/admin/bookings/:id/redispatch` | Re-run matching on a `FAILED` booking. |
| GET | `/api/admin/fleet` | Every ambulance with a known position. |
| GET | `/api/admin/users` | Filters: `role_code`, `q`. |
| POST | `/api/admin/users/:id/status` | Suspend or reinstate an account. |
| POST | `/api/admin/admins` | Create another administrator. |
| GET | `/api/admin/reports/:reportType` | `RESPONSE_TIME`, `DEMAND`, `REVENUE`, `PROVIDER_PERF`, with `from_date` / `to_date`. |
| GET | `/api/admin/messages` | The WhatsApp / SMS / push delivery log. |
| GET | `/api/admin/audit` | The audit trail (C.5), optionally filtered by `action`. |

---

## Realtime channel

Socket.IO at the same origin. Authenticate on connect:

```js
io('http://localhost:4000', { auth: { token: session_token } });
```

Rooms are joined automatically: `user:<user_id>`, `provider:<provider_id>` for
providers, `admins` for administrators.

A client may also `emit('booking:subscribe', bookingId)` to follow one booking.
That room carries the pickup address and the ambulance's live position, so joining
it is authorised the same way the REST route is: only the patient who placed the
booking, the ambulance assigned to it, and administrators are admitted. Anyone else
receives `booking:subscribe:denied` and is not joined.

**Server → patient**

| Event | Payload |
|---|---|
| `booking:update` | The booking with its provider and trip |
| `trip:location` | Position, `eta_minutes`, `route_distance_km`, polyline |
| `trip:status` | New `trip_milestone` and `booking_status` |
| `invoice:ready` | The invoice raised on completion |
| `notification` | Inbox entry |

**Server → driver**

| Event | Payload |
|---|---|
| `offer:new` | Assignment, pickup, distance, `offer_expiry_timestamp` |
| `offer:closed` | `{ assignment_id, result }` when it is taken or expires |
| `booking:cancelled` | `{ booking_id, reason }` |
| `provider:verification` | `{ verification_status, remarks }` |
| `rating:new` | A rating just left for this driver |
| `payment:update` | Settlement result |

**Server → admins**

`admin:booking:new`, `admin:booking:update`, `admin:dispatch` (`OFFERED` /
`ACCEPTED` / `REJECTED` / `TIMEOUT`), `admin:trip:location`, `admin:trip:status`,
`admin:provider:new`, `admin:provider:update`, `admin:payment`.
