<template>
  <div class="map-wrapper">
    <div ref="mapContainer" class="map-container"></div>

    <!-- Tab switcher -->
    <div class="tab-bar">
      <button :class="{ active: mode === 'route' }" @click="switchMode('route')">3点路线</button>
      <button :class="{ active: mode === 'matrix' }" @click="switchMode('matrix')">时间矩阵</button>
      <button :class="{ active: mode === 'optimize' }" @click="switchMode('optimize')">路线优化</button>
    </div>

    <!-- Route mode panel -->
    <div class="control-panel" v-if="mode === 'route'">
      <div class="status" v-if="waypoints.length < 3">
        点击地图选择第 {{ waypoints.length + 1 }}/3 个点
      </div>
      <div class="status route-info" v-else>
        <span>距离: {{ routeDistance }}</span>
        <span>预计时间: {{ routeDuration }}</span>
      </div>
      <button class="btn-reset" v-if="waypoints.length > 0" @click="resetWaypoints">
        重新选择
      </button>
    </div>

    <!-- Matrix mode panel -->
    <div class="side-panel" v-if="mode === 'matrix'">
      <MatrixPanel :map="map" ref="matrixPanel" />
    </div>

    <!-- Optimization mode panel -->
    <div class="side-panel" v-if="mode === 'optimize'">
      <OptimizationPanel :map="map" ref="optimizationPanel" />
    </div>
  </div>
</template>

<script>
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import MatrixPanel from "./components/MatrixPanel.vue";
import OptimizationPanel from "./components/OptimizationPanel.vue";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

const MARKER_COLORS = ["#e74c3c", "#2ecc71", "#3498db"];

export default {
  components: { MatrixPanel, OptimizationPanel },

  data() {
    return {
      mode: "route",
      map: null,
      waypoints: [],
      markers: [],
      routeDistance: "",
      routeDuration: "",
    };
  },

  mounted() {
    const map = new mapboxgl.Map({
      container: this.$refs.mapContainer,
      style: "mapbox://styles/mapbox/standard",
      center: [-122.4194, 37.7749],
      zoom: 13,
    });

    map.on("load", () => {
      map.addSource("route", {
        type: "geojson",
        data: { type: "Feature", geometry: { type: "LineString", coordinates: [] } },
      });

      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#3b9ddd",
          "line-width": 6,
          "line-opacity": 0.8,
        },
      });

      map.addLayer({
        id: "route-casing",
        type: "line",
        source: "route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#1a5276",
          "line-width": 10,
          "line-opacity": 0.3,
        },
      }, "route-line");
    });

    map.on("click", (e) => {
      if (this.mode !== "route") return;
      if (this.waypoints.length >= 3) return;

      const coords = [e.lngLat.lng, e.lngLat.lat];
      this.waypoints.push(coords);

      const marker = new mapboxgl.Marker({ color: MARKER_COLORS[this.waypoints.length - 1] })
        .setLngLat(coords)
        .setPopup(new mapboxgl.Popup().setText(`点 ${this.waypoints.length}`))
        .addTo(map);
      this.markers.push(marker);

      if (this.waypoints.length === 3) {
        this.fetchRoute();
      }
    });

    this.map = map;
  },

  methods: {
    switchMode(mode) {
      this.mode = mode;
    },

    async fetchRoute() {
      const coords = this.waypoints.map((c) => c.join(",")).join(";");
      const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?geometries=geojson&overview=full&access_token=${mapboxgl.accessToken}`;

      try {
        const res = await fetch(url);
        const data = await res.json();

        if (!data.routes || data.routes.length === 0) {
          alert("未找到可行路线，请选择其他点");
          this.resetWaypoints();
          return;
        }

        const route = data.routes[0];
        this.routeDistance = (route.distance / 1000).toFixed(1) + " km";
        this.routeDuration = this.formatDuration(route.duration);

        this.map.getSource("route").setData({
          type: "Feature",
          geometry: route.geometry,
        });

        const bounds = new mapboxgl.LngLatBounds();
        route.geometry.coordinates.forEach((c) => bounds.extend(c));
        this.map.fitBounds(bounds, { padding: 60 });
      } catch (err) {
        console.error("路线请求失败:", err);
        alert("获取路线失败，请重试");
      }
    },

    formatDuration(seconds) {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      if (h > 0) return `${h} 小时 ${m} 分钟`;
      return `${m} 分钟`;
    },

    resetWaypoints() {
      this.markers.forEach((m) => m.remove());
      this.markers = [];
      this.waypoints = [];
      this.routeDistance = "";
      this.routeDuration = "";

      if (this.map.getSource("route")) {
        this.map.getSource("route").setData({
          type: "Feature",
          geometry: { type: "LineString", coordinates: [] },
        });
      }
    },
  },

  unmounted() {
    this.map.remove();
    this.map = null;
  },
};
</script>

<style>
.map-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
}

.map-container {
  width: 100%;
  height: 100%;
}

/* Tab bar */
.tab-bar {
  position: absolute;
  top: 16px;
  left: 16px;
  display: flex;
  gap: 4px;
  z-index: 10;
}

.tab-bar button {
  padding: 8px 18px;
  border: none;
  border-radius: 6px 6px 0 0;
  background: rgba(255, 255, 255, 0.7);
  color: #666;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.tab-bar button.active {
  background: rgba(255, 255, 255, 0.95);
  color: #1a5276;
  box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.1);
}

.tab-bar button:hover:not(.active) {
  background: rgba(255, 255, 255, 0.85);
}

/* Route control panel */
.control-panel {
  position: absolute;
  top: 50px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 12px;
  background: rgba(255, 255, 255, 0.95);
  padding: 10px 20px;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.15);
  z-index: 10;
  font-size: 14px;
}

.status {
  color: #333;
  font-weight: 500;
}

.route-info {
  display: flex;
  gap: 20px;
}

.route-info span {
  color: #1a5276;
  font-weight: 600;
}

.btn-reset {
  padding: 6px 16px;
  background: #e74c3c;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
}

.btn-reset:hover {
  background: #c0392b;
}

/* Matrix side panel */
.side-panel {
  position: absolute;
  top: 50px;
  left: 16px;
  width: 460px;
  max-height: calc(100% - 80px);
  overflow-y: auto;
  background: rgba(255, 255, 255, 0.95);
  padding: 16px;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.15);
  z-index: 10;
}
</style>
