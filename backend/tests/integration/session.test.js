'use strict';
// Integration tests - F.1 / F.2 and DFD 0.1.3 "Create Session & Assign Role".
//
// The DFD shows 0.1.3 writing the issued session into data store D1. These
// tests assert that signing in actually changes the database, that the stored
// row carries what the Data Dictionary specifies (session_token identity,
// token_expiry, role_code), and that revoking the row stops the token working.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const h = require('../helpers');
const { get, post, signIn, ACCOUNTS } = h;

let db;

before(async () => {
  await h.startTestServer();
  ({ db } = require('../../src/db'));
});
after(async () => { await h.stopTestServer(); });

const sessionsFor = (userId) =>
  db.prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY id DESC').all(userId);

describe('signing in writes to D1 (DFD 0.1.3)', () => {
  test('a successful login creates a session row', async () => {
    const before = db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;

    const session = await signIn(ACCOUNTS.patient.phone, ACCOUNTS.patient.password, 'USER');

    const after = db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
    assert.equal(after, before + 1, 'logging in must leave a record in the database');

    const rows = sessionsFor(session.user.user_id);
    assert.ok(rows.length > 0);
  });

  test('the stored row carries the fields the data dictionary specifies', async () => {
    const session = await signIn(ACCOUNTS.patient.phone, ACCOUNTS.patient.password);
    const row = sessionsFor(session.user.user_id)[0];

    assert.ok(row.token_id, 'the session is identifiable');
    assert.equal(row.user_id, session.user.user_id);
    assert.equal(row.role_code, 'USER', 'the assigned role is recorded (0.1.3 assigns the role)');
    assert.equal(row.revoked, 0, 'a new session starts live');
    assert.equal(row.token_expiry, session.token_expiry, 'token_expiry matches what the client was given');
    assert.ok(new Date(row.issued_at) <= new Date(row.token_expiry));
  });

  test('token_expiry is the 24-hour lifetime the data dictionary states', async () => {
    const session = await signIn(ACCOUNTS.patient.phone, ACCOUNTS.patient.password);
    const row = sessionsFor(session.user.user_id)[0];
    const hours = (new Date(row.token_expiry) - new Date(row.issued_at)) / 3_600_000;
    assert.ok(Math.abs(hours - 24) < 0.01, `expected a 24 h session, got ${hours} h`);
  });

  test('a failed login writes no session', async () => {
    const before = db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
    const r = await post('/api/auth/login', {
      phone_no: ACCOUNTS.patient.phone, password: 'definitely-wrong',
    });
    assert.equal(r.status, 401);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, before,
      'only a successful authentication may create a session');
  });

  test('registration and OTP sign-in also create sessions', async () => {
    const registered = await post('/api/auth/register', {
      full_name: 'Session Test User', phone_no: '9765432100', password: 'secret123',
    });
    assert.equal(registered.status, 201);
    assert.equal(sessionsFor(registered.body.user.user_id).length, 1, 'registration signs the user in');

    const issued = await post('/api/auth/otp/request', { phone_no: '9765432100' });
    const verified = await post('/api/auth/otp/verify', {
      phone_no: '9765432100', otp_code: issued.body.otp_code,
    });
    assert.equal(verified.status, 200);
    assert.equal(sessionsFor(registered.body.user.user_id).length, 2, 'OTP sign-in adds a second session');
  });

  test('each sign-in is a separate session, not a reused one', async () => {
    const first = await signIn(ACCOUNTS.patient2.phone, ACCOUNTS.patient2.password);
    const second = await signIn(ACCOUNTS.patient2.phone, ACCOUNTS.patient2.password);
    const rows = sessionsFor(first.user.user_id);
    const ids = new Set(rows.map((r) => r.token_id));
    assert.equal(ids.size, rows.length, 'two devices must not share one session record');
    assert.notEqual(first.session_token, second.session_token);
  });

  test('the login is also recorded in the audit trail (C.5)', async () => {
    const before = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'LOGIN_SUCCESS'").get().n;
    await signIn(ACCOUNTS.patient.phone, ACCOUNTS.patient.password);
    const after = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'LOGIN_SUCCESS'").get().n;
    assert.equal(after, before + 1);
  });
});

describe('a user can see and end their sessions', () => {
  test('the account lists its own sessions and marks the current one', async () => {
    const session = await signIn(ACCOUNTS.patient.phone, ACCOUNTS.patient.password);
    const r = await get('/api/auth/sessions', { token: session });

    assert.equal(r.status, 200);
    assert.ok(r.body.sessions.length > 0);
    assert.equal(r.body.sessions.filter((s) => s.current).length, 1,
      'exactly one listed session is the one making the request');
  });

  test('signing out revokes the session in the database', async () => {
    const session = await signIn(ACCOUNTS.patient.phone, ACCOUNTS.patient.password);

    const out = await post('/api/auth/logout', {}, { token: session });
    assert.equal(out.status, 200);
    assert.equal(out.body.revoked, true);

    const row = sessionsFor(session.user.user_id).find((s) => s.revoked === 1);
    assert.ok(row, 'the row is marked revoked rather than deleted, so the history survives');
    assert.ok(row.revoked_at, 'the time of revocation is recorded');
  });

  test('a revoked token stops working immediately', async () => {
    const session = await signIn(ACCOUNTS.patient.phone, ACCOUNTS.patient.password);
    assert.equal((await get('/api/bookings', { token: session })).status, 200);

    await post('/api/auth/logout', {}, { token: session });

    const after = await get('/api/bookings', { token: session });
    assert.equal(after.status, 401, 'the signature still verifies, but the session is dead');
    assert.match(after.body.error, /signed out/i);
  });

  test('signing out one device leaves the other signed in', async () => {
    const phone = await signIn(ACCOUNTS.patient2.phone, ACCOUNTS.patient2.password);
    const tablet = await signIn(ACCOUNTS.patient2.phone, ACCOUNTS.patient2.password);

    await post('/api/auth/logout', {}, { token: phone });

    assert.equal((await get('/api/bookings', { token: phone })).status, 401);
    assert.equal((await get('/api/bookings', { token: tablet })).status, 200,
      'revocation is per session, not per account');
  });

  test('signing out twice is harmless', async () => {
    const session = await signIn(ACCOUNTS.patient.phone, ACCOUNTS.patient.password);
    assert.equal((await post('/api/auth/logout', {}, { token: session })).body.revoked, true);

    const second = await post('/api/auth/logout', {}, { token: session });
    assert.equal(second.status, 401, 'the second attempt is simply an unauthenticated request');
  });
});
