# Test results

Ambulance Booking System — Team 16, IT303.

Generated from an actual run by `npm run test:report` on 2026-10-15T15:25:20.644Z.
Do not edit by hand; re-run the command instead.

## Summary

| Level | Purpose | Tests | Passed | Failed |
|---|---|---|---|---|
| Unit | One module in isolation | 76 | 76 | 0 |
| Integration | Modules working together over HTTP and the database | 69 | 69 | 0 |
| System | Whole-system behaviour and failure recovery | 11 | 11 | 0 |
| **Total** | | **156** | **156** | **0** |

All 156 tests passed.

## Unit tests

| # | Test case | Result |
|---|---|---|
| 1 | fare calculation (F.10) | Pass |
| 2 | geodesy (F.5, F.8) | Pass |
| 3 | identifier formats | Pass |
| 4 | identifier sequencing | Pass |
| 5 | message identifiers | Pass |
| 6 | timezone offset parsing | Pass |
| 7 | SQL bucket expressions | Pass |
| 8 | calendar arithmetic | Pass |
| 9 | templates carry both a readable body and template parameters | Pass |
| 10 | E.164 formatting for the Cloud API | Pass |
| 11 | payment signatures (Razorpay checkout callback) | Pass |
| 12 | webhook signatures (Razorpay webhook) | Pass |
| 13 | counting every attempt | Pass |
| 14 | counters are scoped, not global | Pass |
| 15 | failure-only counting | Pass |
| 16 | the window expires | Pass |
| 17 | data dictionary validation | Pass |

## Integration tests

| # | Test case | Result |
|---|---|---|
| 1 | the driver is told by WhatsApp when the job is cancelled under them | Pass |
| 2 | the patient is told by WhatsApp when the control room cancels | Pass |
| 3 | the patient is told by WhatsApp when nothing can be matched | Pass |
| 4 | authentication and role-based access (F.1, F.2) | Pass |
| 5 | booking, matching and dispatch (F.3 - F.7) | Pass |
| 6 | automatic reassignment on decline (F.7, C.6) | Pass |
| 7 | trip, billing and feedback (F.8 - F.12) | Pass |
| 8 | booking privacy (NF.3, C.1) | Pass |
| 9 | brute-force protection (NF.3) | Pass |
| 10 | administration and analytics (F.13) | Pass |
| 11 | a code can be sent to an email address instead of WhatsApp | Pass |
| 12 | the response masks where the code went | Pass |
| 13 | verifying an emailed code registers the account and keeps the address | Pass |
| 14 | an existing account needs no address: the one on file is used | Pass |
| 15 | an email channel with nowhere to send says so rather than failing silently | Pass |
| 16 | a driver with no address on file is told to use WhatsApp | Pass |
| 17 | an unrecognised channel is refused | Pass |
| 18 | omitting the channel still sends by the phone, unchanged | Pass |
| 19 | a code for an unknown number needs purpose REGISTER, not the LOGIN default | Pass |
| 20 | a correct code on an unknown number asks for a name rather than failing | Pass |
| 21 | supplying a name creates the account and returns a session | Pass |
| 22 | an OTP-only account cannot be signed into with a password | Pass |
| 23 | an OTP-only account can set a first password without knowing one | Pass |
| 24 | one code survives the round trip that asks for a name | Pass |
| 25 | a provider registered by OTP still starts PENDING | Pass |
| 26 | nobody can register themselves as an administrator by OTP | Pass |
| 27 | signing in writes to D1 (DFD 0.1.3) | Pass |
| 28 | a user can see and end their sessions | Pass |

## System tests

| # | Test case | Result |
|---|---|---|
| 1 | availability is defined once (C.6, F.13) | Pass |
| 2 | an abandoned trip does not strand the patient (NF.1) | Pass |
| 3 | a booking cannot be left mid-match (NF.1) | Pass |
| 4 | analytics use the control room calendar (F.13) | Pass |
| 5 | list endpoints resolve related rows in bulk (NF.4) | Pass |
