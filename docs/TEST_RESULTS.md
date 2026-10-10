# Test results

Ambulance Booking System — Team 16, IT303.

Generated from an actual run by `npm run test:report` on 2026-10-10T20:06:41.186Z.
Do not edit by hand; re-run the command instead.

## Summary

| Level | Purpose | Tests | Passed | Failed |
|---|---|---|---|---|
| Unit | One module in isolation | 76 | 76 | 0 |
| Integration | Modules working together over HTTP and the database | 50 | 50 | 0 |
| System | Whole-system behaviour and failure recovery | 11 | 11 | 0 |
| **Total** | | **137** | **137** | **0** |

All 137 tests passed.

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
| 1 | authentication and role-based access (F.1, F.2) | Pass |
| 2 | booking, matching and dispatch (F.3 - F.7) | Pass |
| 3 | automatic reassignment on decline (F.7, C.6) | Pass |
| 4 | trip, billing and feedback (F.8 - F.12) | Pass |
| 5 | booking privacy (NF.3, C.1) | Pass |
| 6 | brute-force protection (NF.3) | Pass |
| 7 | administration and analytics (F.13) | Pass |
| 8 | signing in writes to D1 (DFD 0.1.3) | Pass |
| 9 | a user can see and end their sessions | Pass |

## System tests

| # | Test case | Result |
|---|---|---|
| 1 | availability is defined once (C.6, F.13) | Pass |
| 2 | an abandoned trip does not strand the patient (NF.1) | Pass |
| 3 | a booking cannot be left mid-match (NF.1) | Pass |
| 4 | analytics use the control room calendar (F.13) | Pass |
| 5 | list endpoints resolve related rows in bulk (NF.4) | Pass |
