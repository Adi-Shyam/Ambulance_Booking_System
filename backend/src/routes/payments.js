'use strict';
// F.10 - payment and billing. DFD process 0.5.2 Process Payment.
const express = require('express');
const { db, nowIso, audit } = require('../db');
const v = require('../utils/validate');
const { authenticate } = require('../middleware/auth');
const payments = require('../services/payments');
const fare = require('../services/fare');
const sockets = require('../realtime/socket');
const notifications = require('../services/notifications');
const messaging = require('../services/messaging');
const config = require('../config');

const router = express.Router();
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get('/fare-rules', (req, res) => {
  res.json({ fare_rules: fare.allRules(), tax_percent: require('../config').taxPercent });
});

/**
 * Gateway webhook - confirms a PENDING charge out of band. Unauthenticated by
 * design: the signature is the credential, not a session token.
 *
 * Razorpay signs the raw body with the webhook secret and sends the digest in
 * X-Razorpay-Signature, wrapping the payment in an event envelope. The older
 * flat shape is still accepted so the mock transport and the existing tests can
 * drive this route without a real gateway.
 */
router.post('/webhook', asyncRoute(async (req, res) => {
  const headerSignature = req.get('x-razorpay-signature');
  const body = req.body || {};

  let orderId;
  let paymentId;
  let verified = false;

  if (headerSignature) {
    // A genuine webhook: verify the bytes, then read the event envelope.
    verified = payments.verifyWebhookSignature({ rawBody: req.rawBody, signature: headerSignature });
    const entity = body?.payload?.payment?.entity || {};
    orderId = entity.order_id;
    paymentId = entity.id;
  } else {
    // Checkout-callback shape, relayed by a client that has just paid.
    orderId = body.order_id;
    paymentId = body.payment_id;
    verified = payments.verifyPaymentSignature({ orderId, paymentId, signature: body.signature });
  }

  if (!verified) return res.status(400).json({ error: 'Invalid signature' });
  if (!orderId || !paymentId) return res.status(400).json({ error: 'Missing order or payment reference' });

  const ts = nowIso();
  const result = db.prepare(
    `UPDATE invoices SET payment_status = 'SUCCESS', transaction_ref = ?, payment_timestamp = ?
     WHERE transaction_ref = ?`
  ).run(paymentId, ts, orderId);

  audit('PAYMENT_WEBHOOK', {
    entityType: 'invoice',
    entityId: orderId,
    details: { paymentId, matched: result.changes, source: headerSignature ? 'webhook' : 'callback' },
  });
  res.json({ received: true, matched: result.changes });
}));

router.use(authenticate);

router.get('/invoices', asyncRoute(async (req, res) => {
  const rows = db.prepare(
    `SELECT i.*, b.ambulance_type, b.address_text, b.booking_timestamp
     FROM invoices i JOIN bookings b ON b.booking_id = i.booking_id
     WHERE b.user_id = ? ORDER BY i.created_at DESC LIMIT 100`
  ).all(req.user.user_id);
  res.json({ invoices: rows });
}));

router.get('/invoices/:invoiceId', asyncRoute(async (req, res) => {
  const invoice = db.prepare(
    `SELECT i.*, b.user_id, b.ambulance_type, b.address_text, b.booking_timestamp, b.assigned_provider_id
     FROM invoices i JOIN bookings b ON b.booking_id = i.booking_id
     WHERE i.invoice_id = ?`
  ).get(req.params.invoiceId);

  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  const isOwner = invoice.user_id === req.user.user_id;
  const isProvider = req.provider && invoice.assigned_provider_id === req.provider.provider_id;
  if (!isOwner && !isProvider && req.user.role_code !== 'ADMIN') {
    return res.status(403).json({ error: 'You do not have access to this invoice' });
  }
  res.json({ invoice });
}));

router.post('/invoices/:invoiceId/pay', asyncRoute(async (req, res) => {
  const payment_mode = v.oneOf(req.body.payment_mode, v.PAYMENT_MODES, 'payment_mode');
  const invoice = db.prepare(
    `SELECT i.*, b.user_id, b.assigned_provider_id FROM invoices i
     JOIN bookings b ON b.booking_id = i.booking_id WHERE i.invoice_id = ?`
  ).get(req.params.invoiceId);

  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (invoice.user_id !== req.user.user_id) {
    return res.status(403).json({ error: 'You do not have access to this invoice' });
  }
  if (invoice.payment_status === 'SUCCESS') {
    return res.status(409).json({ error: 'This invoice is already paid' });
  }

  const result = await payments.charge({ invoice, paymentMode: payment_mode });
  const ts = nowIso();

  db.prepare(
    `UPDATE invoices SET payment_mode = ?, payment_status = ?, transaction_ref = ?, payment_timestamp = ?
     WHERE invoice_id = ?`
  ).run(payment_mode, result.payment_status, result.transaction_ref, ts, invoice.invoice_id);

  audit('PAYMENT_PROCESSED', {
    actorUserId: req.user.user_id, actorRole: 'USER',
    entityType: 'invoice', entityId: invoice.invoice_id,
    details: {
      payment_mode,
      payment_status: result.payment_status,
      gateway: result.gateway,
      fare_amount: invoice.fare_amount,
    },
  });

  const updated = db.prepare('SELECT * FROM invoices WHERE invoice_id = ?').get(invoice.invoice_id);

  if (invoice.assigned_provider_id) {
    sockets.toProvider(invoice.assigned_provider_id, 'payment:update', updated);
    const providerUser = db.prepare(
      `SELECT p.user_id, u.phone_no FROM providers p
       JOIN users u ON u.user_id = p.user_id WHERE p.provider_id = ?`
    ).get(invoice.assigned_provider_id);

    if (providerUser && result.payment_status === 'SUCCESS') {
      notifications.notify(providerUser.user_id, {
        title: 'Payment received',
        body: `Rs ${invoice.fare_amount.toFixed(2)} settled for booking ${invoice.booking_id} (${payment_mode}).`,
        eventType: 'PAYMENT',
        bookingId: invoice.booking_id,
      });

      messaging
        .sendWhatsApp({
          phoneNo: providerUser.phone_no,
          bookingId: invoice.booking_id,
          templateId: config.whatsapp.templates.status,
          ...messaging.templates.paymentReceived({
            booking: { booking_id: invoice.booking_id },
            invoice,
            paymentMode: payment_mode,
          }),
        })
        .catch(() => {});
    }
  }
  sockets.toAdmins('admin:payment', updated);

  res.json({
    message:
      result.payment_status === 'SUCCESS'
        ? 'Payment recorded'
        : result.payment_status === 'PENDING'
          ? 'Payment initiated'
          : 'Payment failed',
    invoice: updated,
    gateway: result.gateway,
    ...(result.order ? { order: result.order } : {}),
  });
}));

module.exports = router;
