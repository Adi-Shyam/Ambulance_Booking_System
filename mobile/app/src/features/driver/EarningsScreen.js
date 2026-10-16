import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../../lib/api';
import { useResync, useSocketEvent } from '../../lib/socket';
import { FONT, colors, dateTimeOf, money, radius, spacing, typo } from '../../lib/theme';
import { Banner, Body, Card, EmptyState, H2, Loading, Pill, Row, Small } from '../../components/ui';

/** F.11 records and the earnings side of F.10. */
export default function EarningsScreen() {
  const [summary, setSummary] = useState(null);
  const [daily, setDaily] = useState([]);
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [earnings, history] = await Promise.all([
        api.get('/api/provider/earnings'),
        api.get('/api/provider/trips?limit=50'),
      ]);
      setSummary(earnings.summary);
      setDaily(earnings.daily);
      setTrips(history.trips);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useResync(load, [load]);

  // A patient settling an invoice moves the pending figure without any action here.
  useSocketEvent('payment:update', () => load(), [load]);

  if (loading) return <Loading text="Adding up your trips…" />;

  const maxDay = Math.max(1, ...daily.map((d) => Number(d.amount) || 0));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl * 2 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.accent} />}
    >
      <Banner kind="error">{error}</Banner>

      <Card>
        <H2>Earnings</H2>
        <View style={styles.figures}>
          <View style={styles.figure}>
            <Text style={styles.figureValue}>{money(summary?.settled)}</Text>
            <Small>Settled</Small>
          </View>
          <View style={styles.figure}>
            <Text style={[styles.figureValue, { color: colors.warn }]}>{money(summary?.pending)}</Text>
            <Small>Awaiting payment</Small>
          </View>
        </View>
        <View style={{ marginTop: spacing.md }}>
          <Row label="Invoices raised" value={summary?.invoices ?? 0} />
          <Row label="Gross billed" value={money(summary?.gross)} />
        </View>
      </Card>

      {daily.length > 0 ? (
        <Card>
          <H2>Last {daily.length} day{daily.length === 1 ? '' : 's'}</H2>
          <View style={{ marginTop: spacing.md }}>
            {daily.map((d) => (
              <View key={d.day} style={styles.barRow}>
                <Small style={{ width: 78 }}>{d.day}</Small>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${((Number(d.amount) || 0) / maxDay) * 100}%` }]} />
                </View>
                <Body style={{ width: 88, textAlign: 'right', fontSize: 13 }}>{money(d.amount)}</Body>
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      <Card>
        <H2>Trip history</H2>
        {trips.length === 0 ? (
          <EmptyState icon="🗒️" title="No trips yet" hint="Completed trips and their invoices appear here." />
        ) : (
          trips.map((t) => (
            <View key={t.booking_id} style={styles.tripRow}>
              <View style={styles.tripHead}>
                <Pill label={t.booking_status} />
                <Small style={typo.tiny}>{t.booking_id}</Small>
              </View>
              <Body style={{ marginTop: 6 }} numberOfLines={2}>
                {t.address_text || `${t.latitude}, ${t.longitude}`}
              </Body>
              <View style={{ marginTop: 6 }}>
                <Row label="When" value={dateTimeOf(t.booking_timestamp)} />
                <Row label="Type" value={t.ambulance_type} />
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
  figures: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  figure: {
    flex: 1,
    padding: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
  },
  figureValue: { fontSize: 20, fontFamily: FONT.bold, color: colors.ok, marginBottom: 2 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 8 },
  barTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.bg, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4, backgroundColor: colors.ok },
  tripRow: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.md, marginTop: spacing.md },
  tripHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
