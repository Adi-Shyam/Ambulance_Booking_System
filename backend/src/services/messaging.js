'use strict';
// F.6 / F.14 - outbound alerts.
//
// Transport is pluggable. With WHATSAPP_TOKEN set the service calls the Meta
// WhatsApp Business Cloud API; with the variable empty it falls back to a mock
// transport that persists the message and prints it, so the whole dispatch flow
// is demonstrable without a Meta business account. Either way the message row in
// `messages` is identical, which is what the admin dashboard reads.
const config = require('../config');
const { db, nowIso } = require('../db');
const { messageId } = require('../utils/ids');

const usingCloudApi = () => Boolean(config.whatsapp.token && config.whatsapp.phoneNumberId);

function toE164(phoneNo) {
  const digits = String(phoneNo).replace(/[^0-9]/g, '');
  return digits.length > 10 ? digits : config.whatsapp.countryCode + digits;
}

function record({ recipientPhone, channel, templateId, body, bookingId, deliveryState, providerResponse }) {
  const id = messageId();
  db.prepare(
    `INSERT INTO messages (message_id, booking_id, recipient_phone, message_channel,
                           message_template_id, body, delivery_state, delivery_timestamp,
                           provider_response, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    bookingId || null,
    recipientPhone,
    channel,
    templateId || null,
    body || null,
    deliveryState,
    nowIso(),
    providerResponse ? JSON.stringify(providerResponse).slice(0, 2000) : null,
    nowIso()
  );
  return id;
}

async function sendViaCloudApi(phoneNo, body) {
  const url = `https://graph.facebook.com/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.whatsapp.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: toE164(phoneNo),
      type: 'text',
      text: { preview_url: false, body },
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json?.error?.message || 'WhatsApp send failed'), { detail: json });
  return json;
}

/**
 * Sends a WhatsApp alert. Resolves to the stored message row id; never rejects,
 * because a messaging outage must not block a dispatch (NF.1).
 */
async function sendWhatsApp({ phoneNo, body, templateId, bookingId }) {
  const template = templateId || config.whatsapp.templates.dispatch;
  if (!usingCloudApi()) {
    console.log(`\n[whatsapp:mock -> +${toE164(phoneNo)}] template=${template}\n${body}\n`);
    return record({
      recipientPhone: phoneNo, channel: 'WHATSAPP', templateId: template,
      body, bookingId, deliveryState: 'SENT',
      providerResponse: { transport: 'mock' },
    });
  }
  try {
    const response = await sendViaCloudApi(phoneNo, body);
    return record({
      recipientPhone: phoneNo, channel: 'WHATSAPP', templateId: template,
      body, bookingId, deliveryState: 'SENT', providerResponse: response,
    });
  } catch (err) {
    console.error('[whatsapp] send failed:', err.message);
    return record({
      recipientPhone: phoneNo, channel: 'WHATSAPP', templateId: template,
      body, bookingId, deliveryState: 'FAILED',
      providerResponse: { error: err.message, detail: err.detail },
    });
  }
}

/** SMS/OTP path. Shares the same delivery log so receipts are uniform. */
async function sendOtp({ phoneNo, otpCode }) {
  const body = `Your Ambulance Booking System verification code is ${otpCode}. It is valid for 5 minutes. Do not share this code.`;
  if (!usingCloudApi()) {
    console.log(`\n[otp:mock -> ${phoneNo}] ${otpCode}\n`);
    return record({
      recipientPhone: phoneNo, channel: 'SMS', templateId: config.whatsapp.templates.otp,
      body, deliveryState: 'SENT', providerResponse: { transport: 'mock' },
    });
  }
  return sendWhatsApp({ phoneNo, body, templateId: config.whatsapp.templates.otp });
}

/** Marks a delivery receipt, e.g. from a Meta webhook. */
function updateDeliveryState(msgId, state) {
  db.prepare(
    'UPDATE messages SET delivery_state = ?, delivery_timestamp = ? WHERE message_id = ?'
  ).run(state, nowIso(), msgId);
}

// ------------------------------------------------------------- templates
const templates = {
  dispatchAlert({ booking, provider, distanceKm, expirySeconds }) {
    const lines = [
      'AMBULANCE DISPATCH REQUEST',
      `Booking: ${booking.booking_id}`,
      `Type: ${booking.ambulance_type}`,
      `Pickup: ${booking.address_text || `${booking.latitude}, ${booking.longitude}`}`,
    ];
    if (booking.landmark) lines.push(`Landmark: ${booking.landmark}`);
    if (distanceKm != null) lines.push(`Distance: ${distanceKm.toFixed(2)} km`);
    if (booking.notes) lines.push(`Notes: ${booking.notes}`);
    lines.push(`Vehicle: ${provider.vehicle_reg_no}`);
    lines.push(`Respond in the driver app within ${expirySeconds} seconds, or the request moves to the next ambulance.`);
    return lines.join('\n');
  },
  assignmentConfirmed({ booking, provider, driverName, etaMinutes }) {
    return [
      'AMBULANCE ASSIGNED',
      `Booking: ${booking.booking_id}`,
      `Driver: ${driverName} (${provider.vehicle_reg_no}, ${provider.ambulance_type})`,
      etaMinutes ? `ETA: about ${etaMinutes} minute(s)` : null,
      'Track the ambulance live in the app.',
    ].filter(Boolean).join('\n');
  },
  statusUpdate({ booking, milestone, etaMinutes }) {
    const readable = {
      ASSIGNED: 'An ambulance has been assigned to your request.',
      ENROUTE: 'The ambulance is on the way to your pickup point.',
      ARRIVED: 'The ambulance has arrived at your pickup point.',
      ONBOARD: 'The patient is on board. The ambulance is moving to the hospital.',
      COMPLETED: 'The trip is complete. Your invoice is ready in the app.',
    };
    return [
      `Booking ${booking.booking_id}: ${readable[milestone] || milestone}`,
      etaMinutes ? `ETA: about ${etaMinutes} minute(s)` : null,
    ].filter(Boolean).join('\n');
  },
};

module.exports = { sendWhatsApp, sendOtp, updateDeliveryState, templates, usingCloudApi, toE164 };
