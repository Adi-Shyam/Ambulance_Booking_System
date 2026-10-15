'use strict';
// In-app calling, and push token registration (F.6, F.14, C.5).
//
// Calling is a dialer handoff rather than voice carried in the app: a crew who
// cannot find a patient needs a call that works on a weak signal with the app
// in the background. What the server owes them is the number - released only
// between the two parties of a live booking, and logged when it is (C.5).
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  startTestServer, stopTestServer,
  call, get, post, signIn,
  waitFor, ACCOUNTS, NITK, goOnDuty, clearActiveBooking, bookAndAwaitOffer,
} = require('../helpers');

// Required lazily: src/db resolves DB_FILE at load time, so touching it
// before startTestServer sets that variable would bind every query - and
// the server's own, through the module cache - to the real database.
const database = () => require('../../src/db').db;

let patient; let patient2; let driver; let admin;
let bookingId;

test.before(async () => {
  await startTestServer();
  admin = await signIn(ACCOUNTS.admin.phone, ACCOUNTS.admin.password);
  patient = await signIn(ACCOUNTS.patient.phone, ACCOUNTS.patient.password);
  patient2 = await signIn(ACCOUNTS.patient2.phone, ACCOUNTS.patient2.password);
  driver = await goOnDuty(ACCOUNTS.driverALS, NITK);

  await clearActiveBooking(patient);
  const placed = await bookAndAwaitOffer(patient, driver, {
    ambulance_type: 'ALS', ...NITK, address_text: 'NITK main gate',
  });
  bookingId = placed.bookingId;
  await post(`/api/provider/offers/${placed.offer.assignment_id}/accept`, undefined, { token: driver });
});

test.after(async () => { await stopTestServer(); });

// --------------------------------------------------------------- calling

test('the patient is given the number of the driver coming for them', async () => {
  const r = await post(`/api/bookings/${bookingId}/call`, {}, { token: patient });

  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.to_role, 'DRIVER');
  assert.equal(r.body.phone_no, ACCOUNTS.driverALS.phone);
  assert.ok(r.body.name, 'and a name, so the dialer shows who is being rung');
});

test('the driver is given the number of the patient they are collecting', async () => {
  const r = await post(`/api/bookings/${bookingId}/call`, {}, { token: driver });

  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.to_role, 'PATIENT');
  assert.equal(r.body.phone_no, ACCOUNTS.patient.phone);
});

test('releasing a number is written to the audit trail (C.5)', async () => {
  await post(`/api/bookings/${bookingId}/call`, {}, { token: patient });

  const row = database().prepare(
    `SELECT action, entity_id, details FROM audit_log
     WHERE action = 'CALL_PLACED' AND entity_id = ? ORDER BY id DESC LIMIT 1`
  ).get(bookingId);

  assert.ok(row, 'a phone number handed out must leave a record of who asked');
  assert.match(row.details, /DRIVER/);
});

test('an unrelated patient cannot read either number', async () => {
  const r = await post(`/api/bookings/${bookingId}/call`, {}, { token: patient2 });
  assert.equal(r.status, 403, 'somebody else booking, somebody else phone number');
});

test('there is nobody to call before an ambulance is assigned', async () => {
  await clearActiveBooking(patient2);
  const placed = await post('/api/bookings', {
    ambulance_type: 'ICU', latitude: 12.0, longitude: 75.6, address_text: 'Far from any ambulance',
  }, { token: patient2 });

  const r = await post(`/api/bookings/${placed.body.booking.booking_id}/call`, {}, { token: patient2 });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /no ambulance is assigned/i);

  await clearActiveBooking(patient2);
});

test('the control room is put through to the crew, not the patient', async () => {
  const r = await post(`/api/bookings/${bookingId}/call`, {}, { token: admin });

  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.to_role, 'DRIVER', 'the control room rings the ambulance');
});

// ----------------------------------------------------------- push tokens

test('a device registers for alerts', async () => {
  const r = await post('/api/notifications/push-token', {
    push_token: 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]',
    platform: 'android',
    device_name: 'Demo phone',
  }, { token: driver });

  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.devices >= 1);
});

test('registering the same device twice does not duplicate it', async () => {
  const token = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]';
  const before = (await post('/api/notifications/push-token', { push_token: token }, { token: driver })).body.devices;
  const after = (await post('/api/notifications/push-token', { push_token: token }, { token: driver })).body.devices;

  assert.equal(after, before, 'one handset is one row however often it checks in');
});

test('a token that is not an Expo token is refused', async () => {
  const r = await post('/api/notifications/push-token', {
    push_token: 'some-firebase-key-pasted-by-mistake',
  }, { token: driver });

  assert.equal(r.status, 400);
  assert.equal(r.body.field, 'push_token');
});

test('a handset moves to whoever signed in on it', async () => {
  const shared = 'ExponentPushToken[cccccccccccccccccccccc]';
  await post('/api/notifications/push-token', { push_token: shared }, { token: driver });
  await post('/api/notifications/push-token', { push_token: shared }, { token: patient });

  const owner = database()
    .prepare('SELECT user_id FROM push_tokens WHERE push_token = ?').get(shared).user_id;
  const patientId = (await get('/api/auth/me', { token: patient })).body.user.user_id;

  assert.equal(
    owner, patientId,
    'a handed-over phone must not keep delivering the previous person dispatch offers'
  );
});

test('a device can be forgotten again', async () => {
  const token = 'ExponentPushToken[dddddddddddddddddddddd]';
  await post('/api/notifications/push-token', { push_token: token }, { token: driver });

  const del = await call('DELETE', '/api/notifications/push-token', {
    token: driver, body: { push_token: token },
  });
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal(
    database().prepare('SELECT 1 FROM push_tokens WHERE push_token = ?').get(token), undefined,
    'signing out of a shared phone leaves nothing behind'
  );
});

test('a dispatch offer is pushed, not only put in the inbox', async () => {
  await clearActiveBooking(patient);
  const driver2 = await goOnDuty(ACCOUNTS.driverICU, NITK);
  await post('/api/notifications/push-token', {
    push_token: 'ExponentPushToken[eeeeeeeeeeeeeeeeeeeeee]', platform: 'android',
  }, { token: driver2 });

  const placed = await bookAndAwaitOffer(patient, driver2, {
    ambulance_type: 'ICU', ...NITK, address_text: 'NITK main gate',
  });

  // The push is deliberately not awaited by the dispatch path - an alert
  // outage must not hold up an ambulance (NF.1) - so the row lands just after
  // the offer does.
  const pushed = await waitFor(
    () => {
      const n = database().prepare(
        `SELECT COUNT(*) AS n FROM messages
         WHERE booking_id = ? AND message_channel = 'PUSH'`
      ).get(placed.bookingId).n;
      return n > 0 ? n : null;
    },
    { label: 'a PUSH row in the delivery log' }
  );

  assert.ok(
    pushed > 0,
    'a driver with the app closed is exactly who a dispatch offer has to reach'
  );

  await clearActiveBooking(patient);
});
