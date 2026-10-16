import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../lib/api';
import { useResync, useSocketEvent } from '../lib/socket';
import { FONT, colors, radius, relative, spacing, typo } from '../lib/theme';
import { Body, Button, Card, H2, Small } from './ui';

/**
 * F.14 - the in-app notification inbox.
 *
 * `/api/notifications` is scoped to whoever holds the token, so one component
 * serves all three roles. The backend already writes for every one of them —
 * a driver is told when their profile is verified, when the recovery sweep
 * takes them off duty and when a fare settles; the control room is told about
 * its own actions — but only the patient ever had a screen to read them on.
 */
export default function NotificationInbox({ title = 'Notifications', limit = 25 }) {
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);

  const load = useCallback(() => {
    api
      .get('/api/notifications')
      .then((r) => {
        setNotifications(r.notifications);
        setUnread(r.unread);
      })
      .catch(() => {});
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useResync(load, [load]);

  // Arrives over the same socket that carries dispatch, so the inbox fills
  // without the screen being reopened.
  useSocketEvent('notification', (n) => {
    setNotifications((prev) => [n, ...prev]);
    setUnread((u) => u + 1);
  }, []);

  async function markAllRead() {
    setUnread(0);
    setNotifications((prev) => prev.map((n) => ({ ...n, read_flag: 1 })));
    await api.post('/api/notifications/read', {}).catch(() => {});
  }

  return (
    <Card>
      <View style={styles.head}>
        <H2>{title}</H2>
        {unread > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unread}</Text>
          </View>
        ) : null}
      </View>

      {notifications.length === 0 ? (
        <Small style={{ marginTop: spacing.sm }}>No notifications yet.</Small>
      ) : (
        <>
          {notifications.slice(0, limit).map((n) => (
            <View key={n.id} style={[styles.notif, !n.read_flag && { borderLeftColor: colors.accent }]}>
              <Body style={{ fontFamily: FONT.semibold }}>{n.title}</Body>
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
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: {
    minWidth: 24,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
  },
  badgeText: { color: colors.white, fontSize: 12, fontFamily: FONT.bold },
  notif: {
    borderLeftWidth: 3,
    borderLeftColor: colors.line,
    paddingLeft: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
  },
});
