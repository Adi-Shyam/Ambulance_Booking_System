'use strict';
// F.13 - the other direction: a passenger reports the crew that answered.
//
// Deliberately the same shape as a crew reporting a passenger - same table,
// same review queue, same rule that filing decides nothing. A complaints
// process that is easier to use in one direction than the other is not a
// complaints process, so these cases mirror reports.test.js on purpose.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  startTestServer, stopTestServer,
  get, post, signIn,
  ACCOUNTS, NITK, goOnDuty, clearActiveBooking, bookAndAwaitOffer,
} = require('../helpers');

// Required lazily: src/db resolves DB_FILE at load time, so touching it
// before startTestServer sets that variable would bind every query - and
// the server's own, through the module cache - to the real database.
const database = () => require('../../src/db').db;

let admin; let patient; let driver;

// The seeded class of each ambulance. A request is only ever offered to a
// vehicle that can serve it, so asking for the wrong class means the offer
// never arrives - which is the tier rule working, not a fault.
const CLASS_OF = {
  [ACCOUNTS.driverBLS.phone]: 'BLS',
  [ACCOUNTS.driverALS.phone]: 'ALS',
  [ACCOUNTS.driverICU.phone]: 'ICU',
  [ACCOUNTS.driverPTV.phone]: 'PTV',
};

/** A finished trip, so there is something to complain about. */
async function completedBooking(who, account = ACCOUNTS.driverALS) {
  await clearActiveBooking(who);
  const crew = await goOnDuty(account, NITK);
  const { bookingId, offer } = await bookAndAwaitOffer(who, crew, {
    ambulance_type: CLASS_OF[account.phone] || 'ALS',
    ...NITK,
    address_text: 'NITK main gate',
  });
  await post(`/api/provider/offers/${offer.assignment_id}/accept`, undefined, { token: crew });
  await post(`/api/bookings/${bookingId}/cancel`, { reason: 'test close' }, { token: who });
  return { bookingId, crew };
}

test.before(async () => {
  await startTestServer();
  admin = await signIn(ACCOUNTS.admin.phone, ACCOUNTS.admin.password);
  patient = await signIn(ACCOUNTS.patient.phone, ACCOUNTS.patient.password);
  driver = await goOnDuty(ACCOUNTS.driverALS, NITK);
});

test.after(async () => { await stopTestServer(); });

test('the passenger can report the crew that answered', async () => {
  const { bookingId } = await completedBooking(patient);

  const r = await post(`/api/bookings/${bookingId}/report`, {
    reason_code: 'UNSAFE_DRIVING',
    details: 'Overtook on a blind bend with the patient on board.',
  }, { token: patient });

  assert.equal(r.status, 201, JSON.stringify(r.body));

  const row = database().prepare('SELECT * FROM reports WHERE report_id = ?').get(r.body.report_id);
  assert.equal(row.reported_role, 'PROVIDER', 'the row says which way round it runs');
  assert.equal(row.report_status, 'OPEN', 'filing decides nothing, in either direction');
});

test('somebody else\'s booking cannot be reported', async () => {
  const { bookingId } = await completedBooking(patient);
  const stranger = await signIn(ACCOUNTS.patient2.phone, ACCOUNTS.patient2.password);

  const r = await post(`/api/bookings/${bookingId}/report`,
    { reason_code: 'ABUSIVE' }, { token: stranger });

  assert.equal(r.status, 403);
});

test('a trip still running cannot be reported', async () => {
  await clearActiveBooking(patient);
  driver = await goOnDuty(ACCOUNTS.driverALS, NITK);
  const { bookingId, offer } = await bookAndAwaitOffer(patient, driver, {
    ambulance_type: 'ALS', ...NITK, address_text: 'NITK main gate',
  });
  await post(`/api/provider/offers/${offer.assignment_id}/accept`, undefined, { token: driver });

  const r = await post(`/api/bookings/${bookingId}/report`,
    { reason_code: 'DID_NOT_ARRIVE' }, { token: patient });

  assert.equal(r.status, 409, 'somebody still waiting needs the ambulance, not a form');
  await clearActiveBooking(patient);
});

test('a reason meant for the other direction is refused', async () => {
  const { bookingId } = await completedBooking(patient);

  // FAKE_BOOKING is something a crew says about a passenger.
  const r = await post(`/api/bookings/${bookingId}/report`,
    { reason_code: 'FAKE_BOOKING' }, { token: patient });

  assert.equal(r.status, 400);
  assert.equal(r.body.field, 'reason_code');
});

test('the control room sees both directions in one queue', async () => {
  const r = await get('/api/admin/reports', { token: admin });

  assert.equal(r.status, 200);
  const roles = new Set(r.body.reports.map((x) => x.reported_role));
  assert.ok(
    roles.has('PROVIDER'),
    'a complaint about a crew reaches the same queue as one about a passenger'
  );
});

test('suspending a driver takes them off the road, not just out of the app', async () => {
  const subject = ACCOUNTS.driverPTV;
  const { bookingId } = await completedBooking(patient, subject);

  const filed = await post(`/api/bookings/${bookingId}/report`, {
    reason_code: 'ABUSIVE', details: 'Shouted at the patient.',
  }, { token: patient });
  assert.equal(filed.status, 201, JSON.stringify(filed.body));

  const before = database()
    .prepare('SELECT availability_status FROM providers WHERE user_id = (SELECT user_id FROM users WHERE phone_no = ?)')
    .get(subject.phone);
  assert.equal(before.availability_status, 'AVAILABLE', 'on duty before the ruling');

  const review = await post(`/api/admin/reports/${filed.body.report_id}/review`, {
    report_status: 'UPHELD', action: 'SUSPEND', review_remarks: 'Verified by the control room.',
  }, { token: admin });
  assert.equal(review.status, 200, JSON.stringify(review.body));

  const after = database()
    .prepare(`SELECT p.verification_status, p.availability_status, u.verification_status AS account
              FROM providers p JOIN users u ON u.user_id = p.user_id
              WHERE u.phone_no = ?`)
    .get(subject.phone);

  assert.equal(after.account, 'SUSPENDED', 'the account is locked');
  assert.equal(after.verification_status, 'SUSPENDED', 'and so is the vehicle');
  assert.equal(
    after.availability_status, 'OFFLINE',
    'otherwise the matcher still believes it is free and offers it the next emergency (C.6)'
  );
});

test('a suspended driver is not offered the next request', async () => {
  // The matcher and the dashboard share one definition of dispatchable, so a
  // suspended vehicle disappearing from this list is the same fact as it not
  // being dispatched.
  const nearby = await get(
    `/api/geo/nearby-ambulances?lat=${NITK.latitude}&lng=${NITK.longitude}&radius_km=15`,
    { token: patient }
  );

  const suspendedId = database()
    .prepare('SELECT provider_id FROM providers WHERE user_id = (SELECT user_id FROM users WHERE phone_no = ?)')
    .get(ACCOUNTS.driverPTV.phone).provider_id;

  assert.ok(
    !(nearby.body.ambulances || []).some((a) => a.provider_id === suspendedId),
    'a suspended ambulance must not appear as available to anybody'
  );
});
