'use strict';
require('./bootstrap');

const test = require('node:test');
const assert = require('node:assert/strict');

const messaging = require('../../src/services/messaging');

const BOOKING = {
  booking_id: 'BK00000001',
  ambulance_type: 'ALS',
  address_text: 'NITK Surathkal main gate',
  latitude: 13.0104,
  longitude: 74.7942,
  landmark: 'Near the bus stop',
  notes: 'Chest pain,\nconscious',          // deliberately multi-line
};
const PROVIDER = { vehicle_reg_no: 'KA19CD5678', ambulance_type: 'ALS' };

test('templates carry both a readable body and template parameters', async (t) => {
  await t.test('dispatchAlert', () => {
    const r = messaging.templates.dispatchAlert({
      booking: BOOKING, provider: PROVIDER, distanceKm: 1.41, expirySeconds: 45,
    });
    assert.ok(r.body.includes('BK00000001'), 'body names the booking');
    assert.ok(r.body.includes('1.41 km'), 'body carries the distance');
    assert.ok(Array.isArray(r.params) && r.params.length === 5);
    assert.equal(r.params[0], 'BK00000001');
    assert.equal(r.params[4], '45');
  });

  await t.test('assignmentConfirmed falls back when there is no ETA', () => {
    const withEta = messaging.templates.assignmentConfirmed({
      booking: BOOKING, provider: PROVIDER, driverName: 'Suresh Naik', etaMinutes: 4,
    });
    const without = messaging.templates.assignmentConfirmed({
      booking: BOOKING, provider: PROVIDER, driverName: 'Suresh Naik', etaMinutes: null,
    });
    assert.equal(withEta.params[3], 'about 4 minute(s)');
    // A template parameter may not be empty, so the no-ETA case still says something.
    assert.equal(without.params[3], 'shortly');
    assert.ok(without.params.every((p) => String(p).length > 0));
  });

  await t.test('statusUpdate renders each milestone', () => {
    for (const m of ['ASSIGNED', 'ENROUTE', 'ARRIVED', 'ONBOARD', 'COMPLETED']) {
      const r = messaging.templates.statusUpdate({ booking: BOOKING, milestone: m, etaMinutes: 3 });
      assert.ok(r.body.includes('BK00000001'));
      assert.equal(r.params.length, 3);
      assert.ok(r.params.every((p) => String(p).length > 0), m + ' has no empty parameter');
    }
  });

  await t.test('no template parameter contains a newline or tab', () => {
    // Meta rejects the whole message if one does, and the booking notes above
    // deliberately contain a line break.
    const all = [
      messaging.templates.dispatchAlert({ booking: BOOKING, provider: PROVIDER, distanceKm: 2, expirySeconds: 45 }),
      messaging.templates.assignmentConfirmed({ booking: BOOKING, provider: PROVIDER, driverName: 'A B', etaMinutes: 2 }),
      messaging.templates.statusUpdate({ booking: BOOKING, milestone: 'ENROUTE', etaMinutes: 2 }),
    ];
    for (const r of all) {
      for (const p of r.params) {
        assert.ok(!/[\r\n\t]/.test(String(p)), `parameter ${JSON.stringify(p)} is flat`);
      }
    }
  });
});

test('E.164 formatting for the Cloud API', async (t) => {
  await t.test('prefixes the country code for a local number', () => {
    assert.equal(messaging.toE164('9700000002'), '919700000002');
  });

  await t.test('leaves an already-international number alone', () => {
    assert.equal(messaging.toE164('919700000002'), '919700000002');
  });

  await t.test('strips punctuation', () => {
    assert.equal(messaging.toE164('+91 97000-00002'), '919700000002');
  });
});

test('the email transport is resolved from what is configured, not what is asked for', async (t) => {
  // Naming a provider whose key is absent must not leave every send failing
  // silently at run time; it falls back to the mock, which at least records.
  const resolve = (env) => {
    const saved = { ...process.env };
    Object.assign(process.env, {
      EMAIL_PROVIDER: '', BREVO_API_KEY: '', EMAIL_HOST: '', EMAIL_USER: '', ...env,
    });
    // config and messaging both read the environment at load time.
    for (const k of Object.keys(require.cache)) {
      if (k.includes('config.js') || k.includes('messaging.js')) delete require.cache[k];
    }
    const result = require('../../src/services/messaging').emailTransport();
    process.env = saved;
    for (const k of Object.keys(require.cache)) {
      if (k.includes('config.js') || k.includes('messaging.js')) delete require.cache[k];
    }
    return result;
  };

  await t.test('nothing configured falls back to the mock', () => {
    assert.equal(resolve({}), 'mock');
  });

  await t.test('a Brevo key alone selects Brevo', () => {
    assert.equal(resolve({ BREVO_API_KEY: 'xkeysib-test' }), 'brevo');
  });

  await t.test('SMTP credentials alone select SMTP', () => {
    assert.equal(resolve({ EMAIL_HOST: 'smtp.gmail.com', EMAIL_USER: 'a@b.com' }), 'smtp');
  });

  await t.test('Brevo wins when both are available, because HTTPS travels further', () => {
    assert.equal(
      resolve({ BREVO_API_KEY: 'k', EMAIL_HOST: 'smtp.gmail.com', EMAIL_USER: 'a@b.com' }),
      'brevo'
    );
  });

  await t.test('an explicit choice is honoured over the other one', () => {
    assert.equal(
      resolve({ EMAIL_PROVIDER: 'smtp', BREVO_API_KEY: 'k', EMAIL_HOST: 'h', EMAIL_USER: 'u' }),
      'smtp'
    );
  });

  await t.test('a provider named without credentials cannot be selected', () => {
    assert.equal(resolve({ EMAIL_PROVIDER: 'brevo' }), 'mock');
  });

  await t.test('mock can be forced even when a provider is configured', () => {
    assert.equal(resolve({ EMAIL_PROVIDER: 'mock', BREVO_API_KEY: 'k' }), 'mock');
  });
});

test('the sender address is split for Brevo', async (t) => {
  await t.test('a named sender', () => {
    assert.deepEqual(
      messaging.parseFrom('Ambulance Booking System <no-reply@nitk.ac.in>'),
      { name: 'Ambulance Booking System', email: 'no-reply@nitk.ac.in' }
    );
  });

  await t.test('a bare address', () => {
    assert.deepEqual(messaging.parseFrom('no-reply@nitk.ac.in'), { email: 'no-reply@nitk.ac.in' });
  });
});

test('a destination is masked before it goes back in a response', async (t) => {
  await t.test('an email keeps only its first and last local character', () => {
    assert.equal(messaging.maskDestination('adithya.shyam@gmail.com', 'EMAIL'), 'a***********m@gmail.com');
  });

  await t.test('a very short local part still gets masked', () => {
    assert.equal(messaging.maskDestination('ab@x.com', 'EMAIL'), 'a*@x.com');
  });

  await t.test('a phone keeps the last four digits, as a bank statement would', () => {
    assert.equal(messaging.maskDestination('9876543210', 'WHATSAPP'), '98****3210');
  });
});
