import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../../lib/api';
import { REPORT_TYPES } from '../../lib/config';
import { FONT, colors, money, radius, spacing, typo } from '../../lib/theme';
import { Banner, Body, Card, EmptyState, Field, H2, Loading, Row, Small } from '../../components/ui';

/**
 * F.13 / DFD 0.6.3 - analytics.
 *
 * Day and hour buckets come back already shifted into the control room's civil
 * timezone by the backend (REPORT_UTC_OFFSET), so nothing here re-interprets a
 * timestamp - the window is a pair of civil dates, matching the Data
 * Dictionary's `date_range` group.
 */
const iso = (d) => d.toISOString().slice(0, 10);
const today = () => iso(new Date());
const daysAgo = (n) => iso(new Date(Date.now() - n * 86400000));

function Bars({ data, labelKey, valueKey, format }) {
  if (!data?.length) return <EmptyState icon="📊" title="No data in this window" />;
  const max = Math.max(1, ...data.map((d) => Number(d[valueKey]) || 0));
  return (
    <View style={{ marginTop: spacing.sm }}>
      {data.map((d, i) => (
        <View key={`${d[labelKey]}-${i}`} style={styles.barRow}>
          <Small style={{ width: 82 }} numberOfLines={1}>{String(d[labelKey])}</Small>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${((Number(d[valueKey]) || 0) / max) * 100}%` }]} />
          </View>
          <Body style={{ width: 80, textAlign: 'right', fontSize: 13 }}>
            {format ? format(d[valueKey]) : d[valueKey]}
          </Body>
        </View>
      ))}
    </View>
  );
}

export default function ReportsScreen() {
  const [type, setType] = useState('RESPONSE_TIME');
  const [range, setRange] = useState({ from_date: daysAgo(29), to_date: today() });
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const q = new URLSearchParams(range);
      setReport(await api.get(`/api/admin/reports/${type}?${q}`));
    } catch (e) {
      setError(e.message);
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [type, range]);

  useEffect(() => { load(); }, [load]);

  // Only trust the report when it is the one the chips are currently showing.
  // Switching type re-renders immediately against the previous response, and a
  // DEMAND layout reading a RESPONSE_TIME array finds nothing - which would
  // flash "No data in this window" over a window that has plenty.
  const m = report?.report_type === type ? report.metrics : null;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl * 2 }}
    >
      <Banner kind="error">{error}</Banner>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {REPORT_TYPES.map((r) => (
            <Pressable key={r.code} onPress={() => setType(r.code)} style={[styles.chip, type === r.code && styles.chipOn]}>
              <Text style={{ color: type === r.code ? colors.white : colors.muted, fontSize: 12.5, fontFamily: FONT.semibold }}>
                {r.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <Card>
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Field
              label="From"
              value={range.from_date}
              onChangeText={(v) => setRange((r) => ({ ...r, from_date: v }))}
              placeholder="YYYY-MM-DD"
              autoCapitalize="none"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Field
              label="To"
              value={range.to_date}
              onChangeText={(v) => setRange((r) => ({ ...r, to_date: v }))}
              placeholder="YYYY-MM-DD"
              autoCapitalize="none"
            />
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {[['7 days', 6], ['30 days', 29], ['90 days', 89]].map(([label, n]) => (
            <Pressable key={label} onPress={() => setRange({ from_date: daysAgo(n), to_date: today() })} style={styles.quick}>
              <Small style={typo.tiny}>{label}</Small>
            </Pressable>
          ))}
        </View>
        {report?.timezone ? (
          <Small style={[typo.tiny, { marginTop: spacing.sm }]}>
            Buckets are civil days in {report.timezone}.
          </Small>
        ) : null}
      </Card>

      {error ? null : loading || !m ? (
        // `!m` also covers the moment after switching type, when the previous
        // report is still in state - a spinner is honest there, where the new
        // layout reading the old shape would claim the window is empty.
        <Loading text="Building the report…" />
      ) : type === 'RESPONSE_TIME' ? (
        <Card>
          <H2>Response time by day</H2>
          <Small style={{ marginTop: 2 }}>Seconds from request to a driver accepting.</Small>
          <Bars data={m} labelKey="day" valueKey="avg_response_sec" format={(v) => `${v}s`} />
          {m.length ? (
            <View style={{ marginTop: spacing.md }}>
              <Row label="Bookings in window" value={m.reduce((a, d) => a + d.bookings, 0)} />
              <Row label="Of which matched" value={m.reduce((a, d) => a + d.matched, 0)} />
              <Row label="Worst day" value={`${Math.max(...m.map((d) => d.max_response_sec))}s`} />
            </View>
          ) : null}
        </Card>
      ) : type === 'DEMAND' ? (
        <>
          <Card>
            <H2>Bookings by day</H2>
            <Bars data={m.by_day} labelKey="day" valueKey="bookings" />
          </Card>
          <Card>
            <H2>By hour of day</H2>
            <Small style={{ marginTop: 2 }}>Where the peaks are, in local time.</Small>
            <Bars data={m.by_hour} labelKey="hour" valueKey="bookings" />
          </Card>
          <Card>
            <H2>By ambulance type</H2>
            <Bars data={m.by_type} labelKey="ambulance_type" valueKey="bookings" />
          </Card>
          <Card>
            <H2>By pincode</H2>
            <Bars data={m.by_pincode} labelKey="pincode" valueKey="bookings" />
          </Card>
        </>
      ) : type === 'REVENUE' ? (
        <>
          <Card>
            <H2>Billed by day</H2>
            <Bars data={m.by_day} labelKey="day" valueKey="gross" format={money} />
          </Card>
          <Card>
            <H2>By payment mode</H2>
            <Bars data={m.by_mode} labelKey="payment_mode" valueKey="amount" format={money} />
          </Card>
          <Card>
            <H2>By ambulance type</H2>
            <Bars data={m.by_type} labelKey="ambulance_type" valueKey="amount" format={money} />
          </Card>
        </>
      ) : (
        <Card>
          <H2>Provider performance</H2>
          {!m.length ? (
            <EmptyState icon="🚐" title="No providers in this window" />
          ) : (
            m.map((p) => (
              <View key={p.provider_id} style={styles.listRow}>
                <Body style={{ fontFamily: FONT.bold }}>{p.driver_name}</Body>
                <Small>{p.vehicle_reg_no} · {p.ambulance_type}</Small>
                <View style={{ marginTop: 4 }}>
                  <Row label="Trips" value={p.trips} />
                  <Row label="Avg response" value={p.avg_response_sec > 0 ? `${p.avg_response_sec}s` : '—'} />
                  <Row label="Rating" value={p.rating_count > 0 ? `${p.rating} ★ (${p.rating_count})` : 'not rated'} />
                  <Row
                    label="Accepted / declined / timed out"
                    value={`${p.accepted} / ${p.rejected} / ${p.timed_out}`}
                  />
                  <Row label="Revenue" value={money(p.revenue)} valueStyle={{ color: colors.ok }} />
                </View>
              </View>
            ))
          )}
        </Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  barRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 8 },
  barTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.bg, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4, backgroundColor: colors.info },
  listRow: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.sm, marginTop: spacing.sm },
  chip: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  quick: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg,
  },
});
