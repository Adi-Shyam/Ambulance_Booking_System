import { useCallback, useState } from 'react';
import { Alert, Linking, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { callCounterparty } from '../../lib/calling';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../../lib/api';
import { useResync, useSocketEvent } from '../../lib/socket';
import { confirmAction } from '../../lib/confirm';
import { DRIVER_MILESTONES } from '../../lib/config';
import { colors, dateTimeOf, money, spacing } from '../../lib/theme';
import { Banner, Button, Card, EmptyState, H2, Loading, Pill, Row, Small, StepTrail } from '../../components/ui';
import MapPanel from '../../components/MapPanel';

/**
 * F.9 - the trip itself.
 *
 * The milestone order is fixed and the server accepts only one step forward at a
 * time, so this screen deliberately offers exactly one action: the next step.
 * Nothing here reports a distance - the fare is measured server-side from the
 * GPS trace, because the device being paid must not be the one stating the
 * amount (F.10).
 */
export default function TripScreen({ navigation }) {
  const [trip, setTrip] = useState(null);
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const r = await api.get('/api/provider/trips/active');
      setTrip(r.trip);
      if (!r.trip) setInvoice(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useResync(load, [load]);

  // The driver's own pings come back as this event, so their marker follows
  // them without the screen being reloaded - the same stream the patient is
  // watching, read from the other end.
  useSocketEvent('trip:location', (p) => {
    setTrip((prev) => (prev ? {
      ...prev,
      ambulance_location: { latitude: p.latitude, longitude: p.longitude },
      eta_minutes: p.eta_minutes ?? prev.eta_minutes,
      route_points: p.route_points?.length ? p.route_points : prev.route_points,
    } : prev));
  }, []);

  useSocketEvent('booking:cancelled', ({ reason }) => {
    setError(`This booking was cancelled: ${reason}`);
    load();
  }, [load]);

  async function advance(next) {
    setError('');
    setBusy(true);
    try {
      const r = await api.post(`/api/provider/trips/${trip.trip_id}/status`, { trip_milestone: next });
      // Reload first: completing the trip clears the active trip, and the
      // reload drops any stale invoice with it. The new one is set afterwards
      // so the summary survives the very refresh that emptied the screen.
      await load();
      if (r.invoice) setInvoice(r.invoice);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading text="Loading your trip…" />;

  if (!trip) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {invoice ? (
          <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
            <Card style={{ borderColor: colors.ok }}>
              <H2>Trip completed</H2>
              <Small style={{ marginTop: 4, marginBottom: spacing.md }}>
                The invoice below was raised from the distance measured while the
                patient was on board.
              </Small>
              <Row label="Invoice" value={invoice.invoice_id} />
              <Row label="Billed distance" value={`${invoice.distance_km} km`} />
              <Row label="Base fare" value={money(invoice.base_fare)} />
              <Row label="Distance charge" value={money(invoice.distance_charge)} />
              {invoice.type_surcharge > 0 ? <Row label="Type surcharge" value={money(invoice.type_surcharge)} /> : null}
              <Row label="Tax" value={money(invoice.tax_amount)} />
              <Row label="Total" value={money(invoice.fare_amount)} valueStyle={{ color: colors.ok, fontSize: 17 }} />
              <Pill label={invoice.payment_status} />
              <Button
                title="Back to the console"
                style={{ marginTop: spacing.md }}
                onPress={() => { setInvoice(null); navigation.navigate('Duty'); }}
              />
            </Card>
          </ScrollView>
        ) : (
          <>
            <EmptyState
              icon="🛣️"
              title="No active trip"
              hint="When you accept a request it appears here, with the pickup point and the next step to tap."
            />
            <View style={{ padding: spacing.lg }}>
              <Button title="Go to the console" onPress={() => navigation.navigate('Duty')} />
            </View>
          </>
        )}
      </View>
    );
  }

  const currentIndex = DRIVER_MILESTONES.findIndex((s) => s.code === trip.trip_milestone);
  const nextStep = DRIVER_MILESTONES[currentIndex + 1] || null;
  const onboard = trip.trip_milestone === 'ONBOARD';

  // Before pickup the driver is heading to the patient; once on board, to the
  // drop point. The map should show whichever is actually next.
  const target = onboard && trip.drop_latitude != null
    ? { latitude: trip.drop_latitude, longitude: trip.drop_longitude, label: 'Drop', color: colors.info }
    : { latitude: trip.latitude, longitude: trip.longitude, label: 'Pickup', color: colors.accent };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl * 2 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.accent} />}
    >
      <Banner kind="error">{error}</Banner>

      {trip.stall_flagged_at ? (
        <Banner kind="warn">
          The control room has flagged this trip because your position stopped
          being reported. Make sure the app stays open and on duty.
        </Banner>
      ) : null}

      <Card>
        <View style={styles.headRow}>
          <Pill label={trip.booking_status} />
          <Small>{trip.booking_id}</Small>
        </View>
        <H2 style={{ marginTop: spacing.sm }}>
          {onboard ? (trip.drop_address_text || 'Drive to the hospital') : trip.address_text}
        </H2>
        {trip.landmark ? <Small style={{ marginTop: 4 }}>Landmark: {trip.landmark}</Small> : null}
      </Card>

      <Card>
        {/*
          The crew's own view of the same journey the patient is watching:
          where they are, where they are going, and the road between. A single
          marker on an empty map told them nothing they did not already know.
        */}
        <MapPanel
          markers={[
            {
              latitude: target.latitude,
              longitude: target.longitude,
              glyph: onboard ? '🏥' : '📍',
              label: target.label,
              labelAlways: true,
            },
            ...(trip.ambulance_location
              ? [{
                  ...trip.ambulance_location,
                  glyph: '🚑',
                  label: trip.eta_minutes != null ? `${trip.eta_minutes} min away` : 'You',
                  labelAlways: true,
                }]
              : []),
          ]}
          route={trip.route_points || []}
          height={260}
        />
        <Button
          title={`Navigate to ${target.label.toLowerCase()}`}
          icon="🧭"
          variant="secondary"
          style={{ marginTop: spacing.md }}
          onPress={() =>
            Linking.openURL(
              `https://www.google.com/maps/dir/?api=1&destination=${target.latitude},${target.longitude}`
            )
          }
        />
      </Card>

      {/* --------------------------------------------------- the patient */}
      <Card>
        <H2>Patient</H2>
        <View style={{ marginTop: spacing.sm }}>
          <Row label="Name" value={trip.patient?.full_name || '—'} />
          <Row label="Ambulance type" value={trip.ambulance_type} />
          {trip.notes ? <Row label="Notes" value={trip.notes} /> : null}
          <Row label="Requested" value={dateTimeOf(trip.booking_timestamp)} />
        </View>
        {/*
          The crew's own reason to call is almost always "we are outside and
          cannot see you", so this sits with the patient's details rather than
          buried under the milestone buttons.
        */}
        <Button
          title={`Call ${trip.patient?.full_name || 'the patient'}`}
          icon="📞"
          variant="secondary"
          style={{ marginTop: spacing.md }}
          onPress={() =>
            callCounterparty(trip.booking_id).catch((e) =>
              Alert.alert('Could not place the call', e.message)
            )
          }
        />
      </Card>

      {/* ------------------------------------------------- F.9 milestones */}
      <Card>
        <H2>Trip progress</H2>
        <View style={{ marginTop: spacing.md }}>
          <StepTrail steps={DRIVER_MILESTONES} currentIndex={Math.max(0, currentIndex)} />
        </View>
      </Card>

      {nextStep ? (
        <Button
          title={nextStep.action}
          variant={nextStep.code === 'COMPLETED' ? 'success' : 'primary'}
          loading={busy}
          onPress={() =>
            nextStep.code === 'COMPLETED'
              ? confirmAction(
                  {
                    title: 'Complete this trip?',
                    message: 'The invoice is raised now, from the distance driven with the patient on board.',
                    confirmLabel: 'Complete trip',
                    cancelLabel: 'Not yet',
                  },
                  () => advance(nextStep.code)
                )
              : advance(nextStep.code)
          }
        />
      ) : null}

      <Small style={{ textAlign: 'center', marginTop: spacing.md, lineHeight: 18 }}>
        Each step is sent to the patient and the control room the moment you tap it.
      </Small>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
