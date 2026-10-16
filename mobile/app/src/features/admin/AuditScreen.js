import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../../lib/api';
import { useResync, useSocketEvent } from '../../lib/socket';
import { FONT, colors, dateTimeOf, radius, relative, spacing, typo } from '../../lib/theme';
import { Banner, Body, Card, EmptyState, Loading, Small } from '../../components/ui';

/**
 * Constraint C.5 - the audit trail.
 *
 * Every booking, dispatch decision, status change and administrative action is
 * recorded here. It is the record a dispute is settled from, so the screen
 * shows what happened, who did it and exactly when, without interpretation.
 */
const TONE = (action) => {
  if (action.includes('FAILED') || action.includes('REJECT')) return colors.accent;
  if (action.includes('TIMEOUT') || action.includes('STALL') || action.includes('AUTO_OFFLINE')) return colors.warn;
  if (action.includes('ACCEPT') || action.includes('SUCCESS') || action.includes('VERIFI')) return colors.ok;
  return colors.info;
};

export default function AuditScreen() {
  const [rows, setRows] = useState([]);
  const [actions, setActions] = useState([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const q = new URLSearchParams({ limit: '150' });
      if (filter) q.set('action', filter);
      const r = await api.get(`/api/admin/audit?${q}`);
      setRows(r.audit);
      // The action list comes from the whole table, so keep the first full set
      // rather than narrowing the filter bar to whatever is on screen.
      setActions((prev) => (prev.length && filter ? prev : r.actions));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useResync(load, [load]);

  // The trail tails rather than being refreshed. Prepending the row that
  // arrived, instead of refetching the page it belongs to, keeps the list
  // moving without asking the server for everything again each time somebody
  // does anything - and an audit row is written for nearly every action.
  useSocketEvent('admin:audit', (row) => {
    if (filter && row.action !== filter) return;
    setRows((prev) => [row, ...prev].slice(0, 200));
    setActions((prev) => (prev.includes(row.action) ? prev : [...prev, row.action]));
  }, [filter]);

  if (loading) return <Loading text="Reading the audit trail…" />;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl * 2 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.accent} />}
    >
      <Banner kind="error">{error}</Banner>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {[{ key: '', label: 'All' }, ...actions.map((a) => ({ key: a, label: a }))].map((c) => (
            <Pressable key={c.key || 'all'} onPress={() => setFilter(c.key)} style={[styles.chip, filter === c.key && styles.chipOn]}>
              <Text style={{ color: filter === c.key ? colors.white : colors.muted, fontSize: 11.5, fontFamily: FONT.semibold }}>
                {c.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <Small style={{ marginBottom: spacing.sm }}>{rows.length} entries, newest first</Small>

      {rows.length === 0 ? (
        <EmptyState icon="📜" title="Nothing recorded" hint="Actions appear here as they happen." />
      ) : (
        <Card>
          {rows.map((r) => (
            <View key={r.id} style={styles.row}>
              <View style={styles.head}>
                <View style={[styles.tag, { borderColor: TONE(r.action) }]}>
                  <Text style={{ color: TONE(r.action), fontSize: 11, fontFamily: FONT.bold }}>{r.action}</Text>
                </View>
                <Small style={typo.tiny}>{relative(r.created_at)}</Small>
              </View>

              {r.entity_type ? (
                <Small style={{ marginTop: 4 }}>
                  {r.entity_type} {r.entity_id}
                  {r.actor_role ? ` · by ${r.actor_role}` : ''}
                </Small>
              ) : null}

              {r.details ? (
                <Small style={[typo.tiny, { marginTop: 2 }]} numberOfLines={4}>
                  {Object.entries(r.details)
                    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
                    .join(' · ')}
                </Small>
              ) : null}

              <Small style={typo.tiny}>{dateTimeOf(r.created_at)}</Small>
            </View>
          ))}
        </Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { borderTopWidth: 1, borderTopColor: colors.line, paddingVertical: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, borderWidth: 1 },
  chip: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
});
