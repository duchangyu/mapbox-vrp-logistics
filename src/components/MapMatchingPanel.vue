<template>
  <div class="mapmatching-panel">
    <div class="presets">
      <label>快速预设</label>
      <div class="preset-buttons">
        <button v-for="(p, i) in presets" :key="i" @click="applyPreset(p)">{{ p.label }}</button>
      </div>
    </div>

    <div class="input-section">
      <div class="input-group">
        <label>原始坐标（每行: 经度,纬度）</label>
        <textarea
          v-model="coordinatesText"
          placeholder="例如：&#10;-122.4194,37.7749&#10;-122.4089,37.7849&#10;-122.3989,37.7949"
          rows="8"
        ></textarea>
      </div>
      <div class="options-row">
        <label>
          <input type="checkbox" v-model="options.tidy" /> 清理杂点 (tidy)
        </label>
        <label>
          <input type="checkbox" v-model="options.annotations" /> 显示耗时信息
        </label>
      </div>
      <button class="btn-calc" @click="runMapMatching" :disabled="loading">
        {{ loading ? "匹配中..." : "开始地图匹配" }}
      </button>
    </div>

    <div class="error-msg" v-if="errorMsg">{{ errorMsg }}</div>

    <div class="result-section" v-if="matchResult">
      <div class="match-summary">
        <h4>匹配结果</h4>
        <div class="summary-stats">
          <div class="stat-item">
            <span class="stat-label">置信度</span>
            <span class="stat-value">{{ (matchResult.confidence * 100).toFixed(1) }}%</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">匹配距离</span>
            <span class="stat-value">{{ formatDistance(matchResult.distance) }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">总耗时</span>
            <span class="stat-value">{{ formatDuration(matchResult.duration) }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">原始点数</span>
            <span class="stat-value">{{ matchResult.originalPoints }}</span>
          </div>
        </div>
      </div>

      <div class="legs-info" v-if="matchResult.legs">
        <h5>分段信息</h5>
        <div v-for="(leg, idx) in matchResult.legs" :key="idx" class="leg-item">
          <span class="leg-num">段 {{ idx + 1 }}</span>
          <span class="leg-dist">{{ formatDistance(leg.distance) }}</span>
          <span class="leg-dur">{{ formatDuration(leg.duration) }}</span>
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
      coordinatesText: "",
      loading: false,
      errorMsg: "",
      matchResult: null,
      markers: [],
      traceSourceId: "map-matching-trace",
      matchSourceId: "map-matching-match",
      routeLayerIds: ["map-matching-casing", "map-matching-line"],
      traceLayerId: "map-matching-trace-points",
      options: {
        tidy: true,
        annotations: true,
      },
      presets: [
        {
          label: "旧金山行程",
          coordinates: `-122.4194,37.7749
-122.4089,37.7849
-122.3989,37.7949
-122.3889,37.8049
-122.3789,37.8149`,
        },
        {
          label: "GPS轨迹示例",
          coordinates: `-117.17282,32.71204
-117.17288,32.71225
-117.17305,32.71258
-117.17342,32.71321
-117.17391,32.71387`,
        },
      ],
    };
  },

  methods: {
    async runMapMatching() {
      const coords = this.parseCoordinates();

      if (coords.length < 2) {
        this.errorMsg = "请输入至少2个坐标点";
        return;
      }
      if (coords.length > 100) {
        this.errorMsg = "最多支持100个坐标点";
        return;
      }

      this.loading = true;
      this.errorMsg = "";
      this.matchResult = null;
      this.clearMapElements();

      try {
        // Add trace markers to show original input points
        coords.forEach((c, i) => {
          const marker = new mapboxgl.Marker({ color: "#999", radius: 6 })
            .setLngLat(c)
            .setPopup(new mapboxgl.Popup().setText(`原始点 ${i + 1}`))
            .addTo(this.map);
          this.markers.push(marker);
        });

        // Fit bounds to show all original points
        const bounds = new mapboxgl.LngLatBounds();
        coords.forEach((c) => bounds.extend(c));
        this.map.fitBounds(bounds, { padding: 80 });

        // Call Map Matching API v5
        const coordsStr = coords.map((c) => c.join(",")).join(";");
        let url = `https://api.mapbox.com/matching/v5/mapbox/driving/${coordsStr}?geometries=geojson&overview=full&access_token=${mapboxgl.accessToken}`;

        if (this.options.tidy) url += "&tidy=true";
        if (this.options.annotations) url += "&annotations=distance,duration";

        const response = await fetch(url);

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Map Matching API failed: ${errorText}`);
        }

        const data = await response.json();

        if (data.code !== "Ok") {
          throw new Error(data.message || "Map matching failed");
        }

        if (!data.matchings || data.matchings.length === 0) {
          throw new Error("No matching route found");
        }

        // Store result for display
        this.matchResult = {
          confidence: data.matchings[0].confidence,
          distance: data.matchings[0].distance,
          duration: data.matchings[0].duration,
          geometry: data.matchings[0].geometry,
          legs: data.matchings[0].legs,
          originalPoints: coords.length,
        };

        // Draw matched route
        await this.drawMatchedRoute(this.matchResult.geometry, coords);

      } catch (err) {
        this.errorMsg = err.message || "匹配失败，请重试";
      } finally {
        this.loading = false;
      }
    },

    parseCoordinates() {
      const lines = this.coordinatesText.trim().split("\n");
      const coords = [];

      for (const line of lines) {
        const parts = line.split(",").map((p) => parseFloat(p.trim()));
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
          coords.push(parts);
        }
      }

      return coords;
    },

    async drawMatchedRoute(geometry, originalCoords) {
      // Ensure sources and layers exist
      if (!this.map.getSource(this.matchSourceId)) {
        // Source for matched route
        this.map.addSource(this.matchSourceId, {
          type: "geojson",
          data: { type: "Feature", geometry: { type: "LineString", coordinates: [] } },
        });

        // Casing layer
        this.map.addLayer({
          id: this.routeLayerIds[0],
          type: "line",
          source: this.matchSourceId,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": "#27ae60",
            "line-width": 10,
            "line-opacity": 0.3,
          },
        });

        // Main route line
        this.map.addLayer({
          id: this.routeLayerIds[1],
          type: "line",
          source: this.matchSourceId,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": "#27ae60",
            "line-width": 6,
            "line-opacity": 0.8,
          },
        });

        // Source for original trace points (for comparison)
        this.map.addSource(this.traceSourceId, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });

        // Original points as circles
        this.map.addLayer({
          id: this.traceLayerId,
          type: "circle",
          source: this.traceSourceId,
          paint: {
            "circle-radius": 5,
            "circle-color": "#e74c3c",
            "circle-opacity": 0.7,
            "circle-stroke-width": 2,
            "circle-stroke-color": "#fff",
          },
        });
      }

      // Update matched route
      this.map.getSource(this.matchSourceId).setData({
        type: "Feature",
        geometry: geometry,
      });

      // Update original trace points
      const traceFeatures = originalCoords.map((c) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: c },
      }));

      this.map.getSource(this.traceSourceId).setData({
        type: "FeatureCollection",
        features: traceFeatures,
      });

      // Fit bounds to the matched route
      if (geometry && geometry.coordinates) {
        const routeBounds = new mapboxgl.LngLatBounds();
        geometry.coordinates.forEach((c) => routeBounds.extend(c));
        this.map.fitBounds(routeBounds, { padding: 80 });
      }
    },

    clearMapElements() {
      // Clear markers
      this.markers.forEach((m) => m.remove());
      this.markers = [];

      // Clear route
      if (this.map.getSource(this.matchSourceId)) {
        this.map.getSource(this.matchSourceId).setData({
          type: "Feature",
          geometry: { type: "LineString", coordinates: [] },
        });
      }

      // Clear trace points
      if (this.map.getSource(this.traceSourceId)) {
        this.map.getSource(this.traceSourceId).setData({
          type: "FeatureCollection",
          features: [],
        });
      }
    },

    formatDuration(seconds) {
      if (!seconds) return "N/A";
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = Math.floor(seconds % 60);
      if (h > 0) return `${h}h ${m}m`;
      if (m > 0) return `${m}m ${s}s`;
      return `${s}s`;
    },

    formatDistance(meters) {
      if (!meters) return "N/A";
      if (meters < 1000) return `${Math.round(meters)}m`;
      return `${(meters / 1000).toFixed(1)}km`;
    },

    applyPreset(preset) {
      this.coordinatesText = preset.coordinates;
      this.errorMsg = "";
      this.matchResult = null;
    },

    reset() {
      this.coordinatesText = "";
      this.errorMsg = "";
      this.matchResult = null;
      this.clearMapElements();
    },
  },

  beforeUnmount() {
    this.clearMapElements();
  },
};
</script>

<style scoped>
.mapmatching-panel {
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
  background: #27ae60;
  color: white;
  border-color: #27ae60;
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

.input-group textarea {
  width: 100%;
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 13px;
  font-family: inherit;
}

.input-group textarea:focus {
  outline: none;
  border-color: #27ae60;
}

.options-row {
  display: flex;
  gap: 16px;
}

.options-row label {
  font-size: 13px;
  color: #555;
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}

.options-row input[type="checkbox"] {
  cursor: pointer;
}

.btn-calc {
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

.error-msg {
  color: #e74c3c;
  font-size: 13px;
}

.result-section {
  border-top: 1px solid #eee;
  padding-top: 12px;
}

.match-summary h4 {
  margin: 0 0 10px 0;
  font-size: 14px;
  color: #333;
}

.summary-stats {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.stat-item {
  display: flex;
  justify-content: space-between;
  padding: 6px 8px;
  background: #f8f8f8;
  border-radius: 4px;
}

.stat-label {
  font-size: 12px;
  color: #888;
}

.stat-value {
  font-size: 13px;
  font-weight: 600;
  color: #27ae60;
}

.legs-info {
  margin-top: 12px;
}

.legs-info h5 {
  margin: 0 0 8px 0;
  font-size: 13px;
  color: #555;
}

.leg-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 8px;
  background: #f5f5f5;
  border-radius: 4px;
  font-size: 12px;
  margin-bottom: 4px;
}

.leg-num {
  font-weight: 600;
  color: #333;
}

.leg-dist,
.leg-dur {
  color: #888;
}
</style>