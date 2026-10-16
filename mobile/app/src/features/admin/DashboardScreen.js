import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../../lib/api';
import { useResync, useSocketEvent } from '../../lib/socket';
import { FONT, colors, money, radius, relative, spacing, typo } from '../../lib/theme';
import { Banner, Body, Card, H2, Loading, Pill, Small } from '../../components/ui';

/**
 * F.13 / DFD 0.6.2 - the control room's operational picture.
 *
 * Everything here refreshes off the admin socket feed, because a dispatcher
 * watching a wall display should never have to pull to refresh to find out a
 * request came in.
 */

function Stat({ label, value, sub, tone, wide }) {
  return (
    <View style={[styles.stat, wide && { flexBasis: '100%' }, tone && { borderColor: tone }]}>
      <Small style={typo.tiny}>{label.toUpperCase()}</Small>
      <Text style={[styles.statValue, tone && { color: tone }]}>{value}</Text>
      {sub ? <Small style={typo.tiny}>{sub}</Small> : null}
    </View>
  );
}

export default function DashboardScreen({ navigation }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setData(await api.get('/api/admin/overview'));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useResync(load, [load]);

  // The whole admin feed moves these numbers, so one handler covers all of it.
  useSocketEvent('admin:booking:new', load, [load]);
  useSocketEvent('admin:booking:update', load, [load]);
  useSocketEvent('admin:dispatch', load, [load]);
  useSocketEvent('admin:provider:update', load, [load]);
  useSocketEvent('admin:payment', load, [load]);

  if (loading) return <Loading text="Reading the control room…" />;

  const c = data?.counts || {};
  const rt = data?.response_time || {};

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl * 2 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.accent} />}
    >
      <Banner kind="error">{error}</Banner>

      <View style={styles.liveRow}>
        <View style={styles.liveDot} />
        <Small>Live · updated {relative(data?.generated_at)}</Small>
      </View>

      {/* ------------------------------------------------------ right now */}
      <View style={styles.grid}>
        <Stat
          label="Awaiting a match"
          value={c.awaiting_match ?? 0}
          sub="still being offered"
          tone={c.awaiting_match > 0 ? colors.warn : undefined}
        />
        <Stat label="Trips in progress" value={c.in_progress ?? 0} sub="assigned through on-board" />
        <Stat
          label="Ambulances free"
          value={c.providers_available ?? 0}
          sub={`${c.providers_busy ?? 0} on a trip · ${c.providers_total ?? 0} total`}
          tone={c.providers_available === 0 ? colors.accent : colors.ok}
        />
        <Stat
          label="Not reporting"
          value={c.providers_stale ?? 0}
          sub="on duty but no recent GPS"
          tone={c.providers_stale > 0 ? colors.warn : undefined}
        />
      </View>

      {/* --------------------------------------------- needs someone's eye */}
      {c.providers_pending > 0 ? (
        <Card style={{ borderColor: colors.warn }}>
          <H2>{c.providers_pending} provider account{c.providers_pending === 1 ? '' : 's'} to review</H2>
          <Small style={{ marginTop: 4 }}>
            An unverified ambulance receives no requests at all. Open Providers to verify them.
          </Small>
        </Card>
      ) : null}

      {/* ----------------------------------------------------- the numbers */}
      <Card>
        <H2>Today</H2>
        <View style={[styles.grid, { marginTop: spacing.md }]}>
          <Stat label="Bookings today" value={c.bookings_today ?? 0} sub={`${c.total_bookings ?? 0} all time`} />
          <Stat
            label="Avg response"
            value={rt.measured > 0 ? `${rt.avg_response_sec}s` : '—'}
            sub={rt.measured > 0 ? `request → acceptance, ${rt.measured} trips` : 'no matched trips yet'}
          />
          <Stat
            label="Completed"
            value={c.completed ?? 0}
            sub={`${c.failed ?? 0} unmatched · ${c.cancelled ?? 0} cancelled`}
            tone={colors.ok}
          />
          <Stat
            label="Revenue settled"
            value={money(c.revenue_settled)}
            sub={`${money(c.revenue_pending)} outstanding`}
            tone={colors.ok}
          />
        </View>
      </Card>

      {/* -------------------------------------------------------- by type */}
      {data?.by_type?.length ? (
        <Card>
          <H2>Demand by ambulance type</H2>
          <View style={{ marginTop: spacing.md }}>
            {data.by_type.map((t) => {
              const max = Math.max(1, ...data.by_type.map((x) => x.bookings));
              return (
                <View key={t.ambulance_type} style={styles.barRow}>
                  <Small style={{ width: 44 }}>{t.ambulance_type}</Small>
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { width: `${(t.bookings / max) * 100}%` }]} />
                  </View>
                  <Body style={{ width: 34, textAlign: 'right', fontSize: 13 }}>{t.bookings}</Body>
                </View>
              );
            })}
          </View>
        </Card>
      ) : null}

      {/* ----------------------------------------------- recent activity */}
      <Card>
        <H2>Recent bookings</H2>
        <View style={{ marginTop: spacing.sm }}>
          {(data?.recent_bookings || []).slice(0, 8).map((b) => (
            <Pressable
              key={b.booking_id}
              onPress={() => navigation.navigate('Bookings', { screen: 'AdminBookingDetail', params: { bookingId: b.booking_id } })}
              style={styles.recentRow}
            >
              <View style={styles.recentHead}>
                <Pill label={b.booking_status} />
                <Small style={typo.tiny}>{b.booking_id}</Small>
              </View>
              <Small numberOfLines={1} style={{ marginTop: 4 }}>
                {b.ambulance_type} · {b.address_text || `${b.latitude}, ${b.longitude}`}
              </Small>
              <Small style={typo.tiny}>{relative(b.booking_timestamp)}</Small>
            </Pressable>
          ))}
          {(data?.recent_bookings || []).length === 0 ? <Small>No bookings yet.</Small> : null}
        </View>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: spacing.md },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.ok },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stat: {
    flexGrow: 1,
    flexBasis: '46%',
    padding: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  statValue: { fontSize: 25, fontFamily: FONT.bold, color: colors.text, marginVertical: 2 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 8 },
  barTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.bg, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4, backgroundColor: colors.info },
  recentRow: { borderTopWidth: 1, borderTopColor: colors.line, paddingVertical: spacing.sm },
  recentHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
