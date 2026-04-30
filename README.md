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
| Small  | 4     | 50 kg    |
| Medium | 4     | 100 kg   |
| Large  | 2     | 200 kg   |

---

## TODO

- [ ] **Prioritize large vehicles for better economy** — Currently the greedy assignment picks the vehicle with shortest duration. Consider prioritizing large vehicles first to reduce total number of vehicles used and lower cost.
- [ ] **Cluster nearby points before assignment** — Location indices are sorted by demand but not by geography. Nearby points should be clustered first to avoid multiple vehicles making duplicate trips to the same area.

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

### GET /api/vrp/vehicles

Get default vehicle configuration.

---

## Security Notes

### About Mapbox Access Token

This project uses a **public token** (`pk.eyJ1...`) for Mapbox GL JS initialization.

**Public Tokens:**
- Intended for client-side use (browser-based web apps)
- Should only have **public scopes** (read-only access to styles)
- **Visible in client-side code** - this is expected and by design
- Can be restricted with **URL restrictions** so they only work from specified domains
- **Compatible with Mapbox GL JS v0.53.1+**

**Secret Tokens:**
- Must **never be exposed to the client**
- All requests needing secret scopes should be made on a server
- For sensitive operations, use the **Tokens API** to create a temporary token

**Best Practices:**

1. **Generate a new token** - Don't use the default public token; create one with proper scopes
2. **Set URL restrictions** - Limit to your specific domains
3. **Minimize scopes** - Only grant scopes necessary for the task
4. **Isolate tokens** - Use distinct tokens per application for tracking
5. **Rotate tokens** - If misuse is suspected, rotate immediately
6. **Monitor usage** - Check Statistics page for anomalous patterns

See [Mapbox security documentation](https://docs.mapbox.com/help/dive-deeper/how-to-use-mapbox-securely/#access-tokens) for details.

---

## Related Documentation

- [物流配送路线优化方案](./物流配送路线优化方案.md) - Chinese documentation
