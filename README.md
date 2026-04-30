# Logistics Route Optimization System

A logistics delivery route planning system built with Vue.js, Mapbox APIs, and VRP algorithm.

[中文文档](./物流配送路线优化方案.md)

---

## Features

- **Manual Delivery Point Setting**: Click on map to add delivery points
- **Smart Route Planning**: VRP algorithm with greedy assignment + 2-opt optimization
- **Multi-Vehicle Coordination**: Supports 10 vehicles (3 types) with capacity constraints
- **Interactive Map Visualization**: Display routes with different colors per vehicle
- **Hover Highlighting**: Highlight route and delivery points on hover
- **Color Sync**: Delivery point markers match their route colors
- **State Persistence**: localStorage saves delivery points and solutions
- **i18n Support**: English (default) and Chinese

---

## Tech Stack

- **Frontend**: Vue.js 3 + Composition API
- **Mapbox GL JS**: Map visualization
- **Mapbox Matrix API**: Distance matrix calculation
- **Mapbox Directions API**: Road-matching geometry
- **Backend**: Node.js + Express
- **VRP Algorithm**: Greedy + 2-opt optimization
- **i18n**: vue-i18n

---

## Quick Start

### 1. Start VRP Solver Backend

```bash
cd server
npm install
node vrp-solver.js
```

Backend runs on http://localhost:3001

### 2. Start Frontend

```bash
npm install
npm run dev
```

Open http://localhost:5173

### 3. Use the App

1. Click "Logistics" tab
2. Click "Start Setting Points" and click on map to add delivery points
3. Click "Complete" when done
4. Click "Calculate Optimal" to get route plan
5. Hover over a route to highlight it and its delivery points

---

## Project Structure

```
mapbox-vue-app/
├── src/
│   ├── components/
│   │   └── LogisticsPanel.vue    # Main logistics component
│   ├── locales/
│   │   ├── en.json               # English translations
│   │   ├── zh.json               # Chinese translations
│   │   └── index.js              # i18n configuration
│   ├── App.vue                   # Main app with tabs
│   └── main.js                   # App entry point
└── server/
    └── vrp-solver.js             # VRP solver backend
```

---

## Vehicle Configuration

| Type   | Count | Capacity |
|--------|-------|----------|
| Small  | 4     | 20 kg    |
| Medium | 4     | 50 kg    |
| Large  | 2     | 100 kg   |

---

## API Endpoints

### POST /api/vrp/optimize

Solve VRP problem with given locations and vehicles.

**Request Body:**
```json
{
  "locations": [...],
  "vehicles": [...],
  "durations": [[...]],
  "distances": [[...]]
}
```

### GET /api/vrp/points?count=50

Generate random delivery points for testing.

### GET /api/vrp/vehicles

Get default vehicle configuration.

---

## Security Notes

### About Mapbox Access Token

This project uses a **public token** (`pk.eyJ1...`) for Mapbox GL JS initialization. This is the standard approach recommended by Mapbox for client-side applications.

**Public tokens are designed to be:**
- Visible in client-side code
- Used in browsers/web apps
- Restricted by URL referrers and quota limits

**Best Practices for Production:**

1. **Set URL restrictions** in your [Mapbox account](https://account.mapbox.com/access-tokens/)
   - Limit token to specific domains (e.g., `yourdomain.com`)
   - Prevents token from being used on unauthorized sites

2. **Set quota limits**
   - Prevents abuse if token is somehow exploited

3. **For higher security** (optional):
   - Move Mapbox API calls to backend
   - Use a secret token on the server
   - Browser never sees the token

For most applications, public token + URL restrictions is sufficient. See [Mapbox security documentation](https://docs.mapbox.com/help/troubleshooting/security-guidance/) for details.

---

## Related Documentation

- [物流配送路线优化方案](./物流配送路线优化方案.md) - Chinese documentation
