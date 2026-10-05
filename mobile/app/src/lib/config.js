import { Platform } from 'react-native';
import Constants from 'expo-constants';

/**
 * Where the backend lives.
 *
 * A phone running Expo Go cannot reach "localhost" - that points at the phone
 * itself. Expo already knows the LAN address of the machine running the dev
 * server, so we reuse its host and swap in the API port.
 *
 * EXPO_PUBLIC_API_URL overrides it, and a standalone build *must* set it: there
 * is no dev server in a packaged APK, so `hostUri` is null and the fallbacks
 * below are only meaningful on an emulator.
 */
function resolveApiUrl() {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return explicit.replace(/\/$/, '');

  const API_PORT = 4000;

  const hostUri =
    Constants.expoConfig?.hostUri ||
    Constants.expoGoConfig?.debuggerHost ||
    Constants.manifest2?.extra?.expoClient?.hostUri;

  if (hostUri) {
    const host = hostUri.split(':')[0];
    return `http://${host}:${API_PORT}`;
  }

  // The Android emulator reaches the host machine through 10.0.2.2.
  if (Platform.OS === 'android') return `http://10.0.2.2:${API_PORT}`;
  return `http://localhost:${API_PORT}`;
}

export const API_URL = resolveApiUrl();

/**
 * F.2 - the modes offered at sign-in.
 *
 * `roleCode` is what gets sent to /api/auth/login, where the backend rejects a
 * mismatch against the account's own role. The provider mode sends nothing,
 * because a driver and a fleet operator are two different role codes behind one
 * console and the server only accepts a single value - so that one is checked
 * client-side against `accepts` instead.
 */
export const ROLES = [
  {
    key: 'PATIENT',
    title: 'Book an ambulance',
    subtitle: 'For patients and families',
    icon: '🚑',
    roleCode: 'USER',
    accepts: ['USER'],
    demo: '9800000001 / user123',
  },
  {
    key: 'PROVIDER',
    title: 'Drive an ambulance',
    subtitle: 'For drivers and operators',
    icon: '📟',
    roleCode: null,
    accepts: ['DRIVER', 'ORG'],
    demo: '9700000002 / driver123',
  },
  {
    key: 'ADMIN',
    title: 'Control room',
    subtitle: 'Verify, monitor and report',
    icon: '🛰️',
    roleCode: 'ADMIN',
    accepts: ['ADMIN'],
    demo: '9000000001 / admin123',
  },
];

export const roleFor = (key) => ROLES.find((r) => r.key === key) || null;

/** Which mode an already-signed-in account belongs to, on app restart. */
export function modeForRoleCode(roleCode) {
  return ROLES.find((r) => r.accepts.includes(roleCode))?.key || null;
}

export const AMBULANCE_TYPES = [
  { code: 'BLS', label: 'Basic Life Support', hint: 'Oxygen, stretcher, trained attendant', icon: '🚑' },
  { code: 'ALS', label: 'Advanced Life Support', hint: 'Ventilator, defibrillator, paramedic', icon: '🫀' },
  { code: 'ICU', label: 'Mobile ICU', hint: 'Critical care with full monitoring', icon: '🏥' },
  { code: 'PTV', label: 'Patient Transport', hint: 'Non-emergency transfer between facilities', icon: '🚐' },
];

/** F.9 milestones as the patient reads them. */
export const MILESTONE_STEPS = [
  { code: 'ASSIGNED', label: 'Ambulance assigned' },
  { code: 'ENROUTE', label: 'On the way to you' },
  { code: 'ARRIVED', label: 'Arrived at pickup' },
  { code: 'ONBOARD', label: 'Patient on board' },
  { code: 'COMPLETED', label: 'Trip completed' },
];

/**
 * The same milestones as the driver acts on them. `action` is the label of the
 * single button that advances the trip - the server accepts only one step
 * forward, so the console never offers a choice.
 */
export const DRIVER_MILESTONES = [
  { code: 'ASSIGNED', label: 'Request accepted', action: null },
  { code: 'ENROUTE', label: 'On the way to pickup', action: 'Start driving to pickup' },
  { code: 'ARRIVED', label: 'Arrived at pickup', action: 'I have arrived' },
  { code: 'ONBOARD', label: 'Patient on board', action: 'Patient is on board' },
  { code: 'COMPLETED', label: 'Trip completed', action: 'Complete the trip' },
];

export const PAYMENT_MODES = [
  { code: 'UPI', label: 'UPI', icon: '📱' },
  { code: 'CARD', label: 'Card', icon: '💳' },
  { code: 'NETBANKING', label: 'Netbanking', icon: '🏦' },
  { code: 'CASH', label: 'Cash', icon: '💵' },
];

/**
 * How often the driver console reports its position while on duty.
 *
 * Dispatch only considers an ambulance whose last fix is newer than
 * PROVIDER_STALE_MINUTES (15 by default), so a driver sitting still must still
 * report or the recovery sweep takes them off duty. Every ping also refreshes
 * the patient's ETA. 20 seconds is comfortably inside both.
 */
export const LOCATION_PING_MS = 20_000;

// ------------------------------------------------------------------- admin
export const BOOKING_STATUSES = [
  'REQUESTED', 'MATCHING', 'ASSIGNED', 'ENROUTE',
  'ARRIVED', 'ONBOARD', 'COMPLETED', 'CANCELLED', 'FAILED',
];

export const VERIFICATION_STATUSES = ['PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED'];
export const AVAILABILITY_STATUSES = ['AVAILABLE', 'BUSY', 'OFFLINE'];
export const ROLE_CODES = ['USER', 'DRIVER', 'ORG', 'ADMIN'];

export const REPORT_TYPES = [
  { code: 'RESPONSE_TIME', label: 'Response time' },
  { code: 'DEMAND', label: 'Demand' },
  { code: 'REVENUE', label: 'Revenue' },
  { code: 'PROVIDER_PERF', label: 'Providers' },
];
