'use strict';
// F.13 Administrative management + F.14 reporting.
// DFD process 0.6: 0.6.1 Verify & Manage Providers, 0.6.2 Monitor Bookings,
// 0.6.3 Reports & Analytics.
const express = require('express');
const bcrypt = require('bcryptjs');
const { db, nowIso, audit } = require('../db');
const { nextId } = require('../utils/ids');
const v = require('../utils/validate');
const { authenticate, requireRole } = require('../middleware/auth');
const dispatch = require('../services/dispatch');
const { staleCutoffIso, dispatchablePredicate } = require('../services/availability');
const { localDay, localHour, todayLocal, daysAgoLocal, offsetLabel } = require('../utils/localDate');
const notifications = require('../services/notifications');
const messaging = require('../services/messaging');
const config = require('../config');
const sockets = require('../realtime/socket');

const router = express.Router();
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.use(authenticate, requireRole('ADMIN'));

const ACTIVE_STATES = ['REQUESTED', 'MATCHING', 'ASSIGNED', 'ENROUTE', 'ARRIVED', 'ONBOARD'];

// -------------------------------------------------------- 0.6.2 overview
router.get('/overview', asyncRoute(async (req, res) => {
  const today = todayLocal();

  const counts = db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM bookings) AS total_bookings,
       (SELECT COUNT(*) FROM bookings WHERE ${localDay('booking_timestamp')} = ?) AS bookings_today,
       (SELECT COUNT(*) FROM bookings WHERE booking_status IN ('REQUESTED','MATCHING')) AS awaiting_match,
       (SELECT COUNT(*) FROM bookings WHERE booking_status IN ('ASSIGNED','ENROUTE','ARRIVED','ONBOARD')) AS in_progress,
       (SELECT COUNT(*) FROM bookings WHERE booking_status = 'COMPLETED') AS completed,
       (SELECT COUNT(*) FROM bookings WHERE booking_status = 'FAILED') AS failed,
       (SELECT COUNT(*) FROM bookings WHERE booking_status = 'CANCELLED') AS cancelled,
       (SELECT COUNT(*) FROM providers) AS providers_total,
       (SELECT COUNT(*) FROM providers WHERE verification_status = 'PENDING') AS providers_pending,
       -- Counted with the matcher's own predicate, so this figure is what the
       -- dispatcher would actually find, not a looser superset (C.6).
       (SELECT COUNT(*) FROM providers p WHERE ${dispatchablePredicate('p')}) AS providers_available,
       (SELECT COUNT(*) FROM providers
         WHERE availability_status = 'AVAILABLE' AND verification_status = 'VERIFIED'
           AND (last_seen_timestamp IS NULL OR last_seen_timestamp < ?)) AS providers_stale,
       (SELECT COUNT(*) FROM providers WHERE availability_status = 'BUSY') AS providers_busy,
       (SELECT COUNT(*) FROM users WHERE role_code = 'USER') AS patients,
       (SELECT COALESCE(SUM(fare_amount),0) FROM invoices WHERE payment_status = 'SUCCESS') AS revenue_settled,
       (SELECT COALESCE(SUM(fare_amount),0) FROM invoices WHERE payment_status = 'PENDING') AS revenue_pending`
  ).get(today, staleCutoffIso(), staleCutoffIso());

  const response = db.prepare(
    `SELECT COALESCE(AVG(response_time_sec),0) AS avg_response_sec,
            COALESCE(MIN(response_time_sec),0) AS min_response_sec,
            COALESCE(MAX(response_time_sec),0) AS max_response_sec,
            COUNT(response_time_sec) AS measured
     FROM bookings WHERE response_time_sec IS NOT NULL`
  ).get();

  const byType = db.prepare(
    `SELECT ambulance_type, COUNT(*) AS bookings FROM bookings GROUP BY ambulance_type`
  ).all();

  const recentRows = db.prepare(
    `SELECT * FROM bookings ORDER BY booking_timestamp DESC LIMIT 10`
  ).all();
  const recent = dispatch.publicBookings(recentRows);

  res.json({
    counts,
    response_time: {
      avg_response_sec: Math.round(response.avg_response_sec),
      min_response_sec: response.min_response_sec,
      max_response_sec: response.max_response_sec,
      measured: response.measured,
    },
    by_type: byType,
    recent_bookings: recent,
    generated_at: nowIso(),
  });
}));

// ------------------------------------------- 0.6.1 verify/manage providers
router.get('/providers', asyncRoute(async (req, res) => {
  const filters = [];
  const params = [];
  if (req.query.verification_status) {
    filters.push('p.verification_status = ?');
    params.push(v.oneOf(req.query.verification_status, v.VERIFICATION, 'verification_status'));
  }
  if (req.query.ambulance_type) {
    filters.push('p.ambulance_type = ?');
    params.push(v.oneOf(req.query.ambulance_type, v.REQUEST_TYPES, 'ambulance_type'));
  }
  if (req.query.availability_status) {
    filters.push('p.availability_status = ?');
    params.push(v.oneOf(req.query.availability_status, v.AVAILABILITY, 'availability_status'));
  }
  if (req.query.q) {
    filters.push('(u.full_name LIKE ? OR u.phone_no LIKE ? OR p.vehicle_reg_no LIKE ?)');
    const like = `%${String(req.query.q).trim()}%`;
    params.push(like, like, like);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const rows = db.prepare(
    `SELECT p.*, u.full_name, u.phone_no, u.email_id, u.role_code, o.org_name,
            (SELECT COUNT(*) FROM bookings b WHERE b.assigned_provider_id = p.provider_id) AS assigned_count
     FROM providers p
     JOIN users u ON u.user_id = p.user_id
     LEFT JOIN organisations o ON o.org_id = p.org_id
     ${where}
     ORDER BY CASE p.verification_status WHEN 'PENDING' THEN 0 ELSE 1 END, p.created_at DESC`
  ).all(...params);

  res.json({
    providers: rows.map((p) => ({ ...p, rating: Number(dispatch.providerRating(p).toFixed(2)) })),
  });
}));

router.get('/providers/:providerId', asyncRoute(async (req, res) => {
  const p = dispatch.providerWithUser(req.params.providerId);
  if (!p) return res.status(404).json({ error: 'Provider not found' });

  const trips = db.prepare(
    `SELECT b.booking_id, b.ambulance_type, b.booking_status, b.booking_timestamp, b.completed_at,
            b.response_time_sec, i.fare_amount, i.payment_status, r.rating_value, r.feedback_text
     FROM bookings b
     LEFT JOIN invoices i ON i.booking_id = b.booking_id
     LEFT JOIN ratings r ON r.booking_id = b.booking_id
     WHERE b.assigned_provider_id = ? ORDER BY b.booking_timestamp DESC LIMIT 50`
  ).all(req.params.providerId);

  const offers = db.prepare(
    `SELECT assignment_status, COUNT(*) AS n FROM assignments WHERE provider_id = ? GROUP BY assignment_status`
  ).all(req.params.providerId);

  res.json({
    provider: { ...p, rating: Number(dispatch.providerRating(p).toFixed(2)) },
    trips,
    offer_stats: offers,
  });
}));

/** F.13: verify, reject or suspend a driver / organisation account. */
router.post('/providers/:providerId/verification', asyncRoute(async (req, res) => {
  const verification_status = v.oneOf(req.body.verification_status, v.VERIFICATION, 'verification_status');
  const remarks = v.text(req.body.remarks, 200, 'remarks');

  const provider = dispatch.providerWithUser(req.params.providerId);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });

  const now = nowIso();
  db.prepare('UPDATE providers SET verification_status = ?, remarks = ?, updated_at = ? WHERE provider_id = ?')
    .run(verification_status, remarks, now, provider.provider_id);
  db.prepare('UPDATE users SET verification_status = ?, updated_at = ? WHERE user_id = ?')
    .run(verification_status, now, provider.driver_user_id);

  // A rejected or suspended provider must stop receiving dispatch offers at once.
  if (verification_status !== 'VERIFIED') {
    db.prepare("UPDATE providers SET availability_status = 'OFFLINE' WHERE provider_id = ?")
      .run(provider.provider_id);
  }

  audit('PROVIDER_VERIFICATION', {
    actorUserId: req.user.user_id, actorRole: 'ADMIN',
    entityType: 'provider', entityId: provider.provider_id,
    details: { verification_status, remarks },
  });

  const message = {
    VERIFIED: 'Your ambulance profile has been verified. You can go online and start receiving requests.',
    REJECTED: `Your ambulance profile was rejected.${remarks ? ` Reason: ${remarks}` : ''}`,
    SUSPENDED: `Your ambulance profile has been suspended.${remarks ? ` Reason: ${remarks}` : ''}`,
    PENDING: 'Your ambulance profile is back under review.',
  }[verification_status];

  notifications.notify(provider.driver_user_id, {
    title: `Profile ${verification_status.toLowerCase()}`,
    body: message,
    eventType: 'VERIFICATION',
  });
  messaging.sendWhatsApp({ phoneNo: provider.phone_no, body: message }).catch(() => {});
  sockets.toProvider(provider.provider_id, 'provider:verification', { verification_status, remarks });

  res.json({
    message: `Provider marked ${verification_status}`,
    provider: db.prepare('SELECT * FROM providers WHERE provider_id = ?').get(provider.provider_id),
  });
}));

// ------------------------------------------------- 0.6.2 monitor bookings
router.get('/bookings', asyncRoute(async (req, res) => {
  const filters = [];
  const params = [];

  if (req.query.booking_status) {
    filters.push('b.booking_status = ?');
    params.push(v.oneOf(req.query.booking_status, v.BOOKING_STATUS, 'booking_status'));
  }
  if (req.query.active === 'true') {
    filters.push(`b.booking_status IN (${ACTIVE_STATES.map(() => '?').join(',')})`);
    params.push(...ACTIVE_STATES);
  }
  if (req.query.ambulance_type) {
    filters.push('b.ambulance_type = ?');
    params.push(v.oneOf(req.query.ambulance_type, v.REQUEST_TYPES, 'ambulance_type'));
  }
  if (req.query.from_date) {
    filters.push(`${localDay('b.booking_timestamp')} >= ?`);
    params.push(String(req.query.from_date));
  }
  if (req.query.to_date) {
    filters.push(`${localDay('b.booking_timestamp')} <= ?`);
    params.push(String(req.query.to_date));
  }
  if (req.query.q) {
    filters.push('(b.booking_id LIKE ? OR b.address_text LIKE ? OR u.full_name LIKE ? OR u.phone_no LIKE ?)');
    const like = `%${String(req.query.q).trim()}%`;
    params.push(like, like, like, like);
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const limit = Math.min(Number(req.query.limit) || 100, 500);

  const rows = db.prepare(
    `SELECT b.*, u.full_name AS patient_full_name, u.phone_no AS patient_phone
     FROM bookings b JOIN users u ON u.user_id = b.user_id
     ${where}
     ORDER BY b.booking_timestamp DESC LIMIT ?`
  ).all(...params, limit);

  const enriched = dispatch.publicBookings(rows);
  res.json({
    bookings: enriched.map((b, i) => ({
      ...b,
      patient_full_name: rows[i].patient_full_name,
      patient_phone: rows[i].patient_phone,
    })),
  });
}));

router.get('/bookings/:bookingId', asyncRoute(async (req, res) => {
  const booking = dispatch.getBooking(req.params.bookingId);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });

  res.json({
    booking: dispatch.publicBooking(booking),
    patient: db.prepare('SELECT user_id, full_name, phone_no, email_id FROM users WHERE user_id = ?').get(booking.user_id),
    assignments: db.prepare(
      `SELECT a.*, u.full_name AS driver_name, p.vehicle_reg_no, p.ambulance_type
       FROM assignments a
       JOIN providers p ON p.provider_id = a.provider_id
       JOIN users u ON u.user_id = p.user_id
       WHERE a.booking_id = ? ORDER BY a.created_at`
    ).all(booking.booking_id),
    locations: db.prepare(
      `SELECT tl.* FROM trip_locations tl JOIN trips t ON t.trip_id = tl.trip_id
       WHERE t.booking_id = ? ORDER BY tl.id DESC LIMIT 200`
    ).all(booking.booking_id),
    invoice: db.prepare('SELECT * FROM invoices WHERE booking_id = ?').get(booking.booking_id) || null,
    rating: db.prepare('SELECT * FROM ratings WHERE booking_id = ?').get(booking.booking_id) || null,
    messages: db.prepare('SELECT * FROM messages WHERE booking_id = ? ORDER BY created_at').all(booking.booking_id),
  });
}));

/** Dispute resolution: an administrator can force-close a stuck booking. */
router.post('/bookings/:bookingId/cancel', asyncRoute(async (req, res) => {
  const booking = dispatch.getBooking(req.params.bookingId);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  if (!ACTIVE_STATES.includes(booking.booking_status)) {
    return res.status(409).json({ error: `A ${booking.booking_status.toLowerCase()} booking cannot be cancelled` });
  }

  const reason = v.text(req.body.reason, 200, 'reason') || 'Cancelled by administrator';
  const ts = nowIso();

  db.prepare("UPDATE bookings SET booking_status = 'CANCELLED', cancelled_reason = ?, updated_at = ? WHERE booking_id = ?")
    .run(reason, ts, booking.booking_id);
  db.prepare("UPDATE assignments SET assignment_status = 'TIMEOUT', response_timestamp = ? WHERE booking_id = ? AND assignment_status = 'OFFERED'")
    .run(ts, booking.booking_id);
  if (booking.assigned_provider_id) {
    db.prepare("UPDATE providers SET availability_status = 'AVAILABLE', updated_at = ? WHERE provider_id = ?")
      .run(ts, booking.assigned_provider_id);
    sockets.toProvider(booking.assigned_provider_id, 'booking:cancelled', { booking_id: booking.booking_id, reason });
  }

  audit('ADMIN_BOOKING_CANCELLED', {
    actorUserId: req.user.user_id, actorRole: 'ADMIN',
    entityType: 'booking', entityId: booking.booking_id, details: { reason },
  });
  notifications.notify(booking.user_id, {
    title: 'Booking cancelled by control room',
    body: reason,
    eventType: 'CANCELLED',
    bookingId: booking.booking_id,
  });

  // The patient did not do this, so they get no feedback from their own
  // actions - telling them out of band is the only way they find out.
  const patient = db.prepare('SELECT phone_no FROM users WHERE user_id = ?').get(booking.user_id);
  if (patient) {
    messaging
      .sendWhatsApp({
        phoneNo: patient.phone_no,
        bookingId: booking.booking_id,
        templateId: config.whatsapp.templates.status,
        ...messaging.templates.cancelledByControlRoom({ booking, reason }),
      })
      .catch(() => {});
  }

  const updated = dispatch.getBooking(booking.booking_id);
  dispatch.broadcastBooking(updated);
  res.json({ message: 'Booking cancelled', booking: dispatch.publicBooking(updated) });
}));

/** Re-runs matching for a booking that failed to find an ambulance. */
router.post('/bookings/:bookingId/redispatch', asyncRoute(async (req, res) => {
  const booking = dispatch.getBooking(req.params.bookingId);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  if (!['FAILED', 'REQUESTED', 'MATCHING'].includes(booking.booking_status)) {
    return res.status(409).json({ error: 'Only an unassigned booking can be re-dispatched' });
  }

  db.prepare("UPDATE bookings SET booking_status = 'REQUESTED', retry_count = 0, cancelled_reason = NULL, updated_at = ? WHERE booking_id = ?")
    .run(nowIso(), booking.booking_id);
  audit('ADMIN_REDISPATCH', {
    actorUserId: req.user.user_id, actorRole: 'ADMIN',
    entityType: 'booking', entityId: booking.booking_id,
  });

  const assignment = await dispatch.offerNext(booking.booking_id);
  res.json({
    message: assignment ? 'Booking offered to the next available ambulance' : 'Still no ambulance available',
    assignment,
    booking: dispatch.publicBooking(dispatch.getBooking(booking.booking_id)),
  });
}));

/** Live map feed: every ambulance with a known position. */
router.get('/fleet', asyncRoute(async (req, res) => {
  const rows = db.prepare(
    `SELECT p.provider_id, p.vehicle_reg_no, p.ambulance_type, p.availability_status,
            p.latitude, p.longitude, p.last_seen_timestamp, p.verification_status,
            u.full_name AS driver_name, u.phone_no,
            (SELECT b.booking_id FROM bookings b
             WHERE b.assigned_provider_id = p.provider_id
               AND b.booking_status IN ('ASSIGNED','ENROUTE','ARRIVED','ONBOARD') LIMIT 1) AS active_booking_id
     FROM providers p JOIN users u ON u.user_id = p.user_id
     WHERE p.latitude IS NOT NULL`
  ).all();
  res.json({ fleet: rows });
}));

// ------------------------------------------------ 0.6.3 reports/analytics
router.get('/users', asyncRoute(async (req, res) => {
  const filters = [];
  const params = [];
  if (req.query.role_code) {
    filters.push('u.role_code = ?');
    params.push(v.oneOf(req.query.role_code, v.ROLE_CODES, 'role_code'));
  }
  if (req.query.q) {
    filters.push('(u.full_name LIKE ? OR u.phone_no LIKE ? OR u.user_id LIKE ?)');
    const like = `%${String(req.query.q).trim()}%`;
    params.push(like, like, like);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const rows = db.prepare(
    `SELECT u.user_id, u.full_name, u.phone_no, u.email_id, u.role_code, u.verification_status,
            u.registration_date, u.org_id,
            (SELECT COUNT(*) FROM bookings b WHERE b.user_id = u.user_id) AS bookings
     FROM users u ${where} ORDER BY u.created_at DESC LIMIT 500`
  ).all(...params);
  res.json({ users: rows });
}));

router.post('/users/:userId/status', asyncRoute(async (req, res) => {
  const verification_status = v.oneOf(req.body.verification_status, v.VERIFICATION, 'verification_status');
  const target = db.prepare('SELECT * FROM users WHERE user_id = ?').get(req.params.userId);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.role_code === 'ADMIN') return res.status(403).json({ error: 'Administrator accounts cannot be changed here' });

  db.prepare('UPDATE users SET verification_status = ?, updated_at = ? WHERE user_id = ?')
    .run(verification_status, nowIso(), target.user_id);
  audit('ADMIN_USER_STATUS', {
    actorUserId: req.user.user_id, actorRole: 'ADMIN',
    entityType: 'user', entityId: target.user_id, details: { verification_status },
  });
  res.json({ message: `Account marked ${verification_status}` });
}));

router.post('/admins', asyncRoute(async (req, res) => {
  const full_name = v.name(req.body.full_name);
  const phone_no = v.phone(req.body.phone_no);
  // A control-room account is the most valuable one in the system, so it gets
  // the same check as everyone else rather than a laxer one for convenience.
  const password = v.newPassword(req.body.password, 'password', { full_name, phone_no, email_id });
  if (db.prepare('SELECT 1 FROM users WHERE phone_no = ?').get(phone_no)) {
    return res.status(409).json({ error: 'An account already exists for this mobile number' });
  }
  const now = nowIso();
  const user_id = nextId('user');
  db.prepare(
    `INSERT INTO users (user_id, full_name, phone_no, email_id, password_hash, role_code,
                        verification_status, registration_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'ADMIN', 'VERIFIED', ?, ?, ?)`
  ).run(user_id, full_name, phone_no, v.email(req.body.email_id), bcrypt.hashSync(password, 12), now.slice(0, 10), now, now);

  audit('ADMIN_CREATED', {
    actorUserId: req.user.user_id, actorRole: 'ADMIN', entityType: 'user', entityId: user_id,
  });
  res.status(201).json({ message: 'Administrator account created', user_id });
}));

/**
 * F.13 analytics. report_type is one of RESPONSE_TIME | DEMAND | REVENUE |
 * PROVIDER_PERF, bounded by a from_date / to_date window (Data Dictionary
 * composite group `date_range`).
 */
router.get('/reports/:reportType', asyncRoute(async (req, res) => {
  const report_type = v.oneOf(req.params.reportType, v.REPORT_TYPES, 'report_type');
  // Windows are civil dates in the control room's timezone, matching the
  // `date_range` group in the Data Dictionary.
  const to_date = String(req.query.to_date || todayLocal());
  const from_date = String(req.query.from_date || daysAgoLocal(29));
  if (from_date > to_date) {
    return res.status(400).json({ error: 'from_date must not be later than to_date' });
  }

  const report_id = nextId('report');
  let metrics;

  switch (report_type) {
    case 'RESPONSE_TIME':
      metrics = db.prepare(
        `SELECT ${localDay('booking_timestamp')} AS day,
                COUNT(*) AS bookings,
                COUNT(response_time_sec) AS matched,
                ROUND(COALESCE(AVG(response_time_sec),0), 1) AS avg_response_sec,
                COALESCE(MAX(response_time_sec),0) AS max_response_sec
         FROM bookings
         WHERE ${localDay('booking_timestamp')} BETWEEN ? AND ?
         GROUP BY day ORDER BY day`
      ).all(from_date, to_date);
      break;

    case 'DEMAND':
      metrics = {
        by_day: db.prepare(
          `SELECT ${localDay('booking_timestamp')} AS day, COUNT(*) AS bookings
           FROM bookings WHERE ${localDay('booking_timestamp')} BETWEEN ? AND ?
           GROUP BY day ORDER BY day`
        ).all(from_date, to_date),
        by_hour: db.prepare(
          `SELECT ${localHour('booking_timestamp')} AS hour, COUNT(*) AS bookings
           FROM bookings WHERE ${localDay('booking_timestamp')} BETWEEN ? AND ?
           GROUP BY hour ORDER BY hour`
        ).all(from_date, to_date),
        by_type: db.prepare(
          `SELECT ambulance_type, COUNT(*) AS bookings
           FROM bookings WHERE ${localDay('booking_timestamp')} BETWEEN ? AND ?
           GROUP BY ambulance_type ORDER BY bookings DESC`
        ).all(from_date, to_date),
        by_pincode: db.prepare(
          `SELECT COALESCE(pincode,'unknown') AS pincode, COUNT(*) AS bookings
           FROM bookings WHERE ${localDay('booking_timestamp')} BETWEEN ? AND ?
           GROUP BY pincode ORDER BY bookings DESC LIMIT 15`
        ).all(from_date, to_date),
      };
      break;

    case 'REVENUE':
      metrics = {
        by_day: db.prepare(
          `SELECT ${localDay('i.created_at')} AS day, COUNT(*) AS invoices,
                  ROUND(COALESCE(SUM(i.fare_amount),0),2) AS gross,
                  ROUND(COALESCE(SUM(CASE WHEN i.payment_status='SUCCESS' THEN i.fare_amount ELSE 0 END),0),2) AS settled
           FROM invoices i WHERE ${localDay('i.created_at')} BETWEEN ? AND ?
           GROUP BY day ORDER BY day`
        ).all(from_date, to_date),
        by_mode: db.prepare(
          `SELECT COALESCE(payment_mode,'UNPAID') AS payment_mode, COUNT(*) AS invoices,
                  ROUND(COALESCE(SUM(fare_amount),0),2) AS amount
           FROM invoices WHERE ${localDay('created_at')} BETWEEN ? AND ?
           GROUP BY payment_mode`
        ).all(from_date, to_date),
        by_type: db.prepare(
          `SELECT b.ambulance_type, COUNT(*) AS trips, ROUND(COALESCE(SUM(i.fare_amount),0),2) AS amount
           FROM invoices i JOIN bookings b ON b.booking_id = i.booking_id
           WHERE ${localDay('i.created_at')} BETWEEN ? AND ?
           GROUP BY b.ambulance_type`
        ).all(from_date, to_date),
      };
      break;

    case 'PROVIDER_PERF':
    default:
      metrics = db.prepare(
        `SELECT p.provider_id, u.full_name AS driver_name, p.vehicle_reg_no, p.ambulance_type,
                p.availability_status, p.verification_status,
                COUNT(DISTINCT b.booking_id) AS trips,
                ROUND(COALESCE(AVG(b.response_time_sec),0),1) AS avg_response_sec,
                ROUND(CASE WHEN p.rating_count > 0 THEN CAST(p.rating_sum AS REAL)/p.rating_count ELSE 0 END, 2) AS rating,
                p.rating_count,
                (SELECT COUNT(*) FROM assignments a WHERE a.provider_id = p.provider_id AND a.assignment_status='ACCEPTED') AS accepted,
                (SELECT COUNT(*) FROM assignments a WHERE a.provider_id = p.provider_id AND a.assignment_status='REJECTED') AS rejected,
                (SELECT COUNT(*) FROM assignments a WHERE a.provider_id = p.provider_id AND a.assignment_status='TIMEOUT') AS timed_out,
                ROUND(COALESCE(SUM(i.fare_amount),0),2) AS revenue
         FROM providers p
         JOIN users u ON u.user_id = p.user_id
         LEFT JOIN bookings b ON b.assigned_provider_id = p.provider_id
              AND ${localDay('b.booking_timestamp')} BETWEEN ? AND ?
         LEFT JOIN invoices i ON i.booking_id = b.booking_id
         GROUP BY p.provider_id
         ORDER BY trips DESC, rating DESC`
      ).all(from_date, to_date);
      break;
  }

  audit('REPORT_GENERATED', {
    actorUserId: req.user.user_id, actorRole: 'ADMIN',
    entityType: 'report', entityId: report_id, details: { report_type, from_date, to_date },
  });

  res.json({
    report_id,
    report_type,
    date_range: { from_date, to_date },
    timezone: offsetLabel(),
    metrics,
    generated_at: nowIso(),
  });
}));

/** F.6/F.14 delivery log - shows every WhatsApp/SMS alert and its receipt. */
router.get('/messages', asyncRoute(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.json({
    messages: db.prepare('SELECT * FROM messages ORDER BY created_at DESC LIMIT ?').all(limit),
    transport: messaging.usingCloudApi() ? 'whatsapp-cloud-api' : 'mock',
  });
}));

/** Constraint C.5 - the audit trail. */
router.get('/audit', asyncRoute(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 150, 1000);
  const action = req.query.action ? String(req.query.action) : null;
  const rows = action
    ? db.prepare('SELECT * FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT ?').all(action, limit)
    : db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit);
  res.json({
    audit: rows.map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null })),
    actions: db.prepare('SELECT DISTINCT action FROM audit_log ORDER BY action').all().map((r) => r.action),
  });
}));

// --------------------------------------------------- F.13 passenger reports
/**
 * What the crews have reported, newest first.
 *
 * Carries the subject's history alongside each report, because one complaint
 * is an incident and four are a pattern - and that difference is the whole
 * judgement being asked for here.
 */
router.get('/reports', asyncRoute(async (req, res) => {
  const where = [];
  const params = [];
  if (req.query.report_status) {
    where.push('r.report_status = ?');
    params.push(v.oneOf(req.query.report_status, ['OPEN', 'UPHELD', 'DISMISSED'], 'report_status'));
  }

  const rows = db.prepare(
    `SELECT r.*,
            b.address_text, b.ambulance_type, b.booking_timestamp, b.booking_status,
            subject.full_name  AS reported_name,
            subject.phone_no   AS reported_phone,
            subject.email_id   AS reported_email,
            subject.verification_status AS reported_status,
            crew.full_name     AS reporter_name,
            p.vehicle_reg_no
     FROM reports r
     JOIN bookings b    ON b.booking_id = r.booking_id
     JOIN users subject ON subject.user_id = r.reported_user_id
     JOIN users crew    ON crew.user_id = r.reporter_user_id
     LEFT JOIN providers p ON p.provider_id = r.provider_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY r.created_at DESC
     LIMIT 200`
  ).all(...params);

  const priors = db.prepare(
    `SELECT reported_user_id,
            COUNT(*) AS total,
            SUM(CASE WHEN report_status = 'UPHELD' THEN 1 ELSE 0 END) AS upheld
     FROM reports GROUP BY reported_user_id`
  ).all();
  const byUser = Object.fromEntries(priors.map((p) => [p.reported_user_id, p]));

  res.json({
    reports: rows.map((r) => ({
      ...r,
      reports_against_subject: byUser[r.reported_user_id]?.total || 1,
      upheld_against_subject: byUser[r.reported_user_id]?.upheld || 0,
    })),
    open: rows.filter((r) => r.report_status === 'OPEN').length,
  });
}));

/**
 * Rules on a report, and carries out whatever the ruling implies.
 *
 * The ruling and the sanction are one action because they are one decision,
 * and recording them apart invites a suspension nobody can trace back to a
 * reason (C.5).
 *
 * `action` is NONE, WARN, SUSPEND or DELETE. Dismissing allows only NONE: a
 * report found baseless must not cost the passenger anything.
 */
router.post('/reports/:reportId/review', asyncRoute(async (req, res) => {
  const report = db.prepare('SELECT * FROM reports WHERE report_id = ?').get(req.params.reportId);
  if (!report) return res.status(404).json({ error: 'Report not found' });
  if (report.report_status !== 'OPEN') {
    return res.status(409).json({ error: `This report was already ${report.report_status.toLowerCase()}` });
  }

  const report_status = v.oneOf(req.body.report_status, ['UPHELD', 'DISMISSED'], 'report_status');
  const action = v.oneOf(req.body.action || 'NONE', ['NONE', 'WARN', 'SUSPEND', 'DELETE'], 'action');
  const review_remarks = v.text(req.body.review_remarks, 500, 'review_remarks');

  if (report_status === 'DISMISSED' && action !== 'NONE') {
    return res.status(400).json({ error: 'A dismissed report cannot carry a penalty', field: 'action' });
  }

  const subject = db.prepare('SELECT * FROM users WHERE user_id = ?').get(report.reported_user_id);
  if (!subject) return res.status(404).json({ error: 'The reported account no longer exists' });
  if (subject.role_code === 'ADMIN') {
    return res.status(403).json({ error: 'Administrator accounts cannot be sanctioned here' });
  }

  const now = nowIso();

  if (action === 'SUSPEND' || action === 'DELETE') {
    db.prepare('UPDATE users SET verification_status = ?, updated_at = ? WHERE user_id = ?')
      .run('SUSPENDED', now, subject.user_id);

    // Every live session ends at once. A suspension that leaves somebody
    // signed in until their token expires is not a suspension.
    db.prepare('UPDATE sessions SET revoked = 1, revoked_at = ? WHERE user_id = ? AND revoked = 0')
      .run(now, subject.user_id);
  }

  if (action === 'DELETE') {
    // Erasure by anonymisation, not by DROP.
    //
    // The rows cannot go: bookings, invoices and the audit trail all point at
    // this account, and C.5 requires those to survive for dispute resolution -
    // including the dispute that led here. Removing the person while keeping
    // the record is what erasure means when records must be retained.
    //
    // The identifiers are replaced rather than blanked because both columns
    // are UNIQUE, and a blank would collide with the next deletion.
    db.prepare(
      `UPDATE users
       SET full_name = 'Deleted account', phone_no = ?, email_id = ?,
           password_hash = NULL, email_verified = 0, phone_verified = 0, updated_at = ?
       WHERE user_id = ?`
    ).run(`deleted-${subject.user_id}`, `deleted-${subject.user_id}@invalid`, now, subject.user_id);

    db.prepare('DELETE FROM push_tokens WHERE user_id = ?').run(subject.user_id);
  }

  db.prepare(
    `UPDATE reports
     SET report_status = ?, action_taken = ?, review_remarks = ?, reviewed_by = ?, reviewed_at = ?
     WHERE report_id = ?`
  ).run(report_status, action, review_remarks || null, req.user.user_id, now, report.report_id);

  audit('REPORT_REVIEWED', {
    actorUserId: req.user.user_id, actorRole: 'ADMIN',
    entityType: 'report', entityId: report.report_id,
    details: {
      report_status, action,
      reported_user_id: report.reported_user_id,
      booking_id: report.booking_id,
    },
  });

  // The crew who filed it hears the outcome. A report that disappears into a
  // control room is one nobody files twice.
  notifications.notify(report.reporter_user_id, {
    title: report_status === 'UPHELD' ? 'Your report was upheld' : 'Your report was reviewed',
    body: report_status === 'UPHELD'
      ? `The control room acted on your report of ${report.booking_id}.`
      : `The control room found no action was needed on ${report.booking_id}.`,
    eventType: 'REPORT_REVIEWED',
    bookingId: report.booking_id,
  });

  if (action === 'SUSPEND') {
    notifications.notify(subject.user_id, {
      title: 'Your account has been suspended',
      body: review_remarks || 'Contact the control room for details.',
      eventType: 'ACCOUNT_SUSPENDED',
    });
  }

  sockets.toAdmins('admin:report:update', { report_id: report.report_id, report_status, action });

  res.json({
    message: report_status === 'UPHELD'
      ? `Report upheld${action === 'NONE' ? '' : ` and the account was ${action.toLowerCase()}d`}`
      : 'Report dismissed',
    report_status,
    action,
  });
}));

module.exports = router;
