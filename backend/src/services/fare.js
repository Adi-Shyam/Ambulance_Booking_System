'use strict';
// F.10 - fare computation. The breakdown follows the Data Dictionary composite
// group `fare_breakdown` = base_fare + distance_charge + (type_surcharge)
//                          + tax_amount + fare_amount. All amounts are INR to
// two decimals.
const config = require('../config');
const { db } = require('../db');

const round2 = (n) => Number(Number(n).toFixed(2));

function rulesFor(ambulanceType) {
  const row = db.prepare('SELECT * FROM fare_rules WHERE ambulance_type = ?').get(ambulanceType);
  if (!row) throw new Error(`No fare rule configured for ${ambulanceType}`);
  return row;
}

function allRules() {
  return db.prepare('SELECT * FROM fare_rules ORDER BY base_fare').all();
}

/**
 * @param {string} ambulanceType BLS | ALS | ICU | PTV
 * @param {number} distanceKm road distance of the completed trip
 */
function calculate(ambulanceType, distanceKm) {
  const rule = rulesFor(ambulanceType);
  const km = Math.max(0, Number(distanceKm) || 0);

  const base_fare = round2(rule.base_fare);
  const distance_charge = round2(km * rule.per_km_rate);
  const type_surcharge = round2(rule.type_surcharge);
  const taxable = base_fare + distance_charge + type_surcharge;
  const tax_amount = round2((taxable * config.taxPercent) / 100);
  const fare_amount = round2(taxable + tax_amount);

  return {
    base_fare,
    distance_charge,
    type_surcharge,
    tax_amount,
    fare_amount,
    distance_km: round2(km),
    per_km_rate: round2(rule.per_km_rate),
    tax_percent: config.taxPercent,
  };
}

/** Pre-trip estimate shown on the booking screen so the user is not surprised. */
function estimate(ambulanceType, distanceKm) {
  const f = calculate(ambulanceType, distanceKm);
  return { ...f, estimated: true };
}

module.exports = { calculate, estimate, rulesFor, allRules };
