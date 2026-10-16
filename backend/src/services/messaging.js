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

/**
 * Verification codes may travel by email instead of WhatsApp (F.1). Email is a
 * delivery channel only - `phone_no` remains the account identifier, because
 * the data dictionary makes it NOT NULL UNIQUE and a driver who cannot find
 * the patient has to be able to ring them.
 *
 * Email is also the one channel that is unconditionally free: it has no
 * 24-hour customer service window, needs no approved template, and no billing
 * relationship with Meta.
 */
/**
 * Which email transport is actually usable, decided once from what is
 * configured rather than from what was asked for.
 *
 * Brevo wins when both are set, because its HTTP API works in places an
 * outbound SMTP port does not - a hosted container among them. An explicit
 * EMAIL_PROVIDER narrows the choice; it cannot conjure credentials that are
 * absent, so a provider named without its key still falls back to the mock
 * rather than failing every send at run time.
 */
function emailTransport() {
  const wanted = config.email.provider;
  const haveBrevo = Boolean(config.email.brevoApiKey);
  const haveSmtp = Boolean(config.email.host && config.email.user);

  if (wanted === 'mock') return 'mock';
  if (wanted === 'brevo') return haveBrevo ? 'brevo' : 'mock';
  if (wanted === 'smtp') return haveSmtp ? 'smtp' : 'mock';
  if (haveBrevo) return 'brevo';
  if (haveSmtp) return 'smtp';
  return 'mock';
}

const usingSmtp = () => emailTransport() !== 'mock';

/** Splits `Name <addr@host>` into Brevo's sender object. */
function parseFrom(value) {
  const m = String(value).match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return m ? { name: m[1] || undefined, email: m[2] } : { email: String(value).trim() };
}

async function sendViaBrevo({ emailId, subject, body }) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': config.email.brevoApiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      sender: parseFrom(config.email.from),
      to: [{ email: emailId }],
      subject,
      textContent: body,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(json?.message || `Brevo returned ${res.status}`), { detail: json });
  }
  return json;
}

function toE164(phoneNo) {
  const digits = String(phoneNo).replace(/[^0-9]/g, '');
  return digits.length > 10 ? digits : config.whatsapp.countryCode + digits;
}

function record({ recipientPhone, recipientEmail, channel, templateId, body, bookingId, deliveryState, providerResponse }) {
  const id = messageId();
  db.prepare(
    `INSERT INTO messages (message_id, booking_id, recipient_phone, recipient_email, message_channel,
                           message_template_id, body, delivery_state, delivery_timestamp,
                           provider_response, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    bookingId || null,
    recipientPhone,
    recipientEmail || null,
    channel,
    templateId || null,
    body || null,
    deliveryState,
    nowIso(),
    providerResponse ? JSON.stringify(providerResponse).slice(0, 2000) : null,
    nowIso()
  );

  announce({
    message_id: id, booking_id: bookingId || null, recipient_phone: recipientPhone,
    recipient_email: recipientEmail || null, message_channel: channel,
    message_template_id: templateId || null, body: body || null,
    delivery_state: deliveryState, created_at: nowIso(),
  });

  return id;
}

/**
 * Tells the control room about a message the moment it is logged.
 *
 * The alert log is the one place that shows every WhatsApp, email and push the
 * system sent, which makes it the evidence for F.6 and F.14 - and evidence
 * nobody can watch arrive is half as convincing. Required at call time because
 * the socket layer loads this module.
 */
function announce(row) {
  try {
    require('../realtime/socket').toAdmins('admin:message', row);
  } catch {
    // No socket server: a test, or a seed. The row is written regardless.
  }
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

// nodemailer builds a connection pool, so the transport is created once and
// reused rather than per message.
let mailer = null;
function smtp() {
  if (!mailer) {
    // Required here rather than at the top of the file so a deployment that
    // never sends email does not pay to load it.
    const nodemailer = require('nodemailer');
    mailer = nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.secure,
      auth: { user: config.email.user, pass: config.email.pass },
    });
  }
  return mailer;
}

/**
 * Sends an email and logs it beside every other channel, so the control room's
 * alert log stays a single list. Like sendWhatsApp it resolves rather than
 * rejects: a mail outage must not take a registration down with it.
 */
async function sendEmail({ emailId, phoneNo, subject, body, templateId, bookingId }) {
  const via = emailTransport();
  const log = (deliveryState, providerResponse) => record({
    recipientPhone: phoneNo, recipientEmail: emailId, channel: 'EMAIL',
    templateId, body, bookingId, deliveryState,
    providerResponse: { transport: via, ...providerResponse },
  });

  if (via === 'mock') {
    console.log(`\n[email:mock -> ${emailId}] ${subject}\n${body}\n`);
    return log('SENT', {});
  }

  try {
    if (via === 'brevo') {
      const json = await sendViaBrevo({ emailId, subject, body });
      return log('SENT', { messageId: json.messageId });
    }
    const info = await smtp().sendMail({
      from: config.email.from, to: emailId, subject, text: body,
    });
    return log('SENT', { messageId: info.messageId, accepted: info.accepted });
  } catch (err) {
    console.error(`[email:${via}] send failed:`, err.message);
    return log('FAILED', { error: err.message, detail: err.detail });
  }
}

/**
 * Sends a verification code (F.1) over whichever channel was asked for. All
 * channels share the delivery log, so a receipt looks the same however the
 * code travelled.
 */
async function sendOtp({ phoneNo, otpCode, channel = 'WHATSAPP', emailId = null }) {
  const body = `Your Ambulance Booking System verification code is ${otpCode}. It is valid for 5 minutes. Do not share this code.`;

  if (channel === 'EMAIL') {
    if (!emailId) throw new Error('sendOtp: channel EMAIL needs an emailId');
    return sendEmail({
      emailId,
      phoneNo,
      subject: `${otpCode} is your Ambulance Booking verification code`,
      body,
      templateId: config.whatsapp.templates.otp,
    });
  }

  if (!usingCloudApi()) {
    console.log(`\n[otp:mock -> ${phoneNo}] ${otpCode}\n`);
    return record({
      recipientPhone: phoneNo, channel: 'SMS', templateId: config.whatsapp.templates.otp,
      body, deliveryState: 'SENT', providerResponse: { transport: 'mock' },
    });
  }
  return sendWhatsApp({ phoneNo, body, templateId: config.whatsapp.templates.otp });
}

/**
 * `a***a@gmail.com` / `98****3210` - enough for someone to recognise where the
 * code went, without the response disclosing a full address or number to
 * whoever happened to ask for it.
 */
function maskDestination(value, channel) {
  const v = String(value || '');
  if (channel === 'EMAIL') {
    const [local, domain] = v.split('@');
    if (!domain) return v;
    const head = local.slice(0, 1);
    const tail = local.length > 2 ? local.slice(-1) : '';
    const stars = Math.max(1, local.length - head.length - tail.length);
    return `${head}${'*'.repeat(stars)}${tail}@${domain}`;
  }
  return v.length <= 6 ? v : `${v.slice(0, 2)}${'*'.repeat(v.length - 6)}${v.slice(-4)}`;
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

module.exports = {
  sendWhatsApp, sendEmail, sendOtp, updateDeliveryState, templates,
  usingCloudApi, usingSmtp, emailTransport, toE164, maskDestination, parseFrom,
};
