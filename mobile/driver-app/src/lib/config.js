import { Platform } from 'react-native';
import Constants from 'expo-constants';

/**
 * Where the backend lives.
 *
 * A phone running Expo Go cannot reach "localhost" - that points at the phone
 * itself. Expo already knows the LAN address of the machine running the dev
 * server, so we reuse its host and swap in the API port. Set EXPO_PUBLIC_API_URL
 * to override (for a deployed backend, or a physical device on another network).
 */
function resolveApiUrl() {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return explicit.replace(/\/$/, '');

  const API_PORT = 4000;

  // The Android emulator reaches the host machine through 10.0.2.2.
  const hostUri =
    Constants.expoConfig?.hostUri ||
    Constants.expoGoConfig?.debuggerHost ||
    Constants.manifest2?.extra?.expoClient?.hostUri;

  if (hostUri) {
    const host = hostUri.split(':')[0];
    return `http://${host}:${API_PORT}`;
  }

  if (Platform.OS === 'android') return `http://10.0.2.2:${API_PORT}`;
  return `http://localhost:${API_PORT}`;
}

export const API_URL = resolveApiUrl();

export const AMBULANCE_TYPES = [
  { code: 'BLS', label: 'Basic Life Support', hint: 'Oxygen, stretcher, trained attendant', icon: '🚑' },
  { code: 'ALS', label: 'Advanced Life Support', hint: 'Ventilator, defibrillator, paramedic', icon: '🫀' },
  { code: 'ICU', label: 'Mobile ICU', hint: 'Critical care with full monitoring', icon: '🏥' },
  { code: 'PTV', label: 'Patient Transport', hint: 'Non-emergency transfer between facilities', icon: '🚐' },
];

/**
 * F.9 milestone order. Fixed by the SRS and enforced server-side: the driver may
 * only ever move one step forward, so the console offers exactly one next action.
 */
export const MILESTONE_STEPS = [
  { code: 'ASSIGNED', label: 'Request accepted', action: null },
  { code: 'ENROUTE', label: 'On the way to pickup', action: 'Start driving to pickup' },
  { code: 'ARRIVED', label: 'Arrived at pickup', action: 'I have arrived' },
  { code: 'ONBOARD', label: 'Patient on board', action: 'Patient is on board' },
  { code: 'COMPLETED', label: 'Trip completed', action: 'Complete the trip' },
];

/**
 * How often the console reports its position while on duty.
 *
 * Two separate jobs depend on this. Dispatch only considers an ambulance whose
 * last fix is newer than PROVIDER_STALE_MINUTES (15 by default) - so a driver
 * sitting still must still report, or the recovery sweep takes them off duty.
 * And every ping refreshes the patient's ETA, so a long interval makes the map
 * look frozen. 20 seconds is comfortably inside both.
 */
export const LOCATION_PING_MS = 20_000;
