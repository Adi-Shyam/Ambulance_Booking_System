import { createElement, useEffect, useMemo, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { colors, radius } from '../lib/theme';
import { MAPTILER_KEY } from '../lib/config';

/**
 * Map rendered as Leaflet inside a WebView.
 *
 * Why not react-native-maps: it needs a Google Maps API key and a custom dev
 * build. This runs in plain Expo Go on any phone with no key at all, which
 * matters for a project that has to be demonstrable on a lab machine.
 *
 * react-native-webview has no web target, so when the app is served through
 * react-native-web (`expo start --web`, handy for screenshots and demos) the
 * same Leaflet document is mounted in an iframe instead.
 *
 * Tiles come from MapTiler when a key is configured and from OpenStreetMap
 * otherwise. Both render the same Leaflet document, so the only difference is
 * how the map looks.
 *
 * markers: [{ latitude, longitude, glyph, label, kind, labelAlways }]
 *   glyph       the emoji to show - 📍 by default
 *   kind        'pickup' makes it the large, draggable one
 *   labelAlways keeps the tooltip open instead of waiting for a tap
 * route:   [[lat, lng], ...]
 * onPick:  (lat, lng) => void   enables tap-to-place and pin dragging (F.4)
 */
export default function MapPanel(props) {
  return Platform.OS === 'web' ? <WebMap {...props} /> : <NativeMap {...props} />;
}

function NativeMap({ markers = [], route = [], height = 260, onPick, zoom = 14 }) {
  const webRef = useRef(null);

  const html = useMemo(() => buildHtml(zoom, Boolean(onPick)), [zoom, Boolean(onPick)]);

  const payload = useMemo(
    () => JSON.stringify({ markers: markers.filter((m) => m.latitude != null), route }),
    [markers, route]
  );

  // Pushing state through injectedJavaScript keeps the map instance alive, so the
  // ambulance marker moves smoothly instead of the map reloading on each ping.
  const inject = `window.applyState(${payload}); true;`;

  return (
    <View style={[styles.wrap, { height }]}>
      <WebView
        ref={webRef}
        originWhitelist={['*']}
        source={{ html }}
        style={styles.web}
        injectedJavaScript={inject}
        onMessage={(e) => {
          try {
            const msg = JSON.parse(e.nativeEvent.data);
            if (msg.type === 'pick' && onPick) onPick(msg.lat, msg.lng);
            if (msg.type === 'ready') webRef.current?.injectJavaScript(inject);
          } catch {
            // ignore malformed bridge messages
          }
        }}
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled={false}
        androidLayerType="hardware"
      />
    </View>
  );
}

/**
 * Web fallback. react-native-web renders to the DOM, so an <iframe> can be
 * created directly; the Leaflet document and its bridge are identical to the
 * native path, with postMessage carrying the pin-drop back.
 */
function WebMap({ markers = [], route = [], height = 260, onPick, zoom = 14 }) {
  const frameRef = useRef(null);

  const html = useMemo(() => buildHtml(zoom, Boolean(onPick)), [zoom, Boolean(onPick)]);
  const payload = useMemo(
    () => JSON.stringify({ markers: markers.filter((m) => m.latitude != null), route }),
    [markers, route]
  );

  useEffect(() => {
    const win = frameRef.current?.contentWindow;
    if (win?.applyState) win.applyState(JSON.parse(payload));
  }, [payload]);

  useEffect(() => {
    if (!onPick) return undefined;
    const onMessage = (e) => {
      if (e.source !== frameRef.current?.contentWindow) return;
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'pick') onPick(msg.lat, msg.lng);
        if (msg.type === 'ready') frameRef.current?.contentWindow?.applyState(JSON.parse(payload));
      } catch {
        // ignore anything that is not our bridge
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onPick, payload]);

  return (
    <View style={[styles.wrap, { height }]}>
      {createElement('iframe', {
        ref: frameRef,
        srcDoc: html,
        onLoad: () => frameRef.current?.contentWindow?.applyState?.(JSON.parse(payload)),
        style: { width: '100%', height: '100%', border: 0, background: '#0b1119' },
        title: 'map',
      })}
    </View>
  );
}

function buildHtml(zoom, pickable) {
  // MapTiler's key is meant to travel in the tile URL - it is a client-side
  // key by design, and restricting it to an origin is done in their dashboard
  // rather than by hiding it. With none configured this falls back to plain
  // OpenStreetMap tiles, which work but look like a wiki and whose usage policy
  // asks apps not to lean on them.
  const tiles = MAPTILER_KEY
    ? {
        url: `https://api.maptiler.com/maps/streets-v2-dark/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`,
        attribution: '&copy; MapTiler &copy; OpenStreetMap',
      }
    : {
        url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: '&copy; OpenStreetMap',
      };

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  html, body, #map { height: 100%; margin: 0; background: #0b1119; }
  .leaflet-control-attribution { font-size: 9px; background: rgba(0,0,0,.5); color: #93a4bb; }
  .leaflet-control-attribution a { color: #8db4ff; }

  /* A pin, not a dot. A circle marks an area; a pin marks a point, and the
     point is the whole question being asked here - where exactly are you. */
  .pin { font-size: 26px; line-height: 26px; text-align: center; filter: drop-shadow(0 2px 3px rgba(0,0,0,.6)); }
  .pin-pickup { font-size: 32px; line-height: 32px; }
  .pin.dragging { opacity: .6; }

  /* Says the pin can be moved, without a tooltip nobody reads. */
  .hint {
    position: absolute; left: 50%; transform: translateX(-50%);
    bottom: 8px; z-index: 500;
    background: rgba(11,17,25,.82); color: #e8eef7;
    font: 11px/1.4 -apple-system, Roboto, sans-serif;
    padding: 4px 10px; border-radius: 999px; white-space: nowrap;
    pointer-events: none;
  }
</style>
</head>
<body>
<div id="map"></div>
${pickable ? '<div class="hint" id="hint">Tap the map or drag the pin</div>' : ''}
<script>
  var map = L.map('map', { zoomControl: false, attributionControl: true }).setView([13.0104, 74.7942], ${zoom});
  L.tileLayer('${tiles.url}', { maxZoom: 20, attribution: '${tiles.attribution}' }).addTo(map);

  var layer = L.layerGroup().addTo(map);
  var lastSignature = '';
  var pickMarker = null;

  function post(obj) {
    var payload = JSON.stringify(obj);
    // Native: the WebView bridge. Web: the parent window hosting the iframe.
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(payload);
    else if (window.parent !== window) window.parent.postMessage(payload, '*');
  }

  /** An emoji in a div, which Leaflet positions by its tip rather than centre. */
  function pinIcon(glyph, big) {
    var size = big ? 32 : 26;
    return L.divIcon({
      html: '<div class="pin' + (big ? ' pin-pickup' : '') + '">' + glyph + '</div>',
      className: '',
      iconSize: [size, size],
      // Anchored at the bottom centre: a pin points at a spot, and that spot
      // is under its tip, not under its middle.
      iconAnchor: [size / 2, size]
    });
  }

  window.applyState = function (state) {
    var signature = JSON.stringify(state);
    if (signature === lastSignature) return;
    lastSignature = signature;

    layer.clearLayers();
    pickMarker = null;
    var pts = [];

    (state.markers || []).forEach(function (m) {
      var glyph = m.glyph || '📍';
      var isPickup = m.kind === 'pickup';
      var marker = L.marker([m.latitude, m.longitude], {
        icon: pinIcon(glyph, isPickup),
        // Only the pickup pin moves: dragging an ambulance would be fiction.
        draggable: Boolean(isPickup && ${pickable}),
        zIndexOffset: isPickup ? 1000 : 0
      }).addTo(layer);

      if (m.label) {
        marker.bindTooltip(m.label, {
          permanent: Boolean(m.labelAlways),
          direction: 'top',
          offset: [0, -(isPickup ? 30 : 24)]
        });
      }

      if (isPickup && ${pickable}) {
        pickMarker = marker;
        marker.on('dragstart', function () {
          marker.getElement()?.querySelector('.pin')?.classList.add('dragging');
        });
        marker.on('dragend', function (e) {
          marker.getElement()?.querySelector('.pin')?.classList.remove('dragging');
          var p = e.target.getLatLng();
          post({ type: 'pick', lat: p.lat, lng: p.lng });
        });
      }

      pts.push([m.latitude, m.longitude]);
    });

    if (state.route && state.route.length > 1) {
      // Drawn twice: a dark casing under a bright line, so the route stays
      // legible over both pale streets and dark parkland.
      L.polyline(state.route, { color: '#0b1119', weight: 9, opacity: 0.55 }).addTo(layer);
      L.polyline(state.route, { color: '#e63946', weight: 5, opacity: 0.95 }).addTo(layer);
      pts = pts.concat(state.route);
    }

    if (pts.length > 1) map.fitBounds(L.latLngBounds(pts).pad(0.28));
    else if (pts.length === 1) map.setView(pts[0], Math.max(map.getZoom(), ${zoom}));
  };

  ${pickable ? `
  map.on('click', function (e) {
    // Move the pin immediately rather than waiting for the round trip, so the
    // map answers the tap at once and the state catches up.
    if (pickMarker) pickMarker.setLatLng(e.latlng);
    post({ type: 'pick', lat: e.latlng.lat, lng: e.latlng.lng });
  });` : ''}

  post({ type: 'ready' });
</script>
</body>
</html>`;
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#0b1119',
  },
  web: { flex: 1, backgroundColor: '#0b1119' },
});
