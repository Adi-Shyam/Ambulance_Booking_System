import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../../lib/api';
import { FONT, colors, dateTimeOf, money, radius, spacing, typo } from '../../lib/theme';
import { Banner, Body, EmptyState, Loading, Pill, Small } from '../../components/ui';

// F.11 Booking history and records.
export default function HistoryScreen({ navigation }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api
      .get('/api/bookings')
      .then((r) => setRows(r.bookings))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) return <Loading text="Loading your trips…" />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {error ? <View style={{ padding: spacing.lg, paddingBottom: 0 }}><Banner kind="error">{error}</Banner></View> : null}

      <FlatList
        data={rows}
        keyExtractor={(item) => item.booking_id}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl }}
        onRefresh={load}
        refreshing={false}
        ListEmptyComponent={
          <EmptyState icon="📋" title="No trips yet" hint="Your past ambulance bookings will be listed here." />
        }
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.item, pressed && { opacity: 0.8 }]}
            onPress={() => navigation.navigate('BookingDetail', { bookingId: item.booking_id })}
          >
            <View style={styles.itemHead}>
              <Pill label={item.booking_status} />
              <Small style={typo.tiny}>{item.booking_id}</Small>
            </View>

            <Body style={{ marginTop: spacing.sm, fontFamily: FONT.semibold }} numberOfLines={2}>
              {item.address_text || `${item.latitude}, ${item.longitude}`}
            </Body>

            <View style={styles.metaRow}>
              <Text style={typo.small}>{item.ambulance_type}</Text>
              <Text style={typo.small}>·</Text>
              <Text style={typo.small}>{dateTimeOf(item.booking_timestamp)}</Text>
            </View>

            {item.provider ? (
              <Small style={{ marginTop: 4 }}>
                {item.provider.driver_name} · {item.provider.vehicle_reg_no}
              </Small>
            ) : null}
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  item: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  itemHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  metaRow: { flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' },
});
