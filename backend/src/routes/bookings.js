'use strict';
// F.3 Place booking, F.4 Capture pickup location, F.8 Live tracking and ETA,
// F.11 Booking history, F.12 Rating and feedback.
// DFD processes 0.2.x (booking and location) and parts of 0.4 / 0.5.
const express = require('express');
const { db, nowIso, audit } = require('../db');
const { nextId } = require('../utils/ids');
const { haversineKm, decodePolyline } = require('../utils/geo');
const v = require('../utils/validate');
const { authenticate, requireRole } = require('../middleware/auth');
const dispatch = require('../services/dispatch');
const maps = require('../services/maps');
const fare = require('../services/fare');
const sockets = require('../realtime/socket');
const notifications = require('../services/notifications');
const messaging = require('../services/messaging');
const config = require('../config');

const router = express.Router();
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const OPEN_STATES = ['REQUESTED', 'MATCHING', 'ASSIGNED', 'ENROUTE', 'ARRIVED', 'ONBOARD'];

function ownedBooking(bookingId, req) {
  const booking = dispatch.getBooking(bookingId);
  if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });
  const isOwner = booking.user_id === req.user.user_id;
  const isAssignedProvider = req.provider && booking.assigned_provider_id === req.provider.provider_id;
  const isAdmin = req.user.role_code === 'ADMIN';
  if (!isOwner && !isAssignedProvider && !isAdmin) {
    throw Object.assign(new Error('You do not have access to this booking'), { status: 403 });
  }
  return booking;
}

// ------------------------------------------------------ F.3 + F.4 create
router.post('/', authenticate, requireRole('USER'), asyncRoute(async (req, res) => {
  const ambulance_type = v.oneOf(req.body.ambulance_type, v.REQUEST_TYPES, 'ambulance_type');

  // 0.2.2 Resolve & Validate Location: coordinates win; a typed address is
  // geocoded; if neither resolves the booking is rejected rather than dispatched
  // to an unknown point.
  let latitude = req.body.latitude !== undefined ? v.coordinate(req.body.latitude, 'lat', 'latitude') : null;
  let longitude = req.body.longitude !== undefined ? v.coordinate(req.body.longitude, 'lng', 'longitude') : null;
  let address_text = v.text(req.body.address_text, 200, 'address_text');
  let place_id = v.text(req.body.place_id, 100, 'place_id');
  const landmark = v.text(req.body.landmark, 100, 'landmark');
  const pincode = v.pincode(req.body.pincode);

  if (latitude === null || longitude === null) {
    if (!address_text) {
      return res.status(400).json({ error: 'Share your location or type a pickup address' });
    }
    const hits = await maps.geocode(address_text, pincode);
    if (hits.length === 0) {
      return res.status(422).json({ error: 'That pickup address could not be located. Drop a pin on the map instead.' });
    }
    ({ latitude, longitude, place_id } = hits[0]);
    address_text = hits[0].address_text;
  } else if (!address_text) {
    const rev = await maps.reverseGeocode(latitude, longitude);
    address_text = rev.address_text;
    place_id = place_id || rev.place_id;
  }

  const open = db.prepare(
    `SELECT booking_id FROM bookings
     WHERE user_id = ? AND booking_status IN (${OPEN_STATES.map(() => '?').join(',')})`
  ).get(req.user.user_id, ...OPEN_STATES);
  if (open) {
    return res.status(409).json({
      error: 'You already have an active booking',
      booking_id: open.booking_id,
    });
  }

  const booking_id = nextId('booking');
  const now = nowIso();

  db.prepare(
    `INSERT INTO bookings (booking_id, user_id, ambulance_type, latitude, longitude, address_text,
                           landmark, pincode, place_id, drop_latitude, drop_longitude, drop_address_text,
                           patient_name, contact_phone, notes, booking_status, booking_timestamp, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'REQUESTED', ?, ?)`
  ).run(
    booking_id, req.user.user_id, ambulance_type, latitude, longitude, address_text,
    landmark, pincode, place_id,
    req.body.drop_latitude !== undefined ? v.coordinate(req.body.drop_latitude, 'lat', 'drop_latitude') : null,
    req.body.drop_longitude !== undefined ? v.coordinate(req.body.drop_longitude, 'lng', 'drop_longitude') : null,
    v.text(req.body.drop_address_text, 200, 'drop_address_text'),
    v.text(req.body.patient_name, 60, 'patient_name'),
    req.body.contact_phone ? v.phone(req.body.contact_phone, 'contact_phone') : req.user.phone_no,
    v.text(req.body.notes, 250, 'notes'),
    now, now
  );

  audit('BOOKING_CREATED', {
    actorUserId: req.user.user_id, actorRole: 'USER', entityType: 'booking', entityId: booking_id,
    details: { ambulance_type, latitude, longitude, address_text },
  });

  const booking = dispatch.getBooking(booking_id);
  sockets.toAdmins('admin:booking:new', dispatch.publicBooking(booking));
  notifications.notify(req.user.user_id, {
    title: 'Request received',
    body: `We are locating the nearest ${ambulance_type} ambulance for you.`,
    eventType: 'REQUESTED',
    bookingId: booking_id,
  });

  // Respond first, then run matching, so the caller is never left waiting on a
  // third-party API during an emergency (NF.2).
  res.status(201).json({
    message: 'Booking placed. Locating the nearest ambulance.',
    booking: dispatch.publicBooking(booking),
  });

  dispatch.offerNext(booking_id).catch((err) => console.error('[bookings] dispatch failed:', err.message));
}));

// -------------------------------------------------------- F.11 history
router.get('/', authenticate, asyncRoute(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const rows = db.prepare(
    `SELECT * FROM bookings WHERE user_id = ? ORDER BY booking_timestamp DESC LIMIT ?`
  ).all(req.user.user_id, limit);
  res.json({ bookings: dispatch.publicBookings(rows) });
}));

router.get('/active', authenticate, asyncRoute(async (req, res) => {
  const row = db.prepare(
    `SELECT * FROM bookings
     WHERE user_id = ? AND booking_status IN (${OPEN_STATES.map(() => '?').join(',')})
     ORDER BY booking_timestamp DESC LIMIT 1`
  ).get(req.user.user_id, ...OPEN_STATES);
  res.json({ booking: row ? dispatch.publicBooking(row) : null });
}));

router.get('/:bookingId', authenticate, asyncRoute(async (req, res) => {
  const booking = ownedBooking(req.params.bookingId, req);
  const invoice = db.prepare('SELECT * FROM invoices WHERE booking_id = ?').get(booking.booking_id) || null;
  const rating = db.prepare('SELECT * FROM ratings WHERE booking_id = ?').get(booking.booking_id) || null;
  const assignments = db.prepare(
    `SELECT a.*, u.full_name AS driver_name, p.vehicle_reg_no
     FROM assignments a
     JOIN providers p ON p.provider_id = a.provider_id
     JOIN users u ON u.user_id = p.user_id
     WHERE a.booking_id = ? ORDER BY a.created_at`
  ).all(booking.booking_id);

  res.json({ booking: dispatch.publicBooking(booking), invoice, rating, assignments });
}));

// --------------------------------------------- in-app calling (F.6, C.5)
/**
 * Hands the caller the other party's number so the app can open the dialer,
 * and records that it happened.
 *
 * The call itself goes over the phone network rather than through the app on
 * purpose. A crew who cannot find a patient, or a patient watching an
 * ambulance drive past, need a call that works on a weak signal, with the app
 * in the background, and that does not depend on this server being reachable.
 * Carrying voice in-app would be a worse answer to the same problem.
 *
 * The number is only ever released between the two parties of a live booking,
 * and the release is audited (C.5), because a patient's number is exactly the
 * sort of thing that should not be quietly readable.
 */
router.post('/:bookingId/call', authenticate, asyncRoute(async (req, res) => {
  const booking = ownedBooking(req.params.bookingId, req);

  if (!booking.assigned_provider_id) {
    return res.status(409).json({ error: 'No ambulance is assigned to this booking yet' });
  }
  if (!OPEN_STATES.includes(booking.booking_status)) {
    return res.status(409).json({
      error: `This booking is ${booking.booking_status.toLowerCase()}, so there is nobody to call`,
    });
  }

  const provider = dispatch.providerWithUser(booking.assigned_provider_id);

  // The driver is given the patient; everyone else is given the driver. That
  // puts the control room through to the crew, which is almost always what it
  // wants, and means an administrator never pulls a patient's number out of
  // this route by accident.
  const callerIsDriver = Boolean(req.provider)
    && booking.assigned_provider_id === req.provider.provider_id;

  const counterparty = !callerIsDriver
    ? { to_role: 'DRIVER', name: provider.full_name, phone_no: provider.phone_no,
        vehicle_reg_no: provider.vehicle_reg_no }
    : { to_role: 'PATIENT',
        name: booking.patient_name
          || db.prepare('SELECT full_name FROM users WHERE user_id = ?').get(booking.user_id)?.full_name,
        phone_no: booking.contact_phone
          || db.prepare('SELECT phone_no FROM users WHERE user_id = ?').get(booking.user_id)?.phone_no };

  if (!counterparty.phone_no) {
    return res.status(422).json({ error: 'No contact number is on file for the other party' });
  }

  audit('CALL_PLACED', {
    actorUserId: req.user.user_id,
    actorRole: req.user.role_code,
    entityType: 'booking',
    entityId: booking.booking_id,
    details: { to_role: counterparty.to_role, booking_status: booking.booking_status },
  });

  res.json({ booking_id: booking.booking_id, ...counterparty });
}));

// ------------------------------------------------- F.8 live tracking + ETA
router.get('/:bookingId/track', authenticate, asyncRoute(async (req, res) => {
  const booking = ownedBooking(req.params.bookingId, req);
  const trip = db.prepare('SELECT * FROM trips WHERE booking_id = ?').get(booking.booking_id);

  if (!trip) {
    return res.json({
      booking_id: booking.booking_id,
      booking_status: booking.booking_status,
      trip: null,
      message: 'No ambulance assigned yet',
    });
  }

  const last = db.prepare(
    'SELECT * FROM trip_locations WHERE trip_id = ? ORDER BY id DESC LIMIT 1'
  ).get(trip.trip_id);
  const provider = dispatch.providerWithUser(trip.provider_id);

  const current = last
    ? { latitude: last.latitude, longitude: last.longitude, gps_timestamp: last.gps_timestamp }
    : provider.latitude
      ? { latitude: provider.latitude, longitude: provider.longitude, gps_timestamp: provider.last_seen_timestamp }
      : null;

  // Before pickup the ambulance is heading to the pickup point; after ONBOARD it
  // is heading to the drop point, so the ETA target changes with the milestone.
  const target =
    ['ONBOARD'].includes(trip.trip_milestone) && booking.drop_latitude
      ? { latitude: booking.drop_latitude, longitude: booking.drop_longitude }
      : { latitude: booking.latitude, longitude: booking.longitude };

  let eta = { eta_minutes: trip.eta_minutes, route_polyline: trip.route_polyline, route_distance_km: trip.route_distance_km };
  if (current && trip.trip_milestone !== 'COMPLETED') {
    const fresh = await maps.route(current, target);
    eta = fresh;
    db.prepare(
      'UPDATE trips SET eta_minutes = ?, route_polyline = ?, route_distance_km = ?, updated_at = ? WHERE trip_id = ?'
    ).run(fresh.eta_minutes, fresh.route_polyline, fresh.route_distance_km, nowIso(), trip.trip_id);
  }

  res.json({
    booking_id: booking.booking_id,
    booking_status: booking.booking_status,
    trip: { ...trip, ...eta },
    ambulance_location: current,
    straight_line_km: current
      ? Number(haversineKm(current.latitude, current.longitude, target.latitude, target.longitude).toFixed(2))
      : null,
    route_points: eta.route_polyline ? decodePolyline(eta.route_polyline) : [],
    provider: {
      provider_id: provider.provider_id,
      driver_name: provider.full_name,
      phone_no: provider.phone_no,
      vehicle_reg_no: provider.vehicle_reg_no,
      ambulance_type: provider.ambulance_type,
      rating: Number(dispatch.providerRating(provider).toFixed(2)),
    },
    pickup: { latitude: booking.latitude, longitude: booking.longitude, address_text: booking.address_text },
  });
}));

// --------------------------------------------------------------- cancel
router.post('/:bookingId/cancel', authenticate, asyncRoute(async (req, res) => {
  const booking = ownedBooking(req.params.bookingId, req);
  if (!OPEN_STATES.includes(booking.booking_status)) {
    return res.status(409).json({ error: `A ${booking.booking_status.toLowerCase()} booking cannot be cancelled` });
  }
  if (booking.booking_status === 'ONBOARD') {
    return res.status(409).json({ error: 'The patient is already on board; contact the driver instead' });
  }

  const reason = v.text(req.body.reason, 200, 'reason') || 'Cancelled by user';
  const ts = nowIso();

  db.prepare(
    "UPDATE bookings SET booking_status = 'CANCELLED', cancelled_reason = ?, updated_at = ? WHERE booking_id = ?"
  ).run(reason, ts, booking.booking_id);
  db.prepare(
    "UPDATE assignments SET assignment_status = 'TIMEOUT', response_timestamp = ? WHERE booking_id = ? AND assignment_status = 'OFFERED'"
  ).run(ts, booking.booking_id);

  if (booking.assigned_provider_id) {
    db.prepare("UPDATE providers SET availability_status = 'AVAILABLE', updated_at = ? WHERE provider_id = ?")
      .run(ts, booking.assigned_provider_id);
    const provider = dispatch.providerWithUser(booking.assigned_provider_id);
    sockets.toProvider(booking.assigned_provider_id, 'booking:cancelled', {
      booking_id: booking.booking_id, reason,
    });
    notifications.notify(provider.driver_user_id, {
      title: 'Booking cancelled',
      body: `${booking.booking_id} was cancelled: ${reason}`,
      eventType: 'CANCELLED',
      bookingId: booking.booking_id,
      // A driver already on the road needs to stop driving.
      push: { priority: 'high', data: { type: 'CANCELLED', booking_id: booking.booking_id } },
    });

    // A driver already on the way is the least likely person to be watching
    // the screen, and the most costly one to leave driving to a cancelled job.
    messaging
      .sendWhatsApp({
        phoneNo: provider.phone_no,
        bookingId: booking.booking_id,
        templateId: config.whatsapp.templates.status,
        ...messaging.templates.bookingCancelled({ booking, reason }),
      })
      .catch(() => {});
  }

  audit('BOOKING_CANCELLED', {
    actorUserId: req.user.user_id, actorRole: req.user.role_code,
    entityType: 'booking', entityId: booking.booking_id, details: { reason },
  });

  const updated = dispatch.getBooking(booking.booking_id);
  dispatch.broadcastBooking(updated);
  res.json({ message: 'Booking cancelled', booking: dispatch.publicBooking(updated) });
}));

// --------------------------------------------------- F.12 rating/feedback
router.post('/:bookingId/rating', authenticate, requireRole('USER'), asyncRoute(async (req, res) => {
  const booking = ownedBooking(req.params.bookingId, req);
  if (booking.booking_status !== 'COMPLETED') {
    return res.status(409).json({ error: 'You can rate a trip only after it is completed' });
  }
  if (db.prepare('SELECT 1 FROM ratings WHERE booking_id = ?').get(booking.booking_id)) {
    return res.status(409).json({ error: 'You have already rated this trip' });
  }

  const rating_value = v.rating(req.body.rating_value);
  const feedback_text = v.text(req.body.feedback_text, 500, 'feedback_text');

  db.prepare(
    `INSERT INTO ratings (booking_id, user_id, provider_id, rating_value, feedback_text, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(booking.booking_id, req.user.user_id, booking.assigned_provider_id, rating_value, feedback_text, nowIso());

  // Aggregated rating for the provider (F.12).
  db.prepare(
    'UPDATE providers SET rating_sum = rating_sum + ?, rating_count = rating_count + 1, updated_at = ? WHERE provider_id = ?'
  ).run(rating_value, nowIso(), booking.assigned_provider_id);

  audit('RATING_SUBMITTED', {
    actorUserId: req.user.user_id, actorRole: 'USER', entityType: 'booking', entityId: booking.booking_id,
    details: { rating_value, provider_id: booking.assigned_provider_id },
  });

  const provider = dispatch.getProvider(booking.assigned_provider_id);
  sockets.toProvider(provider.provider_id, 'rating:new', { booking_id: booking.booking_id, rating_value, feedback_text });

  res.status(201).json({
    message: 'Thank you for your feedback',
    provider_rating: Number(dispatch.providerRating(provider).toFixed(2)),
  });
}));

// ------------------------------------------------------- fare estimate
router.post('/estimate', authenticate, asyncRoute(async (req, res) => {
  const ambulance_type = v.oneOf(req.body.ambulance_type, v.REQUEST_TYPES, 'ambulance_type');
  const distance_km = Number(req.body.distance_km);
  if (!Number.isFinite(distance_km) || distance_km < 0) {
    return res.status(400).json({ error: 'distance_km must be a non-negative number' });
  }
  res.json({ estimate: fare.estimate(ambulance_type, distance_km) });
}));

module.exports = router;
