'use strict';
// F.6 / F.14 - the lifecycle steps where the person is least likely to be
// looking at the screen must leave the building, not just land in the in-app
// inbox. An in-app notification is no use to a driver already on the road, or
// to a patient whose request has quietly failed.
//
// Each case asserts a WHATSAPP row in `messages`, which is what the mock
// transport and the Cloud API both write.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  startTestServer, stopTestServer,
  get, post, signIn, waitFor,
  ACCOUNTS, NITK, goOnDuty, clearActiveBooking, bookAndAwaitOffer,
} = require('../helpers');

// Required lazily: src/db resolves DB_FILE at load time, so touching it
// before startTestServer sets that variable would bind every query - and
// the server's own, through the module cache - to the real database.
const database = () => require('../../src/db').db;

let patient; let driver; let admin;

test.before(async () => {
  await startTestServer();
  admin = await signIn(ACCOUNTS.admin.phone, ACCOUNTS.admin.password);
  patient = await signIn(ACCOUNTS.patient.phone, ACCOUNTS.patient.password);
  driver = await goOnDuty(ACCOUNTS.driverALS, NITK);
});

test.after(async () => { await stopTestServer(); });

/** Did a WhatsApp message containing `needle` go to this number? */
const sentTo = (phone, needle) =>
  database().prepare(
    `SELECT COUNT(*) AS n FROM messages
     WHERE recipient_phone = ? AND message_channel = 'WHATSAPP' AND body LIKE ?`
  ).get(phone, `%${needle}%`).n > 0;

test('the driver is told by WhatsApp when the job is cancelled under them', async () => {
  await clearActiveBooking(patient);
  const { bookingId, offer } = await bookAndAwaitOffer(patient, driver, {
    ambulance_type: 'ALS', ...NITK, address_text: 'NITK main gate',
  });
  await post(`/api/provider/offers/${offer.assignment_id}/accept`, undefined, { token: driver });

  await post(`/api/bookings/${bookingId}/cancel`, { reason: 'No longer needed' }, { token: patient });

  assert.ok(
    sentTo(ACCOUNTS.driverALS.phone, 'BOOKING CANCELLED'),
    'a driver already heading to the pickup is told out of band'
  );
});

test('the patient is told by WhatsApp when the control room cancels', async () => {
  await clearActiveBooking(patient);
  driver = await goOnDuty(ACCOUNTS.driverALS, NITK);
  const { bookingId, offer } = await bookAndAwaitOffer(patient, driver, {
    ambulance_type: 'ALS', ...NITK, address_text: 'NITK main gate',
  });
  await post(`/api/provider/offers/${offer.assignment_id}/accept`, undefined, { token: driver });

  await post(`/api/admin/bookings/${bookingId}/cancel`, { reason: 'Duplicate request' }, { token: admin });

  assert.ok(
    sentTo(ACCOUNTS.patient.phone, 'CANCELLED BY THE CONTROL ROOM'),
    'the patient did not do this, so it has to reach them some other way'
  );
});

test('the patient is told by WhatsApp when nothing can be matched', async () => {
  await clearActiveBooking(patient);

  // Far outside SEARCH_RADIUS_KM, so no ambulance qualifies however many are on
  // duty. Taking the seeded drivers offline one by one would test the same path
  // more slowly and leave the fleet in a state later tests would inherit.
  const placed = await post('/api/bookings', {
    ambulance_type: 'ALS',
    latitude: 12.0,
    longitude: 75.6,
    address_text: 'Far outside the search radius',
  }, { token: patient });
  assert.equal(placed.status, 201, `booking was not placed: ${JSON.stringify(placed.body)}`);
  const bookingId = placed.body.booking.booking_id;

  await waitFor(
    () => database().prepare('SELECT booking_status FROM bookings WHERE booking_id = ?').get(bookingId)
            .booking_status === 'FAILED' || null,
    { label: 'booking to fail', timeout: 15000 }
  );

  assert.ok(
    sentTo(ACCOUNTS.patient.phone, 'NO AMBULANCE AVAILABLE'),
    'the patient waiting on an ambulance that is not coming is told'
  );
});
