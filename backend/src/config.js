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

  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
  exposeOtp: bool(process.env.EXPOSE_OTP_IN_RESPONSE, true),

  dispatch: {
    offerTimeoutSeconds: int(process.env.OFFER_TIMEOUT_SECONDS, 45),
    maxRetries: int(process.env.MAX_DISPATCH_RETRIES, 5),
    searchRadiusKm: int(process.env.SEARCH_RADIUS_KM, 15),
    providerStaleMinutes: int(process.env.PROVIDER_STALE_MINUTES, 15),
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
