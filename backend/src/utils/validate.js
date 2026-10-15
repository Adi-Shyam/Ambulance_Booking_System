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
// What a vehicle can be registered as.
// NIST SP 800-63B puts the floor at 8 and says the useful work is done by
// length and a blocklist, not by composition rules.
const MIN_PASSWORD = 8;

const AMBULANCE_TYPES = ['BLS', 'ALS', 'ICU', 'PTV'];
// What a patient can ask for. EMG is a request, not a vehicle class: it means
// "emergency, send whatever is nearest", so no provider ever registers as one
// and every ambulance in range is eligible to answer it.
const REQUEST_TYPES = [...AMBULANCE_TYPES, 'EMG'];
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

/**
 * Checks a password being *supplied*, not chosen.
 *
 * Deliberately lenient: an account whose password predates a stricter rule
 * must still be able to sign in, or tightening the rule would lock people out
 * of their own accounts. Choosing a new one goes through `newPassword`.
 */
function password(value, field = 'password') {
  const v = String(required(value, field));
  if (v.length < 6) throw new ValidationError('Password must be at least 6 characters', field);
  return v;
}

// Passwords that appear at the top of every breach corpus, plus the ones this
// particular system invites. A blocklist catches what a composition rule
// cannot: "Password1!" satisfies every rule about upper case, digits and
// symbols, and is still among the first an attacker tries.
const COMMON_PASSWORDS = new Set([
  '12345678', '123456789', '1234567890', 'password', 'password1', 'password123',
  'qwerty', 'qwerty123', 'qwertyuiop', 'abc12345', 'iloveyou', 'sunshine',
  'princess', 'football', 'baseball', 'welcome', 'welcome1', 'admin123',
  'administrator', 'letmein', 'monkey', 'dragon', 'master', 'superman',
  'trustno1', 'starwars', 'whatever', 'computer', 'michael', 'jennifer',
  'jordan23', 'pokemon', 'samsung', 'asdfghjk', 'zxcvbnm', '1q2w3e4r',
  '1qaz2wsx', 'qazwsxedc', 'passw0rd', 'p@ssword', 'p@ssw0rd', 'secret123',
  'changeme', 'default', 'india123', 'bharat123', 'krishna', 'ganesh123',
  // The ones this project hands out, and the words sitting on every screen.
  'user1234', 'driver123', 'ambulance', 'ambulance123', 'hospital', 'emergency',
  'patient123', 'doctor123', 'nitk1234', 'surathkal',
]);

const CLASSES = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/];

/** "aaaaaaaa" and "11111111" are long without being anything. */
const isOneCharacterRepeated = (s) => new Set(s).size === 1;

/** "12345678", "abcdefgh" and their reverses. */
function isRunOfConsecutive(s) {
  if (s.length < 4) return false;
  let ascending = true;
  let descending = true;
  for (let i = 1; i < s.length; i += 1) {
    const step = s.charCodeAt(i) - s.charCodeAt(i - 1);
    if (step !== 1) ascending = false;
    if (step !== -1) descending = false;
  }
  return ascending || descending;
}

/**
 * Checks a password being *chosen*.
 *
 * The rules follow NIST SP 800-63B rather than the familiar
 * one-of-each-character-class formula, because that formula reliably produces
 * "Password1!" - which satisfies it and is guessed in seconds. Length and a
 * blocklist do more work than composition does.
 *
 * `owner` lets the check see the name, number and address being registered, so
 * a password that is simply one of those cannot be chosen. That is a common
 * real choice and an obvious first guess for anyone who knows the person.
 */
function newPassword(value, field = 'password', owner = {}) {
  const v = String(required(value, field));
  const lower = v.toLowerCase();

  if (v.length < MIN_PASSWORD) {
    throw new ValidationError(`Password must be at least ${MIN_PASSWORD} characters`, field);
  }

  // bcrypt hashes only the first 72 bytes and silently ignores the rest, so a
  // longer password is not as strong as it looks. Refusing is honest; quietly
  // truncating is not.
  if (Buffer.byteLength(v, 'utf8') > 72) {
    throw new ValidationError('Password must be 72 bytes or fewer', field);
  }

  if (/^\s|\s$/.test(v)) {
    throw new ValidationError('Password must not begin or end with a space', field);
  }

  if (COMMON_PASSWORDS.has(lower)) {
    throw new ValidationError('That password is one of the most commonly used. Choose another.', field);
  }

  if (isOneCharacterRepeated(v)) {
    throw new ValidationError('Password must not be the same character repeated', field);
  }

  if (isRunOfConsecutive(v)) {
    throw new ValidationError('Password must not be a run of consecutive characters', field);
  }

  // Their own details, which anyone who knows them would try first.
  // Split on anything that is not a letter or digit, so "Adithya Shyam"
  // contributes "adithya" and "shyam" separately - otherwise "adithya2026"
  // passes, since it contains neither the full name nor is contained by it.
  const ownPieces = [
    owner.full_name,
    owner.phone_no,
    owner.email_id ? String(owner.email_id).split('@')[0] : null,
  ]
    .filter(Boolean)
    .flatMap((p) => String(p).toLowerCase().split(/[^a-z0-9]+/))
    .filter((p) => p.length >= 4);

  for (const piece of ownPieces) {
    if (lower.includes(piece) || piece.includes(lower)) {
      throw new ValidationError('Password must not contain your name, number or email address', field);
    }
  }

  // Composition only where length cannot carry the weight on its own. A long
  // passphrase is strong without punctuation; a short password is not.
  const classes = CLASSES.filter((re) => re.test(v)).length;
  if (v.length < 12 && classes < 3) {
    throw new ValidationError(
      'Password must be 12 characters or longer, or mix upper case, lower case, digits and symbols',
      field
    );
  }

  return v;
}

/**
 * How strong a password is, for the meter the sign-up form shows. Scoring
 * rather than refusing: this never blocks anything, it only describes.
 */
function passwordStrength(value, owner = {}) {
  const v = String(value || '');
  if (!v) return { score: 0, label: 'Enter a password' };

  try {
    newPassword(v, 'password', owner);
  } catch (err) {
    return { score: 0, label: err.message, acceptable: false };
  }

  let score = 1;
  if (v.length >= 12) score += 1;
  if (v.length >= 16) score += 1;
  if (CLASSES.filter((re) => re.test(v)).length >= 3) score += 1;
  if (new Set(v).size >= Math.min(10, v.length)) score += 1;

  const label = ['', 'Acceptable', 'Fair', 'Good', 'Strong', 'Very strong'][Math.min(score, 5)];
  return { score: Math.min(score, 5), label, acceptable: true };
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
  required, phone, name, email, password, newPassword, passwordStrength, oneOf, coordinate,
  vehicleRegNo, pincode, rating, text,
  ROLE_CODES, MIN_PASSWORD, AMBULANCE_TYPES, REQUEST_TYPES, AVAILABILITY, VERIFICATION, BOOKING_STATUS,
  ASSIGNMENT_STATUS, TRIP_MILESTONES, PAYMENT_MODES, PAYMENT_STATUS,
  MESSAGE_CHANNELS, DELIVERY_STATES, REPORT_TYPES,
};
