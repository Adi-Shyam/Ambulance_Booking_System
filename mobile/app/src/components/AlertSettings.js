import { useCallback, useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { registerForPush, sendTestPush } from '../lib/push';
import { colors, spacing } from '../lib/theme';
import { Banner, Button, Card, H2, Small } from './ui';

/**
 * F.14 - lets someone confirm that alerts will actually reach them.
 *
 * This matters most to a driver. A dispatch offer expires in 45 seconds, and
 * the way that goes wrong is silent: notifications were declined months ago,
 * nothing appears to be broken, and offers simply never arrive. Finding that
 * out from a test button beats finding it out from a missed emergency.
 */
export default function AlertSettings({ title = 'Alerts' }) {
  // Whether this is a browser or a simulator is a static fact, not something
  // to discover in an effect. Deciding it up front stops the panel offering
  // "Turn alerts on" for a second on a platform that has no alerts to turn on.
  const [status, setStatus] = useState(
    Platform.OS === 'web' ? 'web' : Device.isDevice ? null : 'simulator'
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const check = useCallback(async () => {
    if (Platform.OS === 'web' || !Device.isDevice) return;
    try {
      const { status: s } = await Notifications.getPermissionsAsync();
      setStatus(s);
    } catch {
      setStatus('unknown');
    }
  }, []);

  useFocusEffect(useCallback(() => { check(); }, [check]));

  async function enable() {
    setBusy(true);
    setError('');
    setNotice('');
    const { token, reason } = await registerForPush();
    setBusy(false);
    await check();
    if (token) setNotice('This phone is registered. Try the test alert.');
    else setError(reason || 'Could not switch alerts on.');
  }

  async function test() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await sendTestPush();
      setNotice(r.message);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const granted = status === 'granted';

  return (
    <Card>
      <H2>{title}</H2>

      {status === 'web' ? (
        <Small style={{ marginTop: spacing.sm }}>
          Alerts only work in the installed app. On the web the console has to stay open.
        </Small>
      ) : status === 'simulator' ? (
        <Small style={{ marginTop: spacing.sm }}>
          Alerts need a real phone. A simulator has no push service to register with.
        </Small>
      ) : (
        <>
          <Small style={{ marginTop: spacing.sm }}>
            {granted
              ? 'This phone will be alerted even with the app closed.'
              : 'Without alerts you will only see a request while this screen is open — and a request expires in 45 seconds.'}
          </Small>

          <Banner kind="error">{error}</Banner>
          {notice ? <Banner kind="info">{notice}</Banner> : null}

          <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
            {granted ? (
              <Button title="Send a test alert" icon="🔔" variant="secondary" loading={busy} onPress={test} />
            ) : (
              <Button title="Turn alerts on" icon="🔔" loading={busy} onPress={enable} />
            )}

            {status === 'denied' ? (
              // Once denied, Android and iOS both stop the app asking again -
              // only Settings can undo it, so send them there rather than
              // offering a button that silently does nothing.
              <Button
                title="Open phone settings"
                variant="ghost"
                onPress={() => Linking.openSettings()}
              />
            ) : null}
          </View>

          {!granted && status ? (
            <Small style={{ marginTop: spacing.sm, color: colors.warn }}>
              Alerts are currently off.
            </Small>
          ) : null}
        </>
      )}
    </Card>
  );
}
