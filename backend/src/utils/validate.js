'use strict';

// Validation rules transcribed from the Data Dictionary, section 2 (Data Element
// Definitions). Keeping them in one place means the API, the seed data and the
// admin dashboard all enforce exactly the specified formats.
const PHONE_RE = /^[6-9][0-9]{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NAME_RE = /^[A-Za-z][A-Za-z .'-]{2,59}$/;
const VEHICLE_RE = /^[A-Z]{2}[0-9]{2}[A-Z]{2}[0-9]{4}$/;
const PINCODE_RE = /^[0-9]{6}$/;

const ROLE_CODES = ['USER', 'DRIVER', 'ORG', 'ADMIN'];
const AMBULANCE_TYPES = ['BLS', 'ALS', 'ICU', 'PTV'];
const AVAILABILITY = ['AVAILABLE', 'BUSY', 'OFFLINE'];
const VERIFICATION = ['PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED'];
const BOOKING_STATUS = [
  'REQUESTED', 'MATCHING', 'ASSIGNED', 'ENROUTE', 'ARRIVED',
  'ONBOARD', 'COMPLETED', 'CANCELLED', 'FAILED',
];
const ASSIGNMENT_STATUS = ['OFFERED', 'ACCEPTED', 'REJECTED', 'TIMEOUT'];
const TRIP_MILESTONES = ['ASSIGNED', 'ENROUTE', 'ARRIVED', 'ONBOARD', 'COMPLETED'];
const PAYMENT_MODES = ['UPI', 'CARD', 'NETBANKING', 'CASH'];
const PAYMENT_STATUS = ['PENDING', 'SUCCESS', 'FAILED', 'REFUNDED'];
const MESSAGE_CHANNELS = ['WHATSAPP', 'PUSH', 'SMS'];
const DELIVERY_STATES = ['SENT', 'DELIVERED', 'READ', 'FAILED'];
const REPORT_TYPES = ['RESPONSE_TIME', 'DEMAND', 'REVENUE', 'PROVIDER_PERF'];

class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
    this.field = field;
  }
}

function required(value, field) {
  if (value === undefined || value === null || value === '') {
    throw new ValidationError(`${field} is required`, field);
  }
  return value;
}

function phone(value, field = 'phone_no') {
  const v = String(required(value, field)).replace(/[^0-9]/g, '').slice(-10);
  if (!PHONE_RE.test(v)) throw new ValidationError('Enter a valid 10-digit Indian mobile number', field);
  return v;
}

function name(value, field = 'full_name') {
  const v = String(required(value, field)).trim();
  if (!NAME_RE.test(v)) throw new ValidationError('Name must be 3-60 letters', field);
  return v;
}

function email(value, field = 'email_id') {
  if (!value) return null;
  const v = String(value).trim().toLowerCase();
  if (!EMAIL_RE.test(v)) throw new ValidationError('Enter a valid email address', field);
  return v;
}

function password(value, field = 'password') {
  const v = String(required(value, field));
  if (v.length < 6) throw new ValidationError('Password must be at least 6 characters', field);
  return v;
}

function oneOf(value, allowed, field) {
  const v = String(required(value, field)).toUpperCase();
  if (!allowed.includes(v)) {
    throw new ValidationError(`${field} must be one of ${allowed.join(', ')}`, field);
  }
  return v;
}

function coordinate(value, kind, field) {
  const v = Number(required(value, field));
  const limit = kind === 'lat' ? 90 : 180;
  if (!Number.isFinite(v) || Math.abs(v) > limit) {
    throw new ValidationError(`${field} is out of range`, field);
  }
  return Number(v.toFixed(6));
}

function vehicleRegNo(value, field = 'vehicle_reg_no') {
  const v = String(required(value, field)).toUpperCase().replace(/[\s-]/g, '');
  if (!VEHICLE_RE.test(v)) {
    throw new ValidationError('Vehicle number must look like KA19AB1234', field);
  }
  return v;
}

function pincode(value, field = 'pincode') {
  if (!value) return null;
  const v = String(value).trim();
  if (!PINCODE_RE.test(v)) throw new ValidationError('Pincode must be 6 digits', field);
  return v;
}

function rating(value, field = 'rating_value') {
  const v = Number(required(value, field));
  if (!Number.isInteger(v) || v < 1 || v > 5) throw new ValidationError('Rating must be 1-5', field);
  return v;
}

function text(value, max, field) {
  if (value === undefined || value === null || value === '') return null;
  const v = String(value).trim();
  if (v.length > max) throw new ValidationError(`${field} must be at most ${max} characters`, field);
  return v;
}

module.exports = {
  ValidationError,
  required, phone, name, email, password, oneOf, coordinate,
  vehicleRegNo, pincode, rating, text,
  ROLE_CODES, AMBULANCE_TYPES, AVAILABILITY, VERIFICATION, BOOKING_STATUS,
  ASSIGNMENT_STATUS, TRIP_MILESTONES, PAYMENT_MODES, PAYMENT_STATUS,
  MESSAGE_CHANNELS, DELIVERY_STATES, REPORT_TYPES,
};
