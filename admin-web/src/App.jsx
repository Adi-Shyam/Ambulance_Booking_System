import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { api } from './lib/api';
import { useAuth } from './lib/auth.jsx';
import { getSocket } from './lib/socket';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Bookings from './pages/Bookings.jsx';
import BookingDetail from './pages/BookingDetail.jsx';
import Providers from './pages/Providers.jsx';
import ProviderDetail from './pages/ProviderDetail.jsx';
import Fleet from './pages/Fleet.jsx';
import Reports from './pages/Reports.jsx';
import Messages from './pages/Messages.jsx';
import Audit from './pages/Audit.jsx';
import Users from './pages/Users.jsx';

function Sidebar() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [pending, setPending] = useState(0);
  const [active, setActive] = useState(0);

  // Live badges: the control room should see a new request without refreshing.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const refresh = () => {
      api
        .get('/api/admin/overview')
        .then((r) => {
          setPending(r.counts.providers_pending);
          setActive(r.counts.awaiting_match + r.counts.in_progress);
        })
        .catch(() => {});
    };
    refresh();
    const events = ['admin:booking:new', 'admin:booking:update', 'admin:provider:new', 'admin:dispatch'];
    events.forEach((e) => socket.on(e, refresh));
    const timer = setInterval(refresh, 30000);
    return () => {
      events.forEach((e) => socket.off(e, refresh));
      clearInterval(timer);
    };
  }, []);

  const link = ({ isActive }) => `nav-link${isActive ? ' active' : ''}`;

  return (
    <nav className="sidebar">
      <div className="brand">
        <span className="brand-mark">🚑</span>
        <div>
          <strong>Control Room</strong>
          <span>Ambulance Booking</span>
        </div>
      </div>

      <div className="nav-section">Operations</div>
      <NavLink to="/" end className={link}>Dashboard</NavLink>
      <NavLink to="/bookings" className={link}>
        Bookings {active > 0 && <span className="pill amber">{active} live</span>}
      </NavLink>
      <NavLink to="/fleet" className={link}>Fleet map</NavLink>

      <div className="nav-section">Management</div>
      <NavLink to="/providers" className={link}>
        Providers {pending > 0 && <span className="pill red">{pending}</span>}
      </NavLink>
      <NavLink to="/users" className={link}>Accounts</NavLink>

      <div className="nav-section">Insight</div>
      <NavLink to="/reports" className={link}>Reports</NavLink>
      <NavLink to="/messages" className={link}>Alert log</NavLink>
      <NavLink to="/audit" className={link}>Audit trail</NavLink>

      <div className="sidebar-foot">
        <div style={{ marginBottom: 8 }}>
          <strong style={{ color: 'var(--text)' }}>{user?.full_name}</strong>
          <div>{user?.phone_no}</div>
        </div>
        <button
          className="btn small"
          onClick={() => {
            signOut();
            navigate('/login');
          }}
        >
          Sign out
        </button>
      </div>
    </nav>
  );
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="empty" style={{ paddingTop: 120 }}>Restoring your session…</div>;
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <div className="shell">
      <Sidebar />
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/bookings" element={<Bookings />} />
          <Route path="/bookings/:bookingId" element={<BookingDetail />} />
          <Route path="/providers" element={<Providers />} />
          <Route path="/providers/:providerId" element={<ProviderDetail />} />
          <Route path="/fleet" element={<Fleet />} />
          <Route path="/users" element={<Users />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/messages" element={<Messages />} />
          <Route path="/audit" element={<Audit />} />
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="*" element={<div className="empty">Page not found</div>} />
        </Routes>
      </main>
    </div>
  );
}
