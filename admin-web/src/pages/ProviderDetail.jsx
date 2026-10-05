import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { Banner, Empty, MapView, Stat, Status, fmtDuration, fmtMoney, fmtTime, relative } from '../components/ui.jsx';

export default function ProviderDetail() {
  const { providerId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    api.get(`/api/admin/providers/${providerId}`).then(setData).catch((e) => setError(e.message));
  }, [providerId]);

  useEffect(load, [load]);

  async function decide(verification_status) {
    const remarks =
      verification_status === 'VERIFIED'
        ? 'Documents checked and approved'
        : prompt(`Reason for marking this provider ${verification_status}?`);
    if (verification_status !== 'VERIFIED' && !remarks) return;
    try {
      await api.post(`/api/admin/providers/${providerId}/verification`, { verification_status, remarks });
      setNotice(`Provider marked ${verification_status}`);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  if (error && !data) return <Banner kind="error">{error}</Banner>;
  if (!data) return <Empty>Loading provider…</Empty>;

  const p = data.provider;
  const stat = Object.fromEntries(data.offer_stats.map((s) => [s.assignment_status, s.n]));
  const offered = (stat.ACCEPTED || 0) + (stat.REJECTED || 0) + (stat.TIMEOUT || 0);
  const acceptRate = offered ? Math.round(((stat.ACCEPTED || 0) / offered) * 100) : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{p.vehicle_reg_no} <span className="dim" style={{ fontSize: 16 }}>{p.ambulance_type}</span></h1>
          <p>
            <span className="mono">{p.provider_id}</span> · {p.full_name} · <Status value={p.verification_status} />{' '}
            <Status value={p.availability_status} />
          </p>
        </div>
        <div className="btn-row">
          <Link className="btn" to="/providers">Back to list</Link>
          {p.verification_status !== 'VERIFIED' && <button className="btn ok" onClick={() => decide('VERIFIED')}>Verify</button>}
          {p.verification_status === 'VERIFIED' && <button className="btn" onClick={() => decide('SUSPENDED')}>Suspend</button>}
          {p.verification_status === 'PENDING' && <button className="btn" onClick={() => decide('REJECTED')}>Reject</button>}
        </div>
      </div>

      <Banner kind="error">{error}</Banner>
      <Banner kind="ok">{notice}</Banner>

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat label="Trips completed" value={p.trips_completed} />
        <Stat label="Rating" value={p.rating_count ? `${p.rating} ★` : '—'} sub={`${p.rating_count} ratings`} />
        <Stat label="Offers accepted" value={acceptRate == null ? '—' : `${acceptRate}%`}
              sub={`${stat.ACCEPTED || 0} accepted · ${stat.REJECTED || 0} declined · ${stat.TIMEOUT || 0} timed out`} />
        <Stat label="Last seen" value={p.last_seen_timestamp ? relative(p.last_seen_timestamp) : '—'} />
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h3>Account and vehicle</h3>
          <dl className="kv">
            <dt>Driver</dt><dd>{p.full_name}</dd>
            <dt>Phone</dt><dd className="mono">{p.phone_no}</dd>
            <dt>Role</dt><dd>{p.role_code === 'ORG' ? 'Organisation fleet' : 'Independent driver'}</dd>
            <dt>Organisation</dt><dd>{p.org_id || '—'}</dd>
            <dt>Vehicle</dt><dd className="mono">{p.vehicle_reg_no}</dd>
            <dt>Ambulance type</dt><dd>{p.ambulance_type}</dd>
            <dt>Licence</dt><dd className="mono">{p.licence_no || '—'}</dd>
            <dt>Document</dt>
            <dd>{p.document_ref ? <a href={p.document_ref} target="_blank" rel="noreferrer" style={{ color: '#8db4ff' }}>Open scan</a> : '—'}</dd>
            <dt>Registered</dt><dd>{fmtTime(p.created_at)}</dd>
            <dt>Admin remarks</dt><dd>{p.remarks || '—'}</dd>
          </dl>
        </div>

        <div className="card">
          <h3>Last known position</h3>
          {p.latitude != null ? (
            <MapView
              className="map map-sm"
              markers={[{ id: p.provider_id, latitude: p.latitude, longitude: p.longitude, color: '#2ec27e', label: p.vehicle_reg_no }]}
              zoom={13}
            />
          ) : (
            <Empty>This ambulance has never reported a position</Empty>
          )}
        </div>

        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <h3>Trip history</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Booking</th><th>Type</th><th>Status</th><th>Response</th><th>Fare</th><th>Payment</th><th>Rating</th><th>Placed</th></tr>
              </thead>
              <tbody>
                {data.trips.map((t) => (
                  <tr key={t.booking_id}>
                    <td className="mono">
                      <Link to={`/bookings/${t.booking_id}`} style={{ color: '#8db4ff' }}>{t.booking_id}</Link>
                    </td>
                    <td><span className="pill grey">{t.ambulance_type}</span></td>
                    <td><Status value={t.booking_status} /></td>
                    <td>{fmtDuration(t.response_time_sec)}</td>
                    <td>{fmtMoney(t.fare_amount)}</td>
                    <td><Status value={t.payment_status} /></td>
                    <td>
                      {t.rating_value ? `${t.rating_value} ★` : <span className="dim">—</span>}
                      {t.feedback_text ? <div className="dim" style={{ fontSize: 11.5, maxWidth: 240 }}>{t.feedback_text}</div> : null}
                    </td>
                    <td className="dim">{fmtTime(t.booking_timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.trips.length === 0 && <Empty>No trips assigned to this ambulance yet</Empty>}
          </div>
        </div>
      </div>
    </>
  );
}
