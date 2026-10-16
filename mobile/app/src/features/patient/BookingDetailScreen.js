import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../../lib/api';
import { PAYMENT_MODES } from '../../lib/config';
import { FONT, colors, dateTimeOf, money, radius, spacing, typo } from '../../lib/theme';
import { Banner, Body, Button, Card, Field, H2, Loading, Pill, Row, Small } from '../../components/ui';
import MapPanel from '../../components/MapPanel';

// F.10 payment, F.11 record detail, F.12 rating and feedback.
export default function BookingDetailScreen({ route }) {
  const { bookingId } = route.params;
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [paying, setPaying] = useState(false);
  const [mode, setMode] = useState('UPI');
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    api
      .get(`/api/bookings/${bookingId}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [bookingId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function pay() {
    setPaying(true);
    setError('');
    try {
      const r = await api.post(`/api/payments/invoices/${data.invoice.invoice_id}/pay`, { payment_mode: mode });
      setNotice(r.message);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setPaying(false);
    }
  }

  async function submitRating() {
    if (!rating) {
      setError('Choose a star rating first');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await api.post(`/api/bookings/${bookingId}/rating`, {
        rating_value: rating,
        feedback_text: feedback.trim() || undefined,
      });
      setNotice('Thank you for your feedback');
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!data) return <Loading text="Loading trip…" />;

  const b = data.booking;
  const inv = data.invoice;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl * 2 }}
    >
      <Banner kind="error">{error}</Banner>
      <Banner kind="ok">{notice}</Banner>

      <Card>
        <View style={styles.headRow}>
          <Pill label={b.booking_status} />
          <Small style={typo.tiny}>{b.booking_id}</Small>
        </View>
        <H2 style={{ marginTop: spacing.sm }}>{b.ambulance_type} ambulance</H2>
        <Small style={{ marginTop: 4 }}>{dateTimeOf(b.booking_timestamp)}</Small>

        <View style={{ marginTop: spacing.md }}>
          <MapPanel
            markers={[{ latitude: b.latitude, longitude: b.longitude, color: colors.accent, label: 'Pickup' }]}
            height={170}
          />
        </View>

        <View style={{ marginTop: spacing.md }}>
          <Row label="Pickup" value={b.address_text || `${b.latitude}, ${b.longitude}`} />
          {b.landmark ? <Row label="Landmark" value={b.landmark} /> : null}
          {b.patient_name ? <Row label="Patient" value={b.patient_name} /> : null}
          {b.notes ? <Row label="Notes" value={b.notes} /> : null}
          {b.response_time_sec != null ? <Row label="Ambulance accepted in" value={`${b.response_time_sec} s`} /> : null}
          {b.completed_at ? <Row label="Completed" value={dateTimeOf(b.completed_at)} /> : null}
          {b.cancelled_reason ? <Row label="Closed because" value={b.cancelled_reason} /> : null}
        </View>
      </Card>

      {b.provider ? (
        <Card>
          <H2>Ambulance</H2>
          <View style={{ marginTop: spacing.sm }}>
            <Row label="Driver" value={b.provider.driver_name} />
            <Row label="Vehicle" value={b.provider.vehicle_reg_no} />
            <Row label="Rating" value={`${b.provider.rating} ★`} />
          </View>
        </Card>
      ) : null}

      {/* ------------------------------------------------- F.10 invoice */}
      {inv ? (
        <Card>
          <View style={styles.headRow}>
            <H2>Invoice</H2>
            <Pill label={inv.payment_status} />
          </View>
          <Small style={{ marginTop: 4, marginBottom: spacing.sm }}>{inv.invoice_id}</Small>

          <Row label="Base fare" value={money(inv.base_fare)} />
          <Row label={`Distance (${inv.distance_km} km)`} value={money(inv.distance_charge)} />
          {inv.type_surcharge > 0 ? <Row label="Type surcharge" value={money(inv.type_surcharge)} /> : null}
          <Row label="Tax" value={money(inv.tax_amount)} />
          <View style={styles.divider} />
          <Row label="Total payable" value={money(inv.fare_amount)} valueStyle={{ fontSize: 20, fontFamily: FONT.bold }} />

          {inv.payment_status === 'PENDING' ? (
            <View style={{ marginTop: spacing.md }}>
              <Small style={{ marginBottom: spacing.sm }}>Choose how you want to pay</Small>
              <View style={styles.modes}>
                {PAYMENT_MODES.map((m) => (
                  <Pressable
                    key={m.code}
                    onPress={() => setMode(m.code)}
                    style={[styles.mode, mode === m.code && styles.modeActive]}
                  >
                    <Text style={{ fontSize: 18 }}>{m.icon}</Text>
                    <Text style={{ color: mode === m.code ? colors.white : colors.muted, fontSize: 12, fontFamily: FONT.semibold }}>
                      {m.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Button
                title={`Pay ${money(inv.fare_amount)}`}
                onPress={pay}
                loading={paying}
                style={{ marginTop: spacing.md }}
              />
            </View>
          ) : (
            <View style={{ marginTop: spacing.sm }}>
              <Row label="Paid by" value={inv.payment_mode || '—'} />
              <Row label="Reference" value={inv.transaction_ref || '—'} />
              <Row label="Paid at" value={dateTimeOf(inv.payment_timestamp)} />
            </View>
          )}
        </Card>
      ) : null}

      {/* ------------------------------------------------- F.12 rating */}
      {b.booking_status === 'COMPLETED' ? (
        <Card>
          <H2>Rate this trip</H2>
          {data.rating ? (
            <View style={{ marginTop: spacing.sm }}>
              <Text style={{ fontSize: 26, color: colors.warn }}>
                {'★'.repeat(data.rating.rating_value)}
                <Text style={{ color: colors.line }}>{'★'.repeat(5 - data.rating.rating_value)}</Text>
              </Text>
              {data.rating.feedback_text ? (
                <Body style={{ marginTop: spacing.sm }}>{data.rating.feedback_text}</Body>
              ) : null}
              <Small style={{ marginTop: 6 }}>Submitted {dateTimeOf(data.rating.created_at)}</Small>
            </View>
          ) : (
            <>
              <Small style={{ marginTop: 4, marginBottom: spacing.md }}>
                How was the response and the care you received?
              </Small>
              <View style={styles.stars}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Pressable key={n} onPress={() => setRating(n)} hitSlop={6}>
                    <Text style={{ fontSize: 38, color: n <= rating ? colors.warn : colors.line }}>★</Text>
                  </Pressable>
                ))}
              </View>
              <Field
                label="Comments (optional)"
                value={feedback}
                onChangeText={setFeedback}
                placeholder="Anything the control room should know?"
                multiline
                numberOfLines={3}
                style={{ minHeight: 78, textAlignVertical: 'top' }}
              />
              <Button title="Submit feedback" onPress={submitRating} loading={submitting} />
            </>
          )}
        </Card>
      ) : null}

      {/* ---------------------------------------- dispatch transparency */}
      {data.assignments.length > 0 ? (
        <Card>
          <H2>Dispatch record</H2>
          <Small style={{ marginTop: 4, marginBottom: spacing.sm }}>
            Ambulances that were offered this request, in order.
          </Small>
          {data.assignments.map((a) => (
            <View key={a.assignment_id} style={styles.assignRow}>
              <View style={{ flex: 1 }}>
                <Body style={{ fontFamily: FONT.semibold }}>{a.vehicle_reg_no}</Body>
                <Small>{a.driver_name} · {a.distance_km} km away</Small>
              </View>
              <Pill label={a.assignment_status} />
            </View>
          ))}
        </Card>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: spacing.sm },
  modes: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  mode: {
    flex: 1,
    minWidth: 74,
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg,
  },
  modeActive: { borderColor: colors.accent, backgroundColor: colors.surface2 },
  stars: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', marginBottom: spacing.md },
  assignRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
});
