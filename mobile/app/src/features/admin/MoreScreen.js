import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import { confirmAction } from '../../lib/confirm';
import { FONT, colors, radius, spacing } from '../../lib/theme';
import { Body, Button, Card, H2, Small } from '../../components/ui';
import NotificationInbox from '../../components/NotificationInbox';
import AlertSettings from '../../components/AlertSettings';
import AboutPanel from '../../components/AboutPanel';

/**
 * The control room has more screens than a phone has room for tabs, so the
 * analytical and archival ones live one level down from here. On a wide screen
 * they are all still one tap away.
 */
const ITEMS = [
  { route: 'AdminReports', icon: '📊', title: 'Reports', hint: 'Response time, demand, revenue, provider performance' },
  { route: 'AdminMessages', icon: '📨', title: 'Alert log', hint: 'Every WhatsApp and SMS the system sent' },
  { route: 'AdminAudit', icon: '📜', title: 'Audit trail', hint: 'Every decision and action, in order' },
  { route: 'AdminUsers', icon: '👤', title: 'Accounts', hint: 'Patients, drivers and organisations' },
];

export default function MoreScreen({ navigation }) {
  const { user, signOut } = useAuth();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl * 2 }}
    >
      <Card>
        <H2>{user?.full_name}</H2>
        <Small style={{ marginTop: 2 }}>{user?.phone_no} · control room</Small>
      </Card>

      {ITEMS.map((it) => (
        <Pressable key={it.route} onPress={() => navigation.navigate(it.route)} style={styles.item}>
          <Text style={{ fontSize: 24 }}>{it.icon}</Text>
          <View style={{ flex: 1 }}>
            <Body style={{ fontFamily: FONT.bold }}>{it.title}</Body>
            <Small>{it.hint}</Small>
          </View>
          <Text style={{ color: colors.muted, fontSize: 20 }}>›</Text>
        </Pressable>
      ))}

      <AlertSettings title="Alerts" />

      <NotificationInbox title="Control room notifications" />

      <AboutPanel />

      <Button
        title="Sign out"
        variant="ghost"
        style={{ marginTop: spacing.lg }}
        onPress={() =>
          confirmAction(
            { title: 'Sign out?', message: 'You will need to sign in again.', confirmLabel: 'Sign out', destructive: true },
            signOut
          )
        }
      />

      <Small style={{ textAlign: 'center', marginTop: spacing.md }}>Backend: {api.url}</Small>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
  },
});
