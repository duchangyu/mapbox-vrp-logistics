<template>
  <div class="optimization-panel">
    <div class="presets">
      <label>{{ $t('optimization.presetsLabel') }}</label>
      <div class="preset-buttons">
        <button v-for="(p, i) in presets" :key="i" @click="applyPreset(p)">{{ $t(p.labelKey) }}</button>
      </div>
    </div>

    <div class="input-section">
      <div class="input-group">
        <label>{{ $t('optimization.startLabel') }}</label>
        <input v-model="startPoint" type="text" :placeholder="$t('optimization.startPlaceholder')" />
      </div>
      <div class="input-group">
        <label>{{ $t('optimization.waypointsLabel') }}</label>
        <textarea
          v-model="waypointsText"
          :placeholder="$t('optimization.waypointsPlaceholder')"
          rows="6"
        ></textarea>
      </div>
      <button class="btn-calc" @click="optimize" :disabled="loading">
        {{ loading ? $t('optimization.optimizing') : $t('optimization.calculate') }}
      </button>
    </div>

    <div class="error-msg" v-if="errorMsg">{{ errorMsg }}</div>

    <div class="result-section" v-if="optimizedRoute">
      <div class="route-summary">
        <h4>{{ $t('optimization.optimalOrder') }}</h4>
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
          <span>{{ $t('optimization.totalDistance') }}: {{ optimizedRoute.totalDistance }}</span>
          <span>{{ $t('optimization.totalDuration') }}: {{ optimizedRoute.totalDuration }}</span>
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
          labelKey: "optimization.presets.landmarks",
          start: "San Francisco International Airport",
          waypoints: "Alcatraz Island, San Francisco\nTwin Peaks, San Francisco\nOracle Park, San Francisco",
        },
        {
          labelKey: "optimization.presets.transit",
          start: "San Francisco International Airport",
          waypoints: "Embarcadero Station, San Francisco\nPowell Street Station, San Francisco\nMoscone Center, San Francisco",
        },
        {
          labelKey: "optimization.presets.neighborhoods",
          start: "Mission District, San Francisco",
          waypoints: "Castro District, San Francisco\nHaight-Ashbury, San Francisco\nMarina District, San Francisco\nNob Hill, San Francisco",
        },
        {
          labelKey: "optimization.presets.tech",
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
        throw new Error(this.$t('optimization.geocodeNotFound', { query }));
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
        this.errorMsg = this.$t('optimization.missingStart');
        return;
      }
      if (waypoints.length === 0) {
        this.errorMsg = this.$t('optimization.missingWaypoints');
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
        this.addMarker(startGeo.coords, startGeo.name, "#e74c3c", this.$t('optimization.markerStart'));

        waypointGeos.forEach((g, i) => {
          this.addMarker(g.coords, g.name, "#3498db", this.$t('optimization.markerWaypoint', { n: i + 1 }));
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

        // Draw the optimized route on map using geometry from API
        if (result.geometry) {
          // First ensure the source/layers exist, then set the geometry
          await this.drawOptimizedRoute(result.stops.map((s) => s.coords));
          // Now update with the actual geometry from API
          this.map.getSource(this.routeSourceId).setData({
            type: "Feature",
            geometry: result.geometry,
          });
        } else {
          // Fallback: draw straight lines between stops
          await this.drawOptimizedRoute(result.stops.map((s) => s.coords));
        }

      } catch (err) {
        this.errorMsg = err.message || this.$t('optimization.optimizationFailed');
      } finally {
        this.loading = false;
      }
    },

    async callOptimizationAPI(start, waypoints) {
      // Build coordinates string for Optimization API v1
      // Format: lon,lat;lon,lat;... (semicolon-separated)
      const allCoords = [
        start.coords,
        ...waypoints.map((w) => w.coords),
      ];
      const coordsStr = allCoords.map((c) => c.join(",")).join(";");

      // Use v1 API: GET https://api.mapbox.com/optimized-trips/v1/{profile}/{coordinates}
      // profile: mapbox/driving, with roundtrip=true to return to start
      const url = `https://api.mapbox.com/optimized-trips/v1/mapbox/driving/${coordsStr}?roundtrip=true&geometries=geojson&overview=full&access_token=${mapboxgl.accessToken}`;

      const response = await fetch(url);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(this.$t('optimization.apiFailed', { error: errorText }));
      }

      const data = await response.json();

      if (data.code !== "Ok") {
        throw new Error(data.message || this.$t('optimization.optimizationFailed'));
      }

      return this.parseOptimizationResult(data, start, waypoints);
    },

    parseOptimizationResult(data, start, waypoints) {
      if (!data.trips || data.trips.length === 0) {
        throw new Error(this.$t('optimization.noRouteFound'));
      }

      const trip = data.trips[0];
      const stops = [];

      // Build a map of waypoint_index to waypoint name/coords
      // The waypoint_index in v1 API refers to position in the coordinates string
      // Coordinates string is: start, waypoint1, waypoint2, ...
      // So waypoint_index 0 = start, waypoint_index 1+ = waypoints
      const waypointIndexMap = new Map();
      waypointIndexMap.set(0, { name: start.name, coords: start.coords });
      waypoints.forEach((wp, idx) => {
        waypointIndexMap.set(idx + 1, { name: wp.name, coords: wp.coords });
      });

      // waypoints array contains the optimized order
      // Each waypoint has waypoint_index indicating its original position
      if (data.waypoints) {
        data.waypoints.forEach((wp) => {
          const info = waypointIndexMap.get(wp.waypoint_index);
          if (info) {
            stops.push({
              name: info.name,
              coords: info.coords,
              duration: undefined,
            });
          }
        });
      }

      // Calculate total distance and duration
      const totalDistance = trip.distance ? this.formatDistance(trip.distance) : "N/A";
      const totalDuration = trip.duration ? this.formatDuration(trip.duration) : "N/A";

      return {
        stops,
        totalDistance,
        totalDuration,
        geometry: trip.geometry, // GeoJSON geometry for drawing route
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
