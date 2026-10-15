-- =====================================================================
-- Ambulance Booking System - relational schema
-- Team 16 (241IT005 / 241IT023 / 241IT063), IT303
--
-- Tables map onto the five data stores of the DFD model:
--   D1  User Account & Role Data ......... users, organisations, otps
--   D2  Availability & Vehicle Data ...... providers
--   D3  Booking & Assignment ............. bookings, assignments
--   D4  Trip Status & Location ........... trips, trip_locations
--   D5  Payments, Invoices & Ratings ..... invoices, ratings
-- Supporting tables: messages (F.6/F.14 delivery log), notifications,
-- audit_log (constraint C.5), fare_rules (F.10), id_counters.
-- =====================================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS id_counters (
  kind  TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

-- ------------------------------------------------------------------ D1
CREATE TABLE IF NOT EXISTS organisations (
  org_id              TEXT PRIMARY KEY,               -- 'O' + 6 digits
  org_name            TEXT NOT NULL,
  contact_phone       TEXT NOT NULL,
  contact_email       TEXT,
  address_text        TEXT,
  verification_status TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (verification_status IN ('PENDING','VERIFIED','REJECTED','SUSPENDED')),
  created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  user_id             TEXT PRIMARY KEY,               -- 'U' + 8 digits
  full_name           TEXT NOT NULL,
  phone_no            TEXT NOT NULL UNIQUE,           -- contact for the crew; also a login identifier
  -- UNIQUE because registration verifies an address and signs in by it. SQLite
  -- allows many NULLs under a UNIQUE column, so accounts predating this (and
  -- the seeded drivers) are unaffected.
  email_id            TEXT UNIQUE,
  -- Which contact details have actually been proved. Email is verified by a
  -- code at registration. A phone number is not: proving one needs an SMS
  -- gateway or an unblocked WhatsApp sender, so it is collected as contact
  -- data and marked honestly rather than implied to be checked.
  email_verified      INTEGER NOT NULL DEFAULT 0,
  phone_verified      INTEGER NOT NULL DEFAULT 0,
  password_hash       TEXT,                           -- bcrypt; NULL for OTP-only accounts
  role_code           TEXT NOT NULL
                      CHECK (role_code IN ('USER','DRIVER','ORG','ADMIN')),
  verification_status TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (verification_status IN ('PENDING','VERIFIED','REJECTED','SUSPENDED')),
  registration_date   TEXT NOT NULL,                  -- YYYY-MM-DD
  org_id              TEXT REFERENCES organisations(org_id),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role_code);

-- A code proves control of one contact detail, so the row is keyed on the
-- detail being proved rather than on the account. Registration verifies an
-- email address; the same table verifies a phone number when there is a way to
-- reach one (see `channel`).
CREATE TABLE IF NOT EXISTS otps (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  identifier      TEXT NOT NULL,                      -- the address or number being verified
  identifier_type TEXT NOT NULL DEFAULT 'PHONE'
                  CHECK (identifier_type IN ('PHONE','EMAIL')),
  otp_code        TEXT NOT NULL,                      -- 6 numeric digits
  otp_expiry      TEXT NOT NULL,                      -- issue time + 5 min
  purpose         TEXT NOT NULL DEFAULT 'LOGIN',
  channel         TEXT NOT NULL DEFAULT 'WHATSAPP'    -- how the code travelled
                  CHECK (channel IN ('WHATSAPP','EMAIL')),
  destination     TEXT,                               -- where it actually went
  consumed        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_otps_identifier ON otps(identifier, consumed);

-- DFD 0.1.3 Create Session & Assign Role writes the issued session into D1.
-- token_id is the JWT's `jti` claim, so a specific token can be revoked
-- without invalidating every other session the account holds.
CREATE TABLE IF NOT EXISTS sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id      TEXT UNIQUE,
  user_id       TEXT NOT NULL REFERENCES users(user_id),
  role_code     TEXT,
  issued_at     TEXT NOT NULL,
  token_expiry  TEXT NOT NULL,
  revoked       INTEGER NOT NULL DEFAULT 0,
  revoked_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, revoked);

-- ------------------------------------------------------------------ D2
CREATE TABLE IF NOT EXISTS providers (
  provider_id         TEXT PRIMARY KEY,               -- 'P' + 8 digits
  user_id             TEXT NOT NULL UNIQUE REFERENCES users(user_id),
  org_id              TEXT REFERENCES organisations(org_id),
  vehicle_reg_no      TEXT NOT NULL UNIQUE,           -- KA19AB1234
  ambulance_type      TEXT NOT NULL
                      CHECK (ambulance_type IN ('BLS','ALS','ICU','PTV')),  -- no EMG: that is a request, not a vehicle
  availability_status TEXT NOT NULL DEFAULT 'OFFLINE'
                      CHECK (availability_status IN ('AVAILABLE','BUSY','OFFLINE')),
  licence_no          TEXT,
  document_ref        TEXT,                           -- HTTPS object URL of the scan
  latitude            REAL,
  longitude           REAL,
  last_seen_timestamp TEXT,
  verification_status TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (verification_status IN ('PENDING','VERIFIED','REJECTED','SUSPENDED')),
  remarks             TEXT,
  rating_sum          INTEGER NOT NULL DEFAULT 0,
  rating_count        INTEGER NOT NULL DEFAULT 0,
  trips_completed     INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_providers_dispatch
  ON providers(availability_status, verification_status, ambulance_type);

-- ------------------------------------------------------------------ D3
CREATE TABLE IF NOT EXISTS bookings (
  booking_id          TEXT PRIMARY KEY,               -- 'BK' + 8 digits
  user_id             TEXT NOT NULL REFERENCES users(user_id),
  ambulance_type      TEXT NOT NULL
                      CHECK (ambulance_type IN ('BLS','ALS','ICU','PTV','EMG')),
  latitude            REAL NOT NULL,
  longitude           REAL NOT NULL,
  address_text        TEXT,
  landmark            TEXT,
  pincode             TEXT,
  place_id            TEXT,
  drop_latitude       REAL,
  drop_longitude      REAL,
  drop_address_text   TEXT,
  patient_name        TEXT,
  contact_phone       TEXT,
  notes               TEXT,
  booking_status      TEXT NOT NULL DEFAULT 'REQUESTED'
                      CHECK (booking_status IN ('REQUESTED','MATCHING','ASSIGNED','ENROUTE',
                                                'ARRIVED','ONBOARD','COMPLETED','CANCELLED','FAILED')),
  assigned_provider_id TEXT REFERENCES providers(provider_id),
  retry_count         INTEGER NOT NULL DEFAULT 0,
  booking_timestamp   TEXT NOT NULL,
  assigned_at         TEXT,
  completed_at        TEXT,
  cancelled_reason    TEXT,
  response_time_sec   INTEGER,                        -- booking -> confirmed assignment
  -- Set once by the recovery sweep when an accepted trip goes silent (NF.1).
  stall_flagged_at    TEXT,
  updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id, booking_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(booking_status);

CREATE TABLE IF NOT EXISTS assignments (
  assignment_id         TEXT PRIMARY KEY,             -- 'AS' + 8 digits
  booking_id            TEXT NOT NULL REFERENCES bookings(booking_id),
  provider_id           TEXT NOT NULL REFERENCES providers(provider_id),
  assignment_status     TEXT NOT NULL DEFAULT 'OFFERED'
                        CHECK (assignment_status IN ('OFFERED','ACCEPTED','REJECTED','TIMEOUT')),
  offer_expiry_timestamp TEXT NOT NULL,               -- offer time + 45 s
  rank_score            REAL,
  distance_km           REAL,
  response_timestamp    TEXT,
  created_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assign_booking ON assignments(booking_id);
CREATE INDEX IF NOT EXISTS idx_assign_provider ON assignments(provider_id, assignment_status);

-- ------------------------------------------------------------------ D4
CREATE TABLE IF NOT EXISTS trips (
  trip_id           TEXT PRIMARY KEY,                 -- 'TR' + 8 digits
  booking_id        TEXT NOT NULL UNIQUE REFERENCES bookings(booking_id),
  provider_id       TEXT NOT NULL REFERENCES providers(provider_id),
  trip_milestone    TEXT NOT NULL DEFAULT 'ASSIGNED'
                    CHECK (trip_milestone IN ('ASSIGNED','ENROUTE','ARRIVED','ONBOARD','COMPLETED')),
  trip_start_time   TEXT NOT NULL,
  trip_end_time     TEXT,
  route_polyline    TEXT,
  -- Remaining road distance to the current target, refreshed on every ping.
  -- This is a live tracking figure, NOT a billing figure.
  route_distance_km REAL,
  eta_minutes       INTEGER,
  -- Odometer readings accumulated server-side from the GPS trace. The fare is
  -- computed from laden_distance_km so the billed amount can never be dictated
  -- by the driver's device (F.10).
  distance_travelled_km REAL NOT NULL DEFAULT 0,   -- whole trip, for records
  laden_distance_km     REAL NOT NULL DEFAULT 0,   -- ONBOARD -> COMPLETED, billed
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trip_locations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id        TEXT NOT NULL REFERENCES trips(trip_id),
  provider_id    TEXT NOT NULL REFERENCES providers(provider_id),
  latitude       REAL NOT NULL,
  longitude      REAL NOT NULL,
  speed_kmph     REAL,
  trip_milestone TEXT,
  gps_timestamp  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_triploc ON trip_locations(trip_id, id DESC);

-- ------------------------------------------------------------------ D5
CREATE TABLE IF NOT EXISTS invoices (
  invoice_id        TEXT PRIMARY KEY,                 -- 'INV' + 8 digits
  booking_id        TEXT NOT NULL UNIQUE REFERENCES bookings(booking_id),
  trip_id           TEXT REFERENCES trips(trip_id),
  base_fare         REAL NOT NULL DEFAULT 0,
  distance_charge   REAL NOT NULL DEFAULT 0,
  type_surcharge    REAL NOT NULL DEFAULT 0,
  tax_amount        REAL NOT NULL DEFAULT 0,
  fare_amount       REAL NOT NULL DEFAULT 0,
  distance_km       REAL,
  payment_mode      TEXT CHECK (payment_mode IN ('UPI','CARD','NETBANKING','CASH')),
  payment_status    TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (payment_status IN ('PENDING','SUCCESS','FAILED','REFUNDED')),
  transaction_ref   TEXT,
  payment_timestamp TEXT,
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ratings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id    TEXT NOT NULL UNIQUE REFERENCES bookings(booking_id),
  user_id       TEXT NOT NULL REFERENCES users(user_id),
  provider_id   TEXT NOT NULL REFERENCES providers(provider_id),
  rating_value  INTEGER NOT NULL CHECK (rating_value BETWEEN 1 AND 5),
  feedback_text TEXT,
  created_at    TEXT NOT NULL
);

-- ------------------------------------------------------- support tables
CREATE TABLE IF NOT EXISTS fare_rules (
  ambulance_type TEXT PRIMARY KEY
                 CHECK (ambulance_type IN ('BLS','ALS','ICU','PTV','EMG')),
  base_fare      REAL NOT NULL,
  per_km_rate    REAL NOT NULL,
  type_surcharge REAL NOT NULL DEFAULT 0,
  label          TEXT NOT NULL,
  description    TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  message_id          TEXT PRIMARY KEY,
  booking_id          TEXT REFERENCES bookings(booking_id),
  -- Nullable since registration began with an email address: the first
  -- message to a new user is the code that creates their account, and at that
  -- moment there is no account and no number to attribute it to.
  recipient_phone     TEXT,
  recipient_email     TEXT,                             -- set when message_channel = 'EMAIL'
  message_channel     TEXT NOT NULL CHECK (message_channel IN ('WHATSAPP','PUSH','SMS','EMAIL')),
  message_template_id TEXT,
  body                TEXT,
  delivery_state      TEXT NOT NULL DEFAULT 'SENT'
                      CHECK (delivery_state IN ('SENT','DELIVERED','READ','FAILED')),
  delivery_timestamp  TEXT,
  provider_response   TEXT,
  created_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL REFERENCES users(user_id),
  booking_id TEXT REFERENCES bookings(booking_id),
  title      TEXT NOT NULL,
  body       TEXT,
  event_type TEXT,
  read_flag  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, id DESC);

-- F.14 - Expo push tokens, so an alert reaches a phone whose app is closed.
-- One row per device: a driver may carry a work phone and a personal one, and
-- a dispatch offer has to reach whichever is in their hand. A token is owned
-- by whoever last registered it, which is what the UNIQUE clause enforces -
-- re-registering moves it rather than delivering one person's offers to
-- another's handset after a shared device changes hands.
CREATE TABLE IF NOT EXISTS push_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(user_id),
  push_token  TEXT NOT NULL UNIQUE,
  platform    TEXT,
  device_name TEXT,
  last_seen   TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_tokens(user_id);

-- Constraint C.5: every booking, dispatch decision, status change and
-- administrative action is logged for reproducibility and dispute resolution.
CREATE TABLE IF NOT EXISTS audit_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id  TEXT,
  actor_role     TEXT,
  action         TEXT NOT NULL,
  entity_type    TEXT,
  entity_id      TEXT,
  details        TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(id DESC);
