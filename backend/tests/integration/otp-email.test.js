'use strict';
// F.1 - a verification code may travel by email instead of WhatsApp.
//
// Email is a delivery channel, not an identity: `phone_no` stays the account
// identifier because the data dictionary makes it NOT NULL UNIQUE and a driver
// who cannot find the patient has to be able to ring them. These cases pin
// that distinction down - every account below is still keyed by its number.
//
// Email also matters practically: it is the one channel with no 24-hour
// customer service window, no template approval and no billing relationship,
// so it works where a business-initiated WhatsApp message does not.
const test = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer, stopTestServer, post, ACCOUNTS } = require('../helpers');
// Required lazily: src/db resolves DB_FILE at load time, so touching it
// before startTestServer sets that variable would bind every query - and
// the server's own, through the module cache - to the real database.
const database = () => require('../../src/db').db;

// A distinct number per case: NF.3 caps code requests per number, and sharing
// one between tests spends that allowance and fails the later ones.
const BY_EMAIL = '9822200011';
const NO_ADDRESS = '9822200022';
const BAD_CHANNEL = '9822200033';
const DEFAULT_CHANNEL = '9822200044';

const lastMessageTo = (phone) =>
  database().prepare(
    `SELECT message_channel, recipient_email, body FROM messages
     WHERE recipient_phone = ? ORDER BY rowid DESC LIMIT 1`
  ).get(phone);

const codeFor = (phone) =>
  database().prepare(
    'SELECT otp_code FROM otps WHERE phone_no = ? AND consumed = 0 ORDER BY id DESC LIMIT 1'
  ).get(phone)?.otp_code;

test.before(async () => { await startTestServer(); });
test.after(async () => { await stopTestServer(); });

test('a code can be sent to an email address instead of WhatsApp', async () => {
  const r = await post('/api/auth/otp/request', {
    phone_no: BY_EMAIL, purpose: 'REGISTER', channel: 'EMAIL', email_id: 'Asha.Rao@Example.In',
  });

  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.channel, 'EMAIL');

  const sent = lastMessageTo(BY_EMAIL);
  assert.equal(sent.message_channel, 'EMAIL', 'the delivery log records the channel used');
  assert.equal(sent.recipient_email, 'asha.rao@example.in', 'and normalises the address');
  assert.match(sent.body, /verification code/i);
});

test('the response masks where the code went', async () => {
  const r = await post('/api/auth/otp/request', {
    phone_no: BY_EMAIL, purpose: 'REGISTER', channel: 'EMAIL', email_id: 'asha.rao@example.in',
  });

  assert.equal(r.body.sent_to, 'a******o@example.in');
  assert.ok(
    !r.body.sent_to.includes('asha.rao'),
    'asking for a code must not read the address back out in full'
  );
});

test('verifying an emailed code registers the account and keeps the address', async () => {
  const r = await post('/api/auth/otp/verify', {
    phone_no: BY_EMAIL, otp_code: codeFor(BY_EMAIL), full_name: 'Asha Rao',
  });

  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.user.phone_no, BY_EMAIL, 'the phone number is still the identifier');
  assert.equal(
    r.body.user.email_id, 'asha.rao@example.in',
    'an address that received a code is a proven one, so it is kept without being resent'
  );
});

test('an existing account needs no address: the one on file is used', async () => {
  const r = await post('/api/auth/otp/request', {
    phone_no: ACCOUNTS.patient.phone, channel: 'EMAIL',
  });

  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(lastMessageTo(ACCOUNTS.patient.phone).recipient_email, 'adithya@example.in');
});

test('an email channel with nowhere to send says so rather than failing silently', async () => {
  const r = await post('/api/auth/otp/request', {
    phone_no: NO_ADDRESS, purpose: 'REGISTER', channel: 'EMAIL',
  });

  assert.equal(r.status, 400);
  assert.equal(r.body.field, 'email_id', 'the client is told which field is missing');
  assert.equal(codeFor(NO_ADDRESS), undefined, 'and no code was issued for a code nobody could read');
});

test('a driver with no address on file is told to use WhatsApp', async () => {
  const r = await post('/api/auth/otp/request', {
    phone_no: ACCOUNTS.driverICU.phone, channel: 'EMAIL',
  });

  assert.equal(r.status, 400);
  assert.match(r.body.error, /no email address on file/i);
});

test('an unrecognised channel is refused', async () => {
  const r = await post('/api/auth/otp/request', {
    phone_no: BAD_CHANNEL, purpose: 'REGISTER', channel: 'CARRIER_PIGEON',
  });

  assert.equal(r.status, 400);
  assert.equal(r.body.field, 'channel');
});

test('omitting the channel still sends by the phone, unchanged', async () => {
  const r = await post('/api/auth/otp/request', {
    phone_no: DEFAULT_CHANNEL, purpose: 'REGISTER',
  });

  assert.equal(r.status, 200);
  assert.equal(r.body.channel, 'WHATSAPP', 'the default is the behaviour that existed before');
  assert.notEqual(
    lastMessageTo(DEFAULT_CHANNEL).message_channel, 'EMAIL',
    'adding a channel must not silently redirect the existing one'
  );
});
