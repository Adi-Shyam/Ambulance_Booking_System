import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../lib/api';
import { FONT, colors, radius, spacing } from '../lib/theme';
import { Banner, Body, Button, Field, H2, Small } from './ui';

/**
 * Reports the other party to a booking (F.13), in whichever direction the
 * person using it sits.
 *
 * One component rather than two, because the process has to be the same both
 * ways: a complaints route that is easier to use for a crew than a passenger
 * is not a complaints route. Only the wording and the reasons differ.
 *
 * Deliberately not a one-tap action. Picking a reason and being able to say
 * what happened is a small amount of friction that makes a report worth
 * reading - and the screen says plainly that filing decides nothing. Somebody
 * who believes the button suspends people will either use it as a threat or
 * never touch it.
 */
const REASONS = {
  // A crew, about a passenger.
  PASSENGER: [
    { code: 'FAKE_BOOKING', label: 'Hoax call', hint: 'No emergency, or nobody there at all' },
    { code: 'NO_SHOW', label: 'Did not turn up', hint: 'We waited and could not reach them' },
    { code: 'ABUSIVE', label: 'Abusive or threatening', hint: 'Towards the crew or the vehicle' },
    { code: 'REFUSED_PAYMENT', label: 'Refused to pay', hint: 'The fare was declined on completion' },
    { code: 'OTHER', label: 'Something else', hint: 'Describe it below' },
  ],
  // A passenger, about a crew.
  CREW: [
    { code: 'DID_NOT_ARRIVE', label: 'Never arrived', hint: 'Accepted the request and did not come' },
    { code: 'UNSAFE_DRIVING', label: 'Unsafe driving', hint: 'Dangerous on the way or with the patient aboard' },
    { code: 'ABUSIVE', label: 'Rude or abusive', hint: 'Towards the patient or whoever was with them' },
    { code: 'OVERCHARGED', label: 'Asked for more than the fare', hint: 'Demanded money beyond the invoice' },
    { code: 'VEHICLE_CONDITION', label: 'Vehicle or equipment', hint: 'Unclean, or missing what it should carry' },
    { code: 'OTHER', label: 'Something else', hint: 'Describe it below' },
  ],
};

const COPY = {
  PASSENGER: {
    open: 'Report this passenger',
    title: 'Report this passenger',
    endpoint: (id) => `/api/provider/bookings/${id}/report`,
  },
  CREW: {
    open: 'Report this ambulance',
    title: 'Report this ambulance',
    endpoint: (id) => `/api/bookings/${id}/report`,
  },
};

export default function ReportParty({ bookingId, existing, onFiled, about = 'PASSENGER' }) {
  const copy = COPY[about];
  const reasons = REASONS[about];
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Already reported: say so, and say where it went.
  if (existing?.report_id) {
    const settled = existing.report_status !== 'OPEN';
    return (
      <View style={styles.filed}>
        <Body style={{ fontFamily: FONT.semibold }}>
          {settled ? `Report ${existing.report_status.toLowerCase()}` : 'Reported — under review'}
        </Body>
        <Small style={{ marginTop: 2 }}>
          {settled
            ? 'The control room has ruled on this.'
            : 'The control room will review what you sent.'}
        </Small>
      </View>
    );
  }

  if (!open) {
    return (
      <Button
        title={copy.open}
        icon="⚠️"
        variant="ghost"
        style={{ marginTop: spacing.sm }}
        onPress={() => setOpen(true)}
      />
    );
  }

  async function file() {
    if (!reason) return setError('Choose what happened');
    setBusy(true);
    setError('');
    try {
      await api.post(copy.endpoint(bookingId), {
        reason_code: reason,
        details: details.trim() || undefined,
      });
      setOpen(false);
      onFiled?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.form}>
      <H2>{copy.title}</H2>
      <Small style={{ marginTop: 4, marginBottom: spacing.md }}>
        This goes to the control room, who decide what happens. Filing it does
        not suspend anybody by itself.
      </Small>

      <Banner kind="error">{error}</Banner>

      {reasons.map((r) => (
        <Pressable
          key={r.code}
          onPress={() => setReason(r.code)}
          style={[styles.reason, reason === r.code && styles.reasonOn]}
        >
          <Text style={{ fontSize: 15, fontFamily: FONT.semibold, color: reason === r.code ? colors.white : colors.text }}>
            {r.label}
          </Text>
          <Small style={reason === r.code ? { color: colors.accentPale } : undefined}>{r.hint}</Small>
        </Pressable>
      ))}

      <Field
        label={reason === 'OTHER' ? 'What happened' : 'Anything to add (optional)'}
        value={details}
        onChangeText={setDetails}
        placeholder="Kept brief, and factual"
        multiline
        numberOfLines={3}
      />

      <Button title="Send to the control room" loading={busy} onPress={file} />
      <Button
        title="Cancel"
        variant="ghost"
        style={{ marginTop: spacing.sm }}
        onPress={() => { setOpen(false); setError(''); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
  },
  reason: {
    padding: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
  },
  reasonOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  filed: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.sm,
    borderLeftWidth: 3,
    borderLeftColor: colors.warn,
    backgroundColor: colors.surface2,
  },
});
