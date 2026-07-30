/* ══════════════════════════════════════════════════════════════
   tracker.js — PinDrop Share Page
   Handles: token validation, GPS watchPosition, Socket.io emit
   ══════════════════════════════════════════════════════════════ */
'use strict';

// ── URL params ─────────────────────────────────────────────────
const params = new URLSearchParams(window.location.search);
const me = {
  id: null,
  label: '...',
  phone: '...',
  token: params.get('token') || null,
};

function rndId() { return Math.random().toString(36).slice(2, 8).toUpperCase(); }

// ── State ──────────────────────────────────────────────────────
let socket = null;
let watchId = null;
let sharing = false;
let sendCount = 0;
let tokenOK = false;

// ── Helpers ────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id) || { classList: { add(){}, remove(){} }, style: {}, set textContent(v){} };

// ── Init UI ────────────────────────────────────────────────────
function initUI() {
  $('info-label').textContent = me.label;
  $('info-phone').textContent = me.phone;
  $('share-title').textContent = `Hi, ${me.label}!`;
  document.title = `PinDrop — ${me.label}`;
}

// ── Token validation ───────────────────────────────────────────
async function validateToken() {
  if (!me.token) {
    showExpired();
    return false;
  }

  try {
    const r = await fetch(`https://location-tracker-3gvw.onrender.com/api/validate-token?token=${encodeURIComponent(me.token)}`);
    const d = await r.json();
    if (!d.success) { showExpired(); return false; }

    // Server confirms token is valid and returns the person's info
    me.id = d.id;
    me.label = d.label;
    me.phone = d.phone;
    tokenOK = true;

    return true;
  } catch (err) {
    setStatus('disconnected', '⚠️ Connection error verifying link');
    toast('Network error — please check your internet.', 'err');
    return false;
  }
}

function showExpired() {
  tokenOK = false;
  $('link-expired').classList.add('show');
  $('btn-allow').disabled = true;
  $('btn-allow').style.opacity = '0.35';
  setStatus('disconnected', '⚠️ This link has expired');
  toast('Link expired — ask for a new one', 'err');
}

// ── Socket ─────────────────────────────────────────────────────
function initSocket() {
  socket = io('https://location-tracker-3gvw.onrender.com', { reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 5000 });

  socket.on('connect', () => {
    setStatus('connected', '🟢 Connected');
    socket.emit('register-tracker', { id: me.id, label: me.label, phone: me.phone, token: me.token });
    if (sharing) setStatus('sharing', '📡 Broadcasting location…');
  });

  socket.on('registered', () => toast('Connected to PinDrop', 'ok'));

  socket.on('auth-error', (d) => {
    showExpired();
    if (sharing) stopSharing();
    socket.disconnect();
  });

  socket.on('disconnect', () => setStatus('disconnected', '🔴 Reconnecting…'));
  socket.on('connect_error', () => setStatus('disconnected', '🔴 Server unreachable'));
}

// ── Geolocation ────────────────────────────────────────────────
function startSharing() {
  if (!tokenOK) { toast('This link has expired', 'err'); return; }
  if (!navigator.geolocation) { toast('Geolocation not supported on this device', 'err'); return; }

  $('btn-allow').style.display = 'none';
  $('share-title').textContent = `Sharing Active!`;
  document.querySelector('.share-desc').textContent = 'Your location is now being shared live.';
  
  sharing = true;

  watchId = navigator.geolocation.watchPosition(
    onGPS,
    onGPSError,
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
  );
}

function stopSharing() {
  if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  sharing = false;

  $('btn-allow').style.display = 'flex';
  $('btn-stop').style.display = 'none';
  $('gps-panel').classList.remove('show');

  setStatus('connected', '🟢 Connected — not sharing');
  toast('Stopped sharing location', 'inf');

  if (socket?.connected) socket.emit('stop-sharing', { id: me.id });
}

function onGPS(pos) {
  const c = pos.coords;

  // Update UI
  $('gps-lat').textContent = c.latitude.toFixed(6);
  $('gps-lng').textContent = c.longitude.toFixed(6);
  $('gps-acc').textContent = c.accuracy.toFixed(0);
  $('gps-spd').textContent = c.speed != null ? (c.speed * 3.6).toFixed(1) : '0';

  const pct = Math.max(0, Math.min(100, ((500 - c.accuracy) / 495) * 100));
  $('acc-fill').style.width = pct + '%';

  // Emit
  if (socket?.connected) {
    socket.emit('location-update', {
      id: me.id,
      lat: c.latitude,
      lng: c.longitude,
      accuracy: c.accuracy,
      speed: c.speed,
      heading: c.heading,
      altitude: c.altitude,
      timestamp: new Date().toISOString(),
    });
    sendCount++;
    $('update-count').textContent = sendCount;
    setStatus('sharing', '📡 Broadcasting location…');
  } else {
    setStatus('disconnected', '⏳ Reconnecting…');
  }
}

function onGPSError(err) {
  const msgs = {
    1: 'Permission denied — enable location in browser settings.',
    2: 'Location unavailable — check your GPS.',
    3: 'GPS timeout — please try again.',
  };
  const msg = msgs[err.code] || 'GPS error';
  toast(msg, 'err');
  setStatus('disconnected', '❌ ' + msg);
  if (err.code === 1) stopSharing();
}

// ── UI helpers ─────────────────────────────────────────────────
function setStatus(type, text) {
  // UI status removed as per user request
}

function toast(msg, type = 'inf') {
  const c = $('toasts');
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

// ── Visibility / cleanup ───────────────────────────────────────
document.addEventListener('visibilitychange', () => {
  if (!sharing) return;
  setStatus('sharing', document.hidden ? '📡 Tracking in background…' : '📡 Broadcasting location…');
});

window.addEventListener('beforeunload', () => {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
});

// ── Boot ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const ok = await validateToken();
  if (ok) {
    initUI();
    initSocket();
  }

  $('btn-allow').addEventListener('click', startSharing);
  $('btn-stop').addEventListener('click', stopSharing);
});
