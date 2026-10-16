import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useResync, useSocketEvent } from '../../lib/socket';
import { confirmAction } from '../../lib/confirm';
import { colors, dateTimeOf, money, spacing } from '../../lib/theme';
import { Banner, Button, Card, H2, Loading, Pill, Row, Small } from '../../components/ui';
import NotificationInbox from '../../components/NotificationInbox';
import AlertSettings from '../../components/AlertSettings';
import AboutPanel from '../../components/AboutPanel';

/** The vehicle record in D2, its verification state, and the way out. */
export default function ProfileScreen() {
  const { user, refreshProvider, signOut } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setData(await api.get('/api/provider/me'));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useResync(load, [load]);

  useSocketEvent('provider:verification', () => {
    refreshProvider().catch(() => {});
    load();
  }, [load]);

  useSocketEvent('rating:new', () => load(), [load]);

  if (loading) return <Loading text="Loading your profile…" />;

  const provider = data?.provider;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl * 2 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.accent} />}
    >
      <Banner kind="error">{error}</Banner>

      <Card>
        <H2>{user?.full_name}</H2>
        <Small style={{ marginTop: 2, marginBottom: spacing.md }}>{user?.phone_no}</Small>
        <Row label="Account type" value={user?.role_code === 'ORG' ? 'Organisation' : 'Driver'} />
        {user?.email_id ? <Row label="Email" value={user.email_id} /> : null}
        <Row label="Registered" value={user?.registration_date} />
      </Card>

      {provider ? (
        <Card>
          <View style={styles.headRow}>
            <H2>Ambulance</H2>
            <Pill label={provider.verification_status} />
          </View>
          <View style={{ marginTop: spacing.sm }}>
            <Row label="Vehicle" value={provider.vehicle_reg_no} />
            <Row label="Type" value={provider.ambulance_type} />
            <Row label="Availability" value={provider.availability_status} />
            <Row label="Rating" value={provider.rating_count > 0 ? `${provider.rating} ★ (${provider.rating_count})` : 'Not rated yet'} />
            <Row label="Trips completed" value={provider.trips_completed} />
            {provider.licence_no ? <Row label="Licence" value={provider.licence_no} /> : null}
            <Row label="Last reported" value={provider.last_seen_timestamp ? dateTimeOf(provider.last_seen_timestamp) : 'never'} />
          </View>
          {provider.remarks ? <Banner kind="warn">Control room note: {provider.remarks}</Banner> : null}
        </Card>
      ) : null}

      {data?.organisation ? (
        <Card>
          <View style={styles.headRow}>
            <H2>Organisation</H2>
            <Pill label={data.organisation.verification_status} />
          </View>
          <View style={{ marginTop: spacing.sm }}>
            <Row label="Name" value={data.organisation.org_name} />
            <Row label="Contact" value={data.organisation.contact_phone} />
            {data.organisation.address_text ? <Row label="Address" value={data.organisation.address_text} /> : null}
          </View>
        </Card>
      ) : null}

      {data?.stats ? (
        <Card>
          <H2>Lifetime</H2>
          <View style={{ marginTop: spacing.sm }}>
            <Row label="Requests assigned" value={data.stats.trips} />
            <Row label="Completed" value={data.stats.completed} />
            <Row label="Settled earnings" value={money(data.stats.earnings_total)} />
          </View>
        </Card>
      ) : null}

      <AlertSettings title="Dispatch alerts" />


      <NotificationInbox title="Notifications" />

      <AboutPanel />

      <Button
        title="Sign out"
        variant="ghost"
        onPress={() =>
          confirmAction(
            {
              title: 'Sign out?',
              message: 'You will stop receiving requests on this device.',
              confirmLabel: 'Sign out',
              destructive: true,
            },
            signOut
          )
        }
      />

      <Small style={{ textAlign: 'center', marginTop: spacing.md }}>Backend: {api.url}</Small>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
