// Shared plotting code for the asteroseismology exercises.
// Requires Plotly (global) to be loaded before this module runs.
//
// Data format (written by scripts/prepare_data.py):
//   meta.json, lc_time.f32, lc_flux.f32, psd_power.f32  (little-endian float32)

/* ---------- data loading ---------- */

export async function loadDataset(base) {
  if (!base.endsWith('/')) base += '/';
  const meta = await fetchOk(base + 'meta.json').then(r => r.json());
  const [time, flux, power] = await Promise.all(
    ['lc_time.f32', 'lc_flux.f32', 'psd_power.f32'].map(name =>
      fetchOk(base + name).then(r => r.arrayBuffer()).then(b => new Float32Array(b)))
  );
  return { meta, time, flux, power };
}

async function fetchOk(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Could not load ${url} (${r.status})`);
  return r;
}

/* ---------- theme ---------- */

const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function baseLayout() {
  const axis = () => ({
    gridcolor: cssVar('--grid'), linecolor: cssVar('--border'), zeroline: false,
    tickfont: { color: cssVar('--text-2') }, title: { font: { color: cssVar('--text-2') } },
    showspikes: true, spikemode: 'across', spikethickness: 1, spikedash: 'dot',
    spikecolor: cssVar('--text-3'), spikesnap: 'cursor',
    exponentformat: 'power',
  });
  return {
    paper_bgcolor: cssVar('--surface'), plot_bgcolor: cssVar('--surface'),
    font: { family: getComputedStyle(document.body).fontFamily, size: 13, color: cssVar('--text-2') },
    margin: { l: 72, r: 16, t: 34, b: 52 }, // top room for Plotly's hover toolbar
    hovermode: 'closest',
    hoverlabel: { bgcolor: cssVar('--surface'), bordercolor: cssVar('--border'),
                  font: { color: cssVar('--text'), family: cssVar('--mono').split(',')[0] } },
    xaxis: axis(), yaxis: axis(),
    showlegend: false,
    dragmode: 'zoom',
  };
}

const plotConfig = {
  responsive: true, displaylogo: false,
  modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d'],
};

// A visible "Drag: Zoom | Pan" toggle and "Reset view" button above a plot.
// (Plotly's own toolbar icons are small and only appear on hover.)
function addViewControls(div) {
  // On a rebuild of the same plot, reuse its bar (only the plot listener is new).
  let bar = div.previousElementSibling;
  if (!bar?.classList.contains('view-controls')) {
    bar = document.createElement('div');
    bar.className = 'controls view-controls';
    bar.innerHTML = `<span>Drag to</span>
      <span class="seg"><button data-drag="zoom" aria-pressed="true">Zoom</button><button data-drag="pan" aria-pressed="false">Pan</button></span>
      <button data-reset>Reset view</button>`;
    div.parentNode.insertBefore(bar, div);
  }
  const sync = mode => bar.querySelectorAll('[data-drag]').forEach(b => b.setAttribute('aria-pressed', b.dataset.drag === mode));
  sync('zoom');
  bar.querySelectorAll('[data-drag]').forEach(b => b.onclick = () => { Plotly.relayout(div, { dragmode: b.dataset.drag }); sync(b.dataset.drag); });
  bar.querySelector('[data-reset]').onclick = () => div.resetView?.();
  div.on('plotly_relayout', ev => { if (ev.dragmode) sync(ev.dragmode); }); // keep in step with the toolbar
}

const themed = []; // {div, restyleColors()}, one entry per plot element
function registerTheme(div, restyleColors) {
  const i = themed.findIndex(p => p.div === div);
  if (i >= 0) themed.splice(i, 1);
  themed.push({ div, restyleColors });
}

// Draw a plot from scratch. Purging first drops the previous plot's event
// listeners, so a plot can be rebuilt (e.g. with new data) without stacking them.
function freshPlot(div, traces, layout) {
  if (div._fullLayout) Plotly.purge(div);
  div.innerHTML = '';
  return Plotly.newPlot(div, traces, layout, plotConfig);
}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  for (const p of themed) {
    const b = baseLayout();
    Plotly.relayout(p.div, {
      paper_bgcolor: b.paper_bgcolor, plot_bgcolor: b.plot_bgcolor, font: b.font, hoverlabel: b.hoverlabel,
      'xaxis.gridcolor': b.xaxis.gridcolor, 'yaxis.gridcolor': b.yaxis.gridcolor,
      'xaxis.linecolor': b.xaxis.linecolor, 'yaxis.linecolor': b.yaxis.linecolor,
      'xaxis.tickfont.color': b.xaxis.tickfont.color, 'yaxis.tickfont.color': b.yaxis.tickfont.color,
      'xaxis.title.font.color': b.xaxis.title.font.color, 'yaxis.title.font.color': b.yaxis.title.font.color,
      'xaxis.spikecolor': b.xaxis.spikecolor, 'yaxis.spikecolor': b.yaxis.spikecolor,
    });
    p.restyleColors();
  }
});

/* ---------- decimation ----------
   Plotting ~10^6 points is slow, so each view shows at most `target` bins.
   'max'    keeps the largest value per bin
   'minmax' keeps min and max per bin, so the drawn band matches the full data
   'sample' keeps the bin's middle value (smooth curves)
   Below `raw` visible points the true data are shown unaltered. */

function decimate(xAt, y, i0, i1, mode, target = 3000, raw = 20000) {
  const n = Math.max(0, i1 - i0);
  if (n <= raw) {
    const xs = new Float64Array(n), ys = new Float32Array(n);
    for (let i = 0; i < n; i++) { xs[i] = xAt(i0 + i); ys[i] = y[i0 + i]; }
    return { x: xs, y: ys };
  }
  const k = Math.ceil(n / target);
  const xs = [], ys = [];
  for (let s = i0; s < i1; s += k) {
    const e = Math.min(s + k, i1);
    if (mode === 'sample') {
      const m = (s + e) >> 1; xs.push(xAt(m)); ys.push(y[m]); continue;
    }
    let imax = s, imin = s;
    for (let i = s + 1; i < e; i++) {
      if (y[i] > y[imax]) imax = i;
      if (y[i] < y[imin]) imin = i;
    }
    if (mode === 'minmax') {
      const a = Math.min(imin, imax), b = Math.max(imin, imax);
      xs.push(xAt(a), xAt(b)); ys.push(y[a], y[b]);
    } else {
      xs.push(xAt(imax)); ys.push(y[imax]);
    }
  }
  return { x: xs, y: ys };
}

function lowerBound(arr, x) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < x) lo = mid + 1; else hi = mid; }
  return lo;
}

// Read the current x range of a plot from a relayout event (null = full range).
function xRangeFrom(ev, isLog) {
  if (ev['xaxis.autorange'] || ev['autosize']) return null;
  let r = null;
  if ('xaxis.range[0]' in ev) r = [ev['xaxis.range[0]'], ev['xaxis.range[1]']];
  else if (ev['xaxis.range']) r = ev['xaxis.range'];
  if (!r) return undefined; // event did not touch the x axis
  return isLog ? r.map(v => Math.pow(10, v)) : r.map(Number);
}

/* ---------- light curve ---------- */

export function lightCurvePlot(div, data) {
  const { time, flux, meta } = data;
  // Zoomed out: one vertical min-to-max segment per time bin (fills the band,
  // and null breaks keep data gaps empty). Zoomed in: the raw points.
  const RAW = 30000, BINS = 2500;
  const draw = range => {
    const i0 = range ? Math.max(0, lowerBound(time, range[0]) - 1) : 0;
    const i1 = range ? Math.min(time.length, lowerBound(time, range[1]) + 1) : time.length;
    if (i1 - i0 <= RAW) return { ...decimate(i => time[i], flux, i0, i1, 'minmax', BINS, RAW), mode: 'markers' };
    const span = time[i1 - 1] - time[i0], w = span / BINS;
    const xs = [], ys = [];
    let s = i0;
    while (s < i1) {
      const tEnd = time[s] + w;
      let lo = flux[s], hi = flux[s], e = s + 1;
      while (e < i1 && time[e] < tEnd) { const v = flux[e]; if (v < lo) lo = v; if (v > hi) hi = v; e++; }
      const tm = 0.5 * (time[s] + time[e - 1]);
      xs.push(tm, tm, null); ys.push(lo, hi, null);
      s = e;
    }
    return { x: xs, y: ys, mode: 'lines' };
  };
  const d = draw(null);
  const layout = baseLayout();
  layout.xaxis.title = { ...layout.xaxis.title, text: `Time − ${meta.t0_bkjd.toFixed(3)} (BKJD, days)` };
  layout.yaxis.title = { ...layout.yaxis.title, text: 'Relative flux (ppm)' };
  const trace = {
    type: 'scattergl', mode: d.mode, x: d.x, y: d.y,
    marker: { size: 2.5, color: cssVar('--series-1') },
    line: { width: 1, color: cssVar('--series-1') },
    hovertemplate: 't = %{x:.4f} d<br>flux = %{y:.0f} ppm<extra></extra>',
  };
  freshPlot(div, [trace], layout);
  div.resetView = () => Plotly.relayout(div, { 'xaxis.autorange': true, 'yaxis.autorange': true });
  addViewControls(div);
  div.on('plotly_relayout', ev => {
    const r = xRangeFrom(ev, false);
    if (r === undefined) return;
    const n = draw(r);
    Plotly.restyle(div, { x: [n.x], y: [n.y], mode: n.mode }, [0]);
  });
  registerTheme(div, () =>
    Plotly.restyle(div, { 'marker.color': cssVar('--series-1'), 'line.color': cssVar('--series-1') }, [0]));
}

/* ---------- power spectrum ---------- */

function boxcar(y, w) {
  if (w <= 1) return null;
  const n = y.length, h = Math.floor(w / 2);
  const cs = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + y[i];
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - h), b = Math.min(n, i + h + 1);
    out[i] = (cs[b] - cs[a]) / (b - a);
  }
  return out;
}

export function powerSpectrumPlot(div, data, opts = {}) {
  const { power, meta } = data;
  const { f0, df } = meta.psd;
  const N = power.length;
  const fAt = i => f0 + i * df;
  // opts: { log (default true), smoothing (µHz), showRaw (default true),
  //         pins ([µHz]), onPins(pins),
  //         view ({x: [µHz, µHz], y: [PSD, PSD]} from getView(), to keep a zoom) }
  const log0 = opts.log ?? true;
  const view0 = opts.view?.x ? opts.view : null;
  const state = {
    xlog: log0, ylog: log0, range: view0 ? view0.x.slice() : null,
    smooth: opts.smoothing > 0 ? boxcar(power, Math.round(opts.smoothing / df)) : null,
    pins: (opts.pins || []).slice(),
  };

  const idx = range => range
    ? [Math.max(0, Math.floor((range[0] - f0) / df) - 1), Math.min(N, Math.ceil((range[1] - f0) / df) + 2)]
    : [0, N];

  // Display binning. Zoomed out, each plotted value is the MEAN power over the
  // frequencies under roughly one pixel column, so the curve and the smoothed
  // curve (also a mean) agree. Zooming in narrows the bins until, below 2*BINS
  // visible frequencies, every individual frequency is drawn.
  // Bins are equal in log(f) on a log axis, equal in f on a linear one.
  const BINS = 2000;
  const binEdges = (i0, i1) => {
    const edges = [i0];
    if (state.xlog) {
      const la = Math.log(fAt(i0)), lb = Math.log(fAt(i1 - 1));
      for (let j = 1; j < BINS; j++) {
        const e = Math.ceil((Math.exp(la + (lb - la) * j / BINS) - f0) / df);
        if (e > edges[edges.length - 1] && e < i1) edges.push(e);
      }
    } else {
      const k = (i1 - i0) / BINS;
      for (let j = 1; j < BINS; j++) {
        const e = i0 + Math.round(j * k);
        if (e > edges[edges.length - 1] && e < i1) edges.push(e);
      }
    }
    edges.push(i1);
    return edges;
  };
  // Both curves go through the same bin-averaging. (Point-sampling the smoothed
  // curve instead would let it hit mode peaks that the averaged raw curve has
  // diluted, making the smoothed peaks look taller whenever the smoothing width
  // is narrower than a display bin.)
  const binned = (y, i0, i1) => {
    if (i1 - i0 <= 2 * BINS) return decimate(fAt, y, i0, i1, 'sample', BINS, Infinity);
    const edges = binEdges(i0, i1);
    const xs = new Float64Array(edges.length - 1), ys = new Float32Array(edges.length - 1);
    for (let j = 0; j < edges.length - 1; j++) {
      const a = edges[j], b = edges[j + 1];
      let sum = 0;
      for (let i = a; i < b; i++) sum += y[i];
      ys[j] = sum / (b - a);
      xs[j] = 0.5 * (fAt(a) + fAt(b - 1));
    }
    return { x: xs, y: ys };
  };
  const traces = () => {
    const [i0, i1] = idx(state.range);
    const p = binned(power, i0, i1);
    const s = state.smooth ? binned(state.smooth, i0, i1) : { x: [], y: [] };
    return [p, s];
  };

  // "effective smoothing: XX–YY µHz" in the plot's upper-right corner: the
  // narrowest and widest display bins at the current zoom.
  const fmtW = w => (w < 0.1 ? w.toFixed(4) : w < 10 ? w.toFixed(2) : w.toFixed(1));
  const smoothingLabel = () => {
    const [i0, i1] = idx(state.range);
    if (i1 - i0 <= 2 * BINS) return 'effective smoothing: none';
    const edges = binEdges(i0, i1);
    let lo = Infinity, hi = 0;
    for (let j = 1; j < edges.length; j++) {
      const n = edges[j] - edges[j - 1];
      if (n < lo) lo = n; if (n > hi) hi = n;
    }
    // Linear bins differ only by rounding (e.g. 15 vs 16 frequencies): show one value.
    if (!state.xlog || hi - lo <= 1) {
      const [i0, i1] = idx(state.range);
      return `effective smoothing: ${fmtW(((i1 - i0) / (edges.length - 1)) * df)} µHz`;
    }
    return `effective smoothing: ${fmtW(lo * df)}–${fmtW(hi * df)} µHz`;
  };
  const smoothingAnnotation = () => [{
    xref: 'paper', yref: 'paper', x: 1, y: 1, xanchor: 'right', yanchor: 'top', showarrow: false, yshift: -2,
    text: smoothingLabel(), font: { size: 12, color: cssVar('--text-2') },
    bgcolor: cssVar('--surface'), borderpad: 3,
  }];

  const layout = baseLayout();
  layout.xaxis.title = { ...layout.xaxis.title, text: 'Frequency (µHz)' };
  layout.yaxis.title = { ...layout.yaxis.title, text: 'PSD (ppm² / µHz)' };
  layout.xaxis.type = state.xlog ? 'log' : 'linear';
  layout.yaxis.type = state.ylog ? 'log' : 'linear';
  // Picking peaks: hover/click go by frequency alone, so a click anywhere in the
  // column above or below a peak selects it; only a vertical cursor line is drawn.
  layout.hovermode = 'x';
  layout.hoverdistance = -1;
  layout.spikedistance = -1;
  layout.yaxis.showspikes = false;
  // Default log-y range: from below the typical (median) power to just above the
  // tallest peak. Individual noise values go much lower (power is chi^2
  // distributed); zoom in to see them.
  const logYRange = () => {
    const sample = [];
    let pmax = 0;
    for (let i = 0; i < N; i++) { if (power[i] > pmax) pmax = power[i]; if (i % 97 === 0) sample.push(power[i]); }
    sample.sort((a, b) => a - b);
    const med = sample[sample.length >> 1];
    return [Math.log10(med / 6), Math.log10(pmax) + 0.15];
  };
  // Plotly edits layout range arrays in place (e.g. converting them when the axis
  // type changes), so it only ever gets copies of this one.
  const defaultLogY = Object.freeze(logYRange());
  if (state.ylog) { layout.yaxis.range = defaultLogY.slice(); layout.yaxis.autorange = false; }
  // Home view: exactly the data's frequency span (autorange would pad around the dots).
  const fmax = f0 + (N - 1) * df;
  const homeView = () => ({
    'xaxis.range': state.xlog ? [Math.log10(f0), Math.log10(fmax)] : [f0, fmax], 'xaxis.autorange': false,
    ...(state.ylog ? { 'yaxis.range': defaultLogY.slice(), 'yaxis.autorange': false } : { 'yaxis.autorange': true }),
  });
  layout.xaxis.range = state.xlog ? [Math.log10(f0), Math.log10(fmax)] : [f0, fmax];
  layout.xaxis.autorange = false;
  if (view0) { // restore a zoom carried over from the previous plot
    const toAxis = (r, isLog) => (isLog ? r.map(v => Math.log10(Math.max(v, 1e-30))) : r.slice());
    layout.xaxis.range = toAxis(view0.x, state.xlog);
    if (view0.y) { layout.yaxis.range = toAxis(view0.y, state.ylog); layout.yaxis.autorange = false; }
  }
  layout.annotations = smoothingAnnotation();
  const [p, s] = traces();
  const data0 = [
    { type: 'scattergl', mode: 'lines', x: p.x, y: p.y, line: { width: 1, color: cssVar('--series-1') },
      visible: opts.showRaw ?? true,
      hovertemplate: 'ν = %{x:.2f} µHz<br>PSD = %{y:.3g}<extra></extra>' },
    { type: 'scattergl', mode: 'lines', x: s.x, y: s.y, line: { width: 2, color: cssVar('--series-2') },
      hovertemplate: 'ν = %{x:.2f} µHz<br>smoothed = %{y:.3g}<extra></extra>' },
  ];
  freshPlot(div, data0, layout);
  div.resetView = () => Plotly.relayout(div, homeView());
  addViewControls(div);
  const refresh = () => {
    const [p, s] = traces();
    Plotly.restyle(div, { x: [p.x, s.x], y: [p.y, s.y] }, [0, 1]);
    Plotly.relayout(div, { annotations: smoothingAnnotation() });
  };
  div.on('plotly_relayout', ev => {
    const r = xRangeFrom(ev, state.xlog);
    if (r === undefined) return;
    // A range covering all the data (e.g. after Reset view) counts as "not zoomed".
    const tol = 1e-6 * (fmax - f0);
    state.range = r && (r[0] > f0 + tol || r[1] < fmax - tol) ? r : null;
    refresh();
  });

  // Click to pin frequencies; differences between pins are listed in a table.
  const drawPins = () => {
    Plotly.relayout(div, {
      shapes: state.pins.map(f => ({
        type: 'line', xref: 'x', yref: 'paper', x0: f, x1: f, y0: 0, y1: 1,
        line: { color: cssVar('--pin'), width: 1.5, dash: 'dash' },
      })),
    });
    opts.onPins?.(state.pins.slice());
  };
  if (state.pins.length) drawPins();
  div.on('plotly_click', ev => {
    const pt = ev.points?.[0];
    if (!pt) return;
    // Snap to the highest point within ~0.4% of the plot width (a few pixels)
    // of the clicked frequency. On a log axis a pixel spans more µHz at high f.
    const [va, vb] = state.range || [f0, f0 + (N - 1) * df];
    const half = Math.max(df, state.xlog ? 0.004 * pt.x * Math.log(vb / va) : 0.004 * (vb - va));
    const a = Math.max(0, Math.floor((pt.x - half - f0) / df)), b = Math.min(N - 1, Math.ceil((pt.x + half - f0) / df));
    let im = a;
    for (let i = a + 1; i <= b; i++) if (power[i] > power[im]) im = i;
    state.pins.push(fAt(im));
    state.pins.sort((a, b) => a - b);
    drawPins();
  });

  registerTheme(div, () => {
    Plotly.restyle(div, { 'line.color': [cssVar('--series-1'), cssVar('--series-2')] }, [0, 1]);
    Plotly.relayout(div, { annotations: smoothingAnnotation() });
    drawPins();
  });

  return {
    setLog(xlog, ylog) {
      state.xlog = xlog; state.ylog = ylog; state.range = null;
      refresh();
      // Change axis type first, then set the range in a second call: if both go in
      // one relayout, Plotly converts the new (already log) range as if it were linear.
      Plotly.relayout(div, {
        'xaxis.type': xlog ? 'log' : 'linear', 'yaxis.type': ylog ? 'log' : 'linear',
        'xaxis.autorange': true, 'yaxis.autorange': true,
      }).then(() => Plotly.relayout(div, homeView()));
    },
    setShowRaw(show) { Plotly.restyle(div, { visible: show }, [0]); },
    setSmoothing(widthUHz) {
      state.smooth = widthUHz > 0 ? boxcar(power, Math.round(widthUHz / df)) : null;
      refresh();
    },
    zoomTo(fa, fb) {
      state.range = [fa, fb];
      const [i0, i1] = idx(state.range);
      let ymin = Infinity, ymax = -Infinity;
      for (let i = i0; i < i1; i++) { if (power[i] > ymax) ymax = power[i]; if (power[i] < ymin) ymin = power[i]; }
      Plotly.relayout(div, {
        'xaxis.range': state.xlog ? [Math.log10(fa), Math.log10(fb)] : [fa, fb],
        'yaxis.range': state.ylog ? [Math.log10(Math.max(ymin, ymax * 1e-6)), Math.log10(ymax) + 0.1] : [0, ymax * 1.05],
      });
    },
    // The current zoom in data units ({x: [µHz, µHz], y: [PSD, PSD]}), or null
    // when showing the full spectrum. Pass it back as opts.view to keep the zoom.
    getView() {
      if (!state.range) return null;
      const yr = div._fullLayout.yaxis.range.map(Number);
      return { x: state.range.slice(), y: state.ylog ? yr.map(v => Math.pow(10, v)) : yr };
    },
    viewRange() {
      const full = [f0, f0 + (N - 1) * df];
      return state.range ? [Math.max(state.range[0], full[0]), Math.min(state.range[1], full[1])] : full;
    },
    clearPins() { state.pins = []; drawPins(); },
    undoPin(f) { state.pins = state.pins.filter(x => x !== f); drawPins(); },
  };
}

/* ---------- autocorrelation of the power spectrum ---------- */

// ACF of the PSD between fa and fb (uHz), out to maxLag (uHz).
// The PSD is first averaged into bins of ~binUHz to keep the sum fast.
export function psdAutocorrelation(data, fa, fb, maxLag, binUHz = 0.1) {
  const { power, meta } = data;
  const { f0, df } = meta.psd;
  const i0 = Math.max(0, Math.round((fa - f0) / df));
  const i1 = Math.min(power.length, Math.round((fb - f0) / df));
  const k = Math.max(1, Math.round(binUHz / df), Math.ceil((i1 - i0) / 40000));
  const m = Math.floor((i1 - i0) / k);
  if (m < 4) return null;
  const a = new Float64Array(m);
  let mean = 0;
  for (let j = 0; j < m; j++) {
    let s = 0;
    for (let i = i0 + j * k, e = i + k; i < e; i++) s += power[i];
    a[j] = s / k; mean += a[j];
  }
  mean /= m;
  let norm = 0;
  for (let j = 0; j < m; j++) { a[j] -= mean; norm += a[j] * a[j]; }
  const step = k * df;
  const L = Math.min(m - 1, Math.round(maxLag / step));
  const lag = new Float64Array(L + 1), acf = new Float64Array(L + 1);
  for (let l = 0; l <= L; l++) {
    let s = 0;
    for (let j = 0, e = m - l; j < e; j++) s += a[j] * a[j + l];
    lag[l] = l * step; acf[l] = s / norm;
  }
  return { lag, acf, step };
}

export function acfPlot(div, opts = {}) {
  // opts: { onPins(pins) } — called with the sorted pinned lags whenever they change.
  const layout = baseLayout();
  layout.xaxis.title = { ...layout.xaxis.title, text: 'Frequency lag (µHz)' };
  layout.yaxis.title = { ...layout.yaxis.title, text: 'Autocorrelation' };
  // Picking peaks: hover/click go by lag alone (click anywhere in the column);
  // only a vertical cursor line is drawn.
  layout.hovermode = 'x';
  layout.hoverdistance = -1;
  layout.spikedistance = -1;
  layout.yaxis.showspikes = false;
  freshPlot(div, [{
    type: 'scatter', mode: 'lines', x: [], y: [], line: { width: 1.5, color: cssVar('--series-1') },
    hovertemplate: 'lag = %{x:.2f} µHz<br>ACF = %{y:.3f}<extra></extra>',
  }], layout);
  let home = null; // the ranges set by the last show()
  let res = null, pins = [];
  const drawPins = () => {
    Plotly.relayout(div, {
      shapes: pins.map(x => ({
        type: 'line', xref: 'x', yref: 'paper', x0: x, x1: x, y0: 0, y1: 1,
        line: { color: cssVar('--pin'), width: 1.5, dash: 'dash' },
      })),
    });
    opts.onPins?.(pins.slice());
  };
  registerTheme(div, () => { Plotly.restyle(div, { 'line.color': cssVar('--series-1') }, [0]); drawPins(); });
  div.resetView = () => home && Plotly.relayout(div, {
    'xaxis.range': home.x.slice(), 'yaxis.range': home.y.slice(), 'xaxis.autorange': false, 'yaxis.autorange': false,
  });
  addViewControls(div);
  // Click to pin a lag, snapped to the highest ACF value within ~0.4% of the
  // visible width (a few pixels) of the click. Only when the page shows a pin table.
  if (opts.onPins) div.on('plotly_click', ev => {
    const pt = ev.points?.[0];
    if (!pt || !res) return;
    const [va, vb] = div._fullLayout.xaxis.range.map(Number);
    const half = 0.004 * Math.abs(vb - va);
    let im = -1;
    for (let i = 0; i < res.lag.length; i++) {
      if (Math.abs(res.lag[i] - pt.x) > half) continue;
      if (im < 0 || res.acf[i] > res.acf[im]) im = i;
    }
    pins.push(im >= 0 ? res.lag[im] : pt.x);
    pins.sort((a, b) => a - b);
    drawPins();
  });
  return {
    show(r, ignoreBelow = 3) {
      res = r;
      if (!r) { Plotly.restyle(div, { x: [[]], y: [[]] }, [0]); return; }
      // Scale y to ignore the trivial peak at zero lag.
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < r.lag.length; i++) {
        if (r.lag[i] < ignoreBelow) continue;
        lo = Math.min(lo, r.acf[i]); hi = Math.max(hi, r.acf[i]);
      }
      const pad = 0.08 * (hi - lo || 1);
      home = { x: [0, r.lag[r.lag.length - 1]], y: [lo - pad, hi + pad] };
      Plotly.react(div, [{ ...div.data[0], x: r.lag, y: r.acf }], {
        ...div.layout,
        xaxis: { ...div.layout.xaxis, range: home.x.slice(), autorange: false },
        yaxis: { ...div.layout.yaxis, range: home.y.slice(), autorange: false },
      });
    },
    clearPins() { pins = []; drawPins(); },
  };
}

/* ---------- échelle diagram ---------- */

// Cut the power spectrum into consecutive slices Δν wide and stack them, so
// modes of the same degree line up in near-vertical ridges.
// Each cell is the mean PSD over a bin of width ~binUHz.
// eps (ε, default 0) shifts where each slice starts, to ν = (k + ε)Δν, so the
// x axis is (ν − εΔν) mod Δν: with the star's ε, the l=0 ridge sits at x ≈ 0.
export function echelleGrid(data, dnu, fa, fb, binUHz = 0.5, replicate = false, eps = 0) {
  const { power, meta } = data;
  const { f0, df } = meta.psd;
  const N = power.length, fmax = f0 + (N - 1) * df;
  const nx = Math.max(4, Math.round(dnu / binUHz));
  const w = dnu / nx;
  const ncol = replicate ? 2 * nx : nx;
  const off = eps * dnu;
  const kLo = Math.floor((Math.max(fa, f0) - off) / dnu), kHi = Math.floor((Math.min(fb, fmax) - off) / dnu);
  const x = Array.from({ length: ncol }, (_, j) => (j + 0.5) * w);
  const y = [], z = [], nu = [];
  for (let k = kLo; k <= kHi; k++) {
    const row = [], rowNu = [];
    for (let j = 0; j < ncol; j++) {
      const a = k * dnu + off + j * w, b = a + w;
      const ia = Math.max(0, Math.ceil((a - f0) / df)), ib = Math.min(N, Math.ceil((b - f0) / df));
      let s = 0;
      for (let i = ia; i < ib; i++) s += power[i];
      row.push(ib > ia ? s / (ib - ia) : null);
      rowNu.push(a + 0.5 * w);
    }
    y.push((k + 0.5) * dnu + off); z.push(row); nu.push(rowNu);
  }
  return { x, y, z, nu, w, eps };
}

export function echellePlot(div, data) {
  const colorscale = () => [[0, cssVar('--surface')], [1, cssVar('--series-1')]];
  const layout = baseLayout();
  layout.hovermode = 'closest';
  layout.xaxis.title = { ...layout.xaxis.title, text: 'ν mod Δν (µHz)' };
  layout.yaxis.title = { ...layout.yaxis.title, text: 'Frequency (µHz)' };
  layout.xaxis.showspikes = layout.yaxis.showspikes = false;
  layout.xaxis.showgrid = layout.yaxis.showgrid = false;
  freshPlot(div, [{
    type: 'heatmap', x: [], y: [], z: [], customdata: [],
    colorscale: colorscale(), showscale: false, zsmooth: false,
    hovertemplate: 'ν = %{customdata:.2f} µHz<br>ν mod Δν = %{x:.2f} µHz<br>PSD = %{z:.3g}<extra></extra>',
  }, markTrace([], [], [])], layout);
  registerTheme(div, () => Plotly.restyle(div, { colorscale: [colorscale()], 'marker.line.color': cssVar('--series-2') }, [0, 1]));
  let home = null, marks = [], last = null;
  // Marked frequencies (from the power-spectrum pins) drawn as open circles at
  // (ν mod Δν, row of ν). With two Δν widths shown, each also appears in the
  // right-hand copy, one row lower.
  function markTrace(x, y, nu, name = 'ν mod Δν') {
    return {
      type: 'scatter', mode: 'markers', x, y, customdata: nu,
      marker: { size: 11, color: 'rgba(0,0,0,0)', line: { width: 2, color: cssVar('--series-2') } },
      hovertemplate: `marked ν = %{customdata:.2f} µHz<br>${name} = %{x:.2f} µHz<extra></extra>`,
    };
  }
  const xName = () => (last?.eps ? '(ν − εΔν) mod Δν' : 'ν mod Δν');
  const markPoints = (dnu, replicate, eps = 0) => {
    const x = [], y = [], nu = [], off = eps * dnu;
    for (const f of marks) {
      const k = Math.floor((f - off) / dnu), m = f - off - k * dnu;
      x.push(m); y.push((k + 0.5) * dnu + off); nu.push(f);
      if (replicate) { x.push(m + dnu); y.push((k - 0.5) * dnu); nu.push(f); }
    }
    return { x, y, nu };
  };
  div.resetView = () => home && Plotly.relayout(div, {
    'xaxis.range': home.x.slice(), 'yaxis.range': home.y.slice(), 'xaxis.autorange': false, 'yaxis.autorange': false,
  });
  addViewControls(div);
  return {
    show(g, dnu) {
      // Colour scale: starts at the median (typical noise fades into the background)
      // and tops out at a high percentile so weaker (l=2, l=3) ridges still show.
      const vals = g.z.flat().filter(v => v != null).sort((a, b) => a - b);
      const pct = q => (vals.length ? vals[Math.floor(q * (vals.length - 1))] : 0);
      const zmin = pct(0.5), zmax = Math.max(pct(0.995), zmin * 1.01 + 1e-9);
      const ncol = g.x.length;
      home = { x: [0, ncol * g.w], y: [g.y[0] - dnu / 2, g.y[g.y.length - 1] + dnu / 2] };
      last = { dnu, replicate: ncol * g.w > dnu * 1.5, eps: g.eps || 0 };
      const mp = markPoints(dnu, last.replicate, last.eps);
      Plotly.react(div, [{ ...div.data[0], x: g.x, y: g.y, z: g.z, customdata: g.nu, zmin, zmax,
                           hovertemplate: `ν = %{customdata:.2f} µHz<br>${xName()} = %{x:.2f} µHz<br>PSD = %{z:.3g}<extra></extra>` },
                         markTrace(mp.x, mp.y, mp.nu, xName())], {
        ...div.layout,
        shapes: ncol * g.w > dnu * 1.5
          ? [{ type: 'line', xref: 'x', yref: 'paper', x0: dnu, x1: dnu, y0: 0, y1: 1,
               line: { color: cssVar('--text-3'), width: 1, dash: 'dot' } }]
          : [],
        xaxis: { ...div.layout.xaxis, range: home.x.slice(), autorange: false,
                 title: { ...div.layout.xaxis.title, text: `${xName()} (µHz)` } },
        yaxis: { ...div.layout.yaxis, range: home.y.slice(), autorange: false },
      });
    },
    // Frequencies (µHz) to mark; [] clears them. Keeps the current zoom.
    setMarks(freqs) {
      marks = freqs.slice();
      if (!last) return;
      const mp = markPoints(last.dnu, last.replicate, last.eps);
      Plotly.restyle(div, { x: [mp.x], y: [mp.y], customdata: [mp.nu] }, [1]);
    },
  };
}

/* ---------- target picker ---------- */

// "Pick your target" buttons, one per star in data/targets.json. The chosen star
// is kept in the page URL (?star=<slug>), so a link or a reload keeps it.
// Choosing another star reloads the page with that star.
// Returns the chosen target { slug, name } (the first one if none is chosen).
export async function targetPicker(container, dataRoot = '../../data/') {
  const targets = await fetchOk(dataRoot + 'targets.json').then(r => r.json());
  const url = new URL(location.href);
  const chosen = targets.find(t => t.slug === url.searchParams.get('star')) || targets[0];
  container.replaceChildren(...targets.map(t => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = t.name;
    b.setAttribute('aria-pressed', t === chosen);
    b.onclick = () => {
      if (t === chosen) return;
      url.searchParams.set('star', t.slug);
      location.href = url.toString();
    };
    return b;
  }));
  return chosen;
}
