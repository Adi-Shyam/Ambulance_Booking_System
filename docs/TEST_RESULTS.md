# Test results

Ambulance Booking System — Team 16, IT303.

Generated from an actual run by `npm run test:report` on 2026-10-15T16:26:05.661Z.
Do not edit by hand; re-run the command instead.

## Summary

| Level | Purpose | Tests | Passed | Failed |
|---|---|---|---|---|
| Unit | One module in isolation | 91 | 91 | 0 |
| Integration | Modules working together over HTTP and the database | 88 | 88 | 0 |
| System | Whole-system behaviour and failure recovery | 11 | 11 | 0 |
| **Total** | | **190** | **190** | **0** |

All 190 tests passed.

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
| 11 | the email transport is resolved from what is configured, not what is asked for | Pass |
| 12 | the sender address is split for Brevo | Pass |
| 13 | a destination is masked before it goes back in a response | Pass |
| 14 | payment signatures (Razorpay checkout callback) | Pass |
| 15 | webhook signatures (Razorpay webhook) | Pass |
| 16 | counting every attempt | Pass |
| 17 | counters are scoped, not global | Pass |
| 18 | failure-only counting | Pass |
| 19 | the window expires | Pass |
| 20 | data dictionary validation | Pass |

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
| 11 | the patient is given the number of the driver coming for them | Pass |
| 12 | the driver is given the number of the patient they are collecting | Pass |
| 13 | releasing a number is written to the audit trail (C.5) | Pass |
| 14 | an unrelated patient cannot read either number | Pass |
| 15 | there is nobody to call before an ambulance is assigned | Pass |
| 16 | the control room is put through to the crew, not the patient | Pass |
| 17 | a device registers for alerts | Pass |
| 18 | registering the same device twice does not duplicate it | Pass |
| 19 | a token that is not an Expo token is refused | Pass |
| 20 | a handset moves to whoever signed in on it | Pass |
| 21 | a device can be forgotten again | Pass |
| 22 | a dispatch offer is pushed, not only put in the inbox | Pass |
| 23 | an emergency is offered to every nearby ambulance at once | Pass |
| 24 | an emergency ignores the tier rule that governs the other types | Pass |
| 25 | the first to accept takes it and the rest are closed | Pass |
| 26 | one driver declining an emergency does not fail it for the others | Pass |
| 27 | EMG is a request, so no ambulance can be registered or reclassified as one | Pass |
| 28 | an emergency has a fare rule of its own | Pass |
| 29 | the control room can filter bookings by EMG | Pass |
| 30 | a code can be sent to an email address instead of WhatsApp | Pass |
| 31 | the response masks where the code went | Pass |
| 32 | verifying an emailed code registers the account and keeps the address | Pass |
| 33 | an existing account needs no address: the one on file is used | Pass |
| 34 | an email channel with nowhere to send says so rather than failing silently | Pass |
| 35 | a driver with no address on file is told to use WhatsApp | Pass |
| 36 | an unrecognised channel is refused | Pass |
| 37 | omitting the channel still sends by the phone, unchanged | Pass |
| 38 | a code for an unknown number needs purpose REGISTER, not the LOGIN default | Pass |
| 39 | a correct code on an unknown number asks for a name rather than failing | Pass |
| 40 | supplying a name creates the account and returns a session | Pass |
| 41 | an OTP-only account cannot be signed into with a password | Pass |
| 42 | an OTP-only account can set a first password without knowing one | Pass |
| 43 | one code survives the round trip that asks for a name | Pass |
| 44 | a provider registered by OTP still starts PENDING | Pass |
| 45 | nobody can register themselves as an administrator by OTP | Pass |
| 46 | signing in writes to D1 (DFD 0.1.3) | Pass |
| 47 | a user can see and end their sessions | Pass |

## System tests

| # | Test case | Result |
|---|---|---|
| 1 | availability is defined once (C.6, F.13) | Pass |
| 2 | an abandoned trip does not strand the patient (NF.1) | Pass |
| 3 | a booking cannot be left mid-match (NF.1) | Pass |
| 4 | analytics use the control room calendar (F.13) | Pass |
| 5 | list endpoints resolve related rows in bulk (NF.4) | Pass |
