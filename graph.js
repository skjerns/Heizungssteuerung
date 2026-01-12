// graph.js
(() => {
  const STATUS_URL = './status.php';
  const HOURS_DEFAULT = 8;

  const el = {
    canvas: null,
  };

  const state = {
    chart: null,
    loadedOnce: false,
    loading: false,
    dataMinX: null,
    dataMaxX: null,
  };

  function parseStamped(s) {
    if (!s || typeof s !== 'string') return null;
    const idx = s.indexOf(',');
    if (idx === -1) return null;
    const dt = s.slice(0, idx).trim();
    const tempStrRaw = s.slice(idx + 1).trim();
    const temp = parseFloat(tempStrRaw.replace(',', '.'));
    if (!Number.isFinite(temp)) return null;

    const t = new Date(dt.replace(' ', 'T')).getTime();
    if (!Number.isFinite(t)) return null;

    return { x: t, y: temp };
  }

  function parseHist(arr) {
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (const s of arr) {
      const p = parseStamped(s);
      if (p) out.push(p);
    }
    out.sort((a,b) => a.x - b.x);
    return out;
  }

  function formatTime(ms) {
    const d = new Date(ms);
    const hh = String(d.getHours()).padStart(2,'0');
    const mm = String(d.getMinutes()).padStart(2,'0');
    return `${hh}:${mm}`;
  }

  async function fetchStatus() {
    const r = await fetch(STATUS_URL, { cache:'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  }

  function computeBounds(seriesA, seriesB) {
    let minX = Infinity, maxX = -Infinity;
    for (const p of seriesA) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; }
    for (const p of seriesB) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; }
    if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return { minX: null, maxX: null };
    return { minX, maxX };
  }

  function setInitialWindow(chart, minX, maxX) {
    const span = HOURS_DEFAULT * 3600 * 1000;
    const right = maxX;
    const left = Math.max(minX, maxX - span);

    chart.options.scales.x.min = left;
    chart.options.scales.x.max = right;
    chart.update('none');
  }

  function ensureChartLibReady() {
    return !!(window.Chart && window.ChartZoom);
  }

  function buildChart(room, eq3, minX, maxX) {
    const ctx = el.canvas.getContext('2d');

    // chartjs-plugin-zoom registers as "zoom"
    Chart.register(ChartZoom);

    state.chart = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Room',
            data: room,
            parsing: false,
            pointRadius: 0,
            borderWidth: 2,
            tension: 0.35,
            cubicInterpolationMode: 'monotone',
          },
          {
            label: 'EQ3',
            data: eq3,
            parsing: false,
            pointRadius: 0,
            borderWidth: 2,
            tension: 0.35,
            cubicInterpolationMode: 'monotone',
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: 'rgba(255,255,255,.75)' } },
          tooltip: {
            callbacks: {
              title: (items) => items?.length ? new Date(items[0].parsed.x).toLocaleString() : '',
            }
          },
          zoom: {
            pan: {
              enabled: true,
              mode: 'x',
              modifierKey: null,
            },
            zoom: {
              wheel: { enabled: true },
              pinch: { enabled: true },
              mode: 'x',
            },
            limits: {
              x: { min: minX, max: maxX }
            }
          }
        },
        scales: {
          x: {
            type: 'linear',
            ticks: {
              color: 'rgba(255,255,255,.55)',
              maxTicksLimit: 8,
              callback: (v) => formatTime(v),
            },
            grid: { color: 'rgba(255,255,255,.07)' }
          },
          y: {
            ticks: { color: 'rgba(255,255,255,.55)' },
            grid: { color: 'rgba(255,255,255,.07)' }
          }
        }
      }
    });

    setInitialWindow(state.chart, minX, maxX);
  }

  function updateChart(room, eq3, minX, maxX) {
    const c = state.chart;
    c.data.datasets[0].data = room;
    c.data.datasets[1].data = eq3;

    c.options.plugins.zoom.limits.x.min = minX;
    c.options.plugins.zoom.limits.x.max = maxX;

    // keep current window if user panned; if first load, set last 8h
    if (!state.loadedOnce) setInitialWindow(c, minX, maxX);
    c.update('none');
  }

  async function loadOnceOrRefresh() {
    if (state.loading) return;
    state.loading = true;

    try {
      const data = await fetchStatus();

      const room = parseHist(data.room_hist || []);
      const eq3  = parseHist(data.eq3_hist || []);

      const bounds = computeBounds(room, eq3);
      if (!bounds.minX) throw new Error('no data');

      state.dataMinX = bounds.minX;
      state.dataMaxX = bounds.maxX;

      if (!state.chart) {
        buildChart(room, eq3, bounds.minX, bounds.maxX);
      } else {
        updateChart(room, eq3, bounds.minX, bounds.maxX);
      }

      state.loadedOnce = true;
    } finally {
      state.loading = false;
    }
  }

  function initDomRefs() {
    el.canvas = document.getElementById('tempChart');
  }

  async function ensureLoaded() {
    if (!el.canvas) initDomRefs();
    if (!ensureChartLibReady()) {
      // Chart.js scripts are defer; wait a tick until they attach
      await new Promise(r => setTimeout(r, 0));
      if (!ensureChartLibReady()) return;
    }
    await loadOnceOrRefresh();
  }

  window.GraphView = { ensureLoaded };
})(); 
