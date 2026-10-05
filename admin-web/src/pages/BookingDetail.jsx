import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { Banner, Empty, MapView, Status, fmtDuration, fmtMoney, fmtTime } from '../components/ui.jsx';

// Full case file for one booking: dispatch attempts, GPS trace, invoice,
// feedback and every alert that went out (supports C.5 dispute resolution).
export default function BookingDetail() {
  const { bookingId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get(`/api/admin/bookings/${bookingId}`).then(setData).catch((e) => setError(e.message));
  }, [bookingId]);

  useEffect(() => {
    load();
    const socket = getSocket();
    if (!socket) return;
    const refresh = (e) => {
      if (!e?.booking_id || e.booking_id === bookingId) load();
    };
    ['admin:booking:update', 'admin:dispatch', 'admin:trip:location', 'admin:trip:status'].forEach((ev) => socket.on(ev, refresh));
    return () => {
      ['admin:booking:update', 'admin:dispatch', 'admin:trip:location', 'admin:trip:status'].forEach((ev) => socket.off(ev, refresh));
    };
  }, [bookingId, load]);

  const markers = useMemo(() => {
    if (!data) return [];
    const b = data.booking;
    const out = [{
      id: 'pickup', latitude: b.latitude, longitude: b.longitude, color: '#e63946',
      label: 'Pickup', popup: `<b>Pickup</b><br/>${b.address_text || ''}`,
    }];
    if (b.drop_latitude) {
      out.push({ id: 'drop', latitude: b.drop_latitude, longitude: b.drop_longitude, color: '#f5a524', label: 'Drop' });
    }
    const last = data.locations?.[0];
    if (last) {
      out.push({
        id: 'ambulance', latitude: last.latitude, longitude: last.longitude, color: '#2ec27e',
        label: 'Ambulance', popup: `<b>Ambulance</b><br/>${fmtTime(last.gps_timestamp)}`,
      });
    }
    return out;
  }, [data]);

  const trace = useMemo(
    () => (data?.locations || []).slice().reverse().map((l) => [l.latitude, l.longitude]),
    [data]
  );

  async function action(path, body, message) {
    setBusy(true);
    setError('');
    try {
      await api.post(path, body);
      setNotice(message);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) return <Banner kind="error">{error}</Banner>;
  if (!data) return <Empty>Loading booking…</Empty>;

  const b = data.booking;
  const isOpen = ['REQUESTED', 'MATCHING', 'ASSIGNED', 'ENROUTE', 'ARRIVED', 'ONBOARD'].includes(b.booking_status);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="mono">{b.booking_id}</h1>
          <p>
            <Status value={b.booking_status} /> · {b.ambulance_type} · placed {fmtTime(b.booking_timestamp)}
          </p>
        </div>
        <div className="btn-row">
          <Link className="btn" to="/bookings">Back to list</Link>
          {b.booking_status === 'FAILED' && (
            <button className="btn primary" disabled={busy}
                    onClick={() => action(`/api/admin/bookings/${b.booking_id}/redispatch`, {}, 'Re-dispatch started')}>
              Re-dispatch
            </button>
          )}
          {isOpen && (
            <button className="btn" disabled={busy}
                    onClick={() => {
                      const reason = prompt('Reason for cancelling this booking?');
                      if (reason) action(`/api/admin/bookings/${b.booking_id}/cancel`, { reason }, 'Booking cancelled');
                    }}>
              Cancel booking
            </button>
          )}
        </div>
      </div>

      <Banner kind="error">{error}</Banner>
      <Banner kind="ok">{notice}</Banner>

      <div className="grid cols-2">
        <div className="card">
          <h3>Request</h3>
          <dl className="kv">
            <dt>Patient</dt>
            <dd>{data.patient.full_name} <span className="dim mono">{data.patient.phone_no}</span></dd>
            <dt>On-scene name</dt><dd>{b.patient_name || '—'}</dd>
            <dt>Contact given</dt><dd className="mono">{b.contact_phone || '—'}</dd>
            <dt>Ambulance type</dt><dd>{b.ambulance_type}</dd>
            <dt>Pickup</dt><dd>{b.address_text || '—'}</dd>
            <dt>Landmark</dt><dd>{b.landmark || '—'}</dd>
            <dt>Pincode</dt><dd>{b.pincode || '—'}</dd>
            <dt>Coordinates</dt><dd className="mono">{b.latitude}, {b.longitude}</dd>
            <dt>Notes</dt><dd>{b.notes || '—'}</dd>
            <dt>Dispatch attempts</dt><dd>{b.retry_count}</dd>
            <dt>Response time</dt><dd>{fmtDuration(b.response_time_sec)}</dd>
            {b.cancelled_reason ? (<><dt>Closed because</dt><dd>{b.cancelled_reason}</dd></>) : null}
          </dl>
        </div>

        <div className="card">
          <h3>Location and trace</h3>
          <MapView markers={markers} polyline={trace} className="map map-sm" />
          {b.provider ? (
            <dl className="kv" style={{ marginTop: 14 }}>
              <dt>Ambulance</dt>
              <dd>
                <Link to={`/providers/${b.provider.provider_id}`} style={{ color: '#8db4ff' }}>
                  {b.provider.vehicle_reg_no}
                </Link> · {b.provider.ambulance_type}
              </dd>
              <dt>Driver</dt><dd>{b.provider.driver_name} <span className="dim mono">{b.provider.phone_no}</span></dd>
              <dt>Rating</dt><dd>{b.provider.rating} ★</dd>
              <dt>Trip milestone</dt><dd><Status value={b.trip?.trip_milestone} /></dd>
              <dt>ETA</dt><dd>{b.trip?.eta_minutes != null ? `${b.trip.eta_minutes} min` : '—'}</dd>
              <dt>Route distance</dt><dd>{b.trip?.route_distance_km != null ? `${b.trip.route_distance_km} km` : '—'}</dd>
            </dl>
          ) : (
            <p className="dim" style={{ marginTop: 14, marginBottom: 0 }}>No ambulance assigned yet.</p>
          )}
        </div>

        <div className="card">
          <h3>Dispatch attempts (F.5 – F.7)</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Assignment</th><th>Ambulance</th><th>Rank</th><th>Distance</th><th>Result</th><th>Answered</th></tr>
              </thead>
              <tbody>
                {data.assignments.map((a) => (
                  <tr key={a.assignment_id}>
                    <td className="mono">{a.assignment_id}</td>
                    <td>
                      {a.vehicle_reg_no}
                      <div className="dim" style={{ fontSize: 11.5 }}>{a.driver_name}</div>
                    </td>
                    <td>{a.rank_score}</td>
                    <td>{a.distance_km} km</td>
                    <td><Status value={a.assignment_status} /></td>
                    <td className="dim">{a.response_timestamp ? fmtTime(a.response_timestamp) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.assignments.length === 0 && <Empty>No offers were sent yet</Empty>}
          </div>
        </div>

        <div className="card">
          <h3>Billing and feedback</h3>
          {data.invoice ? (
            <dl className="kv">
              <dt>Invoice</dt><dd className="mono">{data.invoice.invoice_id}</dd>
              <dt>Base fare</dt><dd>{fmtMoney(data.invoice.base_fare)}</dd>
              <dt>Distance charge</dt><dd>{fmtMoney(data.invoice.distance_charge)} <span className="dim">({data.invoice.distance_km} km)</span></dd>
              <dt>Type surcharge</dt><dd>{fmtMoney(data.invoice.type_surcharge)}</dd>
              <dt>Tax</dt><dd>{fmtMoney(data.invoice.tax_amount)}</dd>
              <dt>Total</dt><dd><strong>{fmtMoney(data.invoice.fare_amount)}</strong></dd>
              <dt>Payment</dt>
              <dd><Status value={data.invoice.payment_status} /> {data.invoice.payment_mode ? `· ${data.invoice.payment_mode}` : ''}</dd>
              <dt>Reference</dt><dd className="mono">{data.invoice.transaction_ref || '—'}</dd>
            </dl>
          ) : (
            <p className="dim">No invoice raised yet.</p>
          )}

          <h3 style={{ marginTop: 18 }}>Feedback (F.12)</h3>
          {data.rating ? (
            <p style={{ margin: 0 }}>
              <strong>{'★'.repeat(data.rating.rating_value)}</strong>
              <span className="dim">{'★'.repeat(5 - data.rating.rating_value)}</span>
              <br />
              {data.rating.feedback_text || <span className="dim">No comment left.</span>}
            </p>
          ) : (
            <p className="dim" style={{ margin: 0 }}>Not rated.</p>
          )}
        </div>

        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <h3>Alerts sent for this booking (F.6, F.14)</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Sent</th><th>Channel</th><th>Template</th><th>To</th><th>Delivery</th><th>Message</th></tr>
              </thead>
              <tbody>
                {data.messages.map((m) => (
                  <tr key={m.message_id}>
                    <td className="dim">{fmtTime(m.created_at)}</td>
                    <td><span className="pill blue">{m.message_channel}</span></td>
                    <td className="dim mono" style={{ fontSize: 11.5 }}>{m.message_template_id || '—'}</td>
                    <td className="mono">{m.recipient_phone}</td>
                    <td><Status value={m.delivery_state} /></td>
                    <td style={{ maxWidth: 420, whiteSpace: 'pre-wrap', fontSize: 12.5 }}>{m.body}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.messages.length === 0 && <Empty>No alerts recorded</Empty>}
          </div>
        </div>
      </div>
    </>
  );
}
