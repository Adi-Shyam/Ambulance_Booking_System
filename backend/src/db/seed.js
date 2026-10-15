'use strict';
// Demo data so the three apps can be shown end to end straight after install.
// Run:  npm run seed          (adds data if the tables are empty)
//       npm run reset         (wipes and re-seeds)
const fs = require('node:fs');
const bcrypt = require('bcryptjs');
const { db, migrate, nowIso, DB_FILE } = require('./index');
const { nextId } = require('../utils/ids');

const RESET = process.argv.includes('--reset');

// Points around NITK Surathkal / Mangaluru, so the demo map has real geography.
const NITK = { latitude: 13.010389, longitude: 74.794243 };
const AROUND = [
  { latitude: 13.0157, longitude: 74.7982 },
  { latitude: 12.9982, longitude: 74.8021 },
  { latitude: 13.0224, longitude: 74.7891 },
  { latitude: 12.9721, longitude: 74.8290 },
  { latitude: 12.9141, longitude: 74.8560 },
  { latitude: 13.0512, longitude: 74.7801 },
];

function wipe() {
  const tables = [
    'ratings', 'invoices', 'trip_locations', 'trips', 'assignments', 'bookings',
    'notifications', 'messages', 'audit_log', 'sessions', 'otps',
    'providers', 'users', 'organisations', 'id_counters',
  ];
  db.exec('PRAGMA foreign_keys = OFF');
  for (const t of tables) db.exec(`DELETE FROM ${t}`);
  db.exec('PRAGMA foreign_keys = ON');
}

function createUser({ full_name, phone_no, email_id, role_code, password, verification_status, org_id = null }) {
  const now = nowIso();
  const user_id = nextId('user');
  db.prepare(
    `INSERT INTO users (user_id, full_name, phone_no, email_id, email_verified, phone_verified,
                        password_hash, role_code, verification_status, registration_date,
                        org_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`
  ).run(user_id, full_name, phone_no, email_id,
        // Reference data, so an address that is seeded counts as proved and
        // the demo accounts can sign in by email. No seeded number is proved:
        // nothing here checked one, and the flag says so.
        email_id ? 1 : 0,
        bcrypt.hashSync(password, 12), role_code,
        verification_status, now.slice(0, 10), org_id, now, now);
  return user_id;
}

function createProvider({ user_id, org_id, vehicle_reg_no, ambulance_type, availability_status, location, licence_no, verification_status, rating_sum, rating_count }) {
  const now = nowIso();
  const provider_id = nextId('provider');
  db.prepare(
    `INSERT INTO providers (provider_id, user_id, org_id, vehicle_reg_no, ambulance_type,
                            availability_status, licence_no, latitude, longitude,
                            last_seen_timestamp, verification_status, rating_sum, rating_count,
                            created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(provider_id, user_id, org_id, vehicle_reg_no, ambulance_type, availability_status,
        licence_no, location.latitude, location.longitude, now, verification_status,
        rating_sum || 0, rating_count || 0, now, now);
  return provider_id;
}

function seed() {
  migrate();

  if (RESET) {
    wipe();
    console.log('Existing demo data cleared.');
  } else if (db.prepare('SELECT COUNT(*) AS c FROM users').get().c > 0) {
    console.log('Database already has accounts - nothing to do. Use "npm run reset" to rebuild.');
    return;
  }

  const now = nowIso();
  const org_id = nextId('org');
  db.prepare(
    `INSERT INTO organisations (org_id, org_name, contact_phone, contact_email, address_text,
                                verification_status, created_at)
     VALUES (?, ?, ?, ?, ?, 'VERIFIED', ?)`
  ).run(org_id, 'Surathkal Emergency Services', '9845012345', 'ops@ses-mangaluru.in',
        'NH66, Surathkal, Mangaluru 575014', now);

  // ---- administrator ----
  createUser({
    full_name: 'Control Room Admin', phone_no: '9000000001', email_id: 'admin@abs.local',
    role_code: 'ADMIN', password: 'admin123', verification_status: 'VERIFIED',
  });

  // ---- patients ----
  const patients = [
    ['Adithya Shyam', '9800000001', 'adithya@example.in'],
    ['Dev Patel', '9800000002', 'dev@example.in'],
    ['Ritesh Bhagat', '9800000003', 'ritesh@example.in'],
  ].map(([full_name, phone_no, email_id]) =>
    createUser({ full_name, phone_no, email_id, role_code: 'USER', password: 'user123', verification_status: 'VERIFIED' })
  );

  // ---- drivers / ambulances ----
  const driverSpecs = [
    { name: 'Ramesh Kumar', email: 'ramesh@example.in', phone: '9700000001', reg: 'KA19AB1234', type: 'BLS', status: 'AVAILABLE', verify: 'VERIFIED', org: org_id, rating: [23, 5] },
    { name: 'Suresh Naik', email: 'suresh@example.in', phone: '9700000002', reg: 'KA19CD5678', type: 'ALS', status: 'AVAILABLE', verify: 'VERIFIED', org: org_id, rating: [18, 4] },
    { name: 'Fatima Sheikh', email: 'fatima@example.in', phone: '9700000003', reg: 'KA20EF9012', type: 'ICU', status: 'AVAILABLE', verify: 'VERIFIED', org: null, rating: [29, 6] },
    { name: 'Anil Shetty', email: 'anil@example.in', phone: '9700000004', reg: 'KA19GH3456', type: 'PTV', status: 'AVAILABLE', verify: 'VERIFIED', org: null, rating: [12, 3] },
    { name: 'Joseph DSouza', email: 'joseph@example.in', phone: '9700000005', reg: 'KA21IJ7890', type: 'BLS', status: 'OFFLINE', verify: 'VERIFIED', org: org_id, rating: [8, 2] },
    { name: 'Priya Rao', email: 'priya@example.in', phone: '9700000006', reg: 'KA19KL2345', type: 'ALS', status: 'OFFLINE', verify: 'PENDING', org: null, rating: [0, 0] },
  ];

  const providers = driverSpecs.map((d, i) => {
    const user_id = createUser({
      full_name: d.name, phone_no: d.phone, email_id: d.email,
      role_code: d.org ? 'ORG' : 'DRIVER', password: 'driver123',
      verification_status: d.verify, org_id: d.org,
    });
    return createProvider({
      user_id, org_id: d.org, vehicle_reg_no: d.reg, ambulance_type: d.type,
      availability_status: d.status, location: AROUND[i % AROUND.length],
      licence_no: `KA19${20180000 + i}`, verification_status: d.verify,
      rating_sum: d.rating[0], rating_count: d.rating[1],
    });
  });

  // ---- a completed trip in history, so reports are not empty ----
  const booking_id = nextId('booking');
  const trip_id = nextId('trip');
  const assignment_id = nextId('assignment');
  const invoice_id = nextId('invoice');
  const placed = new Date(Date.now() - 26 * 3600_000).toISOString();
  const accepted = new Date(Date.parse(placed) + 38_000).toISOString();
  const finished = new Date(Date.parse(placed) + 42 * 60_000).toISOString();

  db.prepare(
    `INSERT INTO bookings (booking_id, user_id, ambulance_type, latitude, longitude, address_text,
                           landmark, pincode, patient_name, contact_phone, notes, booking_status,
                           assigned_provider_id, retry_count, booking_timestamp, assigned_at,
                           completed_at, response_time_sec, updated_at)
     VALUES (?, ?, 'ALS', ?, ?, ?, ?, '575025', 'Elderly patient', '9800000001',
             'Chest pain, conscious', 'COMPLETED', ?, 1, ?, ?, ?, 38, ?)`
  ).run(booking_id, patients[0], NITK.latitude, NITK.longitude,
        'NITK Surathkal main gate, Mangaluru', 'Near the flyover',
        providers[1], placed, accepted, finished, finished);

  db.prepare(
    `INSERT INTO assignments (assignment_id, booking_id, provider_id, assignment_status,
                              offer_expiry_timestamp, rank_score, distance_km, response_timestamp, created_at)
     VALUES (?, ?, ?, 'ACCEPTED', ?, 82.5, 2.4, ?, ?)`
  ).run(assignment_id, booking_id, providers[1],
        new Date(Date.parse(placed) + 45_000).toISOString(), accepted, placed);

  db.prepare(
    `INSERT INTO trips (trip_id, booking_id, provider_id, trip_milestone, trip_start_time,
                        trip_end_time, route_distance_km, eta_minutes, updated_at)
     VALUES (?, ?, ?, 'COMPLETED', ?, ?, 12.6, 0, ?)`
  ).run(trip_id, booking_id, providers[1], accepted, finished, finished);

  const fare = require('../services/fare').calculate('ALS', 12.6);
  db.prepare(
    `INSERT INTO invoices (invoice_id, booking_id, trip_id, base_fare, distance_charge, type_surcharge,
                           tax_amount, fare_amount, distance_km, payment_mode, payment_status,
                           transaction_ref, payment_timestamp, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'UPI', 'SUCCESS', 'mock_seed_txn', ?, ?)`
  ).run(invoice_id, booking_id, trip_id, fare.base_fare, fare.distance_charge, fare.type_surcharge,
        fare.tax_amount, fare.fare_amount, fare.distance_km, finished, finished);

  db.prepare(
    `INSERT INTO ratings (booking_id, user_id, provider_id, rating_value, feedback_text, created_at)
     VALUES (?, ?, ?, 5, 'Reached in under 6 minutes. Paramedic was excellent.', ?)`
  ).run(booking_id, patients[0], providers[1], finished);

  db.prepare(
    `INSERT INTO audit_log (actor_user_id, actor_role, action, entity_type, entity_id, details, created_at)
     VALUES (?, 'USER', 'BOOKING_CREATED', 'booking', ?, ?, ?)`
  ).run(patients[0], booking_id, JSON.stringify({ ambulance_type: 'ALS', seeded: true }), placed);

  console.log(`\nDemo data written to ${DB_FILE}\n`);
  console.log('  Sign-in details (all roles)');
  console.log('  ---------------------------------------------------------');
  console.log('  Administrator   9000000001 / admin123    (admin dashboard)');
  console.log('  Patient         9800000001 / user123     (customer app)');
  console.log('  Patient         9800000002 / user123');
  console.log('  Driver (ALS)    9700000002 / driver123   (driver app)');
  console.log('  Driver (ICU)    9700000003 / driver123');
  console.log('  Driver (PTV)    9700000004 / driver123');
  console.log('  Unverified      9700000006 / driver123   (pending approval)');
  console.log('  ---------------------------------------------------------\n');
}

if (require.main === module) {
  if (RESET && !fs.existsSync(DB_FILE)) console.log('No existing database - creating a new one.');
  seed();
}

module.exports = { seed };
