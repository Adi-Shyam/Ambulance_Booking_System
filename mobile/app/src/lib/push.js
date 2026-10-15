import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { api } from './api';

/**
 * F.14 - real alerts.
 *
 * Every other channel in this app assumes somebody is looking: the socket
 * needs the app open, the inbox needs the screen on. A driver waiting for work
 * is doing neither, and a dispatch offer expires in 45 seconds. This is the
 * only path that reaches a phone in a pocket, which makes it the one that
 * decides whether an offer is seen at all.
 */

// A notification arriving while the app is open should still be shown: a
// driver reading yesterday's earnings needs to see an offer land.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Android groups notifications into channels, and the channel - not the
 * message - decides whether one can interrupt. A dispatch offer has to be able
 * to; a settled fare does not, which is why there are two.
 */
async function ensureChannels() {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync('dispatch', {
    name: 'Dispatch offers',
    description: 'A request waiting for you to accept. These expire in under a minute.',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    vibrationPattern: [0, 400, 200, 400],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    bypassDnd: true,
  });

  await Notifications.setNotificationChannelAsync('default', {
    name: 'Updates',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/**
 * Asks for permission once, and registers this device with the backend.
 *
 * Returns the token on success, or null with a reason - the caller decides
 * whether to say anything. Declining must not break anything: the app still
 * works, it just cannot reach you when it is closed.
 */
/**
 * Permission and channels, which are what a *local* alert needs.
 *
 * Separate from the push token on purpose. Android 13 requires permission
 * before an app may post any notification, including one it raises itself, and
 * the channel decides whether that notification may interrupt. Both of those
 * matter even when no push service is reachable - so a build with no Firebase
 * credentials still gets a banner and a sound while it is running, and the
 * screen can say so rather than reporting a flat failure.
 */
export async function ensureNotificationPermission() {
  if (!Device.isDevice || Platform.OS === 'web') return false;
  try {
    await ensureChannels();
    const existing = await Notifications.getPermissionsAsync();
    if (existing.granted) return true;
    if (!existing.canAskAgain) return false;
    // Asking again every launch is how an app teaches people to tap Deny, so
    // this only prompts when the answer is not already on record.
    const asked = await Notifications.requestPermissionsAsync();
    return asked.granted;
  } catch {
    return false;
  }
}

export async function registerForPush() {
  // The emulator and the web build have no push service to register with.
  if (!Device.isDevice) return { token: null, reason: 'Alerts need a real phone, not a simulator.' };
  if (Platform.OS === 'web') return { token: null, reason: 'Alerts are only available in the app.' };

  try {
    if (!(await ensureNotificationPermission())) {
      return { token: null, reason: 'Alerts are switched off for this app in your phone settings.' };
    }

    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
    if (!projectId) return { token: null, reason: 'This build has no Expo project id.' };

    let token;
    try {
      ({ data: token } = await Notifications.getExpoPushTokenAsync({ projectId }));
    } catch (err) {
      // An installed Android app reaches Expo's push service through Firebase
      // Cloud Messaging, and asks for its token through it. With no FCM
      // credentials on the project that request fails here - before anything
      // is ever sent - so the only symptom is that notifications never arrive,
      // with nothing on screen to say why.
      //
      // Expo Go carries Expo's own credentials, which is exactly why this
      // works there and stops working in a built APK.
      const fcm = /firebase|fcm|default app|sender ?id|no credentials/i.test(err.message || '');
      return {
        token: null,
        needsFcm: fcm,
        reason: fcm
          ? 'This build has no Firebase credentials, so Android cannot issue a push token. '
            + 'Add FCM credentials to the Expo project and rebuild.'
          : err.message,
      };
    }

    await api.post('/api/notifications/push-token', {
      push_token: token,
      platform: Platform.OS,
      device_name: Device.deviceName || Device.modelName || null,
    });

    return { token, reason: null };
  } catch (err) {
    // Never fatal. An alert channel failing to set itself up must not stop
    // somebody booking an ambulance.
    console.warn('[push] registration failed:', err.message);
    return { token: null, reason: err.message };
  }
}

/**
 * Tells the backend to stop sending to this device.
 *
 * Called on sign-out, because a shared phone must not keep delivering the
 * previous driver's dispatch offers to whoever is holding it now.
 */
export async function unregisterPush() {
  try {
    if (!Device.isDevice || Platform.OS === 'web') return;
    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
    if (!projectId) return;

    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api.del('/api/notifications/push-token', { push_token: token });
  } catch (err) {
    // Sign-out must complete regardless.
    console.warn('[push] could not unregister:', err.message);
  }
}

/** Fires a test alert at this account's own devices. */
export const sendTestPush = () => api.post('/api/notifications/push-test', {});
