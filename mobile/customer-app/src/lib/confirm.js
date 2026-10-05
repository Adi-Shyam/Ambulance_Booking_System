import { Alert, Platform } from 'react-native';

/**
 * Cross-platform confirmation prompt.
 *
 * `Alert.alert` is native-only — under react-native-web it does nothing, which
 * would silently swallow the confirmation step and make the action unreachable.
 * On web we fall back to the browser's own dialog so the same call site works
 * on a phone and in a browser.
 */
export function confirmAction({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', destructive = false }, onConfirm) {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    if (window.confirm(message ? `${title}\n\n${message}` : title)) onConfirm();
    return;
  }

  Alert.alert(title, message, [
    { text: cancelLabel, style: 'cancel' },
    { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: onConfirm },
  ]);
}

/** Informational message, equally usable on both targets. */
export function notify(title, message) {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    window.alert(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}
