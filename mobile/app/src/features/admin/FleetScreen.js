import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../../lib/api';
import { useResync, useSocketEvent } from '../../lib/socket';
import { FONT, colors, radius, relative, spacing, typo } from '../../lib/theme';
import { Banner, Body, Card, EmptyState, H2, Loading, Pill, Small } from '../../components/ui';
import MapPanel from '../../components/MapPanel';

/**
 * F.13 - the live fleet.
 *
 * Colour carries the same meaning as the matcher's own rule: green is an
 * ambulance dispatch would actually consider, blue is on a trip, grey is off
 * duty. Positions move as GPS pings arrive, without a refresh.
 */
const TONE = {
  AVAILABLE: colors.ok,
  BUSY: colors.info,
  OFFLINE: colors.muted,
};

export default function FleetScreen({ navigation }) {
  const [fleet, setFleet] = useState([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const r = await api.get('/api/admin/fleet');
      setFleet(r.fleet);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useResync(load, [load]);
  useSocketEvent('admin:provider:update', load, [load]);

  // A position ping moves one marker; patch it in place rather than refetching
  // the whole fleet on every GPS update from every vehicle.
  useSocketEvent('admin:trip:location', (p) => {
    setFleet((prev) =>
      prev.map((v) =>
        v.provider_id === p.provider_id
          ? { ...v, latitude: p.latitude, longitude: p.longitude, last_seen_timestamp: p.gps_timestamp }
          : v
      )
    );
  }, []);

  if (loading) return <Loading text="Locating the fleet…" />;

  const shown = filter ? fleet.filter((v) => v.availability_status === filter) : fleet;
  const counts = fleet.reduce((acc, v) => ({ ...acc, [v.availability_status]: (acc[v.availability_status] || 0) + 1 }), {});

  const markers = shown
    .filter((v) => v.latitude != null)
    .map((v) => ({
      latitude: v.latitude,
      longitude: v.longitude,
      color: TONE[v.availability_status] || colors.muted,
      label: `${v.vehicle_reg_no} · ${v.availability_status}`,
      radius: 10,
    }));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl * 2 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.accent} />}
    >
      <Banner kind="error">{error}</Banner>

      <Card>
        {markers.length > 0 ? (
          <MapPanel markers={markers} height={300} />
        ) : (
          <EmptyState icon="🗺️" title="No positions reported" hint="An ambulance appears here once its app reports a location." />
        )}
        <View style={styles.legend}>
          {['AVAILABLE', 'BUSY', 'OFFLINE'].map((s) => (
            <View key={s} style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: TONE[s] }]} />
              <Small style={typo.tiny}>{s} ({counts[s] || 0})</Small>
            </View>
          ))}
        </View>
      </Card>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {[{ key: '', label: `All (${fleet.length})` }, ...['AVAILABLE', 'BUSY', 'OFFLINE'].map((s) => ({ key: s, label: `${s} (${counts[s] || 0})` }))].map((c) => (
            <Pressable key={c.key || 'all'} onPress={() => setFilter(c.key)} style={[styles.chip, filter === c.key && styles.chipOn]}>
              <Text style={{ color: filter === c.key ? colors.white : colors.muted, fontSize: 12.5, fontFamily: FONT.semibold }}>
                {c.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      {shown.map((v) => (
        <Pressable key={v.provider_id} onPress={() => navigation.navigate('Providers', { screen: 'AdminProviderDetail', params: { providerId: v.provider_id } })}>
          <Card>
            <View style={styles.head}>
              <Body style={{ fontFamily: FONT.bold }}>{v.vehicle_reg_no}</Body>
              <Pill label={v.availability_status} />
            </View>
            <Small style={{ marginTop: 2 }}>{v.driver_name} · {v.ambulance_type}</Small>
            <Small style={typo.tiny}>
              {v.latitude != null ? `${v.latitude.toFixed(4)}, ${v.longitude.toFixed(4)} · ` : ''}
              reported {v.last_seen_timestamp ? relative(v.last_seen_timestamp) : 'never'}
            </Small>
            {v.active_booking_id ? (
              <Small style={{ color: colors.info, marginTop: 4 }}>On {v.active_booking_id}</Small>
            ) : null}
          </Card>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  legend: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 9, height: 9, borderRadius: 5 },
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
