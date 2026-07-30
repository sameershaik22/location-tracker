/* ══════════════════════════════════════════════════════════════
   admin.js — PinDrop Admin Dashboard
   ══════════════════════════════════════════════════════════════ */
'use strict';

// ── State ──────────────────────────────────────────────────────
const S = {
  people:  new Map(),   // id → tracker data
  markers: new Map(),   // id → L.marker
  sel:     null,        // selected id
  map:     null,
  socket:  null,
  filter:  'all',
  genLink: '',
};

// ── Map ────────────────────────────────────────────────────────
function initMap() {
  S.map = L.map('map', {
    center: [30.37, 69.34],
    zoom: 5,
    zoomControl: true,
    attributionControl: true,
    preferCanvas: true,
  });

  // ── Tile Layers ─────────────────────────────────────────────
  const subdomains = ['mt0','mt1','mt2','mt3'];

  const layers = {
    'Satellite': L.tileLayer(
      'https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
      { subdomains, maxZoom: 22, attribution: '© Google Maps' }
    ),
    'Hybrid': L.tileLayer(
      'https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
      { subdomains, maxZoom: 22, attribution: '© Google Maps' }
    ),
    'Streets': L.tileLayer(
      'https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
      { subdomains, maxZoom: 22, attribution: '© Google Maps' }
    ),
    'Dark': L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      { subdomains: 'abcd', maxZoom: 20, attribution: '© OpenStreetMap © CARTO' }
    ),
  };

  // Default: Hybrid (satellite + labels — most useful for tracking)
  layers['Hybrid'].addTo(S.map);

  // Layer control
  L.control.layers(layers, {}, { position: 'bottomright', collapsed: false }).addTo(S.map);
}

// ── Markers ────────────────────────────────────────────────────
function mkIcon(label, status) {
  const letter = (label || '?')[0].toUpperCase();
  const isLive = status === 'online';

  const html = `
    <div style="position:relative;width:40px;height:52px;filter:drop-shadow(0 4px 12px rgba(0,0,0,0.8));">
      ${isLive ? '<div class="mpin-pulse"></div>' : ''}
      <div class="mpin ${isLive ? 'live' : 'offline'}" style="width:40px;height:40px;">
        <span class="mpin-letter">${letter}</span>
      </div>
    </div>`;
  return L.divIcon({ html, className: '', iconSize: [40, 52], iconAnchor: [20, 52], popupAnchor: [0, -54] });
}

function buildPopup(p) {
  const lat  = p.lat  != null ? p.lat.toFixed(7)           : 'N/A';
  const lng  = p.lng  != null ? p.lng.toFixed(7)           : 'N/A';
  const spd  = p.speed != null ? (p.speed * 3.6).toFixed(2) + ' km/h' : '—';
  const acc  = p.accuracy != null ? '±' + p.accuracy.toFixed(1) + ' m' : '—';
  const alt  = p.altitude != null ? p.altitude.toFixed(1) + ' m'       : '—';
  const hdg  = p.heading  != null ? p.heading.toFixed(0) + '°'         : '—';
  const seen = p.lastSeen ? relTime(p.lastSeen) : '—';
  const gmLink = p.lat != null
    ? `<a href="https://www.google.com/maps?q=${p.lat},${p.lng}" target="_blank" rel="noopener" style="color:#4fc3f7;font-size:11px;">📍 Open in Google Maps</a>`
    : '';
  const dot  = p.status === 'online'
    ? `<span style="color:#00e676;font-size:10px;">● LIVE</span>`
    : `<span style="color:#546e7a;font-size:10px;">● OFFLINE</span>`;

  return `
    <div style="min-width:220px;font-family:Inter,sans-serif;">
      <div class="pu-name">${dot} &nbsp;${esc(p.label)}</div>
      <div class="pu-phone">📞 ${esc(p.phone)}</div>
      <div class="pu-coords">
        <div>🌐 ${lat}, ${lng}</div>
        <div>🎯 ${acc} &nbsp;·&nbsp; 🏔 ${alt}</div>
        <div>🚀 ${spd} &nbsp;·&nbsp; 🧭 ${hdg}</div>
      </div>
      <div class="pu-meta">⏱ ${seen} &nbsp;·&nbsp; 📡 ${p.updateCount || 0} pts</div>
      <div style="margin-top:8px;">${gmLink}</div>
    </div>`;
}

function putMarker(p) {
  if (p.lat == null || p.lng == null) return;
  const ll   = [p.lat, p.lng];
  const icon = mkIcon(p.label, p.status);
  const pop  = buildPopup(p);

  if (S.markers.has(p.id)) {
    const m = S.markers.get(p.id);
    animMarker(m, ll);
    m.setIcon(icon);
    m.setPopupContent(pop);
  } else {
    const m = L.marker(ll, { icon }).addTo(S.map).bindPopup(pop, { maxWidth: 260 });
    m.on('click', () => selectPerson(p.id));
    S.markers.set(p.id, m);
    if (S.markers.size === 1) S.map.flyTo(ll, 14, { animate: true, duration: 1.5 });
  }
}

function animMarker(m, to, steps = 20, ms = 600) {
  const from = m.getLatLng();
  const dLat = to[0] - from.lat, dLng = to[1] - from.lng;
  if (Math.abs(dLat) < 1e-9 && Math.abs(dLng) < 1e-9) return;
  let i = 0;
  const t = setInterval(() => {
    i++;
    const e = i < steps / 2 ? 2 * (i / steps) ** 2 : -1 + (4 - 2 * (i / steps)) * (i / steps);
    m.setLatLng([from.lat + dLat * e, from.lng + dLng * e]);
    if (i >= steps) clearInterval(t);
  }, ms / steps);
}

function removePerson(id) {
  S.people.delete(id);
  const m = S.markers.get(id);
  if (m) { S.map.removeLayer(m); S.markers.delete(id); }
  document.getElementById(`card-${id}`)?.remove();
  updateStats();
}

// ── Socket ─────────────────────────────────────────────────────
function initSocket() {
  S.socket = io({ reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 5000 });

  S.socket.on('connect', () => {
    setServerStatus(true);
    feed('green', 'Connected');
    S.socket.emit('get-trackers');
  });
  S.socket.on('disconnect', () => { setServerStatus(false); feed('red', 'Disconnected'); });

  // Server tells us the public tunnel URL
  S.socket.on('public-url', (data) => {
    if (data.url) showUrlBanner(data.url);
  });

  S.socket.on('tracker-list', (list) => {
    list.forEach((p) => upsert(p));
    renderList(); updateStats();
  });

  S.socket.on('tracker-online', (p) => {
    upsert(p); renderList(); updateStats();
    feed('green', `${esc(p.label)} is live`);
    toast(`${p.label} started sharing location`, 'ok');
  });

  S.socket.on('location-broadcast', (data) => {
    upsert(data); putMarker(data); patchCard(data.id); updateStats();
    feed('purple', `📍 ${esc(data.label)}`);
  });

  S.socket.on('tracker-offline', (data) => {
    const p = S.people.get(data.id);
    if (p) { p.status = 'offline'; p.lastSeen = data.lastSeen; S.people.set(data.id, p); putMarker(p); patchCard(data.id); updateStats(); }
    feed('red', `${esc(data.label)} went offline`);
    toast(`${data.label} stopped sharing`, 'err');
  });

  S.socket.on('tracker-removed', (data) => removePerson(data.id));
}

function upsert(data) {
  const old = S.people.get(data.id) || {};
  S.people.set(data.id, { ...old, ...data });
}

// ── People list ────────────────────────────────────────────────
function renderList() {
  const list  = document.getElementById('person-list');
  const empty = document.getElementById('empty-state');
  const q     = (document.getElementById('search-input').value || '').toLowerCase();

  list.querySelectorAll('.person-card').forEach((c) => c.remove());

  const filtered = Array.from(S.people.values())
    .filter((p) => {
      if (S.filter === 'online'  && p.status !== 'online')  return false;
      if (S.filter === 'offline' && p.status !== 'offline') return false;
      if (!q) return true;
      return (p.label || '').toLowerCase().includes(q) || (p.phone || '').includes(q) || (p.id || '').toLowerCase().includes(q);
    })
    .sort((a, b) => (a.status === 'online' ? -1 : 1) - (b.status === 'online' ? -1 : 1) || (a.label || '').localeCompare(b.label || ''));

  empty.style.display = filtered.length ? 'none' : 'flex';
  filtered.forEach((p) => list.appendChild(buildCard(p)));
}

function buildCard(p) {
  const live    = p.status === 'online';
  const initial = (p.label || '?')[0].toUpperCase();
  const lat = p.lat  != null ? p.lat.toFixed(5) : '—';
  const lng = p.lng  != null ? p.lng.toFixed(5) : '—';
  const acc = p.accuracy != null ? p.accuracy.toFixed(0) + 'm' : '—';
  const spd = p.speed    != null ? (p.speed * 3.6).toFixed(1) + ' km/h' : '—';
  const seen = p.lastSeen ? relTime(p.lastSeen) : '—';

  const card = document.createElement('div');
  card.className = `person-card${live ? '' : ' offline'}${S.sel === p.id ? ' selected' : ''}`;
  card.id = `card-${p.id}`;
  card.dataset.id = p.id;
  card.innerHTML = `
    <div class="pc-row1">
      <div class="pc-avatar ${live ? 'live' : 'offline'}">
        ${initial}
        <div class="pc-dot ${live ? 'live' : 'offline'}"></div>
      </div>
      <div class="pc-info">
        <div class="pc-name">${esc(p.label)}</div>
        <div class="pc-phone">${esc(p.phone)}</div>
      </div>
      <span class="pc-badge ${live ? 'live' : 'offline'}">${live ? '● Live' : 'Offline'}</span>
    </div>
    <div class="pc-meta">
      <div class="pc-meta-item">⏱ <strong>${seen}</strong></div>
      <div class="pc-meta-item">🎯 <strong>${acc}</strong></div>
      <div class="pc-meta-item">🚀 <strong>${spd}</strong></div>
      <div class="pc-meta-item">📡 <strong>${p.updateCount || 0} pts</strong></div>
    </div>
    ${lat !== '—' ? `<div class="pc-coords">📍 ${lat}, ${lng}</div><button class="pc-locate-btn" data-id="${p.id}">🎯 Focus on Map</button>` : ''}
  `;
  card.addEventListener('click', () => selectPerson(p.id));
  card.querySelector('.pc-locate-btn')?.addEventListener('click', (e) => { e.stopPropagation(); flyTo(p.id); });
  return card;
}

function patchCard(id) {
  const p = S.people.get(id); if (!p) return;
  const old = document.getElementById(`card-${id}`);
  if (!old) { renderList(); return; }
  old.replaceWith(buildCard(p));
}

// ── Map interactions ───────────────────────────────────────────
function selectPerson(id) {
  if (S.sel) document.getElementById(`card-${S.sel}`)?.classList.remove('selected');
  S.sel = id;
  const c = document.getElementById(`card-${id}`);
  if (c) { c.classList.add('selected'); c.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  flyTo(id);
}

function flyTo(id) {
  const p = S.people.get(id);
  if (!p || p.lat == null) { toast('No location yet', 'inf'); return; }
  S.map.flyTo([p.lat, p.lng], 16, { animate: true, duration: 1.2 });
  const m = S.markers.get(id);
  if (m) setTimeout(() => m.openPopup(), 1250);
}

function fitAll() {
  const coords = Array.from(S.markers.values()).map((m) => m.getLatLng()).filter(Boolean);
  if (!coords.length) { toast('No live people yet', 'inf'); return; }
  if (coords.length === 1) { S.map.flyTo(coords[0], 14); return; }
  S.map.flyToBounds(L.latLngBounds(coords), { padding: [60, 60], animate: true, duration: 1 });
}

// ── Stats ──────────────────────────────────────────────────────
function updateStats() {
  const all  = Array.from(S.people.values());
  const live = all.filter((p) => p.status === 'online').length;
  document.getElementById('count-live').textContent    = live;
  document.getElementById('count-total').textContent   = all.length;
  document.getElementById('count-offline').textContent = all.length - live;
}

// ── Live feed ──────────────────────────────────────────────────
function feed(color, msg) {
  const f = document.getElementById('live-feed');
  const d = document.createElement('div');
  d.className = 'feed-item';
  d.innerHTML = `<span class="feed-dot ${color}"></span><div><div class="feed-msg">${msg}</div><div class="feed-ts">${new Date().toLocaleTimeString()}</div></div>`;
  f.insertBefore(d, f.firstChild);
  while (f.children.length > 15) f.removeChild(f.lastChild);
}

// ── Modal ──────────────────────────────────────────────────────
function openModal() {
  document.getElementById('modal-overlay').classList.add('open');
  document.getElementById('link-result').classList.remove('show');
  document.getElementById('inp-phone').focus();
}
function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  document.getElementById('link-result').classList.remove('show');
  document.getElementById('inp-phone').value = '';
  document.getElementById('inp-label').value = '';
  S.genLink = '';
}

async function generateLink() {
  const phone = document.getElementById('inp-phone').value.trim();
  const label = document.getElementById('inp-label').value.trim();

  if (!phone) { toast('Please enter a phone number', 'err'); return; }

  const btn = document.getElementById('btn-generate');
  btn.disabled = true;
  btn.textContent = '⏳ Generating…';

  try {
    const res  = await fetch('/api/generate?' + new URLSearchParams({ phone, label: label || phone }));
    const data = await res.json();

    if (!data.success) throw new Error(data.message || 'Failed');

    S.genLink = data.link;
    const lt = document.getElementById('link-text');
    lt.textContent = data.link;
    lt.href        = data.link;
    document.getElementById('open-link').href = data.link;

    if (data.expiresAt) {
      document.getElementById('link-expires').textContent =
        'Expires ' + new Date(data.expiresAt).toLocaleString();
    }

    const name    = label || phone;
    const msgBody = `Hi ${name},\n\nSomeone is requesting to track your live location.\n\nOpen this link on your phone and tap "Allow Location & Start Sharing":\n\n${data.link}\n\n– Sent via PinDrop`;

    document.getElementById('share-wa').href    = `https://wa.me/?text=${encodeURIComponent(msgBody)}`;
    document.getElementById('share-sms').href   = `sms:?body=${encodeURIComponent(msgBody)}`;
    document.getElementById('share-email').href = `mailto:?subject=${encodeURIComponent('Live Location Request — PinDrop')}&body=${encodeURIComponent(msgBody)}`;

    document.getElementById('link-result').classList.add('show');
    toast('Tracking link ready!', 'ok');
  } catch (e) {
    toast(e.message || 'Server error', 'err');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg> Generate Tracking Link`;
  }
}

function copyLink() {
  if (!S.genLink) return;
  const btn = document.getElementById('copy-btn');
  navigator.clipboard.writeText(S.genLink).then(() => {
    toast('Copied!', 'ok');
    btn.textContent = '✓ Copied';
    setTimeout(() => { btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> Copy`; }, 2200);
  }).catch(() => {
    const t = document.createElement('textarea');
    t.value = S.genLink; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
    toast('Copied!', 'ok');
  });
}

// ── URL Banner ─────────────────────────────────────────────────
function showUrlBanner(url) {
  const banner = document.getElementById('url-banner');
  document.getElementById('url-banner-text').textContent = url;
  banner.style.display = 'flex';
}

// ── Server status ──────────────────────────────────────────────
function setServerStatus(online) {
  const el   = document.getElementById('server-dot-wrap');
  const text = document.getElementById('server-status-text');
  if (online) { el.classList.remove('offline'); text.textContent = 'Live'; }
  else        { el.classList.add('offline');    text.textContent = 'Offline'; }
}

// ── Toasts ─────────────────────────────────────────────────────
function toast(msg, type = 'inf') {
  const c = document.getElementById('toasts');
  const icons = { ok: '✅', err: '❌', inf: 'ℹ️' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = `${icons[type]} ${msg}`;
  c.appendChild(el);
  setTimeout(() => {
    el.style.cssText += 'opacity:0;transform:translateX(30px);transition:all .3s ease';
    setTimeout(() => el.remove(), 320);
  }, 3500);
}

// ── Utils ──────────────────────────────────────────────────────
function relTime(iso) {
  const d = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (d < 5)    return 'Just now';
  if (d < 60)   return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  return `${Math.floor(d / 3600)}h ago`;
}

function esc(s) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(String(s || '')));
  return d.innerHTML;
}

// Refresh timestamps
setInterval(() => S.people.forEach((p) => patchCard(p.id)), 30_000);

// ── Boot ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('init-ts').textContent = new Date().toLocaleTimeString();

  initMap();
  initSocket();

  // Fetch public URL immediately (tunnel may already be running)
  fetch('/api/public-url').then(r => r.json()).then(d => {
    if (d.isPublic && d.url) showUrlBanner(d.url);
  }).catch(() => {});

  document.getElementById('btn-new-track').addEventListener('click', openModal);
  document.getElementById('btn-fit-all').addEventListener('click', fitAll);
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('btn-generate').addEventListener('click', generateLink);
  document.getElementById('copy-btn').addEventListener('click', copyLink);

  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
    if (e.key === 'Enter' && document.getElementById('modal-overlay').classList.contains('open')) generateLink();
  });

  document.getElementById('search-input').addEventListener('input', renderList);

  document.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      S.filter = btn.dataset.filter;
      renderList();
    });
  });
});
