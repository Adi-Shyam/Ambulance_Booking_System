import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Banner, Empty, Status, fmtTime } from '../components/ui.jsx';

// F.6 / F.14 - every WhatsApp, push and SMS alert with its delivery receipt.
export default function Messages() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [channel, setChannel] = useState('');

  const load = useCallback(() => {
    api.get('/api/admin/messages?limit=300').then(setData).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 20000);
    return () => clearInterval(timer);
  }, [load]);

  const rows = (data?.messages || []).filter((m) => !channel || m.message_channel === channel);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Alert log</h1>
          <p>
            Outbound dispatch and status alerts ·{' '}
            {data?.transport === 'whatsapp-cloud-api'
              ? <span className="pill green">WhatsApp Cloud API connected</span>
              : <span className="pill amber">Mock transport — set WHATSAPP_TOKEN to send for real</span>}
          </p>
        </div>
        <div className="btn-row">
          {['', 'WHATSAPP', 'SMS', 'PUSH'].map((c) => (
            <button key={c || 'all'} className={`btn small${channel === c ? ' primary' : ''}`} onClick={() => setChannel(c)}>
              {c || 'All'}
            </button>
          ))}
          <button className="btn small" onClick={load}>Refresh</button>
        </div>
      </div>

      <Banner kind="error">{error}</Banner>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Sent</th><th>Channel</th><th>Template</th><th>To</th><th>Booking</th><th>Delivery</th><th>Message</th></tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.message_id}>
                  <td className="dim" style={{ whiteSpace: 'nowrap' }}>{fmtTime(m.created_at)}</td>
                  <td><span className="pill blue">{m.message_channel}</span></td>
                  <td className="dim mono" style={{ fontSize: 11.5 }}>{m.message_template_id || '—'}</td>
                  <td className="mono">{m.recipient_phone}</td>
                  <td className="mono">
                    {m.booking_id
                      ? <Link to={`/bookings/${m.booking_id}`} style={{ color: '#8db4ff' }}>{m.booking_id}</Link>
                      : <span className="dim">—</span>}
                  </td>
                  <td><Status value={m.delivery_state} /></td>
                  <td style={{ maxWidth: 480, whiteSpace: 'pre-wrap', fontSize: 12.5 }}>{m.body}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <Empty>No alerts have been sent yet</Empty>}
        </div>
      </div>
    </>
  );
}
