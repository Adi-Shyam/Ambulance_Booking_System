'use strict';
require('dotenv').config();

const int = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const bool = (v, d) => (v === undefined || v === '' ? d : String(v).toLowerCase() === 'true');

/** Parses "+05:30" / "-04:00" / "330" into minutes east of UTC. */
const offsetMinutes = (v, d) => {
  if (v === undefined || v === null || v === '') return d;
  if (/^-?\d+$/.test(String(v).trim())) return Number(v);
  const m = String(v).trim().match(/^([+-])(\d{2}):?(\d{2})$/);
  if (!m) return d;
  const total = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === '-' ? -total : total;
};

const config = {
  env: process.env.NODE_ENV || 'development',
  port: int(process.env.PORT, 4000),
  corsOrigin: process.env.CORS_ORIGIN || '*',

  // How many accounts one address may create in an hour (NF.3). Configurable
  // because a test suite legitimately creates more accounts in a minute than a
  // device ever should in an hour, and because a lab demonstration on one
  // shared network is a single address to this limiter.
  registerLimitPerHour: int(process.env.REGISTER_LIMIT_PER_HOUR, 10),

  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
  exposeOtp: bool(process.env.EXPOSE_OTP_IN_RESPONSE, true),

  dispatch: {
    offerTimeoutSeconds: int(process.env.OFFER_TIMEOUT_SECONDS, 45),
    maxRetries: int(process.env.MAX_DISPATCH_RETRIES, 5),
    searchRadiusKm: int(process.env.SEARCH_RADIUS_KM, 15),
    providerStaleMinutes: int(process.env.PROVIDER_STALE_MINUTES, 15),
    // An EMG request is offered to every nearby ambulance at once. The cap
    // bounds one request to a sane number of alerts in a dense area; the
    // candidates are ranked first, so the cap keeps the best of them.
    broadcastLimit: int(process.env.BROADCAST_LIMIT, 10),
  },

  // Recovery sweep (NF.1: a request must not be left unserved; C.6: driver
  // availability is validated before dispatch).
  watchdog: {
    enabled: bool(process.env.WATCHDOG_ENABLED, true),
    intervalSeconds: int(process.env.WATCHDOG_INTERVAL_SECONDS, 60),
    tripSilenceMinutes: int(process.env.TRIP_SILENCE_MINUTES, 10),
  },

  // Civil timezone the control room reports in (F.13). Stored data stays UTC;
  // only the day and hour buckets in analytics are shifted.
  reportOffsetMinutes: offsetMinutes(process.env.REPORT_UTC_OFFSET, 330), // default IST

  whatsapp: {
    token: process.env.WHATSAPP_TOKEN || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v20.0',
    // Business-initiated messages need an approved template; free-form text
    // only works inside the 24-hour customer service window. A test number
    // with that window open needs no templates, which is why this is a flag.
    useTemplates: bool(process.env.WHATSAPP_USE_TEMPLATES, false),
    templateLanguage: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en',
    templates: {
      dispatch: process.env.WHATSAPP_TEMPLATE_DISPATCH || 'ambulance_dispatch_alert',
      otp: process.env.WHATSAPP_TEMPLATE_OTP || 'ambulance_otp',
      status: process.env.WHATSAPP_TEMPLATE_STATUS || 'ambulance_trip_status',
    },
    countryCode: process.env.DEFAULT_COUNTRY_CODE || '91',
  },

  // F.14 - Expo push. Nothing is required for a project using Expo's own push
  // service: the device token is both the address and the authorisation. Set
  // EXPO_ACCESS_TOKEN only once push security is enabled for the project.
  push: {
    accessToken: process.env.EXPO_ACCESS_TOKEN || '',
    // Push has no credentials to detect, so unlike WhatsApp and email the mock
    // has to be asked for. Tests set it so the suite makes no outbound call,
    // and it lets a demo show the alert log without a real handset.
    mock: bool(process.env.PUSH_MOCK, false),
  },

  // Verification codes by email (F.1). Phone stays the account identifier - the
  // data dictionary makes phone_no NOT NULL UNIQUE and the driver has to be
  // able to ring the patient - so this is a delivery channel, not an identity.
  // Leave EMAIL_HOST empty to run the mock transport, which logs the code and
  // writes the same `messages` row the SMTP path does.
  email: {
    // brevo | smtp | mock. Resolved rather than read raw: naming a provider
    // whose credentials are absent would otherwise fail every send silently
    // at run time instead of being obvious at boot.
    provider: (process.env.EMAIL_PROVIDER || '').toLowerCase(),
    // Brevo's HTTP API. Preferred over SMTP for a hosted deployment, because
    // an outbound HTTPS call works everywhere an SMTP port may not.
    brevoApiKey: process.env.BREVO_API_KEY || '',
    host: process.env.EMAIL_HOST || '',
    port: int(process.env.EMAIL_PORT, 587),
    // Port 465 is implicit TLS; 587 upgrades with STARTTLS, which nodemailer
    // does on its own when `secure` is false.
    secure: bool(process.env.EMAIL_SECURE, false),
    user: process.env.EMAIL_USER || '',
    pass: process.env.EMAIL_PASS || '',
    from: process.env.EMAIL_FROM || 'Ambulance Booking System <no-reply@nitk.ac.in>',
  },

  maps: {
    provider: (process.env.MAPS_PROVIDER || 'osm').toLowerCase(),
    googleKey: process.env.GOOGLE_MAPS_API_KEY || '',
    nominatimUrl: process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org',
    osrmUrl: process.env.OSRM_URL || 'https://router.project-osrm.org',
    contactEmail: process.env.GEO_CONTACT_EMAIL || 'team16@nitk.edu.in',
  },

  payment: {
    provider: (process.env.PAYMENT_PROVIDER || 'mock').toLowerCase(),
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
    razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || '',
    // Separate from the API key secret: Razorpay signs webhooks with this one.
    razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
  },

  taxPercent: int(process.env.TAX_PERCENT, 5),
};

module.exports = config;
