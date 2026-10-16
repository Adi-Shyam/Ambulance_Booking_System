import { useCallback, useState } from 'react';
import { Linking, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../../lib/api';
import { useResync, useSocketEvent } from '../../lib/socket';
import { confirmAction } from '../../lib/confirm';
import { FONT, colors, dateTimeOf, money, spacing, timeOf, typo } from '../../lib/theme';
import { Banner, Body, Button, Card, H2, Loading, Pill, Row, Small } from '../../components/ui';
import MapPanel from '../../components/MapPanel';

/**
 * One booking, end to end - the view an operator needs to settle a dispute
 * (constraint C.5). Every offer that was made, every position reported, the
 * invoice, the rating, and every alert that went out.
 */
export default function BookingDetailScreen({ route, navigation }) {
  const { bookingId } = route.params;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      setData(await api.get(`/api/admin/bookings/${bookingId}`));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [bookingId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useResync(load, [load]);
  useSocketEvent('admin:booking:update', load, [load]);
  useSocketEvent('admin:trip:location', load, [load]);

  async function act(path, body, label) {
    setBusy(true);
    setError('');
    try {
      await api.post(path, body);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading text="Loading booking…" />;
  if (!data) return <Banner kind="error">{error || 'Not found'}</Banner>;

  const b = data.booking;
  const ACTIVE = ['REQUESTED', 'MATCHING', 'ASSIGNED', 'ENROUTE', 'ARRIVED', 'ONBOARD'];
  const canCancel = ACTIVE.includes(b.booking_status);
  const canRedispatch = ['FAILED', 'REQUESTED', 'MATCHING'].includes(b.booking_status);

  const markers = [
    { latitude: b.latitude, longitude: b.longitude, color: colors.accent, label: 'Pickup', radius: 11 },
    ...(data.locations?.[0]
      ? [{ latitude: data.locations[0].latitude, longitude: data.locations[0].longitude, color: colors.ok, label: 'Ambulance', radius: 11 }]
      : []),
  ];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl * 2 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.accent} />}
    >
      <Banner kind="error">{error}</Banner>

      <Card>
        <View style={styles.head}>
          <Pill label={b.booking_status} />
          <Small style={typo.tiny}>{b.booking_id}</Small>
        </View>
        <H2 style={{ marginTop: spacing.sm }}>{b.address_text || `${b.latitude}, ${b.longitude}`}</H2>
        <View style={{ marginTop: spacing.sm }}>
          <Row label="Type" value={b.ambulance_type} />
          {b.landmark ? <Row label="Landmark" value={b.landmark} /> : null}
          {b.pincode ? <Row label="Pincode" value={b.pincode} /> : null}
          <Row label="Placed" value={dateTimeOf(b.booking_timestamp)} />
          {b.response_time_sec != null ? <Row label="Matched in" value={`${b.response_time_sec} s`} /> : null}
          {b.completed_at ? <Row label="Completed" value={dateTimeOf(b.completed_at)} /> : null}
          {b.cancelled_reason ? <Row label="Reason" value={b.cancelled_reason} /> : null}
          <Row label="Attempts" value={b.retry_count} />
        </View>
        {b.stall_flagged_at ? (
          <Banner kind="warn">
            Flagged by the recovery sweep at {dateTimeOf(b.stall_flagged_at)} — the crew stopped
            reporting. Not cancelled automatically; an operator decides.
          </Banner>
        ) : null}
      </Card>

      {b.latitude != null ? (
        <Card>
          <MapPanel markers={markers} height={220} />
        </Card>
      ) : null}

      {/* ------------------------------------------------------- patient */}
      <Card>
        <H2>Patient</H2>
        <View style={{ marginTop: spacing.sm }}>
          <Row label="Name" value={b.patient_name || data.patient?.full_name} />
          <Row label="Phone" value={b.contact_phone || data.patient?.phone_no} />
          {b.notes ? <Row label="Notes" value={b.notes} /> : null}
        </View>
        {(b.contact_phone || data.patient?.phone_no) ? (
          <Button
            title="Call the patient"
            icon="📞"
            variant="secondary"
            style={{ marginTop: spacing.md }}
            onPress={() => Linking.openURL(`tel:${b.contact_phone || data.patient.phone_no}`)}
          />
        ) : null}
      </Card>

      {/* ---------------------------------------------- F.5/F.7 dispatch */}
      <Card>
        <H2>Dispatch history</H2>
        <Small style={{ marginTop: 2, marginBottom: spacing.sm }}>
          Every ambulance this request was offered to, in order.
        </Small>
        {data.assignments.length === 0 ? (
          <Small>No offers were made.</Small>
        ) : (
          data.assignments.map((a, i) => (
            <View key={a.assignment_id} style={styles.listRow}>
              <View style={styles.head}>
                <Body style={{ fontFamily: FONT.semibold }}>{i + 1}. {a.driver_name}</Body>
                <Pill label={a.assignment_status} />
              </View>
              <Small>{a.vehicle_reg_no} · {a.ambulance_type}</Small>
              <Small style={typo.tiny}>
                rank {a.rank_score} · {a.distance_km} km · offered {timeOf(a.created_at)}
                {a.response_timestamp ? ` · answered ${timeOf(a.response_timestamp)}` : ''}
              </Small>
            </View>
          ))
        )}
      </Card>

      {/* -------------------------------------------------- D5 invoice */}
      {data.invoice ? (
        <Card>
          <View style={styles.head}>
            <H2>Invoice</H2>
            <Pill label={data.invoice.payment_status} />
          </View>
          <View style={{ marginTop: spacing.sm }}>
            <Row label="Invoice" value={data.invoice.invoice_id} />
            <Row label="Billed distance" value={`${data.invoice.distance_km} km`} />
            <Row label="Base fare" value={money(data.invoice.base_fare)} />
            <Row label="Distance charge" value={money(data.invoice.distance_charge)} />
            {data.invoice.type_surcharge > 0 ? <Row label="Surcharge" value={money(data.invoice.type_surcharge)} /> : null}
            <Row label="Tax" value={money(data.invoice.tax_amount)} />
            <Row label="Total" value={money(data.invoice.fare_amount)} valueStyle={{ color: colors.ok, fontSize: 17 }} />
            {data.invoice.payment_mode ? <Row label="Paid by" value={data.invoice.payment_mode} /> : null}
          </View>
        </Card>
      ) : null}

      {data.rating ? (
        <Card>
          <H2>Rating</H2>
          <View style={{ marginTop: spacing.sm }}>
            <Row label="Score" value={`${data.rating.rating_value} ★`} />
            {data.rating.feedback_text ? <Row label="Feedback" value={data.rating.feedback_text} /> : null}
          </View>
        </Card>
      ) : null}

      {/* ----------------------------------------------- F.6/F.14 alerts */}
      {data.messages?.length ? (
        <Card>
          <H2>Alerts sent</H2>
          {data.messages.map((m) => (
            <View key={m.message_id} style={styles.listRow}>
              <View style={styles.head}>
                <Small>{m.message_channel} → {m.recipient_phone}</Small>
                <Pill label={m.delivery_state} />
              </View>
              <Small style={typo.tiny} numberOfLines={3}>{m.body}</Small>
            </View>
          ))}
        </Card>
      ) : null}

      {/* ------------------------------------------------------ actions */}
      {canRedispatch ? (
        <Button
          title="Re-dispatch this request"
          loading={busy}
          onPress={() => act(`/api/admin/bookings/${bookingId}/redispatch`, {})}
        />
      ) : null}

      {canCancel ? (
        <Button
          title="Cancel this booking"
          variant="ghost"
          loading={busy}
          style={{ marginTop: spacing.sm }}
          onPress={() =>
            confirmAction(
              {
                title: 'Cancel this booking?',
                message: 'The patient is told, and any assigned ambulance is released.',
                confirmLabel: 'Cancel booking',
                cancelLabel: 'Keep it',
                destructive: true,
              },
              () => act(`/api/admin/bookings/${bookingId}/cancel`, { reason: 'Cancelled by control room' })
            )
          }
        />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  listRow: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.sm, marginTop: spacing.sm },
});
