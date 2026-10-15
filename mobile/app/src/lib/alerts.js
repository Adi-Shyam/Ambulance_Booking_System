import { Platform, Vibration } from 'react-native';
import * as Notifications from 'expo-notifications';

/**
 * Raises an alert from the device itself, with no push service involved.
 *
 * A *local* notification is scheduled by the app and delivered by the
 * operating system, so it needs no Firebase credentials and costs nothing. It
 * behaves like any other notification once it appears - a heads-up banner,
 * sound, vibration, a tray entry - which is the difference between a driver
 * noticing a 45-second offer and missing it.
 *
 * The limit is honest and worth stating: this only fires while the app is
 * running. The socket that carries the offer dies with the process, so an app
 * swiped away from recents hears nothing. Reaching a closed app is what a push
 * service is for, and on Android that means FCM.
 *
 * Vibration is separate because Android only vibrates for a notification when
 * the channel allows it and the phone is not silenced, while `Vibration` is
 * unconditional. An emergency is worth both.
 */

const EMERGENCY_PATTERN = [0, 400, 200, 400, 200, 600];
const ROUTINE_PATTERN = [0, 250];

/**
 * Fires immediately. Never throws: an alert that cannot be raised must not
 * take the offer down with it - the card still appears on screen.
 */
export async function raiseLocalAlert({ title, body, data = {}, emergency = false }) {
  try {
    Vibration.vibrate(emergency ? EMERGENCY_PATTERN : ROUTINE_PATTERN);
  } catch {
    // Some devices and the web have no vibrator. Not a reason to stop.
  }

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data,
        sound: 'default',
        priority: Notifications.AndroidNotificationPriority.MAX,
        // Android reads this from the channel, but iOS and the tray read it
        // from the notification.
        vibrate: emergency ? EMERGENCY_PATTERN : ROUTINE_PATTERN,
        // Keeps it in the tray until acted on: an offer that vanishes while
        // the phone is in a pocket is an offer that was never seen.
        sticky: emergency,
      },
      trigger: null,                      // null means now
      ...(Platform.OS === 'android' ? { channelId: 'dispatch' } : {}),
    });
  } catch (err) {
    // A notification channel that does not exist, permission never granted,
    // the web build - all survivable.
    console.warn('[alerts] could not raise a local alert:', err.message);
  }
}

/** The dispatch offer itself, worded for a driver glancing at a lock screen. */
export const offerAlert = (offer) =>
  raiseLocalAlert({
    emergency: Boolean(offer.broadcast),
    title: offer.broadcast
      ? `EMERGENCY — ${offer.distance_km ?? '?'} km away`
      : `${offer.ambulance_type} request — ${offer.distance_km ?? '?'} km away`,
    body: offer.broadcast
      ? `${offer.address_text || 'Shared location'} · first to accept takes it`
      : offer.address_text || 'Shared location',
    data: { type: 'OFFER', assignment_id: offer.assignment_id, booking_id: offer.booking_id },
  });
