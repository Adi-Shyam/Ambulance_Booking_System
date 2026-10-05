'use strict';
// =====================================================================
// Recovery sweep.
//
// NF.1 requires that a request is not left unserved, and C.6 requires driver
// availability to be validated before dispatch. The offer timer already covers
// a driver who never answers. What it does not cover is a driver who answers
// and then disappears: the phone dies, the app is killed, the signal drops.
//
// Without this sweep such a booking sits in ASSIGNED for ever - the patient
// watches an ETA that never changes, and the ambulance is held BUSY so it is
// removed from the fleet permanently. Both are silent failures in a service
// where waiting is the harm.
//
// The sweep runs three checks:
//   1. providers marked AVAILABLE that have stopped reporting  -> OFFLINE
//   2. active trips whose driver has gone silent               -> flagged
//   3. bookings stuck MATCHING with no live offer              -> re-offered
// =====================================================================
const config = require('../config');
const { db, nowIso, audit } = require('../db');
const { staleCutoffIso } = require('./availability');
const notifications = require('./notifications');
const sockets = require('../realtime/socket');

let timer = null;

/**
 * 1. A driver who stopped reporting is no longer dispatchable. Marking them
 *    OFFLINE makes that explicit, so the control room sees why the fleet
 *    shrank instead of watching requests fail against phantom availability.
 */
function retireStaleProviders() {
  const cutoff = staleCutoffIso();
  const stale = db.prepare(
    `SELECT provider_id, user_id FROM providers
     WHERE availability_status = 'AVAILABLE'
       AND (last_seen_timestamp IS NULL OR last_seen_timestamp < ?)`
  ).all(cutoff);

  for (const provider of stale) {
    db.prepare("UPDATE providers SET availability_status = 'OFFLINE', updated_at = ? WHERE provider_id = ?")
      .run(nowIso(), provider.provider_id);

    audit('PROVIDER_AUTO_OFFLINE', {
      entityType: 'provider',
      entityId: provider.provider_id,
      details: { reason: 'no position reported', stale_since: cutoff },
    });

    notifications.notify(provider.user_id, {
      title: 'You were taken off duty',
      body: `Your app stopped reporting its location for more than ${config.dispatch.providerStaleMinutes} minutes, so you were marked off duty. Go on duty again to receive requests.`,
      eventType: 'AUTO_OFFLINE',
    });

    sockets.toProvider(provider.provider_id, 'provider:auto-offline', { reason: 'stale_location' });
    sockets.toAdmins('admin:provider:update', {
      provider_id: provider.provider_id,
      availability_status: 'OFFLINE',
    });
  }

  return stale.length;
}

/**
 * 2. An accepted trip whose driver has gone quiet. The booking is not cancelled
 *    automatically - a silent phone does not prove the ambulance is not on its
 *    way, and cancelling a live emergency run would be worse than the silence.
 *    Instead the patient and the control room are told once, and the booking is
 *    surfaced for an operator to act on (F.13 dispute and monitoring tools).
 */
function flagAbandonedTrips() {
  const silenceCutoff = new Date(Date.now() - config.watchdog.tripSilenceMinutes * 60_000).toISOString();

  const stalled = db.prepare(
    `SELECT b.booking_id, b.user_id, b.assigned_provider_id, t.trip_id, t.trip_milestone,
            COALESCE(
              (SELECT MAX(tl.gps_timestamp) FROM trip_locations tl WHERE tl.trip_id = t.trip_id),
              t.trip_start_time
            ) AS last_contact
     FROM bookings b
     JOIN trips t ON t.booking_id = b.booking_id
     WHERE b.booking_status IN ('ASSIGNED','ENROUTE','ARRIVED','ONBOARD')
       AND b.stall_flagged_at IS NULL`
  ).all().filter((row) => row.last_contact < silenceCutoff);

  for (const row of stalled) {
    db.prepare('UPDATE bookings SET stall_flagged_at = ?, updated_at = ? WHERE booking_id = ?')
      .run(nowIso(), nowIso(), row.booking_id);

    audit('TRIP_STALLED', {
      entityType: 'booking',
      entityId: row.booking_id,
      details: {
        trip_id: row.trip_id,
        provider_id: row.assigned_provider_id,
        milestone: row.trip_milestone,
        last_contact: row.last_contact,
      },
    });

    notifications.notify(row.user_id, {
      title: 'We have lost contact with your ambulance',
      body: 'The crew has not reported their position recently. Our control room has been alerted. If this is urgent, please also call 108.',
      eventType: 'TRIP_STALLED',
      bookingId: row.booking_id,
    });

    sockets.toAdmins('admin:trip:stalled', {
      booking_id: row.booking_id,
      trip_id: row.trip_id,
      provider_id: row.assigned_provider_id,
      milestone: row.trip_milestone,
      last_contact: row.last_contact,
    });
  }

  return stalled.length;
}

/**
 * 3. A booking left MATCHING with no offer outstanding. This should not happen
 *    - every path either issues the next offer or fails the booking - but if a
 *    crash lands between the two, the request would wait for ever. Re-offering
 *    is the safe correction.
 */
async function resumeStalledMatching(dispatch) {
  const orphans = db.prepare(
    `SELECT b.booking_id FROM bookings b
     WHERE b.booking_status IN ('REQUESTED','MATCHING')
       AND NOT EXISTS (
         SELECT 1 FROM assignments a
         WHERE a.booking_id = b.booking_id AND a.assignment_status = 'OFFERED'
       )`
  ).all();

  for (const { booking_id } of orphans) {
    audit('DISPATCH_RESUMED', { entityType: 'booking', entityId: booking_id });
    await dispatch.offerNext(booking_id).catch((err) =>
      console.error(`[watchdog] could not resume ${booking_id}:`, err.message)
    );
  }

  return orphans.length;
}

async function sweep() {
  // Required lazily: dispatch pulls in this module's siblings, and requiring it
  // at load time would close a cycle through services/index.
  const dispatch = require('./dispatch');
  try {
    const retired = retireStaleProviders();
    const flagged = flagAbandonedTrips();
    const resumed = await resumeStalledMatching(dispatch);

    if (retired || flagged || resumed) {
      console.log(
        `[watchdog] ${retired} provider(s) taken off duty, ${flagged} stalled trip(s) flagged, ${resumed} booking(s) re-offered`
      );
    }
  } catch (err) {
    // The sweep must never take the server down with it.
    console.error('[watchdog] sweep failed:', err.message);
  }
}

function start() {
  if (!config.watchdog.enabled || timer) return null;
  timer = setInterval(sweep, config.watchdog.intervalSeconds * 1000);
  if (typeof timer.unref === 'function') timer.unref();
  console.log(`[watchdog] recovery sweep every ${config.watchdog.intervalSeconds}s`);
  return timer;
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, sweep, retireStaleProviders, flagAbandonedTrips, resumeStalledMatching };
