'use strict';
// F.1 - registering by email.
//
// An account is created by proving an email address, because an address can be
// proved for nothing. A mobile number is collected at the same time and is
// *not* proved: doing so needs an SMS gateway or an unblocked WhatsApp sender,
// so the account records honestly which of the two has actually been checked.
//
// The schema allows a NULL password_hash for accounts made this way: they sign
// in by code rather than holding a password they never chose.
const test = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer, stopTestServer, post } = require('../helpers');
// Required lazily: src/db resolves DB_FILE at load time, so touching it
// before startTestServer sets that variable would bind every query - and
// the server's own, through the module cache - to the real database.
const database = () => require('../../src/db').db;

// Addresses and numbers the seed does not use, so each case starts genuinely
// unknown. One per test: NF.3 caps code requests per identifier, and sharing
// one spends that allowance on the later cases.
const NEW_PATIENT = { email: 'asha.rao@example.in', phone: '9811122233' };
const NEW_DRIVER = { email: 'ravi.kumar@example.in', phone: '9811122244' };
const WOULD_BE_ADMIN = { email: 'not.an.admin@example.in', phone: '9811122255' };
const NEW_BY_CODE = { email: 'meera.nair@example.in', phone: '9811122266' };
const ROUND_TRIP = { email: 'second.attempt@example.in', phone: '9811122277' };
const TAKEN_NUMBER = { email: 'different.person@example.in', phone: '9811122233' };

const codeFor = (identifier) =>
  database().prepare(
    'SELECT otp_code FROM otps WHERE identifier = ? AND consumed = 0 ORDER BY id DESC LIMIT 1'
  ).get(identifier)?.otp_code;

const requestCode = (email) =>
  post('/api/auth/otp/request', { email_id: email, purpose: 'REGISTER' });

test.before(async () => { await startTestServer(); });
test.after(async () => { await stopTestServer(); });

// The sign-in screen has one OTP tab serving both "sign me in" and "I am new
// here", so it has to ask for REGISTER. LOGIN refuses an address it does not
// know, which is right for a sign-in but a dead end for a sign-up.
test('a code for an unknown address needs purpose REGISTER, not the LOGIN default', async () => {
  const asLogin = await post('/api/auth/otp/request', { email_id: 'nobody@example.in' });
  assert.equal(asLogin.status, 404, 'LOGIN is for accounts that exist, and says so early');

  const asRegister = await requestCode('nobody@example.in');
  assert.equal(asRegister.status, 200, 'REGISTER is how a new address gets a code at all');
});

// The registration form used to create the account there and then, with
// email_verified = 0 and no code ever sent. The address was required and
// never checked, which is the same as not requiring it.
test('the registration form creates nothing until the code comes back', async () => {
  const EMAIL = 'form.registration@example.in';
  const PHONE = '9811133301';

  const started = await post('/api/auth/register', {
    full_name: 'Form Registration', phone_no: PHONE,
    email_id: EMAIL, password: 'Vx7#qLm4Zt',
  });

  assert.equal(started.status, 202, 'accepted, not created');
  assert.equal(started.body.needs_verification, true);
  assert.equal(
    database().prepare('SELECT 1 FROM users WHERE email_id = ?').get(EMAIL), undefined,
    'an account that exists before its address is proved is the hole this closes'
  );

  const code = codeFor(EMAIL);
  assert.ok(code, 'and a code went out');

  const done = await post('/api/auth/otp/verify', {
    email_id: EMAIL, otp_code: code,
    full_name: 'Form Registration', phone_no: PHONE, password: 'Vx7#qLm4Zt',
  });

  assert.equal(done.status, 201, JSON.stringify(done.body));
  assert.equal(done.body.user.email_verified, true, 'the address is proved');
  assert.equal(done.body.user.phone_verified, false, 'the number still is not');

  const login = await post('/api/auth/login', { email_id: EMAIL, password: 'Vx7#qLm4Zt' });
  assert.equal(login.status, 200, 'the password chosen on the form is the one that works');
});

test('a weak password is refused before a code is spent', async () => {
  const r = await post('/api/auth/register', {
    full_name: 'Weak Password', phone_no: '9811133302',
    email_id: 'weak.password@example.in', password: 'xy',
  });

  assert.equal(r.status, 400);
  assert.equal(r.body.field, 'password');
  assert.equal(
    codeFor('weak.password@example.in'), undefined,
    'nothing was emailed for a request that could never have completed'
  );
});

test('an address already registered is refused before a code is spent', async () => {
  const r = await post('/api/auth/register', {
    full_name: 'Already Here', phone_no: '9811133303',
    email_id: 'adithya@example.in', password: 'Vx7#qLm4Zt',
  });

  assert.equal(r.status, 409);
  assert.equal(r.body.field, 'email_id');
  assert.equal(
    codeFor('adithya@example.in'), undefined,
    'and the existing account was not sent a code it did not ask for'
  );
});

test('a correct code on an unknown address asks for what is missing', async () => {
  await requestCode(NEW_PATIENT.email);
  const r = await post('/api/auth/otp/verify', {
    email_id: NEW_PATIENT.email, otp_code: codeFor(NEW_PATIENT.email),
  });

  assert.equal(r.status, 404);
  assert.equal(r.body.needs_registration, true, 'the client is told what is missing, not just refused');
  assert.deepEqual(
    r.body.missing.sort(), ['full_name', 'phone_no'],
    'and which fields, so the screen can ask for exactly those'
  );
});

test('a name and a number create the account and return a session', async () => {
  await requestCode(NEW_PATIENT.email);
  const r = await post('/api/auth/otp/verify', {
    email_id: NEW_PATIENT.email,
    otp_code: codeFor(NEW_PATIENT.email),
    full_name: 'Asha Rao',
    phone_no: NEW_PATIENT.phone,
  });

  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(r.body.session_token, 'signed in straight away');
  assert.equal(r.body.user.email_id, NEW_PATIENT.email);
  assert.equal(r.body.user.phone_no, NEW_PATIENT.phone);
  assert.equal(r.body.user.verification_status, 'VERIFIED', 'patients are usable at once');

  const row = database()
    .prepare('SELECT password_hash, email_verified, phone_verified FROM users WHERE email_id = ?')
    .get(NEW_PATIENT.email);

  assert.equal(row.password_hash, null, 'no password was invented for them');
  assert.equal(row.email_verified, 1, 'the address answered a code, so it is proved');
  assert.equal(
    row.phone_verified, 0,
    'nothing here checked the number, and the record must not imply otherwise'
  );
});

test('the client is told which contacts are proved', async () => {
  const r = await post('/api/auth/otp/request', { email_id: NEW_PATIENT.email });
  assert.equal(r.status, 200, 'the address is now known, so LOGIN works');

  const session = await post('/api/auth/otp/verify', {
    email_id: NEW_PATIENT.email, otp_code: codeFor(NEW_PATIENT.email),
  });

  assert.equal(session.status, 200);
  assert.equal(session.body.user.email_verified, true);
  assert.equal(session.body.user.phone_verified, false);
});

test('an OTP-only account cannot be signed into with a password', async () => {
  const r = await post('/api/auth/login', {
    email_id: NEW_PATIENT.email, password: 'anything-at-all',
  });
  assert.equal(r.status, 401, 'a NULL hash must never match');
});

test('an OTP-only account can set a first password without knowing one', async () => {
  await requestCode(NEW_BY_CODE.email);
  const session = await post('/api/auth/otp/verify', {
    email_id: NEW_BY_CODE.email,
    otp_code: codeFor(NEW_BY_CODE.email),
    full_name: 'Meera Nair',
    phone_no: NEW_BY_CODE.phone,
  });
  const token = session.body.session_token;
  assert.ok(token, `registration did not return a session: ${JSON.stringify(session.body)}`);

  const set = await post('/api/auth/password', { new_password: 'chosen-later' }, { token });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.first_password, true, 'no current password was demanded');

  const byEmail = await post('/api/auth/login', {
    email_id: NEW_BY_CODE.email, password: 'chosen-later',
  });
  assert.equal(byEmail.status, 200, 'and that password then works with the address');

  const byPhone = await post('/api/auth/login', {
    phone_no: NEW_BY_CODE.phone, password: 'chosen-later',
  });
  assert.equal(byPhone.status, 200, 'or with the number, which is still an identifier');
});

// The screen asks twice: once with the code, and again with the details the
// first reply asked for. Consuming the code on that first reply would leave the
// second with nothing to present, so registering from the app would be
// impossible however correct the code was.
test('one code survives the round trip that asks for more', async () => {
  await requestCode(ROUND_TRIP.email);
  const code = codeFor(ROUND_TRIP.email);

  const asked = await post('/api/auth/otp/verify', { email_id: ROUND_TRIP.email, otp_code: code });
  assert.equal(asked.status, 404);
  assert.equal(asked.body.needs_registration, true);

  const done = await post('/api/auth/otp/verify', {
    email_id: ROUND_TRIP.email, otp_code: code,
    full_name: 'Second Attempt', phone_no: ROUND_TRIP.phone,
  });
  assert.equal(done.status, 201, `the same code had to still work: ${JSON.stringify(done.body)}`);

  // And only once - it is spent now.
  const replay = await post('/api/auth/otp/verify', { email_id: ROUND_TRIP.email, otp_code: code });
  assert.equal(replay.status, 401, 'a consumed code cannot be replayed');
});

test('a number already registered to someone else is refused', async () => {
  await requestCode(TAKEN_NUMBER.email);
  const r = await post('/api/auth/otp/verify', {
    email_id: TAKEN_NUMBER.email,
    otp_code: codeFor(TAKEN_NUMBER.email),
    full_name: 'Different Person',
    phone_no: TAKEN_NUMBER.phone,          // already Asha Rao's
  });

  assert.equal(r.status, 409);
  assert.equal(r.body.field, 'phone_no');
  assert.equal(
    database().prepare('SELECT 1 FROM users WHERE email_id = ?').get(TAKEN_NUMBER.email), undefined,
    'and no half-made account was left behind'
  );
});

test('a provider registered by email still starts PENDING', async () => {
  await requestCode(NEW_DRIVER.email);
  const r = await post('/api/auth/otp/verify', {
    email_id: NEW_DRIVER.email,
    otp_code: codeFor(NEW_DRIVER.email),
    full_name: 'Ravi Kumar',
    phone_no: NEW_DRIVER.phone,
    role_code: 'DRIVER',
  });

  assert.equal(r.status, 201);
  assert.equal(r.body.user.role_code, 'DRIVER');
  assert.equal(
    r.body.user.verification_status, 'PENDING',
    'holding an email address does not verify an ambulance (C.6)'
  );
});

test('nobody can register themselves as an administrator', async () => {
  await requestCode(WOULD_BE_ADMIN.email);
  const r = await post('/api/auth/otp/verify', {
    email_id: WOULD_BE_ADMIN.email,
    otp_code: codeFor(WOULD_BE_ADMIN.email),
    full_name: 'Not An Admin',
    phone_no: WOULD_BE_ADMIN.phone,
    role_code: 'ADMIN',
  });

  assert.equal(r.status, 400, 'F.13: control-room accounts are made by another administrator');
  assert.equal(
    database().prepare('SELECT 1 FROM users WHERE email_id = ?').get(WOULD_BE_ADMIN.email), undefined,
    'and nothing was written'
  );
});
