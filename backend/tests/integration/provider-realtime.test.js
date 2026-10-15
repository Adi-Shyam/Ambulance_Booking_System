'use strict';
// F.13 / F.6 - a driver reaches their own room for the whole session.
//
// The app asks for a vehicle *after* sign-in, so the token of the session that
// creates a provider profile was issued before that profile existed. Taking
// the provider id from the token therefore left exactly the driver who had
// just signed up outside their own room: no verification result, no dispatch
// offer, nothing, until they signed out and in again.
//
// That is the shape of bug that comes back quietly, because everything works
// as soon as you sign in a second time - which is the first thing anyone does
// when testing.
const test = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');

const h = require('../helpers');
const { startTestServer, stopTestServer, get, post, signIn, ACCOUNTS } = h;

/** Opens an authenticated socket and waits for it to connect. */
async function connect(token) {
  const socket = io(await startTestServer(), {
    auth: { token: typeof token === 'object' ? token.session_token : token },
    transports: ['websocket'],
  });
  await new Promise((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', reject);
    setTimeout(() => reject(new Error('socket did not connect')), 5000);
  });
  return socket;
}

/** Resolves with the event, or null once `ms` has passed. */
const waitForEvent = (socket, event, ms = 4000) =>
  Promise.race([
    new Promise((resolve) => socket.once(event, resolve)),
    h.sleep(ms).then(() => null),
  ]);

let admin;

test.before(async () => {
  await startTestServer();
  admin = await signIn(ACCOUNTS.admin.phone, ACCOUNTS.admin.password);
});

test.after(async () => { await stopTestServer(); });

test('a driver who adds a vehicle mid-session still reaches their own room', async () => {
  // Register, sign in, and only then create the profile - the order the app
  // puts them in, and the one that produced a token with no provider id.
  const EMAIL = 'realtime.driver@example.in';
  const PHONE = '9833300077';

  const started = await post('/api/auth/register', {
    full_name: 'Realtime Driver', phone_no: PHONE,
    email_id: EMAIL, password: 'Vx7#qLm4Zt', role_code: 'DRIVER',
  });
  assert.equal(started.status, 202, JSON.stringify(started.body));

  const created = await post('/api/auth/otp/verify', {
    email_id: EMAIL, otp_code: started.body.otp_code,
    full_name: 'Realtime Driver', phone_no: PHONE,
    password: 'Vx7#qLm4Zt', role_code: 'DRIVER',
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));

  // This token was minted before any provider existed.
  const token = created.body.session_token;
  assert.equal(created.body.provider, null, 'and it knows of no provider');

  const profile = await post('/api/provider/profile', {
    vehicle_reg_no: 'KA19RT0001', ambulance_type: 'BLS',
  }, { token });
  assert.equal(profile.status, 201, JSON.stringify(profile.body));
  const providerId = profile.body.provider.provider_id;

  // Connecting with that same stale token must still join the provider room.
  const socket = await connect(token);
  try {
    const heard = waitForEvent(socket, 'provider:verification');

    const verified = await post(`/api/admin/providers/${providerId}/verification`,
      { verification_status: 'VERIFIED' }, { token: admin });
    assert.equal(verified.status, 200, JSON.stringify(verified.body));

    const event = await heard;
    assert.ok(
      event,
      'the driver heard nothing: their socket is not in their own room, so they '
      + 'would have to sign out and in again to learn they had been verified'
    );
    assert.equal(event.verification_status, 'VERIFIED');
  } finally {
    socket.disconnect();
  }
});

test('the status the driver can fetch matches what the event said', async () => {
  // "Check again" reads this. If the two disagreed, the button would show a
  // console that the server considers locked.
  const driver = await signIn(ACCOUNTS.driverALS.phone, ACCOUNTS.driverALS.password);
  const me = await get('/api/provider/me', { token: driver });

  assert.equal(me.status, 200);
  assert.equal(me.body.provider.verification_status, 'VERIFIED');
});

test('an account with no vehicle joins no provider room', async () => {
  // The converse: a patient must not land in a room carrying dispatch offers.
  const patient = await signIn(ACCOUNTS.patient.phone, ACCOUNTS.patient.password);
  const socket = await connect(patient);

  try {
    const offer = waitForEvent(socket, 'offer:new', 1500);
    assert.equal(await offer, null, 'a patient hears no dispatch traffic');
  } finally {
    socket.disconnect();
  }
});
