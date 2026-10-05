import { useEffect, useRef } from 'react';
import L from 'leaflet';

// ---------------------------------------------------------------- status pills
const STATUS_TONE = {
  // booking_status
  REQUESTED: 'amber', MATCHING: 'amber', ASSIGNED: 'blue', ENROUTE: 'blue',
  ARRIVED: 'blue', ONBOARD: 'blue', COMPLETED: 'green', CANCELLED: 'grey', FAILED: 'red',
  // verification_status
  PENDING: 'amber', VERIFIED: 'green', REJECTED: 'red', SUSPENDED: 'red',
  // availability_status
  AVAILABLE: 'green', BUSY: 'blue', OFFLINE: 'grey',
  // assignment_status
  OFFERED: 'amber', ACCEPTED: 'green', TIMEOUT: 'grey',
  // payment_status
  SUCCESS: 'green', REFUNDED: 'amber',
  // delivery_state
  SENT: 'blue', DELIVERED: 'green', READ: 'green',
};

export function Status({ value }) {
  if (!value) return <span className="dim">—</span>;
  return <span className={`pill ${STATUS_TONE[value] || 'grey'}`}>{value}</span>;
}

export function Stat({ label, value, sub, alert }) {
  return (
    <div className={`stat${alert ? ' alert' : ''}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}

export function Banner({ kind = 'info', children }) {
  if (!children) return null;
  return <div className={`banner ${kind}`}>{children}</div>;
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

/** Horizontal bar chart - enough for the dashboard, with no charting dependency. */
export function BarChart({ data, valueKey = 'value', labelKey = 'label', format }) {
  const max = Math.max(1, ...data.map((d) => Number(d[valueKey]) || 0));
  if (data.length === 0) return <Empty>No data in this window</Empty>;
  return (
    <div>
      {data.map((d, i) => (
        <div className="chart-bar" key={`${d[labelKey]}-${i}`}>
          <div className="bar-label">{d[labelKey]}</div>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${((Number(d[valueKey]) || 0) / max) * 100}%` }} />
          </div>
          <div className="bar-value">{format ? format(d[valueKey]) : d[valueKey]}</div>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------- map
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

/**
 * Leaflet map driven by a plain array of markers, so the dashboard needs no
 * React-Leaflet layer. `markers` = [{ id, latitude, longitude, color, label, popup }]
 */
export function MapView({ markers = [], polyline = [], center, zoom = 12, className = 'map' }) {
  const nodeRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);

  useEffect(() => {
    if (!nodeRef.current || mapRef.current) return;

    const start = center || (markers[0] ? [markers[0].latitude, markers[0].longitude] : [13.0104, 74.7942]);
    mapRef.current = L.map(nodeRef.current, { zoomControl: true }).setView(start, zoom);
    L.tileLayer(TILE_URL, {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(mapRef.current);
    layerRef.current = L.layerGroup().addTo(mapRef.current);

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layerRef.current) return;

    layerRef.current.clearLayers();

    for (const m of markers) {
      if (m.latitude == null || m.longitude == null) continue;
      const marker = L.circleMarker([m.latitude, m.longitude], {
        radius: m.radius || 9,
        color: m.color || '#4c8dff',
        fillColor: m.color || '#4c8dff',
        fillOpacity: 0.85,
        weight: 2,
      });
      if (m.popup) marker.bindPopup(m.popup);
      if (m.label) marker.bindTooltip(m.label, { permanent: false, direction: 'top' });
      marker.addTo(layerRef.current);
    }

    if (polyline.length > 1) {
      L.polyline(polyline, { color: '#e63946', weight: 4, opacity: 0.8 }).addTo(layerRef.current);
    }

    const pts = markers.filter((m) => m.latitude != null).map((m) => [m.latitude, m.longitude]);
    if (pts.length > 1) map.fitBounds(L.latLngBounds(pts).pad(0.25));
    else if (pts.length === 1) map.setView(pts[0], Math.max(map.getZoom(), 13));
  }, [markers, polyline]);

  return <div ref={nodeRef} className={className} />;
}

// ------------------------------------------------------------- formatting
export const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const fmtShort = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—');
export const fmtMoney = (n) => (n == null ? '—' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export const fmtDuration = (sec) => {
  if (sec == null) return '—';
  if (sec < 60) return `${Math.round(sec)}s`;
  return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
};
export const relative = (iso) => {
  if (!iso) return '—';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return `${Math.floor(diff / 86400)} d ago`;
};
