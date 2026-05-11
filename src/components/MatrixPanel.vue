<template>
  <div class="matrix-panel">
    <div class="presets">
      <label>{{ $t('matrix.presetsLabel') }}</label>
      <div class="preset-buttons">
        <button v-for="(p, i) in presets" :key="i" @click="applyPreset(p)">{{ $t(p.labelKey) }}</button>
      </div>
    </div>
    <div class="input-section">
      <div class="input-group">
        <label>{{ $t('matrix.originsLabel') }}</label>
        <textarea
          v-model="originsText"
          :placeholder="$t('matrix.originsPlaceholder')"
          rows="3"
        ></textarea>
      </div>
      <div class="input-group">
        <label>{{ $t('matrix.destinationsLabel') }}</label>
        <textarea
          v-model="destinationsText"
          :placeholder="$t('matrix.destinationsPlaceholder')"
          rows="3"
        ></textarea>
      </div>
      <button class="btn-calc" @click="calculate" :disabled="loading">
        {{ loading ? $t('matrix.calculating') : $t('matrix.calculate') }}
      </button>
    </div>

    <div class="error-msg" v-if="errorMsg">{{ errorMsg }}</div>

    <div class="matrix-result" v-if="matrixData">
      <table>
        <thead>
          <tr>
            <th></th>
            <th v-for="dest in matrixData.destinations" :key="dest">{{ dest }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in matrixData.durationRows" :key="i">
            <td class="row-header">{{ matrixData.origins[i] }}</td>
            <td v-for="(cell, j) in row" :key="j" :class="{ 'no-route': cell === null }">
              <template v-if="cell !== null">
                <span class="time">{{ formatDuration(cell) }}</span>
                <span class="dist">{{ formatDistance(matrixData.distanceRows[i][j]) }}</span>
              </template>
              <template v-else>{{ $t('matrix.unreachable') }}</template>
            </td>
          </tr>
        </tbody>
      </table>
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
      originsText: "",
      destinationsText: "",
      loading: false,
      errorMsg: "",
      matrixData: null,
      markers: [],
      presets: [
        {
          labelKey: "matrix.presets.landmarks",
          origins: "Fisherman's Wharf, San Francisco\nGolden Gate Bridge, San Francisco\nChinatown, San Francisco",
          destinations: "Alcatraz Island, San Francisco\nTwin Peaks, San Francisco\nOracle Park, San Francisco",
        },
        {
          labelKey: "matrix.presets.transit",
          origins: "San Francisco International Airport\nEmbarcadero Station, San Francisco\nCaltrain San Francisco Station",
          destinations: "Ferry Building, San Francisco\nPowell Street Station, San Francisco\nMoscone Center, San Francisco",
        },
        {
          labelKey: "matrix.presets.neighborhoods",
          origins: "Mission District, San Francisco\nCastro District, San Francisco\nHaight-Ashbury, San Francisco",
          destinations: "Marina District, San Francisco\nNob Hill, San Francisco\nSunset District, San Francisco",
        },
        {
          labelKey: "matrix.presets.tech",
          origins: "Salesforce Tower, San Francisco\nTwitter HQ, San Francisco\nUber HQ, San Francisco",
          destinations: "LinkedIn HQ, San Francisco\nAirbnb HQ, San Francisco\nStripe HQ, San Francisco",
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
        throw new Error(this.$t('matrix.geocodeNotFound', { query }));
      }
      return {
        name: data.features[0].place_name.split(",")[0],
        coords: data.features[0].center,
      };
    },

    async calculate() {
      const origins = this.originsText.trim().split("\n").filter(Boolean);
      const destinations = this.destinationsText.trim().split("\n").filter(Boolean);

      if (origins.length === 0 || destinations.length === 0) {
        this.errorMsg = this.$t('matrix.missingInputs');
        return;
      }

      this.loading = true;
      this.errorMsg = "";
      this.matrixData = null;
      this.clearMarkers();

      try {
        const [geoOrigins, geoDests] = await Promise.all([
          Promise.all(origins.map((o) => this.geocode(o))),
          Promise.all(destinations.map((d) => this.geocode(d))),
        ]);

        // Add markers on map
        geoOrigins.forEach((g, i) => {
          const marker = new mapboxgl.Marker({ color: "#e74c3c" })
            .setLngLat(g.coords)
            .setPopup(new mapboxgl.Popup().setText(this.$t('matrix.originPopup', { name: g.name })))
            .addTo(this.map);
          this.markers.push(marker);
        });

        geoDests.forEach((g) => {
          const marker = new mapboxgl.Marker({ color: "#2ecc71" })
            .setLngLat(g.coords)
            .setPopup(new mapboxgl.Popup().setText(this.$t('matrix.destinationPopup', { name: g.name })))
            .addTo(this.map);
          this.markers.push(marker);
        });

        // Fit map bounds
        const bounds = new mapboxgl.LngLatBounds();
        [...geoOrigins, ...geoDests].forEach((g) => bounds.extend(g.coords));
        this.map.fitBounds(bounds, { padding: 60 });

        // Call Matrix API (correct endpoint: directions-matrix)
        const allCoords = [...geoOrigins, ...geoDests];
        const coordsStr = allCoords.map((c) => c.coords.join(",")).join(";");
        const originsIdx = geoOrigins.map((_, i) => i).join(";");
        const destsIdx = geoDests.map((_, i) => i + geoOrigins.length).join(";");

        const matrixUrl = `https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${coordsStr}?sources=${originsIdx}&destinations=${destsIdx}&annotations=duration,distance&access_token=${mapboxgl.accessToken}`;
        const res = await fetch(matrixUrl);
        const data = await res.json();

        if (data.code !== "Ok" || !data.durations) {
          throw new Error(data.message || this.$t('matrix.calculationFailed'));
        }

        const durationRows = geoOrigins.map((_o, i) =>
          geoDests.map((_d, j) => {
            const val = data.durations[i][j];
            return val !== null && val !== undefined ? val : null;
          })
        );

        const distanceRows = geoOrigins.map((_o, i) =>
          geoDests.map((_d, j) => {
            const val = data.distances ? data.distances[i][j] : null;
            return val !== null && val !== undefined ? val : null;
          })
        );

        this.matrixData = {
          origins: geoOrigins.map((g) => g.name),
          destinations: geoDests.map((g) => g.name),
          durationRows,
          distanceRows,
        };
      } catch (err) {
        this.errorMsg = err.message || this.$t('errors.calculationFailed');
      } finally {
        this.loading = false;
      }
    },

    formatDuration(seconds) {
      if (seconds < 60) return `${Math.round(seconds)} ${this.$t('matrix.seconds')}`;
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      if (h > 0) return `${h}h${m}m`;
      return `${m} ${this.$t('route.minutes')}`;
    },

    formatDistance(meters) {
      if (meters === null || meters === undefined) return "";
      if (meters < 1000) return `${Math.round(meters)}m`;
      return `${(meters / 1000).toFixed(1)}km`;
    },

    clearMarkers() {
      this.markers.forEach((m) => m.remove());
      this.markers = [];
    },

    applyPreset(preset) {
      this.originsText = preset.origins;
      this.destinationsText = preset.destinations;
      this.errorMsg = "";
      this.matrixData = null;
    },

    reset() {
      this.originsText = "";
      this.destinationsText = "";
      this.errorMsg = "";
      this.matrixData = null;
      this.clearMarkers();
    },
  },

  beforeUnmount() {
    this.clearMarkers();
  },
};
</script>

<style scoped>
.matrix-panel {
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
  background: #3b9ddd;
  color: white;
  border-color: #3b9ddd;
}

.input-section {
  display: flex;
  gap: 10px;
  align-items: flex-end;
}

.input-group {
  flex: 1;
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
  resize: vertical;
  font-family: inherit;
}

.input-group textarea:focus {
  outline: none;
  border-color: #3b9ddd;
}

.btn-calc {
  padding: 8px 16px;
  background: #3b9ddd;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
  align-self: flex-end;
}

.btn-calc:hover:not(:disabled) {
  background: #2e86c1;
}

.btn-calc:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.error-msg {
  color: #e74c3c;
  font-size: 13px;
}

.matrix-result {
  overflow-x: auto;
}

.matrix-result table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.matrix-result th,
.matrix-result td {
  padding: 8px 12px;
  border: 1px solid #e0e0e0;
  text-align: center;
  line-height: 1.4;
}

.matrix-result td .time {
  display: block;
  font-weight: 600;
  color: #1a5276;
}

.matrix-result td .dist {
  display: block;
  font-size: 11px;
  color: #888;
}

.matrix-result th {
  background: #f5f5f5;
  font-weight: 600;
  color: #333;
  white-space: nowrap;
}

.matrix-result .row-header {
  background: #f5f5f5;
  font-weight: 600;
  color: #333;
  white-space: nowrap;
  text-align: left;
}

.matrix-result .no-route {
  color: #bbb;
}
</style>
