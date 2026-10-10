'use strict';
require('./bootstrap');

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.RAZORPAY_KEY_SECRET = 'key_secret_for_tests';
process.env.RAZORPAY_WEBHOOK_SECRET = 'webhook_secret_for_tests';

// config caches process.env at require time, so it must be loaded after the
// values above are in place.
const payments = require('../../src/services/payments');

const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');

test('payment signatures (Razorpay checkout callback)', async (t) => {
  await t.test('accepts the digest Checkout produces', () => {
    const orderId = 'order_abc';
    const paymentId = 'pay_xyz';
    const signature = hmac('key_secret_for_tests', `${orderId}|${paymentId}`);
    assert.equal(payments.verifyPaymentSignature({ orderId, paymentId, signature }), true);
  });

  await t.test('rejects a digest over the wrong payload', () => {
    const signature = hmac('key_secret_for_tests', 'order_abc|pay_TAMPERED');
    assert.equal(
      payments.verifyPaymentSignature({ orderId: 'order_abc', paymentId: 'pay_xyz', signature }),
      false
    );
  });

  await t.test('rejects a digest made with the webhook secret', () => {
    // The two secrets are not interchangeable; confusing them was the original
    // defect, so it is pinned here.
    const signature = hmac('webhook_secret_for_tests', 'order_abc|pay_xyz');
    assert.equal(
      payments.verifyPaymentSignature({ orderId: 'order_abc', paymentId: 'pay_xyz', signature }),
      false
    );
  });

  await t.test('rejects rubbish without throwing', () => {
    for (const signature of [undefined, null, '', 'not-hex', 'abc']) {
      assert.equal(
        payments.verifyPaymentSignature({ orderId: 'o', paymentId: 'p', signature }),
        false
      );
    }
  });
});

test('webhook signatures (Razorpay webhook)', async (t) => {
  const rawBody = Buffer.from(JSON.stringify({
    event: 'payment.captured',
    payload: { payment: { entity: { id: 'pay_xyz', order_id: 'order_abc' } } },
  }));

  await t.test('accepts a digest over the exact bytes sent', () => {
    const signature = hmac('webhook_secret_for_tests', rawBody);
    assert.equal(payments.verifyWebhookSignature({ rawBody, signature }), true);
  });

  await t.test('rejects when the body is re-serialised', () => {
    // The whole reason server.js keeps req.rawBody: parsing and re-stringifying
    // changes the bytes, so the digest no longer matches.
    const signature = hmac('webhook_secret_for_tests', rawBody);
    const reserialised = Buffer.from(JSON.stringify(JSON.parse(rawBody.toString())) + ' ');
    assert.equal(payments.verifyWebhookSignature({ rawBody: reserialised, signature }), false);
  });

  await t.test('rejects a digest made with the API key secret', () => {
    const signature = hmac('key_secret_for_tests', rawBody);
    assert.equal(payments.verifyWebhookSignature({ rawBody, signature }), false);
  });

  await t.test('rejects a missing body or signature', () => {
    const signature = hmac('webhook_secret_for_tests', rawBody);
    assert.equal(payments.verifyWebhookSignature({ rawBody: null, signature }), false);
    assert.equal(payments.verifyWebhookSignature({ rawBody, signature: undefined }), false);
  });
});
