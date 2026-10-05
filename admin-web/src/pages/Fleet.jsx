import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { Banner, Empty, MapView, Stat, Status, relative } from '../components/ui.jsx';

const COLOR = { AVAILABLE: '#2ec27e', BUSY: '#4c8dff', OFFLINE: '#6b7a90' };

// Live fleet view. Positions arrive over the socket as drivers ping (F.8).
export default function Fleet() {
  const [fleet, setFleet] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [error, setError] = useState('');
  const [show, setShow] = useState({ AVAILABLE: true, BUSY: true, OFFLINE: false });

  const load = useCallback(() => {
    Promise.all([api.get('/api/admin/fleet'), api.get('/api/admin/bookings?active=true')])
      .then(([f, b]) => {
        setFleet(f.fleet);
        setBookings(b.bookings);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    const socket = getSocket();
    if (!socket) return;

    const onLocation = (e) => {
      setFleet((prev) =>
        prev.map((p) =>
          p.provider_id === e.provider_id
            ? { ...p, latitude: e.latitude, longitude: e.longitude, last_seen_timestamp: e.gps_timestamp }
            : p
        )
      );
    };
    socket.on('admin:trip:location', onLocation);
    socket.on('admin:provider:update', load);
    socket.on('admin:booking:update', load);
    const timer = setInterval(load, 25000);

    return () => {
      socket.off('admin:trip:location', onLocation);
      socket.off('admin:provider:update', load);
      socket.off('admin:booking:update', load);
      clearInterval(timer);
    };
  }, [load]);

  const markers = useMemo(() => {
    const amb = fleet
      .filter((p) => show[p.availability_status])
      .map((p) => ({
        id: p.provider_id,
        latitude: p.latitude,
        longitude: p.longitude,
        color: COLOR[p.availability_status],
        label: `${p.vehicle_reg_no} · ${p.ambulance_type}`,
        popup: `<b>${p.vehicle_reg_no}</b> (${p.ambulance_type})<br/>${p.driver_name}<br/>${p.availability_status}` +
               (p.active_booking_id ? `<br/>On booking ${p.active_booking_id}` : ''),
      }));

    const pickups = bookings.map((b) => ({
      id: b.booking_id,
      latitude: b.latitude,
      longitude: b.longitude,
      color: '#e63946',
      radius: 7,
      label: `Pickup ${b.booking_id}`,
      popup: `<b>${b.booking_id}</b><br/>${b.ambulance_type} · ${b.booking_status}<br/>${b.address_text || ''}`,
    }));

    return [...amb, ...pickups];
  }, [fleet, bookings, show]);

  const counts = fleet.reduce((acc, p) => ({ ...acc, [p.availability_status]: (acc[p.availability_status] || 0) + 1 }), {});

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Fleet map</h1>
          <p><span className="live-dot" /> Positions update as drivers report GPS</p>
        </div>
        <div className="btn-row">
          {['AVAILABLE', 'BUSY', 'OFFLINE'].map((s) => (
            <button
              key={s}
              className={`btn small${show[s] ? ' primary' : ''}`}
              onClick={() => setShow((v) => ({ ...v, [s]: !v[s] }))}
            >
              {s} ({counts[s] || 0})
            </button>
          ))}
        </div>
      </div>

      <Banner kind="error">{error}</Banner>

      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <Stat label="Free ambulances" value={counts.AVAILABLE || 0} />
        <Stat label="On a trip" value={counts.BUSY || 0} />
        <Stat label="Off duty" value={counts.OFFLINE || 0} />
        <Stat label="Live pickups" value={bookings.length} alert={bookings.length > 0} />
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        {markers.length > 0 ? <MapView markers={markers} /> : <Empty>No positions to show</Empty>}
        <p className="dim" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
          Green = available · Blue = on a trip · Grey = off duty · Red = an active pickup point
        </p>
      </div>

      <div className="card">
        <h3>Fleet status</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Vehicle</th><th>Driver</th><th>Type</th><th>Duty</th><th>Verification</th><th>Active booking</th><th>Last ping</th></tr>
            </thead>
            <tbody>
              {fleet.map((p) => (
                <tr key={p.provider_id}>
                  <td className="mono">
                    <Link to={`/providers/${p.provider_id}`} style={{ color: '#8db4ff' }}>{p.vehicle_reg_no}</Link>
                  </td>
                  <td>{p.driver_name}<div className="dim mono" style={{ fontSize: 11.5 }}>{p.phone_no}</div></td>
                  <td><span className="pill grey">{p.ambulance_type}</span></td>
                  <td><Status value={p.availability_status} /></td>
                  <td><Status value={p.verification_status} /></td>
                  <td className="mono">
                    {p.active_booking_id
                      ? <Link to={`/bookings/${p.active_booking_id}`} style={{ color: '#8db4ff' }}>{p.active_booking_id}</Link>
                      : <span className="dim">—</span>}
                  </td>
                  <td className="dim">{relative(p.last_seen_timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {fleet.length === 0 && <Empty>No ambulance has reported a position yet</Empty>}
        </div>
      </div>
    </>
  );
}
