'use strict';
// F.1 - registering by OTP. A correct code on a number with no account is a
// new user, not a dead end. The schema allows a NULL password_hash for exactly
// these accounts: they sign in by code rather than holding a password they
// never chose.
const test = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer, stopTestServer, get, post } = require('../helpers');
// Required lazily: src/db resolves DB_FILE at load time, so touching it
// before startTestServer sets that variable would bind every query - and
// the server's own, through the module cache - to the real database.
const database = () => require('../../src/db').db;

// Numbers the seed does not use, so each test starts genuinely unknown.
const NEW_PATIENT = '9811122233';
const NEW_DRIVER = '9811122244';
const WOULD_BE_ADMIN = '9811122255';
const NEW_BY_CODE = '9811122266';

const codeFor = (phone) =>
  database().prepare('SELECT otp_code FROM otps WHERE phone_no = ? AND consumed = 0 ORDER BY id DESC LIMIT 1')
    .get(phone)?.otp_code;

test.before(async () => { await startTestServer(); });
test.after(async () => { await stopTestServer(); });

// The sign-in screen has one OTP tab serving both "sign me in" and "I am new
// here", so it has to ask for REGISTER. It used to send no purpose at all,
// which defaults to LOGIN - and LOGIN refuses a number it does not know, so
// registration by code was reachable from the API and never from the app.
test('a code for an unknown number needs purpose REGISTER, not the LOGIN default', async () => {
  const asLogin = await post('/api/auth/otp/request', { phone_no: '9833399911' });
  assert.equal(asLogin.status, 404, 'LOGIN is for accounts that exist, and says so early');

  const asRegister = await post('/api/auth/otp/request', { phone_no: '9833399911', purpose: 'REGISTER' });
  assert.equal(asRegister.status, 200, 'REGISTER is how a new number gets a code at all');
});

test('a correct code on an unknown number asks for a name rather than failing', async () => {
  await post('/api/auth/otp/request', { phone_no: NEW_PATIENT, purpose: 'REGISTER' });
  const r = await post('/api/auth/otp/verify', { phone_no: NEW_PATIENT, otp_code: codeFor(NEW_PATIENT) });

  assert.equal(r.status, 404);
  assert.equal(r.body.needs_registration, true, 'the client is told what is missing, not just refused');
});

test('supplying a name creates the account and returns a session', async () => {
  await post('/api/auth/otp/request', { phone_no: NEW_PATIENT, purpose: 'REGISTER' });
  const r = await post('/api/auth/otp/verify', {
    phone_no: NEW_PATIENT, otp_code: codeFor(NEW_PATIENT), full_name: 'Asha Rao',
  });

  assert.equal(r.status, 201);
  assert.ok(r.body.session_token, 'signed in straight away');
  assert.equal(r.body.user.role_code, 'USER');
  assert.equal(r.body.user.verification_status, 'VERIFIED', 'patients are usable at once');

  const row = database().prepare('SELECT password_hash FROM users WHERE phone_no = ?').get(NEW_PATIENT);
  assert.equal(row.password_hash, null, 'no password was invented for them');
});

test('an OTP-only account cannot be signed into with a password', async () => {
  const r = await post('/api/auth/login', { phone_no: NEW_PATIENT, password: 'anything-at-all' });
  assert.equal(r.status, 401, 'a NULL hash must never match');
});

test('an OTP-only account can set a first password without knowing one', async () => {
  // Its own number, because NF.3 caps code requests per number and the cases
  // above have already spent that allowance on NEW_PATIENT.
  await post('/api/auth/otp/request', { phone_no: NEW_BY_CODE, purpose: 'REGISTER' });
  const session = await post('/api/auth/otp/verify', {
    phone_no: NEW_BY_CODE, otp_code: codeFor(NEW_BY_CODE), full_name: 'Meera Nair',
  });
  const token = session.body.session_token;
  assert.ok(token, `registration did not return a session: ${JSON.stringify(session.body)}`);

  const set = await post('/api/auth/password', { new_password: 'chosen-later' }, { token });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.first_password, true, 'no current password was demanded');

  const login = await post('/api/auth/login', { phone_no: NEW_BY_CODE, password: 'chosen-later' });
  assert.equal(login.status, 200, 'and that password then works');
});

// The exact sequence the sign-in screen performs: one code, verified twice -
// first without a name, which asks for one, then with it. Consuming the code
// on that first reply made the second fail with "Incorrect verification code",
// so no account could ever be created from the app. Every other case here
// requests a fresh code before verifying, which is why none of them caught it.
test('one code survives the round trip that asks for a name', async () => {
  const PHONE = '9811122277';
  await post('/api/auth/otp/request', { phone_no: PHONE, purpose: 'REGISTER' });
  const code = codeFor(PHONE);

  const asked = await post('/api/auth/otp/verify', { phone_no: PHONE, otp_code: code });
  assert.equal(asked.status, 404);
  assert.equal(asked.body.needs_registration, true);

  const done = await post('/api/auth/otp/verify', {
    phone_no: PHONE, otp_code: code, full_name: 'Second Attempt',
  });
  assert.equal(done.status, 201, `the same code had to still work: ${JSON.stringify(done.body)}`);

  // And only once - it is spent now.
  const replay = await post('/api/auth/otp/verify', { phone_no: PHONE, otp_code: code });
  assert.equal(replay.status, 401, 'a consumed code cannot be replayed');
});

test('a provider registered by OTP still starts PENDING', async () => {
  await post('/api/auth/otp/request', { phone_no: NEW_DRIVER, purpose: 'REGISTER' });
  const r = await post('/api/auth/otp/verify', {
    phone_no: NEW_DRIVER, otp_code: codeFor(NEW_DRIVER), full_name: 'Ravi Kumar', role_code: 'DRIVER',
  });

  assert.equal(r.status, 201);
  assert.equal(r.body.user.role_code, 'DRIVER');
  assert.equal(
    r.body.user.verification_status, 'PENDING',
    'holding a phone number does not verify an ambulance (C.6)'
  );
});

test('nobody can register themselves as an administrator by OTP', async () => {
  await post('/api/auth/otp/request', { phone_no: WOULD_BE_ADMIN, purpose: 'REGISTER' });
  const r = await post('/api/auth/otp/verify', {
    phone_no: WOULD_BE_ADMIN, otp_code: codeFor(WOULD_BE_ADMIN), full_name: 'Not An Admin', role_code: 'ADMIN',
  });

  assert.equal(r.status, 400, 'F.13: control-room accounts are made by another administrator');
  const created = database().prepare('SELECT 1 FROM users WHERE phone_no = ?').get(WOULD_BE_ADMIN);
  assert.equal(created, undefined, 'and nothing was written');
});
