import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../../lib/api';
import { useResync, useSocketEvent } from '../../lib/socket';
import { confirmAction } from '../../lib/confirm';
import { ROLE_CODES } from '../../lib/config';
import { FONT, colors, radius, spacing, typo } from '../../lib/theme';
import { Banner, Body, Button, Card, EmptyState, Field, Loading, Pill, Row, Small } from '../../components/ui';

/**
 * F.13 - account management.
 *
 * Suspending an account is the blunt instrument: the middleware refuses the
 * token on the very next request, so it takes effect immediately rather than at
 * the end of the session. Administrator accounts are deliberately not editable
 * here - the backend refuses that too.
 */
export default function UsersScreen() {
  const [rows, setRows] = useState([]);
  const [role, setRole] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const params = new URLSearchParams();
      if (role) params.set('role_code', role);
      if (query.trim()) params.set('q', query.trim());
      const r = await api.get(`/api/admin/users?${params}`);
      setRows(r.users);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [role, query]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useResync(load, [load]);

  // A registration is one audit row away, and the account list is short
  // enough that refetching it is cheaper than reconstructing a row from an
  // event that was never shaped for this screen.
  useSocketEvent('admin:audit', (row) => {
    if (row.action === 'USER_REGISTERED') load();
  }, [load]);

  useSocketEvent('admin:provider:new', load, [load]);

  async function setStatus(user, verification_status) {
    setBusyId(user.user_id);
    setError('');
    try {
      await api.post(`/api/admin/users/${user.user_id}/status`, { verification_status });
      setNotice(`${user.full_name} marked ${verification_status}.`);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <Loading text="Loading accounts…" />;

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
        placeholder="Name, phone or user id"
        autoCapitalize="none"
        onSubmitEditing={load}
        returnKeyType="search"
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {[{ key: '', label: 'All' }, ...ROLE_CODES.map((r) => ({ key: r, label: r }))].map((c) => (
            <Pressable key={c.key || 'all'} onPress={() => setRole(c.key)} style={[styles.chip, role === c.key && styles.chipOn]}>
              <Text style={{ color: role === c.key ? colors.white : colors.muted, fontSize: 12.5, fontFamily: FONT.semibold }}>
                {c.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <Small style={{ marginBottom: spacing.sm }}>{rows.length} account{rows.length === 1 ? '' : 's'}</Small>

      {rows.length === 0 ? (
        <EmptyState icon="👤" title="No accounts match" hint="Try a different role or clear the search." />
      ) : (
        rows.map((u) => (
          <Card key={u.user_id}>
            <View style={styles.head}>
              <Body style={{ fontFamily: FONT.bold }}>{u.full_name}</Body>
              <Pill label={u.verification_status} />
            </View>
            <Small style={{ marginTop: 2 }}>{u.phone_no}</Small>
            <View style={{ marginTop: spacing.sm }}>
              <Row label="Role" value={u.role_code} />
              <Row label="User id" value={u.user_id} />
              <Row label="Registered" value={u.registration_date} />
              <Row label="Bookings" value={u.bookings} />
              {u.email_id ? <Row label="Email" value={u.email_id} /> : null}
            </View>

            {u.role_code === 'ADMIN' ? (
              <Small style={[typo.tiny, { marginTop: spacing.sm }]}>
                Administrator accounts cannot be changed here.
              </Small>
            ) : (
              <View style={styles.actions}>
                {u.verification_status !== 'SUSPENDED' ? (
                  <Button
                    title="Suspend"
                    variant="ghost"
                    style={{ flex: 1 }}
                    disabled={busyId === u.user_id}
                    onPress={() =>
                      confirmAction(
                        {
                          title: `Suspend ${u.full_name}?`,
                          message: 'They are signed out on their next request and cannot sign back in.',
                          confirmLabel: 'Suspend',
                          destructive: true,
                        },
                        () => setStatus(u, 'SUSPENDED')
                      )
                    }
                  />
                ) : (
                  <Button
                    title="Restore"
                    variant="success"
                    style={{ flex: 1 }}
                    loading={busyId === u.user_id}
                    onPress={() => setStatus(u, 'VERIFIED')}
                  />
                )}
              </View>
            )}
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
