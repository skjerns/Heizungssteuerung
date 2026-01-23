// graph.js
(() => {
  const STATUS_URL = './status.php';

  // Heatmap config
  const HEATMAP_BIN_MIN = 30;           // columns per day = 24h / bin
  const HEATMAP_MIN_C = 10;             // fixed range (cold)
  const HEATMAP_MAX_C = 30;             // fixed range (hot)

  const MS_MIN = 60 * 1000;
  const MS_HOUR = 60 * MS_MIN;
  const MS_DAY = 24 * MS_HOUR;
  const MS_WEEK = 7 * MS_DAY;

  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const el = {
    canvas: null,
    wrap: null,

    // common
    toolbar: null,
    btnModeHeatmap: null,
    btnModeGraph: null,

    // nav/title
    title: null,
    btnPrev: null,
    btnReset: null,
    btnNext: null,

    // heatmap metric
    metricWrap: null,
    metricSelect: null,
  };

  const state = {
    mode: 'heatmap',        // 'heatmap' | 'graph'
    weekOffset: 0,          // 0 = current week, negative = past weeks
    dayOffset: 0,           // 0 = today, negative = past days
    heatMetric: 'measured', // 'measured' | 'set'

    loading: false,
    loadedOnce: false,

    // parsed points: {x(ms), y(temp)}
    measured: [],
    set: [],

    dataMinX: null,
    dataMaxX: null,

    // computed navigation bounds (inclusive)
    minWeekOffset: 0,
    minDayOffset: 0,

    // graph
    chart: null,
    chartZoomRegistered: false,

    // heatmap rendering
    heatCtx: null,
    dpr: 1,
    resizeObs: null,
  };

  function parseStamped(s) {
    if (!s || typeof s !== 'string') return null;
    const idx = s.indexOf(',');
    if (idx === -1) return null;
    const dt = s.slice(0, idx).trim();
    const tempStrRaw = s.slice(idx + 1).trim();
    const temp = parseFloat(tempStrRaw.replace(',', '.'));
    if (!Number.isFinite(temp)) return null;

    // Expect "YYYY-MM-DD HH:MM[:SS]" -> local time
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
    out.sort((a, b) => a.x - b.x);
    return out;
  }

  function formatHHMM(ms) {
    const d = new Date(ms);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  function formatYMD(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function startOfDayMs(ms) {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function addDaysMs(ms, n) {
    return ms + n * MS_DAY;
  }

  // Monday as start of week (local)
  function startOfWeekMondayMs(ms) {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    const jsDay = d.getDay(); // 0=Sun..6=Sat
    const isoDay = jsDay === 0 ? 7 : jsDay; // 1=Mon..7=Sun
    const delta = isoDay - 1; // days since Monday
    d.setDate(d.getDate() - delta);
    return d.getTime();
  }

  async function fetchStatus() {
    const r = await fetch(STATUS_URL, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  }

  function computeGlobalBounds(a, b) {
    let minX = Infinity, maxX = -Infinity;
    for (const p of a) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; }
    for (const p of b) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; }
    if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return { minX: null, maxX: null };
    return { minX, maxX };
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function setNavBounds() {
    // No data => only current week/day allowed
    if (!Number.isFinite(state.dataMinX)) {
      state.minWeekOffset = 0;
      state.minDayOffset = 0;
      return;
    }

    const now = Date.now();
    const curWeek0 = startOfWeekMondayMs(now);
    const minWeek0 = startOfWeekMondayMs(state.dataMinX);
    state.minWeekOffset = Math.floor((minWeek0 - curWeek0) / MS_WEEK); // negative or 0

    const curDay0 = startOfDayMs(now);
    const minDay0 = startOfDayMs(state.dataMinX);
    state.minDayOffset = Math.floor((minDay0 - curDay0) / MS_DAY); // negative or 0

    state.weekOffset = clamp(state.weekOffset, state.minWeekOffset, 0);
    state.dayOffset = clamp(state.dayOffset, state.minDayOffset, 0);
  }

  function ensureWrapAndToolbar() {
    el.canvas = document.getElementById('tempChart');
    if (!el.canvas) return false;

    // Wrap canvas if not wrapped
    const parent = el.canvas.parentElement;
    if (parent && parent.classList.contains('tempChartWrap')) {
      el.wrap = parent;
    } else {
      el.wrap = document.createElement('div');
      el.wrap.className = 'tempChartWrap';
      parent.insertBefore(el.wrap, el.canvas);
      el.wrap.appendChild(el.canvas);
    }

    // Toolbar
    if (!el.wrap.querySelector('.tempToolbar')) {
      const tb = document.createElement('div');
      tb.className = 'tempToolbar';
      tb.innerHTML = `
        <div class="tempToolbarRow">
          <div class="tempMode">
            <button type="button" class="tempBtn tempBtnMode" data-mode="heatmap">heatmap</button>
            <button type="button" class="tempBtn tempBtnMode" data-mode="graph">graph</button>
          </div>
          <div class="tempMetricWrap">
            <label class="tempMetricLabel">heatmap:</label>
            <select class="tempMetricSelect">
              <option value="measured">measured</option>
              <option value="set">set</option>
            </select>
          </div>
        </div>

        <div class="tempToolbarRow tempToolbarTitleRow">
          <div class="tempTitle"></div>
        </div>

        <div class="tempToolbarRow tempToolbarNavRow">
          <button type="button" class="tempBtn tempPrev">&lt;</button>
          <button type="button" class="tempBtn tempReset"></button>
          <button type="button" class="tempBtn tempNext">&gt;</button>
        </div>
      `;
      el.wrap.insertBefore(tb, el.canvas);
    }

    el.toolbar = el.wrap.querySelector('.tempToolbar');
    el.btnModeHeatmap = el.wrap.querySelector('button[data-mode="heatmap"]');
    el.btnModeGraph = el.wrap.querySelector('button[data-mode="graph"]');
    el.title = el.wrap.querySelector('.tempTitle');
    el.btnPrev = el.wrap.querySelector('.tempPrev');
    el.btnReset = el.wrap.querySelector('.tempReset');
    el.btnNext = el.wrap.querySelector('.tempNext');
    el.metricWrap = el.wrap.querySelector('.tempMetricWrap');
    el.metricSelect = el.wrap.querySelector('.tempMetricSelect');

    // Wire once
    if (!el.toolbar._wired) {
      el.toolbar._wired = true;

      el.btnModeHeatmap.addEventListener('click', () => setMode('heatmap'));
      el.btnModeGraph.addEventListener('click', () => setMode('graph'));

      el.metricSelect.addEventListener('change', () => {
        state.heatMetric = el.metricSelect.value === 'set' ? 'set' : 'measured';
        if (state.mode === 'heatmap') renderHeatmap();
      });

      el.btnPrev.addEventListener('click', () => {
        if (state.mode === 'heatmap') {
          state.weekOffset = clamp(state.weekOffset - 1, state.minWeekOffset, 0);
          renderHeatmap();
        } else {
          state.dayOffset = clamp(state.dayOffset - 1, state.minDayOffset, 0);
          renderGraphDay();
        }
        syncUi();
      });

      el.btnNext.addEventListener('click', () => {
        if (state.mode === 'heatmap') {
          state.weekOffset = clamp(state.weekOffset + 1, state.minWeekOffset, 0);
          renderHeatmap();
        } else {
          state.dayOffset = clamp(state.dayOffset + 1, state.minDayOffset, 0);
          renderGraphDay();
        }
        syncUi();
      });

      el.btnReset.addEventListener('click', () => {
        if (state.mode === 'heatmap') {
          state.weekOffset = 0;
          renderHeatmap();
        } else {
          state.dayOffset = 0;
          renderGraphDay();
        }
        syncUi();
      });
    }

    return true;
  }

  function setMode(mode) {
    const m = (mode === 'graph') ? 'graph' : 'heatmap';
    if (state.mode === m) return;
    state.mode = m;

    // Cleanup
    if (state.mode === 'heatmap') {
      destroyChart();
      ensureHeatmapCtx();
      renderHeatmap();
    } else {
      renderGraphDay();
    }

    syncUi();
  }

  function syncUi() {
    // Mode button active state
    el.btnModeHeatmap.classList.toggle('isActive', state.mode === 'heatmap');
    el.btnModeGraph.classList.toggle('isActive', state.mode === 'graph');

    // Metric only for heatmap
    el.metricWrap.style.display = (state.mode === 'heatmap') ? '' : 'none';
    el.metricSelect.value = state.heatMetric;

    // Reset button label and title
    if (state.mode === 'heatmap') {
      el.btnReset.textContent = 'this week';

      const now = Date.now();
      const week0 = startOfWeekMondayMs(now);
      const weekStart = week0 + state.weekOffset * MS_WEEK;
      const weekEnd = weekStart + MS_WEEK - 1;
      const a = new Date(weekStart);
      const b = new Date(weekEnd);
      el.title.textContent = `${formatYMD(a)} ? ${formatYMD(b)}`;

      el.btnNext.disabled = state.weekOffset >= 0;
      el.btnPrev.disabled = state.weekOffset <= state.minWeekOffset;
    } else {
      el.btnReset.textContent = 'today';

      const now = Date.now();
      const dayStart = startOfDayMs(now) + state.dayOffset * MS_DAY;
      const d = new Date(dayStart);
      el.title.textContent = formatYMD(d);

      el.btnNext.disabled = state.dayOffset >= 0;
      el.btnPrev.disabled = state.dayOffset <= state.minDayOffset;
    }
  }

  function ensureHeatmapCtx() {
    if (state.heatCtx) return;
    state.heatCtx = el.canvas.getContext('2d');

    if (!state.resizeObs && 'ResizeObserver' in window) {
      state.resizeObs = new ResizeObserver(() => {
        if (state.mode === 'heatmap') renderHeatmap();
      });
      state.resizeObs.observe(el.canvas);
      state.resizeObs.observe(el.wrap);
    }
  }

  function setCanvasDpiSize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = el.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    const rw = Math.floor(w * dpr);
    const rh = Math.floor(h * dpr);

    if (el.canvas.width !== rw || el.canvas.height !== rh || state.dpr !== dpr) {
      el.canvas.width = rw;
      el.canvas.height = rh;
      state.dpr = dpr;
    }

    return { cssW: w, cssH: h, pxW: rw, pxH: rh, dpr };
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function lerpRGB(c0, c1, t) {
    const r = Math.round(lerp(c0[0], c1[0], t));
    const g = Math.round(lerp(c0[1], c1[1], t));
    const b = Math.round(lerp(c0[2], c1[2], t));
    return `rgb(${r},${g},${b})`;
  }

  // cold blue -> yellow -> red
  function heatColor(tempC) {
    const t = (tempC - HEATMAP_MIN_C) / (HEATMAP_MAX_C - HEATMAP_MIN_C);
    const u = clamp(t, 0, 1);

    const blue = [0, 90, 200];
    const yellow = [255, 220, 0];
    const red = [220, 30, 30];

    if (u <= 0.5) return lerpRGB(blue, yellow, u / 0.5);
    return lerpRGB(yellow, red, (u - 0.5) / 0.5);
  }

  function pointsInRange(points, startMs, endMs) {
    // points are sorted; cheap scan
    const out = [];
    for (const p of points) {
      if (p.x < startMs) continue;
      if (p.x >= endMs) break;
      out.push(p);
    }
    return out;
  }

  function binWeek(points, weekStartMs) {
    const binsPerDay = Math.floor(MS_DAY / (HEATMAP_BIN_MIN * MS_MIN));
    const sums = Array.from({ length: 7 }, () => new Float64Array(binsPerDay));
    const cnts = Array.from({ length: 7 }, () => new Uint32Array(binsPerDay));

    const weekEndMs = weekStartMs + MS_WEEK;
    for (const p of points) {
      if (p.x < weekStartMs) continue;
      if (p.x >= weekEndMs) break;

      const rel = p.x - weekStartMs;
      const day = Math.floor(rel / MS_DAY);
      if (day < 0 || day > 6) continue;

      const inDay = rel - day * MS_DAY;
      const bin = Math.floor(inDay / (HEATMAP_BIN_MIN * MS_MIN));
      if (bin < 0 || bin >= binsPerDay) continue;

      sums[day][bin] += p.y;
      cnts[day][bin] += 1;
    }

    const grid = Array.from({ length: 7 }, () => new Float64Array(binsPerDay));
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < binsPerDay; c++) {
        grid[r][c] = cnts[r][c] ? (sums[r][c] / cnts[r][c]) : NaN;
      }
    }
    return { grid, binsPerDay };
  }

  function renderHeatmap() {
    ensureHeatmapCtx();
    const { pxW, pxH, dpr } = setCanvasDpiSize();

    const ctx = state.heatCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pxW, pxH);
    ctx.scale(dpr, dpr);

    const rect = el.canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    const now = Date.now();
    const week0 = startOfWeekMondayMs(now);
    const weekStartMs = week0 + state.weekOffset * MS_WEEK;

    const series = (state.heatMetric === 'set') ? state.set : state.measured;
    const { grid, binsPerDay } = binWeek(series, weekStartMs);

    // Layout (in CSS pixels after ctx.scale(dpr))
    const pad = 8;
    const topHeaderH = 18;
    const leftLabelW = 44;
    const gridX = leftLabelW + pad;
    const gridY = topHeaderH + pad;
    const gridW = Math.max(1, w - gridX - pad);
    const gridH = Math.max(1, h - gridY - pad);

    const cellW = gridW / binsPerDay;
    const cellH = gridH / 7;

    // Time labels (every 2h)
    ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(255,255,255,0.65)';

    const labelEveryMin = 120;
    const step = Math.max(1, Math.floor(labelEveryMin / HEATMAP_BIN_MIN));
    for (let c = 0; c < binsPerDay; c += step) {
      const minOfDay = c * HEATMAP_BIN_MIN;
      const tMs = startOfDayMs(now) + minOfDay * MS_MIN;
      const x = gridX + c * cellW;
      ctx.fillText(formatHHMM(tMs), x, pad);
    }

    // Day labels
    ctx.textBaseline = 'middle';
    for (let r = 0; r < 7; r++) {
      const y = gridY + r * cellH + cellH / 2;
      ctx.fillText(DAYS[r], pad, y);
    }

    // Cells
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < binsPerDay; c++) {
        const v = grid[r][c];
        if (!Number.isFinite(v)) continue; // keep blank (current/future bins stay empty)
        ctx.fillStyle = heatColor(v);
        const x = gridX + c * cellW;
        const y = gridY + r * cellH;
        ctx.fillRect(x, y, cellW + 0.5, cellH + 0.5);
      }
    }

    // Subtle grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;

    ctx.beginPath();
    for (let r = 0; r <= 7; r++) {
      const y = gridY + r * cellH;
      ctx.moveTo(gridX, y);
      ctx.lineTo(gridX + gridW, y);
    }
    for (let c = 0; c <= binsPerDay; c++) {
      const x = gridX + c * cellW;
      ctx.moveTo(x, gridY);
      ctx.lineTo(x, gridY + gridH);
    }
    ctx.stroke();
  }

  function ensureChartLibReady() {
    return !!(window.Chart && window.ChartZoom);
  }

  function destroyChart() {
    if (state.chart) {
      state.chart.destroy();
      state.chart = null;
    }
  }

  function buildOrUpdateChart(measured, set, xMin, xMax) {
    if (!ensureChartLibReady()) return;

    // If we were in heatmap and rendered directly, clear canvas (Chart will own it)
    state.heatCtx = null;

    const ctx = el.canvas.getContext('2d');

    if (!state.chartZoomRegistered) {
      // chartjs-plugin-zoom registers as "zoom"
      Chart.register(ChartZoom);
      state.chartZoomRegistered = true;
    }

    const options = {
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
          pan: { enabled: true, mode: 'x', modifierKey: null },
          zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' },
          limits: { x: { min: xMin, max: xMax } }
        }
      },
      scales: {
        x: {
          type: 'linear',
          min: xMin,
          max: xMax,
          ticks: {
            color: 'rgba(255,255,255,.55)',
            maxTicksLimit: 8,
            callback: (v) => formatHHMM(v),
          },
          grid: { color: 'rgba(255,255,255,.07)' }
        },
        y: {
          ticks: { color: 'rgba(255,255,255,.55)' },
          grid: { color: 'rgba(255,255,255,.07)' }
        }
      }
    };

    if (!state.chart) {
      state.chart = new Chart(ctx, {
        type: 'line',
        data: {
          datasets: [
            {
              label: 'Measured',
              data: measured,
              parsing: false,
              pointRadius: 0,
              borderWidth: 2,
              tension: 0.35,
              cubicInterpolationMode: 'monotone',
            },
            {
              label: 'Set',
              data: set,
              parsing: false,
              pointRadius: 0,
              borderWidth: 2,
              tension: 0.35,
              cubicInterpolationMode: 'monotone',
            }
          ]
        },
        options
      });
    } else {
      const c = state.chart;
      c.data.datasets[0].data = measured;
      c.data.datasets[1].data = set;

      c.options.scales.x.min = xMin;
      c.options.scales.x.max = xMax;
      c.options.plugins.zoom.limits.x.min = xMin;
      c.options.plugins.zoom.limits.x.max = xMax;

      c.update('none');
    }
  }

  function renderGraphDay() {
    const now = Date.now();
    const dayStart = startOfDayMs(now) + state.dayOffset * MS_DAY;
    const dayEnd = dayStart + MS_DAY;

    // show full-day axis; future points simply don't exist => blank
    const measured = pointsInRange(state.measured, dayStart, dayEnd);
    const set = pointsInRange(state.set, dayStart, dayEnd);

    // If chart lib not ready yet, don't crash; UI still updates
    buildOrUpdateChart(measured, set, dayStart, dayEnd);
  }

  async function loadOnceOrRefresh() {
    if (state.loading) return;
    state.loading = true;

    try {
      const data = await fetchStatus();

      // Map your fields:
      // - measured temperature: data.room_hist
      // - set temperature:      data.eq3_hist
      state.measured = parseHist(data.room_hist || []);
      state.set = parseHist(data.eq3_hist || []);

      const bounds = computeGlobalBounds(state.measured, state.set);
      state.dataMinX = bounds.minX;
      state.dataMaxX = bounds.maxX;

      setNavBounds();
      state.loadedOnce = true;

      // Re-render current mode
      if (state.mode === 'heatmap') renderHeatmap();
      else renderGraphDay();

      syncUi();
    } finally {
      state.loading = false;
    }
  }

  async function ensureLoaded() {
    if (!ensureWrapAndToolbar()) return;

    // Default mode can be changed here if you want:
    // state.mode = 'graph';

    // Heatmap does not depend on Chart.js being ready
    ensureHeatmapCtx();

    // Try to wait a tick for defer scripts (Chart.js)
    if (state.mode === 'graph' && !ensureChartLibReady()) {
      await new Promise(r => setTimeout(r, 0));
    }

    await loadOnceOrRefresh();
  }

  window.GraphView = { ensureLoaded, setMode };
})();
