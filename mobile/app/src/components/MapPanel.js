import { createElement, useEffect, useMemo, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { colors, radius } from '../lib/theme';

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
 * markers: [{ latitude, longitude, color, label }]
 * route:   [[lat, lng], ...]
 * onPick:  (lat, lng) => void   enables tap-to-drop-a-pin (F.4 map adjustment)
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
</style>
</head>
<body>
<div id="map"></div>
<script>
  var map = L.map('map', { zoomControl: false, attributionControl: true }).setView([13.0104, 74.7942], ${zoom});
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  var layer = L.layerGroup().addTo(map);
  var lastSignature = '';

  function post(obj) {
    var payload = JSON.stringify(obj);
    // Native: the WebView bridge. Web: the parent window hosting the iframe.
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(payload);
    else if (window.parent !== window) window.parent.postMessage(payload, '*');
  }

  window.applyState = function (state) {
    var signature = JSON.stringify(state);
    if (signature === lastSignature) return;
    lastSignature = signature;

    layer.clearLayers();
    var pts = [];

    (state.markers || []).forEach(function (m) {
      var marker = L.circleMarker([m.latitude, m.longitude], {
        radius: m.radius || 10,
        color: m.color || '#4c8dff',
        fillColor: m.color || '#4c8dff',
        fillOpacity: 0.9,
        weight: 3
      }).addTo(layer);
      if (m.label) marker.bindTooltip(m.label, { permanent: false, direction: 'top' });
      pts.push([m.latitude, m.longitude]);
    });

    if (state.route && state.route.length > 1) {
      L.polyline(state.route, { color: '#e63946', weight: 5, opacity: 0.85 }).addTo(layer);
      pts = pts.concat(state.route);
    }

    if (pts.length > 1) map.fitBounds(L.latLngBounds(pts).pad(0.28));
    else if (pts.length === 1) map.setView(pts[0], Math.max(map.getZoom(), ${zoom}));
  };

  ${pickable ? `map.on('click', function (e) { post({ type: 'pick', lat: e.latlng.lat, lng: e.latlng.lng }); });` : ''}

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
