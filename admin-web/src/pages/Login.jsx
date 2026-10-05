import { useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { Banner } from '../components/ui.jsx';

export default function Login() {
  const { signIn } = useAuth();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await signIn(phone.trim(), password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="card login-card" onSubmit={submit}>
        <div className="brand">
          <span className="brand-mark">🚑</span>
          <div>
            <strong>Ambulance Booking System</strong>
            <span>Administrator sign-in</span>
          </div>
        </div>

        <Banner kind="error">{error}</Banner>

        <label className="field">
          <span>Mobile number</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="9000000001"
            inputMode="numeric"
            autoComplete="username"
            required
          />
        </label>

        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        <button className="btn primary" style={{ width: '100%' }} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="dim" style={{ fontSize: 12, marginTop: 16, marginBottom: 0, textAlign: 'center' }}>
          Only accounts with the ADMIN role can sign in here.
        </p>
      </form>
    </div>
  );
}
