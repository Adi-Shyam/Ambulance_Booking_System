'use strict';
// F.1 - the mechanics of getting a code to someone.
//
// A code proves control of one contact detail, so a request names the detail:
// `email_id` to prove an address, `phone_no` to prove a number. Registration
// uses the address, because an address can be proved for nothing while proving
// a number needs an SMS gateway or an unblocked WhatsApp sender.
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

const BY_EMAIL = 'channel.test@example.in';
const NO_ACCOUNT = '9822200022';
const BAD_CHANNEL = 'bad.channel@example.in';

const lastMessageTo = (email) =>
  database().prepare(
    `SELECT message_channel, recipient_phone, recipient_email, body FROM messages
     WHERE recipient_email = ? ORDER BY rowid DESC LIMIT 1`
  ).get(email);

const otpRow = (identifier) =>
  database().prepare(
    'SELECT * FROM otps WHERE identifier = ? AND consumed = 0 ORDER BY id DESC LIMIT 1'
  ).get(identifier);

test.before(async () => { await startTestServer(); });
test.after(async () => { await stopTestServer(); });

test('a code to an address is logged as an email', async () => {
  const r = await post('/api/auth/otp/request', {
    email_id: 'Channel.Test@Example.In', purpose: 'REGISTER',
  });

  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.channel, 'EMAIL');
  assert.equal(r.body.verifying, 'EMAIL', 'the reply says which detail is being proved');

  const sent = lastMessageTo(BY_EMAIL);
  assert.equal(sent.message_channel, 'EMAIL', 'the delivery log records the channel used');
  assert.equal(sent.recipient_email, BY_EMAIL, 'and normalises the address');
  assert.equal(
    sent.recipient_phone, null,
    'there is no account yet, so there is no number to attribute it to'
  );
  assert.match(sent.body, /verification code/i);
});

test('the response masks where the code went', async () => {
  const r = await post('/api/auth/otp/request', { email_id: BY_EMAIL, purpose: 'REGISTER' });

  assert.equal(r.body.sent_to, 'c**********t@example.in');
  assert.ok(
    !r.body.sent_to.includes('channel.test'),
    'asking for a code must not read the address back out in full'
  );
});

test('the row records what is being proved and how it travelled', async () => {
  await post('/api/auth/otp/request', { email_id: BY_EMAIL, purpose: 'REGISTER' });
  const row = otpRow(BY_EMAIL);

  assert.equal(row.identifier, BY_EMAIL);
  assert.equal(row.identifier_type, 'EMAIL');
  assert.equal(row.channel, 'EMAIL');
  assert.equal(row.destination, BY_EMAIL);
});

// The remaining phone-keyed path: an account that already exists proving its
// number. There is no registration here - an account built on a number nothing
// has checked would mean nothing.
test('an existing account can be sent a code to prove its number', async () => {
  const r = await post('/api/auth/otp/request', {
    phone_no: ACCOUNTS.patient.phone, channel: 'WHATSAPP',
  });

  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.verifying, 'PHONE');
  assert.equal(otpRow(ACCOUNTS.patient.phone).identifier_type, 'PHONE');
});

test('proving a number by email uses the address already on that account', async () => {
  const r = await post('/api/auth/otp/request', {
    phone_no: ACCOUNTS.patient2.phone, channel: 'EMAIL',
  });

  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.verifying, 'PHONE', 'the number is what is being proved');
  assert.equal(r.body.channel, 'EMAIL', 'the address is only how the code travels');
  assert.equal(lastMessageTo('dev@example.in').recipient_email, 'dev@example.in');
});

test('verifying a number marks the number, not the address', async () => {
  await post('/api/auth/otp/request', { phone_no: ACCOUNTS.patient.phone, channel: 'WHATSAPP' });
  const r = await post('/api/auth/otp/verify', {
    phone_no: ACCOUNTS.patient.phone,
    otp_code: otpRow(ACCOUNTS.patient.phone).otp_code,
  });

  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.verified, 'PHONE');
  assert.equal(r.body.user.phone_verified, true);
});

test('a code for a number nobody holds is not a registration', async () => {
  const requested = await post('/api/auth/otp/request', {
    phone_no: NO_ACCOUNT, purpose: 'REGISTER',
  });
  assert.equal(requested.status, 200, 'a code can be issued');

  const r = await post('/api/auth/otp/verify', {
    phone_no: NO_ACCOUNT,
    otp_code: otpRow(NO_ACCOUNT).otp_code,
    full_name: 'Someone New',
  });

  assert.equal(r.status, 404, 'but it cannot create an account');
  assert.notEqual(
    r.body.needs_registration, true,
    'and must not invite one, since nothing here proves the number belongs to them'
  );
});

test('a request naming neither an address nor a number is refused', async () => {
  const r = await post('/api/auth/otp/request', { purpose: 'REGISTER' });
  assert.equal(r.status, 400);
  assert.equal(r.body.field, 'email_id');
});

test('an unrecognised channel is refused', async () => {
  const r = await post('/api/auth/otp/request', {
    phone_no: '9822200033', purpose: 'REGISTER', channel: 'CARRIER_PIGEON',
  });

  assert.equal(r.status, 400);
  assert.equal(r.body.field, 'channel');
});

test('an address can only ever be reached by email', async () => {
  const r = await post('/api/auth/otp/request', {
    email_id: BAD_CHANNEL, purpose: 'REGISTER', channel: 'WHATSAPP',
  });

  assert.equal(r.status, 200);
  assert.equal(
    r.body.channel, 'EMAIL',
    'asking for WhatsApp to an email address is a mistake to correct, not to honour'
  );
});
