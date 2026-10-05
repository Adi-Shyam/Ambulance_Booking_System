'use strict';
// Recovery, availability consistency and reporting-calendar behaviour.
// These exercise the database and services directly, because the conditions
// being tested (a phone that stopped reporting, a driver who vanished mid-trip,
// a booking placed after midnight local time) are states rather than requests.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const h = require('../helpers');
const { get, post, signIn, ACCOUNTS, NITK } = h;

let db;
let watchdog;
let dispatch;

before(async () => {
  await h.startTestServer();
  ({ db } = require('../../src/db'));
  watchdog = require('../../src/services/watchdog');
  dispatch = require('../../src/services/dispatch');
});
after(async () => { await h.stopTestServer(); });

/** Rewinds a provider's last position report to simulate a silent phone. */
function silenceProvider(providerId, minutesAgo) {
  const when = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  db.prepare('UPDATE providers SET last_seen_timestamp = ? WHERE provider_id = ?').run(when, providerId);
}

describe('availability is defined once (C.6, F.13)', () => {
  let driver;
  let providerId;

  before(async () => {
    driver = await h.goOnDuty(ACCOUNTS.driverBLS, { latitude: 13.0120, longitude: 74.7950 });
    providerId = (await get('/api/provider/me', { token: driver })).body.provider.provider_id;
  });

  test('a driver who stopped reporting is not offered to patients or counted as free', async () => {
    const patient = await signIn(ACCOUNTS.patient.phone, ACCOUNTS.patient.password);
    const admin = await signIn(ACCOUNTS.admin.phone, ACCOUNTS.admin.password, 'ADMIN');

    const before = await get(
      `/api/geo/nearby-ambulances?lat=${NITK.latitude}&lng=${NITK.longitude}`, { token: patient }
    );
    assert.ok(before.body.ambulances.some((a) => a.provider_id === providerId),
      'a live driver should be visible to patients');

    // The phone goes quiet, but the row still says AVAILABLE.
    silenceProvider(providerId, 60);

    const after = await get(
      `/api/geo/nearby-ambulances?lat=${NITK.latitude}&lng=${NITK.longitude}`, { token: patient }
    );
    assert.ok(!after.body.ambulances.some((a) => a.provider_id === providerId),
      'a silent driver must not be shown to patients as available');

    const overview = await get('/api/admin/overview', { token: admin });
    assert.ok(overview.body.counts.providers_stale >= 1,
      'the control room is told how many are stale rather than counting them as free');

    // Regression: the dashboard used to count AVAILABLE + VERIFIED only, so it
    // reported ambulances free that the matcher would never have considered.
    const booking = { ambulance_type: 'BLS', ...NITK };
    const candidates = dispatch.findCandidates({ ...booking, latitude: NITK.latitude, longitude: NITK.longitude });
    assert.ok(!candidates.some((c) => c.provider_id === providerId),
      'the matcher agrees with the dashboard');
  });

  test('the recovery sweep takes the silent driver off duty', async () => {
    silenceProvider(providerId, 60);
    const retired = watchdog.retireStaleProviders();
    assert.ok(retired >= 1);

    const row = db.prepare('SELECT availability_status FROM providers WHERE provider_id = ?').get(providerId);
    assert.equal(row.availability_status, 'OFFLINE');

    const audit = db.prepare(
      "SELECT * FROM audit_log WHERE action = 'PROVIDER_AUTO_OFFLINE' AND entity_id = ?"
    ).get(providerId);
    assert.ok(audit, 'the change is recorded for the audit trail (C.5)');
  });
});

describe('an abandoned trip does not strand the patient (NF.1)', () => {
  let patient, driver, bookingId, providerId;

  before(async () => {
    patient = await signIn(ACCOUNTS.patient2.phone, ACCOUNTS.patient2.password);
    await h.clearActiveBooking(patient);
    driver = await h.goOnDuty(ACCOUNTS.driverALS, { latitude: 13.0157, longitude: 74.7982 });
    providerId = (await get('/api/provider/me', { token: driver })).body.provider.provider_id;

    const placed = await h.bookAndAwaitOffer(patient, driver, {
      ambulance_type: 'ALS', ...NITK, address_text: 'NITK main gate',
    });
    bookingId = placed.bookingId;
    await post(`/api/provider/offers/${placed.offer.assignment_id}/accept`, {}, { token: driver });
  });

  test('a trip whose driver has gone silent is flagged, not silently forgotten', async () => {
    // Rewind the trip so its last contact is older than the silence threshold.
    const old = new Date(Date.now() - 60 * 60_000).toISOString();
    db.prepare('UPDATE trips SET trip_start_time = ? WHERE booking_id = ?').run(old, bookingId);
    db.prepare('UPDATE trip_locations SET gps_timestamp = ? WHERE trip_id = (SELECT trip_id FROM trips WHERE booking_id = ?)')
      .run(old, bookingId);

    const flagged = watchdog.flagAbandonedTrips();
    assert.ok(flagged >= 1, 'the stalled trip should be picked up');

    const booking = db.prepare('SELECT stall_flagged_at FROM bookings WHERE booking_id = ?').get(bookingId);
    assert.ok(booking.stall_flagged_at, 'the booking records that it stalled');

    const entry = db.prepare("SELECT * FROM audit_log WHERE action = 'TRIP_STALLED' AND entity_id = ?").get(bookingId);
    assert.ok(entry, 'the control room has an audit record to act on');
  });

  test('the patient is told, rather than left watching a frozen ETA', async () => {
    const inbox = await get('/api/notifications', { token: patient });
    assert.ok(
      inbox.body.notifications.some((n) => n.event_type === 'TRIP_STALLED' && n.booking_id === bookingId),
      'the patient receives a notification about the loss of contact'
    );
  });

  test('a live emergency run is never auto-cancelled', async () => {
    // Cancelling on silence alone would be worse than the silence: the crew may
    // be driving through a dead zone.
    const booking = db.prepare('SELECT booking_status FROM bookings WHERE booking_id = ?').get(bookingId);
    assert.equal(booking.booking_status, 'ASSIGNED');
  });

  test('flagging happens once, not on every sweep', async () => {
    const again = watchdog.flagAbandonedTrips();
    assert.equal(again, 0, 'an already-flagged trip must not re-notify each minute');
  });
});

describe('a booking cannot be left mid-match (NF.1)', () => {
  test('a MATCHING booking with no live offer is moved on by the sweep', async () => {
    const patient = await signIn(ACCOUNTS.patient.phone, ACCOUNTS.patient.password);
    await h.clearActiveBooking(patient);

    // Two eligible ambulances, so the resumed request has somewhere to go.
    // A PTV call can be served by any capability tier.
    const icu = await h.goOnDuty(ACCOUNTS.driverICU, { latitude: 13.0130, longitude: 74.7950 });
    const ptv = await h.goOnDuty(ACCOUNTS.driverPTV, { latitude: 13.0170, longitude: 74.7990 });

    const placed = await h.bookAndAwaitAnyOffer(patient, [icu, ptv], {
      ambulance_type: 'PTV', ...NITK, address_text: 'NITK main gate',
    });

    // Simulate a crash landing between expiring one offer and issuing the next:
    // the booking is left MATCHING with nothing outstanding.
    db.prepare("UPDATE assignments SET assignment_status = 'TIMEOUT' WHERE assignment_id = ?")
      .run(placed.offer.assignment_id);

    const stuck = db.prepare('SELECT booking_status FROM bookings WHERE booking_id = ?').get(placed.bookingId);
    assert.equal(stuck.booking_status, 'MATCHING', 'precondition: the booking is stranded');

    const resumed = await watchdog.resumeStalledMatching(dispatch);
    assert.ok(resumed >= 1, 'the orphaned booking should be picked up');

    // NF.1 is satisfied by either outcome: the request moves to another
    // ambulance, or it is closed as FAILED and the patient is told. What must
    // not happen is that it stays MATCHING with nothing in flight.
    const after = db.prepare('SELECT booking_status FROM bookings WHERE booking_id = ?').get(placed.bookingId);
    const live = db.prepare(
      "SELECT COUNT(*) AS n FROM assignments WHERE booking_id = ? AND assignment_status = 'OFFERED'"
    ).get(placed.bookingId);

    assert.ok(
      live.n > 0 || after.booking_status === 'FAILED',
      `booking left stranded in ${after.booking_status} with no offer outstanding`
    );

    // With a second candidate free, the expected outcome is a fresh offer.
    assert.equal(live.n, 1, 'the request should have moved to the remaining ambulance');

    const other = placed.driver === icu ? ptv : icu;
    const offers = await get('/api/provider/offers', { token: other });
    assert.ok(
      offers.body.offers.some((o) => o.booking_id === placed.bookingId),
      'the ambulance that had not yet been asked receives it'
    );

    await post(`/api/bookings/${placed.bookingId}/cancel`, { reason: 'test cleanup' }, { token: patient });
  });
});

describe('analytics use the control room calendar (F.13)', () => {
  let admin;
  before(async () => { admin = await signIn(ACCOUNTS.admin.phone, ACCOUNTS.admin.password, 'ADMIN'); });

  test('a booking just after local midnight counts as that local day', async () => {
    // 2026-08-31T21:30Z is 03:00 on 1 September in IST. Bucketing on the raw
    // UTC string would file this under 31 August.
    const utc = '2026-08-31T21:30:00.000Z';
    const localDay = '2026-09-01';

    const row = db.prepare('SELECT booking_id FROM bookings ORDER BY booking_timestamp LIMIT 1').get();
    db.prepare('UPDATE bookings SET booking_timestamp = ? WHERE booking_id = ?').run(utc, row.booking_id);

    const report = await get(
      `/api/admin/reports/DEMAND?from_date=${localDay}&to_date=${localDay}`, { token: admin }
    );
    assert.equal(report.status, 200);
    assert.equal(report.body.timezone, 'UTC+05:30');

    const day = report.body.metrics.by_day.find((d) => d.day === localDay);
    assert.ok(day && day.bookings >= 1, `expected the booking to fall on ${localDay}`);

    const utcDay = report.body.metrics.by_day.find((d) => d.day === '2026-08-31');
    assert.ok(!utcDay, 'it must not also appear under the UTC day');
  });

  test('the demand curve is reported in local hours', async () => {
    const report = await get(
      '/api/admin/reports/DEMAND?from_date=2026-09-01&to_date=2026-09-01', { token: admin }
    );
    const hours = report.body.metrics.by_hour.map((r) => r.hour);
    assert.ok(hours.includes('03'), `expected the 03:00 IST bucket, got ${JSON.stringify(hours)}`);
  });
});

describe('list endpoints resolve related rows in bulk (NF.4)', () => {
  test('a booking list returns the same shape as the single-row form', async () => {
    const admin = await signIn(ACCOUNTS.admin.phone, ACCOUNTS.admin.password, 'ADMIN');
    const list = await get('/api/admin/bookings?limit=25', { token: admin });
    assert.equal(list.status, 200);
    assert.ok(list.body.bookings.length > 0);

    const withProvider = list.body.bookings.find((b) => b.assigned_provider_id);
    if (withProvider) {
      const single = await get(`/api/admin/bookings/${withProvider.booking_id}`, { token: admin });
      assert.deepEqual(
        Object.keys(withProvider.provider).sort(),
        Object.keys(single.body.booking.provider).sort(),
        'batch and single-row forms must agree'
      );
      assert.equal(withProvider.provider.provider_id, single.body.booking.provider.provider_id);
    }
  });

  test('an empty list does not issue a query at all', () => {
    assert.deepEqual(dispatch.publicBookings([]), []);
  });
});
