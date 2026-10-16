import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../../lib/api';
import { useResync, useSocketEvent } from '../../lib/socket';
import { confirmAction } from '../../lib/confirm';
import { FONT, colors, dateTimeOf, radius, spacing, typo } from '../../lib/theme';
import { Banner, Body, Button, Card, EmptyState, Field, H2, Loading, Pill, Row, Small } from '../../components/ui';

/**
 * F.13 - the control room rules on what the crews have reported.
 *
 * Named for passengers to keep it clear of `ReportsScreen`, which is
 * analytics. These are complaints about people; those are numbers about the
 * service.
 *
 * A driver reports; an administrator decides. This screen is the second half
 * of that, and it is built to make the decision an informed one rather than a
 * reflex: every report carries how many others name the same passenger, and
 * how many of those were upheld. One complaint is an incident, four are a
 * pattern, and that difference is the whole judgement being asked for.
 */
const REASON_LABEL = {
  FAKE_BOOKING: 'Hoax call',
  NO_SHOW: 'Did not turn up',
  ABUSIVE: 'Abusive or threatening',
  REFUSED_PAYMENT: 'Refused to pay',
  OTHER: 'Other',
};

const FILTERS = [
  { key: 'OPEN', label: 'Open' },
  { key: 'UPHELD', label: 'Upheld' },
  { key: 'DISMISSED', label: 'Dismissed' },
  { key: '', label: 'All' },
];

export default function PassengerReportsScreen() {
  const [reports, setReports] = useState([]);
  const [filter, setFilter] = useState('OPEN');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [openId, setOpenId] = useState(null);
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const q = filter ? `?report_status=${filter}` : '';
      const r = await api.get(`/api/admin/reports${q}`);
      setReports(r.reports);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useResync(load, [load]);
  useSocketEvent('admin:report:new', load, [load]);
  useSocketEvent('admin:report:update', load, [load]);

  async function review(report, report_status, action) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await api.post(`/api/admin/reports/${report.report_id}/review`, {
        report_status,
        action,
        review_remarks: remarks.trim() || undefined,
      });
      setNotice(r.message);
      setOpenId(null);
      setRemarks('');
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading text="Loading reports…" />;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl * 2 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.accent} />}
      keyboardShouldPersistTaps="handled"
    >
      <Banner kind="error">{error}</Banner>
      {notice ? <Banner kind="info">{notice}</Banner> : null}

      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <Pressable
            key={f.key || 'all'}
            onPress={() => setFilter(f.key)}
            style={[styles.chip, filter === f.key && styles.chipOn]}
          >
            <Text
              style={{
                fontSize: 13,
                fontFamily: FONT.semibold,
                color: filter === f.key ? colors.white : colors.muted,
              }}
            >
              {f.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {reports.length === 0 ? (
        <EmptyState
          icon="🛡️"
          title={filter === 'OPEN' ? 'Nothing waiting' : 'No reports here'}
          hint="A crew can report a passenger from their trip history."
        />
      ) : (
        reports.map((r) => {
          const expanded = openId === r.report_id;
          const repeat = r.reports_against_subject > 1;

          return (
            <Card key={r.report_id} style={repeat ? { borderColor: colors.warn } : undefined}>
              <View style={styles.head}>
                <Pill
                  label={REASON_LABEL[r.reason_code] || r.reason_code}
                  tone={r.report_status === 'OPEN' ? colors.warn : colors.muted}
                />
                <Small style={typo.tiny}>{r.report_id}</Small>
              </View>

              <H2 style={{ marginTop: spacing.sm }}>{r.reported_name}</H2>
              <Small>{r.reported_phone}{r.reported_email ? ` · ${r.reported_email}` : ''}</Small>

              {/*
                The count sits above the detail on purpose. Whether this is a
                first complaint or a fourth changes what the detail means.
              */}
              {repeat ? (
                <Banner kind="warn">
                  {r.reports_against_subject} reports name this passenger
                  {r.upheld_against_subject > 0
                    ? `, ${r.upheld_against_subject} upheld`
                    : ', none upheld yet'}.
                </Banner>
              ) : null}

              {r.details ? (
                <View style={styles.quote}>
                  <Body>{r.details}</Body>
                </View>
              ) : null}

              <View style={{ marginTop: spacing.sm }}>
                <Row label="Booking" value={`${r.booking_id} · ${r.ambulance_type}`} />
                <Row label="Pickup" value={r.address_text || '—'} />
                <Row
                  label="Reported by"
                  value={`${r.reporter_name}${r.vehicle_reg_no ? ` · ${r.vehicle_reg_no}` : ''}`}
                />
                <Row label="Filed" value={dateTimeOf(r.created_at)} />
                <Row label="Account" value={r.reported_status} />
              </View>

              {r.report_status !== 'OPEN' ? (
                <View style={styles.outcome}>
                  <Body style={{ fontFamily: FONT.semibold }}>
                    {r.report_status === 'UPHELD' ? 'Upheld' : 'Dismissed'}
                    {r.action_taken && r.action_taken !== 'NONE'
                      ? ` · ${r.action_taken.toLowerCase()}`
                      : ''}
                  </Body>
                  {r.review_remarks ? <Small style={{ marginTop: 2 }}>{r.review_remarks}</Small> : null}
                  <Small style={{ marginTop: 2 }}>{dateTimeOf(r.reviewed_at)}</Small>
                </View>
              ) : !expanded ? (
                <Button
                  title="Review this report"
                  style={{ marginTop: spacing.md }}
                  onPress={() => { setOpenId(r.report_id); setRemarks(''); }}
                />
              ) : (
                <View style={{ marginTop: spacing.md }}>
                  <Field
                    label="Note for the record"
                    value={remarks}
                    onChangeText={setRemarks}
                    placeholder="Why this decision — it is kept with the report"
                    multiline
                    numberOfLines={2}
                  />

                  <Button
                    title="Dismiss — no action"
                    variant="secondary"
                    loading={busy}
                    onPress={() => review(r, 'DISMISSED', 'NONE')}
                  />
                  <Button
                    title="Uphold — warn only"
                    variant="secondary"
                    style={{ marginTop: spacing.sm }}
                    loading={busy}
                    onPress={() => review(r, 'UPHELD', 'WARN')}
                  />
                  <Button
                    title="Uphold — suspend the account"
                    style={{ marginTop: spacing.sm }}
                    loading={busy}
                    onPress={() =>
                      confirmAction(
                        {
                          title: 'Suspend this account?',
                          message: `${r.reported_name} will be signed out everywhere and cannot book or sign in. This can be undone from Accounts.`,
                          confirmLabel: 'Suspend',
                          destructive: true,
                        },
                        () => review(r, 'UPHELD', 'SUSPEND')
                      )
                    }
                  />
                  <Button
                    title="Uphold — delete the account"
                    variant="secondary"
                    style={{ marginTop: spacing.sm }}
                    loading={busy}
                    onPress={() =>
                      confirmAction(
                        {
                          title: 'Delete this account?',
                          message:
                            'The name, number and email are erased and the account is locked. '
                            + 'Their bookings, invoices and this report are kept, because the record '
                            + 'has to outlive the person. This cannot be undone.',
                          confirmLabel: 'Delete',
                          destructive: true,
                        },
                        () => review(r, 'UPHELD', 'DELETE')
                      )
                    }
                  />
                  <Button
                    title="Not now"
                    variant="ghost"
                    style={{ marginTop: spacing.sm }}
                    onPress={() => setOpenId(null)}
                  />
                </View>
              )}
            </Card>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  quote: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.sm,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    backgroundColor: colors.surface2,
  },
  outcome: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
});
