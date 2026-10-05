import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { Banner, Empty, Status, relative } from '../components/ui.jsx';

// F.13 / DFD 0.6.1 - verify and manage driver and organisation accounts.
export default function Providers() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [filters, setFilters] = useState({ verification_status: '', ambulance_type: '', availability_status: '', q: '' });

  const load = useCallback(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
    api.get(`/api/admin/providers?${params}`).then((r) => setRows(r.providers)).catch((e) => setError(e.message));
  }, [filters]);

  useEffect(() => {
    load();
    const socket = getSocket();
    if (!socket) return;
    socket.on('admin:provider:new', load);
    socket.on('admin:provider:update', load);
    return () => {
      socket.off('admin:provider:new', load);
      socket.off('admin:provider:update', load);
    };
  }, [load]);

  async function decide(provider, verification_status) {
    const remarks =
      verification_status === 'VERIFIED'
        ? 'Documents checked and approved'
        : prompt(`Reason for marking ${provider.vehicle_reg_no} as ${verification_status}?`);
    if (verification_status !== 'VERIFIED' && !remarks) return;

    setBusyId(provider.provider_id);
    setError('');
    try {
      await api.post(`/api/admin/providers/${provider.provider_id}/verification`, { verification_status, remarks });
      setNotice(`${provider.vehicle_reg_no} marked ${verification_status}. The driver has been notified.`);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const pending = rows.filter((r) => r.verification_status === 'PENDING').length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Drivers and organisations</h1>
          <p>{rows.length} provider accounts{pending > 0 ? ` · ${pending} waiting for verification` : ''}</p>
        </div>
      </div>

      <Banner kind="error">{error}</Banner>
      <Banner kind="ok">{notice}</Banner>

      <div className="filters card">
        <label className="field">
          <span>Search</span>
          <input value={filters.q} onChange={set('q')} placeholder="Name, phone or vehicle" />
        </label>
        <label className="field">
          <span>Verification</span>
          <select value={filters.verification_status} onChange={set('verification_status')}>
            <option value="">All</option>
            {['PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED'].map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Availability</span>
          <select value={filters.availability_status} onChange={set('availability_status')}>
            <option value="">All</option>
            {['AVAILABLE', 'BUSY', 'OFFLINE'].map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Type</span>
          <select value={filters.ambulance_type} onChange={set('ambulance_type')}>
            <option value="">All</option>
            {['BLS', 'ALS', 'ICU', 'PTV'].map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <button className="btn" onClick={load}>Refresh</button>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Provider</th><th>Driver</th><th>Vehicle</th><th>Type</th>
                <th>Verification</th><th>Duty</th><th>Rating</th><th>Trips</th><th>Last seen</th><th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.provider_id}>
                  <td className="mono">
                    <Link to={`/providers/${p.provider_id}`} style={{ color: '#8db4ff' }}>{p.provider_id}</Link>
                    {p.org_name ? <div className="dim" style={{ fontSize: 11.5 }}>{p.org_name}</div> : null}
                  </td>
                  <td>
                    {p.full_name}
                    <div className="dim mono" style={{ fontSize: 11.5 }}>{p.phone_no}</div>
                  </td>
                  <td className="mono">{p.vehicle_reg_no}</td>
                  <td><span className="pill grey">{p.ambulance_type}</span></td>
                  <td><Status value={p.verification_status} /></td>
                  <td><Status value={p.availability_status} /></td>
                  <td>{p.rating_count > 0 ? `${p.rating} ★` : <span className="dim">new</span>}</td>
                  <td>{p.trips_completed}</td>
                  <td className="dim">{p.last_seen_timestamp ? relative(p.last_seen_timestamp) : '—'}</td>
                  <td>
                    <div className="btn-row">
                      {p.verification_status !== 'VERIFIED' && (
                        <button className="btn small ok" disabled={busyId === p.provider_id} onClick={() => decide(p, 'VERIFIED')}>
                          Verify
                        </button>
                      )}
                      {p.verification_status === 'PENDING' && (
                        <button className="btn small" disabled={busyId === p.provider_id} onClick={() => decide(p, 'REJECTED')}>
                          Reject
                        </button>
                      )}
                      {p.verification_status === 'VERIFIED' && (
                        <button className="btn small" disabled={busyId === p.provider_id} onClick={() => decide(p, 'SUSPENDED')}>
                          Suspend
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <Empty>No providers match these filters</Empty>}
        </div>
      </div>
    </>
  );
}
