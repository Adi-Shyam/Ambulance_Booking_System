'use strict';
// F.10 - settlement. `mock` simulates a gateway (and always succeeds for CASH,
// which is settled with the driver); `razorpay` shows where a real gateway call
// and signature verification would go.
const crypto = require('node:crypto');
const config = require('../config');

function reference(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

/**
 * Charges an invoice.
 * @returns {{payment_status: string, transaction_ref: string|null, gateway: string}}
 */
async function charge({ invoice, paymentMode }) {
  if (paymentMode === 'CASH') {
    // Cash on completion: the money changes hands offline, we only record it.
    return { payment_status: 'SUCCESS', transaction_ref: reference('cash'), gateway: 'cash-on-completion' };
  }

  if (config.payment.provider === 'razorpay' && config.payment.razorpayKeyId) {
    try {
      const auth = Buffer.from(
        `${config.payment.razorpayKeyId}:${config.payment.razorpayKeySecret}`
      ).toString('base64');
      const res = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: Math.round(invoice.fare_amount * 100), // paise
          currency: 'INR',
          receipt: invoice.invoice_id,
          notes: { booking_id: invoice.booking_id },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.description || 'Gateway rejected the order');
      // A production flow would return this order to the client, collect the
      // payment there and confirm through a signed webhook.
      return { payment_status: 'PENDING', transaction_ref: json.id, gateway: 'razorpay', order: json };
    } catch (err) {
      console.error('[payments] razorpay failed:', err.message);
      return { payment_status: 'FAILED', transaction_ref: null, gateway: 'razorpay', error: err.message };
    }
  }

  return { payment_status: 'SUCCESS', transaction_ref: reference('mock'), gateway: 'mock' };
}

/**
 * Constant-time compare of two hex digests.
 *
 * A plain `===` leaks how much of the signature matched through how long the
 * comparison took, which is enough to forge one a byte at a time.
 */
function sameDigest(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false; // not valid hex
  }
}

/**
 * Verifies the signature Razorpay Checkout hands back to the *client* after a
 * payment: HMAC of "order_id|payment_id" keyed with the API key secret.
 *
 * This is not the webhook signature. The two look similar and are not
 * interchangeable - see verifyWebhookSignature.
 */
function verifyPaymentSignature({ orderId, paymentId, signature }) {
  if (!config.payment.razorpayKeySecret) return false;
  const expected = crypto
    .createHmac('sha256', config.payment.razorpayKeySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return sameDigest(expected, signature);
}

/**
 * Verifies a Razorpay *webhook*, which signs the raw request body with a
 * dedicated webhook secret and sends the digest in X-Razorpay-Signature.
 *
 * It must be the exact bytes Razorpay sent: re-serialising the parsed JSON
 * reorders keys and changes whitespace, and the digest no longer matches. That
 * is why server.js keeps the raw buffer on req.rawBody.
 */
function verifyWebhookSignature({ rawBody, signature }) {
  const secret = config.payment.razorpayWebhookSecret;
  if (!secret || !rawBody) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return sameDigest(expected, signature);
}

module.exports = { charge, verifyPaymentSignature, verifyWebhookSignature };
