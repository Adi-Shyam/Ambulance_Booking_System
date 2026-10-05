import { useCallback, useState } from 'react';
import { Linking, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../../lib/api';
import { useResync, useSocketEvent } from '../../lib/socket';
import { colors, dateTimeOf, money, relative, spacing, typo } from '../../lib/theme';
import { Banner, Body, Button, Card, H2, Loading, Pill, Row, Small } from '../../components/ui';
import MapPanel from '../../components/MapPanel';

/** One provider's record: the vehicle, how it has performed, and where it is. */
export default function ProviderDetailScreen({ route }) {
  const { providerId } = route.params;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setData(await api.get(`/api/admin/providers/${providerId}`));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [providerId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useResync(load, [load]);
  useSocketEvent('admin:provider:update', load, [load]);

  if (loading) return <Loading text="Loading provider…" />;
  if (!data) return <Banner kind="error">{error || 'Not found'}</Banner>;

  const p = data.provider;
  const stats = Object.fromEntries((data.offer_stats || []).map((s) => [s.assignment_status, s.n]));
  const offered = (stats.ACCEPTED || 0) + (stats.REJECTED || 0) + (stats.TIMEOUT || 0);
  const acceptRate = offered > 0 ? Math.round(((stats.ACCEPTED || 0) / offered) * 100) : null;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl * 2 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.accent} />}
    >
      <Banner kind="error">{error}</Banner>

      <Card>
        <View style={styles.head}>
          <H2>{p.full_name}</H2>
          <Pill label={p.verification_status} />
        </View>
        <Small style={{ marginTop: 2 }}>{p.phone_no}</Small>
        <View style={{ marginTop: spacing.sm }}>
          <Row label="Provider id" value={p.provider_id} />
          <Row label="Vehicle" value={`${p.vehicle_reg_no} · ${p.ambulance_type}`} />
          <Row label="Duty" value={p.availability_status} />
          {p.licence_no ? <Row label="Licence" value={p.licence_no} /> : null}
          <Row label="Rating" value={p.rating_count > 0 ? `${p.rating} ★ (${p.rating_count})` : 'not rated'} />
          <Row label="Trips completed" value={p.trips_completed} />
          <Row label="Last reported" value={p.last_seen_timestamp ? relative(p.last_seen_timestamp) : 'never'} />
        </View>
        {p.remarks ? <Banner kind="warn">Control room note: {p.remarks}</Banner> : null}
        <Button
          title={`Call ${p.phone_no}`}
          icon="📞"
          variant="secondary"
          style={{ marginTop: spacing.md }}
          onPress={() => Linking.openURL(`tel:${p.phone_no}`)}
        />
      </Card>

      {p.latitude != null ? (
        <Card>
          <H2>Last known position</H2>
          <View style={{ marginTop: spacing.sm }}>
            <MapPanel
              markers={[{
                latitude: p.latitude,
                longitude: p.longitude,
                color: p.availability_status === 'AVAILABLE' ? colors.ok : colors.muted,
                label: p.vehicle_reg_no,
                radius: 11,
              }]}
              height={200}
            />
          </View>
          <Small style={{ marginTop: spacing.sm }}>
            {p.latitude.toFixed(5)}, {p.longitude.toFixed(5)} · {relative(p.last_seen_timestamp)}
          </Small>
        </Card>
      ) : null}

      {/* -------------------------------------------- F.7 responsiveness */}
      <Card>
        <H2>Offer response</H2>
        <Small style={{ marginTop: 2, marginBottom: spacing.sm }}>
          How this ambulance answers when dispatch picks it.
        </Small>
        <Row label="Accepted" value={stats.ACCEPTED || 0} valueStyle={{ color: colors.ok }} />
        <Row label="Declined" value={stats.REJECTED || 0} valueStyle={{ color: colors.warn }} />
        <Row label="Timed out" value={stats.TIMEOUT || 0} valueStyle={{ color: colors.accent }} />
        {stats.OFFERED ? <Row label="Outstanding" value={stats.OFFERED} /> : null}
        {acceptRate != null ? (
          <Row
            label="Acceptance rate"
            value={`${acceptRate}%`}
            valueStyle={{ color: acceptRate >= 70 ? colors.ok : colors.warn, fontSize: 17 }}
          />
        ) : null}
      </Card>

      <Card>
        <H2>Trips</H2>
        {data.trips.length === 0 ? (
          <Small style={{ marginTop: spacing.sm }}>No requests assigned yet.</Small>
        ) : (
          data.trips.map((t) => (
            <View key={t.booking_id} style={styles.listRow}>
              <View style={styles.head}>
                <Pill label={t.booking_status} />
                <Small style={typo.tiny}>{t.booking_id}</Small>
              </View>
              <View style={{ marginTop: 4 }}>
                <Row label="When" value={dateTimeOf(t.booking_timestamp)} />
                <Row label="Type" value={t.ambulance_type} />
                {t.response_time_sec != null ? <Row label="Matched in" value={`${t.response_time_sec} s`} /> : null}
                {t.fare_amount != null ? (
                  <Row
                    label={`Fare (${t.payment_status || 'PENDING'})`}
                    value={money(t.fare_amount)}
                    valueStyle={{ color: t.payment_status === 'SUCCESS' ? colors.ok : colors.warn }}
                  />
                ) : null}
                {t.rating_value ? <Row label="Rating" value={`${t.rating_value} ★`} /> : null}
                {t.feedback_text ? <Row label="Feedback" value={t.feedback_text} /> : null}
              </View>
            </View>
          ))
        )}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  listRow: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.sm, marginTop: spacing.sm },
});
