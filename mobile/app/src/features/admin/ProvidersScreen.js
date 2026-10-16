import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../../lib/api';
import { useResync, useSocketEvent } from '../../lib/socket';
import { confirmAction } from '../../lib/confirm';
import { VERIFICATION_STATUSES } from '../../lib/config';
import { FONT, colors, radius, relative, spacing, typo } from '../../lib/theme';
import { Banner, Body, Button, Card, EmptyState, Field, Loading, Pill, Row, Small } from '../../components/ui';

/**
 * F.13 / DFD 0.6.1 - verify and manage drivers and organisations.
 *
 * This is the gate that matters most: an ambulance that is not VERIFIED is
 * invisible to the matcher (C.6), so a pending account is a vehicle sitting
 * idle. Those sort to the top.
 */
export default function ProvidersScreen({ navigation }) {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const params = new URLSearchParams();
      if (status) params.set('verification_status', status);
      if (query.trim()) params.set('q', query.trim());
      const r = await api.get(`/api/admin/providers?${params}`);
      setRows(r.providers);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [status, query]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useResync(load, [load]);
  useSocketEvent('admin:provider:new', load, [load]);
  useSocketEvent('admin:provider:update', load, [load]);

  async function decide(provider, verification_status) {
    setBusyId(provider.provider_id);
    setError('');
    try {
      const remarks = verification_status === 'VERIFIED'
        ? 'Documents checked and approved'
        : `Marked ${verification_status.toLowerCase()} by the control room`;
      await api.post(`/api/admin/providers/${provider.provider_id}/verification`, { verification_status, remarks });
      setNotice(`${provider.vehicle_reg_no} marked ${verification_status}. The driver has been notified.`);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <Loading text="Loading providers…" />;

  const pending = rows.filter((r) => r.verification_status === 'PENDING').length;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl * 2 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.accent} />}
    >
      <Banner kind="error">{error}</Banner>
      <Banner kind="ok">{notice}</Banner>

      <Field
        label="Search"
        value={query}
        onChangeText={setQuery}
        placeholder="Name, phone or vehicle number"
        autoCapitalize="none"
        onSubmitEditing={load}
        returnKeyType="search"
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {[{ key: '', label: 'All' }, ...VERIFICATION_STATUSES.map((s) => ({ key: s, label: s }))].map((c) => (
            <Pressable
              key={c.key || 'all'}
              onPress={() => setStatus(c.key)}
              style={[styles.chip, status === c.key && styles.chipOn]}
            >
              <Text style={{ color: status === c.key ? colors.white : colors.muted, fontSize: 12.5, fontFamily: FONT.semibold }}>
                {c.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <Small style={{ marginBottom: spacing.sm }}>
        {rows.length} provider{rows.length === 1 ? '' : 's'}
        {pending > 0 ? ` · ${pending} waiting for verification` : ''}
      </Small>

      {rows.length === 0 ? (
        <EmptyState icon="🚐" title="No providers match" hint="Try a different filter or clear the search." />
      ) : (
        rows.map((p) => (
          <Card key={p.provider_id} style={p.verification_status === 'PENDING' ? { borderColor: colors.warn } : undefined}>
            <Pressable onPress={() => navigation.navigate('AdminProviderDetail', { providerId: p.provider_id })}>
              <View style={styles.head}>
                <Body style={{ fontFamily: FONT.bold }}>{p.full_name}</Body>
                <Pill label={p.verification_status} />
              </View>
              <Small style={{ marginTop: 2 }}>{p.phone_no}{p.org_name ? ` · ${p.org_name}` : ''}</Small>

              <View style={{ marginTop: spacing.sm }}>
                <Row label="Vehicle" value={`${p.vehicle_reg_no} · ${p.ambulance_type}`} />
                <Row label="Duty" value={p.availability_status} />
                <Row label="Rating" value={p.rating_count > 0 ? `${p.rating} ★ (${p.rating_count})` : 'not rated'} />
                <Row label="Trips" value={p.trips_completed} />
                <Row label="Last seen" value={p.last_seen_timestamp ? relative(p.last_seen_timestamp) : 'never'} />
              </View>
            </Pressable>

            <View style={styles.actions}>
              {p.verification_status !== 'VERIFIED' ? (
                <Button
                  title="Verify"
                  variant="success"
                  style={{ flex: 1 }}
                  loading={busyId === p.provider_id}
                  onPress={() => decide(p, 'VERIFIED')}
                />
              ) : null}
              {p.verification_status === 'PENDING' ? (
                <Button
                  title="Reject"
                  variant="ghost"
                  style={{ flex: 1 }}
                  disabled={busyId === p.provider_id}
                  onPress={() =>
                    confirmAction(
                      {
                        title: `Reject ${p.vehicle_reg_no}?`,
                        message: 'The driver is told and cannot receive requests.',
                        confirmLabel: 'Reject',
                        destructive: true,
                      },
                      () => decide(p, 'REJECTED')
                    )
                  }
                />
              ) : null}
              {p.verification_status === 'VERIFIED' ? (
                <Button
                  title="Suspend"
                  variant="ghost"
                  style={{ flex: 1 }}
                  disabled={busyId === p.provider_id}
                  onPress={() =>
                    confirmAction(
                      {
                        title: `Suspend ${p.vehicle_reg_no}?`,
                        message: 'They are taken off duty immediately and stop receiving requests.',
                        confirmLabel: 'Suspend',
                        destructive: true,
                      },
                      () => decide(p, 'SUSPENDED')
                    )
                  }
                />
              ) : null}
            </View>
          </Card>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
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
