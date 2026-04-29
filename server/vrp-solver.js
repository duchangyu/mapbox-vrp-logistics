/**
 * VRP (Vehicle Routing Problem) Solver Service
 * Uses greedy algorithm + 2-opt optimization for multi-vehicle route planning
 */

import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3001;

// Vehicle configurations
const VEHICLE_TYPES = [
  { type: 'small', count: 4, capacity: 50 },
  { type: 'medium', count: 4, capacity: 100 },
  { type: 'large', count: 2, capacity: 200 },
];

// Warehouse location (SFO area - UPS Logistics Center)
const WAREHOUSE = { id: 'warehouse', coords: [-122.3892, 37.6213], demand: 0 };

/**
 * Calculate distance between two points (Haversine formula)
 */
function calculateDistance(p1, p2) {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(p2.coords[1] - p1.coords[1]);
  const dLon = toRad(p2.coords[0] - p1.coords[0]);
  const lat1 = toRad(p1.coords[1]);
  const lat2 = toRad(p2.coords[1]);

  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg) {
  return deg * Math.PI / 180;
}

/**
 * Build distance matrix for all locations
 */
function buildDistanceMatrix(locations) {
  const n = locations.length;
  const matrix = Array(n).fill(null).map(() => Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i !== j) {
        matrix[i][j] = calculateDistance(locations[i], locations[j]);
      }
    }
  }
  return matrix;
}

/**
 * 2-opt optimization for a single route
 */
function twoOptOptimize(route, durationMatrix) {
  if (route.length <= 3) return route;

  let improved = true;
  let bestRoute = [...route];

  while (improved) {
    improved = false;
    for (let i = 1; i < bestRoute.length - 2; i++) {
      for (let j = i + 1; j < bestRoute.length - 1; j++) {
        const delta = -durationMatrix[bestRoute[i - 1]][bestRoute[i]]
                     - durationMatrix[bestRoute[j]][bestRoute[j + 1]]
                     + durationMatrix[bestRoute[i - 1]][bestRoute[j]]
                     + durationMatrix[bestRoute[i]][bestRoute[j + 1]];

        if (delta < -0.0001) {
          // Reverse segment between i and j
          const newRoute = [
            ...bestRoute.slice(0, i),
            ...bestRoute.slice(i, j + 1).reverse(),
            ...bestRoute.slice(j + 1)
          ];
          bestRoute = newRoute;
          improved = true;
        }
      }
    }
  }
  return bestRoute;
}

/**
 * Calculate route total distance
 */
function calculateRouteDistance(route, distMatrix) {
  let total = 0;
  for (let i = 0; i < route.length - 1; i++) {
    total += distMatrix[route[i]][route[i + 1]];
  }
  return total;
}

/**
 * Calculate total demand for a route
 */
function calculateRouteDemand(route, locations) {
  return route.reduce((sum, idx) => sum + (locations[idx].demand || 0), 0);
}

/**
 * Solve VRP using greedy algorithm + 2-opt optimization
 */
function solveVRP(locations, distanceMatrix, durationMatrix, vehicles) {
  const n = locations.length;
  const numVehicles = vehicles.length;

  // Initialize vehicle routes
  const vehicleRoutes = vehicles.map(() => [0]); // Start from warehouse (index 0)
  const vehicleLoads = vehicles.map(() => 0);
  const vehicleDistances = vehicles.map(() => 0);
  const vehicleDurations = vehicles.map(() => 0);

  // Track which locations have been assigned
  const assigned = new Set();
  assigned.add(0); // Warehouse is always index 0

  // Sort locations by demand (descending) for better load balancing
  const locationIndices = [];
  for (let i = 1; i < n; i++) {
    locationIndices.push(i);
  }
  locationIndices.sort((a, b) => (locations[b].demand || 0) - (locations[a].demand || 0));

  // Greedy assignment
  for (const locIdx of locationIndices) {
    const loc = locations[locIdx];
    const demand = loc.demand || 1;

    // Find best vehicle for this location
    let bestVehicle = -1;
    let bestDuration = Infinity;
    let bestLastIdx = 0;

    for (let v = 0; v < numVehicles; v++) {
      const lastIdx = vehicleRoutes[v][vehicleRoutes[v].length - 1];
      const duration = durationMatrix[lastIdx][locIdx];

      // Check capacity constraint
      if (vehicleLoads[v] + demand <= vehicles[v].capacity) {
        if (duration < bestDuration) {
          bestDuration = duration;
          bestVehicle = v;
          bestLastIdx = lastIdx;
        }
      }
    }

    // If no vehicle can accommodate, force assign to vehicle with most remaining capacity
    if (bestVehicle === -1) {
      for (let v = 0; v < numVehicles; v++) {
        if (vehicleLoads[v] + demand <= vehicles[v].capacity * 1.5) { // Allow 50% overload
          const lastIdx = vehicleRoutes[v][vehicleRoutes[v].length - 1];
          const duration = durationMatrix[lastIdx][locIdx];
          if (duration < bestDuration) {
            bestDuration = duration;
            bestVehicle = v;
            bestLastIdx = lastIdx;
          }
        }
      }
    }

    if (bestVehicle !== -1) {
      vehicleRoutes[bestVehicle].push(locIdx);
      vehicleLoads[bestVehicle] += demand;
      vehicleDurations[bestVehicle] += bestDuration;
      vehicleDistances[bestVehicle] += distanceMatrix[bestLastIdx][locIdx];
      assigned.add(locIdx);
    }
  }

  // Return to warehouse for each route
  for (let v = 0; v < numVehicles; v++) {
    if (vehicleRoutes[v].length > 1) {
      vehicleRoutes[v].push(0); // Return to warehouse
      const lastIdx = vehicleRoutes[v][vehicleRoutes[v].length - 2];
      vehicleDurations[v] += durationMatrix[lastIdx][0];
      vehicleDistances[v] += distanceMatrix[lastIdx][0];
    }
  }

  // Apply 2-opt optimization to each route
  for (let v = 0; v < numVehicles; v++) {
    if (vehicleRoutes[v].length > 4) {
      const optimized = twoOptOptimize(vehicleRoutes[v], durationMatrix);
      vehicleRoutes[v] = optimized;
      vehicleDurations[v] = calculateRouteDuration(optimized, durationMatrix);
      vehicleDistances[v] = calculateRouteDistance(optimized, distanceMatrix);
    }
  }

  return {
    routes: vehicleRoutes.map((route, v) => ({
      vehicleId: v,
      vehicleType: vehicles[v].type,
      capacity: vehicles[v].capacity,
      load: vehicleLoads[v],
      distance: vehicleDistances[v],
      duration: vehicleDurations[v],
      stops: route.map(idx => ({
        index: idx,
        id: locations[idx].id,
        coords: locations[idx].coords,
        name: locations[idx].name || `Point ${idx}`,
        demand: locations[idx].demand || 0,
        sequence: route.indexOf(idx)
      }))
    })),
    totalDistance: vehicleDistances.reduce((a, b) => a + b, 0),
    totalDuration: vehicleDurations.reduce((a, b) => a + b, 0),
    totalDemand: locations.slice(1).reduce((sum, loc) => sum + (loc.demand || 0), 0)
  };
}

/**
 * Calculate route total duration
 */
function calculateRouteDuration(route, durationMatrix) {
  let total = 0;
  for (let i = 0; i < route.length - 1; i++) {
    total += durationMatrix[route[i]][route[i + 1]];
  }
  return total;
}

/**
 * Generate 50 random delivery points in San Francisco area
 */
function generateSFDeliveryPoints() {
  const points = [];
  // SF urban area bounds (avoiding ocean/beaches)
  const bounds = {
    minLon: -122.44,  // Eastern boundary (inland, away from Bay)
    maxLon: -122.36,  // Western boundary
    minLat: 37.72,    // Southern boundary
    maxLat: 37.79     // Northern boundary
  };

  for (let i = 1; i <= 50; i++) {
    const lon = bounds.minLon + Math.random() * (bounds.maxLon - bounds.minLon);
    const lat = bounds.minLat + Math.random() * (bounds.maxLat - bounds.minLat);
    points.push({
      id: `point-${i}`,
      coords: [lon, lat],
      demand: Math.floor(Math.random() * 10) + 1, // Random demand 1-10
      name: `收货点 ${i}`
    });
  }

  return points;
}

// API Routes

/**
 * POST /api/vrp/optimize
 * Solve VRP with given locations and vehicles
 */
app.post('/api/vrp/optimize', (req, res) => {
  try {
    const { locations, vehicles: customVehicles, durations, distances } = req.body;

    // Build locations array (warehouse + delivery points)
    const warehouseLocation = {
      id: 'warehouse',
      coords: WAREHOUSE.coords,
      demand: 0,
      name: 'UPS物流中心 (SFO)'
    };

    let deliveryPoints;
    if (locations && locations.length > 0) {
      deliveryPoints = locations.map((loc, i) => ({
        id: loc.id || `point-${i}`,
        coords: loc.coords,
        demand: loc.demand || Math.floor(Math.random() * 10) + 1,
        name: loc.name || `收货点 ${i + 1}`
      }));
    } else {
      deliveryPoints = generateSFDeliveryPoints();
    }

    const allLocations = [warehouseLocation, ...deliveryPoints];

    // Build vehicle list
    let vehicleList;
    if (customVehicles && customVehicles.length > 0) {
      vehicleList = customVehicles;
    } else {
      vehicleList = [];
      for (const vt of VEHICLE_TYPES) {
        for (let i = 0; i < vt.count; i++) {
          vehicleList.push({
            type: vt.type,
            capacity: vt.capacity,
            id: `${vt.type}-${i + 1}`
          });
        }
      }
    }

    // Use Mapbox matrix data - required
    if (!distances || distances.length === 0 || !durations || durations.length === 0) {
      res.status(400).json({
        success: false,
        error: '缺少Mapbox距离矩阵数据，请先调用Matrix API获取距离数据'
      });
      return;
    }

    const distanceMatrix = distances;
    const durationMatrix = durations;

    // Solve VRP
    const result = solveVRP(allLocations, distanceMatrix, durationMatrix, vehicleList);

    res.json({
      success: true,
      warehouse: warehouseLocation,
      deliveryPoints,
      vehicles: vehicleList,
      solution: result
    });

  } catch (error) {
    console.error('VRP solve error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'VRP求解失败'
    });
  }
});

/**
 * GET /api/vrp/points
 * Generate random delivery points for testing
 */
app.get('/api/vrp/points', (req, res) => {
  const count = parseInt(req.query.count) || 50;
  const points = [];

  const bounds = {
    minLon: -122.52,
    maxLon: -122.35,
    minLat: 37.70,
    maxLat: 37.82
  };

  for (let i = 1; i <= count; i++) {
    const lon = bounds.minLon + Math.random() * (bounds.maxLon - bounds.minLon);
    const lat = bounds.minLat + Math.random() * (bounds.maxLat - bounds.minLat);
    points.push({
      id: `point-${i}`,
      coords: [lon, lat],
      demand: Math.floor(Math.random() * 10) + 1,
      name: `收货点 ${i}`
    });
  }

  res.json({
    success: true,
    warehouse: WAREHOUSE,
    points
  });
});

/**
 * GET /api/vrp/vehicles
 * Get default vehicle configuration
 */
app.get('/api/vrp/vehicles', (req, res) => {
  const vehicles = [];
  for (const vt of VEHICLE_TYPES) {
    for (let i = 0; i < vt.count; i++) {
      vehicles.push({
        type: vt.type,
        capacity: vt.capacity,
        id: `${vt.type}-${i + 1}`
      });
    }
  }
  res.json({ success: true, vehicles });
});

app.listen(PORT, () => {
  console.log(`VRP Solver service running on http://localhost:${PORT}`);
  console.log('Available endpoints:');
  console.log('  POST /api/vrp/optimize - Solve VRP');
  console.log('  GET  /api/vrp/points   - Generate random points');
  console.log('  GET  /api/vrp/vehicles - Get vehicle config');
});
