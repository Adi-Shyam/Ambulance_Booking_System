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
