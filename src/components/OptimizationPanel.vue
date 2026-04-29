<template>
  <div class="optimization-panel">
    <div class="presets">
      <label>快速预设</label>
      <div class="preset-buttons">
        <button v-for="(p, i) in presets" :key="i" @click="applyPreset(p)">{{ p.label }}</button>
      </div>
    </div>

    <div class="input-section">
      <div class="input-group">
        <label>起点</label>
        <input v-model="startPoint" type="text" placeholder="例如：SFO机场" />
      </div>
      <div class="input-group">
        <label>途经点（每行一个）</label>
        <textarea
          v-model="waypointsText"
          placeholder="例如：&#10;Alcatraz Island&#10;Twin Peaks&#10;Oracle Park"
          rows="6"
        ></textarea>
      </div>
      <button class="btn-calc" @click="optimize" :disabled="loading">
        {{ loading ? "优化中..." : "计算最优路线" }}
      </button>
    </div>

    <div class="error-msg" v-if="errorMsg">{{ errorMsg }}</div>

    <div class="result-section" v-if="optimizedRoute">
      <div class="route-summary">
        <h4>最优访问顺序</h4>
        <div class="waypoint-list">
          <div
            v-for="(stop, idx) in optimizedRoute.stops"
            :key="idx"
            class="waypoint-item"
          >
            <span class="step-number">{{ idx + 1 }}</span>
            <span class="step-name">{{ stop.name }}</span>
            <span class="step-eta" v-if="stop.duration !== undefined">
              {{ formatDuration(stop.duration) }}
            </span>
          </div>
        </div>
        <div class="total-info">
          <span>总距离: {{ optimizedRoute.totalDistance }}</span>
          <span>总耗时: {{ optimizedRoute.totalDuration }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import mapboxgl from "mapbox-gl";

export default {
  props: {
    map: { type: Object, default: null },
  },

  data() {
    return {
      startPoint: "",
      waypointsText: "",
      loading: false,
      errorMsg: "",
      optimizedRoute: null,
      markers: [],
      routeSourceId: "optimized-route",
      routeLayerIds: ["optimized-route-casing", "optimized-route-line"],
      presets: [
        {
          label: "Landmarks",
          start: "San Francisco International Airport",
          waypoints: "Alcatraz Island, San Francisco\nTwin Peaks, San Francisco\nOracle Park, San Francisco",
        },
        {
          label: "Transit",
          start: "San Francisco International Airport",
          waypoints: "Embarcadero Station, San Francisco\nPowell Street Station, San Francisco\nMoscone Center, San Francisco",
        },
        {
          label: "Neighborhoods",
          start: "Mission District, San Francisco",
          waypoints: "Castro District, San Francisco\nHaight-Ashbury, San Francisco\nMarina District, San Francisco\nNob Hill, San Francisco",
        },
        {
          label: "Tech",
          start: "Salesforce Tower, San Francisco",
          waypoints: "Twitter HQ, San Francisco\nUber HQ, San Francisco\nLinkedIn HQ, San Francisco\nAirbnb HQ, San Francisco\nStripe HQ, San Francisco",
        },
      ],
    };
  },

  methods: {
    async geocode(query) {
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?limit=1&access_token=${mapboxgl.accessToken}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!data.features || data.features.length === 0) {
        throw new Error(`无法找到: ${query}`);
      }
      return {
        name: data.features[0].place_name.split(",")[0],
        coords: data.features[0].center,
      };
    },

    async optimize() {
      const start = this.startPoint.trim();
      const waypoints = this.waypointsText.trim().split("\n").filter(Boolean);

      if (!start) {
        this.errorMsg = "请输入起点";
        return;
      }
      if (waypoints.length === 0) {
        this.errorMsg = "请输入至少一个途经点";
        return;
      }

      this.loading = true;
      this.errorMsg = "";
      this.optimizedRoute = null;
      this.clearMapElements();

      try {
        // Geocode all locations
        const [startGeo, ...waypointGeos] = await Promise.all([
          this.geocode(start),
          ...waypoints.map((w) => this.geocode(w)),
        ]);

        // Add markers for all points
        this.addMarker(startGeo.coords, startGeo.name, "#e74c3c", "起点");

        waypointGeos.forEach((g, i) => {
          this.addMarker(g.coords, g.name, "#3498db", `途经${i + 1}`);
        });

        // Fit bounds
        const bounds = new mapboxgl.LngLatBounds();
        bounds.extend(startGeo.coords);
        waypointGeos.forEach((g) => bounds.extend(g.coords));
        this.map.fitBounds(bounds, { padding: 80 });

        // Call Optimization API v2
        const result = await this.callOptimizationAPI(startGeo, waypointGeos);

        // Store result for display
        this.optimizedRoute = result;

        // Draw the optimized route on map
        await this.drawOptimizedRoute(result.stops.map((s) => s.coords));

      } catch (err) {
        this.errorMsg = err.message || "优化失败，请重试";
      } finally {
        this.loading = false;
      }
    },

    async callOptimizationAPI(start, waypoints) {
      // Build the optimization request for Mapbox Optimization API v2
      const locations = [
        { name: "start", coordinates: start.coords },
        ...waypoints.map((w) => ({ name: w.name, coordinates: w.coords })),
      ];

      // Create location name mapping
      const locationNames = locations.map((l) => l.name);

      // For a simple round trip from start through waypoints back to start (or not)
      // We'll do: start -> waypoints (optimized order) -> end back at start
      // Use round trip configuration

      const requestBody = {
        locations: locations,
        vehicles: [
          {
            id: "vehicle-1",
            start_location: "start",
            end_location: "start", // round trip back to start
          },
        ],
        shipments: waypoints.map((w, idx) => ({
          id: `stop-${idx}`,
          from: w.name,
          to: w.name, // pickup and delivery at same location for waypoint
        })),
      };

      // First, try the Optimization API v2
      const response = await fetch(
        `https://api.mapbox.com/optimized-trips/v2?access_token=${mapboxgl.accessToken}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Optimization API failed: ${errorText}`);
      }

      const jobResult = await response.json();

      if (jobResult.id) {
        // Poll for results
        const result = await this.pollForResults(jobResult.id);
        return this.parseOptimizationResult(result, locationNames, locations);
      }

      throw new Error("No job ID returned from optimization API");
    },

    async pollForResults(jobId, maxAttempts = 30) {
      for (let i = 0; i < maxAttempts; i++) {
        const res = await fetch(
          `https://api.mapbox.com/optimized-trips/v2/${jobId}?access_token=${mapboxgl.accessToken}`
        );
        const data = await res.json();

        if (data.status === "success" || data.status === "completed") {
          return data;
        }

        if (data.status === "failed") {
          throw new Error("Optimization job failed");
        }

        // Wait before next poll
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      throw new Error("Optimization timed out");
    },

    parseOptimizationResult(data, locationNames, locations) {
      if (!data.routes || data.routes.length === 0) {
        throw new Error("No route found in optimization result");
      }

      const route = data.routes[0];
      const stops = [];

      // Parse stops from route
      if (route.stops) {
        route.stops.forEach((stop, idx) => {
          const locIndex = locationNames.indexOf(stop.location);
          if (locIndex !== -1) {
            stops.push({
              name: locations[locIndex].name,
              coords: locations[locIndex].coordinates,
              duration: stop.duration,
              eta: stop.eta,
            });
          }
        });
      }

      // Calculate total distance and duration
      const totalDistance = route.distance ? this.formatDistance(route.distance) : "N/A";
      const totalDuration = route.duration ? this.formatDuration(route.duration) : "N/A";

      return {
        stops,
        totalDistance,
        totalDuration,
      };
    },

    addMarker(coords, name, color, label) {
      const marker = new mapboxgl.Marker({ color })
        .setLngLat(coords)
        .setPopup(new mapboxgl.Popup().setText(`${label}: ${name}`))
        .addTo(this.map);
      this.markers.push(marker);
    },

    async drawOptimizedRoute(coordinates) {
      if (coordinates.length < 2) return;

      // Ensure source exists
      if (!this.map.getSource(this.routeSourceId)) {
        this.map.addSource(this.routeSourceId, {
          type: "geojson",
          data: { type: "Feature", geometry: { type: "LineString", coordinates: [] } },
        });

        // Add casing layer (wider, darker outline)
        this.map.addLayer({
          id: this.routeLayerIds[0],
          type: "line",
          source: this.routeSourceId,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": "#1a5276",
            "line-width": 10,
            "line-opacity": 0.3,
          },
        });

        // Add main route line
        this.map.addLayer({
          id: this.routeLayerIds[1],
          type: "line",
          source: this.routeSourceId,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": "#e74c3c",
            "line-width": 6,
            "line-opacity": 0.8,
          },
        });
      }

      // Update route geometry
      this.map.getSource(this.routeSourceId).setData({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: coordinates,
        },
      });
    },

    clearMapElements() {
      // Clear markers
      this.markers.forEach((m) => m.remove());
      this.markers = [];

      // Clear route
      if (this.map.getSource(this.routeSourceId)) {
        this.map.getSource(this.routeSourceId).setData({
          type: "Feature",
          geometry: { type: "LineString", coordinates: [] },
        });
      }
    },

    formatDuration(seconds) {
      if (!seconds) return "N/A";
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      if (h > 0) return `${h}h ${m}m`;
      return `${m}m`;
    },

    formatDistance(meters) {
      if (!meters) return "N/A";
      if (meters < 1000) return `${Math.round(meters)}m`;
      return `${(meters / 1000).toFixed(1)}km`;
    },

    applyPreset(preset) {
      this.startPoint = preset.start;
      this.waypointsText = preset.waypoints;
      this.errorMsg = "";
      this.optimizedRoute = null;
    },

    reset() {
      this.startPoint = "";
      this.waypointsText = "";
      this.errorMsg = "";
      this.optimizedRoute = null;
      this.clearMapElements();
    },
  },

  beforeUnmount() {
    this.clearMapElements();
  },
};
</script>

<style scoped>
.optimization-panel {
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
  white-space: nowrap;
}

.preset-buttons {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.preset-buttons button {
  padding: 4px 12px;
  background: #f0f0f0;
  border: 1px solid #ddd;
  border-radius: 12px;
  font-size: 12px;
  color: #555;
  cursor: pointer;
  white-space: nowrap;
}

.preset-buttons button:hover {
  background: #e74c3c;
  color: white;
  border-color: #e74c3c;
}

.input-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.input-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.input-group label {
  font-size: 12px;
  font-weight: 600;
  color: #555;
}

.input-group input,
.input-group textarea {
  width: 100%;
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 13px;
  font-family: inherit;
}

.input-group input:focus,
.input-group textarea:focus {
  outline: none;
  border-color: #e74c3c;
}

.input-group textarea {
  resize: vertical;
}

.btn-calc {
  padding: 10px 16px;
  background: #e74c3c;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
}

.btn-calc:hover:not(:disabled) {
  background: #c0392b;
}

.btn-calc:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.error-msg {
  color: #e74c3c;
  font-size: 13px;
}

.result-section {
  border-top: 1px solid #eee;
  padding-top: 12px;
}

.route-summary h4 {
  margin: 0 0 10px 0;
  font-size: 14px;
  color: #333;
}

.waypoint-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.waypoint-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  background: #f8f8f8;
  border-radius: 4px;
}

.step-number {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  background: #e74c3c;
  color: white;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 700;
}

.step-name {
  flex: 1;
  font-size: 13px;
  color: #333;
}

.step-eta {
  font-size: 12px;
  color: #888;
}

.total-info {
  display: flex;
  gap: 20px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px dashed #ddd;
  font-size: 13px;
  font-weight: 600;
}

.total-info span {
  color: #e74c3c;
}
</style>