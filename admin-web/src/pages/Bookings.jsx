import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { Banner, Empty, Status, fmtDuration, fmtTime, relative } from '../components/ui.jsx';

const STATUSES = ['REQUESTED', 'MATCHING', 'ASSIGNED', 'ENROUTE', 'ARRIVED', 'ONBOARD', 'COMPLETED', 'CANCELLED', 'FAILED'];
const TYPES = ['BLS', 'ALS', 'ICU', 'PTV'];

// F.13 / DFD 0.6.2 - monitor active and past bookings.
export default function Bookings() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ booking_status: '', ambulance_type: '', active: false, q: '', from_date: '', to_date: '' });

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (filters.booking_status) params.set('booking_status', filters.booking_status);
    if (filters.ambulance_type) params.set('ambulance_type', filters.ambulance_type);
    if (filters.active) params.set('active', 'true');
    if (filters.q.trim()) params.set('q', filters.q.trim());
    if (filters.from_date) params.set('from_date', filters.from_date);
    if (filters.to_date) params.set('to_date', filters.to_date);

    api
      .get(`/api/admin/bookings?${params.toString()}`)
      .then((r) => setRows(r.bookings))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [filters]);

  useEffect(() => {
    load();
    const socket = getSocket();
    if (!socket) return;
    socket.on('admin:booking:new', load);
    socket.on('admin:booking:update', load);
    return () => {
      socket.off('admin:booking:new', load);
      socket.off('admin:booking:update', load);
    };
  }, [load]);

  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Bookings</h1>
          <p>Every request, its dispatch decisions and its outcome — {rows.length} shown</p>
        </div>
      </div>

      <Banner kind="error">{error}</Banner>

      <div className="filters card">
        <label className="field">
          <span>Search</span>
          <input value={filters.q} onChange={set('q')} placeholder="Booking id, address, patient" />
        </label>
        <label className="field">
          <span>Status</span>
          <select value={filters.booking_status} onChange={set('booking_status')}>
            <option value="">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Type</span>
          <select value={filters.ambulance_type} onChange={set('ambulance_type')}>
            <option value="">All</option>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="field">
          <span>From</span>
          <input type="date" value={filters.from_date} onChange={set('from_date')} />
        </label>
        <label className="field">
          <span>To</span>
          <input type="date" value={filters.to_date} onChange={set('to_date')} />
        </label>
        <label className="field" style={{ minWidth: 'auto' }}>
          <span>Live only</span>
          <input type="checkbox" style={{ width: 18, height: 18 }} checked={filters.active} onChange={set('active')} />
        </label>
        <button className="btn" onClick={load}>Refresh</button>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Booking</th>
                <th>Patient</th>
                <th>Type</th>
                <th>Pickup</th>
                <th>Status</th>
                <th>Ambulance</th>
                <th>Response</th>
                <th>Placed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.booking_id}>
                  <td className="mono">
                    <Link to={`/bookings/${b.booking_id}`} style={{ color: '#8db4ff' }}>{b.booking_id}</Link>
                  </td>
                  <td>
                    {b.patient_full_name}
                    <div className="dim mono" style={{ fontSize: 11.5 }}>{b.patient_phone}</div>
                  </td>
                  <td><span className="pill grey">{b.ambulance_type}</span></td>
                  <td style={{ maxWidth: 260 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {b.address_text || `${b.latitude}, ${b.longitude}`}
                    </div>
                    {b.landmark ? <div className="dim" style={{ fontSize: 11.5 }}>{b.landmark}</div> : null}
                  </td>
                  <td>
                    <Status value={b.booking_status} />
                    {/* Set by the recovery sweep when the crew stops reporting. */}
                    {b.stall_flagged_at ? (
                      <div style={{ marginTop: 4 }}>
                        <span className="pill red" title={`Last contact before ${fmtTime(b.stall_flagged_at)}`}>
                          LOST CONTACT
                        </span>
                      </div>
                    ) : null}
                  </td>
                  <td className="dim">
                    {b.provider ? (
                      <>
                        <div>{b.provider.vehicle_reg_no}</div>
                        <div style={{ fontSize: 11.5 }}>{b.provider.driver_name}</div>
                      </>
                    ) : '—'}
                  </td>
                  <td>{fmtDuration(b.response_time_sec)}</td>
                  <td className="dim" title={fmtTime(b.booking_timestamp)}>{relative(b.booking_timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && rows.length === 0 && <Empty>No bookings match these filters</Empty>}
          {loading && <Empty>Loading…</Empty>}
        </div>
      </div>
    </>
  );
}
