import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../../lib/api';
import { useResync, useSocketEvent } from '../../lib/socket';
import { colors, dateTimeOf, spacing, typo } from '../../lib/theme';
import { Banner, Body, Card, EmptyState, Loading, Pill, Small } from '../../components/ui';

/**
 * F.6 / F.14 - the delivery log.
 *
 * Every WhatsApp and SMS the system sent, with the receipt it got back. The
 * same rows appear whether the Cloud API or the mock transport carried them,
 * which is what makes the dispatch flow demonstrable without a Meta account.
 */
export default function MessagesScreen() {
  const [messages, setMessages] = useState([]);
  const [transport, setTransport] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const r = await api.get('/api/admin/messages?limit=100');
      setMessages(r.messages);
      setTransport(r.transport);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useResync(load, [load]);

  // Every WhatsApp, email and push the system sends lands here the moment it
  // is logged. This is the evidence for F.6 and F.14, and evidence is more
  // convincing when it can be watched arriving.
  useSocketEvent('admin:message', (row) => {
    setMessages((prev) => [row, ...prev].slice(0, 200));
  }, []);

  if (loading) return <Loading text="Loading the alert log…" />;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl * 2 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.accent} />}
    >
      <Banner kind="error">{error}</Banner>

      {transport === 'mock' ? (
        <Banner kind="warn">
          Mock transport: messages are stored and printed to the server console rather
          than sent. Set WHATSAPP_TOKEN to deliver through the Cloud API.
        </Banner>
      ) : (
        <Banner kind="ok">Delivering through the WhatsApp Business Cloud API.</Banner>
      )}

      <Small style={{ marginBottom: spacing.sm }}>{messages.length} most recent</Small>

      {messages.length === 0 ? (
        <EmptyState icon="📨" title="Nothing sent yet" hint="Dispatch alerts and status updates appear here." />
      ) : (
        messages.map((m) => (
          <Card key={m.message_id}>
            <View style={styles.head}>
              <Small>{m.message_channel} → {m.recipient_phone}</Small>
              <Pill label={m.delivery_state} />
            </View>
            {m.booking_id ? <Small style={typo.tiny}>{m.booking_id}</Small> : null}
            <Body style={{ marginTop: 6, fontSize: 13.5 }}>{m.body}</Body>
            <Small style={[typo.tiny, { marginTop: 6 }]}>
              {m.message_template_id ? `${m.message_template_id} · ` : ''}{dateTimeOf(m.created_at)}
            </Small>
          </Card>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
