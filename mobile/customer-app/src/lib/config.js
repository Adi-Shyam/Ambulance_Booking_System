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

export const MILESTONE_STEPS = [
  { code: 'ASSIGNED', label: 'Ambulance assigned' },
  { code: 'ENROUTE', label: 'On the way to you' },
  { code: 'ARRIVED', label: 'Arrived at pickup' },
  { code: 'ONBOARD', label: 'Patient on board' },
  { code: 'COMPLETED', label: 'Trip completed' },
];

export const PAYMENT_MODES = [
  { code: 'UPI', label: 'UPI', icon: '📱' },
  { code: 'CARD', label: 'Card', icon: '💳' },
  { code: 'NETBANKING', label: 'Netbanking', icon: '🏦' },
  { code: 'CASH', label: 'Cash', icon: '💵' },
];
