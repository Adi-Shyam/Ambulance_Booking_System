'use strict';
// Driver / ambulance-organisation side of the system.
// F.7 Accept or reject a request, F.9 Trip status updates, F.11 Records,
// plus the availability and location pings that feed store D2 and D4.
const express = require('express');
const { db, nowIso, audit } = require('../db');
const { nextId } = require('../utils/ids');
const { haversineKm, decodePolyline } = require('../utils/geo');
const v = require('../utils/validate');
const { authenticate, requireRole, requireProvider } = require('../middleware/auth');
const dispatch = require('../services/dispatch');
const maps = require('../services/maps');
const fare = require('../services/fare');
const messaging = require('../services/messaging');
const notifications = require('../services/notifications');
const sockets = require('../realtime/socket');
const config = require('../config');

const router = express.Router();
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Milestone order fixed by F.9; a driver may only move forward one step at a time.
const MILESTONE_ORDER = ['ASSIGNED', 'ENROUTE', 'ARRIVED', 'ONBOARD', 'COMPLETED'];

// Odometer sanity bounds, in kilometres, for one hop between GPS fixes.
const MIN_HOP_KM = 0.02;  // below this the vehicle is parked and the fix is drifting
const MAX_HOP_KM = 5;     // above this the signal was lost, not driven through
const MILESTONE_TO_BOOKING_STATUS = {
  ASSIGNED: 'ASSIGNED',
  ENROUTE: 'ENROUTE',
  ARRIVED: 'ARRIVED',
  ONBOARD: 'ONBOARD',
  COMPLETED: 'COMPLETED',
};

router.use(authenticate, requireRole('DRIVER', 'ORG'));

// ------------------------------------------------------- profile (D2)
router.post('/profile', asyncRoute(async (req, res) => {
  if (req.provider) return res.status(409).json({ error: 'An ambulance profile already exists for this account' });

  const vehicle_reg_no = v.vehicleRegNo(req.body.vehicle_reg_no);
  const ambulance_type = v.oneOf(req.body.ambulance_type, v.AMBULANCE_TYPES, 'ambulance_type');
  const licence_no = v.text(req.body.licence_no, 16, 'licence_no');
  const document_ref = v.text(req.body.document_ref, 200, 'document_ref');

  if (db.prepare('SELECT 1 FROM providers WHERE vehicle_reg_no = ?').get(vehicle_reg_no)) {
    return res.status(409).json({ error: 'This vehicle number is already registered' });
  }

  let org_id = req.user.org_id;
  if (!org_id && req.body.org_name) {
    org_id = nextId('org');
    db.prepare(
      `INSERT INTO organisations (org_id, org_name, contact_phone, contact_email, address_text, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      org_id, v.text(req.body.org_name, 100, 'org_name'), req.user.phone_no,
      req.user.email_id, v.text(req.body.org_address, 200, 'org_address'), nowIso()
    );
    db.prepare('UPDATE users SET org_id = ?, updated_at = ? WHERE user_id = ?')
      .run(org_id, nowIso(), req.user.user_id);
  }

  const provider_id = nextId('provider');
  const now = nowIso();
  db.prepare(
    `INSERT INTO providers (provider_id, user_id, org_id, vehicle_reg_no, ambulance_type,
                            availability_status, licence_no, document_ref, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'OFFLINE', ?, ?, ?, ?)`
  ).run(provider_id, req.user.user_id, org_id, vehicle_reg_no, ambulance_type, licence_no, document_ref, now, now);

  audit('PROVIDER_PROFILE_CREATED', {
    actorUserId: req.user.user_id, actorRole: req.user.role_code,
    entityType: 'provider', entityId: provider_id,
    details: { vehicle_reg_no, ambulance_type },
  });

  const provider = db.prepare('SELECT * FROM providers WHERE provider_id = ?').get(provider_id);
  sockets.toAdmins('admin:provider:new', provider);

  res.status(201).json({
    message: 'Ambulance profile submitted. An administrator will verify your documents before you can receive requests.',
    provider,
  });
}));

router.get('/me', asyncRoute(async (req, res) => {
  if (!req.provider) return res.json({ provider: null, requires_profile: true });
  const p = dispatch.providerWithUser(req.provider.provider_id);
  const stats = db.prepare(
    `SELECT COUNT(*) AS trips,
            COALESCE(SUM(CASE WHEN b.booking_status = 'COMPLETED' THEN 1 ELSE 0 END), 0) AS completed
     FROM bookings b WHERE b.assigned_provider_id = ?`
  ).get(req.provider.provider_id);
  const earnings = db.prepare(
    `SELECT COALESCE(SUM(i.fare_amount), 0) AS total
     FROM invoices i JOIN bookings b ON b.booking_id = i.booking_id
     WHERE b.assigned_provider_id = ? AND i.payment_status = 'SUCCESS'`
  ).get(req.provider.provider_id);

  res.json({
    provider: {
      ...req.provider,
      driver_name: p.full_name,
      rating: Number(dispatch.providerRating(req.provider).toFixed(2)),
    },
    organisation: req.provider.org_id
      ? db.prepare('SELECT * FROM organisations WHERE org_id = ?').get(req.provider.org_id)
      : null,
    stats: { ...stats, earnings_total: Number(earnings.total.toFixed(2)) },
  });
}));

router.patch('/profile', requireProvider, asyncRoute(async (req, res) => {
  const ambulance_type = req.body.ambulance_type
    ? v.oneOf(req.body.ambulance_type, v.AMBULANCE_TYPES, 'ambulance_type')
    : req.provider.ambulance_type;
  const licence_no = req.body.licence_no !== undefined
    ? v.text(req.body.licence_no, 16, 'licence_no')
    : req.provider.licence_no;

  db.prepare('UPDATE providers SET ambulance_type = ?, licence_no = ?, updated_at = ? WHERE provider_id = ?')
    .run(ambulance_type, licence_no, nowIso(), req.provider.provider_id);

  res.json({ provider: db.prepare('SELECT * FROM providers WHERE provider_id = ?').get(req.provider.provider_id) });
}));

// -------------------------------------------------- availability + GPS ping
router.post('/availability', requireProvider, asyncRoute(async (req, res) => {
  const availability_status = v.oneOf(req.body.availability_status, v.AVAILABILITY, 'availability_status');

  // A provider on an active trip cannot silently go offline (C.6).
  const active = db.prepare(
    `SELECT booking_id FROM bookings
     WHERE assigned_provider_id = ? AND booking_status IN ('ASSIGNED','ENROUTE','ARRIVED','ONBOARD')`
  ).get(req.provider.provider_id);
  if (active && availability_status !== 'BUSY') {
    return res.status(409).json({
      error: 'Finish or hand over your active trip before changing availability',
      booking_id: active.booking_id,
    });
  }

  const now = nowIso();
  db.prepare('UPDATE providers SET availability_status = ?, last_seen_timestamp = ?, updated_at = ? WHERE provider_id = ?')
    .run(availability_status, now, now, req.provider.provider_id);

  audit('AVAILABILITY_CHANGED', {
    actorUserId: req.user.user_id, actorRole: req.user.role_code,
    entityType: 'provider', entityId: req.provider.provider_id,
    details: { availability_status },
  });
  sockets.toAdmins('admin:provider:update', {
    provider_id: req.provider.provider_id, availability_status, last_seen_timestamp: now,
  });

  res.json({ message: `You are now ${availability_status.toLowerCase()}`, availability_status });
}));

/** Position ping. Writes D2 (last known location) and, on an active trip, D4. */
router.post('/location', requireProvider, asyncRoute(async (req, res) => {
  const latitude = v.coordinate(req.body.latitude, 'lat', 'latitude');
  const longitude = v.coordinate(req.body.longitude, 'lng', 'longitude');
  const speed_kmph = req.body.speed_kmph !== undefined ? Number(req.body.speed_kmph) : null;
  const gps_timestamp = req.body.gps_timestamp || nowIso();
  const now = nowIso();

  db.prepare('UPDATE providers SET latitude = ?, longitude = ?, last_seen_timestamp = ?, updated_at = ? WHERE provider_id = ?')
    .run(latitude, longitude, gps_timestamp, now, req.provider.provider_id);

  const trip = db.prepare(
    `SELECT t.* FROM trips t JOIN bookings b ON b.booking_id = t.booking_id
     WHERE t.provider_id = ? AND t.trip_milestone <> 'COMPLETED'
       AND b.booking_status IN ('ASSIGNED','ENROUTE','ARRIVED','ONBOARD')
     ORDER BY t.trip_start_time DESC LIMIT 1`
  ).get(req.provider.provider_id);

  let eta_minutes = null;
  if (trip) {
    // Odometer: add the hop from the previous fix before recording this one.
    // Two guards keep the total honest — a hop under MIN_HOP_KM is stationary
    // GPS jitter, and one over MAX_HOP_KM is a dropped signal reacquiring
    // rather than distance actually driven.
    const previous = db.prepare(
      'SELECT latitude, longitude FROM trip_locations WHERE trip_id = ? ORDER BY id DESC LIMIT 1'
    ).get(trip.trip_id);

    let hopKm = 0;
    if (previous) {
      const raw = haversineKm(previous.latitude, previous.longitude, latitude, longitude);
      if (raw >= MIN_HOP_KM && raw <= MAX_HOP_KM) hopKm = raw;
    }

    db.prepare(
      `INSERT INTO trip_locations (trip_id, provider_id, latitude, longitude, speed_kmph, trip_milestone, gps_timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(trip.trip_id, req.provider.provider_id, latitude, longitude, speed_kmph, trip.trip_milestone, gps_timestamp);

    if (hopKm > 0) {
      // Only the leg with the patient aboard is billable (F.10).
      const laden = trip.trip_milestone === 'ONBOARD' ? hopKm : 0;
      db.prepare(
        `UPDATE trips SET distance_travelled_km = ROUND(distance_travelled_km + ?, 3),
                          laden_distance_km = ROUND(laden_distance_km + ?, 3)
         WHERE trip_id = ?`
      ).run(hopKm, laden, trip.trip_id);
    }

    const booking = dispatch.getBooking(trip.booking_id);
    const target =
      trip.trip_milestone === 'ONBOARD' && booking.drop_latitude
        ? { latitude: booking.drop_latitude, longitude: booking.drop_longitude }
        : { latitude: booking.latitude, longitude: booking.longitude };

    const r = await maps.route({ latitude, longitude }, target);
    eta_minutes = r.eta_minutes;
    db.prepare(
      'UPDATE trips SET eta_minutes = ?, route_polyline = ?, route_distance_km = ?, updated_at = ? WHERE trip_id = ?'
    ).run(r.eta_minutes, r.route_polyline, r.route_distance_km, now, trip.trip_id);

    // F.8: push the new position and ETA straight to the patient.
    const payload = {
      booking_id: trip.booking_id,
      trip_id: trip.trip_id,
      latitude,
      longitude,
      speed_kmph,
      gps_timestamp,
      trip_milestone: trip.trip_milestone,
      eta_minutes: r.eta_minutes,
      route_distance_km: r.route_distance_km,
      route_polyline: r.route_polyline,
      // Decoded once here rather than in each client. Both ends draw the same
      // line, and an encoded polyline is only useful to something that knows
      // how to unpack it.
      route_points: r.route_polyline ? decodePolyline(r.route_polyline) : [],
    };
    sockets.toUser(booking.user_id, 'trip:location', payload);
    sockets.toBooking(trip.booking_id, 'trip:location', payload);
    // Back to the crew that sent it, so their own marker and ETA move on
    // their map too. They are driving the ambulance the patient is watching;
    // there is no reason only one of them should see it move.
    sockets.toProvider(req.provider.provider_id, 'trip:location', payload);
    sockets.toAdmins('admin:trip:location', { ...payload, provider_id: req.provider.provider_id });
  }

  res.json({ message: 'Location updated', eta_minutes });
}));

// ------------------------------------------------------ F.7 offers inbox
router.get('/offers', requireProvider, asyncRoute(async (req, res) => {
  const rows = db.prepare(
    `SELECT a.*, b.ambulance_type, b.latitude, b.longitude, b.address_text, b.landmark,
            b.notes, b.patient_name, b.booking_timestamp, b.booking_status
     FROM assignments a
     JOIN bookings b ON b.booking_id = a.booking_id
     WHERE a.provider_id = ? AND a.assignment_status = 'OFFERED'
       AND a.offer_expiry_timestamp > ?
     ORDER BY a.created_at DESC`
  ).all(req.provider.provider_id, nowIso());

  res.json({
    offers: rows.map((r) => ({
      ...r,
      expires_in_seconds: Math.max(
        0,
        Math.round((new Date(r.offer_expiry_timestamp).getTime() - Date.now()) / 1000)
      ),
      // The socket payload says this too. A console that reloaded, or came
      // back from the background, reads the list instead - and still has to
      // be able to say "first to accept" rather than implying the job is
      // already theirs.
      broadcast: dispatch.isBroadcast(r),
    })),
  });
}));

router.post('/offers/:assignmentId/accept', requireProvider, asyncRoute(async (req, res) => {
  const result = await dispatch.acceptOffer(req.params.assignmentId, req.provider.provider_id);
  res.json({ message: 'Request accepted. Navigate to the pickup point.', ...result });
}));

router.post('/offers/:assignmentId/reject', requireProvider, asyncRoute(async (req, res) => {
  const reason = v.text(req.body.reason, 200, 'reason') || 'Declined by driver';
  const result = await dispatch.rejectOffer(req.params.assignmentId, req.provider.provider_id, reason);
  res.json({ message: 'Request declined and passed to the next ambulance.', ...result });
}));

// -------------------------------------------------- F.9 trip status updates
router.get('/trips/active', requireProvider, asyncRoute(async (req, res) => {
  const trip = db.prepare(
    `SELECT t.*, b.* FROM trips t JOIN bookings b ON b.booking_id = t.booking_id
     WHERE t.provider_id = ? AND b.booking_status IN ('ASSIGNED','ENROUTE','ARRIVED','ONBOARD')
     ORDER BY t.trip_start_time DESC LIMIT 1`
  ).get(req.provider.provider_id);

  if (!trip) return res.json({ trip: null });

  const patient = db.prepare('SELECT full_name, phone_no FROM users WHERE user_id = ?').get(trip.user_id);

  // The same picture the patient gets, from the other end. A crew navigating
  // to a pickup needs to see the road they are being sent down and where they
  // are on it, not a single marker on an empty map - and the data is already
  // here, encoded, because the patient's tracking view needed it.
  const route_points = trip.route_polyline ? decodePolyline(trip.route_polyline) : [];
  const here = db.prepare(
    'SELECT latitude, longitude, last_seen_timestamp FROM providers WHERE provider_id = ?'
  ).get(req.provider.provider_id);

  res.json({
    trip: {
      ...trip,
      patient: { full_name: trip.patient_name || patient.full_name, phone_no: trip.contact_phone || patient.phone_no },
      next_milestone: MILESTONE_ORDER[MILESTONE_ORDER.indexOf(trip.trip_milestone) + 1] || null,
      route_points,
      ambulance_location: here?.latitude != null
        ? { latitude: here.latitude, longitude: here.longitude, as_of: here.last_seen_timestamp }
        : null,
    },
  });
}));

router.post('/trips/:tripId/status', requireProvider, asyncRoute(async (req, res) => {
  const trip_milestone = v.oneOf(req.body.trip_milestone, v.TRIP_MILESTONES, 'trip_milestone');
  const trip = db.prepare('SELECT * FROM trips WHERE trip_id = ?').get(req.params.tripId);

  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  if (trip.provider_id !== req.provider.provider_id) {
    return res.status(403).json({ error: 'This trip belongs to another ambulance' });
  }

  const from = MILESTONE_ORDER.indexOf(trip.trip_milestone);
  const to = MILESTONE_ORDER.indexOf(trip_milestone);
  if (to !== from + 1) {
    return res.status(409).json({
      error: `Cannot move from ${trip.trip_milestone} to ${trip_milestone}`,
      expected: MILESTONE_ORDER[from + 1] || null,
    });
  }

  const now = nowIso();
  const booking = dispatch.getBooking(trip.booking_id);
  const isCompletion = trip_milestone === 'COMPLETED';

  db.prepare(
    `UPDATE trips SET trip_milestone = ?, trip_end_time = COALESCE(?, trip_end_time), updated_at = ?
     WHERE trip_id = ?`
  ).run(trip_milestone, isCompletion ? now : null, now, trip.trip_id);

  db.prepare('UPDATE bookings SET booking_status = ?, completed_at = COALESCE(?, completed_at), updated_at = ? WHERE booking_id = ?')
    .run(MILESTONE_TO_BOOKING_STATUS[trip_milestone], isCompletion ? now : null, now, trip.booking_id);

  audit('TRIP_STATUS_UPDATED', {
    actorUserId: req.user.user_id, actorRole: req.user.role_code,
    entityType: 'trip', entityId: trip.trip_id,
    details: { booking_id: trip.booking_id, from: trip.trip_milestone, to: trip_milestone },
  });

  let invoice = null;
  if (isCompletion) {
    // F.10: billed on the distance actually driven with the patient aboard,
    // measured server-side from the GPS trace. The figure is deliberately NOT
    // taken from the request body - the device being billed must not be the
    // one that decides the amount.
    //
    // `route_distance_km` is unusable here: it holds the *remaining* distance
    // to the target at the last ping, which is near zero on arrival.
    const odometer = db.prepare(
      'SELECT distance_travelled_km, laden_distance_km FROM trips WHERE trip_id = ?'
    ).get(trip.trip_id);

    // Prefer the laden leg. If the driver stepped through the milestones with
    // no positions recorded in between, fall back to the whole-trip odometer so
    // a genuine trip is not billed at zero distance.
    const travelled = odometer.laden_distance_km > 0
      ? odometer.laden_distance_km
      : odometer.distance_travelled_km;

    const breakdown = fare.calculate(booking.ambulance_type, travelled);
    const invoice_id = nextId('invoice');

    db.prepare(
      `INSERT INTO invoices (invoice_id, booking_id, trip_id, base_fare, distance_charge, type_surcharge,
                             tax_amount, fare_amount, distance_km, payment_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`
    ).run(
      invoice_id, trip.booking_id, trip.trip_id, breakdown.base_fare, breakdown.distance_charge,
      breakdown.type_surcharge, breakdown.tax_amount, breakdown.fare_amount, breakdown.distance_km, now
    );

    db.prepare(
      `UPDATE providers SET availability_status = 'AVAILABLE', trips_completed = trips_completed + 1, updated_at = ?
       WHERE provider_id = ?`
    ).run(now, req.provider.provider_id);

    invoice = db.prepare('SELECT * FROM invoices WHERE invoice_id = ?').get(invoice_id);
    audit('INVOICE_RAISED', {
      entityType: 'invoice', entityId: invoice_id,
      details: { booking_id: trip.booking_id, fare_amount: breakdown.fare_amount },
    });
    sockets.toUser(booking.user_id, 'invoice:ready', invoice);
  }

  // F.9 / F.14: reflect the change to the user in real time and over WhatsApp.
  const updatedBooking = dispatch.getBooking(trip.booking_id);
  const statusPayload = {
    booking_id: trip.booking_id,
    trip_id: trip.trip_id,
    trip_milestone,
    booking_status: updatedBooking.booking_status,
    updated_at: now,
    eta_minutes: trip.eta_minutes,
  };
  sockets.toUser(booking.user_id, 'trip:status', statusPayload);
  sockets.toBooking(trip.booking_id, 'trip:status', statusPayload);
  sockets.toAdmins('admin:trip:status', { ...statusPayload, provider_id: req.provider.provider_id });
  dispatch.broadcastBooking(updatedBooking);

  const milestoneTitles = {
    ENROUTE: 'Ambulance on the way',
    ARRIVED: 'Ambulance has arrived',
    ONBOARD: 'Patient on board',
    COMPLETED: 'Trip completed',
  };
  notifications.notify(booking.user_id, {
    title: milestoneTitles[trip_milestone] || `Trip ${trip_milestone}`,
    body: messaging.templates.statusUpdate({ booking, milestone: trip_milestone, etaMinutes: trip.eta_minutes }).body,
    eventType: trip_milestone,
    bookingId: trip.booking_id,
    // ARRIVED is the one the patient has to act on - the ambulance is outside
    // and nobody is looking at the app.
    push: trip_milestone === 'ARRIVED'
      ? { priority: 'high', data: { type: 'ARRIVED', booking_id: trip.booking_id } }
      : null,
  });

  const patient = db.prepare('SELECT phone_no FROM users WHERE user_id = ?').get(booking.user_id);
  messaging
    .sendWhatsApp({
      phoneNo: patient.phone_no,
      bookingId: trip.booking_id,
      templateId: config.whatsapp.templates.status,
      ...messaging.templates.statusUpdate({ booking, milestone: trip_milestone, etaMinutes: trip.eta_minutes }),
    })
    .catch(() => {});

  res.json({ message: `Status updated to ${trip_milestone}`, trip_milestone, invoice });
}));

// ------------------------------------------------------------ F.11 records
router.get('/trips', requireProvider, asyncRoute(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const rows = db.prepare(
    `SELECT b.*, t.trip_id, t.trip_milestone, t.trip_start_time, t.trip_end_time, t.route_distance_km,
            i.invoice_id, i.fare_amount, i.payment_status, r.rating_value, r.feedback_text
     FROM bookings b
     LEFT JOIN trips t ON t.booking_id = b.booking_id
     LEFT JOIN invoices i ON i.booking_id = b.booking_id
     LEFT JOIN ratings r ON r.booking_id = b.booking_id
     WHERE b.assigned_provider_id = ?
     ORDER BY b.booking_timestamp DESC LIMIT ?`
  ).all(req.provider.provider_id, limit);
  res.json({ trips: rows });
}));

router.get('/earnings', requireProvider, asyncRoute(async (req, res) => {
  const summary = db.prepare(
    `SELECT COUNT(i.invoice_id) AS invoices,
            COALESCE(SUM(i.fare_amount), 0) AS gross,
            COALESCE(SUM(CASE WHEN i.payment_status = 'SUCCESS' THEN i.fare_amount ELSE 0 END), 0) AS settled,
            COALESCE(SUM(CASE WHEN i.payment_status = 'PENDING' THEN i.fare_amount ELSE 0 END), 0) AS pending
     FROM invoices i JOIN bookings b ON b.booking_id = i.booking_id
     WHERE b.assigned_provider_id = ?`
  ).get(req.provider.provider_id);

  const daily = db.prepare(
    `SELECT substr(b.completed_at, 1, 10) AS day, COUNT(*) AS trips,
            COALESCE(SUM(i.fare_amount), 0) AS amount
     FROM bookings b JOIN invoices i ON i.booking_id = b.booking_id
     WHERE b.assigned_provider_id = ? AND b.completed_at IS NOT NULL
     GROUP BY day ORDER BY day DESC LIMIT 14`
  ).all(req.provider.provider_id);

  res.json({ summary, daily });
}));

module.exports = router;
