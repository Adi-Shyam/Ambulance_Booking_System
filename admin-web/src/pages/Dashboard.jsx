import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { Banner, BarChart, Empty, Stat, Status, fmtDuration, fmtMoney, relative } from '../components/ui.jsx';

// F.13 - operational overview: live dispatch state, response times and demand.
export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [feed, setFeed] = useState([]);

  const load = useCallback(() => {
    api.get('/api/admin/overview').then(setData).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    const socket = getSocket();
    if (!socket) return;

    const onDispatch = (e) => {
      setFeed((prev) => [{ ...e, at: new Date().toISOString(), key: Math.random() }, ...prev].slice(0, 12));
      load();
    };
    const onBooking = (b) => {
      setFeed((prev) =>
        [{ event: b.booking_status, booking_id: b.booking_id, at: new Date().toISOString(), key: Math.random() }, ...prev].slice(0, 12)
      );
      load();
    };

    socket.on('admin:dispatch', onDispatch);
    socket.on('admin:booking:new', onBooking);
    socket.on('admin:booking:update', onBooking);
    const timer = setInterval(load, 20000);

    return () => {
      socket.off('admin:dispatch', onDispatch);
      socket.off('admin:booking:new', onBooking);
      socket.off('admin:booking:update', onBooking);
      clearInterval(timer);
    };
  }, [load]);

  if (error) return <Banner kind="error">{error}</Banner>;
  if (!data) return <Empty>Loading control room…</Empty>;

  const c = data.counts;
  const rt = data.response_time;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dispatch overview</h1>
          <p>
            <span className="live-dot" /> Live · updated {relative(data.generated_at)}
          </p>
        </div>
      </div>

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat label="Awaiting a match" value={c.awaiting_match} alert={c.awaiting_match > 0}
              sub="requests still being offered" />
        <Stat label="Trips in progress" value={c.in_progress} sub="assigned through on-board" />
        <Stat label="Ambulances free" value={c.providers_available}
              sub={`${c.providers_busy} on a trip · ${c.providers_total} total`} />
        {/* Marked available but no longer reporting a position, so the matcher
            will not consider them. Shown separately rather than folded into
            "free", which would overstate what is actually dispatchable. */}
        <Stat label="Not reporting" value={c.providers_stale ?? 0} alert={(c.providers_stale ?? 0) > 0}
              sub="on duty but no recent GPS" />
      </div>

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat label="Pending verification" value={c.providers_pending} alert={c.providers_pending > 0}
              sub="provider accounts to review" />
        <Stat label="Bookings today" value={c.bookings_today} sub={`${c.total_bookings} all time`} />
        <Stat label="Avg. response time" value={fmtDuration(rt.avg_response_sec)}
              sub={`request → acceptance, ${rt.measured} trips`} />
        <Stat label="Completed" value={c.completed}
              sub={`${c.failed} unmatched · ${c.cancelled} cancelled`} />
        <Stat label="Revenue settled" value={fmtMoney(c.revenue_settled)}
              sub={`${fmtMoney(c.revenue_pending)} outstanding`} />
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h3>Recent bookings</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Booking</th><th>Type</th><th>Status</th><th>Ambulance</th><th>Placed</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_bookings.map((b) => (
                  <tr key={b.booking_id}>
                    <td className="mono">
                      <Link to={`/bookings/${b.booking_id}`} style={{ color: '#8db4ff' }}>{b.booking_id}</Link>
                    </td>
                    <td><span className="pill grey">{b.ambulance_type}</span></td>
                    <td><Status value={b.booking_status} /></td>
                    <td className="dim">{b.provider ? b.provider.vehicle_reg_no : '—'}</td>
                    <td className="dim">{relative(b.booking_timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.recent_bookings.length === 0 && <Empty>No bookings yet</Empty>}
          </div>
        </div>

        <div className="card">
          <h3>Live dispatch feed</h3>
          {feed.length === 0 ? (
            <Empty>Waiting for dispatch activity…</Empty>
          ) : (
            <ul className="timeline">
              {feed.map((f) => (
                <li key={f.key} className={['ACCEPTED', 'COMPLETED'].includes(f.event) ? 'done' : ''}>
                  <div className="t-title">
                    <Status value={f.event} />{' '}
                    <Link to={`/bookings/${f.booking_id}`} className="mono" style={{ color: '#8db4ff' }}>
                      {f.booking_id}
                    </Link>
                    {f.provider_id ? <span className="dim mono"> · {f.provider_id}</span> : null}
                  </div>
                  <div className="t-time">
                    {relative(f.at)}
                    {f.response_time_sec != null ? ` · answered in ${fmtDuration(f.response_time_sec)}` : ''}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <h3>Demand by ambulance type</h3>
          <BarChart
            data={data.by_type.map((t) => ({ label: t.ambulance_type, value: t.bookings }))}
          />
        </div>

        <div className="card">
          <h3>Response time (F.13)</h3>
          <dl className="kv">
            <dt>Fastest acceptance</dt><dd>{fmtDuration(rt.min_response_sec)}</dd>
            <dt>Average</dt><dd>{fmtDuration(rt.avg_response_sec)}</dd>
            <dt>Slowest</dt><dd>{fmtDuration(rt.max_response_sec)}</dd>
            <dt>Trips measured</dt><dd>{rt.measured}</dd>
            <dt>Unmatched requests</dt><dd>{c.failed}</dd>
            <dt>Registered patients</dt><dd>{c.patients}</dd>
          </dl>
          <p className="dim" style={{ fontSize: 12, marginBottom: 0, marginTop: 14 }}>
            Measured from booking_timestamp to the confirmed assignment, as defined by
            response_time_sec in the data dictionary.
          </p>
        </div>
      </div>
    </>
  );
}
