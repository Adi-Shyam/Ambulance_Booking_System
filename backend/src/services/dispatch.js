'use strict';
// =====================================================================
// Dispatch engine - F.5 (match nearest available ambulance), F.6 (notify
// through WhatsApp + in-app), F.7 (accept / reject / timeout with automatic
// reassignment) and constraint C.6 (request timeouts, automatic reassignment,
// availability validated before dispatch).
//
// Lifecycle of one booking:
//   REQUESTED -> MATCHING -> (offer -> accept) -> ASSIGNED -> trip milestones
//                         \-> (reject/timeout) -> next candidate
//                         \-> candidates exhausted -> FAILED
// =====================================================================
const config = require('../config');
const { db, nowIso, audit } = require('../db');
const { nextId } = require('../utils/ids');
const { haversineKm } = require('../utils/geo');
const sockets = require('../realtime/socket');
const { staleCutoffIso, dispatchablePredicate } = require('./availability');
const messaging = require('./messaging');
const notifications = require('./notifications');
const maps = require('./maps');

// Capability tiers: a higher-capability ambulance may serve a lower-tier
// request when no exact match is free, but never the other way round.
//
// EMG sits at 0 because it is not a vehicle class. It means "emergency, send
// whatever is nearest", so every ambulance in range clears the floor and none
// is turned away for being the wrong kind.
const TIER = { EMG: 0, PTV: 1, BLS: 2, ALS: 3, ICU: 4 };

// An emergency goes to everyone nearby at once rather than down the ranked
// list one at a time. The cap exists so a dense city cannot turn one request
// into hundreds of alerts; candidates are ranked, so it keeps the best.
const BROADCAST_TYPES = new Set(['EMG']);
const isBroadcast = (booking) => BROADCAST_TYPES.has(booking.ambulance_type);

// In-process offer timers. A sweep on boot (see expireStaleOffers) covers the
// case where the server restarts while offers are outstanding.
const timers = new Map();

// ---------------------------------------------------------------- helpers
const getBooking = (id) => db.prepare('SELECT * FROM bookings WHERE booking_id = ?').get(id);
const getProvider = (id) => db.prepare('SELECT * FROM providers WHERE provider_id = ?').get(id);

function providerWithUser(providerId) {
  return db.prepare(
    `SELECT p.*, u.full_name, u.phone_no, u.user_id AS driver_user_id
     FROM providers p JOIN users u ON u.user_id = p.user_id
     WHERE p.provider_id = ?`
  ).get(providerId);
}

function providerRating(p) {
  return p.rating_count > 0 ? p.rating_sum / p.rating_count : 4.0; // neutral prior
}

/** The provider fields a patient or operator is allowed to see. */
function summariseProvider(provider) {
  return {
    provider_id: provider.provider_id,
    driver_name: provider.full_name,
    phone_no: provider.phone_no,
    vehicle_reg_no: provider.vehicle_reg_no,
    ambulance_type: provider.ambulance_type,
    latitude: provider.latitude,
    longitude: provider.longitude,
    rating: Number(providerRating(provider).toFixed(2)),
  };
}

function publicBooking(booking) {
  const provider = booking.assigned_provider_id ? providerWithUser(booking.assigned_provider_id) : null;
  const trip = db.prepare('SELECT * FROM trips WHERE booking_id = ?').get(booking.booking_id);
  return {
    ...booking,
    provider: provider ? summariseProvider(provider) : null,
    trip: trip || null,
  };
}

/**
 * Batch form of `publicBooking` (NF.4).
 *
 * The single-row version issues two extra queries per booking, so a 100-row
 * control-room list cost 201 round trips. This resolves every provider and trip
 * in two queries regardless of the page size.
 */
function publicBookings(bookings) {
  if (bookings.length === 0) return [];

  const providerIds = [...new Set(bookings.map((b) => b.assigned_provider_id).filter(Boolean))];
  const bookingIds = bookings.map((b) => b.booking_id);
  const placeholders = (n) => Array.from({ length: n }, () => '?').join(',');

  const providers = new Map(
    (providerIds.length
      ? db.prepare(
          `SELECT p.*, u.full_name, u.phone_no, u.user_id AS driver_user_id
           FROM providers p JOIN users u ON u.user_id = p.user_id
           WHERE p.provider_id IN (${placeholders(providerIds.length)})`
        ).all(...providerIds)
      : []
    ).map((p) => [p.provider_id, p])
  );

  const trips = new Map(
    db.prepare(`SELECT * FROM trips WHERE booking_id IN (${placeholders(bookingIds.length)})`)
      .all(...bookingIds)
      .map((t) => [t.booking_id, t])
  );

  return bookings.map((booking) => {
    const provider = booking.assigned_provider_id ? providers.get(booking.assigned_provider_id) : null;
    return {
      ...booking,
      provider: provider ? summariseProvider(provider) : null,
      trip: trips.get(booking.booking_id) || null,
    };
  });
}

function broadcastBooking(booking) {
  const payload = publicBooking(booking);
  sockets.toUser(booking.user_id, 'booking:update', payload);
  sockets.toBooking(booking.booking_id, 'booking:update', payload);
  sockets.toAdmins('admin:booking:update', payload);
  return payload;
}

// -------------------------------------------------------------- F.5 match
/**
 * Ranks providers near the pickup point. Availability, verification status and
 * ambulance capability are all validated here, before any offer goes out (C.6).
 *
 * rank_score (0-100, per the Data Dictionary) combines:
 *   proximity 60 | rating 25 | exact type match 15
 */
function findCandidates(booking, excludeProviderIds = []) {
  const requestedTier = TIER[booking.ambulance_type];
  const radius = config.dispatch.searchRadiusKm;

  // A degree of latitude is ~111 km everywhere; a degree of longitude shrinks
  // with the cosine of the latitude. Bounding the search in SQL keeps the rows
  // read proportional to the ambulances near the caller rather than to the size
  // of the whole fleet (NF.4).
  const latPad = radius / 111;
  const lngPad = radius / (111 * Math.max(0.01, Math.cos((booking.latitude * Math.PI) / 180)));

  const rows = db.prepare(
    `SELECT p.*, u.full_name, u.phone_no
     FROM providers p
     JOIN users u ON u.user_id = p.user_id
     WHERE ${dispatchablePredicate('p', 'u')}
       AND p.latitude BETWEEN ? AND ?
       AND p.longitude BETWEEN ? AND ?`
  ).all(
    staleCutoffIso(),
    booking.latitude - latPad, booking.latitude + latPad,
    booking.longitude - lngPad, booking.longitude + lngPad
  );

  return rows
    .filter((p) => !excludeProviderIds.includes(p.provider_id))
    .filter((p) => TIER[p.ambulance_type] >= requestedTier) // never downgrade care level
    .map((p) => {
      const distance_km = Number(
        haversineKm(booking.latitude, booking.longitude, p.latitude, p.longitude).toFixed(2)
      );
      const proximity = Math.max(0, 1 - distance_km / radius) * 60;
      const quality = (providerRating(p) / 5) * 25;
      const exactType = p.ambulance_type === booking.ambulance_type ? 15 : 5;
      return { ...p, distance_km, rank_score: Number((proximity + quality + exactType).toFixed(2)) };
    })
    .filter((p) => p.distance_km <= radius)
    .sort((a, b) => b.rank_score - a.rank_score);
}

function alreadyTried(bookingId) {
  return db
    .prepare('SELECT provider_id FROM assignments WHERE booking_id = ?')
    .all(bookingId)
    .map((r) => r.provider_id);
}

// ------------------------------------------------------- F.6 offer + alert
/**
 * Everything a driver is told about one offer.
 */
function offerPayload({ booking, candidate, assignmentId, expiry, broadcast }) {
  return {
    assignment_id: assignmentId,
    booking_id: booking.booking_id,
    provider_id: candidate.provider_id,
    ambulance_type: booking.ambulance_type,
    pickup: {
      latitude: booking.latitude,
      longitude: booking.longitude,
      address_text: booking.address_text,
      landmark: booking.landmark,
      pincode: booking.pincode,
    },
    drop: booking.drop_latitude
      ? { latitude: booking.drop_latitude, longitude: booking.drop_longitude, address_text: booking.drop_address_text }
      : null,
    patient_name: booking.patient_name,
    notes: booking.notes,
    distance_km: candidate.distance_km,
    rank_score: candidate.rank_score,
    offer_expiry_timestamp: expiry,
    expires_in_seconds: config.dispatch.offerTimeoutSeconds,
    booking_timestamp: booking.booking_timestamp,
    // True when this offer went to several ambulances at once, so the console
    // can say "first to accept" rather than implying the job is already theirs.
    broadcast: Boolean(broadcast),
  };
}

/**
 * Writes one OFFERED assignment and alerts that driver every way we have:
 * socket, in-app inbox, push and WhatsApp. Shared by the sequential and the
 * broadcast paths so the two cannot drift apart.
 */
function alertCandidate({ booking, candidate, broadcast }) {
  const assignmentId = nextId('assignment');
  const createdAt = nowIso();
  const expiry = new Date(Date.now() + config.dispatch.offerTimeoutSeconds * 1000).toISOString();

  db.prepare(
    `INSERT INTO assignments (assignment_id, booking_id, provider_id, assignment_status,
                              offer_expiry_timestamp, rank_score, distance_km, created_at)
     VALUES (?, ?, ?, 'OFFERED', ?, ?, ?, ?)`
  ).run(
    assignmentId, booking.booking_id, candidate.provider_id, expiry,
    candidate.rank_score, candidate.distance_km, createdAt
  );

  audit('DISPATCH_OFFER_SENT', {
    entityType: 'assignment',
    entityId: assignmentId,
    details: {
      booking_id: booking.booking_id,
      provider_id: candidate.provider_id,
      rank_score: candidate.rank_score,
      distance_km: candidate.distance_km,
      broadcast: Boolean(broadcast),
    },
  });

  const payload = offerPayload({ booking, candidate, assignmentId, expiry, broadcast });

  sockets.toProvider(candidate.provider_id, 'offer:new', payload);
  notifications.notify(candidate.user_id, {
    title: broadcast
      ? `EMERGENCY - ${candidate.distance_km} km away`
      : `New ${booking.ambulance_type} request`,
    body: broadcast
      ? `${booking.address_text || 'shared location'} - first to accept takes it`
      : `Pickup: ${booking.address_text || 'shared location'} - ${candidate.distance_km} km away`,
    eventType: 'OFFER',
    bookingId: booking.booking_id,
    // F.14 / "alerts should be real": a driver with the app closed is exactly
    // the person this has to reach, so the offer goes out as a push too.
    push: {
      priority: 'high',
      data: { type: 'OFFER', assignment_id: assignmentId, booking_id: booking.booking_id },
    },
  });

  messaging
    .sendWhatsApp({
      phoneNo: candidate.phone_no,
      bookingId: booking.booking_id,
      templateId: config.whatsapp.templates.dispatch,
      ...messaging.templates.dispatchAlert({
        booking,
        provider: candidate,
        distanceKm: candidate.distance_km,
        expirySeconds: config.dispatch.offerTimeoutSeconds,
      }),
    })
    .catch((err) => console.error('[dispatch] whatsapp alert failed:', err.message));

  scheduleTimeout(assignmentId, config.dispatch.offerTimeoutSeconds * 1000);
  return { assignmentId, payload };
}

/**
 * Offers the booking to the next best candidate, or - for an emergency - to
 * every nearby ambulance at once. Returns the assignment row (the first one,
 * when several went out), or null when no candidate is left; the booking is
 * then marked FAILED.
 */
async function offerNext(bookingId) {
  let booking = getBooking(bookingId);
  if (!booking) return null;
  if (!['REQUESTED', 'MATCHING'].includes(booking.booking_status)) return null;

  if (booking.retry_count >= config.dispatch.maxRetries) {
    return failBooking(bookingId, 'Retry limit reached without an acceptance');
  }

  const candidates = findCandidates(booking, alreadyTried(bookingId));
  if (candidates.length === 0) {
    return failBooking(bookingId, 'No available ambulance matched this request');
  }

  const broadcast = isBroadcast(booking);
  const chosen = broadcast
    ? candidates.slice(0, config.dispatch.broadcastLimit)
    : [candidates[0]];

  db.prepare(
    `UPDATE bookings SET booking_status = 'MATCHING', retry_count = retry_count + 1, updated_at = ?
     WHERE booking_id = ?`
  ).run(nowIso(), bookingId);

  booking = getBooking(bookingId);

  const sent = chosen.map((candidate) => alertCandidate({ booking, candidate, broadcast }));

  // The control room sees one entry per ambulance alerted, so a broadcast is
  // visible as the fan-out it is rather than as a single mysterious offer.
  for (const { payload } of sent) {
    sockets.toAdmins('admin:dispatch', { ...payload, event: 'OFFERED' });
  }

  broadcastBooking(booking);

  return db.prepare('SELECT * FROM assignments WHERE assignment_id = ?').get(sent[0].assignmentId);
}

/**
 * How many offers on this booking are still live. A broadcast must not advance
 * to the next round of candidates - or fail - while other drivers are still
 * looking at the same request.
 */
function liveOffers(bookingId, excludeAssignmentId = null) {
  return db.prepare(
    `SELECT COUNT(*) AS n FROM assignments
     WHERE booking_id = ? AND assignment_status = 'OFFERED' AND assignment_id <> ?`
  ).get(bookingId, excludeAssignmentId || '').n;
}
function scheduleTimeout(assignmentId, ms) {
  clearTimeout(timers.get(assignmentId));
  const t = setTimeout(() => {
    timers.delete(assignmentId);
    timeoutOffer(assignmentId).catch((err) => console.error('[dispatch] timeout handling failed:', err.message));
  }, ms);
  if (typeof t.unref === 'function') t.unref();
  timers.set(assignmentId, t);
}

// ------------------------------------------------- F.7 accept / reject / TO
async function acceptOffer(assignmentId, providerId) {
  const assignment = db.prepare('SELECT * FROM assignments WHERE assignment_id = ?').get(assignmentId);
  if (!assignment) throw Object.assign(new Error('Offer not found'), { status: 404 });
  if (assignment.provider_id !== providerId) {
    throw Object.assign(new Error('This offer belongs to another ambulance'), { status: 403 });
  }
  if (assignment.assignment_status !== 'OFFERED') {
    throw Object.assign(new Error(`This offer is already ${assignment.assignment_status}`), { status: 409 });
  }
  if (new Date(assignment.offer_expiry_timestamp).getTime() < Date.now()) {
    await timeoutOffer(assignmentId);
    throw Object.assign(new Error('This offer has expired and moved to the next ambulance'), { status: 409 });
  }

  const booking = getBooking(assignment.booking_id);
  if (!booking || !['REQUESTED', 'MATCHING'].includes(booking.booking_status)) {
    throw Object.assign(new Error('This booking is no longer open'), { status: 409 });
  }

  clearTimeout(timers.get(assignmentId));
  timers.delete(assignmentId);

  const ts = nowIso();
  const tripId = nextId('trip');
  const responseSec = Math.max(
    0,
    Math.round((new Date(ts).getTime() - new Date(booking.booking_timestamp).getTime()) / 1000)
  );

  db.exec('BEGIN');
  try {
    // The status checks above are advisory: between reading the row and writing
    // it, a competing accept (or the expiry timer) may have moved it. Both
    // updates are therefore conditional on the state still being the one we
    // decided against, and we verify a row actually changed. This is what makes
    // "first accept wins" true rather than merely likely.
    const claimedOffer = db.prepare(
      `UPDATE assignments SET assignment_status = 'ACCEPTED', response_timestamp = ?
       WHERE assignment_id = ? AND assignment_status = 'OFFERED'`
    ).run(ts, assignmentId);

    if (claimedOffer.changes === 0) {
      throw Object.assign(new Error('This offer was just closed. It has moved to another ambulance.'), { status: 409 });
    }

    const claimedBooking = db.prepare(
      `UPDATE bookings SET booking_status = 'ASSIGNED', assigned_provider_id = ?, assigned_at = ?,
                           response_time_sec = ?, updated_at = ?
       WHERE booking_id = ? AND booking_status IN ('REQUESTED','MATCHING')`
    ).run(assignment.provider_id, ts, responseSec, ts, booking.booking_id);

    if (claimedBooking.changes === 0) {
      throw Object.assign(new Error('This booking was just taken or cancelled.'), { status: 409 });
    }

    db.prepare('UPDATE providers SET availability_status = ?, updated_at = ? WHERE provider_id = ?')
      .run('BUSY', ts, assignment.provider_id);

    db.prepare(
      `INSERT INTO trips (trip_id, booking_id, provider_id, trip_milestone, trip_start_time, updated_at)
       VALUES (?, ?, ?, 'ASSIGNED', ?, ?)`
    ).run(tripId, booking.booking_id, assignment.provider_id, ts, ts);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  audit('DISPATCH_ACCEPTED', {
    actorUserId: providerWithUser(assignment.provider_id)?.driver_user_id,
    actorRole: 'DRIVER',
    entityType: 'booking',
    entityId: booking.booking_id,
    details: { assignment_id: assignmentId, trip_id: tripId, response_time_sec: responseSec },
  });

  // Any other offers on this booking are void. On a broadcast there will be
  // several, and each of those drivers has a live countdown on screen, so they
  // are told rather than left watching an offer that has already gone.
  const losers = db.prepare(
    `SELECT assignment_id, provider_id FROM assignments
     WHERE booking_id = ? AND assignment_status = 'OFFERED' AND assignment_id <> ?`
  ).all(booking.booking_id, assignmentId);

  db.prepare(
    `UPDATE assignments SET assignment_status = 'TIMEOUT', response_timestamp = ?
     WHERE booking_id = ? AND assignment_status = 'OFFERED' AND assignment_id <> ?`
  ).run(ts, booking.booking_id, assignmentId);

  for (const l of losers) {
    clearTimeout(timers.get(l.assignment_id));
    timers.delete(l.assignment_id);
    sockets.toProvider(l.provider_id, 'offer:closed', {
      assignment_id: l.assignment_id,
      result: 'TAKEN',
    });
  }

  const provider = providerWithUser(assignment.provider_id);

  // Seed the ETA immediately so the user sees a number as soon as it is accepted.
  let etaMinutes = null;
  try {
    const r = await maps.route(
      { latitude: provider.latitude, longitude: provider.longitude },
      { latitude: booking.latitude, longitude: booking.longitude }
    );
    etaMinutes = r.eta_minutes;
    db.prepare(
      'UPDATE trips SET eta_minutes = ?, route_polyline = ?, route_distance_km = ?, updated_at = ? WHERE trip_id = ?'
    ).run(r.eta_minutes, r.route_polyline, r.route_distance_km, nowIso(), tripId);
  } catch (err) {
    console.error('[dispatch] initial ETA failed:', err.message);
  }

  notifications.notify(booking.user_id, {
    title: 'Ambulance assigned',
    body: `${provider.full_name} (${provider.vehicle_reg_no}) is on the way${etaMinutes ? `, ETA ${etaMinutes} min` : ''}.`,
    eventType: 'ASSIGNED',
    bookingId: booking.booking_id,
    // The person who called for this is not watching a screen, they are
    // watching the road.
    push: { priority: 'high', data: { type: 'ASSIGNED', booking_id: booking.booking_id } },
  });

  const patient = db.prepare('SELECT phone_no FROM users WHERE user_id = ?').get(booking.user_id);
  messaging
    .sendWhatsApp({
      phoneNo: patient.phone_no,
      bookingId: booking.booking_id,
      templateId: config.whatsapp.templates.status,
      ...messaging.templates.assignmentConfirmed({
        booking, provider, driverName: provider.full_name, etaMinutes,
      }),
    })
    .catch(() => {});

  sockets.toProvider(assignment.provider_id, 'offer:closed', { assignment_id: assignmentId, result: 'ACCEPTED' });
  sockets.toAdmins('admin:dispatch', {
    event: 'ACCEPTED',
    booking_id: booking.booking_id,
    assignment_id: assignmentId,
    provider_id: assignment.provider_id,
    response_time_sec: responseSec,
  });

  const finalBooking = broadcastBooking(getBooking(booking.booking_id));
  return { assignment_id: assignmentId, trip_id: tripId, booking: finalBooking };
}

async function rejectOffer(assignmentId, providerId, reason = 'Declined by driver') {
  const assignment = db.prepare('SELECT * FROM assignments WHERE assignment_id = ?').get(assignmentId);
  if (!assignment) throw Object.assign(new Error('Offer not found'), { status: 404 });
  if (assignment.provider_id !== providerId) {
    throw Object.assign(new Error('This offer belongs to another ambulance'), { status: 403 });
  }
  if (assignment.assignment_status !== 'OFFERED') {
    throw Object.assign(new Error(`This offer is already ${assignment.assignment_status}`), { status: 409 });
  }

  clearTimeout(timers.get(assignmentId));
  timers.delete(assignmentId);

  const ts = nowIso();
  // Conditional, so a decline arriving as the 45-second timer fires cannot
  // double-advance the booking - whichever lands first owns the transition.
  const claimed = db.prepare(
    `UPDATE assignments SET assignment_status = 'REJECTED', response_timestamp = ?
     WHERE assignment_id = ? AND assignment_status = 'OFFERED'`
  ).run(ts, assignmentId);

  if (claimed.changes === 0) {
    throw Object.assign(new Error('This offer has already closed'), { status: 409 });
  }

  audit('DISPATCH_REJECTED', {
    entityType: 'assignment',
    entityId: assignmentId,
    details: { booking_id: assignment.booking_id, provider_id: providerId, reason },
  });
  sockets.toAdmins('admin:dispatch', {
    event: 'REJECTED', booking_id: assignment.booking_id, assignment_id: assignmentId, provider_id: providerId,
  });

  // C.6: automatic reassignment to the next-best candidate - but only once
  // nobody else is still holding an offer on this booking. One driver
  // declining an emergency that went to six of them must not restart matching
  // under the other five, nor fail a request they can still accept.
  if (liveOffers(assignment.booking_id, assignmentId) === 0) {
    await offerNext(assignment.booking_id);
  }
  return { assignment_id: assignmentId, status: 'REJECTED' };
}

async function timeoutOffer(assignmentId) {
  const assignment = db.prepare('SELECT * FROM assignments WHERE assignment_id = ?').get(assignmentId);
  if (!assignment || assignment.assignment_status !== 'OFFERED') return null;

  const ts = nowIso();
  // If the driver accepted in the same instant the timer fired, the accept has
  // already moved the row and this expiry must do nothing at all.
  const claimed = db.prepare(
    `UPDATE assignments SET assignment_status = 'TIMEOUT', response_timestamp = ?
     WHERE assignment_id = ? AND assignment_status = 'OFFERED'`
  ).run(ts, assignmentId);

  if (claimed.changes === 0) return null;

  audit('DISPATCH_TIMEOUT', {
    entityType: 'assignment',
    entityId: assignmentId,
    details: { booking_id: assignment.booking_id, provider_id: assignment.provider_id },
  });

  sockets.toProvider(assignment.provider_id, 'offer:closed', { assignment_id: assignmentId, result: 'TIMEOUT' });
  sockets.toAdmins('admin:dispatch', {
    event: 'TIMEOUT', booking_id: assignment.booking_id, assignment_id: assignmentId, provider_id: assignment.provider_id,
  });

  // As with a decline: wait for the last live offer on this booking before
  // moving on, so a broadcast runs its full 45 seconds for everyone.
  if (liveOffers(assignment.booking_id, assignmentId) > 0) return null;
  return offerNext(assignment.booking_id);
}

function failBooking(bookingId, reason) {
  const ts = nowIso();
  db.prepare(
    "UPDATE bookings SET booking_status = 'FAILED', cancelled_reason = ?, updated_at = ? WHERE booking_id = ?"
  ).run(reason, ts, bookingId);

  const booking = getBooking(bookingId);
  audit('DISPATCH_FAILED', { entityType: 'booking', entityId: bookingId, details: { reason } });
  notifications.notify(booking.user_id, {
    title: 'No ambulance could be assigned',
    body: `${reason}. Please try again or call 108.`,
    eventType: 'FAILED',
    bookingId,
    // The worst thing this system can do is fail quietly (NF.1).
    push: { priority: 'high', data: { type: 'FAILED', booking_id: bookingId } },
  });

  // The patient is waiting on an ambulance that is not coming, and may well not
  // be watching the app. This is the one message they most need to receive.
  const patient = db.prepare('SELECT phone_no FROM users WHERE user_id = ?').get(booking.user_id);
  if (patient) {
    messaging
      .sendWhatsApp({
        phoneNo: patient.phone_no,
        bookingId,
        templateId: config.whatsapp.templates.status,
        ...messaging.templates.dispatchFailed({ booking, reason }),
      })
      .catch(() => {});
  }

  broadcastBooking(booking);
  return null;
}

/** Re-arms timers for offers that were outstanding when the server restarted. */
function resumePendingOffers() {
  const open = db.prepare("SELECT * FROM assignments WHERE assignment_status = 'OFFERED'").all();
  for (const a of open) {
    const remaining = new Date(a.offer_expiry_timestamp).getTime() - Date.now();
    if (remaining <= 0) {
      timeoutOffer(a.assignment_id).catch(() => {});
    } else {
      scheduleTimeout(a.assignment_id, remaining);
    }
  }
  if (open.length) console.log(`[dispatch] resumed ${open.length} outstanding offer(s)`);
}

module.exports = {
  isBroadcast,
  findCandidates,
  offerNext,
  acceptOffer,
  rejectOffer,
  timeoutOffer,
  failBooking,
  resumePendingOffers,
  publicBooking,
  publicBookings,
  broadcastBooking,
  providerWithUser,
  providerRating,
  getBooking,
  getProvider,
};
