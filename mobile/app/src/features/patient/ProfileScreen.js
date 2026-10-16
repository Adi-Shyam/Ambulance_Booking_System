import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { confirmAction } from '../../lib/confirm';
import { colors, dateTimeOf, spacing } from '../../lib/theme';
import { Banner, Body, Button, Card, Field, H2, Pill, Row, Small } from '../../components/ui';
import NotificationInbox from '../../components/NotificationInbox';
import AlertSettings from '../../components/AlertSettings';
import AboutPanel from '../../components/AboutPanel';

// The patient's own account. The notification inbox (F.14) is shared with the
// driver and control-room screens rather than duplicated here.
export default function ProfileScreen() {
  const { user, signOut, refresh } = useAuth();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ full_name: user?.full_name || '', email_id: user?.email_id || '' });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError('');
    try {
      await api.patch('/api/auth/me', form);
      await refresh();
      setNotice('Profile updated');
      setEditing(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl * 2 }}
    >
      <Banner kind="error">{error}</Banner>
      <Banner kind="ok">{notice}</Banner>

      <Card>
        <View style={styles.avatarRow}>
          <View style={styles.avatar}>
            <Text style={{ fontSize: 24 }}>{(user?.full_name || '?').charAt(0).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <H2>{user?.full_name}</H2>
            <Small>{user?.phone_no}</Small>
          </View>
          <Pill label={user?.verification_status} />
        </View>

        {editing ? (
          <View style={{ marginTop: spacing.md }}>
            <Field
              label="Full name"
              value={form.full_name}
              onChangeText={(v) => setForm({ ...form, full_name: v })}
            />
            <Field
              label="Email"
              value={form.email_id}
              onChangeText={(v) => setForm({ ...form, email_id: v })}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <Button title="Save" onPress={save} loading={saving} />
            <Button title="Cancel" variant="ghost" onPress={() => setEditing(false)} style={{ marginTop: spacing.sm }} />
          </View>
        ) : (
          <View style={{ marginTop: spacing.md }}>
            <Row label="Email" value={user?.email_id || 'Not set'} />
            <Row label="Role" value="Patient" />
            <Row label="Member since" value={user?.registration_date} />
            <Button
              title="Edit profile"
              variant="secondary"
              style={{ marginTop: spacing.md }}
              onPress={() => {
                setForm({ full_name: user.full_name, email_id: user.email_id || '' });
                setEditing(true);
              }}
            />
          </View>
        )}
      </Card>

      <AlertSettings title="Alerts" />

      <NotificationInbox title="Notifications" />

      <AboutPanel />

      <Button
        title="Sign out"
        variant="ghost"
        onPress={() =>
          confirmAction(
            {
              title: 'Sign out?',
              message: 'You will need to sign in again to book an ambulance.',
              confirmLabel: 'Sign out',
              cancelLabel: 'Stay',
              destructive: true,
            },
            signOut
          )
        }
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.line,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  notif: {
    borderLeftWidth: 3,
    borderLeftColor: colors.line,
    paddingLeft: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
  },
});
