'use strict';
// Unit tests - geodesy (F.5, F.8)
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { useTempDatabase } = require('./bootstrap');

useTempDatabase('geodesy');

const { haversineKm, fallbackEtaMinutes, decodePolyline } = require('../../src/utils/geo');


describe('geodesy (F.5, F.8)', () => {
  test('distance between two known points is accurate', () => {
    // NITK Surathkal to Mangaluru city centre, about 20 km.
    const km = haversineKm(13.010389, 74.794243, 12.8698, 74.8431);
    assert.ok(km > 15 && km < 22, `expected ~20 km, got ${km}`);
  });

  test('distance from a point to itself is zero', () => {
    assert.equal(haversineKm(13.01, 74.79, 13.01, 74.79), 0);
  });

  test('distance is symmetric', () => {
    const a = haversineKm(13.01, 74.79, 12.87, 74.84);
    const b = haversineKm(12.87, 74.84, 13.01, 74.79);
    assert.ok(Math.abs(a - b) < 1e-9);
  });

  test('fallback ETA never returns zero minutes', () => {
    assert.ok(fallbackEtaMinutes(0.05) >= 1);
  });

  test('polyline decoding round-trips a known encoding', () => {
    // Encoding of (38.5, -120.2), (40.7, -120.95), (43.252, -126.453).
    const points = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    assert.equal(points.length, 3);
    assert.ok(Math.abs(points[0][0] - 38.5) < 1e-5);
    assert.ok(Math.abs(points[2][1] - -126.453) < 1e-5);
  });

  test('an empty polyline decodes to no points', () => {
    assert.deepEqual(decodePolyline(''), []);
    assert.deepEqual(decodePolyline(null), []);
  });
});
