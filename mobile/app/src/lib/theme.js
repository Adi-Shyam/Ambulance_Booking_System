// One place for colour, spacing and type, so every screen looks the same.
// NF.6: high contrast and large touch targets, because the person using this
// app may be in distress.
export const colors = {
  bg: '#0f1520',
  surface: '#172130',
  surface2: '#1e2a3c',
  line: '#2a3849',
  text: '#e8eef7',
  muted: '#93a4bb',
  accent: '#e63946',
  accentDark: '#c32f3b',
  // Brighter and hotter than the accent, which is already red and is what a
  // selected control looks like. An emergency has to read as different from
  // "chosen", not merely as red.
  danger: '#ff4d2d',
  ok: '#2ec27e',
  warn: '#f5a524',
  info: '#4c8dff',
  white: '#ffffff',
};

export const spacing = { xs: 4, sm: 8, md: 14, lg: 20, xl: 28 };
export const radius = { sm: 8, md: 12, lg: 18, pill: 999 };

export const typo = {
  h1: { fontSize: 26, fontWeight: '700', color: colors.text },
  h2: { fontSize: 19, fontWeight: '700', color: colors.text },
  h3: { fontSize: 15, fontWeight: '600', color: colors.text },
  body: { fontSize: 15, color: colors.text },
  small: { fontSize: 13, color: colors.muted },
  tiny: { fontSize: 11.5, color: colors.muted },
  mono: { fontFamily: 'monospace', fontSize: 13, color: colors.text },
};

export const STATUS_COLOR = {
  REQUESTED: colors.warn,
  MATCHING: colors.warn,
  ASSIGNED: colors.info,
  ENROUTE: colors.info,
  ARRIVED: colors.info,
  ONBOARD: colors.info,
  COMPLETED: colors.ok,
  CANCELLED: colors.muted,
  FAILED: colors.accent,
  PENDING: colors.warn,
  VERIFIED: colors.ok,
  REJECTED: colors.accent,
  SUSPENDED: colors.accent,
  AVAILABLE: colors.ok,
  BUSY: colors.info,
  OFFLINE: colors.muted,
  SUCCESS: colors.ok,
  OFFERED: colors.warn,
  ACCEPTED: colors.ok,
  TIMEOUT: colors.muted,
};

export const STATUS_TEXT = {
  REQUESTED: 'Request received',
  MATCHING: 'Finding an ambulance',
  ASSIGNED: 'Ambulance assigned',
  ENROUTE: 'On the way to you',
  ARRIVED: 'Arrived at pickup',
  ONBOARD: 'Patient on board',
  COMPLETED: 'Trip completed',
  CANCELLED: 'Cancelled',
  FAILED: 'No ambulance found',
};

export const money = (n) =>
  n == null ? '—' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const timeOf = (iso) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—';

export const dateTimeOf = (iso) =>
  iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export const relative = (iso) => {
  if (!iso) return '—';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return `${Math.floor(diff / 86400)} d ago`;
};
