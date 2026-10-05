import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Banner, Empty, Status } from '../components/ui.jsx';

const ROLES = ['USER', 'DRIVER', 'ORG', 'ADMIN'];

// F.13 - account management across all four roles.
export default function Users() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filters, setFilters] = useState({ role_code: '', q: '' });
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ full_name: '', phone_no: '', password: '' });

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (filters.role_code) params.set('role_code', filters.role_code);
    if (filters.q.trim()) params.set('q', filters.q.trim());
    api.get(`/api/admin/users?${params}`).then((r) => setRows(r.users)).catch((e) => setError(e.message));
  }, [filters]);

  useEffect(load, [load]);

  async function setStatus(user, verification_status) {
    setError('');
    try {
      await api.post(`/api/admin/users/${user.user_id}/status`, { verification_status });
      setNotice(`${user.full_name} marked ${verification_status}`);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function createAdmin(e) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/api/admin/admins', form);
      setNotice(`Administrator ${form.full_name} created`);
      setForm({ full_name: '', phone_no: '', password: '' });
      setCreating(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Accounts</h1>
          <p>{rows.length} accounts across patient, driver, organisation and administrator roles</p>
        </div>
        <button className="btn primary" onClick={() => setCreating((v) => !v)}>
          {creating ? 'Cancel' : 'New administrator'}
        </button>
      </div>

      <Banner kind="error">{error}</Banner>
      <Banner kind="ok">{notice}</Banner>

      {creating && (
        <form className="card" style={{ marginBottom: 14, maxWidth: 420 }} onSubmit={createAdmin}>
          <h3>Create an administrator</h3>
          <label className="field">
            <span>Full name</span>
            <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
          </label>
          <label className="field">
            <span>Mobile number</span>
            <input value={form.phone_no} onChange={(e) => setForm({ ...form, phone_no: e.target.value })} inputMode="numeric" required />
          </label>
          <label className="field">
            <span>Password</span>
            <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} />
          </label>
          <button className="btn primary">Create account</button>
        </form>
      )}

      <div className="filters card">
        <label className="field">
          <span>Search</span>
          <input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder="Name, phone or id" />
        </label>
        <label className="field">
          <span>Role</span>
          <select value={filters.role_code} onChange={(e) => setFilters({ ...filters, role_code: e.target.value })}>
            <option value="">All</option>
            {ROLES.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        <button className="btn" onClick={load}>Refresh</button>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>User id</th><th>Name</th><th>Phone</th><th>Role</th><th>Status</th><th>Bookings</th><th>Registered</th><th>Action</th></tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.user_id}>
                  <td className="mono">{u.user_id}</td>
                  <td>{u.full_name}<div className="dim" style={{ fontSize: 11.5 }}>{u.email_id || ''}</div></td>
                  <td className="mono">{u.phone_no}</td>
                  <td><span className="pill grey">{u.role_code}</span></td>
                  <td><Status value={u.verification_status} /></td>
                  <td>{u.bookings}</td>
                  <td className="dim">{u.registration_date}</td>
                  <td>
                    {u.role_code === 'ADMIN' ? (
                      <span className="dim">—</span>
                    ) : u.verification_status === 'SUSPENDED' ? (
                      <button className="btn small ok" onClick={() => setStatus(u, 'VERIFIED')}>Reinstate</button>
                    ) : (
                      <button className="btn small" onClick={() => setStatus(u, 'SUSPENDED')}>Suspend</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <Empty>No accounts match these filters</Empty>}
        </div>
      </div>
    </>
  );
}
