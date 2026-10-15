'use strict';
// Test harness. Each test file boots its own server on an ephemeral port with a
// throwaway database, so suites are independent and leave no state behind.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let server;
let baseUrl;

/** Boots the API against a fresh temporary database. Returns the base URL. */
async function startTestServer() {
  if (baseUrl) return baseUrl;

  const dbFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'abs-test-')),
    'test.db'
  );

  // Must be set before the app modules are required - config and db read these
  // at load time.
  process.env.DB_FILE = dbFile;
  process.env.PORT = '0';                       // ask the OS for a free port
  process.env.NODE_ENV = 'test';
  process.env.EXPOSE_OTP_IN_RESPONSE = 'true';
  process.env.JWT_SECRET = 'test-secret';
  process.env.MAPS_PROVIDER = 'osm';
  process.env.WHATSAPP_TOKEN = '';              // mock transport
  process.env.EMAIL_PROVIDER = 'mock';          // no outbound mail from a test
  process.env.PUSH_MOCK = 'true';               // nor any call to Expo
  // The suite creates more accounts in a minute than the per-address limit
  // allows in an hour. The sign-in limiter is left alone, because that is the
  // one NF.3's own test exercises.
  process.env.REGISTER_LIMIT_PER_HOUR = '500';
  process.env.OFFER_TIMEOUT_SECONDS = '45';

  const { seed } = require('../src/db/seed');
  seed();

  ({ server } = require('../src/server'));
  if (!server.listening) {
    await new Promise((resolve) => server.once('listening', resolve));
  }
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  return baseUrl;
}

async function stopTestServer() {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
}

/** Minimal API client. `token` may be a raw JWT or a session object. */
async function call(method, pathname, { token, body } = {}) {
  const auth = typeof token === 'object' && token ? token.session_token : token;
  const res = await fetch(baseUrl + pathname, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const get = (p, o) => call('GET', p, o);
const post = (p, b, o) => call('POST', p, { ...o, body: b });
const patch = (p, b, o) => call('PATCH', p, { ...o, body: b });

/** Signs in and returns the whole session payload. */
async function signIn(phone_no, password, role_code) {
  const r = await post('/api/auth/login', { phone_no, password, ...(role_code ? { role_code } : {}) });
  if (r.status !== 200) throw new Error(`sign-in failed for ${phone_no}: ${r.body.error}`);
  return r.body;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Polls until `fn()` returns something truthy, or the timeout expires. */
async function waitFor(fn, { timeout = 5000, interval = 150, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(interval);
  }
  throw new Error(`timed out waiting for ${label}`);
}

// Demo accounts created by the seed.
const ACCOUNTS = {
  admin: { phone: '9000000001', password: 'admin123' },
  patient: { phone: '9800000001', password: 'user123' },
  patient2: { phone: '9800000002', password: 'user123' },
  driverBLS: { phone: '9700000001', password: 'driver123' },
  driverALS: { phone: '9700000002', password: 'driver123' },
  driverICU: { phone: '9700000003', password: 'driver123' },
  driverPTV: { phone: '9700000004', password: 'driver123' },
  driverPending: { phone: '9700000006', password: 'driver123' },
};

const NITK = { latitude: 13.010389, longitude: 74.794243 };

/** Puts a driver on duty at a given point and returns their session. */
async function goOnDuty(account, coords) {
  const session = await signIn(account.phone, account.password);
  await post('/api/provider/location', coords, { token: session });
  await post('/api/provider/availability', { availability_status: 'AVAILABLE' }, { token: session });
  return session;
}

/** Cancels whatever the patient has open, so a test starts from a clean slate. */
async function clearActiveBooking(patient) {
  const active = await get('/api/bookings/active', { token: patient });
  if (active.body.booking) {
    await post(`/api/bookings/${active.body.booking.booking_id}/cancel`,
      { reason: 'test reset' }, { token: patient });
  }
}

/**
 * Places a booking and returns whichever of `drivers` was offered it.
 * Ranking combines distance, rating and type match, so the winner is a property
 * of the engine and must be discovered rather than assumed.
 */
async function bookAndAwaitAnyOffer(patient, drivers, booking) {
  const placed = await post('/api/bookings', booking, { token: patient });
  if (placed.status !== 201) throw new Error(`booking failed: ${placed.body.error}`);
  const bookingId = placed.body.booking.booking_id;

  const found = await waitFor(
    async () => {
      for (const driver of drivers) {
        const r = await get('/api/provider/offers', { token: driver });
        const offer = r.body.offers?.find((o) => o.booking_id === bookingId);
        if (offer) return { driver, offer };
      }
      return null;
    },
    { label: `dispatch offer for ${bookingId}` }
  );

  return { bookingId, ...found };
}

/** Places a booking and waits for the offer to reach the given driver. */
async function bookAndAwaitOffer(patient, driver, booking) {
  const placed = await post('/api/bookings', booking, { token: patient });
  if (placed.status !== 201) throw new Error(`booking failed: ${placed.body.error}`);
  const bookingId = placed.body.booking.booking_id;

  const offer = await waitFor(
    async () => {
      const r = await get('/api/provider/offers', { token: driver });
      return r.body.offers?.find((o) => o.booking_id === bookingId);
    },
    { label: `dispatch offer for ${bookingId}` }
  );

  return { bookingId, offer };
}

module.exports = {
  startTestServer, stopTestServer,
  call, get, post, patch, signIn,
  sleep, waitFor,
  ACCOUNTS, NITK, goOnDuty, bookAndAwaitOffer, bookAndAwaitAnyOffer, clearActiveBooking,
};
