# LiveTrack Pro 📡

**Consent-Based Live Location Tracking Platform**

A professional, full-stack real-time employee location tracking system. No mobile app required — employees simply open a link in their phone browser and tap **Start Sharing Location**.

---

## Features

- ✅ Real-time GPS tracking via `navigator.geolocation.watchPosition()`
- ✅ Socket.io live updates with smooth marker animation on map
- ✅ Secure 24-hour tokens (UUID v4) for each tracking link
- ✅ WhatsApp / SMS / Email share buttons for generated links
- ✅ Dark glassmorphism admin dashboard with Leaflet.js + CartoDB dark tiles
- ✅ Search employees by name, phone, ID, or department
- ✅ Filter sidebar: All / Online / Offline
- ✅ Live activity feed and toast notifications
- ✅ Employee online/offline detection with 5-min auto-purge
- ✅ Fit-all-map button and smooth fly-to animations
- ✅ Fully responsive (mobile, tablet, desktop)
- ✅ Token validation with friendly error page for expired links

---

## Tech Stack

| Layer     | Technologies                                          |
|-----------|-------------------------------------------------------|
| Backend   | Node.js · Express.js · Socket.io · UUID · dotenv · CORS |
| Frontend  | Vanilla HTML · CSS (glassmorphism) · JavaScript       |
| Map       | Leaflet.js · CartoDB Dark Tiles (OpenStreetMap)       |

---

## Folder Structure

```
live-location-tracker/
├── backend/
│   ├── server.js          # Main Express + Socket.io server
│   ├── .env               # PORT, NODE_ENV config
│   └── package.json
└── frontend/
    ├── index.html         # Admin dashboard
    ├── track.html         # Employee tracking page
    ├── css/
    │   └── styles.css     # Premium dark theme
    └── js/
        ├── admin.js       # Dashboard logic (map, sockets, UI)
        └── tracker.js     # Tracker logic (GPS, socket, token)
```

---

## Quick Start

```bash
cd backend
npm install
npm run dev        # starts on http://localhost:3000
```

Open **http://localhost:3000** for the admin dashboard.

---

## REST API

| Method   | Endpoint                  | Description                          |
|----------|---------------------------|--------------------------------------|
| `GET`    | `/api/generate-link`      | Generate a tracking link (query params) |
| `POST`   | `/api/register`           | Register employee & get tracking link |
| `GET`    | `/api/validate-token`     | Check if a token is still valid      |
| `GET`    | `/api/employees`          | List all tracked employees           |
| `GET`    | `/api/location/:id`       | Get latest location for an employee  |
| `DELETE` | `/api/location/:id`       | Stop tracking an employee            |
| `GET`    | `/api/health`             | Server health check                  |

---

## Socket Events

| Direction        | Event                  | Payload                        |
|------------------|------------------------|--------------------------------|
| Client → Server  | `register-employee`    | `{ id, name, phone, dept, token }` |
| Client → Server  | `location-update`      | `{ id, lat, lng, accuracy, speed, … }` |
| Client → Server  | `get-employees`        | —                              |
| Client → Server  | `stop-tracking`        | `{ id }`                       |
| Server → Client  | `registered`           | `{ success, id }`              |
| Server → Client  | `auth-error`           | `{ message }`                  |
| Server → Client  | `employee-connected`   | employee object                |
| Server → Client  | `location-broadcast`   | location object                |
| Server → Client  | `employee-disconnected`| `{ id, name, lastSeen, status }` |
| Server → Client  | `employee-removed`     | `{ id }`                       |
| Server → Client  | `employee-list`        | `[ …employees ]`               |

---

## Security & Consent

- Tracking links include a **UUID v4 token** that expires after **24 hours**
- The server validates the token on socket registration; invalid tokens receive `auth-error`
- The employee **must** open the link and explicitly tap **Start Sharing Location**
- Location is only shared while the browser tab is active; closing stops all sharing
- No location data is stored permanently (in-memory only; cleared after 5 min offline)

---

## Future Roadmap

- [ ] PostgreSQL + Redis persistence
- [ ] JWT admin authentication
- [ ] Route history & playback
- [ ] Geofencing alerts
- [ ] SOS button & emergency contact
- [ ] CSV export
- [ ] Heatmap / analytics
- [ ] Docker deployment
- [ ] Multiple admins with role management
