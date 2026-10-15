import { Alert, Linking, Platform } from 'react-native';
import { api } from './api';

/**
 * Puts the two parties of a live booking through to each other.
 *
 * The call goes over the phone network rather than through the app. A crew who
 * cannot find a patient, and a patient watching an ambulance drive past the
 * turning, both need a call that works on a weak signal, with the app in the
 * background, and without this server being reachable. Carrying voice in-app
 * would be a worse answer to that problem, not a better one.
 *
 * The server decides who the other party is from the booking and who is
 * asking, so no screen has to work it out - and it logs the release of the
 * number, because a phone number is not something to hand over quietly (C.5).
 */
export async function callCounterparty(bookingId) {
  const who = await api.post(`/api/bookings/${bookingId}/call`, {});
  const label = who.name ? `${who.name} (${who.phone_no})` : who.phone_no;

  // `tel:` is a no-op in a browser tab, so the web build says what it would
  // have dialled rather than appearing to do nothing.
  if (Platform.OS === 'web') {
    Alert.alert('Call', `On a phone this would dial ${label}.`);
    return who;
  }

  const url = `tel:${who.phone_no}`;
  const canOpen = await Linking.canOpenURL(url).catch(() => false);
  if (!canOpen) {
    // A tablet with no dialer, for instance. Showing the number is still
    // useful: it can be read out or copied.
    Alert.alert('No dialer on this device', `Call ${label} from a phone.`);
    return who;
  }

  await Linking.openURL(url);
  return who;
}

/** What to put on the button, given who the caller is. */
export const callLabel = (role) => (role === 'DRIVER' ? 'Call patient' : 'Call driver');
