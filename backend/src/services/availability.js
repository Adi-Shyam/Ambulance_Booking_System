'use strict';
// One definition of "this ambulance can be dispatched right now".
//
// Constraint C.6 requires driver availability to be validated before dispatch,
// and F.13 asks the control room to see the operational picture. Those must be
// the same picture: a dashboard reporting four ambulances free while the
// matcher would consider none is worse than no number at all.
//
// A provider counts as dispatchable when the account and the vehicle are both
// VERIFIED, the driver has marked themselves AVAILABLE, a position is known,
// and that position is recent. The last clause matters because the SRS assumes
// (section 2.5) that drivers keep their availability and location updated while
// on duty; a phone that stopped reporting has stopped honouring that assumption.
const config = require('../config');

/** Instant before which a position is considered stale. */
function staleCutoffIso(now = Date.now()) {
  return new Date(now - config.dispatch.providerStaleMinutes * 60_000).toISOString();
}

/**
 * SQL predicate for a dispatchable provider.
 * @param {string} p alias of the `providers` table
 * @param {string|null} u alias of a joined `users` table, when available
 * @returns {string} a boolean SQL fragment with one `?` for the stale cutoff
 */
function dispatchablePredicate(p = 'p', u = null) {
  return [
    `${p}.availability_status = 'AVAILABLE'`,
    `${p}.verification_status = 'VERIFIED'`,
    u ? `${u}.verification_status = 'VERIFIED'` : null,
    `${p}.latitude IS NOT NULL`,
    `${p}.longitude IS NOT NULL`,
    `${p}.last_seen_timestamp IS NOT NULL`,
    `${p}.last_seen_timestamp >= ?`,
  ]
    .filter(Boolean)
    .join('\n       AND ');
}

module.exports = { staleCutoffIso, dispatchablePredicate };
