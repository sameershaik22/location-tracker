require('dotenv').config();
const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
let   localtunnel = null;
try { localtunnel = require('localtunnel'); } catch(_) {}
const cors   = require('cors');
const path   = require('path');
const { v4: uuidv4 } = require('uuid');

const app    = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST', 'DELETE'] },
  pingTimeout:  10000,
  pingInterval: 5000,
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// ──────────────────────────────────────────────────────────────────────────────
// In-memory stores
// ──────────────────────────────────────────────────────────────────────────────
const tokenStore  = new Map(); // token → { id, label, phone, createdAt, expiresAt }
const trackers    = new Map(); // socketId → trackerData
const TOKEN_TTL   = 24 * 60 * 60 * 1000; // 24 hours
let   PUBLIC_URL  = '';        // filled by localtunnel once available

function purgeExpiredTokens() {
  const now = Date.now();
  for (const [token, rec] of tokenStore.entries()) {
    if (now >= rec.expiresAt) tokenStore.delete(token);
  }
}
setInterval(purgeExpiredTokens, 30 * 60 * 1000);

function isTokenValid(token) {
  if (!token || !tokenStore.has(token)) return false;
  return Date.now() < tokenStore.get(token).expiresAt;
}

// ──────────────────────────────────────────────────────────────────────────────
// REST API
// ──────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/generate
 * Body: { label, phone }
 * Returns: { trackingLink, token, id }
 */
app.post('/api/generate', (req, res) => {
  let { label, phone } = req.body;
  if (!phone) return res.status(400).json({ success: false, message: 'phone is required' });

  label = label || phone;
  const id      = uuidv4().split('-')[0].toUpperCase();
  const token   = uuidv4();
  const now     = Date.now();
  const expiresAt = now + TOKEN_TTL;

  tokenStore.set(token, { id, label, phone, createdAt: new Date(now).toISOString(), expiresAt });

  const baseUrl = PUBLIC_URL || `${req.protocol}://${req.headers.host}`;
  const trackingLink = `${baseUrl}/track.html?token=${token}`;

  res.json({ success: true, id, token, trackingLink, expiresAt: new Date(expiresAt).toISOString() });
});

/**
 * GET /api/generate (query-string version used by front-end)
 */
app.get('/api/generate', (req, res) => {
  let { label, phone } = req.query;
  if (!phone) return res.status(400).json({ success: false, message: 'phone is required' });

  label = label || phone;
  const id      = uuidv4().split('-')[0].toUpperCase();
  const token   = uuidv4();
  const now     = Date.now();
  const expiresAt = now + TOKEN_TTL;

  tokenStore.set(token, { id, label, phone, createdAt: new Date(now).toISOString(), expiresAt });

  const baseUrl = PUBLIC_URL || `${req.protocol}://${req.headers.host}`;
  const link    = `${baseUrl}/track.html?token=${token}`;

  res.json({ success: true, id, token, link, expiresAt: new Date(expiresAt).toISOString() });
});

/** GET /api/validate-token */
app.get('/api/validate-token', (req, res) => {
  const { token } = req.query;
  if (!isTokenValid(token)) return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  const rec = tokenStore.get(token);
  res.json({ success: true, id: rec.id, label: rec.label, phone: rec.phone });
});

/** GET /api/trackers — all active trackers */
app.get('/api/trackers', (req, res) => {
  const list = Array.from(trackers.values()).map((t) => ({ ...t }));
  res.json({ success: true, count: list.length, trackers: list });
});

/** GET /api/location/:id */
app.get('/api/location/:id', (req, res) => {
  const t = Array.from(trackers.values()).find((e) => e.id === req.params.id);
  if (!t) return res.status(404).json({ success: false, message: 'Not found' });
  res.json({ success: true, location: t });
});

/** DELETE /api/location/:id */
app.delete('/api/location/:id', (req, res) => {
  let found = false;
  for (const [sid, t] of trackers.entries()) {
    if (t.id === req.params.id) {
      trackers.delete(sid);
      io.emit('tracker-removed', { socketId: sid, id: t.id });
      found = true;
      break;
    }
  }
  if (!found) return res.status(404).json({ success: false, message: 'Not found' });
  res.json({ success: true });
});

/** GET /api/public-url — returns the public tunnel URL (if available) */
app.get('/api/public-url', (req, res) => {
  res.json({ success: true, url: PUBLIC_URL || `http://${req.headers.host}`, isPublic: !!PUBLIC_URL });
});

/** GET /api/health */
app.get('/api/health', (req, res) => {
  res.json({ success: true, uptime: process.uptime(), activeTrackers: trackers.size, tokens: tokenStore.size, ts: new Date().toISOString() });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ──────────────────────────────────────────────────────────────────────────────
// Socket.io
// ──────────────────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);

  socket.on('register-tracker', (data) => {
    // Token check
    if (data.token && !isTokenValid(data.token)) {
      socket.emit('auth-error', { message: 'Link expired. Please ask for a new one.' });
      return;
    }

    const tracker = {
      socketId:    socket.id,
      id:          data.id  || uuidv4().split('-')[0].toUpperCase(),
      label:       data.label || data.phone || 'Unknown',
      phone:       data.phone || 'N/A',
      status:      'online',
      lat:         null,
      lng:         null,
      accuracy:    null,
      speed:       null,
      heading:     null,
      altitude:    null,
      lastSeen:    new Date().toISOString(),
      connectedAt: new Date().toISOString(),
      updateCount: 0,
    };

    trackers.set(socket.id, tracker);
    console.log(`[Tracker] Online: ${tracker.label} (${tracker.phone})`);

    socket.emit('registered', { success: true, id: tracker.id });
    io.emit('tracker-online', { ...tracker, message: `${tracker.label} is now sharing location` });
    socket.emit('tracker-list', Array.from(trackers.values()));
  });

  socket.on('location-update', (data) => {
    const t = trackers.get(socket.id);
    if (!t) return;

    t.lat      = data.lat;
    t.lng      = data.lng;
    t.accuracy = data.accuracy ?? null;
    t.speed    = data.speed    ?? null;
    t.heading  = data.heading  ?? null;
    t.altitude = data.altitude ?? null;
    t.lastSeen = new Date().toISOString();
    t.updateCount = (t.updateCount || 0) + 1;
    t.status   = 'online';

    trackers.set(socket.id, t);

    io.emit('location-broadcast', {
      socketId:    socket.id,
      id:          t.id,
      label:       t.label,
      phone:       t.phone,
      lat:         t.lat,
      lng:         t.lng,
      accuracy:    t.accuracy,
      speed:       t.speed,
      heading:     t.heading,
      altitude:    t.altitude,
      lastSeen:    t.lastSeen,
      updateCount: t.updateCount,
      status:      'online',
    });
  });

  socket.on('get-trackers', () => {
    socket.emit('tracker-list', Array.from(trackers.values()));
  });

  socket.on('stop-sharing', () => {
    const t = trackers.get(socket.id);
    if (t) {
      t.status   = 'offline';
      t.lastSeen = new Date().toISOString();
      io.emit('tracker-offline', { socketId: socket.id, id: t.id, label: t.label, phone: t.phone, lastSeen: t.lastSeen, status: 'offline' });
    }
  });

  socket.on('disconnect', (reason) => {
    const t = trackers.get(socket.id);
    if (t) {
      t.status   = 'offline';
      t.lastSeen = new Date().toISOString();
      console.log(`[Tracker] Offline: ${t.label} — ${reason}`);

      io.emit('tracker-offline', { socketId: socket.id, id: t.id, label: t.label, phone: t.phone, lastSeen: t.lastSeen, status: 'offline' });

      setTimeout(() => {
        trackers.delete(socket.id);
        io.emit('tracker-removed', { socketId: socket.id, id: t.id });
      }, 5 * 60 * 1000);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Start
// ──────────────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║  PinDrop — Personal Location Tracker     ║`);
  console.log(`║  Local:  http://localhost:${PORT}            ║`);
  console.log(`╚══════════════════════════════════════════╝\n`);

  // Start localtunnel only in development (not on real servers like Render)
  if (localtunnel && process.env.NODE_ENV !== 'production' && !process.env.RENDER) {
    try {
      const tunnel = await localtunnel({ port: PORT });
      PUBLIC_URL = tunnel.url;
      console.log(`✅  Public URL: ${PUBLIC_URL}`);
      console.log(`    Share this with anyone — links will use this URL.\n`);

      // Notify any connected admins
      io.emit('public-url', { url: PUBLIC_URL });

      tunnel.on('close', () => {
        PUBLIC_URL = '';
        console.warn('[Tunnel] Closed — links will fall back to localhost');
      });
    } catch (err) {
      console.warn('[Tunnel] Could not start localtunnel:', err.message);
      console.warn('          Links will use localhost — only accessible on this machine.\n');
    }
  }
});
