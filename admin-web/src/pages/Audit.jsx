import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Banner, Empty, fmtTime } from '../components/ui.jsx';

// Constraint C.5 - bookings, dispatch decisions, status changes and admin
// actions, kept for reproducibility and dispute resolution.
export default function Audit() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [action, setAction] = useState('');

  const load = useCallback(() => {
    api
      .get(`/api/admin/audit?limit=300${action ? `&action=${action}` : ''}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [action]);

  useEffect(load, [load]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Audit trail</h1>
          <p>Immutable record of every booking, dispatch decision and administrative action</p>
        </div>
        <div className="btn-row">
          <select value={action} onChange={(e) => setAction(e.target.value)} style={{ width: 240 }}>
            <option value="">All actions</option>
            {(data?.actions || []).map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <button className="btn" onClick={load}>Refresh</button>
        </div>
      </div>

      <Banner kind="error">{error}</Banner>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>#</th><th>When</th><th>Action</th><th>Actor</th><th>Entity</th><th>Details</th></tr>
            </thead>
            <tbody>
              {(data?.audit || []).map((r) => (
                <tr key={r.id}>
                  <td className="dim mono">{r.id}</td>
                  <td className="dim" style={{ whiteSpace: 'nowrap' }}>{fmtTime(r.created_at)}</td>
                  <td><span className="pill grey">{r.action}</span></td>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {r.actor_user_id || <span className="dim">system</span>}
                    {r.actor_role ? <div className="dim" style={{ fontSize: 11 }}>{r.actor_role}</div> : null}
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {r.entity_id || '—'}
                    {r.entity_type ? <div className="dim" style={{ fontSize: 11 }}>{r.entity_type}</div> : null}
                  </td>
                  <td style={{ maxWidth: 460 }}>
                    {r.details ? (
                      <code style={{ fontSize: 11.5, color: 'var(--muted)', wordBreak: 'break-all' }}>
                        {JSON.stringify(r.details)}
                      </code>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && data.audit.length === 0 && <Empty>No audit entries</Empty>}
        </div>
      </div>
    </>
  );
}
