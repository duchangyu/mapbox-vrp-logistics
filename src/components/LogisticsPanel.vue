<template>
  <div class="logistics-panel">
    <!-- Point setting mode -->
    <div class="setting-mode" v-if="!isSettingComplete">
      <div class="setting-info" v-if="isSelectingPoints">
        <span class="setting-hint">在地图上点击添加收货点...</span>
        <span class="point-count">已添加: {{ tempPoints.length }} 个</span>
      </div>
      <div class="setting-buttons">
        <button v-if="!isSelectingPoints" class="btn-start" @click="startSelectingPoints">
          开始设置收货点
        </button>
        <button v-if="isSelectingPoints && tempPoints.length > 0" class="btn-done" @click="finishSettingPoints">
          完成设置 ({{ tempPoints.length }})
        </button>
        <button v-if="isSelectingPoints" class="btn-cancel" @click="cancelSelectingPoints">
          取消
        </button>
      </div>
    </div>

    <!-- Stats after setting -->
    <div class="stats" v-if="deliveryPoints.length > 0 && isSettingComplete">
      <div class="stat-item">
        <span class="stat-label">收货点</span>
        <span class="stat-value">{{ deliveryPoints.length }}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">总货物量</span>
        <span class="stat-value">{{ totalDemand }}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">车辆数</span>
        <span class="stat-value">{{ vehicles.length }}</span>
      </div>
    </div>

    <!-- Delivery points list -->
    <div class="points-list" v-if="deliveryPoints.length > 0 && isSettingComplete">
      <h4>收货点列表</h4>
      <div class="points-table">
        <div class="points-header">
          <span>序号</span>
          <span>坐标</span>
          <span>收货量</span>
        </div>
        <div
          v-for="(point, idx) in deliveryPoints"
          :key="point.id"
          class="points-row"
        >
          <span>{{ idx + 1 }}</span>
          <span>{{ point.coords[0].toFixed(4) }}, {{ point.coords[1].toFixed(4) }}</span>
          <span class="demand-value">{{ point.demand }}</span>
        </div>
      </div>
    </div>

    <div class="action-buttons" v-if="isSettingComplete">
      <button class="btn-calc" @click="calculateVRP" :disabled="loading || deliveryPoints.length === 0">
        {{ loading ? '计算中...' : '计算最优方案' }}
      </button>
      <button class="btn-reset" @click="resetAll" :disabled="loading">
        重新设置
      </button>
    </div>

    <div class="action-buttons" v-if="deliveryPoints.length > 0 && isSettingComplete">
      <button class="btn-clear-save" @click="clearSavedState">
        删除已保存数据
      </button>
    </div>

    <div class="error-msg" v-if="errorMsg">{{ errorMsg }}</div>

    <!-- Results -->
    <div class="results" v-if="solution">
      <div class="results-header">
        <h3>配送方案</h3>
        <div class="total-stats">
          <span>总距离: {{ formatDistance(solution.totalDistance) }}</span>
          <span>使用车辆: {{ usedVehiclesCount }}/{{ vehicles.length }}</span>
        </div>
      </div>

      <div class="route-list">
        <div
          v-for="route in solution.routes.filter(r => r.stops.length > 2)"
          :key="route.vehicleId"
          class="route-item"
          :style="{ borderLeftColor: VEHICLE_COLORS[route.vehicleId % VEHICLE_COLORS.length] }"
          @mouseenter="highlightRoute(route.vehicleId)"
          @mouseleave="unhighlightRoute()"
        >
          <div class="route-header">
            <span class="vehicle-badge" :style="{ background: VEHICLE_COLORS[route.vehicleId % VEHICLE_COLORS.length] }">
              {{ route.vehicleType === 'small' ? '小型车' : route.vehicleType === 'medium' ? '中型车' : '大型车' }}
            </span>
            <span class="route-distance">{{ formatDistance(route.distance) }}</span>
            <span class="route-duration">{{ formatDuration(route.duration) }}</span>
          </div>
          <div class="route-capacity">
            载货量: {{ route.load }}/{{ route.capacity }}
            <div class="capacity-bar">
              <div class="capacity-fill" :style="{ width: Math.min(100, (route.load / route.capacity) * 100) + '%' }"></div>
            </div>
          </div>
          <div class="route-stops">
            <span
              v-for="(stop, idx) in route.stops.slice(1, -1)"
              :key="stop.index"
              class="stop-tag"
            >
              {{ idx + 1 }}. {{ stop.name }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import mapboxgl from 'mapbox-gl';

const VEHICLE_COLORS = [
  '#e74c3c', '#3498db', '#2ecc71', '#f39c12',
  '#9b59b6', '#1abc9c', '#e67e22', '#34495e',
  '#16a085', '#c0392b'
];

const VEHICLE_CONFIG = [
  { type: 'small', count: 4, capacity: 50 },
  { type: 'medium', count: 4, capacity: 100 },
  { type: 'large', count: 2, capacity: 200 },
];

export default {
  props: {
    map: { type: Object, default: null },
  },

  data() {
    return {
      warehouse: { id: 'warehouse', coords: [-122.3892, 37.6213], name: 'UPS物流中心 (SFO)' },
      deliveryPoints: [],
      vehicles: [],
      solution: null,
      loading: false,
      errorMsg: '',
      markers: [],
      routeLayers: [],
      VEHICLE_COLORS,
      isSelectingPoints: false,
      tempPoints: [],
      isSettingComplete: false,
      mapClickHandler: null,
    };
  },

  computed: {
    totalDemand() {
      return this.deliveryPoints.reduce((sum, p) => sum + (p.demand || 0), 0);
    },
    usedVehiclesCount() {
      if (!this.solution) return 0;
      return this.solution.routes.filter(r => r.stops.length > 2).length;
    },
  },

  methods: {
    startSelectingPoints() {
      this.isSelectingPoints = true;
      this.tempPoints = [];
      this.clearMarkers();

      // Add click handler to map
      this.mapClickHandler = (e) => {
        const coords = [e.lngLat.lng, e.lngLat.lat];
        const idx = this.tempPoints.length + 1;
        this.tempPoints.push({
          id: `point-${idx}`,
          coords,
          demand: Math.floor(Math.random() * 10) + 1, // Random demand 1-10
          name: `收货点 ${idx}`
        });

        // Add temporary marker
        const marker = new mapboxgl.Marker({ color: '#e74c3c', scale: 0.8 })
          .setLngLat(coords)
          .addTo(this.map);
        this.markers.push(marker);
      };

      this.map.on('click', this.mapClickHandler);
    },

    finishSettingPoints() {
      if (this.tempPoints.length === 0) return;

      // Remove click handler
      if (this.mapClickHandler) {
        this.map.off('click', this.mapClickHandler);
        this.mapClickHandler = null;
      }

      this.isSelectingPoints = false;
      this.isSettingComplete = true;
      this.deliveryPoints = [...this.tempPoints];

      // Build vehicle list
      this.vehicles = [];
      for (const vt of VEHICLE_CONFIG) {
        for (let i = 0; i < vt.count; i++) {
          this.vehicles.push({
            type: vt.type,
            capacity: vt.capacity,
            id: `${vt.type}-${i + 1}`
          });
        }
      }

      this.errorMsg = '';
      this.saveState();
    },

    cancelSelectingPoints() {
      if (this.mapClickHandler) {
        this.map.off('click', this.mapClickHandler);
        this.mapClickHandler = null;
      }
      this.isSelectingPoints = false;
      this.tempPoints = [];
      this.clearMarkers();
    },

    async calculateVRP() {
      if (this.deliveryPoints.length === 0) {
        this.errorMsg = '请先生成收货点';
        return;
      }

      this.loading = true;
      this.errorMsg = '';
      this.clearRoutes();

      try {
        // Get distance matrix from Mapbox Matrix API for vehicle assignment
        const allPoints = [this.warehouse, ...this.deliveryPoints];
        const coordsStr = allPoints.map(p => p.coords.join(',')).join(';');

        const matrixUrl = `https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${coordsStr}?annotations=duration,distance&access_token=${mapboxgl.accessToken}`;

        const matrixRes = await fetch(matrixUrl);
        const matrixData = await matrixRes.json();

        if (matrixData.code !== 'Ok') {
          throw new Error(matrixData.message || '获取距离矩阵失败');
        }

        // Send to VRP solver with real distance matrix for vehicle assignment
        const res = await fetch('http://localhost:3001/api/vrp/optimize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            locations: this.deliveryPoints,
            vehicles: this.vehicles,
            durations: matrixData.durations,
            distances: matrixData.distances
          })
        });

        const data = await res.json();

        if (!data.success) {
          throw new Error(data.error || 'VRP求解失败');
        }

        this.solution = data.solution;

        // Use Mapbox Optimization API to find optimal stop order for each vehicle
        await this.optimizeVehicleRoutes(this.solution);

        this.displayRoutesOnMap(this.solution);
        this.saveState();

      } catch (err) {
        if (err.message.includes('fetch')) {
          this.errorMsg = '无法连接VRP求解服务，请先启动: node server/vrp-solver.js';
        } else {
          this.errorMsg = err.message || '计算失败，请重试';
        }
        console.error('VRP error:', err);
      } finally {
        this.loading = false;
      }
    },

    async optimizeVehicleRoutes(solution) {
      // Use Mapbox Optimization API to find optimal order for each vehicle's stops
      for (const route of solution.routes) {
        if (route.stops.length <= 2) continue;

        // Build coordinates: warehouse -> assigned stops
        const coords = [this.warehouse.coords, ...route.stops.slice(1, -1).map(s => s.coords)];
        const coordsStr = coords.map(c => c.join(',')).join(';');

        // Call Optimization API to get optimal order
        const optimizeUrl = `https://api.mapbox.com/optimized-trips/v1/mapbox/driving/${coordsStr}?roundtrip=false&geometries=geojson&overview=full&access_token=${mapboxgl.accessToken}`;

        try {
          const res = await fetch(optimizeUrl);
          const data = await res.json();

          if (data.code === 'Ok' && data.trips && data.trips.length > 0) {
            // Update route with optimized data
            route.geometry = data.trips[0].geometry;
            route.distance = data.trips[0].distance / 1000; // km
            route.duration = data.trips[0].duration / 60; // minutes

            // Update stop order based on optimization result
            if (data.waypoints) {
              const newStops = [];
              data.waypoints.forEach((wp) => {
                if (wp.waypoint_index === 0) {
                  // Warehouse
                  newStops.push(route.stops[0]);
                } else {
                  // Original stop at position (waypoint_index - 1) in our original list (excluding warehouse at start and end)
                  const originalStopIdx = wp.waypoint_index;
                  newStops.push(route.stops[originalStopIdx]);
                }
              });
              // Add warehouse at end for return
              newStops.push(route.stops[route.stops.length - 1]);
              route.stops = newStops;
            }
          }
        } catch (err) {
          console.error('Failed to optimize route for vehicle', route.vehicleId, err);
        }
      }
    },

    async fetchRouteGeometries(solution) {
      // For each vehicle's route, get actual driving geometry from Directions API
      for (const route of solution.routes) {
        if (route.stops.length <= 2) continue;

        // Build coordinates: warehouse -> assigned stops -> warehouse
        const coords = route.stops.map(s => s.coords);
        // Add return to warehouse
        coords.push(this.warehouse.coords);

        const coordsStr = coords.map(c => c.join(',')).join(';');
        const directionsUrl = `https://api.mapbox.com/directions/v5/mapbox/driving/${coordsStr}?geometries=geojson&overview=full&access_token=${mapboxgl.accessToken}`;

        try {
          const res = await fetch(directionsUrl);
          const data = await res.json();

          if (data.routes && data.routes.length > 0) {
            route.geometry = data.routes[0].geometry;
            route.distance = data.routes[0].distance / 1000; // Convert to km
            route.duration = data.routes[0].duration / 60; // Convert to minutes
          }
        } catch (err) {
          console.error('Failed to fetch route geometry for vehicle', route.vehicleId, err);
        }
      }
    },

    displayPointsOnMap() {
      if (!this.map) return;

      this.clearMarkers();

      // Add warehouse marker
      const warehouseMarker = new mapboxgl.Marker({ color: '#3498db', scale: 1.2 })
        .setLngLat(this.warehouse.coords)
        .setPopup(new mapboxgl.Popup().setText(this.warehouse.name))
        .addTo(this.map);
      this.markers.push(warehouseMarker);

      // Add delivery point markers
      this.deliveryPoints.forEach((point) => {
        const marker = new mapboxgl.Marker({ color: '#e74c3c', scale: 0.8 })
          .setLngLat(point.coords)
          .setPopup(new mapboxgl.Popup().setText(`${point.name} (需求: ${point.demand})`))
          .addTo(this.map);
        this.markers.push(marker);
      });

      // Fit bounds
      const bounds = new mapboxgl.LngLatBounds();
      bounds.extend(this.warehouse.coords);
      this.deliveryPoints.forEach(p => bounds.extend(p.coords));
      this.map.fitBounds(bounds, { padding: 60 });
    },

    async displayRoutesOnMap(solution) {
      if (!this.map) return;

      this.clearRoutes();

      for (const route of solution.routes) {
        if (route.stops.length <= 2) continue;

        const color = VEHICLE_COLORS[route.vehicleId % VEHICLE_COLORS.length];

        // Use actual route geometry from Directions API if available, otherwise straight lines
        const geometry = route.geometry || {
          type: 'LineString',
          coordinates: route.stops.map(s => s.coords)
        };

        // Add route line
        const layerId = `route-${route.vehicleId}`;
        const sourceId = `route-source-${route.vehicleId}`;

        this.map.addSource(sourceId, {
          type: 'geojson',
          data: {
            type: 'Feature',
            geometry
          }
        });

        // Casing layer
        this.map.addLayer({
          id: `${layerId}-casing`,
          type: 'line',
          source: sourceId,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#000',
            'line-width': 8,
            'line-opacity': 0.3
          }
        });

        // Main route line
        this.map.addLayer({
          id: layerId,
          type: 'line',
          source: sourceId,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': color,
            'line-width': 4,
            'line-opacity': 0.8
          }
        });

        this.routeLayers.push({ layerId, sourceId });
      }

      // Fit bounds to show all routes
      const allCoords = solution.routes
        .flatMap(r => r.stops.map(s => s.coords));
      if (allCoords.length > 0) {
        const bounds = new mapboxgl.LngLatBounds();
        allCoords.forEach(c => bounds.extend(c));
        this.map.fitBounds(bounds, { padding: 60 });
      }
    },

    highlightRoute(vehicleId) {
      this.routeLayers.forEach(({ layerId, sourceId }) => {
        const isHighlighted = layerId === `route-${vehicleId}`;
        this.map.setPaintProperty(layerId, 'line-width', isHighlighted ? 6 : 4);
        this.map.setPaintProperty(layerId, 'line-opacity', isHighlighted ? 1 : 0.6);
      });
    },

    unhighlightRoute() {
      this.routeLayers.forEach(({ layerId }) => {
        this.map.setPaintProperty(layerId, 'line-width', 4);
        this.map.setPaintProperty(layerId, 'line-opacity', 0.8);
      });
    },

    clearMarkers() {
      this.markers.forEach(m => m.remove());
      this.markers = [];
    },

    clearRoutes() {
      this.routeLayers.forEach(({ layerId, sourceId }) => {
        if (this.map.getLayer(layerId)) this.map.removeLayer(layerId);
        if (this.map.getLayer(`${layerId}-casing`)) this.map.removeLayer(`${layerId}-casing`);
        if (this.map.getSource(sourceId)) this.map.removeSource(sourceId);
      });
      this.routeLayers = [];
    },

    resetAll() {
      if (this.mapClickHandler) {
        this.map.off('click', this.mapClickHandler);
        this.mapClickHandler = null;
      }
      this.clearMarkers();
      this.clearRoutes();
      this.deliveryPoints = [];
      this.vehicles = [];
      this.solution = null;
      this.errorMsg = '';
      this.isSelectingPoints = false;
      this.tempPoints = [];
      this.isSettingComplete = false;
      this.clearSavedState();
    },

    formatDistance(km) {
      if (km < 1) return `${Math.round(km * 1000)}m`;
      return `${km.toFixed(1)}km`;
    },

    formatDuration(minutes) {
      if (minutes < 60) return `${Math.round(minutes)}分钟`;
      const h = Math.floor(minutes / 60);
      const m = Math.round(minutes % 60);
      return `${h}小时${m}分钟`;
    },

    saveState() {
      const state = {
        deliveryPoints: this.deliveryPoints,
        vehicles: this.vehicles,
        solution: this.solution,
        warehouse: this.warehouse
      };
      localStorage.setItem('logistics-state', JSON.stringify(state));
    },

    loadState() {
      const saved = localStorage.getItem('logistics-state');
      if (saved) {
        try {
          const state = JSON.parse(saved);
          this.deliveryPoints = state.deliveryPoints || [];
          this.vehicles = state.vehicles || [];
          this.solution = state.solution || null;
          this.warehouse = state.warehouse || this.warehouse;
          this.isSettingComplete = this.deliveryPoints.length > 0;

          if (this.deliveryPoints.length > 0) {
            this.displayPointsOnMap();
            if (this.solution) {
              this.displayRoutesOnMap(this.solution);
            }
          }
          return true;
        } catch (e) {
          console.error('Failed to load state:', e);
        }
      }
      return false;
    },

    clearSavedState() {
      localStorage.removeItem('logistics-state');
    }
  },

  mounted() {
    this.loadState();
  },

  beforeUnmount() {
    // Clean up map listeners but don't clear saved state
    if (this.mapClickHandler) {
      this.map.off('click', this.mapClickHandler);
      this.mapClickHandler = null;
    }
    this.clearMarkers();
    this.clearRoutes();
  }
};
</script>

<style scoped>
.logistics-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.presets {
  display: flex;
  align-items: center;
  gap: 8px;
}

.presets label {
  font-size: 12px;
  font-weight: 600;
  color: #555;
}

.preset-buttons {
  display: flex;
  gap: 6px;
}

.preset-buttons button {
  padding: 6px 16px;
  background: #3b9ddd;
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
}

.preset-buttons button:hover {
  background: #2e86c1;
}

.stats {
  display: flex;
  gap: 16px;
  padding: 10px;
  background: #f5f5f5;
  border-radius: 6px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.stat-label {
  font-size: 11px;
  color: #888;
}

.stat-value {
  font-size: 18px;
  font-weight: 700;
  color: #1a5276;
}

.setting-mode {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  background: #f8f9fa;
  border-radius: 8px;
  border: 1px solid #e9ecef;
}

.setting-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.setting-hint {
  color: #495057;
  font-size: 14px;
}

.point-count {
  background: #3b9ddd;
  color: white;
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 600;
}

.setting-buttons {
  display: flex;
  gap: 10px;
}

.btn-start {
  padding: 10px 20px;
  background: #3b9ddd;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
}

.btn-start:hover {
  background: #2e86c1;
}

.btn-done {
  padding: 10px 20px;
  background: #27ae60;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
}

.btn-done:hover {
  background: #219a52;
}

.btn-cancel {
  padding: 10px 20px;
  background: #95a5a6;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.btn-cancel:hover {
  background: #7f8c8d;
}

.action-buttons {
  display: flex;
  gap: 10px;
}

.btn-calc {
  flex: 1;
  padding: 10px 16px;
  background: #27ae60;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
}

.btn-calc:hover:not(:disabled) {
  background: #219a52;
}

.btn-calc:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-reset {
  padding: 10px 16px;
  background: #e74c3c;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.btn-reset:hover:not(:disabled) {
  background: #c0392b;
}

.btn-reset:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-clear-save {
  padding: 8px 16px;
  background: #95a5a6;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}

.btn-clear-save:hover {
  background: #7f8c8d;
}

.error-msg {
  color: #e74c3c;
  font-size: 13px;
  padding: 8px;
  background: #fdf2f2;
  border-radius: 4px;
}

.results {
  border-top: 1px solid #eee;
  padding-top: 14px;
}

.points-list {
  border-top: 1px solid #eee;
  padding-top: 14px;
}

.points-list h4 {
  margin: 0 0 10px 0;
  font-size: 14px;
  color: #333;
}

.points-table {
  font-size: 12px;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  overflow: hidden;
}

.points-header {
  display: grid;
  grid-template-columns: 40px 1fr 60px;
  gap: 8px;
  padding: 8px 10px;
  background: #f5f5f5;
  font-weight: 600;
  color: #555;
}

.points-row {
  display: grid;
  grid-template-columns: 40px 1fr 60px;
  gap: 8px;
  padding: 6px 10px;
  border-top: 1px solid #eee;
}

.points-row .demand-value {
  color: #27ae60;
  font-weight: 600;
}

.results-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.results-header h3 {
  margin: 0;
  font-size: 14px;
  color: #333;
}

.total-stats {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: #666;
}

.route-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 400px;
  overflow-y: auto;
}

.route-item {
  padding: 10px;
  background: #f9f9f9;
  border-radius: 6px;
  border-left: 4px solid #3498db;
  cursor: pointer;
  transition: background 0.2s;
}

.route-item:hover {
  background: #f0f0f0;
}

.route-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.vehicle-badge {
  padding: 2px 8px;
  border-radius: 10px;
  color: white;
  font-size: 11px;
  font-weight: 600;
}

.route-distance {
  font-weight: 600;
  color: #1a5276;
}

.route-duration {
  color: #888;
  font-size: 12px;
}

.route-capacity {
  font-size: 11px;
  color: #666;
  margin-bottom: 6px;
}

.capacity-bar {
  height: 4px;
  background: #ddd;
  border-radius: 2px;
  margin-top: 4px;
  overflow: hidden;
}

.capacity-fill {
  height: 100%;
  background: #27ae60;
  border-radius: 2px;
  transition: width 0.3s;
}

.route-stops {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.stop-tag {
  padding: 2px 6px;
  background: #e8e8e8;
  border-radius: 3px;
  font-size: 10px;
  color: #555;
}
</style>
