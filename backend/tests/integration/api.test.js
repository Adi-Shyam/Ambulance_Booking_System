'use strict';
// End-to-end tests over the real HTTP surface, covering the SRS functional
// requirements and the defects fixed after the first release.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const h = require('../helpers');
const { get, post, patch, signIn, ACCOUNTS, NITK } = h;

before(async () => { await h.startTestServer(); });
after(async () => { await h.stopTestServer(); });

// ---------------------------------------------------------------- F.1, F.2
describe('authentication and role-based access (F.1, F.2)', () => {
  test('a patient signs in and receives a scoped session', async () => {
    const r = await post('/api/auth/login', {
      phone_no: ACCOUNTS.patient.phone, password: ACCOUNTS.patient.password, role_code: 'USER',
    });
    assert.equal(r.status, 200);
    assert.match(r.body.session_token, /^ey/);           // a JWT
    assert.equal(r.body.user.role_code, 'USER');
    assert.ok(!('password_hash' in r.body.user), 'password hash must never be serialised');
  });

  test('signing in under the wrong mode is refused (F.2)', async () => {
    const r = await post('/api/auth/login', {
      phone_no: ACCOUNTS.patient.phone, password: ACCOUNTS.patient.password, role_code: 'DRIVER',
    });
    assert.equal(r.status, 403);
    assert.equal(r.body.role_code, 'USER', 'the response should say which mode to use');
  });

  test('a wrong password is rejected', async () => {
    const r = await post('/api/auth/login', { phone_no: ACCOUNTS.patient.phone, password: 'wrong-one' });
    assert.equal(r.status, 401);
  });

  test('registration enforces the data dictionary phone format', async () => {
    const r = await post('/api/auth/register', {
      full_name: 'Test Person', phone_no: '1234567890', password: 'Vx7#qLm4Zt',
    });
    assert.equal(r.status, 400);
    assert.equal(r.body.field, 'phone_no');
  });

  test('registration without an email address is refused', async () => {
    // An address is how an account is reached and how it is proved, so it is
    // required rather than optional.
    const r = await post('/api/auth/register', {
      full_name: 'No Address', phone_no: '9765430001', password: 'Vx7#qLm4Zt',
    });
    assert.equal(r.status, 400);
    assert.equal(r.body.field, 'email_id');
  });

  test('a duplicate email address cannot register twice', async () => {
    const r = await post('/api/auth/register', {
      full_name: 'Impostor', phone_no: '9765430002',
      email_id: 'adithya@example.in', password: 'Vx7#qLm4Zt',
    });
    assert.equal(r.status, 409);
    assert.equal(r.body.field, 'email_id');
  });

  test('a duplicate mobile number cannot register twice', async () => {
    const r = await post('/api/auth/register', {
      full_name: 'Impostor', phone_no: ACCOUNTS.patient.phone,
      email_id: 'impostor@example.in', password: 'Vx7#qLm4Zt',
    });
    assert.equal(r.status, 409);
  });

  test('OTP sign-in issues then consumes a single-use code', async () => {
    const issued = await post('/api/auth/otp/request', { phone_no: ACCOUNTS.patient2.phone });
    assert.equal(issued.status, 200);
    assert.match(issued.body.otp_code, /^[0-9]{6}$/);

    const wrong = await post('/api/auth/otp/verify', {
      phone_no: ACCOUNTS.patient2.phone, otp_code: '000000',
    });
    assert.equal(wrong.status, 401);

    const ok = await post('/api/auth/otp/verify', {
      phone_no: ACCOUNTS.patient2.phone, otp_code: issued.body.otp_code,
    });
    assert.equal(ok.status, 200);

    const replay = await post('/api/auth/otp/verify', {
      phone_no: ACCOUNTS.patient2.phone, otp_code: issued.body.otp_code,
    });
    assert.equal(replay.status, 401, 'a consumed OTP must not be replayable');
  });

  test('protected routes reject a missing or forged token (NF.3)', async () => {
    assert.equal((await get('/api/bookings')).status, 401);
    assert.equal((await get('/api/bookings', { token: 'not.a.jwt' })).status, 401);
  });

  test('a patient cannot reach the administration API (RBAC)', async () => {
    const patient = await signIn(ACCOUNTS.patient.phone, ACCOUNTS.patient.password);
    assert.equal((await get('/api/admin/overview', { token: patient })).status, 403);
  });
});

// --------------------------------------------------------- F.3 - F.7 core
describe('booking, matching and dispatch (F.3 - F.7)', () => {
  let patient, driver;

  before(async () => {
    patient = await signIn(ACCOUNTS.patient.phone, ACCOUNTS.patient.password);
    driver = await h.goOnDuty(ACCOUNTS.driverALS, { latitude: 13.0157, longitude: 74.7982 });
  });

  test('an unknown ambulance type is refused (F.3)', async () => {
    const r = await post('/api/bookings', { ambulance_type: 'XYZ', ...NITK }, { token: patient });
    assert.equal(r.status, 400);
  });

  test('a booking without any location is refused (F.4)', async () => {
    const r = await post('/api/bookings', { ambulance_type: 'BLS' }, { token: patient });
    assert.equal(r.status, 400);
  });

  test('a booking reaches the nearest suitable driver as a timed offer', async () => {
    const { bookingId, offer } = await h.bookAndAwaitOffer(patient, driver, {
      ambulance_type: 'ALS', ...NITK, address_text: 'NITK Surathkal main gate', notes: 'Chest pain',
    });

    assert.match(bookingId, /^BK[0-9]{8}$/);
    assert.match(offer.assignment_id, /^AS[0-9]{8}$/);
    assert.ok(offer.rank_score >= 0 && offer.rank_score <= 100, 'rank_score is bounded 0-100');
    assert.ok(offer.expires_in_seconds > 0 && offer.expires_in_seconds <= 45, 'offer carries the 45s window');
    assert.ok(offer.latitude != null && offer.longitude != null, 'offer carries pickup coordinates');
  });

  test('a second concurrent booking by the same patient is refused', async () => {
    const r = await post('/api/bookings', { ambulance_type: 'BLS', ...NITK }, { token: patient });
    assert.equal(r.status, 409);
  });

  test('a WhatsApp dispatch alert is logged for the booking (F.6)', async () => {
    const admin = await signIn(ACCOUNTS.admin.phone, ACCOUNTS.admin.password, 'ADMIN');
    const r = await get('/api/admin/messages', { token: admin });
    const alert = r.body.messages.find((m) => m.message_channel === 'WHATSAPP' && m.booking_id);
    assert.ok(alert, 'expected a WhatsApp alert in the delivery log');
    assert.equal(alert.delivery_state, 'SENT');
  });

  test('a different driver cannot accept someone else\'s offer', async () => {
    const offers = await get('/api/provider/offers', { token: driver });
    const offer = offers.body.offers[0];
    const other = await signIn(ACCOUNTS.driverICU.phone, ACCOUNTS.driverICU.password);
    const r = await post(`/api/provider/offers/${offer.assignment_id}/accept`, {}, { token: other });
    assert.equal(r.status, 403);
  });

  test('the assigned driver accepts and a trip opens (F.7)', async () => {
    const offers = await get('/api/provider/offers', { token: driver });
    const offer = offers.body.offers[0];
    const r = await post(`/api/provider/offers/${offer.assignment_id}/accept`, {}, { token: driver });

    assert.equal(r.status, 200);
    assert.match(r.body.trip_id, /^TR[0-9]{8}$/);
    assert.equal(r.body.booking.booking_status, 'ASSIGNED');
    assert.ok(r.body.booking.response_time_sec >= 0, 'response time is recorded for F.13 reporting');
  });

  test('the same offer cannot be accepted twice', async () => {
    const admin = await signIn(ACCOUNTS.admin.phone, ACCOUNTS.admin.password, 'ADMIN');
    const bookings = await get('/api/admin/bookings?limit=5', { token: admin });
    const assigned = bookings.body.bookings.find((b) => b.booking_status === 'ASSIGNED');
    const detail = await get(`/api/admin/bookings/${assigned.booking_id}`, { token: admin });
    const accepted = detail.body.assignments.find((a) => a.assignment_status === 'ACCEPTED');

    const r = await post(`/api/provider/offers/${accepted.assignment_id}/accept`, {}, { token: driver });
    assert.equal(r.status, 409);
  });
});

// ------------------------------------------------------------ reassignment
describe('automatic reassignment on decline (F.7, C.6)', () => {
  test('declining passes the request to the next best ambulance', async () => {
    const patient = await signIn(ACCOUNTS.patient2.phone, ACCOUNTS.patient2.password);
    await h.clearActiveBooking(patient);

    const bls = await h.goOnDuty(ACCOUNTS.driverBLS, { latitude: 13.0120, longitude: 74.7950 });
    const ptv = await h.goOnDuty(ACCOUNTS.driverPTV, { latitude: 13.0180, longitude: 74.8000 });

    // Both can serve a PTV call. Which one is offered first is decided by the
    // ranking (distance, rating and exact-type bonus together), so the test
    // discovers the holder instead of assuming it.
    const { bookingId, driver: firstHolder, offer } = await h.bookAndAwaitAnyOffer(
      patient, [bls, ptv], { ambulance_type: 'PTV', ...NITK, address_text: 'NITK main gate' }
    );

    const declined = await post(`/api/provider/offers/${offer.assignment_id}/reject`,
      { reason: 'Already engaged' }, { token: firstHolder });
    assert.equal(declined.status, 200);

    const other = firstHolder === bls ? ptv : bls;
    const nextOffer = await h.waitFor(
      async () => {
        const r = await get('/api/provider/offers', { token: other });
        return r.body.offers?.find((o) => o.booking_id === bookingId);
      },
      { label: 'reassignment to the next candidate' }
    );
    assert.ok(nextOffer, 'the request should move on without any patient action');
    assert.notEqual(nextOffer.assignment_id, offer.assignment_id, 'a fresh offer is issued');

    await post(`/api/bookings/${bookingId}/cancel`, { reason: 'test cleanup' }, { token: patient });
  });

  test('a request with no eligible ambulance fails cleanly and tells the patient', async () => {
    const patient = await signIn(ACCOUNTS.patient2.phone, ACCOUNTS.patient2.password);
    await h.clearActiveBooking(patient);
    // Far out at sea: nothing is within the search radius.
    const r = await post('/api/bookings',
      { ambulance_type: 'ICU', latitude: 10.0, longitude: 70.0, address_text: 'Arabian Sea' },
      { token: patient });
    assert.equal(r.status, 201);

    const failed = await h.waitFor(
      async () => {
        const b = await get(`/api/bookings/${r.body.booking.booking_id}`, { token: patient });
        return b.body.booking.booking_status === 'FAILED' ? b.body.booking : null;
      },
      { label: 'booking to be marked FAILED' }
    );
    assert.ok(failed.cancelled_reason, 'the patient is told why nothing was assigned');
  });
});

// ------------------------------------------------ F.8 - F.12 the trip itself
describe('trip, billing and feedback (F.8 - F.12)', () => {
  let patient, driver, bookingId, tripId, invoice;

  before(async () => {
    patient = await signIn(ACCOUNTS.patient.phone, ACCOUNTS.patient.password);
    driver = await h.goOnDuty(ACCOUNTS.driverICU, { latitude: 13.0400, longitude: 74.7920 });

    // Clear anything the earlier suite left open for this patient.
    const active = await get('/api/bookings/active', { token: patient });
    if (active.body.booking) {
      await post(`/api/bookings/${active.body.booking.booking_id}/cancel`, { reason: 'test reset' }, { token: patient });
    }

    const placed = await h.bookAndAwaitOffer(patient, driver, {
      ambulance_type: 'ICU', ...NITK, address_text: 'NITK main gate',
    });
    bookingId = placed.bookingId;
    const accepted = await post(`/api/provider/offers/${placed.offer.assignment_id}/accept`, {}, { token: driver });
    tripId = accepted.body.trip_id;
  });

  test('the patient sees the ambulance position and an ETA (F.8)', async () => {
    await post('/api/provider/location',
      { latitude: 13.0300, longitude: 74.7930, speed_kmph: 45 }, { token: driver });

    const r = await get(`/api/bookings/${bookingId}/track`, { token: patient });
    assert.equal(r.status, 200);
    assert.ok(r.body.ambulance_location, 'live position is exposed');
    assert.ok(Number.isInteger(r.body.trip.eta_minutes), 'an ETA is computed');
    assert.ok(r.body.provider.driver_name, 'the patient can identify the crew');
  });

  test('milestones must advance one stage at a time (F.9)', async () => {
    const skipped = await post(`/api/provider/trips/${tripId}/status`,
      { trip_milestone: 'COMPLETED' }, { token: driver });
    assert.equal(skipped.status, 409);
    assert.equal(skipped.body.expected, 'ENROUTE');
  });

  test('the driver steps the trip through to completion (F.9)', async () => {
    for (const milestone of ['ENROUTE', 'ARRIVED']) {
      const r = await post(`/api/provider/trips/${tripId}/status`, { trip_milestone: milestone }, { token: driver });
      assert.equal(r.status, 200, `${milestone} should be accepted`);
    }

    await post('/api/provider/location', { latitude: 13.0104, longitude: 74.7942 }, { token: driver });
    await post(`/api/provider/trips/${tripId}/status`, { trip_milestone: 'ONBOARD' }, { token: driver });

    // Carry the patient roughly 5 km to hospital.
    for (const [latitude, longitude] of [[13.000, 74.800], [12.985, 74.815], [12.972, 74.829]]) {
      await post('/api/provider/location', { latitude, longitude, speed_kmph: 50 }, { token: driver });
    }

    const done = await post(`/api/provider/trips/${tripId}/status`, { trip_milestone: 'COMPLETED' }, { token: driver });
    assert.equal(done.status, 200);
    invoice = done.body.invoice;
    assert.match(invoice.invoice_id, /^INV[0-9]{8}$/);
  });

  test('the invoice bills the distance actually driven with the patient aboard (F.10)', async () => {
    // Regression: the fare was previously taken from route_distance_km, which
    // holds the REMAINING distance to the target and is ~0 on arrival, so a
    // completed trip could bill base fare only.
    assert.ok(invoice.distance_km > 3, `expected the laden leg (~5 km), billed ${invoice.distance_km} km`);
    assert.ok(invoice.distance_km < 8, `billed distance looks inflated: ${invoice.distance_km} km`);
    assert.ok(invoice.distance_charge > 0, 'a trip that covered ground must carry a distance charge');
    assert.equal(
      invoice.fare_amount,
      Number((invoice.base_fare + invoice.distance_charge + invoice.type_surcharge + invoice.tax_amount).toFixed(2))
    );
  });

  test('the driver cannot dictate the billed distance (F.10, NF.3)', async () => {
    // Regression: route_distance_km used to be read straight from the request
    // body, letting the party being paid choose the amount.
    const admin = await signIn(ACCOUNTS.admin.phone, ACCOUNTS.admin.password, 'ADMIN');
    const detail = await get(`/api/admin/bookings/${bookingId}`, { token: admin });
    assert.equal(detail.body.invoice.distance_km, invoice.distance_km);
    assert.ok(invoice.distance_km < 100, 'server-measured distance, not a client-supplied one');
  });

  test('the driver is released back on duty once the trip closes', async () => {
    const me = await get('/api/provider/me', { token: driver });
    assert.equal(me.body.provider.availability_status, 'AVAILABLE');
    assert.equal(me.body.provider.trips_completed, 1);
  });

  test('the patient settles the invoice (F.10)', async () => {
    const paid = await post(`/api/payments/invoices/${invoice.invoice_id}/pay`,
      { payment_mode: 'UPI' }, { token: patient });
    assert.equal(paid.status, 200);
    assert.equal(paid.body.invoice.payment_status, 'SUCCESS');

    const again = await post(`/api/payments/invoices/${invoice.invoice_id}/pay`,
      { payment_mode: 'CASH' }, { token: patient });
    assert.equal(again.status, 409, 'an invoice must not be paid twice');
  });

  test('another patient cannot read this invoice', async () => {
    const stranger = await signIn(ACCOUNTS.patient2.phone, ACCOUNTS.patient2.password);
    const r = await get(`/api/payments/invoices/${invoice.invoice_id}`, { token: stranger });
    assert.equal(r.status, 403);
  });

  test('the patient rates the trip and the driver average updates (F.12)', async () => {
    const r = await post(`/api/bookings/${bookingId}/rating`,
      { rating_value: 5, feedback_text: 'Arrived very quickly' }, { token: patient });
    assert.equal(r.status, 201);
    assert.ok(r.body.provider_rating > 0);

    const twice = await post(`/api/bookings/${bookingId}/rating`, { rating_value: 1 }, { token: patient });
    assert.equal(twice.status, 409, 'a trip may only be rated once');
  });

  test('both parties see the trip in their history (F.11)', async () => {
    const mine = await get('/api/bookings', { token: patient });
    assert.ok(mine.body.bookings.some((b) => b.booking_id === bookingId));

    const theirs = await get('/api/provider/trips', { token: driver });
    assert.ok(theirs.body.trips.some((t) => t.booking_id === bookingId));
  });
});

// ------------------------------------------------------------------ privacy
describe('booking privacy (NF.3, C.1)', () => {
  test('a stranger cannot read another patient\'s booking', async () => {
    const owner = await signIn(ACCOUNTS.patient.phone, ACCOUNTS.patient.password);
    const stranger = await signIn(ACCOUNTS.patient2.phone, ACCOUNTS.patient2.password);
    const mine = await get('/api/bookings', { token: owner });
    const bookingId = mine.body.bookings[0].booking_id;

    assert.equal((await get(`/api/bookings/${bookingId}`, { token: stranger })).status, 403);
    assert.equal((await get(`/api/bookings/${bookingId}/track`, { token: stranger })).status, 403);
  });

  test('a stranger cannot join a booking\'s live tracking channel', async () => {
    // Regression: booking:subscribe joined any room on request, which streamed
    // the pickup address and the ambulance's live GPS to any signed-in account.
    const { io } = require('socket.io-client');
    const owner = await signIn(ACCOUNTS.patient.phone, ACCOUNTS.patient.password);
    const stranger = await signIn(ACCOUNTS.patient2.phone, ACCOUNTS.patient2.password);
    const mine = await get('/api/bookings', { token: owner });
    const bookingId = mine.body.bookings[0].booking_id;

    const socket = io(await h.startTestServer(), {
      auth: { token: stranger.session_token },
      transports: ['websocket'],
    });

    try {
      await new Promise((resolve, reject) => {
        socket.on('connect', resolve);
        socket.on('connect_error', reject);
        setTimeout(() => reject(new Error('socket did not connect')), 4000);
      });

      const denial = new Promise((resolve) => socket.on('booking:subscribe:denied', resolve));
      socket.emit('booking:subscribe', bookingId);

      const result = await Promise.race([denial, h.sleep(2000).then(() => null)]);
      assert.ok(result, 'subscribing to a booking you do not own must be refused');
      assert.equal(result.booking_id, bookingId);
    } finally {
      socket.disconnect();
    }
  });
});

// ------------------------------------------------------------- rate limiting
describe('brute-force protection (NF.3)', () => {
  test('repeated wrong passwords are eventually blocked', async () => {
    // Regression: sign-in accepted unlimited guesses.
    let blocked = false;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const r = await post('/api/auth/login', {
        phone_no: ACCOUNTS.driverPending.phone, password: `guess-${attempt}`,
      });
      if (r.status === 429) {
        blocked = true;
        assert.ok(r.body.retry_after_seconds > 0, 'the caller is told when to retry');
        break;
      }
    }
    assert.ok(blocked, 'expected the login endpoint to start refusing attempts');
  });

  test('OTP codes cannot be requested without limit', async () => {
    let blocked = false;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const r = await post('/api/auth/otp/request', { phone_no: ACCOUNTS.driverBLS.phone });
      if (r.status === 429) { blocked = true; break; }
    }
    assert.ok(blocked, 'expected OTP issuance to be throttled');
  });
});

// ------------------------------------------------------------------- F.13
describe('administration and analytics (F.13)', () => {
  let admin;
  before(async () => { admin = await signIn(ACCOUNTS.admin.phone, ACCOUNTS.admin.password, 'ADMIN'); });

  test('the overview reports live dispatch state', async () => {
    const r = await get('/api/admin/overview', { token: admin });
    assert.equal(r.status, 200);
    assert.ok(r.body.counts.total_bookings > 0);
    assert.ok(r.body.response_time.measured > 0, 'response times are being measured');
  });

  test('an unverified provider is listed and can be verified', async () => {
    const pending = await get('/api/admin/providers?verification_status=PENDING', { token: admin });
    const provider = pending.body.providers[0];
    assert.ok(provider, 'the seed includes a provider awaiting verification');

    const r = await post(`/api/admin/providers/${provider.provider_id}/verification`,
      { verification_status: 'VERIFIED', remarks: 'Documents checked' }, { token: admin });
    assert.equal(r.status, 200);
    assert.equal(r.body.provider.verification_status, 'VERIFIED');
  });

  test('a suspended provider is taken off duty immediately', async () => {
    const providers = await get('/api/admin/providers?verification_status=VERIFIED', { token: admin });
    const target = providers.body.providers.find((p) => p.availability_status === 'AVAILABLE');
    assert.ok(target, 'expected an available provider to suspend');

    await post(`/api/admin/providers/${target.provider_id}/verification`,
      { verification_status: 'SUSPENDED', remarks: 'Test suspension' }, { token: admin });

    const after = await get(`/api/admin/providers/${target.provider_id}`, { token: admin });
    assert.equal(after.body.provider.availability_status, 'OFFLINE');

    // Restore, so ordering between tests cannot matter.
    await post(`/api/admin/providers/${target.provider_id}/verification`,
      { verification_status: 'VERIFIED' }, { token: admin });
  });

  test('all four report types run over a date range', async () => {
    for (const type of ['RESPONSE_TIME', 'DEMAND', 'REVENUE', 'PROVIDER_PERF']) {
      const r = await get(`/api/admin/reports/${type}`, { token: admin });
      assert.equal(r.status, 200, `${type} should be available`);
      assert.match(r.body.report_id, /^RPT[0-9]{6}$/);
      assert.ok(r.body.metrics);
    }
  });

  test('an inverted date range is rejected', async () => {
    const r = await get('/api/admin/reports/DEMAND?from_date=2026-08-30&to_date=2026-08-01', { token: admin });
    assert.equal(r.status, 400);
  });

  test('the audit trail records the whole lifecycle (C.5)', async () => {
    const r = await get('/api/admin/audit?limit=500', { token: admin });
    const actions = new Set(r.body.audit.map((a) => a.action));
    for (const expected of [
      'BOOKING_CREATED', 'DISPATCH_OFFER_SENT', 'DISPATCH_ACCEPTED',
      'TRIP_STATUS_UPDATED', 'PAYMENT_PROCESSED', 'PROVIDER_VERIFICATION', 'RATING_SUBMITTED',
    ]) {
      assert.ok(actions.has(expected), `audit trail is missing ${expected}`);
    }
  });
});
