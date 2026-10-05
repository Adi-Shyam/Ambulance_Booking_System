import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useSocketEvent } from '../../lib/socket';
import { confirmAction } from '../../lib/confirm';
import { colors, dateTimeOf, relative, spacing, typo } from '../../lib/theme';
import { Banner, Body, Button, Card, Field, H2, Pill, Row, Small } from '../../components/ui';

// Profile, plus the in-app notification inbox required by F.14.
export default function ProfileScreen() {
  const { user, signOut, refresh } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ full_name: user?.full_name || '', email_id: user?.email_id || '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api
      .get('/api/notifications')
      .then((r) => setNotifications(r.notifications))
      .catch((e) => setError(e.message));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useSocketEvent('notification', (n) => setNotifications((prev) => [n, ...prev]), []);

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

  async function markAllRead() {
    await api.post('/api/notifications/read', {}).catch(() => {});
    load();
  }

  const unread = notifications.filter((n) => !n.read_flag).length;

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

      <Card>
        <View style={styles.headRow}>
          <H2>Notifications</H2>
          {unread > 0 ? <Pill label={`${unread} new`} tone={colors.accent} /> : null}
        </View>

        {notifications.length === 0 ? (
          <Small style={{ marginTop: spacing.sm }}>No notifications yet.</Small>
        ) : (
          <>
            {notifications.slice(0, 25).map((n) => (
              <View key={n.id} style={[styles.notif, !n.read_flag && { borderLeftColor: colors.accent }]}>
                <Body style={{ fontWeight: '600' }}>{n.title}</Body>
                {n.body ? <Small style={{ marginTop: 2 }}>{n.body}</Small> : null}
                <Text style={[typo.tiny, { marginTop: 4 }]}>{relative(n.created_at)}</Text>
              </View>
            ))}
            {unread > 0 ? (
              <Button title="Mark all as read" variant="ghost" onPress={markAllRead} style={{ marginTop: spacing.sm }} />
            ) : null}
          </>
        )}
      </Card>

      <Card>
        <H2>About</H2>
        <View style={{ marginTop: spacing.sm }}>
          <Row label="Backend" value={api.url} />
          <Row label="App" value="Patient app v1.0.0" />
        </View>
        <Small style={{ marginTop: spacing.sm }}>
          Ambulance Booking System · Team 16 · Department of Information Technology, NITK Surathkal
        </Small>
      </Card>

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
