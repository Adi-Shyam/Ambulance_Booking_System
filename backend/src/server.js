'use strict';
// Ambulance Booking System - application server.
// SRS 3.2.4: REST over HTTPS with JSON payloads, JWT auth, and a persistent
// Socket.IO channel for tracking and status changes.
const http = require('node:http');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const config = require('./config');
const { migrate, db, DB_FILE } = require('./db');
const sockets = require('./realtime/socket');
const dispatch = require('./services/dispatch');
const watchdog = require('./services/watchdog');
const maps = require('./services/maps');
const messaging = require('./services/messaging');
const { ValidationError } = require('./utils/validate');

migrate();

/**
 * Seeds an empty database on boot.
 *
 * A hosted container on a free plan has no persistent disk: the filesystem is
 * rebuilt on every deploy and every wake from idle, which takes the database
 * with it. Without this the service would come back up with no fare rules, no
 * demo accounts and no administrator, and nobody could sign in to find out why.
 *
 * It is guarded on the table being empty, so it can never overwrite real data -
 * on a disk that does persist, this runs once and never again.
 */
function seedIfEmpty() {
  if (config.env === 'test') return;                 // the harness seeds itself
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return;

  console.log('[db] empty database - seeding reference data and demo accounts');
  require('./db/seed').seed();
}
seedIfEmpty();

const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(','), credentials: true }));
// The raw bytes are kept alongside the parsed body because a gateway webhook
// signs what it actually sent. Re-serialising the parsed JSON reorders keys and
// normalises whitespace, so the digest would never match.
app.use(express.json({
  limit: '1mb',
  verify: (req, res, buf) => { req.rawBody = buf; },
}));
app.use(express.urlencoded({ extended: true }));
if (config.env !== 'test') app.use(morgan('dev'));

app.get('/health', (req, res) => {
  const counts = db.prepare(
    `SELECT (SELECT COUNT(*) FROM users) AS users,
            (SELECT COUNT(*) FROM providers) AS providers,
            (SELECT COUNT(*) FROM bookings) AS bookings`
  ).get();
  res.json({
    status: 'ok',
    service: 'ambulance-booking-system',
    version: '1.0.0',
    env: config.env,
    database: DB_FILE,
    maps_provider: maps.provider(),
    whatsapp_transport: messaging.usingCloudApi() ? 'cloud-api' : 'mock',
    payment_provider: config.payment.provider,
    counts,
    time: new Date().toISOString(),
  });
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/provider', require('./routes/provider'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/geo', require('./routes/geo'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/admin', require('./routes/admin'));

app.use((req, res) => res.status(404).json({ error: `No route for ${req.method} ${req.originalUrl}` }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof ValidationError) {
    return res.status(400).json({ error: err.message, field: err.field });
  }
  const status = err.status || 500;
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({ error: status >= 500 ? 'Something went wrong on our side' : err.message });
});

const server = http.createServer(app);
sockets.init(server);

server.listen(config.port, () => {
  console.log('\n  Ambulance Booking System - backend');
  console.log(`  REST + WebSocket  http://localhost:${config.port}`);
  console.log(`  Database          ${DB_FILE}`);
  console.log(`  Maps provider     ${maps.provider()}`);
  console.log(`  WhatsApp          ${messaging.usingCloudApi() ? 'Cloud API' : 'mock transport (messages printed + stored)'}`);
  const mail = messaging.emailTransport();
  console.log(`  Email             ${
    mail === 'brevo' ? 'Brevo HTTP API'
    : mail === 'smtp' ? `SMTP ${config.email.host}:${config.email.port}`
    : 'mock transport (codes printed + stored)'}`);
  console.log(`  Push              ${config.push.accessToken ? 'Expo (authenticated)' : 'Expo'}`);
  console.log(`  Offer timeout     ${config.dispatch.offerTimeoutSeconds}s, up to ${config.dispatch.maxRetries} candidates\n`);
  dispatch.resumePendingOffers();
  watchdog.start();
});

const shutdown = (signal) => {
  console.log(`\n[${signal}] shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = { app, server };
