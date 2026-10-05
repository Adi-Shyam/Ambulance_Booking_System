'use strict';
// End-to-end smoke test against a running backend on :4000.
// Exercises F.1 -> F.12: auth, availability, booking, dispatch, accept,
// milestones, invoice, payment, rating. Leaves the fleet as it found it.

const BASE = 'http://localhost:4000';
let failures = 0;

const log = (ok, label, extra = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
};

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const login = async (phone_no, password) => {
  const r = await call('POST', '/api/auth/login', { body: { phone_no, password } });
  if (!r.json.session_token) throw new Error(`login ${phone_no} failed: ${r.json.error}`);
  return r.json.session_token;
};

(async () => {
  // ---------------------------------------------------------------- F.1/F.2
  const health = await call('GET', '/health');
  log(health.json.status === 'ok', 'health', `maps=${health.json.maps_provider} wa=${health.json.whatsapp_transport}`);

  const driver = await login('9700000002', 'driver123');
  const patient = await login('9800000001', 'user123');
  const admin = await login('9000000001', 'admin123');
  log(true, 'auth: driver, patient, admin signed in');

  // Role gate: the patient must not reach a provider route.
  const forbidden = await call('GET', '/api/provider/me', { token: patient });
  log(forbidden.status === 403, 'RBAC: patient blocked from provider route', `got ${forbidden.status}`);

  // ------------------------------------------------------------- D2 on duty
  await call('POST', '/api/provider/availability', { token: driver, body: { availability_status: 'AVAILABLE' } });
  await call('POST', '/api/provider/location', { token: driver, body: { latitude: 12.9982, longitude: 74.8021 } });
  const me = await call('GET', '/api/provider/me', { token: driver });
  log(me.json.provider?.availability_status === 'AVAILABLE', 'driver on duty + position reported');

  // The patient's nearby list must agree with what the matcher would find.
  const nearby = await call('GET', '/api/geo/nearby-ambulances?lat=13.0104&lng=74.7984', { token: patient });
  log(nearby.json.count >= 1, 'nearby-ambulances sees the on-duty vehicle', `count=${nearby.json.count}`);

  // ------------------------------------------------------------- F.3 booking
  const booking = await call('POST', '/api/bookings', {
    token: patient,
    body: { ambulance_type: 'ALS', latitude: 13.0104, longitude: 74.7984, address_text: 'NITK Surathkal main gate' },
  });
  const bookingId = booking.json.booking?.booking_id;
  log(Boolean(bookingId), 'booking placed', bookingId || booking.json.error);

  // ------------------------------------------------------- F.5/F.6 dispatch
  let offer = null;
  for (let i = 0; i < 20 && !offer; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    const inbox = await call('GET', '/api/provider/offers', { token: driver });
    offer = inbox.json.offers?.find((o) => o.booking_id === bookingId) || null;
  }
  log(Boolean(offer), 'offer reached the driver', offer ? `rank=${offer.rank_score} ${offer.distance_km}km` : 'none');

  // ---------------------------------------------------------- F.7 accept
  const accepted = await call('POST', `/api/provider/offers/${offer.assignment_id}/accept`, { token: driver });
  const tripId = accepted.json.trip_id;
  log(Boolean(tripId), 'offer accepted, trip opened', tripId || accepted.json.error);

  // ------------------------------------------------- F.8 tracking + ETA
  await call('POST', '/api/provider/location', { token: driver, body: { latitude: 13.0050, longitude: 74.8000 } });
  const track = await call('GET', `/api/bookings/${bookingId}/track`, { token: patient });
  log(track.json.trip?.eta_minutes != null, 'patient can track with a live ETA', `eta=${track.json.trip?.eta_minutes}min`);

  // Privacy: a booking must not be readable by an unrelated account.
  const snoop = await call('GET', `/api/bookings/${bookingId}`, { token: await login('9800000002', 'user123') });
  log(snoop.status === 403, 'privacy: unrelated patient blocked', `got ${snoop.status}`);

  // ------------------------------------------------------ F.9 milestones
  for (const milestone of ['ENROUTE', 'ARRIVED', 'ONBOARD', 'COMPLETED']) {
    const r = await call('POST', `/api/provider/trips/${tripId}/status`, { token: driver, body: { trip_milestone: milestone } });
    if (milestone === 'COMPLETED') {
      log(Boolean(r.json.invoice), 'F.10 invoice raised on completion', r.json.invoice?.invoice_id);
      var invoice = r.json.invoice;
    } else {
      log(r.json.trip_milestone === milestone, `milestone ${milestone}`);
    }
  }

  // Out-of-order milestone must be refused.
  const badStep = await call('POST', `/api/provider/trips/${tripId}/status`, { token: driver, body: { trip_milestone: 'ENROUTE' } });
  log(badStep.status === 409, 'milestone order enforced', `got ${badStep.status}`);

  // ------------------------------------------------------- F.10 payment
  const paid = await call('POST', `/api/payments/invoices/${invoice.invoice_id}/pay`, { token: patient, body: { payment_mode: 'UPI' } });
  log(paid.json.invoice?.payment_status === 'SUCCESS', 'invoice paid', `Rs ${paid.json.invoice?.fare_amount}`);

  // ------------------------------------------------------- F.12 rating
  const rated = await call('POST', `/api/bookings/${bookingId}/rating`, { token: patient, body: { rating_value: 5, feedback_text: 'Smoke test' } });
  log(rated.status === 201, 'rating submitted', `provider now ${rated.json.provider_rating}`);

  // ------------------------------------------------------ F.13 admin view
  const overview = await call('GET', '/api/admin/overview', { token: admin });
  log(overview.json.counts?.completed >= 1, 'admin overview reflects the trip', `completed=${overview.json.counts?.completed}`);
  const audit = await call('GET', '/api/admin/audit?limit=5', { token: admin });
  log(audit.json.audit?.length > 0, 'C.5 audit trail recording', `${audit.json.audit?.length} recent entries`);

  // ---------------------------------------------------------------- tidy up
  await call('POST', '/api/provider/availability', { token: driver, body: { availability_status: 'OFFLINE' } });

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('\nSMOKE TEST ERROR:', err.message);
  process.exit(1);
});
