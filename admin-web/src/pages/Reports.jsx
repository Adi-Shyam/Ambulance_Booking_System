import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Banner, BarChart, Empty, Status, fmtDuration, fmtMoney } from '../components/ui.jsx';

// F.13 - the four report types named in the data dictionary.
const TYPES = [
  { key: 'RESPONSE_TIME', label: 'Response time' },
  { key: 'DEMAND', label: 'Demand' },
  { key: 'REVENUE', label: 'Revenue' },
  { key: 'PROVIDER_PERF', label: 'Provider performance' },
];

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

function csvDownload(name, rows) {
  if (!rows?.length) return;
  const headers = Object.keys(rows[0]);
  const body = rows.map((r) => headers.map((h) => JSON.stringify(r[h] ?? '')).join(','));
  const blob = new Blob([[headers.join(','), ...body].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function Reports() {
  const [type, setType] = useState('RESPONSE_TIME');
  const [range, setRange] = useState({ from_date: daysAgo(29), to_date: today() });
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api
      .get(`/api/admin/reports/${type}?from_date=${range.from_date}&to_date=${range.to_date}`)
      .then(setReport)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [type, range]);

  useEffect(load, [load]);

  const m = report?.metrics;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Reports and analytics</h1>
          <p>
            {report ? <>Report <span className="mono">{report.report_id}</span> · {report.date_range.from_date} to {report.date_range.to_date}</> : 'Choose a report'}
          </p>
        </div>
      </div>

      <Banner kind="error">{error}</Banner>

      <div className="filters card">
        <label className="field">
          <span>Report type</span>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>From</span>
          <input type="date" value={range.from_date} onChange={(e) => setRange((r) => ({ ...r, from_date: e.target.value }))} />
        </label>
        <label className="field">
          <span>To</span>
          <input type="date" value={range.to_date} onChange={(e) => setRange((r) => ({ ...r, to_date: e.target.value }))} />
        </label>
        <button className="btn primary" onClick={load} disabled={loading}>{loading ? 'Running…' : 'Run report'}</button>
        <button className="btn" onClick={() => setRange({ from_date: daysAgo(6), to_date: today() })}>Last 7 days</button>
        <button className="btn" onClick={() => setRange({ from_date: daysAgo(29), to_date: today() })}>Last 30 days</button>
      </div>

      {!report ? (
        <Empty>{loading ? 'Running report…' : 'No report yet'}</Empty>
      ) : type === 'RESPONSE_TIME' ? (
        <div className="grid cols-2" style={{ marginTop: 14 }}>
          <div className="card">
            <h3>Average acceptance time by day</h3>
            <BarChart
              data={m.map((r) => ({ label: r.day, value: r.avg_response_sec }))}
              format={(v) => fmtDuration(v)}
            />
          </div>
          <div className="card">
            <h3>Detail</h3>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Day</th><th>Bookings</th><th>Matched</th><th>Average</th><th>Slowest</th></tr></thead>
                <tbody>
                  {m.map((r) => (
                    <tr key={r.day}>
                      <td>{r.day}</td>
                      <td>{r.bookings}</td>
                      <td>{r.matched}</td>
                      <td>{fmtDuration(r.avg_response_sec)}</td>
                      <td>{fmtDuration(r.max_response_sec)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {m.length === 0 && <Empty>No bookings in this window</Empty>}
            </div>
            <button className="btn small" style={{ marginTop: 12 }} onClick={() => csvDownload('response-time.csv', m)}>
              Export CSV
            </button>
          </div>
        </div>
      ) : type === 'DEMAND' ? (
        <div className="grid cols-2" style={{ marginTop: 14 }}>
          <div className="card">
            <h3>Bookings per day</h3>
            <BarChart data={m.by_day.map((r) => ({ label: r.day, value: r.bookings }))} />
          </div>
          <div className="card">
            <h3>Demand by hour of day</h3>
            <BarChart data={m.by_hour.map((r) => ({ label: `${r.hour}:00`, value: r.bookings }))} />
          </div>
          <div className="card">
            <h3>By ambulance type</h3>
            <BarChart data={m.by_type.map((r) => ({ label: r.ambulance_type, value: r.bookings }))} />
          </div>
          <div className="card">
            <h3>Hotspots by pincode</h3>
            <BarChart data={m.by_pincode.map((r) => ({ label: r.pincode, value: r.bookings }))} />
          </div>
        </div>
      ) : type === 'REVENUE' ? (
        <div className="grid cols-2" style={{ marginTop: 14 }}>
          <div className="card">
            <h3>Settled revenue per day</h3>
            <BarChart data={m.by_day.map((r) => ({ label: r.day, value: r.settled }))} format={fmtMoney} />
          </div>
          <div className="card">
            <h3>By payment mode</h3>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Mode</th><th>Invoices</th><th>Amount</th></tr></thead>
                <tbody>
                  {m.by_mode.map((r) => (
                    <tr key={r.payment_mode}>
                      <td><span className="pill grey">{r.payment_mode}</span></td>
                      <td>{r.invoices}</td>
                      <td>{fmtMoney(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {m.by_mode.length === 0 && <Empty>No invoices in this window</Empty>}
            </div>
          </div>
          <div className="card">
            <h3>By ambulance type</h3>
            <BarChart data={m.by_type.map((r) => ({ label: r.ambulance_type, value: r.amount }))} format={fmtMoney} />
          </div>
          <div className="card">
            <h3>Gross vs settled</h3>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Day</th><th>Invoices</th><th>Gross</th><th>Settled</th></tr></thead>
                <tbody>
                  {m.by_day.map((r) => (
                    <tr key={r.day}><td>{r.day}</td><td>{r.invoices}</td><td>{fmtMoney(r.gross)}</td><td>{fmtMoney(r.settled)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="btn small" style={{ marginTop: 12 }} onClick={() => csvDownload('revenue.csv', m.by_day)}>
              Export CSV
            </button>
          </div>
        </div>
      ) : (
        <div className="card" style={{ marginTop: 14 }}>
          <h3>Provider performance</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Vehicle</th><th>Driver</th><th>Type</th><th>Verification</th><th>Trips</th>
                  <th>Avg response</th><th>Accepted</th><th>Declined</th><th>Timed out</th><th>Rating</th><th>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {m.map((r) => (
                  <tr key={r.provider_id}>
                    <td className="mono">{r.vehicle_reg_no}</td>
                    <td>{r.driver_name}</td>
                    <td><span className="pill grey">{r.ambulance_type}</span></td>
                    <td><Status value={r.verification_status} /></td>
                    <td>{r.trips}</td>
                    <td>{r.avg_response_sec ? fmtDuration(r.avg_response_sec) : '—'}</td>
                    <td>{r.accepted}</td>
                    <td>{r.rejected}</td>
                    <td>{r.timed_out}</td>
                    <td>{r.rating_count ? `${r.rating} ★` : <span className="dim">new</span>}</td>
                    <td>{fmtMoney(r.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {m.length === 0 && <Empty>No providers registered</Empty>}
          </div>
          <button className="btn small" style={{ marginTop: 12 }} onClick={() => csvDownload('provider-performance.csv', m)}>
            Export CSV
          </button>
        </div>
      )}
    </>
  );
}
