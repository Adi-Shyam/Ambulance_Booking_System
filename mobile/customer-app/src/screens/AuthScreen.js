import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { Banner, Body, Button, Card, Field, H1, Small } from '../components/ui';
import { colors, spacing, typo } from '../lib/theme';

// F.1 Registration and authentication, F.2 role-based login.
// The screen asks first whether the person is new or returning, exactly as the
// SRS describes, and offers a passwordless OTP path for emergencies.
const MODES = { SIGN_IN: 'SIGN_IN', REGISTER: 'REGISTER', OTP: 'OTP' };

export default function AuthScreen() {
  const { signIn, register, requestOtp, verifyOtp } = useAuth();
  const [mode, setMode] = useState(MODES.SIGN_IN);
  const [form, setForm] = useState({ full_name: '', phone_no: '', email_id: '', password: '' });
  const [otp, setOtp] = useState({ sent: false, code: '', devCode: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  async function run(fn) {
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const submitSignIn = () => run(() => signIn(form.phone_no.trim(), form.password));

  const submitRegister = () =>
    run(() =>
      register({
        full_name: form.full_name.trim(),
        phone_no: form.phone_no.trim(),
        email_id: form.email_id.trim() || undefined,
        password: form.password,
      })
    );

  const sendOtp = () =>
    run(async () => {
      const r = await requestOtp(form.phone_no.trim());
      setOtp({ sent: true, code: '', devCode: r.otp_code || '' });
    });

  const submitOtp = () => run(() => verifyOtp(form.phone_no.trim(), otp.code.trim()));

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <Text style={{ fontSize: 52 }}>🚑</Text>
          <H1 style={{ marginTop: spacing.sm, textAlign: 'center' }}>Ambulance Booking</H1>
          <Small style={{ textAlign: 'center', marginTop: 4 }}>
            An ambulance at your location in the fewest possible taps
          </Small>
        </View>

        <View style={styles.tabs}>
          {[
            [MODES.SIGN_IN, 'Existing user'],
            [MODES.REGISTER, 'New user'],
            [MODES.OTP, 'OTP'],
          ].map(([m, label]) => (
            <Pressable
              key={m}
              onPress={() => { setMode(m); setError(''); }}
              style={[styles.tab, mode === m && styles.tabActive]}
            >
              <Text style={{ color: mode === m ? colors.white : colors.muted, fontWeight: '600', fontSize: 13.5 }}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Card>
          <Banner kind="error">{error}</Banner>

          {mode === MODES.REGISTER && (
            <Field
              label="Full name"
              value={form.full_name}
              onChangeText={set('full_name')}
              placeholder="Your name"
              autoCapitalize="words"
            />
          )}

          <Field
            label="Mobile number"
            value={form.phone_no}
            onChangeText={set('phone_no')}
            placeholder="10-digit mobile number"
            keyboardType="number-pad"
            maxLength={10}
          />

          {mode === MODES.REGISTER && (
            <Field
              label="Email (optional)"
              value={form.email_id}
              onChangeText={set('email_id')}
              placeholder="Used for invoices"
              keyboardType="email-address"
              autoCapitalize="none"
            />
          )}

          {mode !== MODES.OTP && (
            <Field
              label="Password"
              value={form.password}
              onChangeText={set('password')}
              placeholder={mode === MODES.REGISTER ? 'At least 6 characters' : 'Your password'}
              secureTextEntry
            />
          )}

          {mode === MODES.OTP && otp.sent && (
            <>
              <Field
                label="Verification code"
                value={otp.code}
                onChangeText={(v) => setOtp((o) => ({ ...o, code: v }))}
                placeholder="6-digit code"
                keyboardType="number-pad"
                maxLength={6}
              />
              {otp.devCode ? (
                <Banner kind="warn">
                  Development mode: your code is {otp.devCode}. In production this arrives by WhatsApp or SMS.
                </Banner>
              ) : null}
            </>
          )}

          {mode === MODES.SIGN_IN && (
            <Button title="Sign in" onPress={submitSignIn} loading={busy} />
          )}
          {mode === MODES.REGISTER && (
            <Button title="Create account" onPress={submitRegister} loading={busy} />
          )}
          {mode === MODES.OTP && (
            <Button
              title={otp.sent ? 'Verify and continue' : 'Send code'}
              onPress={otp.sent ? submitOtp : sendOtp}
              loading={busy}
            />
          )}

          {mode === MODES.OTP && otp.sent && (
            <Button title="Send a new code" variant="ghost" onPress={sendOtp} style={{ marginTop: spacing.sm }} />
          )}
        </Card>

        <Small style={{ textAlign: 'center', marginTop: spacing.sm }}>
          Backend: {api.url}
        </Small>
        <Small style={{ textAlign: 'center', marginTop: 4 }}>
          Demo account 9800000001 / user123
        </Small>

        <Body style={[typo.tiny, styles.emergency]}>
          In a life-threatening emergency also call 108 directly.
        </Body>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, paddingTop: spacing.xl * 2, paddingBottom: spacing.xl },
  hero: { alignItems: 'center', marginBottom: spacing.xl },
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 4,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
  },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 7, alignItems: 'center' },
  tabActive: { backgroundColor: colors.accent },
  emergency: { textAlign: 'center', marginTop: spacing.lg, color: colors.warn },
});
