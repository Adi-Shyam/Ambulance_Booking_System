# Test results

Ambulance Booking System — Team 16, IT303.

Generated from an actual run by `npm run test:report` on 2026-10-15T23:04:11.784Z.
Do not edit by hand; re-run the command instead.

## Summary

| Level | Purpose | Tests | Passed | Failed |
|---|---|---|---|---|
| Unit | One module in isolation | 91 | 91 | 0 |
| Integration | Modules working together over HTTP and the database | 121 | 121 | 0 |
| System | Whole-system behaviour and failure recovery | 11 | 11 | 0 |
| **Total** | | **223** | **223** | **0** |

All 223 tests passed.

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
| 30 | a code to an address is logged as an email | Pass |
| 31 | the response masks where the code went | Pass |
| 32 | the row records what is being proved and how it travelled | Pass |
| 33 | an existing account can be sent a code to prove its number | Pass |
| 34 | proving a number by email uses the address already on that account | Pass |
| 35 | verifying a number marks the number, not the address | Pass |
| 36 | a code for a number nobody holds is not a registration | Pass |
| 37 | a request naming neither an address nor a number is refused | Pass |
| 38 | an unrecognised channel is refused | Pass |
| 39 | an address can only ever be reached by email | Pass |
| 40 | a code for an unknown address needs purpose REGISTER, not the LOGIN default | Pass |
| 41 | the registration form creates nothing until the code comes back | Pass |
| 42 | a weak password is refused before a code is spent | Pass |
| 43 | an address already registered is refused before a code is spent | Pass |
| 44 | a correct code on an unknown address asks for what is missing | Pass |
| 45 | a name and a number create the account and return a session | Pass |
| 46 | the client is told which contacts are proved | Pass |
| 47 | an OTP-only account cannot be signed into with a password | Pass |
| 48 | an OTP-only account can set a first password without knowing one | Pass |
| 49 | one code survives the round trip that asks for more | Pass |
| 50 | a number already registered to someone else is refused | Pass |
| 51 | a provider registered by email still starts PENDING | Pass |
| 52 | nobody can register themselves as an administrator | Pass |
| 53 | a password shorter than the floor is refused | Pass |
| 54 | a password from the top of every breach list is refused | Pass |
| 55 | a password with no content is refused however long | Pass |
| 56 | a password made of the person own details is refused | Pass |
| 57 | a long passphrase is accepted without punctuation | Pass |
| 58 | a short password is accepted when it is genuinely mixed | Pass |
| 59 | signing in still accepts a password that predates the rules | Pass |
| 60 | a reset code reaches an account that exists | Pass |
| 61 | the reply is the same for an address with no account | Pass |
| 62 | a reset sets the new password and revokes every session | Pass |
| 63 | a reset will not accept a weak new password | Pass |
| 64 | a sign-in code cannot be used to reset a password | Pass |
| 65 | a reset code is single use | Pass |
| 66 | signing in writes to D1 (DFD 0.1.3) | Pass |
| 67 | a user can see and end their sessions | Pass |

## System tests

| # | Test case | Result |
|---|---|---|
| 1 | availability is defined once (C.6, F.13) | Pass |
| 2 | an abandoned trip does not strand the patient (NF.1) | Pass |
| 3 | a booking cannot be left mid-match (NF.1) | Pass |
| 4 | analytics use the control room calendar (F.13) | Pass |
| 5 | list endpoints resolve related rows in bulk (NF.4) | Pass |
