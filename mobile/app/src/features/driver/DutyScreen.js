import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { readPosition as readDevicePosition } from '../../lib/location';
import { offerAlert } from '../../lib/alerts';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useResync, useSocketEvent } from '../../lib/socket';
import { confirmAction } from '../../lib/confirm';
import { LOCATION_PING_MS } from '../../lib/config';
import { FONT, colors, radius, relative, spacing, typo } from '../../lib/theme';
import { Banner, Button, Card, EmptyState, H2, Loading, Pill, Row, Small } from '../../components/ui';
import MapPanel from '../../components/MapPanel';

/**
 * The dispatch console - F.6 (receive the offer), F.7 (accept or reject) and the
 * availability + position reporting that store D2 depends on.
 *
 * The offer arrives twice on purpose: over the socket the instant the backend
 * picks this ambulance, and in the REST inbox when the screen loads or the app
 * comes back. Socket events are not replayed, so a driver whose phone was asleep
 * would otherwise never learn about a live request (NF.1).
 */

/**
 * The socket payload nests the pickup point; the REST inbox returns the booking
 * columns flat. One shape downstream so the card does not have to know which
 * path an offer arrived on.
 */
function normaliseOffer(o) {
  return {
    assignment_id: o.assignment_id,
    booking_id: o.booking_id,
    ambulance_type: o.ambulance_type,
    latitude: o.pickup?.latitude ?? o.latitude,
    longitude: o.pickup?.longitude ?? o.longitude,
    address_text: o.pickup?.address_text ?? o.address_text,
    landmark: o.pickup?.landmark ?? o.landmark,
    patient_name: o.patient_name,
    notes: o.notes,
    distance_km: o.distance_km,
    rank_score: o.rank_score,
    offer_expiry_timestamp: o.offer_expiry_timestamp,
    booking_timestamp: o.booking_timestamp,
    // An emergency went to every ambulance nearby at once, so this one is not
    // reserved for this driver. Saying so changes what they do with the 45
    // seconds: hesitating costs them the job rather than delaying it.
    broadcast: Boolean(o.broadcast),
  };
}

const secondsLeft = (offer) =>
  Math.max(0, Math.round((new Date(offer.offer_expiry_timestamp).getTime() - Date.now()) / 1000));

export default function DutyScreen({ navigation }) {
  const { provider, refreshProvider } = useAuth();

  const [availability, setAvailability] = useState(provider?.availability_status || 'OFFLINE');
  const [offers, setOffers] = useState([]);
  const [position, setPosition] = useState(
    provider?.latitude != null ? { latitude: provider.latitude, longitude: provider.longitude } : null
  );
  const [lastPing, setLastPing] = useState(provider?.last_seen_timestamp || null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [acting, setActing] = useState(null);      // assignment_id being answered
  const [gpsDenied, setGpsDenied] = useState(false);
  const [pingError, setPingError] = useState('');
  const [, setTick] = useState(0);                 // drives the countdown re-render

  const pingTimer = useRef(null);
  const positionRef = useRef(position);
  positionRef.current = position;

  // Recomputed on every render, which the ticker above guarantees happens
  // while on duty even when nothing else changes.
  const pingAgeSeconds = lastPing ? Math.round((Date.now() - new Date(lastPing).getTime()) / 1000) : null;

  const verified = provider?.verification_status === 'VERIFIED';
  const onDuty = availability === 'AVAILABLE';
  const onTrip = availability === 'BUSY';

  // ------------------------------------------------------------ loading
  const load = useCallback(async () => {
    setError('');
    try {
      const me = await api.get('/api/provider/me');
      if (me.provider) {
        setAvailability(me.provider.availability_status);
        if (me.provider.latitude != null) {
          setPosition({ latitude: me.provider.latitude, longitude: me.provider.longitude });
        }
        setLastPing(me.provider.last_seen_timestamp);
      }
      // The screen's lock reads `provider` from the auth context, not from
      // this response, so a status that has moved has to be put back there or
      // the console stays locked against its own fresh evidence. This is what
      // "Check again" was failing to do: it fetched the right answer and threw
      // away the one field that mattered.
      if (me.provider && me.provider.verification_status !== provider?.verification_status) {
        await refreshProvider().catch(() => {});
      }

      // The inbox is only reachable once the vehicle is verified.
      if (me.provider?.verification_status === 'VERIFIED') {
        const r = await api.get('/api/provider/offers');
        setOffers(r.offers.map(normaliseOffer));
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [provider?.verification_status, refreshProvider]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useResync(load, [load]);

  // --------------------------------------------------------- live events
  useSocketEvent('offer:new', (payload) => {
    const offer = normaliseOffer(payload);
    setOffers((prev) => [offer, ...prev.filter((o) => o.assignment_id !== offer.assignment_id)]);

    // The card appearing is not an alert: a driver is not watching the screen,
    // and the offer expires in 45 seconds. This raises a real notification
    // from the device itself - banner, sound, vibration - which needs no push
    // service and so works in this build today.
    //
    // It only fires while the app is running, because the socket that carried
    // the offer dies with the process. Reaching a closed app is what FCM is
    // for.
    offerAlert(offer);
  }, []);

  useSocketEvent('offer:closed', ({ assignment_id, result }) => {
    setOffers((prev) => prev.filter((o) => o.assignment_id !== assignment_id));
    // On an emergency several drivers hold the same offer, so one of them will
    // see their card vanish mid-countdown. Say why, or it looks like a fault.
    if (result === 'TAKEN') setNotice('Another ambulance accepted that emergency first.');
  }, []);

  useSocketEvent('booking:cancelled', ({ booking_id, reason }) => {
    setOffers((prev) => prev.filter((o) => o.booking_id !== booking_id));
    setNotice(`Booking ${booking_id} was cancelled: ${reason}`);
    load();
  }, [load]);

  // F.13: an administrator changing the verification status unlocks (or locks)
  // the console without the driver restarting the app.
  useSocketEvent('provider:verification', () => {
    refreshProvider().catch(() => {});
    load();
  }, [load]);

  // The recovery sweep took this ambulance off duty for not reporting.
  useSocketEvent('provider:auto-offline', () => {
    setAvailability('OFFLINE');
    stopPinging();
    setNotice('You were taken off duty because the app stopped reporting its position. Go on duty again to receive requests.');
  }, []);

  // One ticker for every countdown, and it drops offers the moment they expire
  // so the driver is never looking at a request the backend has moved on from.
  useEffect(() => {
    if (offers.length === 0) return undefined;
    const t = setInterval(() => {
      setOffers((prev) => prev.filter((o) => secondsLeft(o) > 0));
      setTick((n) => n + 1);
    }, 1000);
    return () => clearInterval(t);
  }, [offers.length]);

  /**
   * Ages the "last reported" line while on duty.
   *
   * It is derived at render time, and the only thing that used to re-render
   * this screen was a successful ping — so when pings started failing the
   * clock froze on "just now" and went on claiming the ambulance was
   * reporting. A console that lies in that direction is worse than one that
   * shows nothing.
   */
  useEffect(() => {
    if (!onDuty && !onTrip) return undefined;
    const t = setInterval(() => setTick((n) => n + 1), 10_000);
    return () => clearInterval(t);
  }, [onDuty, onTrip]);

  // -------------------------------------------------- position reporting
  /**
   * Asks for location permission only when it is not already held. The ping
   * loop runs every 20 seconds, and prompting on each pass would either nag the
   * driver or, once they have refused, throw on every tick for nothing.
   */
  const readPosition = useCallback(async () => {
    try {
      const pos = await readDevicePosition();
      setGpsDenied(false);
      return pos;
    } catch (err) {
      // A refusal is a state the screen shows; everything else is a message.
      if (err.code === 'DENIED') setGpsDenied(true);
      throw err;
    }
  }, []);

  const sendPing = useCallback(async (coords) => {
    const body = coords || positionRef.current;
    if (!body) return;
    try {
      const r = await api.post('/api/provider/location', {
        latitude: body.latitude,
        longitude: body.longitude,
        ...(body.speed_kmph !== undefined ? { speed_kmph: body.speed_kmph } : {}),
      });
      setPosition({ latitude: body.latitude, longitude: body.longitude });
      setLastPing(new Date().toISOString());
      setPingError('');
      return r;
    } catch (e) {
      // A failed ping has to be visible. Dispatch stops considering an
      // ambulance whose position goes stale, so a driver who believes they are
      // reporting while nothing is arriving is the worst state to be in.
      setPingError(e.message);
      throw e;
    }
  }, []);

  function stopPinging() {
    if (pingTimer.current) clearInterval(pingTimer.current);
    pingTimer.current = null;
  }

  /**
   * While on duty the console reports even when the vehicle is parked. A fix
   * older than PROVIDER_STALE_MINUTES makes the ambulance invisible to the
   * matcher and eventually retires it, so silence is not an option (C.6).
   */
  const startPinging = useCallback(() => {
    stopPinging();
    pingTimer.current = setInterval(() => {
      // If the fix cannot be read, still report the last known pin — a stale
      // position the matcher can see beats none at all. Only a failed *send*
      // is an error, and sendPing surfaces that itself.
      readPosition()
        .then(sendPing)
        .catch(() => sendPing())
        .catch(() => {});
    }, LOCATION_PING_MS);
  }, [readPosition, sendPing]);

  // Keep pinging across an accepted trip too - that is what moves the ambulance
  // on the patient's map (F.8).
  useEffect(() => {
    if (verified && (onDuty || onTrip)) startPinging();
    else stopPinging();
    return stopPinging;
  }, [verified, onDuty, onTrip, startPinging]);

  // ------------------------------------------------------------ actions
  async function toggleDuty(next) {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      let coords = positionRef.current;
      if (next) {
        // Going on duty without a position would put an ambulance in the fleet
        // that the matcher can never rank, so the fix comes first.
        try {
          coords = await readPosition();
        } catch (e) {
          if (!coords) throw e;
          setNotice(`${e.message} Using your last known position for now.`);
        }
      }

      await api.post('/api/provider/availability', {
        availability_status: next ? 'AVAILABLE' : 'OFFLINE',
      });
      setAvailability(next ? 'AVAILABLE' : 'OFFLINE');

      if (next && coords) await sendPing(coords);
      if (!next) setOffers([]);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function respond(offer, accept) {
    setError('');
    setActing(offer.assignment_id);
    try {
      const path = `/api/provider/offers/${offer.assignment_id}/${accept ? 'accept' : 'reject'}`;
      await api.post(path, accept ? undefined : { reason: 'Declined by driver' });
      setOffers((prev) => prev.filter((o) => o.assignment_id !== offer.assignment_id));
      if (accept) {
        setAvailability('BUSY');
        navigation.navigate('Trip');
      }
    } catch (e) {
      // A lost race is normal, not a fault: the offer moved on while the driver
      // was deciding. Clear it and say so plainly.
      setError(e.message);
      if (e.status === 409 || e.status === 404) {
        setOffers((prev) => prev.filter((o) => o.assignment_id !== offer.assignment_id));
      }
    } finally {
      setActing(null);
    }
  }

  async function setPinManually(latitude, longitude) {
    setError('');
    try {
      await sendPing({ latitude: Number(latitude.toFixed(6)), longitude: Number(longitude.toFixed(6)) });
      setNotice('Position set from the map.');
    } catch (e) {
      setError(e.message);
    }
  }

  // -------------------------------------------------------------- render
  if (loading) return <Loading text="Opening the console…" />;

  // C.6 / F.13: an unverified vehicle receives nothing at all.
  if (!verified) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={{ padding: spacing.lg }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.accent} />}
      >
        <Card style={{ borderColor: colors.warn }}>
          <View style={styles.headRow}>
            <H2>Waiting for verification</H2>
            <Pill label={provider?.verification_status || 'PENDING'} />
          </View>
          <Small style={{ marginTop: spacing.sm, lineHeight: 19 }}>
            An administrator has to check your documents before you can go on duty
            or receive requests. You will be notified the moment that happens —
            this screen unlocks on its own.
          </Small>
          {provider?.remarks ? <Banner kind="warn">Control room note: {provider.remarks}</Banner> : null}
          <View style={{ marginTop: spacing.md }}>
            <Row label="Vehicle" value={provider?.vehicle_reg_no} />
            <Row label="Type" value={provider?.ambulance_type} />
          </View>
          <Button title="Check again" variant="secondary" style={{ marginTop: spacing.md }} onPress={load} />
        </Card>
      </ScrollView>
    );
  }

  const markers = position
    ? [{ ...position, color: onDuty ? colors.ok : colors.muted, label: 'You', radius: 11 }]
    : [];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl * 2 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.accent} />}
    >
      <Banner kind="error">{error}</Banner>
      <Banner kind="warn">{notice}</Banner>

      {/* ------------------------------------------------ duty toggle */}
      <Card style={onDuty ? { borderColor: colors.ok } : undefined}>
        <View style={styles.headRow}>
          <View style={{ flex: 1 }}>
            <H2>{onTrip ? 'On a trip' : onDuty ? 'On duty' : 'Off duty'}</H2>
            <Small style={{ marginTop: 4 }}>
              {onTrip
                ? 'You are running a trip. Availability is locked until it is finished.'
                : onDuty
                  ? 'You are in the dispatch pool and reporting your position.'
                  : 'You will not receive any requests while you are off duty.'}
            </Small>
          </View>
          <Switch
            value={onDuty || onTrip}
            disabled={busy || onTrip}
            onValueChange={(next) =>
              next
                ? toggleDuty(true)
                : confirmAction(
                    {
                      title: 'Go off duty?',
                      message: 'You will stop receiving ambulance requests.',
                      confirmLabel: 'Go off duty',
                      cancelLabel: 'Stay on duty',
                      destructive: true,
                    },
                    () => toggleDuty(false)
                  )
            }
            trackColor={{ false: colors.line, true: `${colors.ok}88` }}
            thumbColor={onDuty || onTrip ? colors.ok : colors.muted}
          />
        </View>

        <View style={{ marginTop: spacing.md }}>
          <Row label="Vehicle" value={`${provider?.vehicle_reg_no} · ${provider?.ambulance_type}`} />
          <Row
            label="Position last reported"
            value={lastPing ? relative(lastPing) : 'never'}
            valueStyle={!lastPing || pingAgeSeconds > 60 ? { color: colors.warn } : undefined}
          />
        </View>

        {pingError ? (
          <Banner kind="error">
            Your position is not reaching the control room: {pingError}
            {pingAgeSeconds != null ? ` Last accepted ${relative(lastPing)}.` : ''}
          </Banner>
        ) : null}
      </Card>

      {/* ------------------------------------------------ live offers */}
      {offers.length > 0 ? (
        offers.map((offer) => {
          const left = secondsLeft(offer);
          return (
            <Card
              key={offer.assignment_id}
              style={{
                borderColor: offer.broadcast ? colors.danger : colors.accent,
                borderWidth: offer.broadcast ? 3 : 2,
              }}
            >
              <View style={styles.headRow}>
                <Pill
                  label={offer.broadcast ? '🚨 EMERGENCY' : `${offer.ambulance_type} REQUEST`}
                  tone={offer.broadcast ? colors.danger : colors.accent}
                />
                <View style={styles.countdown}>
                  <Text style={styles.countdownValue}>{left}</Text>
                  <Small style={typo.tiny}>sec</Small>
                </View>
              </View>

              {offer.broadcast ? (
                <Small style={{ marginTop: spacing.sm, color: colors.danger, fontFamily: FONT.bold }}>
                  Sent to every ambulance nearby — first to accept takes it.
                </Small>
              ) : null}

              <H2 style={{ marginTop: spacing.sm }}>
                {offer.address_text || `${offer.latitude}, ${offer.longitude}`}
              </H2>

              <View style={{ marginTop: spacing.sm }}>
                {offer.distance_km != null ? <Row label="Distance" value={`${offer.distance_km} km away`} /> : null}
                {offer.landmark ? <Row label="Landmark" value={offer.landmark} /> : null}
                {offer.patient_name ? <Row label="Patient" value={offer.patient_name} /> : null}
                {offer.notes ? <Row label="Notes" value={offer.notes} /> : null}
                <Row label="Requested" value={relative(offer.booking_timestamp)} />
              </View>

              {offer.latitude != null ? (
                <View style={{ marginTop: spacing.md }}>
                  <MapPanel
                    markers={[
                      { latitude: offer.latitude, longitude: offer.longitude, color: colors.accent, label: 'Pickup', radius: 11 },
                      ...markers,
                    ]}
                    height={180}
                  />
                </View>
              ) : null}

              <Button
                title="Accept this request"
                variant="success"
                style={{ marginTop: spacing.md }}
                loading={acting === offer.assignment_id}
                onPress={() => respond(offer, true)}
              />
              <Button
                title="Decline"
                variant="ghost"
                style={{ marginTop: spacing.sm }}
                disabled={acting === offer.assignment_id}
                onPress={() =>
                  confirmAction(
                    {
                      title: 'Decline this request?',
                      message: 'It will be offered to the next nearest ambulance straight away.',
                      confirmLabel: 'Decline',
                      cancelLabel: 'Keep it',
                      destructive: true,
                    },
                    () => respond(offer, false)
                  )
                }
              />
            </Card>
          );
        })
      ) : (
        <Card>
          {onTrip ? (
            <EmptyState
              icon="🛣️"
              title="Trip in progress"
              hint="Finish the trip you are on before the next request can reach you."
            />
          ) : onDuty ? (
            <EmptyState
              icon="📡"
              title="Waiting for a request"
              hint="You are in the dispatch pool. A request will appear here with 45 seconds to answer, and your phone stays awake while you wait."
            />
          ) : (
            <EmptyState
              icon="😴"
              title="You are off duty"
              hint="Turn on duty above to start receiving ambulance requests."
            />
          )}
        </Card>
      )}

      {onTrip ? (
        <Button title="Open the active trip" onPress={() => navigation.navigate('Trip')} />
      ) : null}

      {/* --------------------------------- position, and the GPS fallback */}
      <Card>
        <H2>Your position</H2>
        <Small style={{ marginTop: 4, marginBottom: spacing.md }}>
          {gpsDenied
            ? 'Location permission was declined. Tap the map to set where you are.'
            : 'Reported automatically while you are on duty. Tap the map to correct it.'}
        </Small>
        <MapPanel markers={markers} height={220} onPick={setPinManually} />
        {position ? (
          <Small style={{ marginTop: spacing.sm }}>
            {position.latitude.toFixed(5)}, {position.longitude.toFixed(5)}
            {lastPing ? ` · reported ${relative(lastPing)}` : ''}
          </Small>
        ) : (
          <Banner kind="warn">
            No position reported yet. Dispatch cannot rank an ambulance it cannot locate.
          </Banner>
        )}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  countdown: {
    alignItems: 'center',
    minWidth: 54,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  countdownValue: { fontSize: 26, fontFamily: FONT.bold, color: colors.accent, lineHeight: 29 },
});
