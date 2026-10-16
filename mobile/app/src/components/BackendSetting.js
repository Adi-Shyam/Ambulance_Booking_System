import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api, isBaseUrlOverridden, resetBaseUrl, setBaseUrl } from '../lib/api';
import { FONT, colors, radius, spacing, typo } from '../lib/theme';
import { Banner, Button, Field, Small } from './ui';

/**
 * Lets someone point the app at a different backend.
 *
 * A packaged APK has its address compiled in, and that address is wrong the
 * moment the laptop joins a different network - a new Wi-Fi, a phone hotspot,
 * a different lab. Without this the only remedy is rebuilding the app, so the
 * line that reports where requests go is also the place to change it.
 *
 * It lives on the sign-in screen because that is the one screen you can reach
 * when the address is wrong: nothing else in the app works until a request
 * succeeds.
 */
export default function BackendSetting({ onChange }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(api.url);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setError('');
    setBusy(true);
    try {
      const next = await setBaseUrl(value);
      setValue(next);
      setEditing(false);
      onChange?.(next);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    const next = await resetBaseUrl();
    setValue(next);
    setError('');
    setEditing(false);
    onChange?.(next);
  }

  if (!editing) {
    return (
      <Pressable onPress={() => { setValue(api.url); setEditing(true); }} style={styles.row}>
        <Small style={typo.tiny}>
          Backend: {api.url}
          {isBaseUrlOverridden() ? ' (changed)' : ''}
        </Small>
        <Text style={styles.edit}>Change</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.panel}>
      <Banner kind="error">{error}</Banner>
      <Field
        label="Backend address"
        value={value}
        onChangeText={setValue}
        placeholder="192.168.1.20:4000"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        hint="The machine running the server, and its port. http:// is assumed."
      />
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Button title="Save" onPress={save} loading={busy} style={{ flex: 1 }} />
        <Button title="Cancel" variant="ghost" onPress={() => setEditing(false)} style={{ flex: 1 }} />
      </View>
      {isBaseUrlOverridden() ? (
        <Button title="Back to the built-in address" variant="ghost" onPress={reset} style={{ marginTop: spacing.sm }} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: spacing.sm,
  },
  edit: { color: colors.accent, fontSize: 12, fontFamily: FONT.bold },
  panel: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
});
