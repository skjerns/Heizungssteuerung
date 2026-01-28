// graph.js
(() => {
  const VERSION = 'v1.1.0'; // Version with dynamic range 17-23°C, red-to-green, tooltip support
  const STATUS_URL = './status.php';

  // Heatmap config
  const HEATMAP_BIN_MIN = 30;           // columns per day = 24h / bin
  const HEATMAP_MIN_C = 17;             // fixed range (cold)
  const HEATMAP_MAX_C = 23;             // fixed range (hot)

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

    // tooltip
    tooltip: null,
    heatmapLayout: null, // stores grid dimensions for hit detection
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
      el.wrap.style.cssText = 'position: relative; width: 100%;';
      parent.insertBefore(el.wrap, el.canvas);
      el.wrap.appendChild(el.canvas);
    }

    // Toolbar
    if (!el.wrap.querySelector('.tempToolbar')) {
      const tb = document.createElement('div');
      tb.className = 'tempToolbar';
      tb.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 8px;
        margin-bottom: 8px;
        background: rgba(0, 0, 0, 0.2);
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.1);
      `;
      tb.innerHTML = `
        <div class="tempToolbarRow" style="display: flex; justify-content: space-between; align-items: center; gap: 12px;">
          <div class="tempMode" style="display: flex; gap: 6px; align-items: center;">
            <button type="button" class="tempBtn tempBtnMode" data-mode="heatmap" style="padding: 6px 12px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; color: rgba(255,255,255,0.8); cursor: pointer; font-size: 12px;">heatmap</button>
            <button type="button" class="tempBtn tempBtnMode" data-mode="graph" style="padding: 6px 12px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; color: rgba(255,255,255,0.8); cursor: pointer; font-size: 12px;">graph</button>
            <span class="tempVersion" style="font-size: 10px; color: rgba(255,255,255,0.4); margin-left: 4px;">${VERSION}</span>
          </div>
          <div class="tempMetricWrap" style="display: flex; align-items: center; gap: 6px;">
            <label class="tempMetricLabel" style="font-size: 12px; color: rgba(255,255,255,0.7);">heatmap:</label>
            <select class="tempMetricSelect" style="padding: 4px 8px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.15); border-radius: 4px; color: rgba(255,255,255,0.9); font-size: 12px;">
              <option value="measured">measured</option>
              <option value="set">set</option>
            </select>
          </div>
        </div>

        <div class="tempToolbarRow tempToolbarTitleRow" style="text-align: center;">
          <div class="tempTitle" style="font-size: 13px; color: rgba(255,255,255,0.85); font-weight: 500;"></div>
        </div>

        <div class="tempToolbarRow tempToolbarNavRow" style="display: flex; justify-content: center; gap: 8px;">
          <button type="button" class="tempBtn tempPrev" style="padding: 6px 12px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; color: rgba(255,255,255,0.8); cursor: pointer; font-size: 14px; min-width: 36px;">&lt;</button>
          <button type="button" class="tempBtn tempReset" style="padding: 6px 16px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; color: rgba(255,255,255,0.8); cursor: pointer; font-size: 12px;"></button>
          <button type="button" class="tempBtn tempNext" style="padding: 6px 12px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; color: rgba(255,255,255,0.8); cursor: pointer; font-size: 14px; min-width: 36px;">&gt;</button>
        </div>
      `;
      el.wrap.insertBefore(tb, el.canvas);

      // Add hover styles dynamically
      const style = document.createElement('style');
      style.textContent = `
        .tempBtn:hover { background: rgba(255,255,255,0.15) !important; }
        .tempBtn:disabled { opacity: 0.4; cursor: not-allowed; }
        .tempBtn.isActive { background: rgba(255,255,255,0.2) !important; border-color: rgba(255,255,255,0.3) !important; }
      `;
      document.head.appendChild(style);
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

    // Create tooltip if not exists
    if (!state.tooltip) {
      state.tooltip = document.createElement('div');
      state.tooltip.className = 'tempTooltip';
      state.tooltip.style.cssText = `
        position: absolute;
        background: rgba(0, 0, 0, 0.9);
        color: rgba(255, 255, 255, 0.95);
        padding: 6px 10px;
        border-radius: 6px;
        font-size: 13px;
        pointer-events: none;
        display: none;
        z-index: 1000;
        white-space: nowrap;
        border: 1px solid rgba(255, 255, 255, 0.2);
      `;
      el.wrap.appendChild(state.tooltip);
    }

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
      // Ensure canvas doesn't cause scrolling
      el.canvas.style.display = 'block';
      el.canvas.style.maxHeight = '320px';
      renderHeatmap();
    } else {
      // Hide tooltip when switching to graph mode
      if (state.tooltip) state.tooltip.style.display = 'none';
      el.canvas.style.display = 'block';
      el.canvas.style.maxHeight = '320px';
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

    // Add mouse event listeners for tooltip
    if (!el.canvas._heatmapEventsAttached) {
      el.canvas._heatmapEventsAttached = true;

      el.canvas.addEventListener('mousemove', (e) => {
        if (state.mode !== 'heatmap' || !state.heatmapLayout) return;
        showTooltipAtPosition(e);
      });

      el.canvas.addEventListener('click', (e) => {
        if (state.mode !== 'heatmap' || !state.heatmapLayout) return;
        showTooltipAtPosition(e);
      });

      el.canvas.addEventListener('mouseleave', () => {
        if (state.tooltip) state.tooltip.style.display = 'none';
      });
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

  // cold red -> hot green
  function heatColor(tempC, minC, maxC) {
    const t = (tempC - minC) / (maxC - minC);
    const u = clamp(t, 0, 1);

    const red = [220, 30, 30];      // cold (low temp)
    const green = [30, 200, 80];    // hot (high temp)

    return lerpRGB(red, green, u);
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

  function findGridMinMax(grid, defaultMin, defaultMax) {
    let min = Infinity;
    let max = -Infinity;
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        const v = grid[r][c];
        if (Number.isFinite(v)) {
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
    }
    // If no data, use defaults
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return { min: defaultMin, max: defaultMax };
    }
    // Use defaults but extend if data goes beyond
    const finalMin = Math.min(min, defaultMin);
    const finalMax = Math.max(max, defaultMax);
    return { min: finalMin, max: finalMax };
  }

  function showTooltipAtPosition(e) {
    if (!state.heatmapLayout || !state.tooltip) return;

    const rect = el.canvas.getBoundingClientRect();
    const wrapRect = el.wrap.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const layout = state.heatmapLayout;

    // Check if within grid bounds
    if (x < layout.gridX || x > layout.gridX + layout.gridW ||
        y < layout.gridY || y > layout.gridY + layout.gridH) {
      state.tooltip.style.display = 'none';
      return;
    }

    // Find cell
    const col = Math.floor((x - layout.gridX) / layout.cellW);
    const row = Math.floor((y - layout.gridY) / layout.cellH);

    if (row < 0 || row >= 7 || col < 0 || col >= layout.binsPerDay) {
      state.tooltip.style.display = 'none';
      return;
    }

    const temp = layout.grid[row][col];
    if (!Number.isFinite(temp)) {
      state.tooltip.style.display = 'none';
      return;
    }

    // Calculate time for this cell
    const minOfDay = col * HEATMAP_BIN_MIN;
    const hours = Math.floor(minOfDay / 60);
    const mins = minOfDay % 60;
    const timeStr = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;

    state.tooltip.textContent = `${DAYS[row]} ${timeStr} - ${temp.toFixed(1)}°C`;
    state.tooltip.style.display = 'block';

    // Position relative to wrap, with offset
    const tooltipX = e.clientX - wrapRect.left + 10;
    const tooltipY = e.clientY - wrapRect.top + 10;

    state.tooltip.style.left = `${tooltipX}px`;
    state.tooltip.style.top = `${tooltipY}px`;
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

    // Use default range (17-23°C) but extend if data goes beyond
    const { min: minTemp, max: maxTemp } = findGridMinMax(grid, HEATMAP_MIN_C, HEATMAP_MAX_C);

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

    // Store layout for hit detection
    state.heatmapLayout = {
      grid, binsPerDay, gridX, gridY, gridW, gridH, cellW, cellH,
      minTemp, maxTemp
    };

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
        ctx.fillStyle = heatColor(v, minTemp, maxTemp);
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
