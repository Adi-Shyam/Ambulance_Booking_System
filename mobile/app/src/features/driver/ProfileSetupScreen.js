import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import { AMBULANCE_TYPES } from '../../lib/config';
import { Banner, Body, Button, Card, Field, H1, H2, Small } from '../../components/ui';
import { FONT, colors, radius, spacing, typo } from '../../lib/theme';

/**
 * D2 - the vehicle record. A signed-in driver with no ambulance profile cannot
 * be dispatched anything, so this screen stands between them and the console.
 *
 * The profile is created PENDING: an administrator has to verify the documents
 * before any offer will reach it (F.13, constraint C.6).
 */
export default function ProfileSetupScreen() {
  const { user, refreshProvider, signOut } = useAuth();
  const isOrg = user?.role_code === 'ORG';

  const [form, setForm] = useState({
    vehicle_reg_no: '',
    licence_no: '',
    document_ref: '',
    org_name: '',
    org_address: '',
  });
  const [ambulanceType, setAmbulanceType] = useState('BLS');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    setError('');
    setBusy(true);
    try {
      await api.post('/api/provider/profile', {
        vehicle_reg_no: form.vehicle_reg_no.trim().toUpperCase(),
        ambulance_type: ambulanceType,
        licence_no: form.licence_no.trim() || undefined,
        document_ref: form.document_ref.trim() || undefined,
        ...(isOrg && form.org_name.trim()
          ? { org_name: form.org_name.trim(), org_address: form.org_address.trim() || undefined }
          : {}),
      });
      // The console unlocks as soon as the profile exists.
      await refreshProvider();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <H1>Add your ambulance</H1>
        <Small style={{ marginTop: 6, marginBottom: spacing.lg }}>
          One more step, {user?.full_name}. These details go to the control room
          for verification before you can receive requests.
        </Small>

        <Card>
          <Banner kind="error">{error}</Banner>

          <Field
            label="Vehicle registration number"
            value={form.vehicle_reg_no}
            onChangeText={set('vehicle_reg_no')}
            placeholder="KA19AB1234"
            autoCapitalize="characters"
            maxLength={13}
            hint="As printed on the number plate, without spaces."
          />

          <Text style={[typo.small, { marginBottom: 8 }]}>Ambulance type</Text>
          <View style={{ gap: spacing.sm, marginBottom: spacing.md }}>
            {/*
              Request types, minus EMG: that one means "send whatever is
              nearest", so no vehicle is registered as it and the server
              refuses one that tries. Offering it here would be offering a
              choice that can only fail.
            */}
            {AMBULANCE_TYPES.filter((t) => !t.urgent).map((t) => (
              <Pressable
                key={t.code}
                onPress={() => setAmbulanceType(t.code)}
                style={[styles.typeCard, ambulanceType === t.code && styles.typeCardActive]}
              >
                <Text style={{ fontSize: 24 }}>{t.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Body style={{ fontFamily: FONT.bold }}>{t.code} — {t.label}</Body>
                  <Small>{t.hint}</Small>
                </View>
              </Pressable>
            ))}
          </View>

          <Field
            label="Driving licence number (optional)"
            value={form.licence_no}
            onChangeText={set('licence_no')}
            placeholder="KA1920190001234"
            autoCapitalize="characters"
            maxLength={16}
          />

          <Field
            label="Document link (optional)"
            value={form.document_ref}
            onChangeText={set('document_ref')}
            placeholder="https://…/registration-scan.pdf"
            autoCapitalize="none"
            keyboardType="url"
            hint="A link to the scanned registration and fitness certificate."
          />

          {isOrg && (
            <>
              <H2 style={{ marginTop: spacing.sm, marginBottom: spacing.sm }}>Your organisation</H2>
              <Field
                label="Organisation name"
                value={form.org_name}
                onChangeText={set('org_name')}
                placeholder="City Hospital Ambulance Service"
                autoCapitalize="words"
              />
              <Field
                label="Address (optional)"
                value={form.org_address}
                onChangeText={set('org_address')}
                placeholder="Street, city, pincode"
                autoCapitalize="words"
              />
            </>
          )}

          <Button title="Submit for verification" onPress={submit} loading={busy} />
        </Card>

        <Small style={{ textAlign: 'center', lineHeight: 18 }}>
          You will be notified as soon as an administrator reviews your documents.
          Until then the console stays locked.
        </Small>

        <Button
          title="Sign out"
          variant="ghost"
          style={{ marginTop: spacing.lg }}
          onPress={signOut}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, paddingTop: spacing.xl * 2, paddingBottom: spacing.xl },
  typeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg,
  },
  typeCardActive: { borderColor: colors.accent, backgroundColor: `${colors.accent}14` },
});
