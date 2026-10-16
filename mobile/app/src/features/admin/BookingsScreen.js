import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../../lib/api';
import { useResync, useSocketEvent } from '../../lib/socket';
import { BOOKING_STATUSES } from '../../lib/config';
import { FONT, colors, dateTimeOf, money, radius, relative, spacing, typo } from '../../lib/theme';
import { Banner, Body, Card, EmptyState, Field, Loading, Pill, Small } from '../../components/ui';

/**
 * F.13 / DFD 0.6.2 - monitor every booking.
 *
 * The dashboard this replaces showed a ten-column table. On a phone that is
 * unreadable, so each booking is a card carrying the same facts: who, what,
 * where, which ambulance, and how long it took to match.
 */
export default function BookingsScreen({ navigation }) {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const params = new URLSearchParams();
      if (status) params.set('booking_status', status);
      if (activeOnly) params.set('active', 'true');
      if (query.trim()) params.set('q', query.trim());
      const r = await api.get(`/api/admin/bookings?${params}`);
      setRows(r.bookings);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [status, activeOnly, query]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useResync(load, [load]);
  useSocketEvent('admin:booking:new', load, [load]);
  useSocketEvent('admin:booking:update', load, [load]);

  if (loading) return <Loading text="Loading bookings…" />;

  const chips = [
    { key: '', label: 'All' },
    { key: 'ACTIVE', label: 'Live' },
    ...BOOKING_STATUSES.map((s) => ({ key: s, label: s })),
  ];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl * 2 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.accent} />}
    >
      <Banner kind="error">{error}</Banner>

      <Field
        label="Search"
        value={query}
        onChangeText={setQuery}
        placeholder="Booking id, address, patient name or phone"
        autoCapitalize="none"
        onSubmitEditing={load}
        returnKeyType="search"
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {chips.map((c) => {
            const on = c.key === 'ACTIVE' ? activeOnly : !activeOnly && status === c.key;
            return (
              <Pressable
                key={c.key || 'all'}
                onPress={() => {
                  if (c.key === 'ACTIVE') { setActiveOnly(true); setStatus(''); }
                  else { setActiveOnly(false); setStatus(c.key); }
                }}
                style={[styles.chip, on && styles.chipOn]}
              >
                <Text style={{ color: on ? colors.white : colors.muted, fontSize: 12.5, fontFamily: FONT.semibold }}>
                  {c.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <Small style={{ marginBottom: spacing.sm }}>
        {rows.length} booking{rows.length === 1 ? '' : 's'}
      </Small>

      {rows.length === 0 ? (
        <EmptyState icon="🗒️" title="Nothing matches" hint="Try a different status or clear the search." />
      ) : (
        rows.map((b) => (
          <Pressable key={b.booking_id} onPress={() => navigation.navigate('AdminBookingDetail', { bookingId: b.booking_id })}>
            <Card>
              <View style={styles.head}>
                <Pill label={b.booking_status} />
                <Small style={typo.tiny}>{b.booking_id}</Small>
              </View>

              <Body style={{ marginTop: 6, fontFamily: FONT.semibold }} numberOfLines={2}>
                {b.address_text || `${b.latitude}, ${b.longitude}`}
              </Body>

              <View style={styles.metaRow}>
                <Small>{b.ambulance_type}</Small>
                <Small>·</Small>
                <Small>{b.patient_full_name || 'patient'}</Small>
                {b.response_time_sec != null ? (
                  <>
                    <Small>·</Small>
                    <Small style={{ color: colors.ok }}>matched in {b.response_time_sec}s</Small>
                  </>
                ) : null}
              </View>

              {b.provider ? (
                <Small style={{ marginTop: 4 }}>
                  {b.provider.vehicle_reg_no} · {b.provider.driver_name}
                </Small>
              ) : null}

              {b.stall_flagged_at ? (
                <Small style={{ color: colors.warn, marginTop: 4 }}>
                  Flagged — contact lost {relative(b.stall_flagged_at)}
                </Small>
              ) : null}

              <Small style={[typo.tiny, { marginTop: 6 }]}>{dateTimeOf(b.booking_timestamp)}</Small>
            </Card>
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
});
