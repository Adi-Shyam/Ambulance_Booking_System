'use strict';
// Unit tests - fare calculation (F.10)
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { useTempDatabase } = require('./bootstrap');

useTempDatabase('fare');

const { migrate } = require('../../src/db');
const fare = require('../../src/services/fare');

before(() => migrate());


describe('fare calculation (F.10)', () => {
  test('breakdown follows the data dictionary composite group', () => {
    const f = fare.calculate('ALS', 10);
    assert.deepEqual(Object.keys(f).sort(), [
      'base_fare', 'distance_charge', 'distance_km', 'fare_amount',
      'per_km_rate', 'tax_amount', 'tax_percent', 'type_surcharge',
    ]);
  });

  test('total is the sum of its components plus tax', () => {
    const f = fare.calculate('ICU', 12.5);
    const taxable = f.base_fare + f.distance_charge + f.type_surcharge;
    assert.equal(f.tax_amount, Number((taxable * 0.05).toFixed(2)));
    assert.equal(f.fare_amount, Number((taxable + f.tax_amount).toFixed(2)));
  });

  test('every amount is money-rounded to two decimals', () => {
    const f = fare.calculate('BLS', 7.777);
    for (const key of ['base_fare', 'distance_charge', 'type_surcharge', 'tax_amount', 'fare_amount']) {
      assert.equal(f[key], Number(f[key].toFixed(2)), `${key} carried more than 2 decimals`);
    }
  });

  test('a zero-distance trip still bills the base fare, never a negative', () => {
    const f = fare.calculate('PTV', 0);
    assert.equal(f.distance_charge, 0);
    assert.ok(f.fare_amount > 0);
  });

  test('negative distance is clamped rather than credited', () => {
    assert.equal(fare.calculate('BLS', -50).distance_charge, 0);
  });

  test('higher care levels cost more over the same distance', () => {
    const order = ['PTV', 'BLS', 'ALS', 'ICU'].map((t) => fare.calculate(t, 10).fare_amount);
    assert.deepEqual(order, [...order].sort((a, b) => a - b), 'fares should rise with capability');
  });

  test('an unknown ambulance type is rejected, not silently priced', () => {
    assert.throws(() => fare.calculate('XYZ', 5));
  });
});
