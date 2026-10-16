// One place for colour, spacing and type, so every screen looks the same.
//
// The palette follows the Government of India Digital Brand Identity Manual
// (DBIM v3, MeitY, January 2025). Two rules shape everything below:
//
//   One colour group from the primary palette (section 2.1). Cinnamon Red,
//   because the manual asks for the group that best represents the
//   organisation's function, and this one dispatches ambulances.
//
//   The functional palette (section 2.2) for everything else - background,
//   body text, and the four status colours. Those values are fixed by the
//   manual and are not ours to choose, which is the point of having one.
//
// This replaced a dark theme. DBIM mandates Inclusive White as the primary
// page background with dark text, and offers no dark variant, so complying
// meant inverting the whole design rather than adjusting it.
//
// NF.6: high contrast and large touch targets, because the person using this
// app may be in distress. The manual's own contrast rules serve the same end.

/** DBIM 2.1 - Cinnamon Red, darkest to lightest. */
export const GROUP = {
  key: '#771D1D',      // darkest: footer, headings, icons
  dark: '#A72626',     // primary action
  mid: '#D75151',      // hover, secondary emphasis
  light: '#FAAAAA',    // fills
  pale: '#FCDADA',     // tints and backgrounds
};

export const colors = {
  // DBIM 2.2 functional palette. The names are the manual's.
  bg: '#FFFFFF',           // Inclusive white - primary page background
  surface: '#FFFFFF',
  surface2: '#EBEAEA',     // Linen - highlights, quotes, attention
  line: '#C6C6C6',         // Grey 01
  text: '#150202',         // Deep earthy brown - text on a light background
  muted: '#606060',        // Grey 03 - secondary text, still 7:1 on white
  faint: '#8E8E8E',        // Grey 02

  // The selected colour group.
  accent: GROUP.dark,
  accentDark: GROUP.key,
  accentPale: GROUP.pale,

  // DBIM status colours. Fixed by the manual, not chosen by us.
  ok: '#198754',           // Liberty green - success
  warn: '#FFC107',         // Mustard yellow - warning
  danger: '#DC3545',       // Coral red - error
  info: '#0D6EFD',         // Blue - information and hyperlinks

  white: '#FFFFFF',
};

export const spacing = { xs: 4, sm: 8, md: 14, lg: 20, xl: 28 };
export const radius = { sm: 8, md: 12, lg: 18, pill: 999 };

/**
 * DBIM 4.3.2 - the type scale for mobile. The sizes are the manual's; only
 * the names are ours.
 *
 * Noto Sans is mandated (4.1.1) for its multilingual coverage: the same
 * family carries Devanagari, Bengali, Kannada, Tamil and the rest, so a
 * translated screen keeps its shape instead of falling back to whatever the
 * device has.
 */
export const FONT = {
  regular: 'NotoSans_400Regular',
  medium: 'NotoSans_500Medium',
  semibold: 'NotoSans_600SemiBold',
  bold: 'NotoSans_700Bold',
};

export const typo = {
  h1: { fontSize: 24, fontFamily: FONT.bold, color: colors.text },
  h2: { fontSize: 20, fontFamily: FONT.semibold, color: colors.text },
  h3: { fontSize: 16, fontFamily: FONT.semibold, color: colors.text },
  body: { fontSize: 14, fontFamily: FONT.regular, color: colors.text },
  small: { fontSize: 13, fontFamily: FONT.regular, color: colors.muted },
  tiny: { fontSize: 12, fontFamily: FONT.regular, color: colors.muted },
  mono: { fontFamily: 'monospace', fontSize: 13, color: colors.text },
};

/**
 * DBIM 2.2 reserves four colours for status, so a state uses the one the
 * manual assigns rather than the brand colour: a failed dispatch is an error,
 * and an error is Coral Red everywhere in government.
 */
export const STATUS_COLOR = {
  REQUESTED: colors.warn,
  MATCHING: colors.warn,
  ASSIGNED: colors.info,
  ENROUTE: colors.info,
  ARRIVED: colors.info,
  ONBOARD: colors.info,
  COMPLETED: colors.ok,
  CANCELLED: colors.muted,
  FAILED: colors.danger,
  PENDING: colors.warn,
  VERIFIED: colors.ok,
  REJECTED: colors.danger,
  SUSPENDED: colors.danger,
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
