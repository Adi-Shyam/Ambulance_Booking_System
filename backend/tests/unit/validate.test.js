'use strict';
// Unit tests - validators (Data Dictionary section 2)
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { useTempDatabase } = require('./bootstrap');

useTempDatabase('validators');

const v = require('../../src/utils/validate');


describe('data dictionary validation', () => {
  test('accepts a valid Indian mobile number and strips formatting', () => {
    assert.equal(v.phone('+91 98000-00001'), '9800000001');
  });

  test('rejects numbers outside the 6-9 leading-digit rule', () => {
    for (const bad of ['1234567890', '5800000001', '98000', '']) {
      assert.throws(() => v.phone(bad), /valid 10-digit|required/, `accepted ${bad}`);
    }
  });

  test('normalises and validates a vehicle registration', () => {
    assert.equal(v.vehicleRegNo('ka19 ab-1234'), 'KA19AB1234');
    assert.throws(() => v.vehicleRegNo('KA19AB123'));
  });

  test('restricts enumerations to the specified values', () => {
    assert.equal(v.oneOf('als', v.AMBULANCE_TYPES, 'ambulance_type'), 'ALS');
    assert.throws(() => v.oneOf('XRAY', v.AMBULANCE_TYPES, 'ambulance_type'));
  });

  test('bounds coordinates to the WGS-84 range', () => {
    assert.equal(v.coordinate('13.0103891', 'lat', 'latitude'), 13.010389);
    assert.throws(() => v.coordinate(91, 'lat', 'latitude'));
    assert.throws(() => v.coordinate(181, 'lng', 'longitude'));
  });

  test('ratings are integers from 1 to 5', () => {
    assert.equal(v.rating(4), 4);
    for (const bad of [0, 6, 3.5]) assert.throws(() => v.rating(bad));
  });

  test('optional text is length-capped', () => {
    assert.equal(v.text('', 10, 'notes'), null);
    assert.throws(() => v.text('x'.repeat(11), 10, 'notes'));
  });
});
