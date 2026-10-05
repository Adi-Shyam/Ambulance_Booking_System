import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { ROLES, roleFor } from '../lib/config';
import { Banner, Body, Button, Card, Field, H1, H2, Small } from '../components/ui';
import { colors, radius, spacing, typo } from '../lib/theme';

/**
 * F.1 Registration and authentication, F.2 role-based login.
 *
 * The SRS asks for the mode to be selected at sign-in, so the screen opens on
 * the picker rather than on a form: you say who you are first, and the chosen
 * mode is then checked against the account the credentials belong to.
 */
const MODES = { SIGN_IN: 'SIGN_IN', REGISTER: 'REGISTER', OTP: 'OTP' };

// Only the two self-service roles can create their own account. A control-room
// login is made by another administrator (F.13), never from the sign-in screen.
const REGISTRABLE = {
  PATIENT: [{ code: 'USER', label: 'Patient', hint: 'Book ambulances for yourself or family' }],
  PROVIDER: [
    { code: 'DRIVER', label: 'Individual driver', hint: 'You own or drive one ambulance' },
    { code: 'ORG', label: 'Organisation', hint: 'A hospital or fleet operator' },
  ],
};

export default function AuthScreen() {
  const { signIn, register, requestOtp, verifyOtp } = useAuth();

  const [roleKey, setRoleKey] = useState(null);
  const [mode, setMode] = useState(MODES.SIGN_IN);
  const [form, setForm] = useState({ full_name: '', phone_no: '', email_id: '', password: '' });
  const [regRole, setRegRole] = useState('USER');
  const [otp, setOtp] = useState({ sent: false, code: '', devCode: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const role = roleFor(roleKey);
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

  function chooseRole(key) {
    setRoleKey(key);
    setMode(MODES.SIGN_IN);
    setError('');
    setOtp({ sent: false, code: '', devCode: '' });
    setRegRole(REGISTRABLE[key]?.[0]?.code || 'USER');
  }

  // ------------------------------------------------------- the role picker
  if (!role) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.hero}>
          <Text style={{ fontSize: 52 }}>🚑</Text>
          <H1 style={{ marginTop: spacing.sm, textAlign: 'center' }}>Ambulance Booking</H1>
          <Small style={{ textAlign: 'center', marginTop: 4 }}>
            Choose how you are signing in
          </Small>
        </View>

        {ROLES.map((r) => (
          <Pressable key={r.key} onPress={() => chooseRole(r.key)} style={styles.roleCard}>
            <Text style={{ fontSize: 32 }}>{r.icon}</Text>
            <View style={{ flex: 1 }}>
              <Body style={{ fontWeight: '700', fontSize: 16 }}>{r.title}</Body>
              <Small>{r.subtitle}</Small>
            </View>
            <Text style={{ color: colors.muted, fontSize: 22 }}>›</Text>
          </Pressable>
        ))}

        <Small style={{ textAlign: 'center', marginTop: spacing.lg }}>Backend: {api.url}</Small>
        <Body style={[typo.tiny, styles.emergency]}>
          In a life-threatening emergency also call 108 directly.
        </Body>
      </ScrollView>
    );
  }

  // ---------------------------------------------------- credentials for it
  const canRegister = Boolean(REGISTRABLE[roleKey]);
  const roleOptions = REGISTRABLE[roleKey] || [];

  const submitSignIn = () => run(() => signIn(roleKey, form.phone_no.trim(), form.password));

  const submitRegister = () =>
    run(() =>
      register(roleKey, {
        full_name: form.full_name.trim(),
        phone_no: form.phone_no.trim(),
        email_id: form.email_id.trim() || undefined,
        password: form.password,
        role_code: regRole,
      })
    );

  const sendOtp = () =>
    run(async () => {
      const r = await requestOtp(form.phone_no.trim());
      setOtp({ sent: true, code: '', devCode: r.otp_code || '' });
    });

  const submitOtp = () => run(() => verifyOtp(roleKey, form.phone_no.trim(), otp.code.trim()));

  const tabs = [[MODES.SIGN_IN, 'Sign in']]
    .concat(canRegister ? [[MODES.REGISTER, 'Register']] : [])
    .concat([[MODES.OTP, 'OTP']]);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable onPress={() => { setRoleKey(null); setError(''); }} style={styles.back}>
          <Text style={{ color: colors.accent, fontSize: 14.5 }}>‹  Change mode</Text>
        </Pressable>

        <View style={[styles.hero, { marginBottom: spacing.lg }]}>
          <Text style={{ fontSize: 44 }}>{role.icon}</Text>
          <H2 style={{ marginTop: spacing.sm, textAlign: 'center' }}>{role.title}</H2>
          <Small style={{ textAlign: 'center', marginTop: 2 }}>{role.subtitle}</Small>
        </View>

        <View style={styles.tabs}>
          {tabs.map(([m, label]) => (
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

          {mode === MODES.REGISTER && roleOptions.length > 1 && (
            <>
              <Text style={[typo.small, { marginBottom: 6 }]}>I am registering as</Text>
              <View style={{ gap: spacing.sm, marginBottom: spacing.md }}>
                {roleOptions.map((o) => (
                  <Pressable
                    key={o.code}
                    onPress={() => setRegRole(o.code)}
                    style={[styles.optionCard, regRole === o.code && styles.optionCardActive]}
                  >
                    <Body style={{ fontWeight: '700' }}>{o.label}</Body>
                    <Small>{o.hint}</Small>
                  </Pressable>
                ))}
              </View>
            </>
          )}

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
              placeholder="Used for invoices and statements"
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

          {mode === MODES.SIGN_IN && <Button title="Sign in" onPress={submitSignIn} loading={busy} />}
          {mode === MODES.REGISTER && <Button title="Create account" onPress={submitRegister} loading={busy} />}
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

        {!canRegister ? (
          <Small style={{ textAlign: 'center', lineHeight: 18 }}>
            Control-room accounts are created by another administrator, not from
            this screen.
          </Small>
        ) : null}

        <Small style={{ textAlign: 'center', marginTop: spacing.md }}>Demo account {role.demo}</Small>
        <Small style={{ textAlign: 'center', marginTop: 2 }}>Backend: {api.url}</Small>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, paddingTop: spacing.xl * 2, paddingBottom: spacing.xl },
  hero: { alignItems: 'center', marginBottom: spacing.xl },
  back: { marginBottom: spacing.md },
  roleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    marginBottom: spacing.md,
  },
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
  optionCard: {
    padding: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg,
  },
  optionCardActive: { borderColor: colors.accent, backgroundColor: `${colors.accent}14` },
  emergency: { textAlign: 'center', marginTop: spacing.lg, color: colors.warn },
});
