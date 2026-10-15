'use strict';
// F.1 / NF.3 - choosing a password, and recovering a forgotten one.
//
// The rules follow NIST SP 800-63B rather than the familiar
// one-of-each-character-class formula. That formula reliably produces
// "Password1!", which satisfies every part of it and is guessed in seconds;
// length and a blocklist do more work than composition does.
const test = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer, stopTestServer, call, get, post, signIn, ACCOUNTS } = require('../helpers');
// Required lazily: src/db resolves DB_FILE at load time, so touching it
// before startTestServer sets that variable would bind every query - and
// the server's own, through the module cache - to the real database.
const database = () => require('../../src/db').db;

const codeFor = (identifier, purpose) =>
  database().prepare(
    `SELECT otp_code FROM otps WHERE identifier = ? AND consumed = 0
     ${purpose ? 'AND purpose = ?' : ''} ORDER BY id DESC LIMIT 1`
  ).get(...(purpose ? [identifier, purpose] : [identifier]))?.otp_code;

/** Registers an account by email so there is one to reset. */
async function register({ email, phone, name, password }) {
  const started = await post('/api/auth/register', {
    full_name: name, phone_no: phone, email_id: email, password,
  });
  if (started.status !== 202) throw new Error(`register failed: ${JSON.stringify(started.body)}`);
  const done = await post('/api/auth/otp/verify', {
    email_id: email, otp_code: started.body.otp_code,
    full_name: name, phone_no: phone, password,
  });
  if (done.status !== 201) throw new Error(`verify failed: ${JSON.stringify(done.body)}`);
  return done.body;
}

test.before(async () => { await startTestServer(); });
test.after(async () => { await stopTestServer(); });

// ------------------------------------------------------ choosing a password

test('a password shorter than the floor is refused', async () => {
  const r = await post('/api/auth/register', {
    full_name: 'Too Short', phone_no: '9877700001',
    email_id: 'too.short@example.in', password: 'Ab3$x',
  });
  assert.equal(r.status, 400);
  assert.equal(r.body.field, 'password');
  assert.match(r.body.error, /at least 8/i);
});

test('a password from the top of every breach list is refused', async (t) => {
  // Including ones that satisfy a composition rule. "P@ssw0rd" has upper
  // case, lower case, a digit and a symbol, and is worthless.
  for (const password of ['password', '12345678', 'P@ssw0rd', 'qwerty123', 'driver123']) {
    await t.test(password, async () => {
      const r = await post('/api/auth/register', {
        full_name: 'Common Password', phone_no: '9877700002',
        email_id: 'common@example.in', password,
      });
      assert.equal(r.status, 400, `${password} was accepted`);
      assert.equal(r.body.field, 'password');
    });
  }
});

test('a password with no content is refused however long', async (t) => {
  await t.test('one character repeated', async () => {
    const r = await post('/api/auth/register', {
      full_name: 'Repeated', phone_no: '9877700003',
      email_id: 'repeated@example.in', password: 'aaaaaaaaaaaa',
    });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /same character/i);
  });

  await t.test('a run of consecutive characters', async () => {
    const r = await post('/api/auth/register', {
      full_name: 'Sequential', phone_no: '9877700004',
      email_id: 'sequential@example.in', password: 'abcdefghijkl',
    });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /consecutive/i);
  });
});

test('a password made of the person own details is refused', async (t) => {
  const owner = {
    full_name: 'Adithya Shyam', phone_no: '9877700005', email_id: 'adithya.s@example.in',
  };

  for (const [what, password] of [
    ['their given name', 'Adithya2026!'],
    ['their surname', 'Shyam#98765'],
    ['their number', 'My9877700005!'],
    ['their email local part', 'adithya.s#2026X'],
  ]) {
    await t.test(what, async () => {
      const r = await post('/api/auth/register', { ...owner, password });
      assert.equal(r.status, 400, `${password} was accepted`);
      assert.match(
        r.body.error, /name, number or email/i,
        'and says why, rather than refusing opaquely'
      );
    });
  }
});

test('a long passphrase is accepted without punctuation', async () => {
  // Composition rules would refuse this and accept "Password1!", which is the
  // reason not to have composition rules.
  const r = await post('/api/auth/register', {
    full_name: 'Passphrase User', phone_no: '9877700006',
    email_id: 'passphrase@example.in', password: 'correct horse battery staple',
  });
  assert.equal(r.status, 202, JSON.stringify(r.body));
});

test('a short password is accepted when it is genuinely mixed', async () => {
  const r = await post('/api/auth/register', {
    full_name: 'Mixed User', phone_no: '9877700007',
    email_id: 'mixed@example.in', password: 'Kx9#mPq2Lz',
  });
  assert.equal(r.status, 202, JSON.stringify(r.body));
});

test('signing in still accepts a password that predates the rules', async () => {
  // The seeded accounts use "user123", which the rules would now refuse. They
  // must still be able to sign in, or tightening a rule would lock people out
  // of their own accounts.
  const r = await post('/api/auth/login', {
    phone_no: ACCOUNTS.patient.phone, password: ACCOUNTS.patient.password,
  });
  assert.equal(r.status, 200, 'an existing password is supplied, not chosen');
});

// -------------------------------------------------- forgotten password

test('a reset code reaches an account that exists', async () => {
  const EMAIL = 'forgetful@example.in';
  await register({ email: EMAIL, phone: '9877700010', name: 'Forgetful User', password: 'Kx9#mPq2Lz' });

  const r = await post('/api/auth/password/forgot', { email_id: EMAIL });
  assert.equal(r.status, 200);
  assert.ok(codeFor(EMAIL, 'RESET'), 'a RESET code was issued');
});

test('the reply is the same for an address with no account', async () => {
  const known = await post('/api/auth/password/forgot', { email_id: 'forgetful@example.in' });
  const unknown = await post('/api/auth/password/forgot', { email_id: 'nobody.here@example.in' });

  assert.equal(known.status, unknown.status);
  assert.equal(
    known.body.message, unknown.body.message,
    'otherwise this answers "is this address registered?" for anyone who asks'
  );
  assert.equal(codeFor('nobody.here@example.in', 'RESET'), undefined, 'and nothing was sent');
});

test('a reset sets the new password and revokes every session', async () => {
  const EMAIL = 'resetter@example.in';
  const PHONE = '9877700011';
  await register({ email: EMAIL, phone: PHONE, name: 'Reset User', password: 'Kx9#mPq2Lz' });

  // Two devices signed in.
  await post('/api/auth/login', { email_id: EMAIL, password: 'Kx9#mPq2Lz' });
  const stale = await post('/api/auth/login', { email_id: EMAIL, password: 'Kx9#mPq2Lz' });
  const staleToken = stale.body.session_token;
  assert.equal((await get('/api/auth/me', { token: staleToken })).status, 200);

  await post('/api/auth/password/forgot', { email_id: EMAIL });
  const reset = await post('/api/auth/password/reset', {
    email_id: EMAIL, otp_code: codeFor(EMAIL, 'RESET'), new_password: 'Zq4@wNt7Rv',
  });

  assert.equal(reset.status, 200, JSON.stringify(reset.body));
  assert.ok(reset.body.sessions_revoked >= 2, 'every session was ended');

  assert.equal(
    (await get('/api/auth/me', { token: staleToken })).status, 401,
    'somebody already signed in on the old password must not stay signed in'
  );

  assert.equal((await post('/api/auth/login', { email_id: EMAIL, password: 'Zq4@wNt7Rv' })).status, 200);
  assert.equal((await post('/api/auth/login', { email_id: EMAIL, password: 'Kx9#mPq2Lz' })).status, 401);
});

test('a reset will not accept a weak new password', async () => {
  const EMAIL = 'weak.reset@example.in';
  await register({ email: EMAIL, phone: '9877700012', name: 'Weak Reset', password: 'Kx9#mPq2Lz' });

  await post('/api/auth/password/forgot', { email_id: EMAIL });
  const code = codeFor(EMAIL, 'RESET');
  const r = await post('/api/auth/password/reset', {
    email_id: EMAIL, otp_code: code, new_password: 'password',
  });

  assert.equal(r.status, 400);
  assert.equal(r.body.field, 'new_password');
  assert.equal(
    codeFor(EMAIL, 'RESET'), code,
    'and the code survives, so a refused password does not cost another email'
  );
});

test('a sign-in code cannot be used to reset a password', async () => {
  const EMAIL = 'wrong.purpose@example.in';
  await register({ email: EMAIL, phone: '9877700013', name: 'Wrong Purpose', password: 'Kx9#mPq2Lz' });

  // A LOGIN code, not a RESET one.
  await post('/api/auth/otp/request', { email_id: EMAIL });
  const loginCode = codeFor(EMAIL, 'LOGIN');
  assert.ok(loginCode, 'a sign-in code was issued');

  const r = await post('/api/auth/password/reset', {
    email_id: EMAIL, otp_code: loginCode, new_password: 'Zq4@wNt7Rv',
  });

  assert.equal(
    r.status, 401,
    'a code read over somebody shoulder must not become a password change'
  );
});

test('a reset code is single use', async () => {
  const EMAIL = 'single.use@example.in';
  await register({ email: EMAIL, phone: '9877700014', name: 'Single Use', password: 'Kx9#mPq2Lz' });

  await post('/api/auth/password/forgot', { email_id: EMAIL });
  const code = codeFor(EMAIL, 'RESET');

  assert.equal((await post('/api/auth/password/reset', {
    email_id: EMAIL, otp_code: code, new_password: 'Zq4@wNt7Rv',
  })).status, 200);

  assert.equal((await post('/api/auth/password/reset', {
    email_id: EMAIL, otp_code: code, new_password: 'Mb8!kYu3Pn',
  })).status, 401, 'the second use is refused');
});
