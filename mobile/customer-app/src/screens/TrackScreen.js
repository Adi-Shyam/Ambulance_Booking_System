import { useCallback, useEffect, useState } from 'react';
import { Linking, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../lib/api';
import { getSocket, useResync, useSocketEvent } from '../lib/socket';
import { MILESTONE_STEPS } from '../lib/config';
import { confirmAction } from '../lib/confirm';
import { STATUS_TEXT, colors, dateTimeOf, money, radius, spacing, typo } from '../lib/theme';
import { Banner, Body, Button, Card, EmptyState, H2, Loading, Pill, Row, Small, StepTrail } from '../components/ui';
import MapPanel from '../components/MapPanel';

// F.8 Live tracking and ETA, F.9 trip status updates reflected in real time.
export default function TrackScreen({ navigation }) {
  const [booking, setBooking] = useState(null);
  const [track, setTrack] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);

  const loadActive = useCallback(async () => {
    setError('');
    try {
      const r = await api.get('/api/bookings/active');
      setBooking(r.booking);
      if (r.booking && ['ASSIGNED', 'ENROUTE', 'ARRIVED', 'ONBOARD'].includes(r.booking.booking_status)) {
        const t = await api.get(`/api/bookings/${r.booking.booking_id}/track`);
        setTrack(t);
      } else {
        setTrack(null);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadActive(); }, [loadActive]));
  useResync(loadActive, [loadActive]);

  // Join the booking room so updates arrive without polling.
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !booking) return undefined;
    socket.emit('booking:subscribe', booking.booking_id);
    return () => socket.emit('booking:unsubscribe', booking.booking_id);
  }, [booking?.booking_id]);

  useSocketEvent('booking:update', (b) => {
    setBooking(b);
    if (['ASSIGNED', 'ENROUTE', 'ARRIVED', 'ONBOARD'].includes(b.booking_status)) loadActive();
  }, [loadActive]);

  // Each GPS ping from the driver arrives here (F.8).
  useSocketEvent('trip:location', (p) => {
    setTrack((prev) =>
      prev
        ? {
            ...prev,
            ambulance_location: { latitude: p.latitude, longitude: p.longitude, gps_timestamp: p.gps_timestamp },
            trip: { ...prev.trip, eta_minutes: p.eta_minutes, route_distance_km: p.route_distance_km },
          }
        : prev
    );
  }, []);

  useSocketEvent('trip:status', () => loadActive(), [loadActive]);

  async function cancel() {
    setCancelling(true);
    try {
      await api.post(`/api/bookings/${booking.booking_id}/cancel`, { reason: 'Cancelled by patient' });
      await loadActive();
    } catch (e) {
      setError(e.message);
    } finally {
      setCancelling(false);
    }
  }

  if (loading) return <Loading text="Loading your request…" />;

  if (!booking) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <EmptyState
          icon="🚑"
          title="No active request"
          hint="When you book an ambulance, its live position and ETA appear here."
        />
        <View style={{ padding: spacing.lg }}>
          <Button title="Book an ambulance" onPress={() => navigation.navigate('Book')} />
        </View>
      </View>
    );
  }

  const searching = ['REQUESTED', 'MATCHING'].includes(booking.booking_status);
  const finished = ['COMPLETED', 'CANCELLED', 'FAILED'].includes(booking.booking_status);
  const currentIndex = MILESTONE_STEPS.findIndex((s) => s.code === (booking.trip?.trip_milestone || 'ASSIGNED'));

  const markers = [
    { latitude: booking.latitude, longitude: booking.longitude, color: colors.accent, label: 'Pickup', radius: 11 },
    ...(track?.ambulance_location
      ? [{ ...track.ambulance_location, color: colors.ok, label: 'Ambulance', radius: 11 }]
      : []),
  ];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl * 2 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={loadActive} tintColor={colors.accent} />}
    >
      <Banner kind="error">{error}</Banner>

      {/* -------------------------------------------------- status header */}
      <Card style={searching ? { borderColor: colors.warn } : undefined}>
        <View style={styles.headRow}>
          <Pill label={booking.booking_status} />
          <Small style={typo.tiny}>{booking.booking_id}</Small>
        </View>

        <H2 style={{ marginTop: spacing.sm }}>
          {STATUS_TEXT[booking.booking_status] || booking.booking_status}
        </H2>

        {searching ? (
          <Small style={{ marginTop: 6 }}>
            We are alerting the nearest {booking.ambulance_type} ambulances one by one. Each has
            45 seconds to respond before the request moves on.
            {booking.retry_count > 0 ? ` Attempt ${booking.retry_count}.` : ''}
          </Small>
        ) : track?.trip?.eta_minutes != null && !finished ? (
          <View style={styles.etaBox}>
            <Text style={styles.etaValue}>{track.trip.eta_minutes}</Text>
            <View>
              <Body style={{ fontWeight: '700' }}>minutes away</Body>
              <Small>
                {track.trip.route_distance_km != null ? `${track.trip.route_distance_km} km by road` : ''}
              </Small>
            </View>
          </View>
        ) : null}

        {booking.booking_status === 'FAILED' ? (
          <Banner kind="error">
            {booking.cancelled_reason || 'No ambulance could be assigned.'} Please try again, or call 108.
          </Banner>
        ) : null}
      </Card>

      {/* -------------------------------------------------------- the map */}
      {!finished ? (
        <Card>
          <MapPanel markers={markers} route={track?.route_points || []} height={280} />
          <Small style={{ marginTop: spacing.sm }}>
            Red pin is your pickup point. Green marker is the ambulance
            {track?.ambulance_location?.gps_timestamp
              ? `, last reported ${dateTimeOf(track.ambulance_location.gps_timestamp)}`
              : ''}.
          </Small>
        </Card>
      ) : null}

      {/* ------------------------------------------------ driver contact */}
      {booking.provider ? (
        <Card>
          <H2>Your ambulance</H2>
          <View style={{ marginTop: spacing.sm }}>
            <Row label="Driver" value={booking.provider.driver_name} />
            <Row label="Vehicle" value={booking.provider.vehicle_reg_no} />
            <Row label="Type" value={booking.provider.ambulance_type} />
            <Row label="Rating" value={`${booking.provider.rating} ★`} />
          </View>
          <Button
            title={`Call ${booking.provider.phone_no}`}
            icon="📞"
            variant="secondary"
            style={{ marginTop: spacing.md }}
            onPress={() => Linking.openURL(`tel:${booking.provider.phone_no}`)}
          />
        </Card>
      ) : null}

      {/* ------------------------------------------------ F.9 milestones */}
      {booking.trip ? (
        <Card>
          <H2>Trip progress</H2>
          <View style={{ marginTop: spacing.md }}>
            <StepTrail steps={MILESTONE_STEPS} currentIndex={Math.max(0, currentIndex)} />
          </View>
        </Card>
      ) : null}

      {/* ------------------------------------------------------ request */}
      <Card>
        <H2>Request details</H2>
        <View style={{ marginTop: spacing.sm }}>
          <Row label="Ambulance type" value={booking.ambulance_type} />
          <Row label="Pickup" value={booking.address_text || `${booking.latitude}, ${booking.longitude}`} />
          {booking.landmark ? <Row label="Landmark" value={booking.landmark} /> : null}
          {booking.patient_name ? <Row label="Patient" value={booking.patient_name} /> : null}
          {booking.notes ? <Row label="Notes" value={booking.notes} /> : null}
          <Row label="Placed at" value={dateTimeOf(booking.booking_timestamp)} />
          {booking.response_time_sec != null ? (
            <Row label="Accepted in" value={`${booking.response_time_sec} s`} />
          ) : null}
        </View>
      </Card>

      {/* ------------------------------------------------------- actions */}
      {!finished && booking.booking_status !== 'ONBOARD' ? (
        <Button
          title="Cancel this request"
          variant="ghost"
          loading={cancelling}
          onPress={() =>
            confirmAction(
              {
                title: 'Cancel request?',
                message: 'The assigned ambulance will be released.',
                confirmLabel: 'Cancel request',
                cancelLabel: 'Keep it',
                destructive: true,
              },
              cancel
            )
          }
        />
      ) : null}

      {booking.booking_status === 'COMPLETED' ? (
        <Button
          title="View invoice and rate the trip"
          onPress={() => navigation.navigate('History', { screen: 'BookingDetail', params: { bookingId: booking.booking_id } })}
        />
      ) : null}

      {booking.booking_status === 'FAILED' ? (
        <Button title="Try again" onPress={() => navigation.navigate('Book')} />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  etaBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.bg,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
  },
  etaValue: { fontSize: 44, fontWeight: '800', color: colors.ok, lineHeight: 48 },
});
