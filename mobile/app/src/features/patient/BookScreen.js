import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { readPosition as readDevicePosition } from '../../lib/location';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../../lib/api';
import { useResync, useSocketEvent } from '../../lib/socket';
import { confirmAction } from '../../lib/confirm';
import { AMBULANCE_TYPES } from '../../lib/config';
import { FONT, colors, money, radius, spacing, typo } from '../../lib/theme';
import { Banner, Body, Button, Card, Field, H2, Loading, Pill, Small } from '../../components/ui';
import MapPanel from '../../components/MapPanel';

// F.3 Select ambulance type and place booking, F.4 Capture pickup location.
export default function BookScreen({ navigation }) {
  const [active, setActive] = useState(null);
  const [checking, setChecking] = useState(true);

  const [ambulanceType, setAmbulanceType] = useState('BLS');
  const [pickup, setPickup] = useState(null);          // { latitude, longitude, address_text }
  const [locating, setLocating] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [notes, setNotes] = useState('');
  const [patientName, setPatientName] = useState('');
  const [nearby, setNearby] = useState([]);
  const [estimate, setEstimate] = useState(null);
  const [error, setError] = useState('');
  const [placing, setPlacing] = useState(false);

  // An open booking takes over the screen - the patient should land on tracking.
  const checkActive = useCallback(() => {
    api
      .get('/api/bookings/active')
      .then((r) => setActive(r.booking))
      .catch((e) => setError(e.message))
      .finally(() => setChecking(false));
  }, []);

  useFocusEffect(useCallback(() => { checkActive(); }, [checkActive]));
  useResync(checkActive, [checkActive]);
  useSocketEvent('booking:update', (b) => {
    const open = ['REQUESTED', 'MATCHING', 'ASSIGNED', 'ENROUTE', 'ARRIVED', 'ONBOARD'];
    setActive(open.includes(b.booking_status) ? b : null);
  }, []);

  // F.4: GPS first; the map pin and the address box are the fallbacks.
  const useMyLocation = useCallback(async () => {
    setLocating(true);
    setError('');
    try {
      // Times out and falls back to a cached fix rather than waiting for one
      // that may never come - this runs on mount, so a hang here is a screen
      // that never finishes loading.
      const pos = await readDevicePosition();
      const coords = { latitude: pos.latitude, longitude: pos.longitude };
      const rev = await api.get(`/api/geo/reverse?lat=${coords.latitude}&lng=${coords.longitude}`);
      setPickup({ ...coords, address_text: rev.location.address_text, pincode: rev.location.pincode });
    } catch (e) {
      setError(
        e.code === 'DENIED'
          ? 'Location permission was declined. Type an address or tap the map to drop a pin instead.'
          : e.message || 'Could not read your location'
      );
    } finally {
      setLocating(false);
    }
  }, []);

  useEffect(() => { useMyLocation(); }, [useMyLocation]);

  // Show what is around, so the wait is not a blank screen.
  useEffect(() => {
    if (!pickup) return;
    api
      .get(`/api/geo/nearby-ambulances?lat=${pickup.latitude}&lng=${pickup.longitude}`)
      .then((r) => setNearby(r.ambulances))
      .catch(() => setNearby([]));
  }, [pickup]);

  // Indicative fare for the selected type, using the nearest ambulance distance.
  useEffect(() => {
    const km = nearby[0]?.distance_km ?? 8;
    api
      .post('/api/bookings/estimate', { ambulance_type: ambulanceType, distance_km: km })
      .then((r) => setEstimate({ ...r.estimate, basis_km: km }))
      .catch(() => setEstimate(null));
  }, [ambulanceType, nearby]);

  async function search() {
    if (!query.trim()) return;
    setError('');
    setSearching(true);
    try {
      const r = await api.get(`/api/geo/geocode?q=${encodeURIComponent(query.trim())}`);
      setResults(r.results);
      if (r.results.length === 0) setError('No place matched that search. Try a landmark, or tap the map.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSearching(false);
    }
  }

  async function placeBooking() {
    if (!pickup) {
      setError('Set a pickup location first');
      return;
    }
    setPlacing(true);
    setError('');
    try {
      const r = await api.post('/api/bookings', {
        ambulance_type: ambulanceType,
        latitude: pickup.latitude,
        longitude: pickup.longitude,
        address_text: pickup.address_text,
        pincode: pickup.pincode,
        patient_name: patientName.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      setActive(r.booking);
      setNotes('');
      setPatientName('');
      navigation.navigate('Track');
    } catch (e) {
      setError(e.message);
    } finally {
      setPlacing(false);
    }
  }

  if (checking) return <Loading text="Checking for an active request…" />;

  if (active) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg }}>
        <Card>
          <Pill label={active.booking_status} />
          <H2 style={{ marginTop: spacing.sm }}>You already have a request open</H2>
          <Small style={{ marginTop: 6 }}>
            {active.booking_id} · {active.ambulance_type} · {active.address_text || 'shared location'}
          </Small>
          <Button title="Go to live tracking" onPress={() => navigation.navigate('Track')} style={{ marginTop: spacing.md }} />
        </Card>
      </ScrollView>
    );
  }

  const markers = [
    ...(pickup
      ? [{ ...pickup, kind: 'pickup', glyph: '📍', label: 'Pickup — drag to adjust' }]
      : []),
    ...nearby.slice(0, 10).map((a) => ({
      latitude: a.latitude,
      longitude: a.longitude,
      glyph: '🚑',
      label: `${a.ambulance_type} · ${a.distance_km} km away`,
    })),
  ];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl * 2 }}
      refreshControl={<RefreshControl refreshing={locating} onRefresh={useMyLocation} tintColor={colors.accent} />}
      keyboardShouldPersistTaps="handled"
    >
      <Banner kind="error">{error}</Banner>

      {/* -------------------------------------------------- F.4 pickup */}
      <Card>
        <H2>Where are you?</H2>
        <Small style={{ marginTop: 4, marginBottom: spacing.md }}>
          Move the map so the pin sits on you, or search for a landmark.
        </Small>

        <MapPanel
          markers={markers}
          height={230}
          onPick={async (lat, lng) => {
            const coords = { latitude: Number(lat.toFixed(6)), longitude: Number(lng.toFixed(6)) };
            setPickup({ ...coords, address_text: 'Locating address…' });
            try {
              const rev = await api.get(`/api/geo/reverse?lat=${coords.latitude}&lng=${coords.longitude}`);
              setPickup({ ...coords, address_text: rev.location.address_text, pincode: rev.location.pincode });
            } catch {
              setPickup({ ...coords, address_text: `${coords.latitude}, ${coords.longitude}` });
            }
          }}
        />

        <View style={styles.pickupRow}>
          <Text style={{ fontSize: 18 }}>📍</Text>
          <View style={{ flex: 1 }}>
            <Body numberOfLines={2}>{pickup?.address_text || 'No pickup location set'}</Body>
            {pickup ? (
              <Small style={typo.tiny}>
                {pickup.latitude}, {pickup.longitude}
                {pickup.pincode ? ` · ${pickup.pincode}` : ''}
              </Small>
            ) : null}
          </View>
        </View>

        <Button
          title={locating ? 'Reading GPS…' : 'Use my current location'}
          icon="🎯"
          variant="secondary"
          onPress={useMyLocation}
          loading={locating}
        />

        <View style={{ marginTop: spacing.md }}>
          <Field
            label="Or search an address"
            value={query}
            onChangeText={setQuery}
            placeholder="e.g. NITK Surathkal main gate"
            onSubmitEditing={search}
            returnKeyType="search"
          />
          <Button title="Search" variant="secondary" onPress={search} loading={searching} />
        </View>

        {results.map((r) => (
          <Pressable
            key={r.place_id}
            style={styles.result}
            onPress={() => {
              setPickup(r);
              setResults([]);
              setQuery('');
            }}
          >
            <Body numberOfLines={2}>{r.address_text}</Body>
          </Pressable>
        ))}
      </Card>

      {/* --------------------------------------------- F.3 select type */}
      <Card>
        <H2>What is needed?</H2>
        <Small style={{ marginTop: 4, marginBottom: spacing.md }}>
          {nearby.length > 0
            ? `${nearby.length} ambulance${nearby.length === 1 ? '' : 's'} available near you`
            : 'Checking availability around you…'}
        </Small>

        {AMBULANCE_TYPES.map((t) => {
          const selected = ambulanceType === t.code;
          // An emergency can be answered by any class, so its count is every
          // ambulance nearby rather than the ones of one kind.
          const count = t.urgent
            ? nearby.length
            : nearby.filter((a) => a.ambulance_type === t.code).length;
          return (
            <Pressable
              key={t.code}
              onPress={() => setAmbulanceType(t.code)}
              style={[
                styles.typeCard,
                t.urgent && styles.typeCardUrgent,
                selected && styles.typeCardActive,
                selected && t.urgent && styles.typeCardUrgentActive,
              ]}
            >
              <Text style={{ fontSize: 26 }}>{t.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontSize: 15,
                    fontFamily: t.urgent ? FONT.bold : FONT.semibold,
                    color: selected ? colors.white : t.urgent ? colors.danger : colors.text,
                  }}
                >
                  {t.code} · {t.label}
                </Text>
                <Small numberOfLines={2}>{t.hint}</Small>
              </View>
              {count > 0 ? (
                <Pill label={`${count} free`} tone={t.urgent ? colors.danger : colors.ok} />
              ) : null}
            </Pressable>
          );
        })}
      </Card>

      {/* ------------------------------------------------ patient detail */}
      <Card>
        <H2>Patient details</H2>
        <View style={{ height: spacing.md }} />
        <Field
          label="Patient name (optional)"
          value={patientName}
          onChangeText={setPatientName}
          placeholder="Who is being picked up?"
        />
        <Field
          label="What is the emergency? (optional)"
          value={notes}
          onChangeText={setNotes}
          placeholder="e.g. Chest pain, conscious and breathing"
          multiline
          numberOfLines={3}
          style={{ minHeight: 80, textAlignVertical: 'top' }}
          hint="This is sent to the driver with the dispatch alert."
        />
      </Card>

      {/* --------------------------------------------------- F.10 fare */}
      {estimate ? (
        <Card>
          <H2>Indicative fare</H2>
          <View style={{ marginTop: spacing.sm }}>
            <FareRow label={`Base fare (${ambulanceType})`} value={money(estimate.base_fare)} />
            <FareRow label={`Distance ≈ ${estimate.basis_km} km`} value={money(estimate.distance_charge)} />
            {estimate.type_surcharge > 0 ? <FareRow label="Type surcharge" value={money(estimate.type_surcharge)} /> : null}
            <FareRow label={`Tax (${estimate.tax_percent}%)`} value={money(estimate.tax_amount)} />
            <View style={styles.divider} />
            <FareRow label="Estimated total" value={money(estimate.fare_amount)} bold />
          </View>
          <Small style={{ marginTop: spacing.sm }}>
            The final invoice is calculated from the distance actually travelled.
          </Small>
        </Card>
      ) : null}

      <Button
        title={placing ? 'Sending your request…' : `Request ${ambulanceType} ambulance`}
        icon="🚨"
        onPress={() =>
          confirmAction(
            {
              title: 'Confirm request',
              message: `Send a ${ambulanceType} ambulance to:\n${pickup?.address_text || 'your pin'}`,
              confirmLabel: 'Send request',
              destructive: true,
            },
            placeBooking
          )
        }
        loading={placing}
        disabled={!pickup}
      />

      <Small style={{ textAlign: 'center', marginTop: spacing.md, color: colors.warn }}>
        In a life-threatening emergency also call 108 directly.
      </Small>
    </ScrollView>
  );
}

function FareRow({ label, value, bold }) {
  return (
    <View style={styles.fareRow}>
      <Text style={[typo.small, bold && { color: colors.text, fontFamily: FONT.bold }]}>{label}</Text>
      <Text style={[typo.body, bold && { fontFamily: FONT.bold, fontSize: 17 }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pickupRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    paddingVertical: spacing.md,
  },
  result: {
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  typeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg,
    marginBottom: spacing.sm,
  },
  typeCardActive: { borderColor: colors.accent, backgroundColor: colors.surface2 },
  // An emergency is not a considered choice between care levels, so it does
  // not look like one.
  typeCardUrgent: { borderColor: colors.danger, borderWidth: 1.5 },
  typeCardUrgentActive: { borderColor: colors.danger, backgroundColor: colors.surface2 },
  fareRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: spacing.sm },
});
