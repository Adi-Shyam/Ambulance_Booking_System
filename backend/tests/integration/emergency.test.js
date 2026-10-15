'use strict';
// F.5 / F.6 - the EMG request type.
//
// An emergency differs from the other four in two ways, and both are asserted
// here: every ambulance in range is eligible regardless of its class, and they
// are all alerted at once rather than one at a time down the ranked list.
//
// EMG is deliberately not a vehicle class. "Emergency" describes what the
// caller needs, not what is parked outside the hospital, so no provider ever
// registers as one - which is also what makes "offer it to everybody" coherent.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  startTestServer, stopTestServer,
  get, post, patch, signIn, waitFor,
  ACCOUNTS, NITK, goOnDuty, clearActiveBooking,
} = require('../helpers');

// Required lazily: src/db resolves DB_FILE at load time, so touching it
// before startTestServer sets that variable would bind every query - and
// the server's own, through the module cache - to the real database.
const database = () => require('../../src/db').db;

const post_patch = (path, body, token) => patch(path, body, { token });

let patient; let admin;
const drivers = {};

const offersFor = (bookingId) =>
  database().prepare(
    'SELECT provider_id, assignment_status FROM assignments WHERE booking_id = ?'
  ).all(bookingId);

/** Places an EMG booking and waits until more than one ambulance holds an offer. */
async function bookEmergency() {
  await clearActiveBooking(patient);
  const placed = await post('/api/bookings', {
    ambulance_type: 'EMG', ...NITK, address_text: 'NITK main gate',
  }, { token: patient });
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  const bookingId = placed.body.booking.booking_id;

  await waitFor(
    () => (offersFor(bookingId).filter((a) => a.assignment_status === 'OFFERED').length > 1 ? true : null),
    { label: 'an emergency to reach more than one ambulance' }
  );
  return bookingId;
}

test.before(async () => {
  await startTestServer();
  admin = await signIn(ACCOUNTS.admin.phone, ACCOUNTS.admin.password);
  patient = await signIn(ACCOUNTS.patient.phone, ACCOUNTS.patient.password);
  // Four ambulances of four different classes, all at the pickup point.
  for (const key of ['driverBLS', 'driverALS', 'driverICU', 'driverPTV']) {
    drivers[key] = await goOnDuty(ACCOUNTS[key], NITK);
  }
});

test.after(async () => { await stopTestServer(); });

test('an emergency is offered to every nearby ambulance at once', async () => {
  const bookingId = await bookEmergency();
  const offered = offersFor(bookingId).filter((a) => a.assignment_status === 'OFFERED');

  assert.ok(
    offered.length >= 4,
    `all four on-duty ambulances should hold an offer, got ${offered.length}`
  );
});

test('an emergency ignores the tier rule that governs the other types', async () => {
  const bookingId = await bookEmergency();
  const offered = offersFor(bookingId).filter((a) => a.assignment_status === 'OFFERED');

  const types = database().prepare(
    `SELECT DISTINCT ambulance_type FROM providers WHERE provider_id IN
     (${offered.map(() => '?').join(',')})`
  ).all(...offered.map((o) => o.provider_id)).map((r) => r.ambulance_type).sort();

  // A PTV may not serve an ICU request, but anything may answer an emergency.
  assert.deepEqual(
    types, ['ALS', 'BLS', 'ICU', 'PTV'],
    'every class should be eligible, including the lowest'
  );
});

test('the first to accept takes it and the rest are closed', async () => {
  const bookingId = await bookEmergency();
  const offered = offersFor(bookingId).filter((a) => a.assignment_status === 'OFFERED');

  // Whichever driver holds the first offer accepts it.
  const mine = await (async () => {
    for (const [key, token] of Object.entries(drivers)) {
      const r = await get('/api/provider/offers', { token });
      const offer = r.body.offers?.find((o) => o.booking_id === bookingId);
      if (offer) return { key, token, offer };
    }
    throw new Error('no driver could see the emergency offer');
  })();

  assert.equal(mine.offer.broadcast, true, 'the console is told this went to several ambulances');

  const accepted = await post(
    `/api/provider/offers/${mine.offer.assignment_id}/accept`, undefined, { token: mine.token }
  );
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));

  const after = offersFor(bookingId);
  assert.equal(
    after.filter((a) => a.assignment_status === 'ACCEPTED').length, 1,
    'exactly one acceptance'
  );
  assert.equal(
    after.filter((a) => a.assignment_status === 'OFFERED').length, 0,
    'and nobody is left holding a live offer on a job that is gone'
  );
  assert.equal(
    offered.length - 1, after.filter((a) => a.assignment_status === 'TIMEOUT').length,
    'every other ambulance that was alerted had its offer closed'
  );
});

test('one driver declining an emergency does not fail it for the others', async () => {
  const bookingId = await bookEmergency();

  const mine = await (async () => {
    for (const token of Object.values(drivers)) {
      const r = await get('/api/provider/offers', { token });
      const offer = r.body.offers?.find((o) => o.booking_id === bookingId);
      if (offer) return { token, offer };
    }
    throw new Error('no driver could see the emergency offer');
  })();

  await post(`/api/provider/offers/${mine.offer.assignment_id}/reject`,
    { reason: 'Too far' }, { token: mine.token });

  const status = database()
    .prepare('SELECT booking_status FROM bookings WHERE booking_id = ?').get(bookingId).booking_status;
  assert.equal(status, 'MATCHING', 'the request is still being matched, not failed');

  assert.ok(
    offersFor(bookingId).some((a) => a.assignment_status === 'OFFERED'),
    'the other ambulances still hold their offers'
  );
});

test('EMG is a request, so no ambulance can be registered or reclassified as one', async () => {
  // Creating a profile and changing one are separate routes, and both have to
  // refuse: a vehicle that slipped into the EMG class would be eligible for
  // nothing, since no request ever asks for that class by name.
  const patch = await post_patch('/api/provider/profile', { ambulance_type: 'EMG' }, drivers.driverBLS);
  assert.equal(patch.status, 400, JSON.stringify(patch.body));
  assert.equal(patch.body.field, 'ambulance_type');

  const fresh = await signIn(ACCOUNTS.driverPending.phone, ACCOUNTS.driverPending.password);
  const create = await post('/api/provider/profile', {
    vehicle_reg_no: 'KA19EM0001', ambulance_type: 'EMG',
  }, { token: fresh });
  // 400 when the account has no profile yet, 409 when it already has one -
  // either way the EMG class is not reachable.
  assert.ok([400, 409].includes(create.status), `unexpected ${create.status}`);
  if (create.status === 400) assert.equal(create.body.field, 'ambulance_type');
});

test('an emergency has a fare rule of its own', async () => {
  const r = await get('/api/payments/fare-rules');
  const emg = r.body.fare_rules.find((f) => f.ambulance_type === 'EMG');

  assert.ok(emg, 'a request type with no fare rule would fail at the invoice');
  assert.ok(emg.base_fare > 0 && emg.per_km_rate > 0);
});

test('the control room can filter bookings by EMG', async () => {
  const r = await get('/api/admin/bookings?ambulance_type=EMG', { token: admin });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.bookings.length > 0, 'the emergencies placed above are findable');
  assert.ok(r.body.bookings.every((b) => b.ambulance_type === 'EMG'));
});
