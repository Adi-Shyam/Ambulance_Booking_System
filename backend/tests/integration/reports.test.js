'use strict';
// F.13 - a crew reports a passenger who abused the service, and the control
// room rules on it.
//
// The separation is the point: a driver reports, an administrator decides.
// Letting the person who was wronged also impose the penalty is how a dispute
// becomes a grudge, so every case below checks that the filing itself changes
// nothing about the account it names.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  startTestServer, stopTestServer,
  get, post, signIn,
  ACCOUNTS, NITK, goOnDuty, clearActiveBooking, bookAndAwaitOffer,
} = require('../helpers');

// Required lazily: src/db resolves DB_FILE at load time, so touching it
// before startTestServer sets that variable would bind every query - and
// the server's own, through the module cache - to the real database.
const database = () => require('../../src/db').db;

let admin; let patient; let driver; let otherDriver;

/** Runs a booking to completion so there is something to report. */
async function completedBooking(who = patient) {
  await clearActiveBooking(who);
  driver = await goOnDuty(ACCOUNTS.driverALS, NITK);
  const { bookingId, offer } = await bookAndAwaitOffer(who, driver, {
    ambulance_type: 'ALS', ...NITK, address_text: 'NITK main gate',
  });
  await post(`/api/provider/offers/${offer.assignment_id}/accept`, undefined, { token: driver });
  await post(`/api/bookings/${bookingId}/cancel`, { reason: 'test close' }, { token: who });
  return bookingId;
}

test.before(async () => {
  await startTestServer();
  admin = await signIn(ACCOUNTS.admin.phone, ACCOUNTS.admin.password);
  patient = await signIn(ACCOUNTS.patient.phone, ACCOUNTS.patient.password);
  driver = await goOnDuty(ACCOUNTS.driverALS, NITK);
  otherDriver = await goOnDuty(ACCOUNTS.driverICU, NITK);
});

test.after(async () => { await stopTestServer(); });

// --------------------------------------------------------------- filing

test('the crew that attended can report the passenger', async () => {
  const bookingId = await completedBooking();

  const r = await post(`/api/provider/bookings/${bookingId}/report`, {
    reason_code: 'FAKE_BOOKING',
    details: 'Nobody at the pickup point and the number was switched off.',
  }, { token: driver });

  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.match(r.body.report_id, /^RPT/);

  const row = database().prepare('SELECT * FROM reports WHERE report_id = ?').get(r.body.report_id);
  assert.equal(row.report_status, 'OPEN', 'filing decides nothing');
  assert.equal(row.booking_id, bookingId);
});

test('filing a report does not touch the account it names', async () => {
  const before = database()
    .prepare('SELECT verification_status FROM users WHERE phone_no = ?')
    .get(ACCOUNTS.patient.phone).verification_status;

  assert.equal(
    before, 'VERIFIED',
    'a driver reports and an administrator decides; the report alone is not a sanction'
  );
});

test('an ambulance that did not attend cannot report the booking', async () => {
  const bookingId = await completedBooking();

  const r = await post(`/api/provider/bookings/${bookingId}/report`, {
    reason_code: 'ABUSIVE',
  }, { token: otherDriver });

  assert.equal(r.status, 403, 'evidence from somebody who was not there is worth nothing');
});

test('the same crew cannot report one booking twice', async () => {
  const bookingId = await completedBooking();

  const first = await post(`/api/provider/bookings/${bookingId}/report`,
    { reason_code: 'NO_SHOW' }, { token: driver });
  assert.equal(first.status, 201);

  const second = await post(`/api/provider/bookings/${bookingId}/report`,
    { reason_code: 'ABUSIVE' }, { token: driver });

  assert.equal(second.status, 409, 'a second thought is not a second incident');
  assert.equal(second.body.report_id, first.body.report_id);
});

test('a reason of OTHER has to say what happened', async () => {
  const bookingId = await completedBooking();

  const r = await post(`/api/provider/bookings/${bookingId}/report`,
    { reason_code: 'OTHER' }, { token: driver });

  assert.equal(r.status, 400);
  assert.equal(r.body.field, 'details');
});

test('a trip still running cannot be reported', async () => {
  await clearActiveBooking(patient);
  driver = await goOnDuty(ACCOUNTS.driverALS, NITK);
  const { bookingId, offer } = await bookAndAwaitOffer(patient, driver, {
    ambulance_type: 'ALS', ...NITK, address_text: 'NITK main gate',
  });
  await post(`/api/provider/offers/${offer.assignment_id}/accept`, undefined, { token: driver });

  const r = await post(`/api/provider/bookings/${bookingId}/report`,
    { reason_code: 'ABUSIVE' }, { token: driver });

  assert.equal(r.status, 409, 'a crew on the job has a trip to finish, not a form to fill in');
  await clearActiveBooking(patient);
});

// ------------------------------------------------------------- reviewing

test('the control room sees the report with the history behind it', async () => {
  const r = await get('/api/admin/reports', { token: admin });

  assert.equal(r.status, 200);
  assert.ok(r.body.reports.length > 0);

  const first = r.body.reports[0];
  assert.ok(first.reported_name, 'who it is about');
  assert.ok(first.reporter_name, 'and who said so');
  assert.ok(
    first.reports_against_subject >= 1,
    'one complaint is an incident and four are a pattern, so the count travels with it'
  );
});

test('a dismissed report cannot carry a penalty', async () => {
  const open = (await get('/api/admin/reports?report_status=OPEN', { token: admin })).body.reports[0];

  const r = await post(`/api/admin/reports/${open.report_id}/review`, {
    report_status: 'DISMISSED', action: 'SUSPEND',
  }, { token: admin });

  assert.equal(r.status, 400);
  assert.equal(r.body.field, 'action');
  assert.equal(
    database().prepare('SELECT report_status FROM reports WHERE report_id = ?').get(open.report_id).report_status,
    'OPEN',
    'and the report is left for somebody to rule on properly'
  );
});

test('upholding with a suspension locks the account and ends its sessions', async () => {
  const subject = await signIn(ACCOUNTS.patient2.phone, ACCOUNTS.patient2.password);
  const bookingId = await completedBooking(subject);

  const filed = await post(`/api/provider/bookings/${bookingId}/report`,
    { reason_code: 'FAKE_BOOKING', details: 'Repeated hoax calls.' }, { token: driver });
  assert.equal(filed.status, 201, JSON.stringify(filed.body));

  // Still signed in at this point.
  assert.equal((await get('/api/auth/me', { token: subject })).status, 200);

  const review = await post(`/api/admin/reports/${filed.body.report_id}/review`, {
    report_status: 'UPHELD', action: 'SUSPEND', review_remarks: 'Third hoax call this month.',
  }, { token: admin });

  assert.equal(review.status, 200, JSON.stringify(review.body));
  assert.equal(
    database().prepare('SELECT verification_status FROM users WHERE phone_no = ?')
      .get(ACCOUNTS.patient2.phone).verification_status,
    'SUSPENDED'
  );
  assert.equal(
    (await get('/api/auth/me', { token: subject })).status, 401,
    'a suspension that leaves somebody signed in until their token expires is not a suspension'
  );
  assert.equal(
    (await post('/api/auth/login', {
      phone_no: ACCOUNTS.patient2.phone, password: ACCOUNTS.patient2.password,
    })).status,
    403,
    'and they cannot sign back in'
  );
});

test('a report cannot be ruled on twice', async () => {
  const done = (await get('/api/admin/reports?report_status=UPHELD', { token: admin })).body.reports[0];

  const r = await post(`/api/admin/reports/${done.report_id}/review`,
    { report_status: 'DISMISSED' }, { token: admin });

  assert.equal(r.status, 409);
});

test('deleting erases the person and keeps the record', async () => {
  const subject = await signIn(ACCOUNTS.patient3?.phone || '9800000003', 'user123');
  const bookingId = await completedBooking(subject);

  const filed = await post(`/api/provider/bookings/${bookingId}/report`,
    { reason_code: 'ABUSIVE', details: 'Threatened the crew.' }, { token: driver });
  assert.equal(filed.status, 201, JSON.stringify(filed.body));

  const userId = database().prepare('SELECT user_id FROM users WHERE phone_no = ?').get('9800000003').user_id;
  const bookingsBefore = database()
    .prepare('SELECT COUNT(*) AS n FROM bookings WHERE user_id = ?').get(userId).n;

  const review = await post(`/api/admin/reports/${filed.body.report_id}/review`, {
    report_status: 'UPHELD', action: 'DELETE', review_remarks: 'Assaulted a driver.',
  }, { token: admin });
  assert.equal(review.status, 200, JSON.stringify(review.body));

  const after = database().prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
  assert.ok(after, 'the row stays, because bookings and invoices point at it');
  assert.equal(after.full_name, 'Deleted account');
  assert.notEqual(after.phone_no, '9800000003', 'the number is gone');
  assert.equal(after.password_hash, null);
  assert.equal(after.verification_status, 'SUSPENDED');

  assert.equal(
    database().prepare('SELECT COUNT(*) AS n FROM bookings WHERE user_id = ?').get(userId).n,
    bookingsBefore,
    'the history survives: C.5 needs it, including for the dispute that led here'
  );
  assert.ok(
    database().prepare('SELECT 1 FROM reports WHERE report_id = ?').get(filed.body.report_id),
    'and so does the report that justified it'
  );
});

test('the number a deleted account gave up can be registered again', async () => {
  const r = await post('/api/auth/register', {
    full_name: 'Someone New', phone_no: '9800000003',
    email_id: 'someone.new@example.in', password: 'Vx7#qLm4Zt',
  });

  assert.equal(
    r.status, 202,
    'erasure has to free the identifiers, or the person is punished by proxy for ever'
  );
});
