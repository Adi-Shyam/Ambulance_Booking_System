import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { ROLES, roleFor } from '../lib/config';
import { Banner, Body, Button, Card, Field, H1, H2, Small } from '../components/ui';
import BackendSetting from '../components/BackendSetting';
import PasswordStrength from '../components/PasswordStrength';
import { FONT, colors, radius, spacing, typo } from '../lib/theme';

/**
 * F.1 Registration and authentication, F.2 role-based login.
 *
 * The SRS asks for the mode to be selected at sign-in, so the screen opens on
 * the picker rather than on a form: you say who you are first, and the chosen
 * mode is then checked against the account the credentials belong to.
 */
const MODES = { SIGN_IN: 'SIGN_IN', REGISTER: 'REGISTER', OTP: 'OTP', FORGOT: 'FORGOT' };

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
  const { signIn, startRegistration, requestOtp, verifyOtp, forgotPassword, resetPassword } = useAuth();

  const [roleKey, setRoleKey] = useState(null);
  const [mode, setMode] = useState(MODES.SIGN_IN);
  const [form, setForm] = useState({
    full_name: '', phone_no: '', email_id: '', identity: '', password: '',
  });
  const [regRole, setRegRole] = useState('USER');
  const [otp, setOtp] = useState({ sent: false, code: '', devCode: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  // `api.url` is a getter on a module, so changing it does not re-render on its
  // own. Bumping this is what redraws the screens that display the address.
  const [, setBackendNonce] = useState(0);

  const role = roleFor(roleKey);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  async function run(fn) {
    setError('');
    setNotice('');
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
              <Body style={{ fontFamily: FONT.bold, fontSize: 16 }}>{r.title}</Body>
              <Small>{r.subtitle}</Small>
            </View>
            <Text style={{ color: colors.muted, fontSize: 22 }}>›</Text>
          </Pressable>
        ))}

        <View style={{ marginTop: spacing.lg }}>
          <BackendSetting onChange={() => setBackendNonce((n) => n + 1)} />
        </View>
        <Body style={[typo.tiny, styles.emergency]}>
          In a life-threatening emergency also call 108 directly.
        </Body>
      </ScrollView>
    );
  }

  // ---------------------------------------------------- credentials for it
  const canRegister = Boolean(REGISTRABLE[roleKey]);
  const roleOptions = REGISTRABLE[roleKey] || [];

  // One field, either identifier. `identity` holds whichever was typed; the
  // client decides from the shape of it which one the server is being told.
  const submitSignIn = () => run(() => signIn(roleKey, form.identity.trim(), form.password));

  /**
   * Registering is two steps, because the address has to be proved before the
   * account exists. This is the first: the server checks the details and
   * emails a code. `completeRegistration` is the second.
   */
  const submitRegister = () =>
    run(async () => {
      const r = await startRegistration({
        full_name: form.full_name.trim(),
        phone_no: form.phone_no.trim(),
        email_id: form.email_id.trim(),
        password: form.password,
        role_code: regRole,
      });
      setOtp({ sent: true, code: '', devCode: r.otp_code || '', sentTo: r.sent_to, channel: r.channel });
    });

  /** Forgotten password, step one: a code to the address. */
  const sendReset = () =>
    run(async () => {
      const r = await forgotPassword(form.email_id.trim());
      setOtp({ sent: true, code: '', devCode: r.otp_code || '', sentTo: r.sent_to, channel: 'EMAIL' });
      setNotice(r.message);
    });

  /** Step two: the code and a new password. Every session is then revoked. */
  const submitReset = () =>
    run(async () => {
      const r = await resetPassword(form.email_id.trim(), otp.code.trim(), form.password);
      setMode(MODES.SIGN_IN);
      setOtp({ sent: false, code: '', devCode: '' });
      setForm((f) => ({ ...f, password: '', identity: f.email_id }));
      setNotice(r.message);
    });

  /** The second step: the code comes back, and the account is created. */
  const completeRegistration = () =>
    run(() =>
      verifyOtp(roleKey, form.email_id.trim(), otp.code.trim(), {
        full_name: form.full_name.trim(),
        phone_no: form.phone_no.trim(),
        password: form.password,
        role_code: regRole,
      })
    );

  const sendOtp = () =>
    run(async () => {
      const r = await requestOtp(form.email_id.trim());
      setOtp({ sent: true, code: '', devCode: r.otp_code || '', sentTo: r.sent_to, channel: r.channel });
    });

  /**
   * A correct code on a number with no account registers it, so the server may
   * come back asking for a name. Rather than treat that as an error, show the
   * field and let them finish — the code they just proved is still good.
   */
  const submitOtp = () =>
    run(async () => {
      try {
        await verifyOtp(roleKey, form.email_id.trim(), otp.code.trim(), {
          full_name: form.full_name.trim() || undefined,
          phone_no: form.phone_no.trim() || undefined,
        });
      } catch (e) {
        if (e.payload?.needs_registration) {
          if (!canRegister) {
            // F.13: a control-room account is made by another administrator,
            // never by proving you hold a phone number.
            throw new Error('No control-room account uses this number. An administrator has to create one for you.');
          }
          setOtp((o) => ({ ...o, needsName: true, missing: e.payload.missing || [] }));
          throw new Error('This address is new here. Enter your name and mobile number to create an account.');
        }
        throw e;
      }
    });

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
              // Clearing the code too: a half-finished registration must not
              // follow you to the sign-in form, where its field means nothing.
              onPress={() => {
                setMode(m);
                setError('');
                setOtp({ sent: false, code: '', devCode: '' });
              }}
              style={[styles.tab, mode === m && styles.tabActive]}
            >
              <Text style={{ color: mode === m ? colors.white : colors.muted, fontFamily: FONT.semibold, fontSize: 13.5 }}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Card>
          <Banner kind="error">{error}</Banner>
          {notice ? <Banner kind="info">{notice}</Banner> : null}

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
                    <Body style={{ fontFamily: FONT.bold }}>{o.label}</Body>
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

          {/*
            The OTP tab asks only for an address. A code proves one contact
            detail, and an address is the one that can be proved for nothing -
            so demanding a mobile number before sending an email would be
            asking for something this step has no use for.
          */}
          {mode === MODES.FORGOT || mode === MODES.OTP ? (
            <Field
              label="Email address"
              value={form.email_id}
              onChangeText={set('email_id')}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              hint={
                otp.sent ? undefined
                : mode === MODES.FORGOT ? 'We will email a reset code to this address.'
                : 'We will email you a 6-digit code.'
              }
            />
          ) : mode === MODES.SIGN_IN ? (
            <Field
              label="Email or mobile number"
              value={form.identity}
              onChangeText={set('identity')}
              placeholder="you@example.com or 10-digit number"
              autoCapitalize="none"
              autoComplete="username"
            />
          ) : (
            <Field
              label="Mobile number"
              value={form.phone_no}
              onChangeText={set('phone_no')}
              placeholder="10-digit mobile number"
              keyboardType="number-pad"
              maxLength={10}
              hint="The ambulance crew call this if they cannot find you."
            />
          )}

          {mode === MODES.REGISTER && (
            <Field
              label="Email address"
              value={form.email_id}
              onChangeText={set('email_id')}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />
          )}

          {/*
            Hidden once a registration code is outstanding: the password has
            already been accepted and is carried through with the code, so
            leaving the field on screen would invite someone to change it
            between the two halves of one request.
          */}
          {(mode === MODES.FORGOT ? otp.sent : mode !== MODES.OTP && !otp.sent) && (
            <>
              <Field
                label={mode === MODES.FORGOT ? 'New password' : 'Password'}
                value={form.password}
                onChangeText={set('password')}
                placeholder={mode === MODES.SIGN_IN ? 'Your password' : 'At least 8 characters'}
                secureTextEntry
              />
              {/*
                Only while choosing one. On the sign-in form the password is
                being supplied, not chosen, and grading an existing password
                there would be both useless and rude.
              */}
              {mode !== MODES.SIGN_IN ? (
                <PasswordStrength
                  value={form.password}
                  owner={{
                    full_name: form.full_name,
                    phone_no: form.phone_no,
                    email_id: form.email_id,
                  }}
                />
              ) : null}
            </>
          )}

          {/*
            Registering and signing in by code both end here, because both
            have to prove the address before anything happens.
          */}
          {otp.sent && (
            <>
              <Field
                label="Verification code"
                value={otp.code}
                onChangeText={(v) => setOtp((o) => ({ ...o, code: v }))}
                placeholder="6-digit code"
                keyboardType="number-pad"
                maxLength={6}
              />
              {/*
                The address checked out but belongs to nobody yet, so this is
                a sign-up. The number is asked for here rather than up front
                because it plays no part in proving the address - it is what
                the ambulance crew ring when they cannot find the patient.
              */}
              {/*
                Only the OTP tab ever reaches this: the registration form
                collected a name and a number up front, so asking again there
                would be asking twice for the same thing.
              */}
              {mode === MODES.OTP && otp.needsName ? (
                <>
                  <Field
                    label="Your name"
                    value={form.full_name}
                    onChangeText={set('full_name')}
                    placeholder="Your name"
                    autoCapitalize="words"
                    hint="This email has no account yet, so this creates one."
                  />
                  <Field
                    label="Mobile number"
                    value={form.phone_no}
                    onChangeText={set('phone_no')}
                    placeholder="10-digit mobile number"
                    keyboardType="number-pad"
                    maxLength={10}
                    hint="The ambulance crew call this if they cannot find you."
                  />
                </>
              ) : null}

              {otp.sentTo ? (
                <Small style={{ marginBottom: spacing.sm }}>
                  Sent to {otp.sentTo} by {otp.channel === 'EMAIL' ? 'email' : 'WhatsApp'}.
                </Small>
              ) : null}

              {otp.devCode ? (
                <Banner kind="warn">
                  Development mode: your code is {otp.devCode}. With a transport configured it
                  arrives {otp.channel === 'EMAIL' ? 'by email' : 'by WhatsApp or SMS'} instead.
                </Banner>
              ) : null}
            </>
          )}

          {mode === MODES.SIGN_IN && (
            <>
              <Button title="Sign in" onPress={submitSignIn} loading={busy} />
              <Button
                title="Forgot password?"
                variant="ghost"
                style={{ marginTop: spacing.sm }}
                onPress={() => {
                  setMode(MODES.FORGOT);
                  setError('');
                  setNotice('');
                  setOtp({ sent: false, code: '', devCode: '' });
                  // Carry whatever they typed, if it looks like an address.
                  setForm((f) => ({
                    ...f,
                    email_id: f.identity.includes('@') ? f.identity : f.email_id,
                  }));
                }}
              />
            </>
          )}

          {mode === MODES.FORGOT && (
            <>
              <Button
                title={otp.sent ? 'Set new password' : 'Email me a reset code'}
                onPress={otp.sent ? submitReset : sendReset}
                loading={busy}
              />
              <Button
                title={otp.sent ? 'Send a new code' : 'Back to sign in'}
                variant="ghost"
                style={{ marginTop: spacing.sm }}
                onPress={() => {
                  if (otp.sent) return sendReset();
                  setMode(MODES.SIGN_IN);
                  setError('');
                  setNotice('');
                  return undefined;
                }}
              />
            </>
          )}
          {mode === MODES.REGISTER && (
            <Button
              title={otp.sent ? 'Verify and create account' : 'Email me a code'}
              onPress={otp.sent ? completeRegistration : submitRegister}
              loading={busy}
            />
          )}
          {mode === MODES.REGISTER && otp.sent ? (
            <Button
              title="Send a new code"
              variant="ghost"
              style={{ marginTop: spacing.sm }}
              onPress={submitRegister}
            />
          ) : null}
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
        <BackendSetting onChange={() => setBackendNonce((n) => n + 1)} />
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
