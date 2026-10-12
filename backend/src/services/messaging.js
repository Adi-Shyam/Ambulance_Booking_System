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

/** Meta rejects a template parameter containing a newline or a tab. */
const flatten = (v) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').trim();

/**
 * Builds the Cloud API payload.
 *
 * Free-form text is only accepted inside the 24-hour customer service window -
 * that is, to someone who messaged the business first. A dispatch alert to a
 * driver is business-initiated and almost never inside it, so production must
 * send an approved template instead. WHATSAPP_USE_TEMPLATES chooses, because a
 * test number with the window open works perfectly well with plain text and
 * needs no template approval at all.
 */
function cloudApiPayload({ phoneNo, body, params, templateId }) {
  const to = toE164(phoneNo);

  if (config.whatsapp.useTemplates && Array.isArray(params) && params.length) {
    return {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateId,
        language: { code: config.whatsapp.templateLanguage },
        components: [{
          type: 'body',
          parameters: params.map((p) => ({ type: 'text', text: flatten(p) })),
        }],
      },
    };
  }

  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { preview_url: false, body },
  };
}

async function sendViaCloudApi({ phoneNo, body, params, templateId }) {
  const url = `https://graph.facebook.com/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.whatsapp.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cloudApiPayload({ phoneNo, body, params, templateId })),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json?.error?.message || 'WhatsApp send failed'), { detail: json });
  return json;
}

/**
 * Sends a WhatsApp alert. Resolves to the stored message row id; never rejects,
 * because a messaging outage must not block a dispatch (NF.1).
 */
async function sendWhatsApp({ phoneNo, body, params, templateId, bookingId }) {
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
    const response = await sendViaCloudApi({ phoneNo, body, params, templateId: template });
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
/**
 * Each builder returns both forms of the same message:
 *
 *   body   - the readable text, used by the mock transport, the alert log, and
 *            the Cloud API inside the 24-hour customer service window
 *   params - the ordered variables for the approved WhatsApp template of the
 *            same name, used outside that window
 *
 * Call sites spread the result into sendWhatsApp, so both travel together and
 * cannot drift apart.
 *
 * Template parameters may not contain newlines or tabs - Meta rejects the
 * message - so the layout lives in the approved template and each parameter is
 * a single flat value.
 */
const templates = {
  dispatchAlert({ booking, provider, distanceKm, expirySeconds }) {
    const pickup = booking.address_text || `${booking.latitude}, ${booking.longitude}`;
    const lines = [
      'AMBULANCE DISPATCH REQUEST',
      `Booking: ${booking.booking_id}`,
      `Type: ${booking.ambulance_type}`,
      `Pickup: ${pickup}`,
    ];
    if (booking.landmark) lines.push(`Landmark: ${booking.landmark}`);
    if (distanceKm != null) lines.push(`Distance: ${distanceKm.toFixed(2)} km`);
    if (booking.notes) lines.push(`Notes: ${booking.notes}`);
    lines.push(`Vehicle: ${provider.vehicle_reg_no}`);
    lines.push(`Respond in the driver app within ${expirySeconds} seconds, or the request moves to the next ambulance.`);

    return {
      body: lines.join('\n'),
      params: [
        booking.booking_id,
        booking.ambulance_type,
        pickup,
        distanceKm != null ? `${distanceKm.toFixed(2)} km` : 'nearby',
        String(expirySeconds),
      ],
    };
  },

  assignmentConfirmed({ booking, provider, driverName, etaMinutes }) {
    return {
      body: [
        'AMBULANCE ASSIGNED',
        `Booking: ${booking.booking_id}`,
        `Driver: ${driverName} (${provider.vehicle_reg_no}, ${provider.ambulance_type})`,
        etaMinutes ? `ETA: about ${etaMinutes} minute(s)` : null,
        'Track the ambulance live in the app.',
      ].filter(Boolean).join('\n'),
      params: [
        booking.booking_id,
        driverName,
        `${provider.vehicle_reg_no}, ${provider.ambulance_type}`,
        etaMinutes ? `about ${etaMinutes} minute(s)` : 'shortly',
      ],
    };
  },

  statusUpdate({ booking, milestone, etaMinutes }) {
    const readable = {
      ASSIGNED: 'An ambulance has been assigned to your request.',
      ENROUTE: 'The ambulance is on the way to your pickup point.',
      ARRIVED: 'The ambulance has arrived at your pickup point.',
      ONBOARD: 'The patient is on board. The ambulance is moving to the hospital.',
      COMPLETED: 'The trip is complete. Your invoice is ready in the app.',
    };
    const text = readable[milestone] || milestone;
    return {
      body: [
        `Booking ${booking.booking_id}: ${text}`,
        etaMinutes ? `ETA: about ${etaMinutes} minute(s)` : null,
      ].filter(Boolean).join('\n'),
      params: [
        booking.booking_id,
        text,
        etaMinutes ? `about ${etaMinutes} minute(s)` : 'shortly',
      ],
    };
  },

  // ----------------------------------------------------------------------
  // The messages below cover the moments where the person is least likely to
  // be looking at the app: a driver already heading somewhere, or a patient
  // waiting on an ambulance that is not coming. An in-app notification alone
  // is not enough when nobody is watching the screen.
  // ----------------------------------------------------------------------

  /** To the patient: nothing could be matched (F.7 exhausted). */
  dispatchFailed({ booking, reason }) {
    return {
      body: [
        'NO AMBULANCE AVAILABLE',
        `Booking: ${booking.booking_id}`,
        reason,
        'Please try again, or call 108 immediately if this is an emergency.',
      ].join('\n'),
      params: [booking.booking_id, reason],
    };
  },

  /** To the driver: the job they may already be driving to is off. */
  bookingCancelled({ booking, reason }) {
    return {
      body: [
        'BOOKING CANCELLED',
        `Booking: ${booking.booking_id}`,
        `Reason: ${reason}`,
        'You do not need to continue to this pickup. You are available for new requests.',
      ].join('\n'),
      params: [booking.booking_id, reason],
    };
  },

  /** To the patient: the control room cancelled it, not them. */
  cancelledByControlRoom({ booking, reason }) {
    return {
      body: [
        'BOOKING CANCELLED BY THE CONTROL ROOM',
        `Booking: ${booking.booking_id}`,
        `Reason: ${reason}`,
        'Please book again if you still need an ambulance, or call 108.',
      ].join('\n'),
      params: [booking.booking_id, reason],
    };
  },

  /** To the patient: NF.1 - the crew has gone quiet, and they should know. */
  tripStalled({ booking }) {
    return {
      body: [
        'WE HAVE LOST CONTACT WITH YOUR AMBULANCE',
        `Booking: ${booking.booking_id}`,
        'The crew has not reported their position recently. Our control room has been alerted.',
        'If this is urgent, please also call 108.',
      ].join('\n'),
      params: [booking.booking_id],
    };
  },

  /** To the driver: the recovery sweep took them off duty (C.6). */
  takenOffDuty({ minutes }) {
    return {
      body: [
        'YOU HAVE BEEN TAKEN OFF DUTY',
        `Your app stopped reporting its location for more than ${minutes} minutes.`,
        'Open the driver app and go on duty again to receive requests.',
      ].join('\n'),
      params: [String(minutes)],
    };
  },

  /** To the driver: an invoice they are owed has settled. */
  paymentReceived({ booking, invoice, paymentMode }) {
    const amount = `Rs ${Number(invoice.fare_amount).toFixed(2)}`;
    return {
      body: [
        'PAYMENT RECEIVED',
        `Booking: ${booking.booking_id}`,
        `Amount: ${amount} (${paymentMode})`,
      ].join('\n'),
      params: [booking.booking_id, amount, paymentMode],
    };
  },
};

module.exports = { sendWhatsApp, sendOtp, updateDeliveryState, templates, usingCloudApi, toE164 };
